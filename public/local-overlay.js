/*!
 * local-overlay.js — the timer's own floating overlay (O, the "overlay" button): the countdown on
 * top of other windows, e.g. over PowerPoint's Presenter View, drawn by overlay-view.js exactly as
 * the overlay page on another computer draws it. Fed from the timerAPI bus, so it keeps going with
 * the timer page minimized (the bus is driven by the timer's worker tick, not animation frames).
 *
 * Starting it also shows a small settings box under the button bar (shape, message, progress
 * shade; the same settings as overlay.html, kept as local_overlay_*). It fades out when left alone
 * for 30 s, or Hide puts it away; it comes back each time the overlay starts.
 *
 * Keys pressed while the floating window has focus are passed on to the timer page (forwardKeys),
 * so the timer's shortcuts keep working after a click on the overlay (Document PiP only: the
 * video fallback gets no keys).
 *
 * While it's open and the timer page or the floating window has the keyboard, both show a warning
 * that keys go to the timer, not PowerPoint (the one-laptop case: PowerPoint, a Stream Deck and
 * this overlay, no crew): OverlayView's keysWarning and key-focus.js's badge; overlay_open tells the
 * presenter window and the run sheet editor to show theirs.
 *
 *   window.LocalOverlay.toggle()   (timer.js togglePIPMode; needs the key press or click)
 * MIT Licensed
 */
(function () {
  'use strict';
  if (new URLSearchParams(location.search).has('presenter')) return;   // the controller window only
  if (typeof OverlayView === 'undefined') return;

  const truthy = v => v === true || v === 'true' || v === '1' || v === 1;
  const MAP = {      // timerAPI variable -> [field, convert]
    remain: ['remain', String], expired: ['over', truthy], impending: ['impending', truthy], pausing: ['paused', truthy],
    custommsg: ['msg', String], showbar: ['bar', truthy], showmessages: ['msgs', truthy], barpct: ['pct', Number],
  };
  const s = {};
  let view = null, box = null, fadeTimer = null, keysBadge = null;
  // The presenter window and the run sheet editor show the ⌨ badge while this is open (key-focus.js)
  window.addEventListener('pagehide', () => { try { localStorage.removeItem('overlay_open'); } catch (_) { /* no storage */ } });
  try { localStorage.removeItem('overlay_open'); } catch (_) { /* a reload: the overlay closed with the page */ }
  const KEYS_WARNING = 'Warning: timer still owns the keyboard';   // on the overlay; the page's badge has the longer KEYS_HINT
  const KEYS_HINT = 'Warning: timer still owns the keyboard. Click in PowerPoint to ensure slides advance normally';

  const prev = window.timerAPI;
  window.timerAPI = {
    send(msg) {
      if (prev && prev.send) prev.send(msg);
      const v = msg && msg.setVariableValues;
      if (!v) return;
      let any = false;
      for (const k in v) if (MAP[k]) { s[MAP[k][0]] = MAP[k][1](v[k]); any = true; }
      if (any && view && view.open) render();
    },
  };

  function render() {
    view.render({
      online: true,
      remain: s.remain ? (s.over ? '+' : '') + s.remain : '–:––',
      over: s.over, impending: s.impending, paused: s.paused,
      msg: String(s.msg || '').trim() || OverlayView.autoMsg(s),
      pct: s.pct, bar: s.bar,
    });
  }

  function setup() {
    view = OverlayView.create({
      prefix: 'local_overlay_',
      onStatus: text => { showBox(); box.querySelector('.lo-note').textContent = text; },
      onWindow: forwardKeys,
      keysWarning: KEYS_WARNING,
      onKeys: focused => keysBadge.set(focused),
      onChange: () => {
        const html = document.documentElement;
        if (view.open) { if (window.setHtmlClass) setHtmlClass('overlay'); else html.classList.add('overlay'); }
        else { if (window.clearHtmlClass) clearHtmlClass('overlay'); else html.classList.remove('overlay'); hideBox(); }
        try { if (view.open) localStorage.setItem('overlay_open', '1'); else localStorage.removeItem('overlay_open'); } catch (_) { /* no storage */ }
      },
    });
    const parking = document.createElement('div');    // where the element waits while it isn't floating
    parking.hidden = true;
    parking.appendChild(view.el);
    document.body.appendChild(parking);

    const st = document.createElement('style');
    st.textContent = `
#lo-box { position: fixed; z-index: 60; right: 8px; top: calc(var(--buttons-bottom, 56px) + 8px); width: 300px; max-width: calc(100vw - 16px);
  box-sizing: border-box; padding: 8px 10px; background: #151515; color: #ddd; border: 1px solid #333; border-radius: 8px;
  font: 13px/1.4 "Helvetica Neue", Arial, sans-serif; box-shadow: 0 4px 18px rgba(0,0,0,.5); transition: opacity 1.5s; }
#lo-box[hidden] { display: none; }
#lo-box.lo-fading { opacity: 0; }
#lo-box .lo-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
#lo-box .lo-seg { display: flex; margin-bottom: 6px; }
#lo-box button { font: 12px "Helvetica Neue", Arial, sans-serif; color: #ddd; background: #222; border: 1px solid #444; padding: 3px 6px; cursor: pointer; }
#lo-box .lo-seg button { flex: 1; border-radius: 0; }
#lo-box .lo-seg button + button { border-left: 0; }
#lo-box .lo-seg button:first-child { border-radius: 4px 0 0 4px; }
#lo-box .lo-seg button:last-child { border-radius: 0 4px 4px 0; }
#lo-box .lo-seg button.on { background: #0b3d5c; border-color: #2a6a9a; color: #fff; }
#lo-box .lo-hide { border-radius: 4px; }
#lo-box label { margin-right: 12px; cursor: pointer; }
#lo-box .lo-note { color: #ffcc33; margin-top: 4px; }
#lo-box .lo-note:empty { display: none; }`;
    document.head.appendChild(st);
    box = document.createElement('div');
    box.id = 'lo-box';
    box.hidden = true;
    box.innerHTML = `<div class="lo-head"><b>Overlay</b><button class="lo-hide" title="Put these settings away (they come back when the overlay starts)">Hide</button></div>
      <div class="lo-seg"><button data-l="169">16:9</button><button data-l="1">Square</button><button data-l="916">9:16</button><button data-l="stack" title="9:16 with the minutes above the seconds, for bigger digits">9:16 stacked</button></div>
      <label><input type="checkbox" data-o="msg"> Message</label><label><input type="checkbox" data-o="bar"> Progress shade</label>
      <div class="lo-note"></div>`;
    document.body.appendChild(box);
    keysBadge = KeysBadge.create(KEYS_HINT, 'calc(var(--buttons-bottom, 56px) + 8px)');
    // Clicks here mustn't leave focus on a button: the timer's keys (Space…) must keep working
    box.addEventListener('mousedown', e => { if (e.target.closest('button, label, input')) e.preventDefault(); });
    box.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b && b.dataset.l) view.setLayout(b.dataset.l);
      else if (b && b.classList.contains('lo-hide')) return hideBox();
      syncBox(); touch();
      if (document.activeElement && box.contains(document.activeElement)) document.activeElement.blur();
    });
    box.addEventListener('change', e => {
      const o = e.target.dataset && e.target.dataset.o;
      if (o) view.setOption(o, e.target.checked);
      e.target.blur();
      touch();
    });
    box.addEventListener('pointermove', touch);
  }

  // A key pressed in the floating window goes to the timer page, as if typed there (the timer's
  // handlers, the run sheet's Page Up/Down, the deck editor… all read e.key, never keyCode)
  function forwardKeys(win) {
    for (const type of ['keydown', 'keyup']) {
      win.document.addEventListener(type, e => {
        const copy = new KeyboardEvent(type, { key: e.key, code: e.code, location: e.location, repeat: e.repeat,
          ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true });
        document.dispatchEvent(copy);
        if (copy.defaultPrevented) e.preventDefault();
      });
    }
  }

  function syncBox() {
    box.querySelectorAll('.lo-seg button').forEach(b => b.classList.toggle('on', b.dataset.l === view.layout));
    box.querySelector('[data-o=msg]').checked = view.showMsg;
    box.querySelector('[data-o=bar]').checked = view.showBar;
  }
  // Left alone for 30 s, the box fades away
  function touch() {
    clearTimeout(fadeTimer);
    box.classList.remove('lo-fading');
    fadeTimer = setTimeout(() => {
      box.classList.add('lo-fading');
      fadeTimer = setTimeout(hideBox, 1600);
    }, 30000);
  }
  function showBox() { box.querySelector('.lo-note').textContent = ''; syncBox(); box.hidden = false; touch(); }
  function hideBox() { clearTimeout(fadeTimer); box.hidden = true; box.classList.remove('lo-fading'); }

  function toggle() {
    if (!view) setup();
    const opening = !view.open;
    view.toggle();                                   // first: the window needs this key press or click
    if (opening) {
      showBox();
      if (typeof processTimerApiMessage === 'function') processTimerApiMessage({ cmd: 'opened' });   // fill in everything
      render();
    }
  }

  window.LocalOverlay = { toggle, supported: OverlayView.supported };
})();
