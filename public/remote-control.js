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
    // Short names, and the server only when it isn't the default (the phone page works that
    // out from its own address): a shorter link makes a simpler, easier-to-scan QR code.
    const h = { r: p.room, k: p.key };
    if (serverUrl() !== defaultServer()) h.s = serverUrl();
    u.hash = new URLSearchParams(h).toString();
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
    const entry = { n: ++phoneCounter, sent: {}, peer: null, deck: false, faces: [] };
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
    if (m.t === 'hello' || m.t === 'deck') deckFaces = null;   // outside a push: work them out afresh
    if (m.t === 'hello') {
      e.sent = {}; e.faces = [];
      pushTo(e, true);
    } else if (m.t === 'deck') {               // phone switched its virtual Stream Deck XL on/off
      e.deck = !!m.on; e.faces = [];
      pushTo(e, false);
    } else if (m.t === 'key') {                // virtual deck key pressed: index only, never a command
      const i = num(m.i, 0, 31);
      if (e.deck && i !== null && i === Math.floor(i) && window.StreamDeck) window.StreamDeck.press(i, 'xl');
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
        if ((changed || deckPhones()) && peers.size) schedulePush();   // deck keys follow more variables
      },
    };
    if (window.StreamDeck) window.StreamDeck.onChange(() => { if (deckPhones()) schedulePush(); });
  }
  const deckPhones = () => [...peers.values()].some(e => e.deck);

  function schedulePush() {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {          // coalesce bursts into one small message
      pushTimer = null;
      deckFaces = null;
      for (const e of peers.values()) pushTo(e, false);
    }, 60);
  }

  // Virtual XL key faces (colours + text from streamdeck.js), worked out once per push.
  // Only keys whose face changed are sent: usually just the two countdown keys each second.
  let deckFaces = null;
  function pushDeck(e) {
    if (!window.StreamDeck) { if (!e.faces.none) { e.faces = { none: true }; e.peer.send({ t: 'deck', none: true }); } return; }
    if (!deckFaces) deckFaces = window.StreamDeck.faces('xl').map(f => [f, JSON.stringify(f)]);
    const k = {};
    let any = false;
    const full = !e.faces.length;
    deckFaces.forEach(([f, json], i) => { if (e.faces[i] !== json) { k[i] = f; e.faces[i] = json; any = true; } });
    if (any) e.peer.send({ t: 'deck', full, cols: 8, rows: 4, k });
  }

  // Sends only the fields that changed since the last message to this phone (low bandwidth)
  function pushTo(e, full) {
    const diff = {};
    let any = false;
    for (const [k, v] of Object.entries(state)) {
      if (full || e.sent[k] !== v) { diff[k] = v; e.sent[k] = v; any = true; }
    }
    if (any || full) e.peer.send({ t: 'state', full: !!full, s: diff });
    if (e.deck) pushDeck(e);
  }

  // ─── Panel ───────────────────────────────────────────────────────────────

  // The panel's styles live here, not in timer.css, so they always match this script.
  // (A browser holding a cached timer.css from before this feature showed the panel unstyled,
  // in the page flow underneath the button bar.)
  const PANEL_CSS = `

#phone-panel {
  /* Below the button bar (which grows when zoomed buttons wrap), above everything else except the
     full-screen QR and help; scrolls if the window is short */
  position: fixed; top: calc(var(--buttons-bottom, 48px) + 8px); right: 16px; width: 320px; z-index: 2147481000;
  max-height: calc(100vh - var(--buttons-bottom, 48px) - 16px); overflow-y: auto; box-sizing: border-box;
  background: #111; border: 1px solid #333; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,.6);
  color: #ddd; font: 13px/1.4 "Helvetica Neue", Arial, sans-serif; padding: 10px 12px 12px; cursor: auto;
}
#phone-panel[hidden] { display: none; }
#phone-panel .pp-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; color: #fff; }
#phone-panel .pp-exp { font-size: 10px; color: #ffcc33; border: 1px solid #665200; border-radius: 3px; padding: 0 4px; }
#phone-panel .pp-close { margin-left: auto; background: none; border: 0; color: #888; font-size: 15px; cursor: pointer; }
#phone-panel .pp-status { font-size: 12px; color: #888; margin-bottom: 8px; }
#phone-panel .pp-status[data-kind="ok"] { color: #7fdc7f; }
#phone-panel .pp-status[data-kind="error"] { color: #ff8080; }
#phone-panel .pp-qr { display: flex; justify-content: center; min-height: 40px; color: #888; cursor: zoom-in; }
#phone-panel .pp-qr canvas { display: block; border-radius: 4px;
  /* shrink (keeping it square) when the window is too short for the whole panel */
  width: auto !important; height: auto !important; max-width: 100%;
  max-height: max(120px, calc(100vh - var(--buttons-bottom, 48px) - 230px)); }   /* white quiet zone is part of the image */
/* Topmost layer: above everything else on the page, including the video-assist canvases (999999) */
#phone-qr-big { position: fixed; inset: 0; z-index: 2147483000; background: #000; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px; cursor: zoom-out; color: #aaa; font: 16px "Helvetica Neue", Arial, sans-serif; }
#phone-qr-big canvas { border-radius: 8px; }
#phone-panel .pp-link { font-size: 9px; color: #555; word-break: break-all; margin: 6px 0; max-height: 3.2em; overflow: hidden; }
#phone-panel .pp-row { display: flex; gap: 6px; margin-top: 6px; }
#phone-panel button { flex: 1; padding: 5px 4px; font-size: 12px; background: #222; border: 1px solid #444; color: #ccc; border-radius: 4px; cursor: pointer; }
#phone-panel button:hover { background: #333; color: #fff; }
#phone-panel .pp-peers { margin-top: 8px; font-size: 12px; }
#phone-panel .pp-lan { color: #7fdc7f; } #phone-panel .pp-srv { color: #ffcc33; }
#phone-panel .pp-hint { font-size: 11px; color: #666; margin-top: 4px; }
#phone-panel .pp-adv { margin-top: 8px; font-size: 12px; color: #888; }
#phone-panel .pp-adv summary { cursor: pointer; }
#phone-panel .pp-server { flex: 3; background: #1a1a1a; border: 1px solid #333; color: #ddd; padding: 4px 6px; font-size: 11px; border-radius: 3px; }
`;
  function injectStyles() {
    if (document.getElementById('phone-panel-css')) return;
    const st = document.createElement('style');
    st.id = 'phone-panel-css';
    st.textContent = PANEL_CSS;
    document.head.appendChild(st);
  }


  let statusText = 'Off', statusKind = 'idle';
  function setStatus(text, kind) { statusText = text; statusKind = kind; renderPanel(); }

  function panel() {
    let el = document.getElementById('phone-panel');
    if (el) return el;
    injectStyles();
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
    el.querySelector('.pp-qr').addEventListener('click', showBigQR);
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

  // The QR library only computes the code; we draw it ourselves so every module lands on
  // whole device pixels (no seams) with the standard 4-module white quiet zone around it.
  function qrCanvas(text, cssSize) {
    const tmp = document.createElement('div');
    const q = new window.QRCode(tmp, { text, width: 64, height: 64, correctLevel: window.QRCode.CorrectLevel.M });
    const m = q._oQRCode, n = m.getModuleCount(), quiet = 4, total = n + 2 * quiet;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(1, Math.round(cssSize * dpr / total));        // whole device pixels per module
    const c = document.createElement('canvas');
    c.width = c.height = total * scale;
    c.style.width = c.style.height = (total * scale / dpr) + 'px';
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) {
      if (m.isDark(r, col)) ctx.fillRect((col + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
    return c;
  }

  // Click the code to show it full-screen (easier to scan from a distance)
  function showBigQR() {
    if (!window.QRCode || !qrFor) return;
    injectStyles();
    const ov = document.createElement('div');
    ov.id = 'phone-qr-big';
    ov.title = 'Click to close';
    ov.appendChild(qrCanvas(qrFor, Math.min(window.innerWidth, window.innerHeight) * 0.8));
    const cap = document.createElement('div');
    cap.textContent = 'Scan with a phone to control the timer · click to close';
    ov.appendChild(cap);
    const close = () => { ov.remove(); window.removeEventListener('keydown', onKey, true); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    ov.addEventListener('click', close);
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
  }

  let qrFor = null, qrLib = null;
  function drawQR(text) {
    const box = panel().querySelector('.pp-qr');
    if (qrFor === text && box.firstChild) return;
    qrFor = text;
    const render = () => {
      box.innerHTML = '';
      try { box.appendChild(qrCanvas(text, 280)); }
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
