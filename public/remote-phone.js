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

  const BADGE_ICON = { lan: '⚡', server: '⇄', off: '•' };   // the landscape deck strip shows icons only
  function setBadge(kind, text, note) {
    const b = $('link-badge');
    b.className = kind;
    b.title = text + (note ? ' — ' + note : '');
    b.querySelector('.long').textContent = text;
    b.querySelector('.short').textContent = BADGE_ICON[kind] || '•';
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
    if (view === 'deck') peer.send({ t: 'deck', on: true });
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
    if (m && m.t === 'deck') return onDeck(m);
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
    scheduleFit();
  }

  // ─── Simple view: fit the screen ─────────────────────────────────────────
  // Everything in the simple view is sized in em, so one number (html's font-size) scales it.
  // Pick the largest size at which it fits the screen without scrolling, whatever the shape
  // (tall phone, landscape, an almost square foldable or tablet). Refit when the content
  // changes shape: run sheet card shown, message length, countdown gaining an hour digit.
  let fitSig = '', fitTimer = null;
  function scheduleFit(force) {
    const sig = [view, innerWidth, innerHeight, !!state.rsOn, (state.msg || '').length, (state.remain || '').length,
      (state.rsNow || '').length, (state.rsNext || '').length].join('|');
    if (!force && sig === fitSig) return;
    fitSig = sig;
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitSimple, 30);
  }
  function fitSimple() {
    if (view !== 'simple' || $('app').hidden) return;
    // Don't shrink everything while the on-screen keyboard is up
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    // Widths are checked per element: on a phone, content that's too wide makes the page itself
    // wider (innerWidth grows with it), so comparing against the window would always pass.
    const root = document.documentElement, simple = $('simple'), remain = $('remain');
    const wide = el => el.scrollWidth > el.clientWidth + 1;
    const fits = px => {
      root.style.fontSize = px + 'px';
      return root.scrollHeight <= innerHeight + 1 && !wide(simple) && !wide(remain) &&
        ![...simple.querySelectorAll('.grid, .presets, .send')].some(wide);
    };
    let lo = 9, hi = 48;
    if (!fits(lo)) return;                 // tiny screen: smallest size, and it scrolls
    while (hi - lo > 0.5) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    fits(Math.floor(lo * 2) / 2);
  }
  window.addEventListener('resize', () => scheduleFit());
  document.addEventListener('focusout', () => setTimeout(() => scheduleFit(true), 300));   // keyboard closed

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

  // ─── Virtual Stream Deck XL ──────────────────────────────────────────────
  // The timer sends each key's face (colours and text, from its XL layout) and only the keys
  // that change; we draw them with the same code as the real deck (deck-face.js). A press
  // sends just the key's number; the timer runs that key's action.

  const VIEW_KEY = 'remote_view';
  let view = 'simple';
  try { view = localStorage.getItem(VIEW_KEY) === 'deck' ? 'deck' : 'simple'; } catch (_) { /* private mode */ }
  const faces = [];
  const canvases = [];
  const SHOW_ONLY = new Set(['countdown', 'countdown_major', 'countdown_minor', 'rs_status', 'empty']);   // display keys
  let keyCss = 40;

  function setView(v) {
    view = v;
    try { localStorage.setItem(VIEW_KEY, v); } catch (_) { /* ignore */ }
    document.body.classList.toggle('deckview', v === 'deck');
    if (v !== 'deck') document.body.classList.remove('side');
    $('viewbtn').querySelector('.long').textContent = v === 'deck' ? '☰ Simple' : '▦ Deck';
    $('viewbtn').querySelector('.short').textContent = v === 'deck' ? '☰' : '▦';
    if (v === 'deck') { document.documentElement.style.fontSize = ''; layoutDeck(); }
    else scheduleFit(true);
    if (peer) peer.send({ t: 'deck', on: v === 'deck' });
  }
  $('viewbtn').addEventListener('click', () => setView(view === 'deck' ? 'simple' : 'deck'));

  function buildKeys() {
    const box = $('keys');
    for (let i = 0; i < 32; i++) {
      const c = document.createElement('canvas');
      c.className = 'idle';
      c.addEventListener('pointerdown', e => { e.preventDefault(); pressKey(i, c); });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => c.addEventListener(t, () => c.classList.remove('down')));
      c.addEventListener('contextmenu', e => e.preventDefault());   // no long-press menu
      box.appendChild(c);
      canvases.push(c);
    }
  }

  // Size the keys to fill the screen: as big as fit (square, like the real deck), with the
  // spare space shared out between them. Landscape moves the top bar into a narrow strip
  // down the side (body.side), so the keys get the full height.
  function layoutDeck() {
    if (view !== 'deck') return;
    const root = document.documentElement, body = document.body;
    const side = innerWidth > innerHeight * 1.15;
    body.classList.toggle('side', side);
    if (!side) root.style.setProperty('--top-h', Math.ceil(document.querySelector('.top').getBoundingClientRect().bottom) + 'px');
    $('deckhint').textContent = side || innerWidth > 560 ? '' : 'Turn your phone sideways for bigger keys';

    const deck = $('deck'), cs = getComputedStyle(deck);
    const hint = $('deckhint').textContent ? $('deckhint').getBoundingClientRect().height + 16 : 0;
    const W = deck.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H = deck.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - hint;
    const MIN_GAP = 0.08, MAX_GAP = side ? 0.6 : 0.2;          // gaps as a fraction of a key
    keyCss = Math.max(20, Math.floor(Math.min(W / (8 + 7 * MIN_GAP), H / (4 + 3 * MIN_GAP))));
    const colGap = Math.min((W - 8 * keyCss) / 7, keyCss * MAX_GAP);
    const rowGap = Math.min((H - 4 * keyCss) / 3, keyCss * MAX_GAP);
    root.style.setProperty('--key', keyCss + 'px');
    root.style.setProperty('--col-gap', Math.max(0, Math.floor(colGap)) + 'px');
    root.style.setProperty('--row-gap', Math.max(0, Math.floor(rowGap)) + 'px');
    canvases.forEach((_, i) => drawKey(i));
  }
  window.addEventListener('resize', layoutDeck);
  window.addEventListener('orientationchange', () => setTimeout(layoutDeck, 250));   // some phones report the new size late

  function drawKey(i) {
    const c = canvases[i], f = faces[i];
    if (!c) return;
    const px = Math.round(keyCss * (window.devicePixelRatio || 1));
    if (c.width !== px) { c.width = c.height = px; }
    const ctx = c.getContext('2d');
    if (!f) { ctx.fillStyle = '#0d0d0d'; ctx.fillRect(0, 0, px, px); return; }
    DeckFace.paint(ctx, f, px);
    c.className = f.press ? '' : SHOW_ONLY.has(f.a) ? 'idle' : 'idle off';
  }

  function onDeck(m) {
    if (m.none) { $('deckhint').textContent = 'The timer has no Stream Deck support loaded.'; return; }
    if (!m.k || typeof m.k !== 'object') return;
    for (const [i, f] of Object.entries(m.k)) {
      const n = Number(i);
      if (n >= 0 && n < 32 && f && typeof f === 'object') { faces[n] = f; if (view === 'deck') drawKey(n); }
    }
  }

  function pressKey(i, c) {
    const f = faces[i];
    if (!f || !f.press) return;
    c.classList.add('down');
    if (navigator.vibrate) navigator.vibrate(12);
    if (f.a === 'custom_msg') return openSheet();
    if (peer) peer.send({ t: 'key', i });
  }

  // "Type message" key: a message box on the phone (the deck key opens one on the timer)
  function openSheet() {
    $('sheet').hidden = false;
    $('sheetinput').value = '';
    setTimeout(() => $('sheetinput').focus(), 50);
  }
  const closeSheet = () => { $('sheet').hidden = true; $('sheetinput').blur(); };
  const sheetSend = () => {
    const t = $('sheetinput').value.trim();
    if (t) cmd('custommessage', { text: t });
    closeSheet();
  };
  $('sheetsend').addEventListener('click', sheetSend);
  $('sheetinput').addEventListener('keydown', e => { if (e.key === 'Enter') sheetSend(); });
  $('sheetclear').addEventListener('click', () => { cmd('custommessage', { text: '' }); closeSheet(); });
  $('sheetcancel').addEventListener('click', closeSheet);

  // ─── Full screen ─────────────────────────────────────────────────────────
  // Android and tablets: the Fullscreen API. iPhone Safari has none for pages, so explain
  // Add to Home Screen instead (the page has the meta tags to open without browser bars).
  const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;
  const fsApi = document.fullscreenEnabled || document.webkitFullscreenEnabled;
  const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function toggleFullscreen() {
    if (!fsApi) { $('fstip').hidden = false; return; }
    const el = document.documentElement;
    if (isFull()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      const p = req.call(el, { navigationUI: 'hide' });
      if (p && p.catch) p.catch(() => {});
    }
  }
  function showFsButton() {
    $('fsbtn').hidden = standalone && !fsApi;          // already running from the Home Screen
    $('fsbtn').querySelector('.long').textContent = isFull() ? '⛶ Exit full screen' : '⛶ Full screen';
  }
  $('fsbtn').addEventListener('click', toggleFullscreen);
  $('fstipok').addEventListener('click', () => { $('fstip').hidden = true; });
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(t => document.addEventListener(t, () => {
    showFsButton();
    setTimeout(() => { layoutDeck(); scheduleFit(true); }, 100);
  }));
  showFsButton();

  buildKeys();
  setView(view);

  // ─── Boot ────────────────────────────────────────────────────────────────

  render();
  requestWakeLock();
  document.addEventListener('click', requestWakeLock, { once: true });   // some browsers need a tap first
  connect();
})();
