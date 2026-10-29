/*!
 * remote-control.js  (EXPERIMENTAL)
 * Lets phones control the timer. Timer side: pairing panel with QR code, connection to the
 * pairing server (remote-server.js or the Cloudflare Worker; RemotePeer.defaultServer()), one RemotePeer link per
 * phone, state pushed to phones, and an allow-list for commands coming back.
 *
 * Phones get a link with the server, room and secret key in the URL fragment (never sent to
 * the web server). "New code" revokes every phone. The pairing survives reloads so phones
 * reconnect by themselves.
 *
 * Three kinds of link (chosen in the panel before scanning), each with its own key: Control
 * (the room key), View only (countdown or run sheet display; view key) and Admin (admin key).
 * The pairing server tells us which key a phone used (role 'control' / 'view' / 'admin'), and
 * it's enforced here: a view-only phone can only ask for state; a controller can control the
 * timer; only an admin can also ask for links to set up other computers ('share').
 *
 * localStorage: remote_server (wss URL), remote_pairing ({room,key,view,admin}), remote_enabled ('1'),
 * remote_link_mode ('control' | 'countdown' | 'runsheet': which link the QR code shows).
 * MIT Licensed
 */

/* global RemotePeer, processTimerApiMessage */

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (params.has('presenter')) return;   // controller window only
  if (typeof RemotePeer === 'undefined') return;

  const SERVER_KEY = 'remote_server', PAIR_KEY = 'remote_pairing', ENABLED_KEY = 'remote_enabled';
  const PIN_KEY = 'remote_pin', APPROVED_KEY = 'remote_approved';   // "Require a PIN" and the phones approved under it
  const defaultServer = () => RemotePeer.defaultServer();
  if (params.get('remote')) localStorage.setItem(SERVER_KEY, params.get('remote'));   // ?remote=wss://host:port/

  let ws = null, retryTimer = null, retryDelay = 1000, enabled = false, hosted = false, serverProtocol = 0;
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
    const KEYCHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    if (renew || !p || !p.room || !p.key) {
      p = { room: randomString(8, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'), key: randomString(24, KEYCHARS) };
      localStorage.removeItem(APPROVED_KEY);                   // a new code: every phone starts again
    }
    if (!p.view || !p.admin || !p.comp || !p.pptx) {  // view-only, admin, companion and PowerPoint keys (older pairings get them)
      p.view = p.view || randomString(24, KEYCHARS);
      p.comp = p.comp || randomString(24, KEYCHARS);
      p.pptx = p.pptx || randomString(24, KEYCHARS);
      p.admin = p.admin || randomString(24, KEYCHARS);
      localStorage.setItem(PAIR_KEY, JSON.stringify(p));
    }
    return p;
  }

  // Which link the QR code shows: a controller, or a view-only display
  const LINK_MODE_KEY = 'remote_link_mode';
  const LINK_MODES = {
    control:   { label: 'Control',   hint: 'Phones scanning this code can <b>control</b> the timer.' },
    countdown: { label: 'Countdown', hint: '<b>View only</b>: a countdown display. Can’t control the timer.' },
    runsheet:  { label: 'Run sheet', hint: '<b>View only</b>: run sheet status, e.g. for a green room. Can’t control the timer.' },
    admin:     { label: 'Admin',     hint: '<b>Admin</b>: can control the timer, use every view, and set up other computers as remotes or displays. Keep this one to yourself.' },
    companion: { label: 'Companion', hint: '<b>Bitfocus Companion</b> (or other automation): paste this link into the Companion connection’s settings. It gets every timer command and all the timer’s variables. It can’t set up other devices.' },
    pptx:      { label: 'PowerPoint', hint: '<b>PowerPoint</b>: open this link in Chrome or Edge on the computer that shows the slides (same network as this one). It receives the run sheet’s decks and shows how to start the PowerPoint player. It can’t control the timer.' },
  };
  const PPTX = !!(window.TimerFeatures && TimerFeatures.pptx);   // PowerPoint computers: an alpha-only trial (features.js)
  const SHARE_MODES = ['control', 'editor', 'countdown', 'runsheet'].concat(PPTX ? ['pptx'] : []);   // what an admin phone can set another computer up as
  const MIN_PROTOCOL = { control: 1, editor: 1, countdown: 2, runsheet: 2, admin: 3, companion: 4, pptx: 5, overlay: 2, code: 6 };   // pairing server needed for each link (code: pairing by code)
  // 'editor' is the control link with m=runsheet: a computer opening it starts in the run sheet editor
  const linkFields = (p, mode) => mode === 'control' ? { r: p.room, k: p.key }
    : mode === 'editor' ? { r: p.room, k: p.key, m: 'runsheet' }
    : mode === 'admin' ? { r: p.room, a: p.admin }
    : mode === 'companion' ? { r: p.room, c: p.comp }
    : mode === 'pptx' ? { r: p.room, p: p.pptx } : { r: p.room, v: p.view, m: mode };   // (countdown, runsheet, overlay: view only)
  const PASTE_MODES = ['companion', 'pptx'];          // links to copy, not codes to scan
  // On a phone or tablet (the timer itself run on one), the panel is a simple sheet: a friend's
  // phone as a remote control or a countdown display. No run sheet or admin links there.
  const TOUCH = 'ontouchstart' in window;
  const TOUCH_MODES = ['control', 'countdown'];
  const linkMode = () => {
    const m = localStorage.getItem(LINK_MODE_KEY);
    if (TOUCH && !TOUCH_MODES.includes(m)) return 'control';
    if (m === 'pptx' && !PPTX) return 'control';
    return LINK_MODES[m] ? m : 'control';
  };
  const serverUrl = () => localStorage.getItem(SERVER_KEY) || defaultServer();
  function phoneLink(mode = linkMode()) {
    const p = pairing();
    const u = new URL(mode === 'pptx' ? 'pptx.html' : 'remote.html', location.href);
    u.search = '';
    // Short names, and the server only when it isn't the default (the phone page works that
    // out from its own address): a shorter link makes a simpler, easier-to-scan QR code.
    // A view-only link carries only the view key, so it can never be turned into a controller.
    const h = linkFields(p, mode);
    if (serverUrl() !== defaultServer()) h.s = serverUrl();
    u.hash = new URLSearchParams(h).toString();
    return u.toString();
  }
  // The same link for an admin phone to pass on to another computer: always names the server,
  // since that computer may get its default from a different address.
  function shareFragment(mode) {
    const p = pairing();
    const h = linkFields(p, mode);
    h.s = serverUrl();
    return new URLSearchParams(h).toString();
  }

  // ─── Connection to the pairing server ────────────────────────────────────

  function connect() {
    clearTimeout(retryTimer);
    if (!enabled) return;
    setStatus('Connecting to ' + serverUrl() + ' …', 'idle');
    try { ws = new WebSocket(RemotePeer.socketUrl(serverUrl(), { room: pairing().room })); } catch (err) { setStatus('Bad server address: ' + err.message, 'error'); return; }
    const sock = ws;
    RemotePeer.keepAlive(sock);
    sock.onopen = () => {
      retryDelay = 1000;
      const p = pairing();
      sock.send(JSON.stringify({ type: 'host', room: p.room, key: p.key, viewKey: p.view, adminKey: p.admin, compKey: p.comp, pptxKey: PPTX ? p.pptx : undefined }));   // no PowerPoint key: the server refuses PowerPoint computers
    };
    sock.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      switch (m.type) {
        case 'hosted':
          hosted = true;
          serverProtocol = m.protocol || 1;   // servers from before view-only keys don't say
          if (pair.on && serverProtocol >= MIN_PROTOCOL.code) sock.send(JSON.stringify({ type: 'pair', on: true }));
          setStatus('Ready — scan the code with a phone', 'ok');
          break;
        case 'pair-code': pair.code = m.code; pair.ms = m.ms || 30000; pair.at = Date.now(); renderPanel(); break;
        case 'claim': grantClaim(m.id); break;
        case 'peer-join': addPeer(m.id, m.role); break;
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
      pair.code = null;                      // asked for again when the server is back
      for (const id of [...peers.keys()]) removePeer(id);
      if (!enabled) { setStatus('Off', 'idle'); return; }
      setStatus(`Can't reach ${serverUrl()} — retrying…`, 'error');
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    };
    sock.onerror = () => {};
  }

  // ─── Pairing a computer by code (pairing server protocol 6) ──────────────
  // "Pair a computer" asks the server for a 6-digit code (a new one every 30 s) and shows it. Typed
  // on another computer's overlay page (on the same network), the server tells us; we answer with
  // that computer's link: the view-only overlay link, plus a token that lets it past "Require a
  // PIN" (typing the code was the proof). Then the code goes away. Only while the panel is open.
  const pair = { on: false, code: null, ms: 30000, at: 0, note: '' };
  function sendServer(obj) { if (ws && ws.readyState === WebSocket.OPEN && hosted) ws.send(JSON.stringify(obj)); }
  function startPairing() {
    if (!hosted || serverProtocol < MIN_PROTOCOL.code) return;
    pair.on = true; pair.code = null; pair.note = '';
    sendServer({ type: 'pair', on: true });
    renderPanel();
  }
  function stopPairing() {
    if (!pair.on) return;
    pair.on = false; pair.code = null;
    sendServer({ type: 'pair', on: false });
    renderPanel();
  }
  function grantClaim(id) {
    if (typeof id !== 'string') return;
    if (!pair.on) { sendServer({ type: 'deny', id }); return; }
    const token = randomString(24, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
    localStorage.setItem(APPROVED_KEY, JSON.stringify(approvedTokens().concat(token).slice(-64)));
    sendServer({ type: 'grant', id, frag: shareFragment('overlay') + '&t=' + token });
    pair.on = false; pair.code = null;      // the server has dropped the code too
    const d = new Date();
    pair.note = `A computer was paired as an overlay at ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    renderPanel();
  }
  // The overlay page's address, to type on the other computer: short (<host>/o) on the Cloudflare site, whose Worker redirects it
  const overlayPage = () => {
    if (RemotePeer.defaultServer().endsWith('/ws')) return location.host + '/o';
    const u = new URL('overlay.html', location.href); u.search = ''; u.hash = ''; return u.toString();
  };

  function relayTo(id) {
    return msg => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'to', id, msg })); };
  }

  function addPeer(id, role) {
    removePeer(id);
    // 'view' only when the server says so; servers from before view-only keys send no role
    // (and reject view keys), so their phones joined with the control key.
    const entry = { id, n: ++phoneCounter, role: ['view', 'admin', 'companion', 'pptx'].includes(role) ? role : 'control', sent: {}, peer: null, deck: false, faces: [],
      varsSent: {},                              // companion peers: the raw bus variables already sent
      join: RemotePeer.joiner(), rsSub: false, rsSent: {}, upload: null,
      approved: !pinRequired(), pin: null, tries: 0, rejected: false };
    entry.peer = RemotePeer.create({
      initiator: true,
      relay: relayTo(id),
      onMessage: (msg, via) => onPhoneMessage(id, msg, via),
      onBinary: buf => onPhoneBinary(id, buf),
      onModeChange: mode => { if (mode !== 'lan') dropUpload(entry, 'The direct link was lost'); if (entry.role === 'pptx' && hub()) hub().mode(entry); renderPanel(); },
    });
    peers.set(id, entry);
    if (entry.role === 'pptx' && hub()) hub().join(entry);
    renderPanel();
  }

  function removePeer(id) {
    const e = peers.get(id);
    if (!e) return;
    dropUpload(e, null);
    e.peer.close();
    peers.delete(id);
    if (e.role === 'pptx' && hub()) hub().leave(e);
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
    nudge:         m => num(m.msecs, 1000, HOUR) && { cmd: 'nudge', addtime: !!m.addtime, msecs: m.msecs },   // eases; catch up snaps
    custommessage: m => typeof m.text === 'string' && { cmd: 'custommessage', text: m.text.slice(0, 200) },
    runsheetnext:  () => ({ cmd: 'runsheetnext' }),
    runsheetprev:  () => ({ cmd: 'runsheetprev' }),
  };

  function onPhoneMessage(id, m, via) {
    const e = peers.get(id);
    if (!e || !m || typeof m !== 'object' || e.rejected) return;
    // "Require a PIN": a phone is accepted only once the operator types the PIN it shows (or it
    // brings back the token it was given when approved before, under this code). Until then
    // nothing is sent to it and nothing else from it is acted on.
    if (!e.approved) {
      if (m.t === 'hello' && typeof m.token === 'string' && approvedTokens().includes(m.token)) {
        e.approved = true;
      } else if (m.t === 'hello') {
        e.peer.send({ t: 'pin-required' });
        return;
      } else if (m.t === 'pin' && typeof m.code === 'string' && /^\d{4}$/.test(m.code)) {
        e.pin = m.code;
        openPanel();                             // the operator has to see the request
        renderPanel();
        return;
      } else return;
    }
    // A device on the server asks for another go at a direct link (its badge tapped, a new network);
    // any role, at most every 5 s. The link itself is the timer's to start (it's the initiator).
    if (m.t === 'relink') {
      const now = Date.now();
      if (e.peer.mode === 'server' && now - (e.relinkAt || 0) > 5000) { e.relinkAt = now; e.peer.restart(); }
      return;
    }
    // A PowerPoint machine (receiver page or player script): only its own messages, all handled
    // by pptx-hub.js. It gets no timer state and can't control anything.
    if (e.role === 'pptx') {
      if (m.t === 'hello') panelConnected();
      if (hub() && typeof m.t === 'string' && /^(hello|pp-|pf-)/.test(m.t)) hub().message(e, m, via);
      return;
    }
    if (m.t === 'hello' || m.t === 'deck') deckFaces = null;   // outside a push: work them out afresh
    if (m.t === 'hello') {
      e.sent = {}; e.faces = []; e.varsSent = {};
      pushTo(e, true);
      panelConnected();
    } else if (e.role === 'companion' && m.t === 'api') {
      apiFromCompanion(e, m);
    } else if (e.role !== 'control' && e.role !== 'admin' && e.role !== 'companion') {
      return;                                  // view-only display: nothing else is accepted
    } else if (m.t === 'deck') {               // phone switched its virtual Stream Deck XL on/off
      e.deck = !!m.on; e.faces = [];
      pushTo(e, false);
    } else if (m.t === 'key') {                // virtual deck key pressed: index only, never a command
      const i = num(m.i, 0, 31);
      if (e.deck && i !== null && i === Math.floor(i) && window.StreamDeck) window.StreamDeck.press(i, 'xl');
    } else if (m.t === 'cmd' && Object.prototype.hasOwnProperty.call(ALLOWED, m.cmd)) {
      const apiMsg = ALLOWED[m.cmd](m);
      if (apiMsg && typeof processTimerApiMessage === 'function') processTimerApiMessage(apiMsg);
    } else if (m.t === 'share') {
      // An admin phone wants a link to hand to another computer. Admins only: a controller can
      // control the timer but not set up other devices.
      if (e.role !== 'admin') { e.peer.send({ t: 'share-link', req: String(m.req || '').slice(0, 40), error: 'not-admin' }); return; }
      const mode = SHARE_MODES.includes(m.mode) ? m.mode : null;
      if (!mode) return;
      if (serverProtocol < MIN_PROTOCOL[mode]) {         // an old pairing server refuses view-only keys
        e.peer.send({ t: 'share-link', req: String(m.req || '').slice(0, 40), mode, error: 'old-server' });
        return;
      }
      e.peer.send({ t: 'share-link', req: String(m.req || '').slice(0, 40), mode, frag: shareFragment(mode) });
      const d = new Date();
      shareNote = `Phone ${e.n} passed the ${mode === 'control' ? 'control' : mode === 'editor' ? 'run sheet editor' : mode === 'pptx' ? 'PowerPoint' : LINK_MODES[mode].label.toLowerCase() + ' display'} link to another computer at ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      renderPanel();
    } else if (m.t === 'adopt') {
      adopt(e, m);                             // this computer is the "other computer"
    } else if (m.t === 'part') {               // a piece of a big message (the run sheet)
      const whole = e.join(m);
      if (whole && whole.t === 'rs-save') rsSave(e, whole);
    } else if (m.t === 'rs-sub') {
      rsSubscribe(e, !!m.on);
    } else if (m.t === 'rs-save') {
      rsSave(e, m);
    } else if (m.t === 'rs-cmd') {
      rsCommand(m);
    } else if (m.t === 'vup-start') {
      uploadStart(e, m, via);
    } else if (m.t === 'vup-cancel') {
      if (e.upload && e.upload.up === m.up) dropUpload(e, null);
    }
  }

  // ─── Bitfocus Companion (role 'companion') ──────────────────────────────
  // Automation gets the whole timer API, not the phones' allow-list: {t:'api', req, msg} runs
  // processTimerApiMessage(msg) and answers {t:'api-result', req, result} (snapshot returns the
  // timer state; most commands return nothing). Only `redirect` is refused: a Companion rig
  // shouldn't be able to send the operator's browser elsewhere. It also receives the bus itself:
  // every timerAPI setVariableValues field, as diffs ({t:'vars', full, v}), which is exactly
  // Companion's own variable format (the bus was designed for it).
  const API_DENY = new Set(['redirect']);
  function apiFromCompanion(e, m) {
    const req = typeof m.req === 'string' ? m.req.slice(0, 40) : undefined;
    const msg = m.msg;
    const reply = (extra) => e.peer.send(Object.assign({ t: 'api-result', req }, extra));
    if (!msg || typeof msg !== 'object' || typeof msg.cmd !== 'string') return reply({ error: 'bad' });
    if (API_DENY.has(msg.cmd)) return reply({ error: 'refused' });
    if (typeof processTimerApiMessage !== 'function') return reply({ error: 'no-timer' });
    let result;
    try { result = processTimerApiMessage(msg); } catch (err) { return reply({ error: 'failed', detail: String(err && err.message || err).slice(0, 200) }); }
    if (result !== undefined) { try { JSON.stringify(result); } catch (_) { result = undefined; } }
    reply(result === undefined ? {} : { result });
  }
  const rawVars = {};                           // everything the bus has said, latest value per field
  function pushVars(e, full) {
    const diff = {};
    let any = false;
    for (const [k, v] of Object.entries(rawVars)) {
      if (full || e.varsSent[k] !== v) { diff[k] = v; e.varsSent[k] = v; any = true; }
    }
    if (any || full) e.peer.send({ t: 'vars', full: !!full, v: diff });
  }

  // ─── Run sheet editing from another computer ─────────────────────────────
  // A controller on a desktop shows the run sheet editor (runsheet.html) for THIS timer. It
  // gets the sheet, the show state and the live status when they change (polled here: this
  // window's own writes give no storage events), and sends back a whole edited sheet or an
  // editor command. Everything is checked: the sheet is rebuilt field by field, and videos can
  // only be ones already on the sheet or uploaded below.

  let rsTimer = null;
  const rsRaw = () => ({
    sheet: localStorage.getItem('runsheet') || '',
    state: localStorage.getItem('runsheet_state') || '',
    live: localStorage.getItem('runsheet_live') || '',
  });
  const parseOr = (text, def) => { try { const v = JSON.parse(text); return v == null ? def : v; } catch (_) { return def; } };
  function trimState(text) {
    const st = parseOr(text, {});
    // The undo history holds whole timer snapshots: the editor only needs to know there is one
    return { active: !!st.active, index: st.index, currentId: st.currentId || null, finished: !!st.finished,
      log: Array.isArray(st.log) ? st.log : [], dayBase: st.dayBase == null ? null : st.dayBase,
      historyLen: Array.isArray(st.history) ? st.history.length : 0 };
  }
  function rsPush(e, force) {
    const raw = rsRaw();
    const out = { t: 'rs-data' };
    let any = false;
    if (force || raw.sheet !== e.rsSent.sheet) { out.sheet = parseOr(raw.sheet, { title: '', perItem: 20, items: [] }); any = true; }
    if (force || raw.state !== e.rsSent.state) { out.state = trimState(raw.state); any = true; }
    if (force || raw.live !== e.rsSent.live) { out.live = parseOr(raw.live, {}); any = true; }
    if (!any) return;
    e.rsSent = raw;
    RemotePeer.sendBig(e.peer, out);
  }
  function rsSubscribe(e, on) {
    e.rsSub = on;
    if (!on) return;
    rsPush(e, true);
    if (!rsTimer) rsTimer = setInterval(() => {
      let n = 0;
      for (const p of peers.values()) if (p.rsSub && p.approved) { rsPush(p, false); n++; }
      if (!n) { clearInterval(rsTimer); rsTimer = null; }
    }, 700);
  }

  const ID_RE = /^[\w-]{1,40}$/;
  function cleanSheet(s, current) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.items) || s.items.length > 500) return null;
    const known = new Map((current.items || []).filter(it => it && it.video && it.video.key).map(it => [it.video.key, it.video]));
    const knownDecks = new Map((current.items || []).filter(it => it && it.deck && it.deck.key).map(it => [it.deck.key, it.deck]));
    const knownHolds = new Map((current.items || []).filter(it => it && it.holding && it.holding.key).map(it => [it.holding.key, it.holding]));
    const ids = new Set();
    const items = [];
    const secs = (v, max) => (v == null ? null : num(v, 0, max));
    for (const it of s.items) {
      if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !ID_RE.test(it.id) || ids.has(it.id)) return null;
      ids.add(it.id);
      const out = { id: it.id, name: typeof it.name === 'string' ? it.name.slice(0, 300) : '',
        start: secs(it.start, 2 * 86400), duration: secs(it.duration, 86400) };
      if (it.hidden === true) out.hidden = true;    // deleted after it ran: kept for the log
      // A video can stay (or move to another row), never be made up: only keys already on the sheet
      if (it.video && typeof it.video === 'object' && known.has(it.video.key)) {
        out.video = known.get(it.video.key);
        out.videoIdle = it.videoIdle === 'hide' ? 'hide' : 'show';
      }
      if (it.deck && typeof it.deck === 'object' && knownDecks.has(it.deck.key)) out.deck = knownDecks.get(it.deck.key);   // likewise slides
      if (it.holding && typeof it.holding === 'object' && knownHolds.has(it.holding.key)) out.holding = knownHolds.get(it.holding.key);
      items.push(out);
    }
    return { title: typeof s.title === 'string' ? s.title.slice(0, 200) : '', perItem: num(s.perItem, 1, 600) || 20, items };
  }
  function writeSheet(sheet) {
    const before = parseOr(localStorage.getItem('runsheet'), { items: [] });
    const text = JSON.stringify(sheet);
    localStorage.setItem('runsheet', text);
    if (window.runsheet && window.runsheet.sheetChanged) window.runsheet.sheetChanged();
    // Videos no longer on the sheet (or in Recent videos) are removed from this browser
    const keep = new Set(sheet.items.filter(it => it.video).map(it => it.video.key));
    sheet.items.forEach(it => { if (it.deck) keep.add(it.deck.key); if (it.holding) keep.add(it.holding.key); });
    parseOr(localStorage.getItem('video_history'), []).forEach(h => { if (h && h.key) keep.add(h.key); });
    (before.items || []).forEach(it => {
      if (it && it.video && !keep.has(it.video.key) && window.videoStore) window.videoStore.remove(it.video.key).catch(() => {});
      if (it && it.deck && !keep.has(it.deck.key) && window.videoStore) window.videoStore.remove(it.deck.key).catch(() => {});
      if (it && it.holding && !keep.has(it.holding.key) && window.videoStore) window.videoStore.remove(it.holding.key).catch(() => {});
    });
    return text;
  }
  function rsSave(e, m) {
    const sheet = cleanSheet(m.sheet, parseOr(localStorage.getItem('runsheet'), { items: [] }));
    if (!sheet) { e.peer.send({ t: 'rs-refused' }); return; }
    e.rsSent.sheet = writeSheet(sheet);    // the sender has it already: don't echo it back mid-typing
  }
  function rsCommand(m) {
    const rs = window.runsheet;
    if (!rs) return;
    switch (m.cmd) {
      case 'next':   processTimerApiMessage({ cmd: 'runsheetnext' }); break;
      case 'back':   processTimerApiMessage({ cmd: 'runsheetprev' }); break;
      case 'goto':   if (typeof m.id === 'string' && ID_RE.test(m.id)) rs.goTo(m.id); break;
      case 'reset':  rs.reset(); break;
      case 'active': rs.setActive(!!m.on); break;
      case 'pptxclose': if (window.pptxHub) window.pptxHub.close(); break;
      case 'pause':  processTimerApiMessage({ cmd: 'pause' }); break;
      case 'restart': if (rs.restart) rs.restart(); break;
      // The item running now: a new duration, a new end (with the next item's start), its name on screen
      case 'curdur':
        if (rs.curDuration && typeof m.id === 'string' && ID_RE.test(m.id) && (m.duration === null || num(m.duration, 1, 86400) !== null))
          rs.curDuration(m.id, m.duration);
        break;
      case 'curend':
        if (rs.curEnd && typeof m.id === 'string' && ID_RE.test(m.id) && num(m.endClock, 0, 2 * 86400) !== null &&
            (m.nextId == null || (typeof m.nextId === 'string' && ID_RE.test(m.nextId))))
          rs.curEnd(m.id, m.endClock, m.nextId || null);
        break;
      case 'livename':
        if (rs.liveName && typeof m.id === 'string' && ID_RE.test(m.id) && typeof m.name === 'string' && m.name.length <= 300)
          rs.liveName(m.id, m.name);
        break;
    }
  }

  // ─── Videos from the remote editor: LAN only ──────────────────────────────
  // A video file is sent straight over the data channel (never through the pairing server,
  // which wouldn't take it anyway): 'vup-start' must arrive on the data channel while the
  // link is direct, then the file follows as binary messages, each starting with the upload's
  // number (4 bytes). Stored like a video added in the editor here (video-store.js).

  const MAX_VIDEO = 20e9;
  async function uploadStart(e, m, via) {
    const up = num(m.up, 1, 1e9);
    const fail = reason => e.peer.send({ t: 'vup-error', up: m.up, reason });
    if (up === null) return;
    if (via !== 'lan' || e.peer.mode !== 'lan') return fail('not-lan');
    if (e.upload) return fail('busy');
    const sheet = parseOr(localStorage.getItem('runsheet'), { items: [] });
    const norm = window.RunsheetCore ? RunsheetCore.normalise(sheet) : null;
    const row = norm && norm.items.find(it => it.id === m.id);
    const size = num(m.size, 1, MAX_VIDEO);
    const kind = m.kind === 'deck' || m.kind === 'holding' ? m.kind : 'video';
    if (kind !== 'video' && !PPTX) return fail('bad');
    const typeOk = kind === 'deck' ? typeof m.name === 'string' && /\.(pptx|ppsx|pptm|ppsm|ppt|pps|potx)$/i.test(m.name)
                 : kind === 'holding' ? typeof m.name === 'string' && /\.(png|jpe?g|bmp)$/i.test(m.name)
                 : typeof m.type === 'string' && /^video\//.test(m.type);
    if (!row || row.isEnd || size === null || !typeOk || !window.videoStore) return fail('bad');
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (est.quota && (est.usage || 0) + size > est.quota * 0.9) return fail('no-space');
      }
    } catch (_) { /* go ahead */ }
    if (e.upload) return fail('busy');
    e.upload = { up, id: m.id, size, kind, type: String(m.type || '').slice(0, 100),
      name: typeof m.name === 'string' ? m.name.slice(0, 200) : 'video',
      duration: num(m.duration, 0, 86400), got: 0, chunks: [], blobs: [], chunkBytes: 0 };
    e.upload.step = Math.max(256 << 10, Math.ceil(size / 50));    // progress reports: about every 2 %
    e.upload.nextProg = e.upload.step;
    e.peer.send({ t: 'vup-ok', up });
  }

  function onPhoneBinary(id, buf) {
    const e = peers.get(id);
    if (!e || (e.role !== 'control' && e.role !== 'admin' && e.role !== 'companion') || !e.upload || !(buf instanceof ArrayBuffer) || buf.byteLength < 5) return;
    const u = e.upload;
    if (new DataView(buf).getUint32(0, true) !== u.up) return;
    const data = buf.slice(4);
    u.got += data.byteLength;
    if (u.got > u.size) return dropUpload(e, 'too-big');
    u.chunks.push(data); u.chunkBytes += data.byteLength;
    if (u.chunkBytes >= 16 << 20) {             // let the browser keep big files on disk
      u.blobs.push(new Blob(u.chunks)); u.chunks = []; u.chunkBytes = 0;
    }
    if (u.got >= u.nextProg) { u.nextProg += u.step; e.peer.send({ t: 'vup-prog', up: u.up, got: u.got }); }
    if (u.got === u.size) uploadFinish(e, u);
  }

  async function uploadFinish(e, u) {
    e.upload = null;
    const blob = new Blob(u.blobs.concat(u.chunks.length ? [new Blob(u.chunks)] : []), { type: u.type });
    const key = (u.kind === 'deck' ? 'rsdeck:' : u.kind === 'holding' ? 'rsimg:' : 'rsvideo:') + u.id + ':' + Date.now();
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      await window.videoStore.put(key, blob);
    } catch (_) { e.peer.send({ t: 'vup-error', up: u.up, reason: 'store' }); return; }
    const sheet = parseOr(localStorage.getItem('runsheet'), { title: '', perItem: 20, items: [] });
    const it = (sheet.items || []).find(x => x && x.id === u.id);
    if (!it) { window.videoStore.remove(key).catch(() => {}); e.peer.send({ t: 'vup-error', up: u.up, reason: 'gone' }); return; }
    if (u.kind === 'deck' || u.kind === 'holding') {          // slides: sent on to the PowerPoint computers by pptx-hub.js
      it[u.kind] = { key, name: u.name, size: u.size };
      if (!it.name && u.kind === 'deck') it.name = u.name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
      writeSheet(sheet);
      e.peer.send({ t: 'vup-done', up: u.up, key });
      return;
    }
    const secs = u.duration ? Math.max(1, Math.floor(u.duration + 0.25)) : null;
    it.video = { key, name: u.name, size: u.size, duration: secs };
    if (!it.videoIdle) it.videoIdle = 'show';
    if (!it.name) it.name = u.name;
    if (it.duration == null && secs) it.duration = secs;      // the item runs as long as the video
    writeSheet(sheet);                                        // removes the item's old video too
    e.peer.send({ t: 'vup-done', up: u.up, key });
  }

  function dropUpload(e, reason) {
    if (!e || !e.upload) return;
    const up = e.upload.up;
    e.upload = null;
    if (reason) try { e.peer.send({ t: 'vup-error', up, reason }); } catch (_) { /* gone */ }
  }

  // ─── Becoming a remote or display of another timer (admin phone) ──────────
  // A controller of THIS timer (it scanned our Control code) passes on another timer's link.
  // We check it's a well-formed link, say what's about to happen, and after a few seconds open
  // it here, unless someone at this computer cancels.
  let shareNote = '';
  function adopt(e, m) {
    const req = String(m.req || '').slice(0, 40);
    const f = Object.fromEntries(new URLSearchParams(typeof m.frag === 'string' ? m.frag.slice(0, 600) : ''));
    const okRoom = /^[A-Za-z0-9]{6,32}$/.test(f.r || '');
    const okKey = k => typeof k === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(k);
    const isControl = okKey(f.k) && !f.v && !f.p, isView = okKey(f.v) && !f.k && !f.p && (f.m === 'countdown' || f.m === 'runsheet');
    const isPptx = okKey(f.p) && !f.k && !f.v;                       // this computer becomes a PowerPoint computer (pptx.html)
    const okServer = /^wss:\/\/[^\s#?]+$/i.test(f.s || '');
    if (!okRoom || !okServer || !(isControl || isView || isPptx) || f.r === pairing().room) {
      e.peer.send({ t: 'adopt-refused', req });
      return;
    }
    const h = isControl ? { r: f.r, k: f.k, s: f.s } : isPptx ? { r: f.r, p: f.p, s: f.s } : { r: f.r, v: f.v, m: f.m, s: f.s };
    if (isControl && f.m === 'runsheet') h.m = 'runsheet';          // open straight into the run sheet editor
    const url = new URL(isPptx ? 'pptx.html' : 'remote.html', location.href);
    url.search = '';
    url.hash = new URLSearchParams(h).toString();
    const what = isPptx ? 'a PowerPoint computer (it receives the run sheet’s slides)'
      : isControl ? (f.m === 'runsheet' ? 'a run sheet editor' : 'a remote control') : f.m === 'runsheet' ? 'a run sheet display' : 'a countdown display';
    e.peer.send({ t: 'adopt-ok', req });
    showAdoptNotice(what, url.toString(), () => { const p = peers.get(e.id); if (p) p.peer.send({ t: 'adopt-cancelled', req }); });
  }

  function showAdoptNotice(what, url, onCancel) {
    injectStyles();
    let el = document.getElementById('adopt-notice');
    if (el) el.remove();
    el = document.createElement('div');
    el.id = 'adopt-notice';
    el.innerHTML = `<div class="an-box">
        <div class="an-title">This computer is being set up as ${what} for another timer</div>
        <div class="an-text">Sent from a phone with control of this timer. Opening in <b class="an-n">8</b> s…</div>
        <div class="an-row"><button class="an-open">Open now</button><button class="an-cancel">Cancel</button></div>
      </div>`;
    document.body.appendChild(el);
    let n = 8;
    const go = () => { clearInterval(t); location.href = url; };
    const t = setInterval(() => { n -= 1; el.querySelector('.an-n').textContent = n; if (n <= 0) go(); }, 1000);
    el.querySelector('.an-open').addEventListener('click', go);
    el.querySelector('.an-cancel').addEventListener('click', () => { clearInterval(t); el.remove(); onCancel(); });
  }

  // ─── State for phones (from the timerAPI bus) ────────────────────────────

  const truthy = v => v === true || v === 'true' || v === '1' || v === 1;
  const MAP = {      // timerAPI variable -> [phone field, convert]
    remain: ['remain', String], expired: ['over', truthy], impending: ['impending', truthy],
    pausing: ['paused', truthy], adjusting_up: ['adjUp', truthy], adjusting_down: ['adjDown', truthy],
    custommsg: ['msg', String], default: ['def', String],
    rs_active: ['rsOn', truthy], rs_current: ['rsNow', String], rs_next: ['rsNext', String],
    rs_can_back: ['rsBack', truthy], rs_status: ['rsStatus', String], rs_late: ['rsLate', v => (v === '' ? null : Number(v))],
    rs_title: ['rsTitle', String], rs_text: ['rsText', String], rs_list: ['rsList', String],
    // The timer's B / T / M switches and the progress bar, for the phone's countdown display
    showbar: ['bar', truthy], showtimenow: ['clock', truthy], showmessages: ['msgs', truthy], barpct: ['pct', Number],
    htmlclass: ['cls', String],          // the timer's class list, for desktop displays (display.html)
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
          const raw = v[k];
          if ((typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' || raw === null) && rawVars[k] !== raw) { rawVars[k] = raw; changed = true; }
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
      for (const e of peers.values()) if (e.approved) pushTo(e, false);
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
    if (e.role === 'pptx') return;             // PowerPoint machines get no timer state
    const diff = {};
    let any = false;
    for (const [k, v] of Object.entries(state)) {
      if (full || e.sent[k] !== v) { diff[k] = v; e.sent[k] = v; any = true; }
    }
    if (any || full) e.peer.send({ t: 'state', full: !!full, s: diff });
    if (e.role === 'companion') pushVars(e, full);
    if (e.deck && e.role !== 'view') pushDeck(e);
  }

  // ─── Panel ───────────────────────────────────────────────────────────────

  // The panel's styles live here, not in timer.css, so they always match this script.
  // (A browser holding a cached timer.css from before this feature showed the panel unstyled,
  // in the page flow underneath the button bar.)
  const PANEL_CSS = `

#phone-panel {
  /* Below the button bar (which grows when zoomed buttons wrap), above everything else except the
     full-screen QR and help; scrolls if the window is short */
  position: fixed; top: calc(var(--buttons-bottom, 48px) + 8px); right: 16px; width: 440px; max-width: calc(100vw - 32px); z-index: 2147481000;   /* room for all six link buttons */
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
#phone-panel .pp-link.pp-paste { font-size: 11px; color: #bbb; max-height: none; user-select: text; cursor: text; background: #000; border: 1px solid #333; border-radius: 4px; padding: 6px; }
#phone-panel .pp-row { display: flex; gap: 6px; margin-top: 6px; }
#phone-panel button { flex: 1; padding: 5px 4px; font-size: 12px; background: #222; border: 1px solid #444; color: #ccc; border-radius: 4px; cursor: pointer; }
#phone-panel button:hover { background: #333; color: #fff; }
#phone-panel .pp-peers { margin-top: 8px; font-size: 12px; }
#phone-panel .pp-pin { display: block; font-size: 12px; color: #bbb; margin: 6px 0 2px; cursor: pointer; }
#phone-panel .pp-pin input { vertical-align: middle; margin: 0 4px 0 0; }
#phone-panel .pp-ask { background: #2a2200; border: 1px solid #665200; border-radius: 6px; padding: 8px; margin: 6px 0; font-size: 13px; color: #ffe08a; }
#phone-panel .pp-askrow { display: flex; gap: 6px; margin-top: 6px; }
#phone-panel .pp-askrow input { width: 5em; flex: none; font: 18px "Helvetica Neue", Arial, sans-serif; letter-spacing: .2em; text-align: center;
  background: #111; color: #fff; border: 1px solid #665200; border-radius: 4px; padding: 4px; }
#phone-panel .pp-askrow button { flex: 1; }
#phone-panel.pp-touch .pp-pin { font-size: 14px; margin: 8px 0 4px; }
#phone-panel.pp-touch .pp-ask { font-size: 15px; }
#phone-panel.pp-touch .pp-askrow input { font-size: 24px; width: 4.2em; }
/* On a phone/tablet: a bottom sheet (the button bar isn't shown there) */
#phone-panel.pp-touch { top: auto; right: 0; left: 0; bottom: 0; width: auto; max-height: calc(100vh - 16px); max-height: calc(100dvh - 16px);
  border-radius: 16px 16px 0 0; padding: 14px 16px calc(16px + env(safe-area-inset-bottom)); font-size: 15px; z-index: 2147481500; }
#phone-panel.pp-touch .pp-head { font-size: 17px; }
#phone-panel.pp-touch .pp-close { font-size: 22px; padding: 4px 8px; }
#phone-panel.pp-touch .pp-intro { color: #aaa; font-size: 14px; margin-bottom: 8px; }
#phone-panel.pp-touch .pp-status { font-size: 13px; }
#phone-panel.pp-touch .pp-modes button { font-size: 15px; padding: 10px 6px; }
#phone-panel.pp-touch .pp-modehint { font-size: 14px; margin: 6px 0 10px; }
#phone-panel.pp-touch .pp-qr canvas { max-height: min(60vw, calc(100vh - 360px)); }
#phone-panel.pp-touch .pp-link { display: none; }
#phone-panel.pp-touch .pp-row button { font-size: 15px; padding: 10px 6px; }
#phone-panel.pp-touch .pp-peers { font-size: 14px; }
#phone-panel.pp-touch .pp-adv[hidden] { display: none; }
/* Sideways: the code on the right, everything else on the left */
@media (max-height: 500px) {
  #phone-panel.pp-touch { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 16px; align-content: start; }
  #phone-panel.pp-touch[hidden] { display: none; }
  #phone-panel.pp-touch > * { grid-column: 1; }
  #phone-panel.pp-touch .pp-qr { grid-column: 2; grid-row: 1 / span 8; align-self: start; }
  #phone-panel.pp-touch .pp-qr canvas { max-height: calc(100vh - 44px); }
}
#phone-panel .pp-modes { display: flex; gap: 0; margin: 2px 0 6px; }
html.no-pptx #phone-panel .pp-modes button[data-mode="pptx"] { display: none; }
#phone-panel .pp-modes button { border-radius: 0; margin: 0; }
#phone-panel .pp-modes button:first-child { border-radius: 4px 0 0 4px; }
#phone-panel .pp-modes button:last-child { border-radius: 0 4px 4px 0; }
#phone-panel .pp-modes button + button { border-left: 0; }
#phone-panel .pp-modes button.on { background: #0b3d5c; border-color: #2a6a9a; color: #fff; }
#phone-panel .pp-modehint { font-size: 11px; color: #999; margin-bottom: 6px; }
#phone-panel .pp-modehint b { color: #fff; }
#phone-panel .pp-view { color: #9ab; }
#phone-panel .pp-admin { color: #e0a0ff; }
#phone-panel .pp-modes button.on[data-mode="admin"] { background: #4a2060; border-color: #8a4aaa; }
#phone-panel .pp-warn { color: #ff9a6a; }
#adopt-notice { position: fixed; inset: 0; z-index: 2147483100; background: rgba(0,0,0,.85); display: flex;
  align-items: center; justify-content: center; font: 18px/1.4 "Helvetica Neue", Arial, sans-serif; color: #ddd; }
#adopt-notice .an-box { background: #111; border: 1px solid #2a6a9a; border-radius: 12px; padding: 24px 28px; max-width: 560px; }
#adopt-notice .an-title { font-size: 22px; color: #fff; font-weight: bold; margin-bottom: 8px; }
#adopt-notice .an-row { display: flex; gap: 10px; margin-top: 18px; }
#adopt-notice button { flex: 1; padding: 10px; font-size: 16px; border-radius: 6px; border: 1px solid #444; background: #222; color: #eee; cursor: pointer; }
#adopt-notice .an-open { background: #0b3d5c; border-color: #2a6a9a; }
#phone-panel .pp-code { margin: 8px 0 4px; padding: 8px; border: 1px solid #2a6a9a; border-radius: 6px; background: #0b1a26; }
#phone-panel .pp-code[hidden] { display: none; }
#phone-panel .pp-code .pp-digits { font: bold 40px/1.1 "Helvetica Neue", Arial, sans-serif; letter-spacing: .12em; text-align: center; color: #fff; font-variant-numeric: tabular-nums; }
#phone-panel .pp-code .pp-ttl { height: 3px; background: #2a6a9a; margin: 6px 0; transform-origin: left; }
#phone-panel .pp-code .pp-codehint { font-size: 12px; color: #9ab; }
#phone-panel .pp-code .pp-codehint b { color: #fff; user-select: all; }
@keyframes pp-ttl { from { transform: scaleX(1); } to { transform: scaleX(0); } }
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
    if (TOUCH) el.classList.add('pp-touch');
    el.innerHTML = `
      <div class="pp-head"><b>${TOUCH ? 'Let a friend control this timer' : 'Share this timer'}</b> <span class="pp-exp">experimental</span><button class="pp-close" aria-label="Close">✕</button></div>
      ${TOUCH ? '<div class="pp-intro">They scan this code with their phone. Choose what their phone becomes:</div>' : ''}
      <div class="pp-status"></div>
      <div class="pp-modes" role="group" aria-label="What the QR code is for">
        <button data-mode="control">${TOUCH ? 'Remote control' : 'Control'}</button><button data-mode="countdown">${TOUCH ? 'Countdown display' : 'Countdown'}</button>${TOUCH ? '' : '<button data-mode="runsheet">Run sheet</button><button data-mode="admin">Admin</button><button data-mode="companion">Companion</button><button data-mode="pptx">PowerPoint</button>'}
      </div>
      <div class="pp-modehint"></div>
      <div class="pp-qr"></div>
      <div class="pp-link"></div>
      <div class="pp-code" hidden></div>
      <label class="pp-pin"><input type="checkbox" class="pp-pin-box"> Require a PIN <span class="pp-hint">— a new phone shows a 4-digit PIN; type it here to let it in</span></label>
      <div class="pp-pending"></div>
      <div class="pp-row"><button class="pp-pair" title="Show a 6-digit code to type on another computer on this network (no QR code or link needed)">Pair a computer</button></div>
      <div class="pp-row"><button class="pp-copy">Copy link</button><button class="pp-renew" title="Disconnect all phones and make a new code">New code</button><button class="pp-toggle"></button></div>
      <div class="pp-peers"></div>
      <details class="pp-adv"${TOUCH ? ' hidden' : ''}><summary>Server</summary>
        <div class="pp-row"><input class="pp-server" spellcheck="false"><button class="pp-apply">Apply</button></div>
        <div class="pp-hint">Default: ${RemotePeer.defaultServer()}. Phones on the same Wi-Fi connect directly; otherwise through the server.</div>
      </details>`;
    document.body.appendChild(el);
    el.querySelector('.pp-close').addEventListener('click', () => { el.hidden = true; stopPairing(); });
    el.querySelector('.pp-pair').addEventListener('click', () => (pair.on ? stopPairing() : startPairing()));
    el.querySelector('.pp-pin-box').addEventListener('change', ev => {
      if (ev.target.checked) localStorage.setItem(PIN_KEY, '1');
      else {
        localStorage.removeItem(PIN_KEY);
        for (const e of peers.values()) if (!e.approved && !e.rejected) { e.approved = true; e.pin = null; e.peer.send({ t: 'pin-ok' }); }
      }
      renderPanel();
    });
    el.querySelector('.pp-pending').addEventListener('click', ev => {
      const b = ev.target.closest('button[data-act]');
      if (!b) return;
      const row = b.closest('[data-id]');
      const e = peers.get(row.dataset.id);
      if (b.dataset.act === 'ok') approvePeer(e, row.querySelector('input').value.trim());
      else rejectPeer(e);
    });
    el.querySelector('.pp-pending').addEventListener('keydown', ev => {
      if (ev.key !== 'Enter' || ev.target.tagName !== 'INPUT') return;
      const row = ev.target.closest('[data-id]');
      approvePeer(peers.get(row.dataset.id), ev.target.value.trim());
    });
    el.querySelector('.pp-qr').addEventListener('click', showBigQR);
    el.querySelectorAll('.pp-modes button').forEach(b => b.addEventListener('click', () => {
      localStorage.setItem(LINK_MODE_KEY, b.dataset.mode);
      renderPanel();
    }));
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
    const lm = linkMode();
    cap.textContent = (lm === 'control' ? 'Scan with a phone to control the timer' :
      lm === 'admin' ? 'Admin code: control, every view, and setting up other computers' :
      'Scan for a view-only ' + (lm === 'runsheet' ? 'run sheet' : 'countdown') + ' display') + ' · click to close';
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
      qrLib.src = 'qrcode.min.js';               // qrcodejs 1.0.0 (MIT, qrcode-LICENSE.txt), bundled: no internet needed
      qrLib.onerror = () => { box.textContent = 'QR code unavailable — use Copy link'; };
      document.head.appendChild(qrLib);
    }
    qrLib.addEventListener('load', render, { once: true });
  }

  function renderPanel(force) {
    const el = document.getElementById('phone-panel');
    const btn = document.getElementById('btnshare');
    const lanCount = [...peers.values()].filter(e => e.peer.mode !== 'server' && e.role !== 'pptx').length;   // direct, either way
    if (btn) btn.textContent = !enabled ? 'share' : peers.size ? `share ${peers.size}` : 'share ·';
    if (!el) return;
    const st = el.querySelector('.pp-status');
    st.textContent = statusText; st.dataset.kind = statusKind;
    el.querySelector('.pp-toggle').textContent = enabled ? 'Turn off' : 'Turn on';
    el.querySelector('.pp-qr').style.display = enabled ? '' : 'none';
    const mode = linkMode();
    el.querySelectorAll('.pp-modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    el.querySelector('.pp-modes').style.display = enabled ? '' : 'none';
    // View-only links need pairing server protocol 2; an older server rejects their key
    const oldServer = hosted && serverProtocol < MIN_PROTOCOL[mode];
    el.querySelector('.pp-modehint').innerHTML = !enabled ? '' : oldServer
      ? `<span class="pp-warn">The pairing server is out of date and will refuse ${mode === 'admin' ? 'admin' : mode === 'companion' ? 'Companion' : mode === 'pptx' ? 'PowerPoint' : 'view-only'} links. Update remote-server.js on the server and restart it.</span>`
      : TOUCH ? (mode === 'control'
          ? 'Their phone gets <b>Start</b>, <b>Pause</b>, ±1 min, presets and messages, a virtual Stream Deck, or a countdown display: they choose with ☰ View on their phone.'
          : '<b>View only</b>: a big countdown and messages on their phone. It can’t change the timer.')
      : LINK_MODES[mode].hint;
    el.querySelector('.pp-link').textContent = enabled ? phoneLink() : '';
    const paste = PASTE_MODES.includes(mode);               // meant to be copied, not scanned
    el.querySelector('.pp-link').classList.toggle('pp-paste', paste);
    el.querySelector('.pp-qr').hidden = paste;
    if (enabled && !paste) drawQR(phoneLink());
    renderPairing(el);
    el.querySelector('.pp-pin').style.display = enabled ? '' : 'none';
    el.querySelector('.pp-pin-box').checked = pinRequired();
    const pend = el.querySelector('.pp-pending');
    const rows = pending();
    const keep = {};
    pend.querySelectorAll('[data-id]').forEach(r => { keep[r.dataset.id] = r.querySelector('input').value; });
    pend.innerHTML = rows.map(e => `<div class="pp-ask" data-id="${e.id}"><b>${e.role === 'view' ? 'A display' : e.role === 'companion' ? 'Companion' : e.role === 'pptx' ? 'A PowerPoint computer' : 'A phone'} wants to connect.</b> Type the PIN it shows${e.role === 'companion' ? ' (in its connection log)' : e.role === 'pptx' ? ' (on its receiver page or in the player window)' : ''}:
        <span class="pp-askrow"><input inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" placeholder="PIN" value="${keep[e.id] || ''}">
        <button data-act="ok">Let it in</button><button data-act="no">Refuse</button></span>${e.wrong ? '<div class="pp-warn">That’s not it. ' + (3 - e.tries) + ' more tr' + (e.tries === 2 ? 'y' : 'ies') + '.</div>' : ''}</div>`).join('');
    if (rows.length && !keep[rows[0].id]) { const i = pend.querySelector('input'); if (i && !TOUCH) i.focus(); }
    const srv = el.querySelector('.pp-server');
    if (force || document.activeElement !== srv) srv.value = serverUrl();
    const pptxLines = hub() ? hub().summary().map(hub().describe).join('') : '';
    el.querySelector('.pp-peers').innerHTML = !peers.size ? (enabled ? '<i>No phones connected</i>' : '') :
      pptxLines + [...peers.values()].filter(e => !e.rejected && (e.role !== 'pptx' || !e.approved)).map(e => `<div>${e.role === 'view' ? 'Display' : e.role === 'companion' ? 'Companion' : e.role === 'pptx' ? 'PowerPoint' : 'Phone'} ${e.n} · ` +
        (!e.approved ? '<span class="pp-warn">waiting for its PIN</span> · ' : '') +
        (e.role === 'view' ? '<span class="pp-view">view only</span> · ' : e.role === 'admin' ? '<span class="pp-admin">admin</span> · ' : '') +
        `${e.peer.mode === 'lan' ? '<b class="pp-lan">LAN direct</b>' : e.peer.mode === 'p2p' ? '<b class="pp-lan" title="A direct link over the internet: not the same network">direct</b>' : '<b class="pp-srv">via server</b>'}</div>`).join('') +
      (lanCount < [...peers.values()].filter(e => e.role !== 'pptx').length ? '<div class="pp-hint">"via server": no direct link could be made (a network in between blocks it).</div>' : '') +
      (shareNote ? `<div class="pp-hint">${shareNote}</div>` : '');
  }

  function renderPairing(el) {
    const btn = el.querySelector('.pp-pair'), box = el.querySelector('.pp-code');
    btn.parentElement.style.display = enabled && !TOUCH ? '' : 'none';
    const ok = hosted && serverProtocol >= MIN_PROTOCOL.code;
    btn.disabled = !ok;
    btn.textContent = pair.on ? 'Cancel pairing' : 'Pair a computer';
    btn.title = ok || !hosted ? btn.title : 'The pairing server is out of date: update remote-server.js (protocol 6) to pair by code';
    box.hidden = !enabled || !(pair.on || pair.note);
    // While a code is up it takes the QR code's place
    el.querySelector('.pp-qr').style.display = enabled && !pair.on ? '' : 'none';
    el.querySelector('.pp-link').style.display = pair.on ? 'none' : '';
    el.querySelector('.pp-modes').style.display = enabled && !pair.on ? '' : 'none';   // the code isn't one of these links
    el.querySelector('.pp-modehint').style.display = pair.on ? 'none' : '';
    if (pair.on && statusKind === 'ok') el.querySelector('.pp-status').textContent = 'Ready — type this code on the other computer';   // not "scan the code"
    if (!pair.on) { box.dataset.code = ''; box.innerHTML = pair.note ? `<div class="pp-codehint">${pair.note}</div>` : ''; return; }
    if (box.dataset.code === (pair.code || '-')) return;          // keep the countdown bar running
    box.dataset.code = pair.code || '-';
    const left = pair.code ? Math.max(0, pair.ms - (Date.now() - pair.at)) : 0;
    box.innerHTML = !pair.code ? '<div class="pp-codehint">Getting a code…</div>' :
      `<div class="pp-digits">${pair.code.slice(0, 3)} ${pair.code.slice(3)}</div>` +
      `<div class="pp-ttl" style="animation: pp-ttl ${left}ms linear forwards"></div>` +
      `<div class="pp-codehint">On the other computer (same network), open <b>${esc(overlayPage())}</b> and type this code. ` +
      'It becomes a countdown overlay. The code changes every 30 s and works once.</div>';
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ─── Require a PIN ───────────────────────────────────────────────────────

  const pinRequired = () => localStorage.getItem(PIN_KEY) === '1';
  function approvedTokens() {
    try { const v = JSON.parse(localStorage.getItem(APPROVED_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; }
  }
  const pending = () => [...peers.values()].filter(e => !e.approved && e.pin && !e.rejected);
  function approvePeer(e, entered) {
    if (!e || e.approved || e.rejected) return;
    if (entered !== e.pin) {
      e.tries++;
      if (e.tries >= 3) { rejectPeer(e); return; }
      e.wrong = true; renderPanel(); return;
    }
    const token = randomString(24, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
    localStorage.setItem(APPROVED_KEY, JSON.stringify(approvedTokens().concat(token).slice(-64)));
    e.approved = true; e.pin = null; e.wrong = false;
    e.peer.send({ t: 'pin-ok', token });       // the phone says hello again and gets its state
    renderPanel();
  }
  function rejectPeer(e) {
    if (!e) return;
    e.rejected = true; e.pin = null;
    try { e.peer.send({ t: 'pin-rejected' }); } catch (_) { /* gone */ }
    renderPanel();
  }

  // Once a phone is connected (and approved), the code is put away: it needn't stay on screen
  // for anyone walking past to scan. Opened again with the share button when wanted.
  function panelConnected() {
    const el = document.getElementById('phone-panel');
    if (!el || el.hidden || pending().length) return;
    const big = document.getElementById('phone-qr-big');
    if (big) big.remove();
    el.hidden = true;
    renderPanel();
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
    if (el.hidden) stopPairing();
    if (!el.hidden) {
      document.dispatchEvent(new CustomEvent('timer-panel', { detail: 'phone' }));   // one panel at a time
      if (!enabled) enable();
      renderPanel(true);
    }
  }

  function init() {
    installBus();
    document.getElementById('btnshare')?.addEventListener('click', togglePanel);
    document.addEventListener('timer-panel', e => { const el = document.getElementById('phone-panel'); if (e.detail !== 'phone' && el) { el.hidden = true; stopPairing(); } });
    if (localStorage.getItem(ENABLED_KEY) === '1') { panel(); enable(); }
    renderPanel();
  }

  function openPanel() { const el = panel(); if (el.hidden) togglePanel(); }
  // The phone's Back button closes the panel (and the full-screen code) before anything else
  if (typeof BackGuard !== 'undefined') BackGuard.register(() => {
    const big = document.getElementById('phone-qr-big');
    if (big) { big.click(); return true; }
    const el = document.getElementById('phone-panel');
    if (el && !el.hidden) { el.hidden = true; return true; }
    return false;
  });

  const hub = () => window.pptxHub || null;     // pptx-hub.js: the PowerPoint machines
  window.remoteControl = { open: openPanel, toggle: togglePanel, enable, disable, refresh: () => renderPanel(), get peers() { return peers; }, get state() { return state; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
