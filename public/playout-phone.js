/*!
 * playout-phone.js
 * A playout computer's Stream Deck keys on a phone (playout-phone.html; the owner, 12 Nov 2026: as the
 * timer's Show on a phone). The playout page hosts a room on the pairing server (playout-deck.js); this
 * joins it with the key from the QR code (#r=<room>&k=<key>[&s=<server>]&dm=<size>, kept in
 * playout_phone_link so a reload or a Home Screen icon comes back), passes the proximity check (a 3-digit
 * number shown here, typed on the playout computer; a token after that, playout_phone_token_<room>), then
 * draws the keys it's sent ({t:'deck', model, cols, rows, full, k: {index: face}}, deck-face.js faces via
 * virtual-deck.js) and sends key down and up ({t:'kd'|'ku', i}: a tap stops a playing item, a hold fades
 * it) and its size ({t:'model'}, playout_phone_model). Revoked or refused: it forgets the link.
 * MIT Licensed
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
    del: k => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };
  if (location.hostname) document.title = location.hostname + ' - Playout keys';
  const LINK = 'playout_phone_link', MODEL = 'playout_phone_model';
  const parse = frag => Object.fromEntries(new URLSearchParams(frag));
  let link = parse(location.hash.slice(1));
  if (link.r && link.k) {
    store.set(LINK, location.hash.slice(1));
    if (VirtualDeck.MODELS[link.dm]) store.set(MODEL, link.dm);
    history.replaceState(null, '', location.pathname + location.search);
  } else link = parse(store.get(LINK) || '');
  const status = (text, kind) => { $('status').textContent = text; $('status').className = kind || ''; };
  const cover = (text, pin) => { $('cover').hidden = text == null; $('covermsg').textContent = text || ''; $('pincode').textContent = pin || ''; };
  if (!link.r || !link.k) { status('Not paired'); cover('Scan the code on the playout computer: its Stream Deck box, Show on a phone…'); return; }
  const tokenKey = 'playout_phone_token_' + link.r;

  // ─── The keys ───
  let model = VirtualDeck.MODELS[store.get(MODEL)] ? store.get(MODEL) : 'mk2';
  $('model').value = model;
  const down = new Set();
  const vd = VirtualDeck.create($('keys'), {
    bind(c, i) {                                       // down and up both go (a tap stops, a hold fades)
      c.addEventListener('pointerdown', e => {
        try { c.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
        c.classList.add('down'); down.add(i);
        if (navigator.vibrate) navigator.vibrate(12);
        if (peer) peer.send({ t: 'kd', i });
      });
      const up = () => { c.classList.remove('down'); if (!down.delete(i)) return; if (peer) peer.send({ t: 'ku', i }); };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
    },
  });
  function layout() {
    const box = $('deck').getBoundingClientRect();
    vd.layout(Math.max(100, box.width - 16), Math.max(80, box.height - 16), 0.18);
  }
  function setModel(m) {
    if (!VirtualDeck.MODELS[m]) return;
    model = m; $('model').value = m;
    vd.setModel(m); layout();
  }
  setModel(model);
  window.addEventListener('resize', layout);
  $('model').addEventListener('change', e => {
    e.target.blur();
    store.set(MODEL, e.target.value);
    setModel(e.target.value);
    if (peer) peer.send({ t: 'model', model });
  });
  if (document.fullscreenEnabled) {
    $('full').hidden = false;
    $('full').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); });
  }
  // The screen stays on while connected (a locked phone drops the keys)
  let lock = null;
  async function keepAwake() { try { if (!lock && navigator.wakeLock && document.visibilityState === 'visible' && ok) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } } catch (_) { /* not allowed */ } }
  document.addEventListener('visibilitychange', keepAwake);

  // ─── The link (as the overlay's: join, a WebRTC link where it can, the server otherwise) ───
  let ws = null, peer = null, retry = 1000, retryTimer = 0, waiting = false, refused = false, ok = false, pinCode = null;
  function showMode() {
    if (refused) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return status('Connecting…');
    if (!peer) return status(waiting ? 'The playout page isn’t open: waiting for it…' : 'Waiting for the playout computer…', 'warn');
    if (!ok) return status('Asking the playout computer…', 'warn');
    status(peer.mode === 'server' ? 'Connected via the server' : '⚡ Connected directly', 'ok');
  }
  function newPeer() {
    if (peer) peer.close();
    ok = false;
    peer = RemotePeer.create({
      initiator: false,
      relay: msg => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'up', msg })); },
      onMessage, onModeChange: showMode,
    });
    peer.send({ t: 'hello', token: store.get(tokenKey) || undefined, model });
    showMode();
  }
  function connect() {
    clearTimeout(retryTimer);
    try { ws = new WebSocket(RemotePeer.socketUrl(link.s || RemotePeer.defaultServer(), { room: link.r })); RemotePeer.keepAlive(ws); } catch (_) { return schedule(); }
    const sock = ws;
    sock.onopen = () => sock.send(JSON.stringify({ type: 'join', room: link.r, key: link.k }));
    sock.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.type === 'joined') { waiting = false; retry = 1000; if (m.hostOnline !== false) newPeer(); else { cover('The playout page isn’t open. These keys come back when it is.'); } }
      else if (m.type === 'down') { if (peer) peer.receive(m.msg); }
      else if (m.type === 'host-offline') { if (peer) peer.close(); peer = null; ok = false; cover('The playout page closed. These keys come back when it opens again.'); }
      else if (m.type === 'host-online') newPeer();
      else if (m.type === 'error') {
        if (m.reason === 'not-found' || m.reason === 'room-closed') { waiting = true; retry = 15000; cover('The playout page isn’t sharing its keys just now: waiting for it…'); }
        else if (m.reason === 'rejected') refused = true;
      }
      showMode();
    };
    sock.onclose = () => {
      if (sock !== ws) return;
      if (peer) peer.close();
      peer = null; ok = false;
      showMode();
      if (!refused) schedule();
    };
    sock.onerror = () => {};
  }
  function schedule() {
    retryTimer = setTimeout(connect, retry);
    if (!waiting) retry = Math.min(retry * 2, 10000);
  }
  function gone(text) {                                // refused or revoked: forget the link
    refused = true; ok = false;
    store.del(LINK); store.del(tokenKey);
    status('Not connected', 'warn');
    cover(text);
    if (ws) ws.close();
  }
  function onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'pin-required') {
      if (!pinCode) pinCode = String(100 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900));   // 3 digits: the proximity check
      cover('The playout computer asks who this is. Tell its operator this number (one wrong try and this phone is out):', pinCode);
      peer.send({ t: 'pin', code: pinCode, name: RemotePeer.deviceName() });
    } else if (m.t === 'pin-ok') {
      if (typeof m.token === 'string') store.set(tokenKey, m.token);
      pinCode = null;
      peer.send({ t: 'hello', token: store.get(tokenKey) || undefined, model });
    } else if (m.t === 'pin-rejected') gone('The playout computer didn’t let this phone in. Scan its code again to try again.');
    else if (m.t === 'revoked') gone('The playout computer took these keys away. Scan its code again to use them.');
    else if (m.t === 'deck' && m.k && typeof m.k === 'object') {
      if (!ok) { ok = true; cover(null); keepAwake(); }
      if (VirtualDeck.MODELS[m.model] && m.model !== vd.model) setModel(m.model);
      for (const [i, f] of Object.entries(m.k)) vd.setFace(Number(i), f);
    }
    showMode();
  }
  RemotePeer.retryOnNetworkChange(() => { if (peer && peer.mode === 'server') peer.send({ t: 'relink' }); });
  connect();

  window.__pphone = { faces: () => vd.faces.map(f => (f && f.rs ? f.rs.body + (f.rs.cap ? ' | ' + f.rs.cap : '') : '')), bgs: () => vd.faces.map(f => f && f.bg), ok: () => ok, model: () => vd.model };
})();
