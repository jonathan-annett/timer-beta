/*!
 * manage-phone.js
 * A management console's admin phone (manage-phone.html; a trial: TimerFeatures.manage, alpha only). It pairs
 * with the console by the console's code (its admin key; the proximity check, typed on the console), then adds
 * rooms: it scans a room's share code (any of its links), joins that room as a device (client 'mgr-phone'),
 * passes the room's proximity check, and asks (manage-ask). The room allows it and names itself
 * (remote-control.js answerManage → manage-grant: the view-only link and a management token); the name can be
 * changed here; the console checks it's unique (name-check) and adds the room (add-room). The owner, 15 Nov
 * 2026: no room is added without a unique name.
 * MIT Licensed
 */

/* global RemotePeer */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  if (location.hostname) document.title = location.hostname + ' - Admin phone';
  if (window.TimerFeatures && !TimerFeatures.manage) {
    document.querySelector('main').innerHTML = '<h1>Admin phone</h1><p class="sub">The management console isn’t available on this site.</p>';
    return;
  }
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
    del: k => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };
  const params = new URLSearchParams(location.search);
  const LINK = 'manage_phone_link', tokenKey = r => 'manage_phone_token_' + r;
  const show = (id, on) => { $(id).hidden = !on; };
  const msg = (id, text, kind) => { $(id).textContent = text || ''; $(id).className = 'msg' + (kind ? ' ' + kind : ''); };
  const pinNumber = () => String(100 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900));   // 3 digits: the proximity check

  // The console's link: from the address (scanned), else the one kept from before
  let frag = location.hash.length > 1 ? location.hash.slice(1) : store.get(LINK) || '';
  const link = Object.fromEntries(new URLSearchParams(frag));
  if (!link.r || !link.a) { show('nolink', true); return; }
  store.set(LINK, frag);
  history.replaceState(null, '', location.pathname + location.search);   // the key out of the address bar
  const SERVER = link.s || params.get('remote') || RemotePeer.defaultServer();

  // ─── The console ──────────────────────────────────────────────────────────
  let cws = null, cpeer = null, cretry = 1000, refused = false, eventName = '', reqN = 0;
  const waiting = new Map();                       // req → resolve
  function ask(m) {
    return new Promise(resolve => {
      const req = 'q' + (++reqN);
      waiting.set(req, resolve);
      if (cpeer) cpeer.send(Object.assign({ req }, m)); else resolve(null);
      setTimeout(() => { if (waiting.has(req)) { waiting.delete(req); resolve(null); } }, 8000);
    });
  }
  function status(text, kind) { $('status').textContent = text; $('status').className = kind || ''; }
  function consoleHello() { if (cpeer) cpeer.send({ t: 'hello', token: store.get(tokenKey(link.r)) || undefined }); }
  function connectConsole() {
    try { cws = new WebSocket(RemotePeer.socketUrl(SERVER, { room: link.r })); RemotePeer.keepAlive(cws); } catch (_) { return setTimeout(connectConsole, cretry); }
    const sock = cws;
    sock.onopen = () => sock.send(JSON.stringify({ type: 'join', room: link.r, key: link.a }));
    sock.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.type === 'joined') { cretry = 1000; if (m.hostOnline) newConsolePeer(); else status('The console is closed: waiting for it…', 'warn'); }
      else if (m.type === 'host-online') newConsolePeer();
      else if (m.type === 'host-offline') { if (cpeer) cpeer.close(); cpeer = null; status('The console is closed: waiting for it…', 'warn'); }
      else if (m.type === 'down') { if (cpeer) cpeer.receive(m.msg); }
      else if (m.type === 'error' && (m.reason === 'not-found' || m.reason === 'room-closed')) { status('The console isn’t there (closed, or that event was cleared). Scan its code again.', 'warn'); cretry = 15000; }
    };
    sock.onclose = () => {
      if (sock !== cws) return;
      if (cpeer) cpeer.close();
      cpeer = null;
      if (refused) return;
      setTimeout(connectConsole, cretry);
      cretry = Math.min(cretry * 2, 15000);
    };
    sock.onerror = () => {};
  }
  function newConsolePeer() {
    if (cpeer) cpeer.close();
    cpeer = RemotePeer.create({
      initiator: false,
      relay: m => { if (cws && cws.readyState === WebSocket.OPEN) cws.send(JSON.stringify({ type: 'up', msg: m })); },
      onMessage: fromConsole,
      onModeChange: () => {},
    });
    consoleHello();
  }
  let consolePin = null;
  function fromConsole(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'pin-required') {
      consolePin = consolePin || pinNumber();
      $('pinwhat').textContent = 'Type this number on the management console:';
      $('pincode').textContent = consolePin; $('pinhint').textContent = '';
      show('pin', true); show('ready', false);
      cpeer.send({ t: 'pin', code: consolePin, name: 'Admin phone · ' + RemotePeer.deviceName() });
    } else if (m.t === 'pin-ok') {
      if (typeof m.token === 'string') store.set(tokenKey(link.r), m.token);
      consolePin = null; show('pin', false);
      consoleHello();
    } else if (m.t === 'pin-rejected' || m.t === 'revoked') {
      refused = true;
      store.del(tokenKey(link.r));
      if (m.t === 'revoked') store.del(LINK);
      show('pin', false); show('ready', false); show('room', false);
      status(m.t === 'revoked' ? 'The console took this phone’s access away.' : 'The console didn’t let this phone in. Scan its code again to retry.', 'warn');
    } else if (m.t === 'console') {
      eventName = typeof m.event === 'string' ? m.event.slice(0, 80) : '';
      $('sub').textContent = 'Adding rooms to “' + eventName + '”';
      status('Connected to the console', 'ok');
      if ($('room').hidden && $('pin').hidden) show('ready', true);
    } else if ((m.t === 'name-check' || m.t === 'add-room') && waiting.has(m.req)) {
      const r = waiting.get(m.req); waiting.delete(m.req); r(m);
    }
  }

  // ─── A room ───────────────────────────────────────────────────────────────
  let room = null;                                 // {f, ws, peer, pin, grant}
  function parseRoom(text) {
    try {
      const u = new URL(String(text).trim());
      const f = Object.fromEntries(new URLSearchParams(u.hash.slice(1)));
      const key = f.k || f.v || f.a || f.c;
      if (!/^[A-Za-z0-9]{6,32}$/.test(f.r || '') || !/^[A-Za-z0-9_-]{16,128}$/.test(key || '')) return null;
      if (f.s && !/^wss?:\/\/[^\s#?]+$/i.test(f.s)) return null;
      return { r: f.r, key, s: f.s || null };
    } catch (_) { return null; }
  }
  function onScanned(text) {
    const f = parseRoom(text);
    if (!f) { msg('scanmsg', 'That isn’t a timer’s share code. Scan the code in the timer’s share panel.', 'bad'); return false; }
    if (f.r === link.r) { msg('scanmsg', 'That’s the console’s own code. Scan a room timer’s share code.', 'bad'); return false; }
    stopScan();
    msg('scanmsg', '');
    joinRoom(f);
    return true;
  }
  function roomSay(text, kind) { msg('roommsg', text, kind); }
  function joinRoom(f) {
    leaveRoom();
    room = { f, ws: null, peer: null, pin: null, grant: null };
    show('ready', false); show('room', true); show('naming', false);
    roomSay('Connecting to the room’s timer…');
    const R = room;
    try { R.ws = new WebSocket(RemotePeer.socketUrl(f.s || SERVER, { room: f.r })); } catch (_) { roomSay('Couldn’t reach that timer’s pairing server.', 'bad'); return; }
    R.ws.onopen = () => R.ws.send(JSON.stringify({ type: 'join', room: f.r, key: f.key }));
    R.ws.onmessage = ev => {
      if (room !== R) return;
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.type === 'joined') { if (m.hostOnline) roomPeer(R); else roomSay('That timer isn’t open. Open it (share turned on), then scan again.', 'warn'); }
      else if (m.type === 'host-online') roomPeer(R);
      else if (m.type === 'down') { if (R.peer) R.peer.receive(m.msg); }
      else if (m.type === 'error') roomSay(m.reason === 'not-found' ? 'That code didn’t work (the timer may have made a new one). Scan the code it shows now.' : 'The timer’s server said: ' + m.reason, 'bad');
    };
    R.ws.onclose = () => { if (room === R && !R.grant && !R.done) roomSay((($('roommsg').textContent) || '') + ' (disconnected)', 'warn'); };
    R.ws.onerror = () => {};
  }
  function roomPeer(R) {
    if (R.peer) R.peer.close();
    R.peer = RemotePeer.create({
      initiator: false,
      relay: m => { if (R.ws && R.ws.readyState === WebSocket.OPEN) R.ws.send(JSON.stringify({ type: 'up', msg: m })); },
      onMessage: m => fromRoom(R, m),
      onModeChange: () => {},
    });
    R.peer.send({ t: 'hello', client: 'mgr-phone' });
  }
  function fromRoom(R, m) {
    if (room !== R || !m || typeof m !== 'object') return;
    if (m.t === 'pin-required') {
      R.pin = R.pin || pinNumber();
      $('pinwhat').textContent = 'Have the room type this number on their timer (its share panel opens by itself):';
      $('pincode').textContent = R.pin; $('pinhint').textContent = 'Then they allow management and name the room.';
      show('pin', true);
      roomSay('');
      R.peer.send({ t: 'pin', code: R.pin, name: 'Management phone · ' + RemotePeer.deviceName() });
    } else if (m.t === 'pin-ok') {
      show('pin', false);
      R.peer.send({ t: 'manage-ask', event: eventName });
      roomSay('Asking the room…');
    } else if (m.t === 'manage-asked') {
      roomSay('Waiting for the room to allow it and type its name…');
    } else if (m.t === 'manage-grant' && typeof m.frag === 'string' && typeof m.token === 'string') {
      R.grant = { frag: m.frag, token: m.token };
      R.done = true;
      try { R.ws.close(); } catch (_) { /* gone */ }
      roomSay('The room allowed it.', 'ok');
      $('rname').value = typeof m.name === 'string' ? m.name : '';
      msg('namemsg', '');
      show('naming', true);
      $('rname').focus();
    } else if (m.t === 'manage-refused') {
      R.done = true; roomSay('The room said no.', 'bad');
    } else if (m.t === 'pin-rejected') {
      R.done = true; show('pin', false); roomSay('Wrong number: the room turned this phone away. Scan its code again to retry.', 'bad');
    }
  }
  function leaveRoom() {
    if (!room) return;
    const R = room; room = null;
    if (R.peer) R.peer.close();
    if (R.ws) try { R.ws.close(); } catch (_) { /* gone */ }
  }
  function backToScan() {
    leaveRoom();
    show('room', false); show('pin', false); show('ready', !!eventName);
  }
  $('roomcancel').addEventListener('click', backToScan);
  const added = [];                                // names added from here, this visit
  async function addRoom() {
    const R = room;
    if (!R || !R.grant) return;
    const name = $('rname').value.trim();
    if (!name) { msg('namemsg', 'The room needs a name.', 'bad'); return; }
    $('addroom').disabled = true;
    const chk = await ask({ t: 'name-check', name });
    if (!chk) { $('addroom').disabled = false; msg('namemsg', 'The console didn’t answer. Is it open?', 'bad'); return; }
    if (!chk.ok) { $('addroom').disabled = false; msg('namemsg', `There's already a room called “${name}”: choose another.`, 'bad'); $('rname').select(); return; }
    const res = await ask({ t: 'add-room', frag: R.grant.frag, token: R.grant.token, name });
    $('addroom').disabled = false;
    if (!res || !res.ok) { msg('namemsg', !res ? 'The console didn’t answer. Is it open?' : res.reason === 'taken' ? `There's already a room called “${name}”: choose another.` : 'The console couldn’t add it (' + res.reason + ').', 'bad'); return; }
    added.push(name);
    $('added').textContent = 'Added from this phone: ' + added.join(', ');
    backToScan();
    msg('scanmsg', `“${name}” is on the console. Next room?`, 'ok');
  }
  $('addroom').addEventListener('click', addRoom);
  $('rname').addEventListener('keydown', ev => { if (ev.key === 'Enter') addRoom(); });
  $('pastego').addEventListener('click', () => onScanned($('paste').value));
  $('paste').addEventListener('keydown', ev => { if (ev.key === 'Enter') onScanned($('paste').value); });

  // ─── The camera (as remote-phone.js's admin view: BarcodeDetector, else the bundled jsQR) ───
  let stream = null, detector = null, scanTimer = null, canvas = null;
  const loadScript = src => new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = src; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
  async function startScan() {
    stopScan();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return msg('scanmsg', 'This browser can’t use the camera here: paste the link instead.', 'bad');
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); }
    catch (err) { return msg('scanmsg', 'Couldn’t use the camera (' + (err.name || err.message) + '). Allow camera access, then tap Scan.', 'bad'); }
    const v = $('video');
    v.srcObject = stream; v.hidden = false;
    try { await v.play(); } catch (_) { /* a muted video normally plays */ }
    if (!detector && 'BarcodeDetector' in window) {
      try { if ((await BarcodeDetector.getSupportedFormats()).includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (_) { /* jsQR */ }
    }
    if (!detector && !window.jsQR) { try { await loadScript('jsQR.js'); } catch (_) { stopScan(); return msg('scanmsg', 'Couldn’t load the QR reader.', 'bad'); } }
    msg('scanmsg', 'Point the camera at the room timer’s share code.');
    scanLoop();
  }
  async function scanLoop() {
    if (!stream) return;
    const v = $('video');
    let text = null;
    if (v.readyState >= 2 && v.videoWidth) {
      try {
        if (detector) { const codes = await detector.detect(v); if (codes.length) text = codes[0].rawValue; }
        else {
          const k = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight)), w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k);
          canvas = canvas || document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(v, 0, 0, w, h);
          const r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
          if (r) text = r.data;
        }
      } catch (_) { /* the next frame */ }
    }
    if (!stream) return;
    if (text && onScanned(text)) return;
    scanTimer = setTimeout(scanLoop, 180);
  }
  function stopScan() {
    clearTimeout(scanTimer);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    $('video').srcObject = null; $('video').hidden = true;
  }
  $('scan').addEventListener('click', startScan);

  status('Connecting to the console…');
  connectConsole();
})();
