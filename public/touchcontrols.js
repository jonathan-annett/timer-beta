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

  function openPresetSheet() {
    const sheet = document.getElementById('touch-preset-sheet');
    if (!sheet) return;

    const grid = document.getElementById('touch-sheet-grid');
    if (grid && !grid.dataset.built) {
      grid.dataset.built = '1';
      PRESETS.forEach(({ label, ms }) => {
        const btn = document.createElement('button');
        btn.className = 'touch-sheet-preset';
        btn.textContent = label;
        btn.addEventListener('pointerdown', e => {
          e.preventDefault();
          closePresetSheet();
          if (typeof setDefaultDuration === 'function') setDefaultDuration(ms);
          if (typeof restartTimer       === 'function') restartTimer();
        });
        grid.appendChild(btn);
      });
    }

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
    document.getElementById('touch-sheet-cancel')?.addEventListener('pointerdown', e => {
      e.preventDefault(); closePresetSheet();
    });
    document.getElementById('touch-sheet-backdrop')?.addEventListener('pointerdown', e => {
      e.preventDefault(); closePresetSheet();
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

  function init() {
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
