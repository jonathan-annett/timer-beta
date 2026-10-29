/*!
 * overlay.js
 * Timer overlay (overlay.html): a countdown that floats on top of other windows, fed by a timer on
 * another computer. Pairs by the 6-digit code the timer's share panel shows (pairing server
 * protocol 6; then the proximity check), or by an overlay link (#r=room&v=view key[&s=server]). It is a
 * view-only device: it never sends the timer anything but hello (and a PIN if asked).
 *
 * The overlay itself (drawing, Document Picture-in-Picture, the canvas fallback) is overlay-view.js,
 * shared with the timer's own overlay. It's shown here as a preview; Start overlay floats it. It's
 * redrawn when the timer sends a change (about once a second), never from animation frames, so it
 * keeps going with this window minimized.
 * MIT Licensed
 */

/* global RemotePeer, OverlayView */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
    del: k => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };
  const SAVED_LINK = 'overlay_saved_link', SERVER = 'overlay_server';
  const parse = frag => Object.fromEntries(new URLSearchParams(frag));
  const defaultServer = () => new URLSearchParams(location.search).get('remote') || store.get(SERVER) || RemotePeer.defaultServer();

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
      if (v && v !== RemotePeer.defaultServer()) store.set(SERVER, v); else store.del(SERVER);
    });
  }

  const CODE_ERRORS = {
    'bad-code': 'That code didn’t work. Codes change every 30 seconds: type the one showing now.',
    'too-many': 'Too many wrong codes. Wait a minute, then try again.',
    'no-answer': 'The timer didn’t answer. Is its share panel still open?',
    'refused': 'The timer didn’t accept this computer. Try a new code.',
  };
  function claim(code) {
    const msg = (text, kind) => { $('codemsg').textContent = text; $('codemsg').className = kind || ''; };
    msg('Checking…');
    $('code').disabled = true;
    let ws;
    try { ws = new WebSocket(RemotePeer.socketUrl($('server').value.trim() || defaultServer(), { code })); } catch (_) { msg('That pairing server address isn’t right.', 'bad'); $('code').disabled = false; return; }
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

  let ws = null, peer = null, retry = 1000, retryTimer = null, hostOnline = false, waiting = false, refused = false;
  const state = {};

  function start() {
    $('paired').hidden = false;
    $('room').textContent = link.r;
    if (link.t) store.set(tokenKey(link.r), link.t);
    setupView();
    connect();
  }

  function status(text, kind) { $('status').textContent = text; $('status').className = kind || ''; }
  let relinkUntil = 0;                             // a direct link is being retried until then (relink())
  function showMode() {
    if (waiting) return status('Waiting for the timer… (closed, or it made a new share code: then unpair and pair again)', 'warn');
    if (!ws || ws.readyState !== WebSocket.OPEN) return status('Reconnecting…', 'warn');
    if (!hostOnline) return status('The timer is offline: waiting for it…', 'warn');
    status(peer && peer.mode === 'lan' ? '⚡ Connected directly (same network)' : peer && peer.mode === 'p2p' ? '⚡ Connected directly (over the internet)' : Date.now() < relinkUntil ? 'Trying a direct link again…' : 'Connected via the server (click to try a direct link again)', 'ok');
  }
  // Another go at a direct link: the status clicked while on the server, or a new network
  function relink() {
    if (!peer || peer.mode !== 'server' || !hostOnline) return;
    peer.send({ t: 'relink' });
    relinkUntil = Date.now() + 8000;
    showMode();
    setTimeout(showMode, 8100);
  }
  $('status').addEventListener('click', relink);
  RemotePeer.retryOnNetworkChange(relink);

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
    try { ws = new WebSocket(RemotePeer.socketUrl(link.s || defaultServer(), { room: link.r })); RemotePeer.keepAlive(ws); } catch (_) { return schedule(); }
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
          else if (m.reason === 'rejected') refused = true;
          break;
      }
      showMode();
    };
    sock.onclose = () => {
      if (sock !== ws) return;
      if (peer) peer.close();
      peer = null;
      render(); showMode();
      if (refused) return status('Not let in by the timer. Reload this page to try again.', 'warn');
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
      if (!pinCode) pinCode = String(100 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900));   // 3 digits: the proximity check;
      $('pincode').textContent = pinCode; $('pinwait').hidden = false;
      if (peer) peer.send({ t: 'pin', code: pinCode, name: 'Overlay · ' + RemotePeer.deviceName() });
    } else if (m.t === 'pin-ok') {
      if (typeof m.token === 'string') store.set(tokenKey(link.r), m.token);
      pinCode = null; $('pinwait').hidden = true;
      if (peer) peer.send({ t: 'hello', token: store.get(tokenKey(link.r)) || undefined });
    } else if (m.t === 'pin-rejected' || m.t === 'revoked') {
      refused = true;                                  // the timer disconnects it: don't reconnect
      $('pinwait').hidden = false;
      $('pinmsg').textContent = m.t === 'revoked' ? 'The timer took this computer’s access away.' : 'The timer didn’t let this computer in. Reload this page to try again.'; $('pincode').textContent = '';
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

  // ─── The overlay (drawing and floating: overlay-view.js, shared with the timer's own O) ───

  let view = null;
  function setupView() {
    view = OverlayView.create({
      prefix: 'overlay_',                             // overlay_layout, overlay_msg, overlay_bar
      preview: (el, [lw, lh]) => {                    // as big as the preview box allows at this shape
        const box = $('previewbox'), k = Math.min((box.clientWidth - 24) / lw, (box.clientHeight - 24) / lh);
        el.style.width = Math.round(lw * k) + 'px'; el.style.height = Math.round(lh * k) + 'px';
      },
      onStatus: text => status(text, 'warn'),
      onChange: () => { $('previewbox').querySelector('.floating').hidden = !view.open || !('documentPictureInPicture' in window); render(); },
    });
    $('previewbox').insertBefore(view.el, $('previewbox').firstChild);
    $('opt-msg').checked = view.showMsg;
    $('opt-bar').checked = view.showBar;
    $('opt-msg').addEventListener('change', e => view.setOption('msg', e.target.checked));
    $('opt-bar').addEventListener('change', e => view.setOption('bar', e.target.checked));
    $('layout').addEventListener('click', e => {
      const b = e.target.closest('button[data-l]');
      if (b) { view.setLayout(b.dataset.l); render(); }
    });
    $('start').addEventListener('click', () => view.toggle());
    window.addEventListener('resize', render);
    render();
  }

  function render() {
    if (!view) return;
    const online = !!(ws && ws.readyState === WebSocket.OPEN && hostOnline && peer);
    view.render({
      online,
      remain: online && state.remain ? (state.over ? '+' : '') + state.remain : '–:––',
      over: state.over, impending: state.impending, paused: state.paused,
      msg: online ? String(state.msg || '').trim() || OverlayView.autoMsg(state) : '',
      pct: state.pct, bar: state.bar,                 // the shade follows the timer's B too
    });
    $('layout').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.l === view.layout));
    $('start').textContent = view.open ? 'Stop overlay' : 'Start overlay';
  }

  // Last, once everything above exists (a saved link connects straight away)
  if (link.r && link.v) start();
  else showEnter();
})();
