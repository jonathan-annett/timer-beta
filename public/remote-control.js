/*!
 * remote-control.js  (EXPERIMENTAL)
 * Lets phones control the timer. Timer side: pairing panel with QR code, connection to the
 * pairing server (remote-server.js, default wss://<this host>:8443), one RemotePeer link per
 * phone, state pushed to phones, and an allow-list for commands coming back.
 *
 * Phones get a link with the server, room and secret key in the URL fragment (never sent to
 * the web server). "New code" revokes every phone. The pairing survives reloads so phones
 * reconnect by themselves.
 *
 * localStorage: remote_server (wss URL), remote_pairing ({room,key}), remote_enabled ('1').
 * MIT Licensed
 */

/* global RemotePeer, processTimerApiMessage */

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (params.has('presenter') || params.has('audience')) return;   // controller window only
  if (typeof RemotePeer === 'undefined') return;

  const SERVER_KEY = 'remote_server', PAIR_KEY = 'remote_pairing', ENABLED_KEY = 'remote_enabled';
  const defaultServer = () => `wss://${location.hostname}:8443/`;
  if (params.get('remote')) localStorage.setItem(SERVER_KEY, params.get('remote'));   // ?remote=wss://host:port/

  let ws = null, retryTimer = null, retryDelay = 1000, enabled = false, hosted = false;
  const peers = new Map();          // phone id -> { peer, sent: {} }
  const state = {};                 // what phones see; filled from the timerAPI bus
  let pushTimer = null;
  let phoneCounter = 0;

  // ─── Pairing code ────────────────────────────────────────────────────────

  function randomString(len, alphabet) {
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
  }
  function pairing(renew) {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(PAIR_KEY)); } catch (_) { /* regenerate */ }
    if (renew || !p || !p.room || !p.key) {
      p = {
        room: randomString(8, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'),
        key: randomString(24, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'),
      };
      localStorage.setItem(PAIR_KEY, JSON.stringify(p));
    }
    return p;
  }
  const serverUrl = () => localStorage.getItem(SERVER_KEY) || defaultServer();
  function phoneLink() {
    const p = pairing();
    const u = new URL('remote.html', location.href);
    u.search = '';
    u.hash = new URLSearchParams({ server: serverUrl(), room: p.room, key: p.key }).toString();
    return u.toString();
  }

  // ─── Connection to the pairing server ────────────────────────────────────

  function connect() {
    clearTimeout(retryTimer);
    if (!enabled) return;
    setStatus('Connecting to ' + serverUrl() + ' …', 'idle');
    try { ws = new WebSocket(serverUrl()); } catch (err) { setStatus('Bad server address: ' + err.message, 'error'); return; }
    const sock = ws;
    sock.onopen = () => {
      retryDelay = 1000;
      const p = pairing();
      sock.send(JSON.stringify({ type: 'host', room: p.room, key: p.key }));
    };
    sock.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      switch (m.type) {
        case 'hosted': hosted = true; setStatus('Ready — scan the code with a phone', 'ok'); break;
        case 'peer-join': addPeer(m.id); break;
        case 'peer-leave': removePeer(m.id); break;
        case 'from': { const p = peers.get(m.id); if (p) p.peer.receive(m.msg); break; }
        case 'error':
          if (m.reason === 'room-taken') { pairing(true); renderPanel(); }    // code clash: new code, retry
          else setStatus('Server said: ' + m.reason, 'error');
          break;
      }
    };
    sock.onclose = () => {
      if (sock !== ws) return;
      hosted = false;
      for (const id of [...peers.keys()]) removePeer(id);
      if (!enabled) { setStatus('Off', 'idle'); return; }
      setStatus(`Can't reach ${serverUrl()} — retrying…`, 'error');
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    };
    sock.onerror = () => {};
  }

  function relayTo(id) {
    return msg => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'to', id, msg })); };
  }

  function addPeer(id) {
    removePeer(id);
    const entry = { n: ++phoneCounter, sent: {}, peer: null };
    entry.peer = RemotePeer.create({
      initiator: true,
      relay: relayTo(id),
      onMessage: msg => onPhoneMessage(id, msg),
      onModeChange: () => renderPanel(),
    });
    peers.set(id, entry);
    renderPanel();
  }

  function removePeer(id) {
    const e = peers.get(id);
    if (!e) return;
    e.peer.close();
    peers.delete(id);
    renderPanel();
  }

  // ─── Messages from phones ────────────────────────────────────────────────

  const num = (v, min, max) => (typeof v === 'number' && isFinite(v) && v >= min && v <= max) ? v : null;
  const HOUR = 3600000;

  // Phone command → timer API command. Anything not listed here is ignored.
  const ALLOWED = {
    restart:       () => ({ cmd: 'start' }),                                   // default duration
    start:         m => num(m.msecs, 1000, 24 * HOUR) && { cmd: 'start', msecs: m.msecs },
    pause:         () => ({ cmd: 'pause' }),                                   // toggles
    undopause:     () => ({ cmd: 'undopause' }),
    adjust:        m => num(m.msecs, 1000, HOUR) && { cmd: 'adjust', addtime: !!m.addtime, msecs: m.msecs },
    catchup:       () => ({ cmd: 'catchup' }),
    custommessage: m => typeof m.text === 'string' && { cmd: 'custommessage', text: m.text.slice(0, 200) },
    runsheetnext:  () => ({ cmd: 'runsheetnext' }),
    runsheetprev:  () => ({ cmd: 'runsheetprev' }),
  };

  function onPhoneMessage(id, m) {
    const e = peers.get(id);
    if (!e || !m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      e.sent = {};
      pushTo(e, true);
    } else if (m.t === 'cmd' && Object.prototype.hasOwnProperty.call(ALLOWED, m.cmd)) {
      const apiMsg = ALLOWED[m.cmd](m);
      if (apiMsg && typeof processTimerApiMessage === 'function') processTimerApiMessage(apiMsg);
    }
  }

  // ─── State for phones (from the timerAPI bus) ────────────────────────────

  const truthy = v => v === true || v === 'true' || v === '1' || v === 1;
  const MAP = {      // timerAPI variable -> [phone field, convert]
    remain: ['remain', String], expired: ['over', truthy], impending: ['impending', truthy],
    pausing: ['paused', truthy], adjusting_up: ['adjUp', truthy], adjusting_down: ['adjDown', truthy],
    custommsg: ['msg', String], default: ['def', String],
    rs_active: ['rsOn', truthy], rs_current: ['rsNow', String], rs_next: ['rsNext', String],
    rs_can_back: ['rsBack', truthy], rs_status: ['rsStatus', String], rs_late: ['rsLate', v => (v === '' ? null : Number(v))],
  };

  function installBus() {
    const prev = window.timerAPI;
    window.timerAPI = {
      send(msg) {
        if (prev && prev.send) prev.send(msg);
        const v = msg && msg.setVariableValues;
        if (!v) return;
        let changed = false;
        for (const k of Object.keys(v)) {
          if (!MAP[k]) continue;
          const val = MAP[k][1](v[k]);
          if (state[MAP[k][0]] !== val) { state[MAP[k][0]] = val; changed = true; }
        }
        if (changed && peers.size) schedulePush();
      },
    };
  }

  function schedulePush() {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {          // coalesce bursts into one small message
      pushTimer = null;
      for (const e of peers.values()) pushTo(e, false);
    }, 60);
  }

  // Sends only the fields that changed since the last message to this phone (low bandwidth)
  function pushTo(e, full) {
    const diff = {};
    let any = false;
    for (const [k, v] of Object.entries(state)) {
      if (full || e.sent[k] !== v) { diff[k] = v; e.sent[k] = v; any = true; }
    }
    if (any || full) e.peer.send({ t: 'state', full: !!full, s: diff });
  }

  // ─── Panel ───────────────────────────────────────────────────────────────

  let statusText = 'Off', statusKind = 'idle';
  function setStatus(text, kind) { statusText = text; statusKind = kind; renderPanel(); }

  function panel() {
    let el = document.getElementById('phone-panel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'phone-panel';
    el.hidden = true;
    el.innerHTML = `
      <div class="pp-head"><b>Phone control</b> <span class="pp-exp">experimental</span><button class="pp-close" aria-label="Close">✕</button></div>
      <div class="pp-status"></div>
      <div class="pp-qr"></div>
      <div class="pp-link"></div>
      <div class="pp-row"><button class="pp-copy">Copy link</button><button class="pp-renew" title="Disconnect all phones and make a new code">New code</button><button class="pp-toggle"></button></div>
      <div class="pp-peers"></div>
      <details class="pp-adv"><summary>Server</summary>
        <div class="pp-row"><input class="pp-server" spellcheck="false"><button class="pp-apply">Apply</button></div>
        <div class="pp-hint">Default: wss://this-host:8443/ (remote-server.js). Phones on the same Wi-Fi connect directly; otherwise through the server.</div>
      </details>`;
    document.body.appendChild(el);
    el.querySelector('.pp-close').addEventListener('click', () => { el.hidden = true; });
    el.querySelector('.pp-copy').addEventListener('click', () => navigator.clipboard && navigator.clipboard.writeText(phoneLink()));
    el.querySelector('.pp-renew').addEventListener('click', () => {
      if (!confirm('Make a new code? Phones using the current one will be disconnected.')) return;
      pairing(true); restart(); renderPanel(true);
    });
    el.querySelector('.pp-toggle').addEventListener('click', () => (enabled ? disable() : enable()));
    el.querySelector('.pp-apply').addEventListener('click', () => {
      const v = el.querySelector('.pp-server').value.trim();
      if (v && !/^wss?:\/\//i.test(v)) { alert('The server address must start with wss://'); return; }
      if (v && v !== defaultServer()) localStorage.setItem(SERVER_KEY, v); else localStorage.removeItem(SERVER_KEY);
      restart(); renderPanel(true);
    });
    // typing in the panel must not trigger timer shortcuts
    ['keydown', 'keyup'].forEach(t => el.addEventListener(t, e => { if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) e.stopPropagation(); }));
    return el;
  }

  let qrFor = null, qrLib = null;
  function drawQR(text) {
    const box = panel().querySelector('.pp-qr');
    if (qrFor === text && box.firstChild) return;
    qrFor = text;
    const render = () => {
      box.innerHTML = '';
      try { new window.QRCode(box, { text, width: 200, height: 200, correctLevel: window.QRCode.CorrectLevel.M }); }
      catch (_) { box.textContent = 'QR code unavailable — use Copy link'; }
    };
    if (window.QRCode) return render();
    if (!qrLib) {
      qrLib = document.createElement('script');
      qrLib.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      qrLib.onerror = () => { box.textContent = 'QR code unavailable offline — use Copy link'; };
      document.head.appendChild(qrLib);
    }
    qrLib.addEventListener('load', render, { once: true });
  }

  function renderPanel(force) {
    const el = document.getElementById('phone-panel');
    const btn = document.getElementById('btnphone');
    const lanCount = [...peers.values()].filter(e => e.peer.mode === 'lan').length;
    if (btn) btn.textContent = !enabled ? 'phone' : peers.size ? `phone ${peers.size}` : 'phone ·';
    if (!el) return;
    const st = el.querySelector('.pp-status');
    st.textContent = statusText; st.dataset.kind = statusKind;
    el.querySelector('.pp-toggle').textContent = enabled ? 'Turn off' : 'Turn on';
    el.querySelector('.pp-qr').style.display = enabled ? '' : 'none';
    el.querySelector('.pp-link').textContent = enabled ? phoneLink() : '';
    if (enabled) drawQR(phoneLink());
    const srv = el.querySelector('.pp-server');
    if (force || document.activeElement !== srv) srv.value = serverUrl();
    el.querySelector('.pp-peers').innerHTML = !peers.size ? (enabled ? '<i>No phones connected</i>' : '') :
      [...peers.values()].map(e => `<div>Phone ${e.n} · ${e.peer.mode === 'lan' ? '<b class="pp-lan">LAN direct</b>' : '<b class="pp-srv">via server</b>'}</div>`).join('') +
      (lanCount < peers.size ? '<div class="pp-hint">"via server": not on the same network (or the Wi-Fi isolates devices).</div>' : '');
  }

  // ─── On / off ────────────────────────────────────────────────────────────

  function enable() {
    enabled = true;
    localStorage.setItem(ENABLED_KEY, '1');
    if (typeof processTimerApiMessage === 'function') processTimerApiMessage({ cmd: 'opened' });   // fill `state`
    connect();
    renderPanel();
  }
  function disable() {
    enabled = false;
    localStorage.removeItem(ENABLED_KEY);
    clearTimeout(retryTimer);
    if (ws) { const s = ws; ws = null; s.close(); }
    for (const id of [...peers.keys()]) removePeer(id);
    setStatus('Off', 'idle');
  }
  function restart() {
    if (!enabled) return;
    if (ws) { const s = ws; ws = null; s.close(); }
    for (const id of [...peers.keys()]) removePeer(id);
    connect();
  }

  function togglePanel() {
    const el = panel();
    el.hidden = !el.hidden;
    if (!el.hidden) {
      if (!enabled) enable();
      renderPanel(true);
    }
  }

  function init() {
    installBus();
    document.getElementById('btnphone')?.addEventListener('click', togglePanel);
    if (localStorage.getItem(ENABLED_KEY) === '1') { panel(); enable(); }
    renderPanel();
  }

  window.remoteControl = { open: togglePanel, enable, disable, get peers() { return peers; }, get state() { return state; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
