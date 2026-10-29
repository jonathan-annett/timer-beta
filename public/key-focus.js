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
 * The timer's windows share one answer (the timer page, its floating overlay, the presenter window,
 * the run sheet editor): while the overlay is open and ANY of them has the keyboard, ALL show the
 * badge, so it's on the confidence monitor (and in a vision switcher's view of it) too. Each window
 * reports its own focus in localStorage keys_focus {w, t} (report(), refreshed every second while
 * focused; FRESH 2.5 s), and focusedElsewhere(w) reads the others'.
 *
 * And by itself, on the pages that aren't the overlay's own:
 *   - the presenter window (timer.html?presenter) and the run sheet editor show the badge while
 *     the timer's overlay is open (localStorage overlay_open, written by local-overlay.js) and
 *     one of the timer's windows has the keyboard;
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
html body div.kw-note.kw-note { position: fixed; z-index: 2147483000; left: 50%; bottom: 24px; transform: translateX(-50%); display: block;
  padding: 10px 16px; border-radius: 8px; background: rgba(20,20,20,.95); color: #fff; border: 1px solid #555;
  font: 16px "Helvetica Neue", Arial, sans-serif; white-space: nowrap; transition: opacity 1s; }
html body div.kw-note.kw-note.kw-gone { opacity: 0; }
.kw-badge .kw-key { background: #c62828; color: #fff; border-radius: 6px; padding: 2px 8px; font-size: 20px; line-height: 1.3;
  animation: kw-blink 1s steps(1) infinite; box-shadow: 0 2px 10px rgba(0,0,0,.5); }
.kw-badge .kw-tip { background: rgba(198,40,40,.92); color: #fff; border-radius: 6px; padding: 5px 12px; transition: opacity 1s; }
.kw-badge .kw-tip.kw-gone { opacity: 0; }
@keyframes kw-blink { 50% { opacity: .2; } }`;
  let cssAdded = false;

  // A badge at the top of this page (top: a CSS length, e.g. under the timer's button bar)
  function addCss() {
    if (cssAdded) return;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    cssAdded = true;
  }
  function create(text, top) {
    addCss();
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

  // ─── Which of the timer's windows has the keyboard ───────────────────────
  const FOCUS_KEY = 'keys_focus', FRESH = 2500;
  function report(who, focused) {
    try {
      const cur = JSON.parse(localStorage.getItem(FOCUS_KEY) || 'null');
      if (focused) {
        // at most once a second for the same window: a write wakes the others (storage events), and
        // they mustn't answer each other in a loop
        if (cur && cur.w === who && Date.now() - cur.t < 900) return;
        localStorage.setItem(FOCUS_KEY, JSON.stringify({ w: who, t: Date.now() }));
      }
      else if (cur && cur.w === who) localStorage.setItem(FOCUS_KEY, JSON.stringify({ w: null, t: Date.now() }));   // gone elsewhere
    } catch (_) { /* no storage */ }
  }
  function focusedElsewhere(who) {
    try {
      const v = JSON.parse(localStorage.getItem(FOCUS_KEY) || 'null');
      return !!(v && v.w && v.w !== who && Date.now() - v.t < FRESH);
    } catch (_) { return false; }
  }

  // ─── The presenter window and the run sheet editor ───────────────────────
  const PRESENTER = /timer\.html$/.test(location.pathname) && location.search.startsWith('?presenter');
  const EDITOR = /runsheet\.html$/.test(location.pathname) && !/[?&]remote\b/.test(location.search);
  if (PRESENTER || EDITOR) {
    let badge = null;
    const check = () => {
      let open = false;
      try { open = localStorage.getItem('overlay_open') === '1'; } catch (_) { /* no storage */ }
      if (!badge && open) badge = create('Warning: timer still owns the keyboard. Click in PowerPoint (or your show software) to ensure slides advance normally');
      const mine = open && document.hasFocus(), who = PRESENTER ? 'presenter' : 'editor';
      if (open) report(who, mine);
      if (badge) badge.set(open && (mine || focusedElsewhere(who)));
    };
    const start = () => {
      check();
      setInterval(check, 1000);                  // focus moving to another app isn't always reported
      window.addEventListener('focus', check);
      window.addEventListener('blur', () => setTimeout(check, 0));
      window.addEventListener('storage', e => { if (e.key === 'overlay_open' || e.key === FOCUS_KEY) check(); });
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }

  // Keys the presenter window keeps: its own full screen (F, F11; Ctrl+Cmd+F and other Cmd keys on a
  // Mac) and Escape (leaves full screen; in the timer window it would cancel typing there)
  const LOCAL = e => e.metaKey || /^f$/i.test(e.key) || e.key === 'F11' || e.key === 'Escape';
  const overlayOpen = () => { try { return localStorage.getItem('overlay_open') === '1'; } catch (_) { return false; } };
  // A short note at the bottom of this window, fading after 4 s. Used for O: a browser opens a
  // floating window only for the window that was typed in, so a key passed on from here can close
  // the timer's overlay but not open it.
  let noteEl = null, noteTimer = null;
  function note(text) {
    if (!noteEl) {
      addCss();
      noteEl = document.createElement('div');
      noteEl.className = 'kw-note';
      document.body.appendChild(noteEl);
    }
    noteEl.textContent = text;
    noteEl.classList.remove('kw-gone');
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => noteEl.classList.add('kw-gone'), 4000);
  }
  if (PRESENTER) {
    // Keys go to the timer window that opened this one (as if typed there), so the timer's
    // shortcuts work from here too. Captured before timer.js sees them: this window only mirrors.
    for (const type of ['keydown', 'keyup']) {
      window.addEventListener(type, e => {
        if (LOCAL(e)) return;                                       // full screen and the browser's own: this window's
        if (/^o$/i.test(e.key) && !e.ctrlKey && !overlayOpen()) {    // O can't open the overlay from here: see note()
          e.stopImmediatePropagation();
          if (type === 'keydown') note('Open the overlay from the timer window (press O there)');
          return;
        }
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

  return { create, report, focusedElsewhere, FOCUS_KEY };
})();
