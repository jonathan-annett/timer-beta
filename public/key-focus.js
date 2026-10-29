/*!
 * key-focus.js — where the keyboard goes while a floating overlay is up.
 *
 * The overlay's main use is a one-laptop show: PowerPoint with the presenter's clicker, a Stream
 * Deck, and the timer's overlay floating over Presenter View, no crew. Then a key typed into a
 * timer window is a key PowerPoint never gets, so every window involved shows a blinking red ⌨
 * while it has the keyboard, with the message beside it for 4 s each time (and as its tooltip).
 *
 *   const b = KeysBadge.create(text);  b.set(on)     (used by local-overlay.js and overlay.js)
 *
 * And by itself, on the pages that aren't the overlay's own:
 *   - the presenter window (timer.html?presenter) and the run sheet editor show the badge while
 *     the timer's overlay is open (localStorage overlay_open, written by local-overlay.js) and
 *     they have the keyboard;
 *   - the presenter window passes its keys on to the timer window that opened it, as the floating
 *     overlay does, so the timer's keys work whichever of its windows has focus. Full screen (F, F11,
 *     Ctrl+Cmd+F), Escape and Cmd shortcuts stay here. The run sheet editor keeps its keys: it's typed in.
 * MIT Licensed
 */
var KeysBadge = (function () {
  'use strict';

  const CSS = `
/* .kw-badge twice: stronger than the presenter window's html.reduced body div { display: none } */
html body div.kw-badge.kw-badge { position: fixed; z-index: 2147483000; left: 50%; transform: translateX(-50%); top: 8px; display: flex; align-items: center; gap: 8px;
  font: bold 15px "Helvetica Neue", Arial, sans-serif; white-space: nowrap; cursor: default; }
html body div.kw-badge.kw-badge[hidden] { display: none; }
.kw-badge .kw-key { background: #c62828; color: #fff; border-radius: 6px; padding: 2px 8px; font-size: 20px; line-height: 1.3;
  animation: kw-blink 1s steps(1) infinite; box-shadow: 0 2px 10px rgba(0,0,0,.5); }
.kw-badge .kw-tip { background: rgba(198,40,40,.92); color: #fff; border-radius: 6px; padding: 5px 12px; transition: opacity 1s; }
.kw-badge .kw-tip.kw-gone { opacity: 0; }
@keyframes kw-blink { 50% { opacity: .2; } }`;
  let cssAdded = false;

  // A badge at the top of this page (top: a CSS length, e.g. under the timer's button bar)
  function create(text, top) {
    if (!cssAdded) {
      const st = document.createElement('style');
      st.textContent = CSS;
      document.head.appendChild(st);
      cssAdded = true;
    }
    const el = document.createElement('div');
    el.className = 'kw-badge';
    el.hidden = true;
    el.title = text;
    el.innerHTML = '<span class="kw-key">⌨</span><span class="kw-tip"></span>';
    el.querySelector('.kw-tip').textContent = text;
    if (top) el.style.top = top;
    (document.body || document.documentElement).appendChild(el);
    let on = false, timer = null;
    return {
      el,
      set(v) {
        v = !!v;
        if (v === on) return;
        on = v;
        el.hidden = !v;
        clearTimeout(timer);
        const tip = el.querySelector('.kw-tip');
        if (v) {                                   // the words for 4 s each time, then just the ⌨
          tip.classList.remove('kw-gone');
          timer = setTimeout(() => tip.classList.add('kw-gone'), 4000);
        }
      },
    };
  }

  // ─── The presenter window and the run sheet editor ───────────────────────
  const PRESENTER = /timer\.html$/.test(location.pathname) && location.search.startsWith('?presenter');
  const EDITOR = /runsheet\.html$/.test(location.pathname) && !/[?&]remote\b/.test(location.search);
  if (PRESENTER || EDITOR) {
    let badge = null;
    const check = () => {
      let open = false;
      try { open = localStorage.getItem('overlay_open') === '1'; } catch (_) { /* no storage */ }
      if (!badge && open) badge = create('Warning: timer still owns the keyboard. Click in PowerPoint to ensure slides advance normally');
      if (badge) badge.set(open && document.hasFocus());
    };
    const start = () => {
      check();
      setInterval(check, 1000);                  // focus moving to another app isn't always reported
      window.addEventListener('focus', check);
      window.addEventListener('blur', () => setTimeout(check, 0));
      window.addEventListener('storage', e => { if (e.key === 'overlay_open') check(); });
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }

  // Keys the presenter window keeps: its own full screen (F, F11; Ctrl+Cmd+F and other Cmd keys on a
  // Mac) and Escape (leaves full screen; in the timer window it would cancel typing there)
  const LOCAL = e => e.metaKey || /^f$/i.test(e.key) || e.key === 'F11' || e.key === 'Escape';
  if (PRESENTER) {
    // Keys go to the timer window that opened this one (as if typed there), so the timer's
    // shortcuts work from here too. Captured before timer.js sees them: this window only mirrors.
    for (const type of ['keydown', 'keyup']) {
      window.addEventListener(type, e => {
        if (LOCAL(e)) return;                                       // full screen and the browser's own: this window's
        let main = null;
        try { main = window.opener && !window.opener.closed && window.opener.document ? window.opener : null; } catch (_) { main = null; }
        if (!main) return;                                        // opened by hand: keys stay here, as before
        e.stopImmediatePropagation();
        const copy = new main.KeyboardEvent(type, { key: e.key, code: e.code, location: e.location, repeat: e.repeat,
          ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true });
        main.document.dispatchEvent(copy);
        if (copy.defaultPrevented) e.preventDefault();
      }, true);
    }
  }

  return { create };
})();
