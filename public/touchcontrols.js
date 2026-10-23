/*!
 * touchcontrols.js
 * Mobile touch controls for Presentation Timer
 * Only activates on touch devices. Dispatches into existing keyboard handlers.
 * MIT Licensed
 */

/* global onDocKeyDown, onDocKeyUp, setDefaultDuration, restartTimer */

(function () {
  'use strict';

  // Only activate on genuine touch devices
  if (!('ontouchstart' in window)) return;

  // Not needed on audience page (no controls there)
  if (new URLSearchParams(location.search).has('audience')) return;

  const PRESETS = [
    { label: '10 min', ms: 600000   },
    { label: '20 min', ms: 1200000  },
    { label: '30 min', ms: 1800000  },
    { label: '45 min', ms: 2700000  },
    { label: '1 hour', ms: 3600000  },
    { label: '90 min', ms: 5400000  },
    { label: '2 hours', ms: 7200000 },
    { label: '3 hours', ms: 10800000},
  ];

  // ─── Synthetic key dispatch ───────────────────────────────────────────────

  function pressKey(key, ctrl = false, shift = false) {
    const ev = { key, ctrlKey: ctrl, shiftKey: shift, altKey: false, preventDefault: () => {} };
    if (typeof onDocKeyDown === 'function') onDocKeyDown(ev);
    if (typeof onDocKeyUp   === 'function') onDocKeyUp(ev);
  }

  // ±1 minute, applied at once (what Ctrl+↑/↓ do). Not a synthetic Ctrl+arrow: the timer only
  // knows Ctrl is held from a real Control keydown, so that gave ±1 second.
  function adjustMinute(add) {
    if (typeof processTimerApiMessage === 'function') processTimerApiMessage({ cmd: 'adjust', addtime: add, msecs: 60000 });
  }

  // ─── Touch strip buttons ──────────────────────────────────────────────────

  function initStrip() {
    const strip = document.getElementById('touch-strip');
    if (!strip) return;

    // Presenter mode hides the strip
    const html = document.documentElement;
    const observer = new MutationObserver(() => {
      strip.style.display = html.classList.contains('reduced') ? 'none' : '';
    });
    observer.observe(html, { attributes: true, attributeFilter: ['class'] });

    document.getElementById('touch-start-btn')?.addEventListener('pointerdown', e => {
      e.preventDefault();
      pressKey(' ');
    });

    document.getElementById('touch-pause-btn')?.addEventListener('pointerdown', e => {
      e.preventDefault();
      pressKey('"');
    });

    document.getElementById('touch-plus-btn')?.addEventListener('pointerdown', e => {
      e.preventDefault();
      adjustMinute(true);
    });

    document.getElementById('touch-minus-btn')?.addEventListener('pointerdown', e => {
      e.preventDefault();
      adjustMinute(false);
    });

    // The guide (README overlay; installed by timer.html as window.timerHelp)
    document.getElementById('touch-help-btn')?.addEventListener('click', e => {
      e.preventDefault();
      if (window.timerHelp) window.timerHelp.open('phones-and-tablets');
    });

    document.getElementById('touch-presets-btn')?.addEventListener('pointerdown', e => {
      e.preventDefault();
      openPresetSheet();
    });

    // Keep pause button label in sync with timer state
    const pauseBtn = document.getElementById('touch-pause-btn');
    if (pauseBtn) {
      new MutationObserver(() => {
        const paused = html.classList.contains('paused');
        pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
      }).observe(html, { attributes: true, attributeFilter: ['class'] });
    }
  }

  // ─── Preset bottom sheet ──────────────────────────────────────────────────
  // Built-in presets plus the user's own (localStorage touch_presets: minutes, sorted), and a
  // keypad to type any duration: digits are minutes, ":" separates hours (1:30), as on the
  // keyboard. From the keypad: Start (set the default and start), Set default, or Save as a
  // preset. "Edit" shows ✕ on the custom presets to remove them.

  const CUSTOM_KEY = 'touch_presets';
  function customPresets() {
    try {
      const v = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
      return Array.isArray(v) ? v.filter(m => Number.isInteger(m) && m > 0 && m <= 24 * 60) : [];
    } catch (_) { return []; }
  }
  function saveCustom(list) {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch (_) { /* full / private */ }
  }
  const builtInMins = new Set(PRESETS.map(p => p.ms / 60000));
  function addCustom(mins) {
    if (builtInMins.has(mins)) return;              // already a button
    const list = customPresets();
    if (!list.includes(mins)) { list.push(mins); list.sort((a, b) => a - b); saveCustom(list); }
  }
  function removeCustom(mins) { saveCustom(customPresets().filter(m => m !== mins)); }
  function minsLabel(mins) {
    if (mins < 60) return mins + ' min';
    const h = Math.floor(mins / 60), m = mins % 60;
    return m ? `${h} h ${String(m).padStart(2, '0')}` : h === 1 ? '1 hour' : h + ' hours';
  }

  function startWith(ms) {
    if (typeof setDefaultDuration === 'function') setDefaultDuration(ms);
    if (typeof restartTimer       === 'function') restartTimer();
  }
  function setDefault(ms) {
    if (typeof setDefaultDuration === 'function') setDefaultDuration(ms);
    if (window.timerAPI && typeof secToStr === 'function') timerAPI.send({ setVariableValues: { default: secToStr(ms / 1000) } });
  }

  let editing = false;
  function renderPresetGrid() {
    const grid = document.getElementById('touch-sheet-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const all = PRESETS.map(p => ({ label: p.label, ms: p.ms, custom: false }))
      .concat(customPresets().map(m => ({ label: minsLabel(m), ms: m * 60000, custom: true })));
    all.forEach(({ label, ms, custom }) => {
      const btn = document.createElement('button');
      btn.className = 'touch-sheet-preset' + (custom ? ' custom' : '');
      btn.textContent = label;
      if (custom && editing) btn.classList.add('removable');
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (custom && editing) { removeCustom(ms / 60000); renderPresetGrid(); return; }
        if (editing) return;
        closePresetSheet();
        startWith(ms);
      });
      grid.appendChild(btn);
    });
    const edit = document.getElementById('touch-sheet-edit');
    if (edit) {
      edit.hidden = !customPresets().length && !editing;
      edit.textContent = editing ? 'Done' : 'Edit';
    }
    const title = document.querySelector('#touch-preset-sheet .touch-sheet-title');
    if (title) title.textContent = editing ? 'Tap a custom preset to remove it' : 'Select duration';
  }

  // Keypad: the typed text is minutes, or h:mm once ":" is pressed
  let padText = '';
  function padMs() {
    const [a, b] = padText.split(':');
    if (padText === '' || padText === ':') return 0;
    const ms = padText.includes(':') ? (Number(a || 0) * 60 + Number(b || 0)) * 60000 : Number(a) * 60000;
    return ms > 0 && ms <= 24 * 3600000 ? ms : 0;
  }
  function renderPad() {
    const disp = document.getElementById('touch-pad-display');
    if (!disp) return;
    const ms = padMs();
    disp.textContent = padText === '' ? '0 min' : padText.includes(':') ? padText + (padText.endsWith(':') ? '00' : '') + ' h' : padText + ' min';
    disp.classList.toggle('empty', !ms);
    ['touch-pad-start', 'touch-pad-default', 'touch-pad-save'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = !ms; });
  }
  function padKey(k) {
    if (k === 'back') padText = padText.slice(0, -1);
    else if (k === ':') { if (!padText.includes(':') && padText !== '') padText += ':'; }
    else if (/^\d$/.test(k)) {
      const [h, m] = padText.split(':');
      if (padText.includes(':')) { if ((m || '').length < 2) padText += k; }
      else if (h.length < 4 && !(h === '0' && k === '0')) padText = h === '0' ? k : padText + k;
    }
    renderPad();
    if (navigator.vibrate) navigator.vibrate(10);
  }
  function showPad(on) {
    const sheet = document.getElementById('touch-preset-sheet');
    sheet.classList.toggle('keypad', on);
    if (on) { padText = ''; renderPad(); }
  }

  function openPresetSheet() {
    const sheet = document.getElementById('touch-preset-sheet');
    if (!sheet) return;
    editing = false;
    showPad(false);
    renderPresetGrid();
    sheet.style.display = 'flex';
    requestAnimationFrame(() => sheet.classList.add('visible'));
  }

  function closePresetSheet() {
    const sheet = document.getElementById('touch-preset-sheet');
    if (!sheet) return;
    sheet.classList.remove('visible');
    setTimeout(() => { sheet.style.display = 'none'; }, 220);
  }

  function initPresetSheet() {
    const on = (id, fn) => document.getElementById(id)?.addEventListener('pointerdown', e => { e.preventDefault(); fn(); });
    on('touch-sheet-cancel', closePresetSheet);
    on('touch-sheet-backdrop', closePresetSheet);
    on('touch-sheet-edit', () => { editing = !editing; renderPresetGrid(); });
    on('touch-sheet-custom', () => { editing = false; showPad(true); });
    on('touch-pad-back-to-presets', () => showPad(false));
    document.querySelectorAll('#touch-pad button[data-k]').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); padKey(b.dataset.k); }));
    on('touch-pad-start', () => { const ms = padMs(); if (ms) { closePresetSheet(); startWith(ms); } });
    on('touch-pad-default', () => { const ms = padMs(); if (ms) { closePresetSheet(); setDefault(ms); } });
    on('touch-pad-save', () => {
      const ms = padMs();
      if (!ms) return;
      addCustom(ms / 60000);
      setDefault(ms);
      showPad(false);
      renderPresetGrid();
    });
  }

  // ─── Tap & long-press gestures on the main clock ──────────────────────────

  function initGestures() {
    const target = document.getElementById('clock_main');
    if (!target) return;

    let touchStartX = 0, touchStartY = 0;
    let touchStartTime = 0;
    let longPressTimer = null;
    const TAP_SLOP         = 40;  // px a tap may move
    const LONG_PRESS_MS    = 600;

    target.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      touchStartX    = e.touches[0].clientX;
      touchStartY    = e.touches[0].clientY;
      touchStartTime = Date.now();

      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        // Long press = pause / resume
        pressKey('"');
        // Haptic feedback if available
        if (navigator.vibrate) navigator.vibrate(40);
      }, LONG_PRESS_MS);
    }, { passive: true });

    target.addEventListener('touchend', e => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      const dt = Date.now() - touchStartTime;
      const absDx = Math.abs(dx), absDy = Math.abs(dy);

      // Taps only: swipes used to nudge the time, but they were easy to set off by accident
      // and the strip's ±1 min buttons do the same job.
      if (absDx < TAP_SLOP && absDy < TAP_SLOP && dt < 400) {
        // Double-tap detection
        if (target._lastTap && (Date.now() - target._lastTap) < 350) {
          target._lastTap = 0;
          pressKey(' '); // double-tap = start
        } else {
          target._lastTap = Date.now();
        }
      }
    }, { passive: true });

    target.addEventListener('touchmove', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }, { passive: true });
  }

  // ─── Quick-start overlay (first load on mobile, no saved state) ───────────

  function initQuickStart() {
    // Only show if no timer is already running
    if (localStorage.getItem('startedAt') !== null) return;

    const overlay = document.createElement('div');
    overlay.id = 'quick-start-overlay';
    overlay.innerHTML = `
      <div class="qs-inner">
        <div class="qs-title">How long is your talk?</div>
        <div class="qs-grid" id="qs-grid"></div>
        <button class="qs-skip" id="qs-skip">Skip — I'll set it manually</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const grid = document.getElementById('qs-grid');
    PRESETS.forEach(({ label, ms }) => {
      const btn = document.createElement('button');
      btn.className = 'qs-preset';
      btn.textContent = label;
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        overlay.remove();
        if (typeof setDefaultDuration === 'function') setDefaultDuration(ms);
        if (typeof restartTimer       === 'function') restartTimer();
      });
      grid.appendChild(btn);
    });

    document.getElementById('qs-skip')?.addEventListener('pointerdown', e => {
      e.preventDefault();
      overlay.remove();
    });
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────

  // The phone's Back button: closes the preset sheet or the quick-start overlay if open;
  // otherwise it does nothing rather than leaving the timer (back-guard.js)
  function initBackGuard() {
    if (typeof BackGuard === 'undefined') return;
    BackGuard.install();
    BackGuard.register(() => {
      const sheet = document.getElementById('touch-preset-sheet');
      if (sheet && sheet.style.display !== 'none') {
        if (sheet.classList.contains('keypad')) showPad(false); else closePresetSheet();
        return true;
      }
      const qs = document.getElementById('quick-start-overlay');
      if (qs) { qs.remove(); return true; }
      return false;
    });
  }

  function init() {
    initBackGuard();
    initStrip();
    initPresetSheet();
    initGestures();
    // Slight delay so timer.js finishes initialising before we check state
    setTimeout(initQuickStart, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
