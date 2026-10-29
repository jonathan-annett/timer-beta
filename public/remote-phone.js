/*!
 * remote-phone.js  (EXPERIMENTAL)
 * Phone side of remote control: joins the timer's room on the pairing server, tries a
 * direct LAN link (RemotePeer), shows the timer's state and sends commands.
 *
 * Views: 'simple' (controls), 'deck' (virtual Stream Deck XL), 'countdown' and 'runsheet'
 * (displays, no controls). A link with the view-only key (#v=…) can only show the displays;
 * the timer ignores commands from it anyway (it knows the role from the pairing server).
 * MIT Licensed
 */

/* global RemotePeer */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  // Link: #r=<room>&k=<key> (control) or #r=<room>&v=<view key>&m=<countdown|runsheet>
  // (view only), plus [&s=<server>]; the server defaults to RemotePeer.defaultServer().
  // (Long names server/room/key from older links still work.)
  // The last link opened is saved, so the page also works without one: from a bookmark, or as
  // an installed app (whose start URL has no #fragment). Good for a multi-day event; the timer
  // keeps its keys until someone presses New code.
  const SAVED_LINK = 'remote_saved_link';
  const parse = frag => Object.fromEntries(new URLSearchParams(frag));
  let h = parse(location.hash.slice(1));
  try {
    if ((h.r || h.room) && (h.a || h.k || h.key || h.v || h.c)) localStorage.setItem(SAVED_LINK, location.hash.slice(1));
    else if (localStorage.getItem(SAVED_LINK)) h = parse(localStorage.getItem(SAVED_LINK));
  } catch (_) { /* private mode: links still work, they just aren't remembered */ }
  const cfg = {
    server: h.s || h.server || RemotePeer.defaultServer(),
    room: h.r || h.room,
    key: h.a || h.k || h.key || h.c || h.v,
  };
  // admin (#a=…): control + every view + set up other computers; control (#k=…); view (#v=…).
  // The server confirms it on join, and the timer enforces it.
  // A Companion link (#c=…) opened in a browser works as a control link.
  let role = h.a ? 'admin' : (h.k || h.key || h.c) ? 'control' : 'view';
  if (!cfg.room || !cfg.key) {
    $('blocked').hidden = false;
    $('blocked').textContent = 'Open this page by scanning the QR code in the timer’s “phone” panel.';
    return;
  }
  $('app').hidden = false;

  let ws = null, peer = null, retry = 1000, retryTimer = null, hostOnline = false, fatal = false, waiting = false;
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
    postLink();
    if (waiting) return setBadge('off', 'timer offline', role === 'view'
      ? 'waiting for the timer… (if this never connects, the pairing server may need updating, or the timer made a new code)'
      : 'waiting for the timer… (if it made a new code, scan it)');
    if (!ws || ws.readyState !== WebSocket.OPEN) return setBadge('off', 'reconnecting…');
    if (!hostOnline) return setBadge('off', 'timer offline', 'waiting for the timer…');
    if (peer && peer.mode === 'lan') setBadge('lan', '⚡ LAN direct');
    else if (peer && peer.mode === 'p2p') setBadge('lan', '⚡ direct', 'over the internet, not the same Wi-Fi');
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
    peer.send({ t: 'hello', token: store.get(tokenKey()) || undefined });   // via the server until the LAN link is up
    if (view === 'deck' && role !== 'view') peer.send({ t: 'deck', on: true });
    if (editorMode()) peer.send({ t: 'rs-sub', on: true });
  }

  function connect() {
    clearTimeout(retryTimer);
    if (fatal) return;
    try { ws = new WebSocket(RemotePeer.socketUrl(cfg.server, { room: cfg.room })); RemotePeer.keepAlive(ws); } catch (_) { return schedule(); }
    const sock = ws;
    sock.onopen = () => { sock.send(JSON.stringify({ type: 'join', room: cfg.room, key: cfg.key })); };
    sock.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      switch (m.type) {
        case 'joined':
          hostOnline = m.hostOnline; waiting = false; retry = 1000;
          { const r = m.role === 'companion' ? 'control' : m.role; if (r && r !== role && ['admin', 'control', 'view'].includes(r)) { role = r; applyRole(); } }
          newPeer();
          break;
        case 'down': if (peer) peer.receive(m.msg); break;
        case 'host-offline': hostOnline = false; if (peer) peer.close(); peer = null; break;
        case 'host-online': hostOnline = true; newPeer(); break;     // the timer reconnected: start a fresh link
        case 'error':
          // The room is gone when the timer has been closed for a while (overnight, say) or the
          // server restarted; it comes back with the same code when the timer reopens. So keep
          // waiting, slowly. If the timer made a New code, this code never returns: scan again.
          if (m.reason === 'not-found' || m.reason === 'room-closed') {
            waiting = true; retry = 15000;
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
    if (!waiting) retry = Math.min(retry * 2, 10000);
  }

  // Phones drop connections when the screen locks; reconnect straight away on return
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestWakeLock();
      if (!ws || ws.readyState > WebSocket.OPEN) { if (!waiting) retry = 1000; connect(); }
    }
  });

  // Keep the screen on while this page is open (where supported)
  let wakeLock = null;
  async function requestWakeLock() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.onrelease = () => { wakeLock = null; }; } }
    catch (_) { /* not allowed right now */ }
  }

  // ─── Require a PIN ───────────────────────────────────────────────────────
  // The timer may want the person at it to let this phone in: we show a 4-digit PIN, they type
  // it there. Once approved we get a token, kept per room, so reconnecting needs no new PIN.

  // A new link opened over this page (a rescan in the same tab) is a fresh start
  window.addEventListener('hashchange', () => location.reload());

  const tokenKey = () => 'remote_token_' + cfg.room;
  let pinCode = null;
  function onPin(m) {
    const box = $('pinwait');
    if (m.t === 'pin-required') {
      if (!pinCode) pinCode = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
      $('pincode').textContent = pinCode;
      $('pinmsg').textContent = 'The timer is asking who this is. Tell the person at the timer this PIN; it connects once they type it in.';
      $('pinretry').hidden = true;
      box.hidden = false;
      if (peer) peer.send({ t: 'pin', code: pinCode });
    } else if (m.t === 'pin-ok') {
      if (typeof m.token === 'string') store.set(tokenKey(), m.token);
      pinCode = null;
      box.hidden = true;
      if (peer) { peer.send({ t: 'hello', token: store.get(tokenKey()) || undefined }); if (view === 'deck' && role !== 'view') peer.send({ t: 'deck', on: true }); if (editorMode()) peer.send({ t: 'rs-sub', on: true }); }
    } else if (m.t === 'pin-rejected') {
      pinCode = null;
      $('pincode').textContent = '';
      $('pinmsg').textContent = 'The timer didn’t let this phone in.';
      $('pinretry').hidden = false;
      box.hidden = false;
    }
  }
  $('pinretry').addEventListener('click', () => location.reload());

  // ─── State from the timer ────────────────────────────────────────────────

  const joinPart = RemotePeer.joiner();
  function onMessage(m) {
    if (m && m.t === 'part') { const whole = joinPart(m); if (whole) onMessage(whole); return; }
    if (m && (m.t === 'pin-required' || m.t === 'pin-ok' || m.t === 'pin-rejected')) return onPin(m);
    if (m && m.t === 'deck') return onDeck(m);
    if (m && m.t === 'share-link') return onShareLink(m);
    if (m && typeof m.t === 'string' && /^(rs-|vup-)/.test(m.t)) return onEditorMessage(m);
    if (!m || m.t !== 'state' || typeof m.s !== 'object') return;
    if (m.full) for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, m.s);
    render();
  }

  function render() {
    if (editorMode()) postEditor({ t: 'rs-clock', remain: state.remain || '', over: !!state.over,
      impending: !!state.impending, paused: !!state.paused });
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
    $('rcback').disabled = !state.rsOn || !state.rsBack;
    $('rcnext').disabled = !state.rsOn || !state.rsNext;
    $('rcpause').textContent = state.paused ? 'Resume' : 'Pause';
    $('rcpause').classList.toggle('paused', !!state.paused);
    $('rccatch').disabled = !(state.adjUp || state.adjDown);
    $('rccatch').classList.toggle('on', !!(state.adjUp || state.adjDown));
    renderDisplays();
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

  // ─── Buttons: buzz on press, act on release ──────────────────────────────
  // A press buzzes straight away (where the phone can) and fires when the finger lifts.
  // Sliding off the button, or the browser taking the touch for a scroll, ignores it.
  // Restart and the presets can also ask for a second tap (View menu; off by default),
  // so a pocket tap can't restart a talk.
  const needConfirm = () => { try { return localStorage.remote_confirm === '1'; } catch (e) { return false; } };
  let iosHaptic = null;
  function buzz() {
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} return; }
    // iPhone has no vibrate API; toggling a hidden iOS 18 switch control gives a haptic tick
    if (!iOS) return;
    if (!iosHaptic) {
      iosHaptic = document.createElement('label');
      iosHaptic.setAttribute('aria-hidden', 'true');
      iosHaptic.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0';
      const box = document.createElement('input');
      box.type = 'checkbox'; box.setAttribute('switch', ''); box.tabIndex = -1;
      iosHaptic.appendChild(box);
      document.body.appendChild(iosHaptic);
    }
    iosHaptic.click();
  }
  // A press fires when the finger lifts. It's cancelled only by sliding off on purpose: held
  // longer than CANCEL_MS AND lifted outside the button. So a quick tap always counts, even if
  // the finger rolls a little, while an accidental touch (felt as the buzz) can still be
  // dragged off and let go. The button stays lit only while lifting would fire it.
  const CANCEL_MS = 250;
  function pressable(el, action, opts) {
    opts = opts || {};
    let active = null, downAt = 0, lastPointer = 0;
    el.classList.add('pressable');
    const end = () => { active = null; lastPointer = performance.now(); el.classList.remove('down'); };   // the click after it is skipped
    const inside = e => {
      const r = el.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    };
    const wouldFire = e => inside(e) || performance.now() - downAt <= CANCEL_MS;
    const fire = () => {
      if (opts.confirm && needConfirm()) return arm(el, action);
      action();
    };
    el.addEventListener('pointerdown', e => {
      if (el.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (opts.can && !opts.can()) return;
      if (opts.keepFocus) e.preventDefault();   // don't blur the message box (the keyboard would drop and move the button)
      active = e.pointerId;
      downAt = performance.now();
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* touches are captured anyway */ }
      el.classList.add('down');
      buzz();
    });
    el.addEventListener('pointermove', e => { if (e.pointerId === active) el.classList.toggle('down', wouldFire(e)); });
    el.addEventListener('pointercancel', e => { if (e.pointerId === active) end(); });
    el.addEventListener('pointerup', e => {
      if (e.pointerId !== active) return;
      const ok = wouldFire(e) && !el.disabled;
      end();
      if (ok) fire();
    });
    // Keyboard (Enter/Space on a focused button) still works. The click that follows a pointer
    // press is ignored (handled above); some touch clicks report detail 0 like keyboard ones.
    el.addEventListener('click', e => {
      const recent = performance.now() - lastPointer < 500;
      lastPointer = 0;
      if (active !== null || recent || el.disabled) return;
      if (e.detail === 0) fire();
    });
    el.addEventListener('contextmenu', e => e.preventDefault());   // no long-press menu
  }
  function arm(btn, action) {
    if (btn.classList.contains('armed')) {
      btn.classList.remove('armed'); btn.textContent = btn.dataset.label;
      clearTimeout(btn._t); action();
      return;
    }
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.classList.add('armed'); btn.textContent = 'Tap again';
    btn._t = setTimeout(() => { btn.classList.remove('armed'); btn.textContent = btn.dataset.label; }, 2000);
  }

  pressable($('restart'), () => cmd('restart'), { confirm: true });
  pressable($('pause'), () => cmd('pause'));
  pressable($('minus'), () => cmd('adjust', { addtime: false, msecs: 60000 }));
  pressable($('plus'), () => cmd('adjust', { addtime: true, msecs: 60000 }));
  pressable($('catchup'), () => cmd('catchup'));
  pressable($('rsnextbtn'), () => cmd('runsheetnext'));
  pressable($('rsback'), () => cmd('runsheetprev'));
  pressable($('msgclear'), () => cmd('custommessage', { text: '' }));
  // Run sheet view, control and admin phones: Back / Pause / Next, live adjust and catch up
  pressable($('rcback'), () => cmd('runsheetprev'));
  pressable($('rcnext'), () => cmd('runsheetnext'));
  pressable($('rcpause'), () => cmd('pause'));
  pressable($('rccatch'), () => cmd('catchup'));
  // Nudges, like the timer's ↑/↓: the countdown eases to the new end; Catch up jumps there
  [['rcm60', false, 60000], ['rcm10', false, 10000], ['rcp10', true, 10000], ['rcp60', true, 60000]]
    .forEach(([id, addtime, msecs]) => pressable($(id), () => cmd('nudge', { addtime, msecs })));
  const sendMsg = () => {
    const t = $('msginput').value.trim();
    if (!t) return;
    cmd('custommessage', { text: t });
    $('msginput').value = '';
    $('msginput').blur();
  };
  pressable($('msgsend'), sendMsg, { keepFocus: true });
  $('msginput').addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(); });

  for (const min of [5, 10, 15, 20, 30, 45, 60, 90]) {
    const b = document.createElement('button');
    b.textContent = min < 60 ? min + ' min' : (min / 60) + ' h';
    if (min === 90) b.textContent = '1½ h';
    pressable(b, () => cmd('start', { msecs: min * 60000 }), { confirm: true });
    $('presets').appendChild(b);
  }

  // ─── Virtual Stream Deck XL ──────────────────────────────────────────────
  // The timer sends each key's face (colours and text, from its XL layout) and only the keys
  // that change; we draw them with the same code as the real deck (deck-face.js). A press
  // sends just the key's number; the timer runs that key's action.

  const faces = [];
  const canvases = [];
  const SHOW_ONLY = new Set(['countdown', 'countdown_major', 'countdown_minor', 'rs_status', 'empty']);   // display keys
  let keyCss = 40;
  function buildKeys() {
    const box = $('keys');
    for (let i = 0; i < 32; i++) {
      const c = document.createElement('canvas');
      c.className = 'idle';
      c.addEventListener('pointerdown', e => e.preventDefault());
      pressable(c, () => pressKey(i), { can: () => !!(faces[i] && faces[i].press) });
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
  window.addEventListener('orientationchange', () => setTimeout(layout, 250));   // some phones report the new size late

  function drawKey(i) {
    const c = canvases[i], f = faces[i];
    if (!c) return;
    const px = Math.round(keyCss * (window.devicePixelRatio || 1));
    if (c.width !== px) { c.width = c.height = px; }
    const ctx = c.getContext('2d');
    if (!f) { ctx.fillStyle = '#0d0d0d'; ctx.fillRect(0, 0, px, px); return; }
    DeckFace.paint(ctx, f, px);
    c.classList.toggle('idle', !f.press);
    c.classList.toggle('off', !f.press && !SHOW_ONLY.has(f.a));
  }

  function onDeck(m) {
    if (m.none) { $('deckhint').textContent = 'The timer has no Stream Deck support loaded.'; return; }
    if (!m.k || typeof m.k !== 'object') return;
    for (const [i, f] of Object.entries(m.k)) {
      const n = Number(i);
      if (n >= 0 && n < 32 && f && typeof f === 'object') { faces[n] = f; if (view === 'deck') drawKey(n); }
    }
  }

  function pressKey(i) {
    const f = faces[i];
    if (!f || !f.press) return;
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

  // ─── Views ───────────────────────────────────────────────────────────────

  const VIEWS = {
    simple:    { label: 'Simple controls',   desc: 'Start, pause, ±1 min, presets, messages' },
    deck:      { label: 'Stream Deck XL',    desc: 'The timer’s XL key layout' },
    countdown: { label: 'Countdown display', desc: 'Big countdown and message, no controls' },
    runsheet:  { label: 'Run sheet display', desc: 'Now, next and the schedule, no controls' },   // on a desktop controller: the editor (see applyRole)
    admin:     { label: 'Admin: set up another computer', desc: 'Scan another computer’s QR code to make it a remote or display of this timer' },
  };
  const allowedViews = () => role === 'admin' ? Object.keys(VIEWS)
    : role === 'control' ? Object.keys(VIEWS).filter(v => v !== 'admin') : ['countdown', 'runsheet'];
  const store = { get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
                  set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } } };
  const viewKey = () => role !== 'view' ? 'remote_view' : 'remote_view_display';

  // First view: the one chosen in the timer's panel when this link is new (#m=…), otherwise the
  // one this phone used last.
  function initialView() {
    let v = store.get(viewKey());
    if (h.m && VIEWS[h.m] && store.get('remote_link_m') !== h.m + '|' + cfg.room) {
      v = h.m; store.set('remote_link_m', h.m + '|' + cfg.room);
    }
    return allowedViews().includes(v) ? v : allowedViews()[0];
  }
  let view = initialView();

  function setView(v, fromUser) {
    if (!allowedViews().includes(v)) v = allowedViews()[0];
    if (view === 'admin' && v !== 'admin') adminReset();
    view = v;
    store.set(viewKey(), v);
    const b = document.body;
    Object.keys(VIEWS).forEach(k => b.classList.toggle('v-' + k, k === v));
    b.classList.toggle('deckview', v === 'deck');
    if (v !== 'deck') b.classList.remove('side');
    document.documentElement.style.fontSize = '';
    updatePresenterMode();
    updateEditorMode();
    layout();
    if (peer && role !== 'view') peer.send({ t: 'deck', on: v === 'deck' });
    if (v === 'admin' && fromUser) startScan();      // picked from the menu: a tap, so the camera may start
  }

  function applyRole() {
    document.body.classList.toggle('can-ctl', role !== 'view');   // run sheet view gets its controls
    // A computer with control is offered the run sheet EDITOR in place of the display
    const rs = VIEWS.runsheet;
    if (desktop && role !== 'view') { rs.label = 'Run sheet editor'; rs.desc = 'Edit the timer’s run sheet: items, times, videos, Next/Back, the log'; }
    else { rs.label = 'Run sheet display'; rs.desc = role === 'view' ? 'Now, next and the schedule' : 'Now, next and the schedule, with Next/Back and nudges'; }
    setTimeout(updateEditorMode, 0);                              // (after start-up: it needs `desktop`)
    $('roletag').hidden = role === 'control';
    $('roletag').textContent = role === 'admin' ? 'ADMIN' : 'VIEW ONLY';
    $('roletag').title = role === 'admin' ? 'This device can also set up other computers' : 'This device can’t control the timer';
    $('roletag').classList.toggle('admin', role === 'admin');
    setView(view);
  }

  function openViewMenu() {
    const list = $('viewlist');
    list.innerHTML = '';
    for (const k of allowedViews()) {
      const btn = document.createElement('button');
      btn.className = k === view ? 'on' : '';
      btn.innerHTML = `${VIEWS[k].label}<small>${VIEWS[k].desc}</small>`;
      btn.addEventListener('click', () => { $('viewmenu').hidden = true; setView(k, true); });
      list.appendChild(btn);
    }
    if (role !== 'view') {
      const opt = document.createElement('button');
      const sync = () => { opt.innerHTML = `Second tap: ${needConfirm() ? 'on' : 'off'}<small>${needConfirm() ? 'Restart and presets need a second tap within 2 s' : 'Restart and presets act on the first press'}</small>`; };
      sync();
      opt.addEventListener('click', () => {
        try { if (needConfirm()) localStorage.removeItem('remote_confirm'); else localStorage.remote_confirm = '1'; } catch (e) {}
        sync();
      });
      list.appendChild(opt);
    }
    const helpBtn = document.createElement('button');
    helpBtn.innerHTML = 'Help<small>The timer’s guide (phone remote, run sheet, Stream Deck…)</small>';
    helpBtn.addEventListener('click', () => { $('viewmenu').hidden = true; help.open('sharing-with-phones-displays-and-companion-experimental'); });
    list.appendChild(helpBtn);
    installOption(list);
    $('viewmenu').hidden = false;
  }
  // The README, as on the timer (help-overlay.js); ? or F1 open it too
  // The phone's Back button closes whatever is open (menus, message box, tip) and otherwise does
  // nothing, rather than leaving the remote (back-guard.js). The help registers itself below.
  if (typeof BackGuard !== 'undefined') {
    BackGuard.install();
    BackGuard.register(() => {
      for (const id of ['viewmenu', 'fstip', 'sheet']) {
        const el = $(id);
        if (el && !el.hidden) { el.hidden = true; if (id === 'sheet') $('sheetinput').blur(); return true; }
      }
      return false;
    });
  }
  const help = HelpOverlay.install({ section: 'sharing-with-phones-displays-and-companion-experimental' });
  $('viewbtn').addEventListener('click', openViewMenu);
  $('viewcancel').addEventListener('click', () => { $('viewmenu').hidden = true; });

  // Lay out whichever view is showing
  function layout() {
    if (!document.body.classList.contains('side')) {
      document.documentElement.style.setProperty('--top-h', Math.ceil(document.querySelector('.top').getBoundingClientRect().bottom + 6) + 'px');
    }
    if (view === 'deck') layoutDeck();
    else if (view === 'simple') scheduleFit(true);
    else if (view === 'countdown') fitCountdown();
    else if (view === 'runsheet') layoutRunsheet();
  }
  window.addEventListener('pagehide', () => stopScan());
  window.addEventListener('resize', layout);

  // ─── Countdown display ───────────────────────────────────────────────────
  // The countdown as big as fits, with the message under it (sharing the height when there is one).

  function fitText(el, maxW, maxH, hi) {
    let lo = 8;
    const ok = px => { el.style.fontSize = px + 'px'; return el.scrollWidth <= maxW + 1 && el.scrollHeight <= maxH + 1; };
    if (!ok(lo)) return;
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (ok(mid)) lo = mid; else hi = mid; }
    ok(lo);
  }
  function fitCountdown() {
    if (view !== 'countdown') return;
    const box = $('cd'), cs = getComputedStyle(box);
    const W = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const extra = el => el.offsetHeight ? el.offsetHeight + parseFloat(getComputedStyle(el).marginTop) + parseFloat(getComputedStyle(el).marginBottom) : 0;
    const H = box.clientHeight - parseFloat(cs.paddingBottom) - extra($('cdsub')) - extra($('cdclock')) - extra($('cdbar')) - 8;
    const msg = $('cdmsg').textContent;
    const remainH = msg ? H * 0.58 : H;
    $('cdmsg').style.maxWidth = W + 'px';
    fitText($('cdremain'), W * 0.96, remainH, 1000);
    if (msg) fitText($('cdmsg'), W, H - $('cdremain').offsetHeight - 16, 400);
  }

  // ─── Countdown display on a desktop ──────────────────────────────────────
  // A computer with a mouse (a confidence monitor, a screen in another room) shows exactly what
  // the main timer's presenter window shows: display.html uses the presenter markup and
  // timer.css, fed with the timer's own class list, countdown text, message and bar.
  // Phones and tablets keep the touch layout above.
  const desktop = matchMedia('(hover: hover) and (pointer: fine)').matches;
  let frameReady = false;
  function presenterMode() { return desktop && view === 'countdown'; }
  function updatePresenterMode() {
    const on = presenterMode();
    document.body.classList.toggle('cd-presenter', on);
    const f = $('cdframe');
    if (on && !f.getAttribute('src')) { frameReady = false; f.src = 'display.html'; }
    if (on) postDisplay();
  }
  function postDisplay() {
    if (!presenterMode() || !frameReady) return;
    $('cdframe').contentWindow.postMessage({
      t: 'display', cls: state.cls || '', remain: state.remain || '', msg: state.msg || '',
      pct: state.pct || 0, full: isFull(),
    }, location.origin);
  }
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || e.source !== $('cdframe').contentWindow || !e.data) return;
    if (e.data.t === 'display-ready') { frameReady = true; postDisplay(); }
    if (e.data.t === 'display-key' && e.data.key === 'f' && presenterMode()) toggleFullscreen();
  });
  // F toggles full screen on a desktop countdown display, like the presenter window
  document.addEventListener('keydown', e => {
    if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && presenterMode() &&
        !/^(INPUT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) toggleFullscreen();
  });
  // ─── Run sheet editor (a controller on a computer) ────────────────────────
  // On a desktop, a controller's run sheet view is the run sheet editor (runsheet.html?remote in
  // #rsframe) for the timer. This page relays: the timer's sheet/state/status to the editor,
  // and its edits and commands back. Videos go to the timer's computer only over the direct
  // (LAN) link: as binary data-channel messages, never through the server.

  let editorReady = false, editorSub = false;
  function editorMode() { return desktop && view === 'runsheet' && role !== 'view'; }
  function updateEditorMode() {
    const on = editorMode();
    document.body.classList.toggle('rs-editor', on);
    const f = $('rsframe');
    if (on && !f.getAttribute('src')) { editorReady = false; f.src = 'runsheet.html?remote'; }
    if (on !== editorSub && peer) { editorSub = on; peer.send({ t: 'rs-sub', on }); }
    if (on) postLink();
  }
  function postEditor(msg) {
    if (!editorReady) return;
    $('rsframe').contentWindow.postMessage(msg, location.origin);
  }
  function postLink() {
    postEditor({ t: 'rs-link', online: !!(ws && ws.readyState === WebSocket.OPEN && hostOnline && peer),
      lan: !!(peer && peer.mode === 'lan') });
  }
  function onEditorMessage(m) {
    if (m.t === 'rs-data') postEditor(m);
    else if (m.t === 'rs-refused') alert('The timer didn’t accept that change to the run sheet.');
    else if (m.t.startsWith('vup-') && upload && m.up === upload.up) upload.onReply(m);
  }
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || e.source !== $('rsframe').contentWindow || !e.data || typeof e.data !== 'object') return;
    const m = e.data;
    if (m.t === 'rs-ready') {
      editorReady = true;
      postLink();
      render();                                    // the countdown preview
      if (peer && editorMode()) { editorSub = true; peer.send({ t: 'rs-sub', on: true }); }   // a fresh copy for it
    } else if (!peer || role === 'view') {
      return;
    } else if (m.t === 'rs-save' && m.sheet && typeof m.sheet === 'object') {
      RemotePeer.sendBig(peer, { t: 'rs-save', sheet: m.sheet });
    } else if (m.t === 'rs-cmd' && typeof m.cmd === 'string') {
      const out = { t: 'rs-cmd', cmd: m.cmd, id: typeof m.id === 'string' ? m.id : undefined, on: m.on };
      for (const k of ['duration', 'endClock']) if (typeof m[k] === 'number' || m[k] === null) out[k] = m[k];   // the timer checks them
      for (const k of ['nextId', 'name']) if (typeof m[k] === 'string') out[k] = m[k];
      peer.send(out);
    } else if (m.t === 'rs-video' && m.file instanceof Blob) {
      uploadVideo(m);
    }
  });

  // Sending a video file: 'vup-start' (on the data channel), wait for 'vup-ok', then the file
  // in 64 KB binary messages (4-byte upload number + data), pacing on the channel's buffer.
  // The timer reports what it has received ('vup-prog', shown as the progress) and stores it ('vup-done').
  let upload = null, upSeq = 0;
  const CHUNK = 64 * 1024;
  function uploadVideo(m) {
    const kind = m.kind === 'deck' || m.kind === 'holding' ? m.kind : 'video';   // a video, a PowerPoint deck or a holding slide (the same path)
    const what = kind === 'deck' ? 'slides' : kind === 'holding' ? 'holding slide' : 'video';
    const end = error => { if (upload && upload.id === m.id) upload = null; postEditor({ t: 'rs-vend', kind, id: m.id, error }); };
    if (upload) return end('Wait for the file being sent to finish first.');
    if (!peer || peer.mode !== 'lan') return end(`The ${what} can only be sent over a direct link on the same network as the timer.`);
    const file = m.file, up = ++upSeq;
    const u = upload = { up, id: m.id, acked: 0, waitOk: null, failed: null };
    const progress = pct => postEditor({ t: 'rs-vprog', kind, id: m.id, pct: Math.min(99, Math.floor(pct)) });
    const REASONS = { 'not-lan': 'The link to the timer isn’t direct (same network) any more.', busy: 'The timer is busy receiving another video.',
      bad: `The timer couldn’t take that ${what} for this item.`, 'no-space': `There isn’t enough free space in the timer’s browser for that ${what}.`,
      store: `The timer couldn’t store the ${what} (is its disk full?).`, gone: 'That item was deleted on the timer.', 'too-big': `The ${what} arrived damaged; try again.` };
    u.onReply = r => {
      if (r.t === 'vup-ok' && u.waitOk) u.waitOk();
      else if (r.t === 'vup-prog') { u.acked = r.got; progress(r.got / file.size * 100); }
      else if (r.t === 'vup-done') { upload = null; postEditor({ t: 'rs-vend', kind, id: m.id }); }
      else if (r.t === 'vup-error') { u.failed = REASONS[r.reason] || `The ${what} wasn’t sent: the direct link was lost.`; end(u.failed); }
    };
    peer.send({ t: 'vup-start', up, kind, id: m.id, name: String(m.name || file.name || what).slice(0, 200),
      size: file.size, type: file.type, duration: typeof m.duration === 'number' ? m.duration : null });
    new Promise((resolve, reject) => {
      u.waitOk = resolve;
      setTimeout(() => reject(new Error('The timer didn’t answer.')), 15000);
    }).then(async () => {
      for (let off = 0; off < file.size;) {
        if (upload !== u) return;                            // cancelled or failed
        const ab = await file.slice(off, Math.min(file.size, off + 16 * CHUNK)).arrayBuffer();
        for (let p = 0; p < ab.byteLength; p += CHUNK) {
          const piece = new Uint8Array(4 + Math.min(CHUNK, ab.byteLength - p));
          new DataView(piece.buffer).setUint32(0, up, true);
          piece.set(new Uint8Array(ab, p, piece.length - 4), 4);
          if (!peer || !peer.sendBinary(piece.buffer)) throw new Error('The direct link to the timer was lost.');
        }
        off += ab.byteLength;
        await peer.drained(4 << 20);                         // keep at most 4 MB waiting to go
      }
    }).catch(err => { if (upload === u) { try { peer && peer.send({ t: 'vup-cancel', up }); } catch (_) {} end((err && err.message) || `The ${what} wasn’t sent.`); } });
  }

  // Show the controls while the mouse moves, then hide them (and the cursor) again
  let mouseTimer = null;
  const wake = () => {
    document.body.classList.add('mouse');
    clearTimeout(mouseTimer);
    mouseTimer = setTimeout(() => { if ($('viewmenu').hidden) document.body.classList.remove('mouse'); }, 2500);
  };
  ['mousemove', 'mousedown', 'keydown'].forEach(t => document.addEventListener(t, wake));
  // (mouse moves over the iframe don't reach this page; display.html covers the window, so
  // also listen on its document once loaded)
  $('cdframe').addEventListener('load', () => {
    try { ['mousemove', 'mousedown'].forEach(t => $('cdframe').contentDocument.addEventListener(t, wake)); } catch (_) { /* not same origin */ }
  });

  // ─── Run sheet display ───────────────────────────────────────────────────

  function layoutRunsheet() {
    if (view !== 'runsheet') return;
    // Text size from the screen: readable across a room on a tablet, still fits on a phone
    const start = Math.max(13, Math.min(34, Math.min(innerWidth * 0.042, innerHeight * 0.04)));
    let px = start;
    const set = () => document.documentElement.style.setProperty('--rs-font', px.toFixed(1) + 'px');
    set();
    // Then smaller, if need be:
    //  - until the controls (control and admin phones) are on screen, however small that takes;
    //  - until the whole schedule fits without scrolling, but not below 70 % (on a square or
    //    short screen the list otherwise gets a few clipped rows under the status).
    const box = $('rsv'), ctl = $('rsvctl'), list = $('rsvlist');
    const withCtl = document.body.classList.contains('can-ctl');
    const bottom = () => box.getBoundingClientRect().bottom - parseFloat(getComputedStyle(box).paddingBottom) + 0.5;
    const ctlFits = () => !withCtl || (ctl.getBoundingClientRect().bottom <= bottom() && box.scrollWidth <= box.clientWidth + 1);
    const listFits = () => list.scrollHeight <= list.clientHeight + 1;
    while (!ctlFits() && px > 9) { px -= 0.5; set(); }
    const floor = Math.max(11, Math.min(px, start * 0.7));
    while (!listFits() && px > floor) { px -= 0.5; set(); }
    scrollToCurrent();
  }
  function scrollToCurrent() {
    const row = $('rsvlist').querySelector('.rl.now') || $('rsvlist').querySelector('.rl.next');
    if (row) $('rsvlist').scrollTop = Math.max(0, row.offsetTop - $('rsvlist').offsetTop - row.offsetHeight * 1.5);
  }
  const p2 = n => String(n).padStart(2, '0');
  const clockNow = secs => { const d = new Date(); return p2(d.getHours()) + ':' + p2(d.getMinutes()) + (secs ? ':' + p2(d.getSeconds()) : ''); };
  setInterval(() => {
    if (view === 'runsheet') $('rsvclock').textContent = clockNow();
    if (view === 'countdown' && state.clock) $('cdclocktime').textContent = clockNow(true);
  }, 1000);

  let lastList = null, cdSig = '', rsvSig = '';
  function renderDisplays() {
    const remain = (state.over ? '+' : '') + (state.remain || '–:––');
    const sub = state.paused && state.msgs ? 'Paused' : '';     // status messages follow the timer's M switch

    postDisplay();

    // Countdown display: the time of day (T), progress bar (B) and status messages (M) follow the
    // timer's own switches, like the presenter screen
    document.body.classList.toggle('cd-clock', !!state.clock);
    document.body.classList.toggle('cd-bar', !!state.bar);
    $('cdbarfill').style.width = Math.max(0, Math.min(100, Number(state.pct) || 0)) + '%';
    $('cdclocktime').textContent = clockNow(true);
    $('cdremain').textContent = remain;
    $('cdsub').textContent = sub;
    $('cdmsg').textContent = state.msg || '';
    const sig = [remain.length, state.msg || '', sub, !!state.clock, !!state.bar].join('|');
    if (sig !== cdSig) { cdSig = sig; fitCountdown(); }

    // Run sheet
    $('rsvclock').textContent = clockNow();
    $('rsvtitle').textContent = state.rsTitle || (state.rsOn ? 'Run sheet' : '');
    let list = null;
    try { list = state.rsList ? JSON.parse(state.rsList) : null; } catch (_) { list = null; }
    const rows = list && Array.isArray(list.rows) ? list.rows : [];
    const nextRow = rows.find(r => r.s === 'next');
    $('rsvnow').textContent = state.rsOn ? (state.rsNow || (rows.some(r => r.s === 'done') ? 'Show finished' : 'Not started')) : '—';
    $('rsvremain').textContent = state.rsOn && state.rsNow ? remain : '';
    $('rsvnext').textContent = state.rsOn ? (state.rsNext || '—') : '—';
    $('rsvnexttime').textContent = nextRow && (nextRow.x || nextRow.p) ? (nextRow.x ? `≈ ${nextRow.x}` + (nextRow.p ? ` (planned ${nextRow.p})` : '') : nextRow.p) : '';
    const late = state.rsLate;
    const st = $('rsvstatus');
    st.textContent = state.rsOn ? (state.rsText || '') : '';
    st.className = late >= 30 ? 'behind' : late <= -30 ? 'ahead' : '';

    if (state.rsList !== lastList) {
      lastList = state.rsList;
      const box = $('rsvlist');
      box.innerHTML = '';
      if (!state.rsOn || !rows.length) {
        const e = document.createElement('div'); e.id = 'rsvempty';
        e.textContent = 'No run sheet running on the timer';
        box.appendChild(e);
      } else {
        const more = (n, txt) => { if (n > 0) { const d = document.createElement('div'); d.className = 'rl-more'; d.textContent = `… ${n} ${txt}`; box.appendChild(d); } };
        more(list.before, 'earlier');
        for (const r of rows) {
          const d = document.createElement('div');
          d.className = 'rl' + (r.s ? ' ' + r.s : '') + (r.e ? ' end' : '');
          const t = document.createElement('span'); t.className = 't' + (r.x ? (r.xe ? ' early' : ' late') : ''); t.textContent = r.x || r.p || '';
          if (r.x) t.title = 'Planned ' + r.p;          // the estimated time, now the show is under way
          const n = document.createElement('span'); n.className = 'n'; n.textContent = r.n || '';
          const x = document.createElement('span'); x.className = 'd';
          x.textContent = r.s === 'done' && r.a ? 'started ' + r.a : (r.e ? 'finish' : (r.d || ''));
          d.append(t, n, x);
          box.appendChild(d);
        }
        more(list.after, 'more');
      }
      if (view === 'runsheet') scrollToCurrent();
    }
    // Refit (controls on screen, schedule fitting) when the content changes shape, not every second
    const rsig = [state.rsOn, state.rsNow, state.rsNext, (state.rsText || '').length, state.rsList || ''].join('|');
    if (rsig !== rsvSig) { rsvSig = rsig; if (view === 'runsheet') layoutRunsheet(); }
  }

  // ─── Admin: set up another computer ──────────────────────────────────────
  // 1. Scan the QR code another computer shows in its share panel (its Control code, which lets
  //    this phone send it commands). It must be a different timer from ours.
  // 2. Choose what it should become. Ask OUR timer for that link (it only answers controllers).
  // 3. Join the other computer's room with its key and hand it the link; it shows a notice and,
  //    unless someone there cancels, opens remote.html with our timer's link.

  let scanStream = null, scanTimer = null, detector = null, scanCanvas = null, lastRejected = '';
  let target = null, pending = null;

  function admStatus(text, kind) {
    const el = $('admstatus');
    el.textContent = text || '';
    el.className = kind || '';
  }
  function loadScript(src) {
    return new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = src; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
  }

  async function startScan() {
    stopScan();
    target = null;
    $('admchoose').hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return admStatus('This browser can’t use the camera here.', 'error');
    admStatus('Starting the camera…');
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (err) {
      return admStatus('Couldn’t use the camera (' + (err.name || err.message) + '). Allow camera access for this page, then tap Scan.', 'error');
    }
    const v = $('admvideo');
    v.srcObject = scanStream;
    $('admscan').hidden = false;
    try { await v.play(); } catch (_) { /* autoplay muted video normally works */ }
    if (!detector && 'BarcodeDetector' in window) {
      try { if ((await BarcodeDetector.getSupportedFormats()).includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (_) { /* use jsQR */ }
    }
    if (!detector && !window.jsQR) {
      try { await loadScript('jsQR.js'); } catch (_) { stopScan(); return admStatus('Couldn’t load the QR reader.', 'error'); }
    }
    admStatus('Point the camera at the other computer’s phone QR code.');
    scanLoop();
  }

  async function scanLoop() {
    if (!scanStream) return;
    const v = $('admvideo');
    let text = null;
    if (v.readyState >= 2 && v.videoWidth) {
      try {
        if (detector) {
          const codes = await detector.detect(v);
          if (codes.length) text = codes[0].rawValue;
        } else {
          const k = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
          const w = Math.round(v.videoWidth * k), h2 = Math.round(v.videoHeight * k);
          scanCanvas = scanCanvas || document.createElement('canvas');
          scanCanvas.width = w; scanCanvas.height = h2;
          const ctx = scanCanvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(v, 0, 0, w, h2);
          const r = window.jsQR(ctx.getImageData(0, 0, w, h2).data, w, h2, { inversionAttempts: 'attemptBoth' });
          if (r) text = r.data;
        }
      } catch (_) { /* try the next frame */ }
    }
    if (!scanStream) return;
    if (text && onScanned(text)) return;
    scanTimer = setTimeout(scanLoop, 180);
  }

  function stopScan() {
    clearTimeout(scanTimer);
    if (scanStream) scanStream.getTracks().forEach(t => t.stop());
    scanStream = null;
    $('admvideo').srcObject = null;
    $('admscan').hidden = true;
  }

  function adminReset() {
    stopScan();
    if (pending && pending.ws) try { pending.ws.close(); } catch (_) { /* gone */ }
    pending = null; target = null;
    $('admchoose').hidden = true;
    admStatus('');
  }

  // Is this another computer's Control code? Returns true when accepted (scanning stops).
  function onScanned(text) {
    const reject = msg => { if (text !== lastRejected) { lastRejected = text; admStatus(msg, 'error'); } return false; };
    let u;
    try { u = new URL(text); } catch (_) { return reject('That isn’t a timer phone code.'); }
    if (!/remote\.html$/.test(u.pathname)) return reject('That isn’t a timer phone code.');
    const f = parse(u.hash.slice(1));
    const room = f.r || f.room, key = f.k || f.key || f.a;
    if (!room) return reject('That isn’t a timer phone code.');
    if (room === cfg.room) return reject('That’s this timer’s own code. Scan the code on the other computer.');
    if (!key) return reject('That’s a view-only code. On the other computer choose Control (or Admin) under share, then scan again.');
    target = { room, key, server: f.s || f.server || RemotePeer.defaultServer(u.host) };
    lastRejected = '';
    stopScan();
    if (navigator.vibrate) navigator.vibrate(30);
    admStatus('Found another timer (' + room + '). What should that computer become?', 'ok');
    $('admchoose').hidden = false;
    return true;
  }

  document.querySelectorAll('#admchoose button').forEach(b => b.addEventListener('click', () => shareTo(b.dataset.mode)));
  $('admscanbtn').addEventListener('click', () => { adminReset(); startScan(); });
  $('admstop').addEventListener('click', () => { stopScan(); if (!target) admStatus(''); });

  function shareTo(mode) {
    if (!target) return;
    if (!peer || !hostOnline) return admStatus('This phone isn’t connected to its timer right now.', 'error');
    $('admchoose').hidden = true;
    const req = Math.random().toString(36).slice(2, 12);
    pending = { req, mode, target, timer: setTimeout(() => fail('This timer didn’t answer. Is it still connected?'), 8000) };
    admStatus('Asking this timer for the link…');
    peer.send({ t: 'share', mode, req });
  }

  const oldServerText = mode => mode === 'pptx'
    ? 'This timer’s pairing server is out of date, so PowerPoint computers can’t connect. Update remote-server.js on the server and restart it.'
    : 'This timer’s pairing server is out of date, so view-only displays can’t connect. Update remote-server.js on the server, or choose A remote control.';
  function fail(msg) {
    if (!pending) return;
    clearTimeout(pending.timer);
    if (pending.ws) try { pending.ws.close(); } catch (_) { /* gone */ }
    pending = null;
    admStatus(msg, 'error');
  }

  // Our timer answered with the link: deliver it to the other computer
  function onShareLink(m) {
    if (!pending || m.req !== pending.req) return;
    if (m.error === 'not-admin') return fail('Only an admin phone can set up other computers. Scan the timer’s Admin code with this phone.');
    if (m.error === 'old-server') return fail(oldServerText(pending.mode));
    if (typeof m.frag !== 'string') return;
    clearTimeout(pending.timer);
    const p = pending, t = p.target;
    admStatus('Sending it to the other computer…');
    p.timer = setTimeout(() => fail('The other computer didn’t answer. Is its timer page open with phone control on?'), 10000);
    let ws2, peer2 = null;
    try { ws2 = new WebSocket(RemotePeer.socketUrl(t.server, { room: t.room })); RemotePeer.keepAlive(ws2); } catch (_) { return fail('Bad server address in that code.'); }
    p.ws = ws2;
    ws2.onopen = () => ws2.send(JSON.stringify({ type: 'join', room: t.room, key: t.key }));
    ws2.onmessage = ev => {
      let x; try { x = JSON.parse(ev.data); } catch (_) { return; }
      if (x.type === 'joined') {
        if (x.role && x.role !== 'control' && x.role !== 'admin') return fail('That code doesn’t allow control. Choose Control on the other computer.');
        if (!x.hostOnline) return fail('The other computer’s timer isn’t connected right now.');
        peer2 = RemotePeer.create({
          initiator: false,
          relay: msg => { if (ws2.readyState === WebSocket.OPEN) ws2.send(JSON.stringify({ type: 'up', msg })); },
          onMessage: r => onAdoptReply(p, r),
          onModeChange: () => {},
        });
        p.peer2 = peer2;
        peer2.send({ t: 'adopt', req: p.req, mode: p.mode, frag: m.frag });
      } else if (x.type === 'down' && peer2) {
        peer2.receive(x.msg);
      } else if (x.type === 'error') {
        fail(x.reason === 'not-found' ? 'That code has expired or the other timer is closed. Scan its code again.' : 'The other computer refused: ' + x.reason);
      }
    };
    ws2.onerror = () => fail('Couldn’t reach the other computer’s server.');
  }

  function onAdoptReply(p, r) {
    if (!r || r.req !== p.req) return;
    const what = { control: 'a remote control', editor: 'a run sheet editor', runsheet: 'a run sheet display', countdown: 'a countdown display', pptx: 'the PowerPoint receiver page' }[p.mode] || 'a remote';
    if (r.t === 'adopt-ok') {
      clearTimeout(p.timer);
      admStatus('Done: the other computer is opening ' + what + ' of this timer (someone there has 8 seconds to cancel).' +
        (p.mode === 'pptx' ? ' Then start the PowerPoint player there, as that page shows.' : ''), 'ok');
      // Stay connected a little longer, to hear if it's cancelled
      p.timer = setTimeout(() => { if (pending === p) { try { p.ws.close(); } catch (_) { /* gone */ } pending = null; } }, 12000);
    } else if (r.t === 'adopt-cancelled') {
      admStatus('Someone at the other computer cancelled.', 'error');
    } else if (r.t === 'adopt-refused') {
      fail('The other computer refused the link (is it the same timer?).');
    }
  }

  // ─── Install as an app ───────────────────────────────────────────────────
  // remote.webmanifest makes the page installable (Android, desktop Chrome/Edge). The app opens
  // remote.html with no link and uses the saved one. Not on iPhone/iPad: Safari would take the
  // manifest's start URL for Add to Home Screen, and a Home Screen app there has its own storage
  // (no saved link), whereas without a manifest it keeps the full link, keys included.
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!iOS) {
    const ln = document.createElement('link');
    ln.rel = 'manifest'; ln.href = 'remote.webmanifest';
    document.head.appendChild(ln);
  }
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
  window.addEventListener('appinstalled', () => { installPrompt = null; });
  function installOption(list) {
    if (standalone) return;
    const btn = document.createElement('button');
    if (installPrompt) {
      btn.innerHTML = 'Install as an app<small>Opens straight into this remote, full screen, already paired</small>';
      btn.addEventListener('click', () => { $('viewmenu').hidden = true; installPrompt.prompt(); installPrompt = null; });
    } else if (iOS) {
      btn.innerHTML = 'Add to Home Screen<small>Share ⎋ → Add to Home Screen: opens without browser bars, already paired</small>';
      btn.addEventListener('click', () => { $('viewmenu').hidden = true; $('fstip').hidden = false; });
    } else return;
    list.appendChild(btn);
  }

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
    postDisplay();
    setTimeout(layout, 100);
  }));
  showFsButton();

  buildKeys();
  applyRole();

  // ─── Boot ────────────────────────────────────────────────────────────────

  render();
  requestWakeLock();
  document.addEventListener('click', requestWakeLock, { once: true });   // some browsers need a tap first
  connect();
})();
