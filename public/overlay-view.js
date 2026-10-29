/*!
 * overlay-view.js — the countdown overlay: drawing it, and floating it on top of other windows.
 * Shared by overlay.html (fed by the timer on another computer) and the timer page itself (O,
 * local-overlay.js), so both look and behave the same.
 *
 *   const v = OverlayView.create({ prefix, preview, onStatus, onChange });
 *     prefix     localStorage prefix for its settings: <prefix>layout, <prefix>msg, <prefix>bar
 *     preview    (el, [w, h]) sizes the element while it isn't floating (optional)
 *     onStatus   (text) a problem to show (the window couldn't open…)
 *     onChange   () after it opens or closes
 *     onWindow   (win) the floating window has opened (Document PiP: e.g. to listen for keys there)
 *     keysWarning  while it floats and this page or the floating window has the keyboard (so keys
 *                aren't reaching PowerPoint underneath): a blinking red ⌨ in the corner, with this
 *                text beside it for 4 s each time it starts; checked on focus changes and every
 *                second (moving to another app isn't always reported)
 *     onKeys     (focused) when that changes, e.g. to show the page's own badge
 *   v.el                  the overlay element (id "ov"): put it where it should sit when not floating
 *   v.render(d)           d: { online, remain, over, impending, paused, msg, pct, bar } (remain as
 *                         shown, '+' included; msg already chosen: OverlayView.autoMsg() helps)
 *   v.layout, v.setLayout(l)   '169' | '1' | '916' | 'stack'; during a click it also resizes the window
 *   v.showMsg, v.showBar, v.setOption('msg' | 'bar', on)   this screen's own switches (the shade
 *                         also needs d.bar, the timer's B)
 *   v.toggle()            opens or closes the floating window (needs a click or key press)
 *   v.open                true while it floats
 *
 * Document Picture-in-Picture moves the element itself into the floating window, where it keeps
 * updating; without it, it's drawn on a canvas played as a picture-in-picture video. Drawing
 * happens only in render(), never on animation frames, so it keeps going in a hidden page.
 * MIT Licensed
 */
var OverlayView = (function () {
  'use strict';

  const CSS = `
    #ov { position: relative; overflow: hidden; background: #000; color: #fff; display: flex; flex-direction: column;
      font-family: "Helvetica Neue", Arial, sans-serif; font-weight: bold; font-variant-numeric: tabular-nums; }
    #ov.l-169 { aspect-ratio: 16 / 9; } #ov.l-1 { aspect-ratio: 1; } #ov.l-916, #ov.l-stack { aspect-ratio: 9 / 16; }
    #ov.fill { width: 100vw; height: 100vh; aspect-ratio: auto; }
    #ov .ov-shade { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: rgba(255, 255, 255, .13); }
    #ov:not(.bar) .ov-shade { display: none; }
    #ov .ov-msg { position: relative; flex: 0 0 22%; display: flex; align-items: center; justify-content: center; white-space: nowrap; padding: 0 3%; color: #ffd75e; }
    #ov.l-916 .ov-msg, #ov.l-stack .ov-msg { flex-basis: 12%; }
    #ov:not(.msg) .ov-msg, #ov.nomsg .ov-msg { display: none; }
    #ov .ov-remain { position: relative; flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; white-space: nowrap; }
    #ov span { line-height: 1; }
    /* 9:16 stacked: minutes over seconds (hours over minutes:seconds from an hour) */
    #ov.l-stack .ov-remain { flex-direction: column; }
    #ov .ov-remain .r2 { display: none; }
    #ov.l-stack .ov-remain .r2 { display: inline; }
    #ov.impending .ov-remain { color: #ffa500; } #ov.impending .ov-shade { background: rgba(255, 165, 0, .18); }
    #ov.over { background: #2a0000; } #ov.over .ov-remain { color: #ff4d4d; } #ov.over .ov-shade { background: rgba(255, 77, 77, .2); }
    #ov.paused .ov-remain { color: #888; }
    #ov.offline .ov-remain { color: #444; }
    #ov .ov-warn { position: absolute; left: 3%; top: 4%; height: 15%; aspect-ratio: 1.35; display: none; align-items: center; justify-content: center;
      background: #c62828; color: #fff; border-radius: 14%; animation: ov-blink 1s steps(1) infinite; z-index: 2; }
    #ov.warn .ov-warn { display: flex; }
    #ov .ov-tip { position: absolute; left: 3%; right: 3%; top: 23%; height: 11%; display: none; align-items: center; justify-content: center;
      background: rgba(198, 40, 40, .92); color: #fff; border-radius: 6px; white-space: nowrap; transition: opacity 1s; z-index: 2; }
    #ov.warn.tip .ov-tip { display: flex; }
    #ov .ov-tip.fading { opacity: 0; }
    @keyframes ov-blink { 50% { opacity: .2; } }`;

  const LAYOUTS = { 169: [480, 270], 1: [320, 320], 916: [270, 480], stack: [270, 480] };   // floating window size (px)
  // Stacked: "12:34" → "12" over "34"; from an hour, "1:23:59" → "1 hr" over "23:59" ("+" kept in overtime)
  function splitRemain(r) {
    const m = r.match(/^([+-]?)(\d+):(\d+):(\d+)$/);
    if (m) return [m[1] + Number(m[2]) + ' hr', m[3] + ':' + m[4]];
    const i = r.lastIndexOf(':');
    return i < 0 ? [r, ''] : [r.slice(0, i), r.slice(i + 1)];
  }
  const hourStack = r => /^[+-]?\d+:\d+:\d+$/.test(r);   // its two lines differ in length: each sized on its own

  // The timer's own notices, as its presenter screen shows them (timer.css #remain_info_message),
  // for when its messages switch (M) is on and no message of the operator's is up.
  // s: { msgs, paused, over, impending }
  function autoMsg(s) {
    if (!s.msgs) return '';
    return s.paused ? 'Paused' : s.over ? 'Time is Up' : s.impending ? 'Wrap up - last minute' : '';
  }

  // Largest font at which each span's text fits a box of w × h (both ways); spans given together
  // share one size (the stacked lines match)
  function fit(spans, w, h) {
    spans = spans.filter(s => s.textContent);
    if (!w || !h || !spans.length) return;
    let k = Infinity;
    for (const s of spans) {
      s.style.fontSize = '100px';
      const r = s.getBoundingClientRect();
      if (!r.width || !r.height) return;
      k = Math.min(k, w * 0.94 / r.width, h * 0.92 / r.height);
    }
    spans.forEach(s => { s.style.fontSize = Math.max(6, Math.floor(100 * k)) + 'px'; });
  }

  function addCss(doc, extra) {
    const st = doc.createElement('style');
    st.textContent = CSS + (extra || '');
    doc.head.appendChild(st);
  }
  let cssAdded = false;

  function create(opts) {
    opts = opts || {};
    const prefix = opts.prefix || 'overlay_';
    const store = {
      get: k => { try { return localStorage.getItem(prefix + k); } catch (_) { return null; } },
      set: (k, v) => { try { localStorage.setItem(prefix + k, v); } catch (_) { /* private mode */ } },
    };
    if (!cssAdded) { addCss(document); cssAdded = true; }
    const el = document.createElement('div');
    el.id = 'ov';
    el.className = 'l-169 offline';
    el.innerHTML = '<div class="ov-shade"></div><div class="ov-msg"><span></span></div><div class="ov-remain"><span class="r1">–:––</span><span class="r2"></span></div><div class="ov-warn"><span>⌨</span></div><div class="ov-tip"><span></span></div>';

    let layout = LAYOUTS[store.get('layout')] ? store.get('layout') : '169';
    let showMsg = store.get('msg') !== '0', showBar = store.get('bar') !== '0';
    let pip = null, home = null;                   // the Document Picture-in-Picture window; where el sat before
    let video = null, canvas = null;               // or the video fallback
    let last = { online: false, remain: '–:––', msg: '', pct: 0 }, warning = '';
    const status = t => { if (opts.onStatus) opts.onStatus(t); };
    const changed = () => { if (opts.onChange) opts.onChange(); };
    const videoOpen = () => !!video && document.pictureInPictureElement === video;

    function render(d) {
      if (d) last = d;
      d = last;
      const msgOn = showMsg && !!d.msg, barOn = showBar && !!d.bar;
      el.className = 'l-' + layout + (pip ? ' fill' : '');
      el.classList.toggle('msg', showMsg);
      el.classList.toggle('nomsg', !d.msg);
      el.classList.toggle('bar', barOn);
      el.classList.toggle('offline', !d.online);
      el.classList.toggle('over', !!d.online && !!d.over);
      el.classList.toggle('impending', !!d.online && !!d.impending && !d.over);
      el.classList.toggle('paused', !!d.online && !!d.paused);
      el.classList.toggle('warn', !!warning);
      el.classList.toggle('tip', !!warning && tipOn);
      const pct = d.online && isFinite(d.pct) ? Math.max(0, Math.min(100, Number(d.pct))) : 0;
      el.querySelector('.ov-shade').style.width = pct + '%';
      el.querySelector('.ov-msg span').textContent = d.msg || '';
      const remain = d.remain || '–:––', stack = layout === 'stack', [r1, r2] = stack ? splitRemain(remain) : [remain, ''];
      el.querySelector('.ov-remain .r1').textContent = r1;
      el.querySelector('.ov-remain .r2').textContent = r2;
      if (pip) { el.style.width = ''; el.style.height = ''; }
      else if (opts.preview) opts.preview(el, LAYOUTS[layout]);
      // Fit the text to the boxes it's in now (the page or the floating window)
      const msgBox = el.querySelector('.ov-msg'), remBox = el.querySelector('.ov-remain');
      if (msgOn) fit([msgBox.firstChild], msgBox.clientWidth, msgBox.clientHeight);
      if (stack && hourStack(remain)) [remBox.querySelector('.r1'), remBox.querySelector('.r2')].forEach(s => fit([s], remBox.clientWidth, remBox.clientHeight / 2));
      else if (stack) fit([remBox.querySelector('.r1'), remBox.querySelector('.r2')], remBox.clientWidth, remBox.clientHeight / 2);
      else fit([remBox.querySelector('.r1')], remBox.clientWidth, remBox.clientHeight);
      if (warning) {
        const k = el.querySelector('.ov-warn'), tip = el.querySelector('.ov-tip');
        fit([k.firstChild], k.clientWidth, k.clientHeight);
        tip.firstChild.textContent = warning;
        if (tipOn) fit([tip.firstChild], tip.clientWidth * 0.94, tip.clientHeight);
      }
      if (canvas) drawCanvas(d, remain, pct, msgOn, barOn);
    }

    function setLayout(l) {
      if (!LAYOUTS[l]) return;
      layout = l; store.set('layout', l);
      if (pip) {          // a script may resize the floating window only during a click
        const [w, h] = LAYOUTS[l];
        try { pip.resizeTo(w + (pip.outerWidth - pip.innerWidth), h + (pip.outerHeight - pip.innerHeight)); } catch (_) { /* not allowed */ }
      }
      if (canvas) { const [w, h] = LAYOUTS[l]; canvas.width = w * 2; canvas.height = h * 2; }
      render();
    }
    // While it floats: does this page or the floating window have the keyboard?
    let keysTimer = null, keysOn = null, tipOn = false, tipTimer = null;
    // The words beside the ⌨, for a few seconds each time the keyboard comes here
    function showTip() {
      clearTimeout(tipTimer);
      tipOn = true;
      el.querySelector('.ov-tip').classList.remove('fading');
      tipTimer = setTimeout(() => {
        el.querySelector('.ov-tip').classList.add('fading');
        tipTimer = setTimeout(() => { tipOn = false; render(); }, 1000);
      }, 4000);
    }
    function checkKeys() {
      let focused = false;
      if (opts.keysWarning && (pip || videoOpen())) {
        try { focused = document.hasFocus() || !!(pip && pip.document.hasFocus()); } catch (_) { focused = document.hasFocus(); }
      }
      const text = focused ? opts.keysWarning : '';
      if (text !== warning) {
        warning = text;
        if (text) showTip(); else { clearTimeout(tipTimer); tipOn = false; }
        render();
      }
      if (focused !== keysOn) { keysOn = focused; if (opts.onKeys) opts.onKeys(focused); }
    }
    const checkSoon = () => setTimeout(checkKeys, 0);   // (on blur, focus may be moving to the other window)
    function watchKeys() {
      clearInterval(keysTimer);
      window.removeEventListener('focus', checkKeys);
      window.removeEventListener('blur', checkSoon);
      if (opts.keysWarning && (pip || videoOpen())) {
        keysTimer = setInterval(checkKeys, 1000);
        window.addEventListener('focus', checkKeys);
        window.addEventListener('blur', checkSoon);
      }
      checkKeys();
    }
    function setOption(name, on) {
      if (name === 'msg') showMsg = !!on; else if (name === 'bar') showBar = !!on; else return;
      store.set(name, on ? '1' : '0');
      render();
    }

    async function toggle() {
      if (pip) { pip.close(); return; }
      if (videoOpen()) { document.exitPictureInPicture(); return; }
      const [w, h] = LAYOUTS[layout];
      if ('documentPictureInPicture' in window) {
        try {
          pip = await window.documentPictureInPicture.requestWindow({ width: w, height: h });
        } catch (err) { pip = null; status('Couldn’t open the floating window: ' + err.message); return; }
        addCss(pip.document, ' html, body { margin: 0; background: #000; overflow: hidden; }');
        pip.document.title = 'Timer';
        home = { parent: el.parentNode, next: el.nextSibling };
        pip.document.body.appendChild(el);                 // the same element: it keeps updating
        pip.addEventListener('resize', () => render());
        pip.addEventListener('focus', checkKeys);
        pip.addEventListener('blur', checkSoon);
        if (opts.onWindow) opts.onWindow(pip);
        pip.addEventListener('pagehide', () => {
          if (home && home.parent) home.parent.insertBefore(el, home.next && home.next.parentNode === home.parent ? home.next : null);
          pip = null;
          watchKeys(); render(); changed();
        });
        watchKeys(); render(); changed();
        return;
      }
      // Fallback: the overlay drawn on a canvas, played as a picture-in-picture video
      if (!document.pictureInPictureEnabled) { status('This browser can’t float a window on top. Use Chrome or Edge.'); return; }
      if (!canvas) {
        canvas = document.createElement('canvas');
        video = document.createElement('video');
        video.muted = true; video.playsInline = true;
        video.srcObject = canvas.captureStream();
        video.addEventListener('enterpictureinpicture', () => { watchKeys(); changed(); });
        video.addEventListener('leavepictureinpicture', () => { watchKeys(); render(); changed(); });
      }
      canvas.width = w * 2; canvas.height = h * 2;
      render();
      try { await video.play(); await video.requestPictureInPicture(); } catch (err) { status('Couldn’t start the overlay: ' + err.message); }
      render();
    }

    const FONT = 'bold {px}px "Helvetica Neue", Arial, sans-serif';
    function drawCanvas(d, remain, pct, msgOn, barOn) {
      const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
      const over = d.online && d.over, imp = d.online && d.impending && !over, paused = d.online && d.paused;
      c.fillStyle = over ? '#2a0000' : '#000'; c.fillRect(0, 0, W, H);
      if (barOn) { c.fillStyle = over ? 'rgba(255,77,77,.2)' : imp ? 'rgba(255,165,0,.18)' : 'rgba(255,255,255,.13)'; c.fillRect(0, 0, W * pct / 100, H); }
      let top = 0;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const fitPx = (text, w, h) => { c.font = FONT.replace('{px}', 100); return Math.max(6, Math.floor(100 * Math.min(w * 0.94 / c.measureText(text).width, h * 0.92 / 100))); };
      if (msgOn) {
        top = H * (layout === '916' || layout === 'stack' ? 0.12 : 0.22);
        c.font = FONT.replace('{px}', fitPx(d.msg, W * 0.94, top)); c.fillStyle = '#ffd75e';
        c.fillText(d.msg, W / 2, top / 2);
      }
      c.fillStyle = !d.online ? '#444' : over ? '#ff4d4d' : imp ? '#ffa500' : paused ? '#888' : '#fff';
      if (layout === 'stack') {
        const lines = splitRemain(remain).filter(Boolean), h2 = (H - top) / 2;
        const shared = Math.min(...lines.map(l => fitPx(l, W, h2))), own = hourStack(remain);
        lines.forEach((l, i) => {
          c.font = FONT.replace('{px}', own ? fitPx(l, W, h2) : shared);
          c.fillText(l, W / 2, top + h2 * (lines.length === 1 ? 1 : i + 0.5));
        });
      } else {
        c.font = FONT.replace('{px}', fitPx(remain, W, H - top));
        c.fillText(remain, W / 2, top + (H - top) / 2);
      }
      if (warning && Math.floor(Date.now() / 500) % 2 === 0) {      // a blinking ⌨ (redrawn twice a second at most)
        const kh = H * 0.15, kw = kh * 1.35, kx = W * 0.03, ky = H * 0.04;
        c.fillStyle = '#c62828'; c.fillRect(kx, ky, kw, kh);
        c.fillStyle = '#fff'; c.font = FONT.replace('{px}', Math.floor(kh * 0.8));
        c.fillText('⌨', kx + kw / 2, ky + kh / 2);
      }
      if (warning && tipOn) {
        const th = H * 0.11, ty = H * 0.23;
        c.fillStyle = 'rgba(198,40,40,.92)'; c.fillRect(W * 0.03, ty, W * 0.94, th);
        c.fillStyle = '#fff'; c.font = FONT.replace('{px}', fitPx(warning, W * 0.9, th));
        c.fillText(warning, W / 2, ty + th / 2);
      }
    }

    return {
      el, render, setLayout, setOption, toggle,
      get layout() { return layout; }, get showMsg() { return showMsg; }, get showBar() { return showBar; },
      get open() { return !!pip || videoOpen(); },
    };
  }

  const supported = () => 'documentPictureInPicture' in window || !!document.pictureInPictureEnabled;
  return { create, autoMsg, supported, LAYOUTS };
})();
