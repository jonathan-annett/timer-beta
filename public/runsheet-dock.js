/*!
 * runsheet-dock.js
 * The run sheet editor docked along the bottom of the control screen: runsheet.html in an iframe,
 * unchanged (same origin, so it talks to runsheet.js through localStorage exactly as its own window
 * does: storage events fire in the iframe and back here). A bar on top resizes it (drag) and has
 * ⧉ (open it in its own window instead) and ✕ (close). The editor's own window has ⇲ Dock to come
 * back (runsheet_cmd 'dock'). The run sheet button and E open whichever the operator chose last.
 *
 * localStorage:
 *   runsheet_editor_place   'window' or absent (= docked)
 *   runsheet_dock_open      '1' while docked and open, so a reload brings it back
 *   runsheet_dock_height    the dock's height, as a fraction of the window (0.15–0.85)
 *
 * window.runsheetDock:
 *   toggle()   the run sheet button / E: opens or closes the dock → true, or false when the
 *              operator chose the window (runsheet.js opens that)
 *   dock()     docked from now on, and open (the editor window's ⇲ Dock)
 *   close(), isOpen()
 * html.rs-docked while it's open (--rs-dock-h: its height).
 * MIT Licensed
 */
(function () {
  'use strict';
  if (new URLSearchParams(location.search).has('presenter')) return;   // controller only

  const PLACE = 'runsheet_editor_place', OPEN = 'runsheet_dock_open', HEIGHT = 'runsheet_dock_height';
  const MIN_PX = 140, DEFAULT_H = 0.55;
  const get = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* private mode */ } };
  const html = document.documentElement;

  const CSS = `
#rs-dock { position: fixed; left: 0; right: 0; bottom: 0; height: var(--rs-dock-h, 55vh); z-index: 2147480000;
  display: flex; flex-direction: column; background: #111; border-top: 1px solid #333; box-shadow: 0 -6px 18px rgba(0,0,0,.45); }
#rs-dock[hidden] { display: none; }
#rs-dock .rsd-bar { flex: 0 0 auto; height: 18px; display: flex; align-items: center; gap: 6px; padding: 0 6px 0 10px; cursor: ns-resize;
  background: #1b1b1b; color: #777; font: 11px "Helvetica Neue", Arial, sans-serif; user-select: none; touch-action: none; }
#rs-dock .rsd-bar .rsd-grip { flex: 1; text-align: center; letter-spacing: 3px; color: #555; }
#rs-dock .rsd-bar button { cursor: pointer; font: 12px "Helvetica Neue", Arial, sans-serif; line-height: 14px; color: #aaa; background: none; border: 1px solid transparent; border-radius: 4px; padding: 0 5px; }
#rs-dock .rsd-bar button:hover { color: #fff; border-color: #444; background: #262626; }
#rs-dock iframe { flex: 1; width: 100%; border: 0; background: #0f0f0f; }
#rs-dock.dragging iframe { pointer-events: none; }
html.reduced #rs-dock { display: none; }
html.rs-docked #sting-bar { bottom: calc(var(--rs-dock-h, 55vh) + 12px); }`;

  let el = null, frame = null;
  const isOpen = () => !!(el && !el.hidden);

  function frac() { const f = Number(get(HEIGHT)); return f >= 0.15 && f <= 0.85 ? f : DEFAULT_H; }
  // Its height in px: as chosen, but never over the button bar nor under MIN_PX
  function applyHeight(f) {
    const top = parseFloat(getComputedStyle(html).getPropertyValue('--buttons-bottom')) || 48;
    const px = Math.round(Math.max(MIN_PX, Math.min(innerHeight * f, innerHeight - top - 8)));
    html.style.setProperty('--rs-dock-h', px + 'px');
  }

  function build() {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    el = document.createElement('div');
    el.id = 'rs-dock';
    el.hidden = true;
    el.innerHTML = '<div class="rsd-bar" title="Drag to resize"><span>Run sheet editor</span><span class="rsd-grip">⋯⋯⋯</span>' +
      '<button class="rsd-pop" title="Open the run sheet editor in its own window instead (it opens there from now on; its ⇲ Dock button brings it back)">⧉ Own window</button>' +
      '<button class="rsd-close" title="Close the run sheet editor (the run sheet button or E opens it again)">✕</button></div>';
    document.body.appendChild(el);
    el.querySelector('.rsd-close').addEventListener('click', e => { e.currentTarget.blur(); close(); });
    el.querySelector('.rsd-pop').addEventListener('click', popOut);
    // Drag the bar to resize
    const bar = el.querySelector('.rsd-bar');
    bar.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      const move = ev => { const f = Math.max(0.15, Math.min(0.85, (innerHeight - ev.clientY) / innerHeight)); put(HEIGHT, f.toFixed(3)); applyHeight(f); };
      const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); el.classList.remove('dragging'); };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
    });
    addEventListener('resize', () => { if (isOpen()) applyHeight(frac()); });
  }

  function open() {
    if (!el) build();
    applyHeight(frac());
    if (!frame) {                                  // a fresh editor each time it opens
      frame = document.createElement('iframe');
      frame.title = 'Run sheet editor';
      frame.src = 'runsheet.html';
      el.appendChild(frame);
    }
    el.hidden = false;
    html.classList.add('rs-docked');
    put(OPEN, '1');
  }
  function close() {
    if (frame) { frame.remove(); frame = null; }
    if (el) el.hidden = true;
    html.classList.remove('rs-docked');
    put(OPEN, null);
  }
  function popOut() {
    close();
    put(PLACE, 'window');
    if (window.runsheet && window.runsheet.openWindow) window.runsheet.openWindow();
  }
  function toggle() {
    if (get(PLACE) === 'window') return false;
    if (isOpen()) close(); else open();
    return true;
  }
  function dock() { put(PLACE, null); open(); }

  window.runsheetDock = { toggle, dock, close, isOpen };

  // A reload brings it back as it was
  const boot = () => { if (get(PLACE) !== 'window' && get(OPEN) === '1') open(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
