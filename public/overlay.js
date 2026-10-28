/*!
 * overlay.js
 * Timer overlay (overlay.html): a countdown that floats on top of other windows, fed by a timer on
 * another computer. Pairs by the 6-digit code the timer's share panel shows (pairing server
 * protocol 6; same network only), or by an overlay link (#r=room&v=view key[&s=server]). It is a
 * view-only device: it never sends the timer anything but hello (and a PIN if asked).
 *
 * The overlay (#ov) is shown in the page as a preview; Start overlay moves it into a Document
 * Picture-in-Picture window (Chrome/Edge: a real page, resizable, always on top), or, where that
 * doesn't exist, draws it on a canvas played as a picture-in-picture video. It's redrawn when
 * the timer sends a change (about once a second), never from animation frames, so it keeps going
 * with this window minimized.
 * MIT Licensed
 */

/* global RemotePeer */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
    del: k => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };
  const SAVED_LINK = 'overlay_saved_link', SERVER = 'overlay_server', LAYOUT = 'overlay_layout', OPT_MSG = 'overlay_msg', OPT_BAR = 'overlay_bar';
  const parse = frag => Object.fromEntries(new URLSearchParams(frag));
  const defaultServer = () => new URLSearchParams(location.search).get('remote') || store.get(SERVER) || `wss://${location.hostname}:8443/`;

  // ─── Which timer: a link in the address, the one saved, or pair by code ───

  let link = parse(location.hash.slice(1));
  if (link.r && link.v) { store.set(SAVED_LINK, location.hash.slice(1)); history.replaceState(null, '', location.pathname + location.search); }
  else link = parse(store.get(SAVED_LINK) || '');
  const tokenKey = room => 'overlay_token_' + room;

  function showEnter() {
    $('enter').hidden = false;
    $('server').value = defaultServer();
    $('code').focus();
    $('code').addEventListener('input', () => {
      const v = $('code').value.replace(/\D/g, '').slice(0, 6);
      $('code').value = v;
      if (v.length === 6) claim(v);
    });
    $('server').addEventListener('change', () => {
      const v = $('server').value.trim();
      if (v && v !== `wss://${location.hostname}:8443/`) store.set(SERVER, v); else store.del(SERVER);
    });
  }

  const CODE_ERRORS = {
    'bad-code': 'That code didn’t work. Codes change every 30 seconds: type the one showing now.',
    'other-network': 'This computer doesn’t seem to be on the same network as the timer. On the timer, copy the overlay link instead (or join the same network).',
    'too-many': 'Too many wrong codes. Wait a minute, then try again.',
    'no-answer': 'The timer didn’t answer. Is its share panel still open?',
    'refused': 'The timer didn’t accept this computer. Try a new code.',
  };
  function claim(code) {
    const msg = (text, kind) => { $('codemsg').textContent = text; $('codemsg').className = kind || ''; };
    msg('Checking…');
    $('code').disabled = true;
    let ws;
    try { ws = new WebSocket($('server').value.trim() || defaultServer()); } catch (_) { msg('That pairing server address isn’t right.', 'bad'); $('code').disabled = false; return; }
    let done = false;
    const fail = text => { if (done) return; done = true; msg(text, 'bad'); $('code').disabled = false; $('code').value = ''; $('code').focus(); try { ws.close(); } catch (_) { /* gone */ } };
    ws.onopen = () => ws.send(JSON.stringify({ type: 'claim', code }));
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.type === 'claim-wait') msg('Found it. Connecting…', 'ok');
      else if (m.type === 'granted') {
        const l = parse(m.frag);
        if (!l.r || !l.v) return fail('The timer sent something unexpected. Try again.');
        done = true;
        store.set(SAVED_LINK, m.frag);
        link = l;
        $('enter').hidden = true;
        start();
      } else if (m.type === 'error') fail(CODE_ERRORS[m.reason] || 'Pairing failed: ' + m.reason);
    };
    ws.onclose = () => fail('Couldn’t reach the pairing server. Check the address under “Pairing server”.');
    ws.onerror = () => {};
  }

  // ─── Connection (as a view-only display) ──────────────────────────────────

  let ws = null, peer = null, retry = 1000, retryTimer = null, hostOnline = false, waiting = false;
  const state = {};

  function start() {
    $('paired').hidden = false;
    $('room').textContent = link.r;
    if (link.t) store.set(tokenKey(link.r), link.t);
    setupView();
    connect();
  }

  function status(text, kind) { $('status').textContent = text; $('status').className = kind || ''; }
  function showMode() {
    if (waiting) return status('Waiting for the timer… (closed, or it made a new share code: then unpair and pair again)', 'warn');
    if (!ws || ws.readyState !== WebSocket.OPEN) return status('Reconnecting…', 'warn');
    if (!hostOnline) return status('The timer is offline: waiting for it…', 'warn');
    status(peer && peer.mode === 'lan' ? '⚡ Connected directly (same network)' : 'Connected via the server', 'ok');
  }

  function newPeer() {
    if (peer) peer.close();
    peer = RemotePeer.create({
      initiator: false,
      relay: msg => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'up', msg })); },
      onMessage,
      onModeChange: showMode,
    });
    peer.send({ t: 'hello', token: store.get(tokenKey(link.r)) || undefined });
  }

  function connect() {
    clearTimeout(retryTimer);
    try { ws = new WebSocket(link.s || defaultServer()); } catch (_) { return schedule(); }
    const sock = ws;
    sock.onopen = () => sock.send(JSON.stringify({ type: 'join', room: link.r, key: link.v }));
    sock.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      switch (m.type) {
        case 'joined': hostOnline = m.hostOnline; waiting = false; retry = 1000; newPeer(); break;
        case 'down': if (peer) peer.receive(m.msg); break;
        case 'host-offline': hostOnline = false; if (peer) peer.close(); peer = null; render(); break;
        case 'host-online': hostOnline = true; newPeer(); break;
        case 'error':
          // Gone while the timer is closed (or the server restarted): it comes back with the same
          // room. If the timer made a New code it never does: unpair and pair again.
          if (m.reason === 'not-found' || m.reason === 'room-closed') { waiting = true; retry = 15000; }
          break;
      }
      showMode();
    };
    sock.onclose = () => {
      if (sock !== ws) return;
      if (peer) peer.close();
      peer = null;
      render(); showMode();
      schedule();
    };
    sock.onerror = () => {};
  }
  function schedule() {
    retryTimer = setTimeout(connect, retry);
    if (!waiting) retry = Math.min(retry * 2, 10000);
  }

  let pinCode = null;
  function onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'pin-required') {
      if (!pinCode) pinCode = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
      $('pincode').textContent = pinCode; $('pinwait').hidden = false;
      if (peer) peer.send({ t: 'pin', code: pinCode });
    } else if (m.t === 'pin-ok') {
      if (typeof m.token === 'string') store.set(tokenKey(link.r), m.token);
      pinCode = null; $('pinwait').hidden = true;
      if (peer) peer.send({ t: 'hello', token: store.get(tokenKey(link.r)) || undefined });
    } else if (m.t === 'pin-rejected') {
      $('pinmsg').textContent = 'The timer didn’t let this computer in.'; $('pincode').textContent = '';
    } else if (m.t === 'state' && m.s && typeof m.s === 'object') {
      if (m.full) for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, m.s);
      render();
    }
  }

  $('unpair').addEventListener('click', () => {
    store.del(SAVED_LINK);
    if (link.r) store.del(tokenKey(link.r));
    location.reload();
  });

  // ─── The overlay ──────────────────────────────────────────────────────────

  const ov = $('ov');
  const LAYOUTS = { 169: [480, 270], 1: [320, 320], 916: [270, 480] };   // floating window size (px)
  let layout = LAYOUTS[store.get(LAYOUT)] ? store.get(LAYOUT) : '169';
  let pip = null;                                    // the Document Picture-in-Picture window
  let video = null, canvas = null;                   // or the video fallback

  function setupView() {
    $('opt-msg').checked = store.get(OPT_MSG) !== '0';
    $('opt-bar').checked = store.get(OPT_BAR) !== '0';
    $('opt-msg').addEventListener('change', e => { store.set(OPT_MSG, e.target.checked ? '1' : '0'); render(); });
    $('opt-bar').addEventListener('change', e => { store.set(OPT_BAR, e.target.checked ? '1' : '0'); render(); });
    $('layout').addEventListener('click', e => {
      const b = e.target.closest('button[data-l]');
      if (!b) return;
      layout = b.dataset.l; store.set(LAYOUT, layout);
      if (pip) pip.resizeTo && tryResize();
      render();
    });
    $('start').addEventListener('click', startOverlay);
    window.addEventListener('resize', render);
    render();
  }
  function tryResize() {
    // A script may resize the floating window only during a click; the layout buttons are one
    const [w, h] = LAYOUTS[layout];
    try { pip.resizeTo(w + (pip.outerWidth - pip.innerWidth), h + (pip.outerHeight - pip.innerHeight)); } catch (_) { /* not allowed */ }
  }

  // Largest font at which the span's text fits its box (both ways)
  function fit(box, span, w, h) {
    if (!w || !h || !span.textContent) return;
    span.style.fontSize = '100px';
    const r = span.getBoundingClientRect();
    if (!r.width || !r.height) return;
    span.style.fontSize = Math.max(6, Math.floor(100 * Math.min(w * 0.94 / r.width, h * 0.92 / r.height))) + 'px';
  }

  function texts() {
    const online = !!(ws && ws.readyState === WebSocket.OPEN && hostOnline && peer);
    return {
      online,
      remain: online && state.remain ? (state.over ? '+' : '') + state.remain : '–:––',
      msg: online ? String(state.msg || '').trim() : '',
      pct: online && isFinite(state.pct) ? Math.max(0, Math.min(100, Number(state.pct))) : 0,
    };
  }

  function render() {
    const t = texts();
    const showMsg = $('opt-msg').checked, showBar = $('opt-bar').checked;
    ov.className = 'l-' + layout;
    if (pip) ov.classList.add('fill');
    ov.classList.toggle('msg', showMsg);
    ov.classList.toggle('nomsg', !t.msg);
    ov.classList.toggle('bar', showBar);
    ov.classList.toggle('offline', !t.online);
    ov.classList.toggle('over', t.online && !!state.over);
    ov.classList.toggle('impending', t.online && !!state.impending && !state.over);
    ov.classList.toggle('paused', t.online && !!state.paused);
    ov.querySelector('.ov-shade').style.width = t.pct + '%';
    ov.querySelector('.ov-msg span').textContent = t.msg;
    ov.querySelector('.ov-remain span').textContent = t.remain;
    $('layout').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.l === layout));
    // Preview size: as big as the box allows at this shape
    if (!pip) {
      const box = $('previewbox'), [lw, lh] = LAYOUTS[layout];
      const s = Math.min((box.clientWidth - 24) / lw, (box.clientHeight - 24) / lh);
      ov.style.width = Math.round(lw * s) + 'px'; ov.style.height = Math.round(lh * s) + 'px';
    } else { ov.style.width = ''; ov.style.height = ''; }
    // Fit the text to the boxes it's in now (the page or the floating window)
    const msgBox = ov.querySelector('.ov-msg'), remBox = ov.querySelector('.ov-remain');
    if (showMsg && t.msg) fit(msgBox, msgBox.firstChild, msgBox.clientWidth, msgBox.clientHeight);
    fit(remBox, remBox.firstChild, remBox.clientWidth, remBox.clientHeight);
    if (canvas) drawCanvas(t, showMsg, showBar);
    $('start').textContent = pip || (video && document.pictureInPictureElement === video) ? 'Stop overlay' : 'Start overlay';
  }

  // ─── Floating window ──────────────────────────────────────────────────────

  async function startOverlay() {
    if (pip) { pip.close(); return; }
    if (video && document.pictureInPictureElement === video) { document.exitPictureInPicture(); return; }
    const [w, h] = LAYOUTS[layout];
    if ('documentPictureInPicture' in window) {
      try {
        pip = await window.documentPictureInPicture.requestWindow({ width: w, height: h });
      } catch (err) { status('Couldn’t open the floating window: ' + err.message, 'warn'); return; }
      const st = pip.document.createElement('style');
      st.textContent = $('ov-css').textContent + ' html, body { margin: 0; background: #000; overflow: hidden; }';
      pip.document.head.appendChild(st);
      pip.document.title = 'Timer';
      pip.document.body.appendChild(ov);                 // the same element: it keeps updating
      $('previewbox').querySelector('.floating').hidden = false;
      pip.addEventListener('resize', render);
      pip.addEventListener('pagehide', () => {
        $('previewbox').insertBefore(ov, $('previewbox').firstChild);
        $('previewbox').querySelector('.floating').hidden = true;
        pip = null;
        render();
      });
      render();
      return;
    }
    // Fallback: the overlay drawn on a canvas, played as a picture-in-picture video
    if (!document.pictureInPictureEnabled) { status('This browser can’t float a window on top. Use Chrome or Edge.', 'warn'); return; }
    if (!canvas) {
      canvas = document.createElement('canvas');
      video = document.createElement('video');
      video.muted = true; video.playsInline = true;
      video.srcObject = canvas.captureStream();
      video.addEventListener('leavepictureinpicture', render);
    }
    canvas.width = w * 2; canvas.height = h * 2;
    render();
    try { await video.play(); await video.requestPictureInPicture(); } catch (err) { status('Couldn’t start the overlay: ' + err.message, 'warn'); }
    render();
  }

  const FONT = 'bold {px}px "Helvetica Neue", Arial, sans-serif';
  function drawCanvas(t, showMsg, showBar) {
    const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    const over = t.online && state.over, imp = t.online && state.impending && !over, paused = t.online && state.paused;
    c.fillStyle = over ? '#2a0000' : '#000'; c.fillRect(0, 0, W, H);
    if (showBar) { c.fillStyle = over ? 'rgba(255,77,77,.2)' : imp ? 'rgba(255,165,0,.18)' : 'rgba(255,255,255,.13)'; c.fillRect(0, 0, W * t.pct / 100, H); }
    let top = 0;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const fitPx = (text, w, h) => { c.font = FONT.replace('{px}', 100); return Math.max(6, Math.floor(100 * Math.min(w * 0.94 / c.measureText(text).width, h * 0.92 / 100))); };
    if (showMsg && t.msg) {
      top = H * (layout === '916' ? 0.12 : 0.22);
      c.font = FONT.replace('{px}', fitPx(t.msg, W * 0.94, top)); c.fillStyle = '#ffd75e';
      c.fillText(t.msg, W / 2, top / 2);
    }
    c.font = FONT.replace('{px}', fitPx(t.remain, W, H - top));
    c.fillStyle = !t.online ? '#444' : over ? '#ff4d4d' : imp ? '#ffa500' : paused ? '#888' : '#fff';
    c.fillText(t.remain, W / 2, top + (H - top) / 2);
  }

  // Last, once everything above exists (a saved link connects straight away)
  if (link.r && link.v) start();
  else showEnter();
})();
