/*!
 * remote-phone.js  (EXPERIMENTAL)
 * Phone side of remote control: joins the timer's room on the pairing server, tries a
 * direct LAN link (RemotePeer), shows the timer's state and sends commands.
 * MIT Licensed
 */

/* global RemotePeer */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  // Link: #r=<room>&k=<key>[&s=<server>]; the server defaults to wss://<this host>:8443/.
  // (Long names server/room/key from older links still work.)
  const h = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  const cfg = {
    server: h.s || h.server || `wss://${location.hostname}:8443/`,
    room: h.r || h.room,
    key: h.k || h.key,
  };
  if (!cfg.room || !cfg.key) {
    $('blocked').hidden = false;
    $('blocked').textContent = 'Open this page by scanning the QR code in the timer’s “phone” panel.';
    return;
  }
  $('app').hidden = false;

  let ws = null, peer = null, retry = 1000, retryTimer = null, hostOnline = false, fatal = false;
  const state = {};

  // ─── Connection ──────────────────────────────────────────────────────────

  function setBadge(kind, text, note) {
    const b = $('link-badge');
    b.className = kind;
    b.textContent = text;
    $('note').textContent = note || '';
  }
  function showMode() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return setBadge('off', 'reconnecting…');
    if (!hostOnline) return setBadge('off', 'timer offline', 'waiting for the timer…');
    if (peer && peer.mode === 'lan') setBadge('lan', '⚡ LAN direct');
    else setBadge('server', 'via server', 'not on the same Wi-Fi');
  }

  function newPeer() {
    if (peer) peer.close();
    peer = RemotePeer.create({
      initiator: false,
      relay: msg => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'up', msg })); },
      onMessage,
      onModeChange: showMode,
    });
    peer.send({ t: 'hello' });                  // goes through the server until the LAN link is up
  }

  function connect() {
    clearTimeout(retryTimer);
    if (fatal) return;
    try { ws = new WebSocket(cfg.server); } catch (_) { return schedule(); }
    const sock = ws;
    sock.onopen = () => { retry = 1000; sock.send(JSON.stringify({ type: 'join', room: cfg.room, key: cfg.key })); };
    sock.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      switch (m.type) {
        case 'joined': hostOnline = m.hostOnline; newPeer(); break;
        case 'down': if (peer) peer.receive(m.msg); break;
        case 'host-offline': hostOnline = false; if (peer) peer.close(); peer = null; break;
        case 'host-online': hostOnline = true; newPeer(); break;     // the timer reconnected: start a fresh link
        case 'error':
          if (m.reason === 'not-found' || m.reason === 'room-closed') {
            fatal = true;
            setBadge('off', 'expired', 'scan the QR code again');
          } else if (m.reason === 'room-full') {
            fatal = true; setBadge('off', 'too many phones');
          }
          break;
      }
      showMode();
    };
    sock.onclose = () => {
      if (sock !== ws) return;
      if (peer) peer.close();
      peer = null;
      showMode();
      if (!fatal) schedule();
    };
    sock.onerror = () => {};
  }
  function schedule() {
    retryTimer = setTimeout(connect, retry);
    retry = Math.min(retry * 2, 10000);
  }

  // Phones drop connections when the screen locks; reconnect straight away on return
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestWakeLock();
      if (!ws || ws.readyState > WebSocket.OPEN) { retry = 1000; connect(); }
    }
  });

  // Keep the screen on while this page is open (where supported)
  let wakeLock = null;
  async function requestWakeLock() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.onrelease = () => { wakeLock = null; }; } }
    catch (_) { /* not allowed right now */ }
  }

  // ─── State from the timer ────────────────────────────────────────────────

  function onMessage(m) {
    if (!m || m.t !== 'state' || typeof m.s !== 'object') return;
    if (m.full) for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, m.s);
    render();
  }

  function render() {
    $('remain').textContent = (state.over ? '+' : '') + (state.remain || '–:––');
    document.body.classList.toggle('over', !!state.over);
    document.body.classList.toggle('impending', !!state.impending && !state.over);
    document.body.classList.toggle('paused', !!state.paused);
    $('substate').textContent = state.paused ? 'Paused' : (state.adjUp || state.adjDown) ? 'Adjusting…' : (state.def ? 'Default ' + state.def : '');
    $('pause').textContent = state.paused ? 'Resume' : 'Pause';
    $('catchup').disabled = !(state.adjUp || state.adjDown);
    $('catchup').classList.toggle('on', !!(state.adjUp || state.adjDown));

    const msg = state.msg || '';
    $('msgtext').textContent = msg || 'No message on screen';
    $('msgbox').classList.toggle('empty', !msg);
    $('msgclear').disabled = !msg;

    $('rs').hidden = !state.rsOn;
    if (state.rsOn) {
      $('rsnow').textContent = state.rsNow || '—';
      $('rsnext').textContent = state.rsNext || '—';
      const late = state.rsLate;
      const st = $('rsstatus');
      st.textContent = state.rsStatus ? (late == null ? state.rsStatus : late >= 30 ? state.rsStatus + ' behind' : late <= -30 ? state.rsStatus + ' ahead' : state.rsStatus) : '';
      st.className = 'status' + (late >= 30 ? ' behind' : late <= -30 ? ' ahead' : '');
      $('rsback').disabled = !state.rsBack;
      $('rsnextbtn').disabled = !state.rsNext;
    }
  }

  // ─── Controls ────────────────────────────────────────────────────────────

  const cmd = (name, extra) => { if (peer) peer.send(Object.assign({ t: 'cmd', cmd: name }, extra || {})); };

  // Destructive buttons need a second tap within 2 s (a pocket tap shouldn't restart a talk)
  function confirmTap(btn, action) {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('armed')) {
        btn.classList.remove('armed'); btn.textContent = btn.dataset.label;
        clearTimeout(btn._t); action();
        return;
      }
      btn.dataset.label = btn.dataset.label || btn.textContent;
      btn.classList.add('armed'); btn.textContent = 'Tap again';
      btn._t = setTimeout(() => { btn.classList.remove('armed'); btn.textContent = btn.dataset.label; }, 2000);
    });
  }

  confirmTap($('restart'), () => cmd('restart'));
  $('pause').addEventListener('click', () => cmd('pause'));
  $('minus').addEventListener('click', () => cmd('adjust', { addtime: false, msecs: 60000 }));
  $('plus').addEventListener('click', () => cmd('adjust', { addtime: true, msecs: 60000 }));
  $('catchup').addEventListener('click', () => cmd('catchup'));
  $('rsnextbtn').addEventListener('click', () => cmd('runsheetnext'));
  $('rsback').addEventListener('click', () => cmd('runsheetprev'));
  $('msgclear').addEventListener('click', () => cmd('custommessage', { text: '' }));
  const sendMsg = () => {
    const t = $('msginput').value.trim();
    if (!t) return;
    cmd('custommessage', { text: t });
    $('msginput').value = '';
    $('msginput').blur();
  };
  $('msgsend').addEventListener('click', sendMsg);
  $('msginput').addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });

  for (const min of [5, 10, 15, 20, 30, 45, 60, 90]) {
    const b = document.createElement('button');
    b.textContent = min < 60 ? min + ' min' : (min / 60) + ' h';
    if (min === 90) b.textContent = '1½ h';
    confirmTap(b, () => cmd('start', { msecs: min * 60000 }));
    $('presets').appendChild(b);
  }

  // ─── Boot ────────────────────────────────────────────────────────────────

  render();
  requestWakeLock();
  document.addEventListener('click', requestWakeLock, { once: true });   // some browsers need a tap first
  connect();
})();
