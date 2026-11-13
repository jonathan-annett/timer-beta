/*!
 * playout.js
 * A playout computer (playout.html; a trial: TimerFeatures.playout): pairs with the timer like the
 * overlay (code, view-only link, proximity check) and says client:'playout' in its hello. The timer
 * sends it the run sheet ({t:'playout', items:[{id, n, d, e?}], cur, run, at, fin, on, now}: run =
 * the log's length, so Next adds one and Back takes one off; at = the live item's actual start and
 * now = the timer's clock as it was sent) and the countdown anchor (state.clk, remote-clock.js's
 * format). The timer doesn't know what this computer does with it: here, its operator gives items
 * cues (an audio or video file, kept in this browser, played on a trigger) and they play on this
 * computer. It never sends the timer anything but hello (and its proximity number).
 *
 * Triggers: 'start' (the item starts), 'end' (its time is up: the countdown reaches 0:00), 'elapsed'
 * (at seconds into it, pauses not counted) or 'remaining' (with at seconds left). Each plays once per
 * run of the item. A cue whose moment passed before this computer saw it doesn't play (reconnecting
 * mid-item never replays a walk-up), except a start cue within 2 s of the start. Back stops
 * everything playing. Follow the timer off (rehearsals, where the order depends on who's there): the
 * timer starts and stops nothing here; ▶ plays a cue, and ▶ Start item runs an item's cues timed from
 * the press by this computer's clock (runLocal). A cue plays on into the items after it (the owner's
 * call: the operator stops or fades it: ■, Stop all, Esc). ✎ on a cue changes when it plays.
 *
 * The media is chosen with the run sheet editor's + sting dialog (sting-picker.js: the site's stock
 * stings, a file or a folder of them, my clips) and cut with its clip editor (✂, sting-clip.js: the part
 * to play, fades, a loop, a trim), and always copied into this browser: it plays from here, whatever
 * happens to the site or the network. Cues play as the timer's walk-up stings do: a clip from memory
 * (cut, faded, looped, levelled: only ever turned down, to its output's level: Options → Levels, per
 * output, or off), anything else streamed. Sound outputs (audio-out.js, data-role="both"): cues go to
 * Show, previews and editing to Previews. A cue may have its own output (the owner, 12 Nov 2026: a sound card for a creative reason,
 * or a video's picture without its sound while an audio cue replaces it): out = {id, label} | 'none'
 * (videos only), absent = Show. Cues on the same trigger all play: audio together, but one video at a
 * time (the one later in the list stays on screen). Random stings (as the run sheet editor's, sting-roll.js):
 * 🎲 Roll stings gives each speaker item an At the start cue with a walk-up sting picked at random, none
 * twice; 🎲 on an item picks another (rolled: true; see "Random stings" below).
 *
 * Cues are kept by item id (an item's id survives Replace sheet and a CSV round trip: runsheet-core.js
 * matchRows), not by timer room, so they outlive a new share code and wait for their items to come back.
 * localStorage: playout_saved_link, playout_server, playout_token_<room>, playout_follow ('0' = off),
 * playout_cue_ctl ('1' = single cues of an item started here stay playable: Options), playout_levels
 * ({show | out:<device id>: {lufs?, off?}}: each output's level, unset = the house level; Options),
 * playout_roll (Random stings' options: StingRoll.opts), playout_cues ({itemId: [{id, name, media, src,
 * trigger, at, duration, song?, rolled?, lib?, start?, end?, fadeIn?, fadeOut?, loop?, lufs?, volume?,
 * out?}]}; before Nov 2026 playout_cues_<room>, merged in once; under '~board' the Stream Deck's extra keys'
 * cues: files dropped on a key, not on the run sheet), playout_names ({itemId: {text, was, at}}:
 * the operator's own text for an item, ✎ on it; see "An item's own text"); the files
 * are in IndexedDB (video-store.js) as 'pocue:<cue id>'.
 * MIT Licensed
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const PARAMS = new URLSearchParams(location.search);
  // Soundboard mode (?soundboard, or /s on the hosted site; the owner, 13 Nov 2026): no timer, a run sheet of your own
  const SOUNDBOARD = PARAMS.has('soundboard') || /\/s\/?$/.test(location.pathname);
  const TITLE = SOUNDBOARD ? 'Soundboard' : 'Playout';
  if (location.hostname) document.title = location.hostname + ' - ' + TITLE;
  if (window.TimerFeatures && !TimerFeatures.playout) {      // a trial (features.js: alpha and beta)
    document.querySelector('main').innerHTML = '<h1>' + TITLE + '</h1><p class="sub">' + (SOUNDBOARD ? 'The soundboard isn’t' : 'Playout computers aren’t') + ' available on this site.</p>';
    return;
  }

  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
    del: k => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };
  const SAVED_LINK = 'playout_saved_link', SERVER = 'playout_server', FOLLOW = 'playout_follow', CUE_CTL = 'playout_cue_ctl';
  const LATE_START_MS = 2000;
  const parse = frag => Object.fromEntries(new URLSearchParams(frag));
  const defaultServer = () => new URLSearchParams(location.search).get('remote') || store.get(SERVER) || RemotePeer.defaultServer();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mmss = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const readSecs = text => { const p = String(text || '').trim().split(':').map(Number); if (!p.length || p.some(n => !Number.isFinite(n) || n < 0)) return null; return p.reduce((a, n) => a * 60 + n, 0); };

  // ─── Which timer: a link in the address, the one saved, or pair by code ───
  let link = parse(location.hash.slice(1));
  if (link.r && link.v) { store.set(SAVED_LINK, location.hash.slice(1)); history.replaceState(null, '', location.pathname + location.search); }
  else link = parse(store.get(SAVED_LINK) || '');
  const tokenKey = room => 'playout_token_' + room;
  const DEMO = !SOUNDBOARD && PARAMS.has('demo');     // ?demo (/p?demo): no timer, see startDemo()
  const SOLO = DEMO || SOUNDBOARD;                     // no timer: manual only
  const KEY = SOUNDBOARD ? 'playout_board_' : DEMO ? 'playout_demo_' : 'playout_';   // each mode's own storage
  const CUES = KEY + 'cues', OLD_CUES = 'playout_cues_';   // (OLD_CUES + room: before Nov 2026)
  const NAMES = KEY + 'names';
  let adding = '';                                     // (soundboard: files being added, said on the status line)
  const BOARD = '~board';                              // cues[BOARD]: the Stream Deck's extra keys (files dropped on a key; no item)
  function loadCues() {
    const read = k => { try { const v = JSON.parse(store.get(k) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } };
    const all = read(CUES);
    let old = [];
    if (!SOLO) try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(OLD_CUES)) old.push(k); } } catch (_) { old = []; }
    for (const k of old) {                         // cues kept per room: merged into the one list, by item id
      for (const [item, list] of Object.entries(read(k))) {
        if (!Array.isArray(list)) continue;
        const have = new Set((all[item] = all[item] || []).map(c => c.id));
        for (const c of list) if (c && c.id && !have.has(c.id)) all[item].push(Object.assign({ src: 'file' }, c));
      }
      store.del(k);
    }
    if (old.length) store.set(CUES, JSON.stringify(all));
    return all;
  }

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
  function claim(code) {
    const msg = (text, kind) => { $('codemsg').textContent = text; $('codemsg').className = kind || ''; };
    msg('Checking…');
    $('code').disabled = true;
    RemotePeer.claim($('server').value.trim() || defaultServer(), code, {
      onWait: () => msg('Found it. Connecting…', 'ok'),
      onGranted: frag => {
        const l = parse(frag);
        if (!l.r || !l.v) { msg('The timer sent something unexpected. Try again.', 'bad'); $('code').disabled = false; return; }
        store.set(SAVED_LINK, frag);
        link = l;
        $('enter').hidden = true;
        start();
      },
      onError: reason => {
        msg(reason === 'unreachable' ? 'Couldn’t reach the pairing server. Check the address under “Pairing server”.' : RemotePeer.CLAIM_ERRORS[reason] || 'Pairing failed: ' + reason, 'bad');
        $('code').disabled = false; $('code').value = ''; $('code').focus();
      },
    });
  }

  // ─── Connection (as a view-only device) ───────────────────────────────────
  let ws = null, peer = null, retry = 1000, retryTimer = null, hostOnline = false, waiting = false, refused = false;
  const joinPart = RemotePeer.joiner();

  function start() {
    $('paired').hidden = false;
    $('room').textContent = link.r;
    if (link.t) store.set(tokenKey(link.r), link.t);
    cues = loadCues();
    render();
    connect();
  }
  function status(text, kind) { $('status').textContent = text; $('status').className = kind || ''; }
  function showMode() {
    if (SOUNDBOARD) return status(adding || 'Soundboard', adding ? 'warn' : 'ok');
    if (DEMO) return status('Demo: no timer connected', 'ok');
    if (waiting) return status('Waiting for the timer… (closed, or it made a new share code: then unpair and pair again)', 'warn');
    if (!ws || ws.readyState !== WebSocket.OPEN) return status('Reconnecting…', 'warn');
    if (!hostOnline) return status('The timer is offline: waiting for it…', 'warn');
    status(peer && peer.mode === 'lan' ? '⚡ Connected directly (same network)' : peer && peer.mode === 'p2p' ? '⚡ Connected directly' : 'Connected via the server', 'ok');
  }
  const hello = () => peer && peer.send({ t: 'hello', token: store.get(tokenKey(link.r)) || undefined, clock: 1, client: 'playout' });
  function newPeer() {
    if (peer) peer.close();
    peer = RemotePeer.create({
      initiator: false,
      relay: msg => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'up', msg })); },
      onMessage, onModeChange: showMode,
    });
    hello();
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
        case 'host-offline': hostOnline = false; if (peer) peer.close(); peer = null; break;
        case 'host-online': hostOnline = true; newPeer(); break;
        case 'error':
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
      showMode();
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
    if (m.t === 'part') { const whole = joinPart(m); if (whole) onMessage(whole); return; }
    if (m.t === 'pin-required') {
      if (!pinCode) pinCode = String(100 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900));
      $('pincode').textContent = pinCode; $('pinwait').hidden = false;
      if (peer) peer.send({ t: 'pin', code: pinCode, name: 'Playout · ' + RemotePeer.deviceName() });
    } else if (m.t === 'pin-ok') {
      if (typeof m.token === 'string') store.set(tokenKey(link.r), m.token);
      pinCode = null; $('pinwait').hidden = true;
      hello();
    } else if (m.t === 'pin-rejected' || m.t === 'revoked') {
      refused = true;
      $('pinwait').hidden = false; $('pincode').textContent = '';
      $('pinmsg').textContent = m.t === 'revoked' ? 'The timer took this computer’s access away.' : 'The timer didn’t let this computer in. Reload this page to try again.';
    } else if (m.t === 'state' && m.s && typeof m.s === 'object') {
      if (m.s.clk && typeof m.s.clk === 'object') { anchor = m.s.clk; anchorAt = performance.now() - Math.max(0, Math.min(5000, Number(m.s.clk.a) || 0)); }
    } else if (m.t === 'playout') {
      onShow(m);
    }
  }

  // ─── The run sheet as the timer has it, and what happens on it ────────────
  let show = { items: [], cur: null, run: 0, at: null, on: false, fin: false }, showAt = 0;
  let anchor = null, anchorAt = 0;                     // the countdown (state.clk), for time cues
  let cues = {};
  let runSeen = null;                                  // the run (log length + item) the cues are watching
  const fired = new Set();                             // cue ids played in this run
  let prevCond = new Map();                            // time cues: was the condition true last tick?

  function onShow(m) {
    const was = show;
    show = {
      items: Array.isArray(m.items) ? m.items.filter(x => x && typeof x.id === 'string').map(x => { for (const k of ['s', 'x', 'a']) if (!Number.isFinite(x[k])) delete x[k]; return x; }) : [],   // (s, x, a: its planned, expected, actual start)
      cur: typeof m.cur === 'string' ? m.cur : null, run: Number(m.run) || 0,
      at: Number.isFinite(m.at) ? m.at : null, on: !!m.on, fin: !!m.fin,
      age: Number.isFinite(m.now) && Number.isFinite(m.at) ? m.now - m.at : null,   // how long ago it started, as sent
    };
    showAt = performance.now();
    if (show.run < was.run && following()) stopAll();  // Back: everything playing stops (not once the operator has taken over)
    const key = show.cur ? show.run + ':' + show.cur : null;
    if (key !== runSeen) {
      runSeen = key;
      fired.clear();
      prevCond = new Map();
      // A new item started: its start cues play, unless it started a while before we heard; and a To finish
      // cue longer than the item (from its planned length: the timer's new countdown may not be here yet),
      // joined partway so it still ends on time
      if (key && show.run > was.run && sinceStart() < LATE_START_MS) {
        const it = show.items.find(x => x.id === show.cur), cd = { remain: (it && it.d || 0) * 1000 - sinceStart() };
        fireWhere(c => c.trigger === 'start' || (c.trigger === 'finish' && it && it.d > 0 && condition(c, cd)), cd);
      }
      primeTimeCues();
    }
    prepare();
    render();
  }
  const sinceStart = () => show.age == null ? Infinity : show.age + (performance.now() - showAt);
  const following = () => !SOLO && store.get(FOLLOW) !== '0';   // (a demo or a soundboard has no timer to follow)
  const cueControl = () => store.get(CUE_CTL) === '1';   // single cues of an item started here (Options)
  function countdown() {
    if (!anchor) return null;
    const dt = performance.now() - anchorAt;
    return { remain: anchor.r + anchor.rr * dt, elapsed: anchor.e + anchor.er * dt };
  }
  const curCues = () => (show.cur && cues[show.cur]) || [];
  function condition(c, cd) {
    if (!cd) return false;
    if (c.trigger === 'end') return cd.remain <= 0;
    if (c.trigger === 'elapsed') return cd.elapsed >= c.at * 1000;
    if (c.trigger === 'remaining') return cd.remain <= c.at * 1000;
    if (c.trigger === 'finish') return cd.remain <= (c.at + lenOf(c)) * 1000;   // (in time to end n s before the end)
    return false;
  }
  // A To finish cue that's late (the audio longer than the time left): how far into it to start, so it still
  // ends on time (the owner, 13 Nov 2026: as radio backtiming); a moment's lateness (a tick) plays it whole
  const joinAt = (c, remain) => { if (c.trigger !== 'finish' || !Number.isFinite(remain)) return 0; const off = lenOf(c) - (remain / 1000 - c.at); return off > 0.3 ? off : 0; };
  // What's already true when an item is first seen doesn't play (a reconnect mid-item)
  function primeTimeCues() {
    const cd = countdown();
    for (const c of curCues()) if (c.trigger !== 'start') prevCond.set(c.id, condition(c, cd));
  }
  function fireWhere(test, cd) {
    if (!following() || !show.on || show.fin) return;
    for (const c of curCues()) if (test(c) && !fired.has(c.id)) { fired.add(c.id); play(c, { offset: joinAt(c, cd ? cd.remain : Infinity) }); }
  }
  function tick() {
    if (flow) tickFlow();
    if (local) tickLocal();
    if (place === 'external' && (!ext || ext.closed)) extGone();   // (closed without a pagehide)
    renderClocks();
    if (!show.cur || show.fin) return renderLocal();
    const cd = countdown();
    for (const c of curCues()) {
      if (c.trigger === 'start') continue;
      const now = condition(c, cd), before = prevCond.get(c.id);
      prevCond.set(c.id, now);
      if (now && before === false) fireWhere(x => x.id === c.id, cd);
    }
    renderNow(cd);
  }

  // ─── An item run here (Follow the timer off: ▶ Start item) ─────────────────
  // Its cues as if the item had started at the press: start cues at once, the others timed from it by
  // this computer's clock ('remaining' and 'end' from the item's planned length; no pauses). One at a
  // time, like the timer's items: starting another drops this one's cues still to come (what's playing
  // plays on). Ends when nothing more can play, on ■ Stop item or Stop all, or when Follow goes back on.
  let local = null;                                    // {item, t0, dur (s) | null, fired, prev}
  let lastRun = null;                                  // the item started here last (it doesn't flash: see activeItems)
  let deckBoard = null;                                // the Stream Deck soundboard (playout-deck.js), below
  const localCd = () => { const e = performance.now() - local.t0; return { elapsed: e, remain: local.dur == null ? Infinity : local.dur * 1000 - e }; };
  function runLocal(itemId, how) {                     // how (the playlist flow's): {flow, fadeIn (ms), silent}
    const it = show.items.find(x => x.id === itemId);
    if (flowOn()) {
      if (!(how && how.flow)) for (const p of playing.values()) if (p.run && p.item && p.item !== itemId) p.voice.fade(FLOW_MS);   // a jump: what was playing fades
      flow = { item: itemId, t0: performance.now(), heard: false, len: null, silent: (how && how.silent) || 0 };
    }
    local = { item: itemId, t0: performance.now(), dur: it && it.d > 0 ? it.d : null, fired: new Set(), prev: new Map() };
    lastRun = itemId;
    for (const c of cues[itemId] || []) if (c.trigger === 'start') { local.fired.add(c.id); play(c, { run: true, item: itemId, fadeIn: how && how.fadeIn }); }
    if (flow) prepare();                               // (the next one's clips ready for its crossfade)
    render();
  }
  // ─── Playlist flow (soundboard mode; the owner, 13 Nov 2026) ───
  // On: the items play one after another in the list's order, each crossfading into the next over FLOW_MS (equal
  // power, so the middle doesn't dip), the next starting that long before the last one's audio ends (half its length
  // for a short one). Starting another item (its key, ▶ Start item) jumps there: what was playing fades as a live fade
  // does, and the flow carries on from it. 🔁 Loop: after the last, the first. ■ Stop item, Stop all, Fade out and Esc end it.
  const FLOW_MS = 5000, FLOW = KEY + 'flow', FLOW_LOOP = KEY + 'flow_loop';
  let flow = null;                                     // {item, t0, heard (its audio played), len (s, as first known), crossed, silent}
  const flowOn = () => SOUNDBOARD && store.get(FLOW) === '1';
  const flowLoop = () => store.get(FLOW_LOOP) === '1';
  function flowNext(id) {                              // the next item with cues, in the list's order (🔁: round again)
    const list = show.items.filter(it => !it.e), i = list.findIndex(it => it.id === id), has = it => (cues[it.id] || []).length > 0;
    for (let k = i + 1; k < list.length; k++) if (has(list[k])) return list[k].id;
    if (flowLoop()) for (let k = 0; k <= i; k++) if (has(list[k])) return list[k].id;
    return null;
  }
  function tickFlow() {
    const it = flowOn() && show.items.find(x => x.id === flow.item);
    if (!it) { flow = null; return; }
    const run = runOf(flow.item);
    let left = 0, unknown = false, busy = false;       // (its audio still to end: playing, getting ready, or yet to fire)
    for (const c of cues[flow.item] || []) {
      const p = playing.get(c.id);
      if (starting.has(c.id) && !p) { busy = unknown = true; continue; }
      if (p ? !(p.run && p.item === flow.item) : !(run && !run.done(c))) continue;   // (a cue played on its own isn't the flow's)
      busy = true;
      if (p) flow.heard = true;
      const l = cueLeft(c, it, run);
      if (l == null) unknown = true; else left = Math.max(left, l);
    }
    if (!busy) {                                       // over (a length not known, or nothing played): the next, as it is
      const next = flowNext(flow.item), silent = flow.heard ? 0 : flow.silent + 1;
      if (!next || silent > show.items.length) { flow = null; renderFlow(); return; }   // (the end, or nothing would play: its output gone…)
      runLocal(next, { flow: true, silent });
      return;
    }
    if (!flow.heard || unknown || flow.crossed) return;
    if (flow.len == null) flow.len = left;
    if (left > Math.min(FLOW_MS / 1000, flow.len / 2)) return;
    flow.crossed = true;
    const next = flowNext(flow.item);
    if (!next) return;                                 // (the last: it plays out)
    const ms = Math.max(200, left * 1000);
    for (const p of playing.values()) if (p.run && p.item === flow.item) p.voice.xfade(ms);
    runLocal(next, { flow: true, fadeIn: ms });
  }
  function endLocal() { if (local) { local = null; render(); } }
  function renderFlow() {
    if (!SOUNDBOARD) return;
    const on = flowOn(), next = flow && flowNext(flow.item), it = next && show.items.find(x => x.id === next);
    $('sb-flow').setAttribute('aria-pressed', String(on));
    $('sb-loop').setAttribute('aria-pressed', String(flowLoop()));
    $('sb-flowhint').textContent = !on ? 'plays the items one after another in this order, each crossfading into the next over 5 s; starting another item carries on from there.'
      : flow ? (it ? 'Next: ' + titleOf(it) : 'This is the last: it plays out' + (flowLoop() ? '' : ' (🔁 to go round again)') + '.')
      : 'On: start an item and the rest follow it, crossfading over 5 s.';
  }
  function endFlow(itemId) { if (flow && flow.item === itemId) { flow = null; renderFlow(); } }   // (the operator stopped the item the flow is on)
  // Items playing as a whole: the one started here, and any whose run's cues still play (its run ended, or
  // another item started since: the owner, 12 Nov 2026). Each keeps ■ Stop item, green; with more than one,
  // all but the last started flash (and their playing cues' ■ with them): several items at once, on purpose?
  function activeItems() {
    const s = new Set(local ? [local.item] : []);
    for (const p of playing.values()) if (p.run && p.item) s.add(p.item);
    return s;
  }
  function tickLocal() {
    const cd = localCd(), list = cues[local.item] || [];
    for (const c of list) {
      if (c.trigger === 'start' || local.fired.has(c.id)) continue;
      const now = condition(c, cd), before = local.prev.get(c.id);
      local.prev.set(c.id, now);
      if (now && before !== true) { local.fired.add(c.id); play(c, { run: true, item: local.item, offset: joinAt(c, cd.remain) }); }   // (true from the press: at once)
    }
    if (list.every(c => local.fired.has(c.id)) && (local.dur == null || cd.remain <= 0)) endLocal();
  }
  // A cue added or retimed during its item: only from now on (what's already past doesn't play)
  function retime(itemId, c) {
    if (itemId === show.cur && c.trigger !== 'start') prevCond.set(c.id, condition(c, countdown()));
    if (local && local.item === itemId && c.trigger !== 'start') local.prev.set(c.id, condition(c, localCd()));
  }
  (function ticker(fn, ms) {                           // a worker's tick: keeps time in a background window
    try {
      const w = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},' + ms + ');'], { type: 'text/javascript' })));
      w.onmessage = fn; return;
    } catch (_) { /* no workers */ }
    setInterval(fn, ms);
  })(tick, 100);

  // ─── Playing (on this computer, to the Show output) ───────────────────────
  // As the timer's walk-up stings (sting-player.js): a clip up to MEMORY_MAX is cut in memory with its
  // fades and loop (instant and sample-exact; the current and next items' are made ready ahead), anything
  // else is streamed by a media element, seeked to its start and faded out at its end. Levelled as they
  // start (StingClip.gainFor: its trim, and only ever down to its output's level: see Levels below).
  const MEMORY_MAX = 180, FADE_MS = 3000;
  const SHOW = 'show';
  const fileOf = async c => { try { return await window.videoStore.get('pocue:' + c.id); } catch (_) { return null; } };
  const clipKey = c => c.id + '#' + JSON.stringify(StingClip.region(c) || {});
  const inMemory = c => c.media !== 'video' && !!StingClip.region(c) && !(c.duration > StingClip.LIMITS.source) && (StingClip.length(c, c.duration) || Infinity) <= MEMORY_MAX;
  const buffers = new Map();                           // clipKey → Promise<AudioBuffer | null>
  function bufferOf(c) {
    const k = clipKey(c);
    if (!buffers.has(k)) buffers.set(k, fileOf(c).then(b => b ? StingClip.decode(b) : null).then(buf => buf && StingClip.render(buf, c)).catch(err => { console.warn('Playout: couldn’t cut “' + c.name + '” in memory, streaming it instead', err); return null; }));
    return buffers.get(k);
  }
  // Where a cue plays: its own sound card (audio-out.js output(): checked from now on), Show, or null = a
  // video without its sound
  const outKey = c => c.out === 'none' && c.media === 'video' ? null
    : c.out && c.out.id && window.AudioOut ? AudioOut.output(c.out) : SHOW;
  // The clips of the item on now and the next one, ready (and no others kept), and their outputs checked
  function prepare() {
    const i = show.items.findIndex(x => x.id === show.cur);
    const ids = i >= 0 ? [show.items[i], show.items[i + 1]] : [show.items[0]];
    if (flow) { const n = flowNext(flow.item); ids.push(show.items.find(x => x.id === n)); }   // (the playlist flow's next)
    const want = new Set();
    for (const list of [...ids.map(it => (it && cues[it.id]) || []), cues[BOARD] || []]) for (const c of list) { outKey(c); if (inMemory(c)) { want.add(clipKey(c)); bufferOf(c); } }
    for (const k of [...buffers.keys()]) if (!want.has(k)) buffers.delete(k);
  }
  function tickEvery(ms, fn) {                         // (a worker's tick: keeps time in a background window)
    let w = null, iv = 0;
    try { w = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},' + ms + ')'], { type: 'text/javascript' }))); w.onmessage = fn; }
    catch (_) { iv = setInterval(fn, ms); }
    return () => { if (w) w.terminate(); else clearInterval(iv); };
  }
  // A volume ramp: to 0 or from 0, a fade (db: even in dB: StingClip.curveOut / curveIn; 'power': equal power, the
  // playlist flow's crossfade; else a straight line); else straight
  const powerOut = t => Math.cos(Math.min(1, t) * Math.PI / 2), powerIn = t => Math.sin(Math.min(1, t) * Math.PI / 2);
  function powerCurve(from, to) { const a = new Float32Array(64); for (let i = 0; i < 64; i++) a[i] = to === 0 ? from * powerOut(i / 63) : to * powerIn(i / 63); return a; }
  function rampEl(el, to, ms, done, db) {
    const steps = Math.max(1, Math.round(ms / 50)), from = el.volume, pw = db === 'power';
    let n = 0;
    const stop = tickEvery(50, () => {
      n++;
      const t = n / steps, v = to === 0 ? from * (pw ? powerOut(t) : StingClip.curveOut(t, db)) : from === 0 ? to * (pw ? powerIn(t) : StingClip.curveIn(t, db)) : from + (to - from) * t;
      el.volume = Math.max(0, Math.min(1, v));
      if (n >= steps) { stop(); if (done) done(); }
    });
    return stop;
  }
  // A voice's level(g) sets its gain while it plays (its output's level changed), not while it fades out
  function bufferVoice(c, buf, onEnd, out, off, xin) {   // xin: ms, faded in (the playlist flow's crossfade)
    let p = null, fading = false, riseEnd = 0;
    return {
      play() {
        p = StingClip.play(buf, { role: out, offset: off });
        if (p.refused) { p = null; return false; }
        if (xin) {
          const t = p.gain.context.currentTime;
          try { p.gain.gain.setValueCurveAtTime(powerCurve(0, gainOf(c, out)), t, xin / 1000); riseEnd = t + xin / 1000; } catch (_) { p.gain.gain.value = gainOf(c, out); }
          setTimeout(() => { if (p && !fading) p.gain.gain.setTargetAtTime(gainOf(c, out), p.gain.context.currentTime, 0.03); }, xin + 50);   // (its level now)
        } else p.gain.gain.value = gainOf(c, out);
        if (off && !xin) { const t = p.gain.context.currentTime; p.gain.gain.setValueAtTime(0, t); p.gain.gain.linearRampToValueAtTime(gainOf(c, out), t + 0.15); }   // (joined partway: no click)
        p.ended.then(onEnd);
        return true;
      },
      fade(ms) { if (p) { fading = true; p.fade(ms); } },
      xfade(ms) {                                      // out over ms, equal power, then stopped (the playlist flow)
        if (!p || fading) return;
        fading = true;
        const g = p.gain.gain, t = p.gain.context.currentTime, v = g.value;
        try { g.cancelScheduledValues(t); g.setValueCurveAtTime(powerCurve(v, 0), t, ms / 1000); p.stop(t + ms / 1000); } catch (_) { p.fade(ms); }
      },
      level(g) { if (p && !fading && p.gain.context.currentTime >= riseEnd) p.gain.gain.setTargetAtTime(g, p.gain.context.currentTime, 0.03); },   // (a quick glide: no click)
      sourceTime: () => (p ? StingClip.sourceAt(p.time(), StingClip.plan(c, c.duration || buf.duration).segs) : null),   // (where in the file: Mark start / end)
      gain: () => (p ? p.gain.gain.value : null),
      stop() { if (p) p.stop(); },
      release() {},
    };
  }
  // (over: stopped, or another cue took the element, while play() waited: it then leaves it alone)
  function elementVoice(c, el, url, onEnd, out, off, xin) {   // xin: ms, faded in (the playlist flow's crossfade)
    const r = StingClip.region(c) || {}, start = (r.start || 0) + (off || 0);   // (off: joined partway)
    let stopEnd = null, stopRamp = null, over = false, g = 0;
    el.src = url;
    const finish = () => { if (over) return; over = true; if (stopEnd) stopEnd(); if (stopRamp) stopRamp(); el.pause(); onEnd(); };
    const v = {
      async play() {
        if (start) await new Promise(res => { if (el.readyState >= 1) res(); else { el.addEventListener('loadedmetadata', res, { once: true }); el.addEventListener('error', res, { once: true }); } });   // (unreadable: play() says so)
        if (over) return false;
        if (start) el.currentTime = start;
        g = out ? gainOf(c, out) : 0;                  // (no sound: a video's picture only)
        el.volume = r.fadeIn || off || xin ? 0 : g;
        el.onended = finish;
        if (window.AudioOut && out) await AudioOut.media(el, out);
        if (over) return false;
        await el.play();
        if (over) return false;
        if (xin) stopRamp = rampEl(el, g, xin, () => { stopRamp = null; el.volume = g; }, 'power');
        else if (r.fadeIn || off) stopRamp = rampEl(el, g, off ? 150 : r.fadeIn, () => { stopRamp = null; el.volume = g; }, !off && !!r.fadeDb);   // (g: its level now; its own fade: its curve)
        if (r.end != null) stopEnd = tickEvery(50, () => {   // the end of the part: faded out there
          if (el.currentTime >= r.end - (r.fadeOut || 0) / 1000) { stopEnd(); stopEnd = null; v.fade(r.fadeOut || 30, !!r.fadeDb); }   // (its own fade: its curve)
        });
        return true;
      },
      fade(ms, db = true) { if (over) return; if (stopRamp) stopRamp(); stopRamp = rampEl(el, 0, ms, finish, db); },   // (live: even in dB)
      xfade(ms) { v.fade(ms, 'power'); },              // (the playlist flow: equal power)
      level(n) { if (over || !out) return; g = n; if (!stopRamp) el.volume = n; },   // (fading in: it ends at g)
      gain: () => el.volume,
      sourceTime: () => (over ? null : el.currentTime),   // (where in the file: Mark start / end)
      stop() { finish(); },
      release() { try { el.pause(); el.removeAttribute('src'); el.load(); } catch (_) { /* gone */ } URL.revokeObjectURL(url); },
    };
    return v;
  }
  const playing = new Map();                           // cue id → {voice, video}
  const starting = new Set();                          // cue ids whose play() is getting ready (its file read, decoded)
  const vid = $('vid');                                // video cues' element: in the Output box, or the floating window
  async function play(c, how) {                        // how.run: played by an item started here (how.item); how.offset: s into it (joined partway); how.fadeIn: ms
    starting.add(c.id);
    try { await playNow(c, how); } finally { starting.delete(c.id); }
  }
  async function playNow(c, how) {
    const out = outKey(c);
    if (out && window.AudioOut && !AudioOut.ok(out)) {   // its output isn't there: an audio cue doesn't play,
      AudioOut.warn(out);                                // a video plays without its sound (audio-out.js mutes it)
      if (c.media !== 'video') return;
    }
    const memory = inMemory(c) ? await bufferOf(c) : null;
    const blob = memory ? null : await fileOf(c);
    if (!memory && !blob) { status('The file for “' + c.name + '” isn’t in this browser any more. Add the cue again.', 'warn'); return; }
    stopCue(c.id);
    if (tones.size) { for (const k of [...tones.keys()]) stopTone(k); renderLevels(); }   // (no 1 kHz under a cue: the owner, 13 Nov 2026)
    if (c.media === 'video') for (const [id, q] of playing) if (q.video) stopCue(id);   // one video on the output at a time
    const off = how && how.offset > 0 ? how.offset : 0, xin = how && how.fadeIn > 0 ? how.fadeIn : 0;
    const p = { video: c.media === 'video', run: !!(how && how.run), item: how && how.item, c, out, endsAt: null };
    const onEnd = () => { if (playing.get(c.id) === p) stopCue(c.id); };
    p.voice = memory ? bufferVoice(c, memory, onEnd, out, off, xin) : elementVoice(c, p.video ? vid : new Audio(), URL.createObjectURL(blob), onEnd, out, off, xin);
    playing.set(c.id, p);
    if (p.video) $('stage').querySelector('.idle').hidden = true;
    render();
    let ok = false;
    try { ok = await p.voice.play(); if (ok && lenOf(c)) p.endsAt = performance.now() + Math.max(0, lenOf(c) - off) * 1000; }   // (its countdown)
    catch (err) { if (playing.get(c.id) === p) status('The browser didn’t let “' + c.name + '” play: click anywhere on ' + (p.video && place === 'external' ? 'the floating window' : 'this page') + ' once.', 'warn'); }
    if (!ok && playing.get(c.id) === p) stopCue(c.id);   // (not when another cue took over meanwhile: no false alarm)
  }
  function stopCue(id) {
    const p = playing.get(id);
    if (!p) return;
    playing.delete(id);
    p.voice.stop(); p.voice.release();
    if (p.video) $('stage').querySelector('.idle').hidden = false;
    render();
  }
  function stopAll() {
    if (flow) { flow = null; renderFlow(); }
    for (const id of [...playing.keys()]) stopCue(id);
    if (tones.size) { for (const k of [...tones.keys()]) stopTone(k); renderLevels(); }
  }

  // ─── Levels: loudness normalisation per output (the owner, 12 Nov 2026; always the quietest, 13 Nov;
  //     the level box and Automatic levels, 13 Nov) ───
  // Each output (Show, and each sound card a cue has of its own) plays its cues as loud as its quietest
  // measured cue (quietOf): the louder ones are turned down to it, never up (StingClip.gainFor, from their
  // loudness as they play), so every cue on it is as loud as the next. Not chosen: worked out from the cues on
  // it (the sheet's and the extra keys'). Automatic levels (on unless playout_levels_auto is '0'): a new
  // quietest (a cue added, measured or removed) is used at once (applyLevels(), from renderLevels() when a
  // level moved: what's playing follows, and so does a tone); off, the level in use (held) stays until the
  // operator says so. The level box (#levelbox, top right) shows each output's level and its biggest cut; a
  // click (or ▶ Tone on that output) means the desk is set for it (ack; automatic off: held = the new level
  // too). It flashes while a level differs from the one the desk was set for (or, automatic off, from the one
  // in use), amber while the desk was never set. Off: its cues as recorded (only a ✂ trim). ▶ Tone: the
  // line-up tone at that level, on that output, to set the desk by. Console trim (the owner, 13 Nov 2026):
  // the makeup gain for a desk's digital trim (or a channel compressor's makeup gain, the compressor at 1:1 or a
  // threshold it never reaches: the owner), its LUFS trim offset (per output, 0 dB unless set) − the level
  // in use, so a level 3 dB lower reads 3 dB more: calibrated once (the offset making it read the trim the
  // desk sounds right at), the desk's trim then just follows it.
  const LEVELS = KEY + 'levels';                      // {show | out:<id>: {off?, ack?, held?, trim?}} (playout_demo_levels, playout_board_levels…)
  const AUTO = KEY + 'levels_auto';                    // '0': Automatic levels off
  let levels = {};
  try { const v = JSON.parse(store.get(LEVELS) || '{}'); if (v && typeof v === 'object') levels = v; } catch (_) { /* none yet */ }
  const levelOf = k => ({ off: !!(levels[k] && levels[k].off) });
  const autoLevels = () => store.get(AUTO) !== '0';
  const numOf = (k, f) => { const v = levels[k] && levels[k][f]; return Number.isFinite(v) ? v : null; };
  function saveLevels() {
    for (const k of Object.keys(levels)) if (!levels[k] || !Object.keys(levels[k]).length) delete levels[k];
    store.set(LEVELS, JSON.stringify(levels));
  }
  function quietestOf(k) { let q = null; for (const c of sheetCues()) if (outKey(c) === k && Number.isFinite(c.lufs) && (!q || c.lufs < q.lufs)) q = c; return q; }
  const quietOf = k => { if (levelOf(k).off) return null; const q = quietestOf(k); return q ? Math.round(q.lufs * 10) / 10 : null; };
  const targetOf = k => (levelOf(k).off ? null : autoLevels() ? quietOf(k) : numOf(k, 'held'));   // the level in use
  const trimOf = (k, level) => (level == null ? null : Math.round(((numOf(k, 'trim') || 0) - level) * 10) / 10);   // console trim at that level
  const sdB = v => (v >= 0.05 ? '+' : v <= -0.05 ? '−' : '') + Math.abs(v).toFixed(1);   // (+3.0, −2.5, 0.0)
  const gainOf = (c, out) => StingClip.gainFor(c, targetOf(out));
  const tones = new Map();                             // output → {v: the tone playing on it, ref: the level it was made at}
  let applied = '';                                    // the levels last applied (renderLevels: apply when they move)
  function applyLevels() {
    for (const p of playing.values()) if (p.out) p.voice.level(gainOf(p.c, p.out));
    for (const [k, tn] of [...tones]) {
      const t = targetOf(k);
      if (t == null) stopTone(k);
      else tn.v.gain.gain.setTargetAtTime(Math.pow(10, (t - tn.ref) / 20), tn.v.gain.context.currentTime, 0.02);
    }
  }
  function setLevel(k, v) {                            // on / off
    levels[k] = Object.assign({}, levels[k]);
    if (v.off) levels[k].off = true; else delete levels[k].off;
    saveLevels();
    applyLevels();
    renderLevels();
  }
  // The desk is set for output k's level now (the level box clicked, or ▶ Tone): automatic off, it's used from now
  function confirmLevel(k) {
    const q = quietOf(k);
    if (q == null) return;
    levels[k] = Object.assign({}, levels[k], { ack: q }, autoLevels() ? {} : { held: q });
    saveLevels();
  }
  function setAuto(on) {
    if (!on) for (const k of outputs().keys) { const q = quietOf(k); if (q != null) levels[k] = Object.assign({}, levels[k], { held: q }); }   // (the level in use now stays)
    store.set(AUTO, on ? '1' : '0');
    saveLevels();
    renderLevels();                                    // (on: a level waiting is used at once)
  }
  function startTone(k) {
    if (playing.size) return;                          // (not while cues play: the owner, 13 Nov 2026)
    confirmLevel(k);                                   // (setting the desk by it: as a click on the level box)
    renderLevels();                                    // (a level waiting is used: what's playing too)
    const t = targetOf(k);
    if (t == null) return;
    const v = StingClip.play(StingClip.toneBuffer(t), { role: k, loop: true });   // (its output not there: refused, and says why)
    if (v.refused) return;
    const tn = { v, ref: t };
    tones.set(k, tn);
    v.ended.then(() => { if (tones.get(k) === tn) { tones.delete(k); renderLevels(); } });   // (faded out: Esc)
  }
  function stopTone(k) { const tn = tones.get(k); if (tn) { tones.delete(k); tn.v.stop(); } }
  // ─── Where videos play: here (the Output box; F = full screen) or a floating window ───
  // To external monitor opens a pop-up (the owner's design, 12 Nov 2026) to drag to the audience's screen
  // and make full screen (double-click or F there), and moves the video element into it; Play here
  // instead moves it back, leaving the window open and black (not while a video plays there). Moving the
  // element makes Chromium load it again from 0, so a playing video is paused, moved and put back where it
  // was: a break of a few frames (~15 ms measured), not a restart. Closed by hand, the video comes back
  // here. The window outlives a reload of this page (blacked out): the button finds it again by name.
  const stageEl = $('stage'), EXT = 'playout_external', ME = Math.random().toString(36).slice(2);
  const EXT_CSS = 'html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }' +
    ' #xstage { position: fixed; inset: 0; } #xstage video { width: 100%; height: 100%; object-fit: contain; }' +
    ' #xhint { position: fixed; left: 0; right: 0; bottom: 12px; margin: 0; text-align: center; font: 14px/1.4 "Helvetica Neue", Arial, sans-serif; color: #777; }' +
    ' html:fullscreen #xhint { display: none; } html:fullscreen { cursor: none; }';
  let ext = null, place = 'here';
  const extHost = () => (ext && !ext.closed && ext.__po === ME ? ext.document.getElementById('xstage') : null);
  function setupExternal(w) {                          // (again after a reload of this page: its listeners went with it)
    const d = w.document;
    d.title = (location.hostname ? location.hostname + ' - ' : '') + 'Playout output';
    d.head.innerHTML = '<style>' + EXT_CSS + '</style>';
    d.body.innerHTML = '<div id="xstage"></div><p id="xhint">Drag this window to the audience’s screen, then double-click it (or press F) for full screen.</p>';
    const full = () => { if (d.fullscreenElement) d.exitFullscreen(); else d.documentElement.requestFullscreen().catch(() => {}); };
    d.addEventListener('dblclick', full);
    d.addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey) full(); });
    w.addEventListener('pagehide', () => { if (ext === w) extGone(); });
    w.__po = ME;
  }
  function extGone() { ext = null; if (place === 'external') moveVideo('here'); }
  function moveVideo(where) {
    const host = where === 'external' ? extHost() : stageEl;
    if (!host) return;
    place = where;
    if (vid.parentNode !== host) {
      const was = vid.getAttribute('src') && !vid.paused, t = vid.currentTime, t0 = performance.now();
      if (was) vid.pause();
      host.appendChild(vid);
      if (was) {
        const go = () => { vid.currentTime = t + (performance.now() - t0) / 1000; vid.play().catch(() => status('The browser didn’t let the video carry on: click anywhere on ' + (place === 'external' ? 'the floating window' : 'this page') + ' once.', 'warn')); };
        if (vid.readyState >= 1) go(); else vid.addEventListener('loadedmetadata', go, { once: true });
      }
      if (window.AudioOut && vid.__aoOut) AudioOut.media(vid);   // (routed again, as its new window knows the card)
    }
    renderPlace();
  }
  const videoOn = () => [...playing.values()].some(p => p.video);
  function toExternal() {
    if (!extHost()) {
      if (videoOn()) return;                           // (set up with nothing playing: renderPlace)
      const w = window.open('', EXT, 'popup,width=960,height=540');
      if (!w) return status('The browser blocked the window: allow pop-ups for this site, then try again.', 'warn');
      ext = w;
      if (w.__po !== ME) setupExternal(w);
    }
    moveVideo('external');
  }
  // Off while a video plays out there (Play here instead), and while one plays here with no window yet
  // (the owner: the monitor is set up deliberately, with nothing playing; once it's open, a playing
  // video may move to it)
  function renderPlace() {
    const external = place === 'external', on = videoOn(), setup = !external && on && !extHost();
    // An item started here playing its video in the Output box, not on the audience's screen: the button
    // flashes (the owner: in a live show it may save the operator), until the video moves out or stops
    const remind = !external && [...playing.values()].some(p => p.video && p.run);
    const b = $('ext');
    b.textContent = external ? 'Play here instead' : 'To external monitor';
    b.disabled = (external && on) || setup;
    b.classList.toggle('flash', remind);
    b.title = remind && !setup ? 'This item’s video is playing here, not on the external monitor: click to move it there'
      : external && on ? 'Not while a video plays on the external monitor'
      : setup ? 'Set up the external monitor with no video playing: stop it first (once the window is open, a playing video can move to it)'
      : external ? 'Videos play in the Output box here again (the floating window stays open, black)'
      : 'Videos play in a floating window: drag it to another screen and make it full screen there';
    $('full').disabled = external;
    stageEl.classList.toggle('external', external);
  }
  addEventListener('pagehide', () => { const h = extHost(); if (h) h.replaceChildren(); });   // (left open, black)

  // ✎: when a cue plays (its trigger and time); the sound stays
  function retimeCue(itemId, c, trigger, at) {
    const now = findCue(c.id);
    if (!now) return render();
    now.c.trigger = trigger;
    now.c.at = trigger === 'elapsed' || trigger === 'remaining' ? at : 0;
    saveCues();
    retime(itemId, now.c);
    render();
  }
  function fadeAll(ms) { if (flow) { flow = null; renderFlow(); } for (const p of playing.values()) p.voice.fade(ms); for (const tn of tones.values()) tn.v.fade(ms); }

  // ─── Cues (made here, kept here) ──────────────────────────────────────────
  // To finish (the owner, 13 Nov 2026): starts when it needs to, to end n s before the item does (0: at its end)
  const TRIGGERS = { start: 'At the start', end: 'When time’s up', elapsed: 'After', remaining: 'With … left', finish: 'To finish … before the end' };
  const whenText = c => c.trigger === 'elapsed' ? 'After ' + mmss(c.at) : c.trigger === 'remaining' ? 'With ' + mmss(c.at) + ' left'
    : c.trigger === 'finish' ? (c.at ? 'To finish ' + mmss(c.at) + ' before the end' : 'To finish at the end') : TRIGGERS[c.trigger];
  const lenOf = c => StingClip.length(c, c.duration) || 0;   // as it plays (its part, a loop), s
  const noExt = n => String(n || '').replace(/\.[A-Za-z0-9]{1,5}$/, '') || String(n || '');
  const findCue = id => { for (const [item, list] of Object.entries(cues)) { const c = list.find(x => x.id === id); if (c) return { item, c }; } return null; };
  function saveCues() { store.set(CUES, JSON.stringify(cues)); prepare(); }
  function probeDuration(blob) {                       // the whole file's length (s), or null
    return new Promise(res => {
      const el = document.createElement(/^video\//.test(blob.type) ? 'video' : 'audio'), url = URL.createObjectURL(blob);
      const done = d => { URL.revokeObjectURL(url); el.removeAttribute('src'); res(Number.isFinite(d) && d > 0 ? Math.round(d * 10) / 10 : null); };
      el.preload = 'metadata'; el.onloadedmetadata = () => done(el.duration); el.onerror = () => done(null);
      setTimeout(() => done(null), 8000);
      el.src = url;
    });
  }
  // Its loudness as it plays (sting-clip.js), for levelling; the clip editor measures it too
  async function measure(c) {
    if (c.duration > StingClip.LIMITS.source) return;
    try {
      const blob = await fileOf(c), l = blob && StingClip.loudness(StingClip.render(await StingClip.decode(blob), c));
      const now = findCue(c.id);
      if (now && Number.isFinite(l)) { now.c.lufs = l; saveCues(); renderLevels(); }
    } catch (_) { /* no sound to measure, or unreadable: plays as it is */ }
  }
  // A cue from the + sting dialog's choice (sting-picker.js; random stings make the same kind): the
  // file, or a copy of the stock sting or link, kept in this browser under a new id. song: its track
  // (StingRoll.songOf's form), so random stings don't pick it again. Throws what went wrong.
  async function cueFrom(ch, fields) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    let blob, cue;
    if (ch.file) {
      const f = await StingClip.playable(ch.file);   // (an AIFF as WAV)
      if (!/^(audio|video)\//.test(f.type)) throw new Error('Choose an audio or video file.');
      const x = ch.extra || {};
      blob = f;
      cue = Object.assign({ name: String(x.name || noExt(f.name)).slice(0, 200), media: f.type.startsWith('video/') ? 'video' : 'audio', src: 'file', song: 'size:' + ch.file.size,
        file: String(ch.file.name || '').slice(0, 300) }, x.clip, x.lib ? { lib: x.lib } : {});   // (file: its own name, to find it again: a soundboard loaded elsewhere)
    } else {
      const s = ch.sting;
      try { const r = await fetch(s.url); if (!r.ok) throw new Error('HTTP ' + r.status); blob = await r.blob(); }
      catch (err) { throw new Error('Couldn’t copy “' + s.name + '” to this computer (' + (err && err.message || err) + ').'); }
      cue = Object.assign({ name: s.name, media: s.media === 'video' ? 'video' : 'audio', src: s.src === 'link' ? 'link' : 'stock', duration: s.duration || null, song: 'url:' + s.url }, StingPicker.clipFields(s), s.lib ? { lib: s.lib } : {});
    }
    if (cue.duration == null) cue.duration = await probeDuration(blob);
    try { await window.videoStore.put('pocue:' + id, blob); } catch (err) { throw new Error('Couldn’t keep the file in this browser: ' + (err && err.message || err)); }
    return Object.assign({ id }, fields, cue);
  }
  async function addCue(itemId, ch, trigger, at) {
    status('Adding the cue…');
    let cue;
    try { cue = await cueFrom(ch, { trigger, at: at || 0 }); } catch (err) { alert(err && err.message || err); showMode(); return null; }
    (cues[itemId] = cues[itemId] || []).push(cue);
    saveCues();
    retime(itemId, cue);                               // added during its item: only from now on
    showMode();
    render();
    if (!Number.isFinite(cue.lufs)) measure(cue);
    return cue;
  }
  function removeCue(itemId, id) {
    stopCue(id);
    cues[itemId] = (cues[itemId] || []).filter(c => c.id !== id);
    if (!cues[itemId].length) delete cues[itemId];
    saveCues();
    window.videoStore.remove('pocue:' + id).catch(() => {});
    render();
  }
  // ✂: the part to play, fades, a loop, a trim (sting-clip.js's clip editor). The file isn't cut.
  // Mark start / Mark end (the owner, 13 Nov 2026): a cue playing on its own (its ▶, or a key) → the editor, with that
  // edge where it is now (the start half a second back, for the reaction), the close-up on it as First / Last 2 s do
  const MARK_LEAD = 0.5;
  function markCue(c, edge) {
    const p = playing.get(c.id), t = p && p.voice.sourceTime ? p.voice.sourceTime() : null;
    if (t == null || !Number.isFinite(t)) return;
    stopCue(c.id);
    const at = Math.round(Math.max(0, edge === 'start' ? t - MARK_LEAD : t) * 100) / 100, r = Object.assign({}, c);
    if (edge === 'start') { r.start = at; if (r.end != null && r.end <= at + 0.1) delete r.end; }
    else { r.end = at; if ((r.start || 0) >= at - 0.1) delete r.start; }
    editCue(c, { region: r, focus: edge });
  }
  async function editCue(c, mark) {
    const blob = await fileOf(c);
    if (!blob) { alert('The file for “' + c.name + '” isn’t in this browser any more. Add the cue again.'); return; }
    const out = outKey(c);                             // (its loudness shown against its output's level)
    const r = await StingClip.open({ src: blob, name: c.name, region: mark ? mark.region : c, focus: mark && mark.focus, media: c.media, level: out ? { target: targetOf(out) } : undefined });
    const now = r && findCue(c.id);
    if (!now) return;
    now.c.name = String(r.name || now.c.name).slice(0, 200);
    delete now.c.rolled;                               // edited: yours now (a roll leaves it alone)
    for (const k of StingPicker.CLIP_KEYS) { if (r[k] == null) delete now.c[k]; else now.c[k] = r[k]; }
    if (now.c.duration == null && r.sourceLength) now.c.duration = Math.round(r.sourceLength * 10) / 10;
    saveCues();
    render();
  }
  // Cues of items the timer's sheet doesn't have (another show's, or deleted): kept until removed here
  const orphanIds = () => show.items.length ? Object.keys(cues).filter(k => k !== BOARD && !show.items.some(it => it.id === k)) : [];

  // ─── Random stings (as the run sheet editor's; the pool and the pick are sting-roll.js's) ─────
  // 🎲 Roll stings gives every item long enough to be a speaker an At the start cue with a walk-up sting
  // picked at random, none used twice on the sheet (cues chosen by hand count too, by their song), copied
  // into this browser like any cue; 🎲 on an item picks another. Rolled cues carry rolled: true and are
  // the only ones a roll replaces, keeping when and where they play (✎, the output menu); a roll of the
  // sheet leaves items with a start cue of your own alone (🎲 on one adds a rolled cue beside it), and ✂
  // makes a rolled cue yours. Items that have run and the live one (following the timer), and one started
  // here, are never rolled.
  const ROLL = 'playout_roll';
  let rolling = false;
  const rolledOf = id => (cues[id] || []).find(c => c.rolled);
  const ownStart = id => (cues[id] || []).some(c => c.trigger === 'start' && !c.rolled);
  function rollable(it, o, sheetRoll) {
    if (!it || it.e) return false;
    const i = show.items.indexOf(it), cur = following() ? show.items.findIndex(x => x.id === show.cur) : -1;
    if ((cur >= 0 && i <= cur) || (local && local.item === it.id)) return false;
    return !sheetRoll || (!ownStart(it.id) && (it.d || 0) >= o.min * 60);
  }
  const rollMsg = (text, bad) => { $('roll-msg').textContent = text; $('roll-msg').classList.toggle('bad', !!bad); };
  // Picks for the items (ids) first, then puts them in as things are by then (an item that changed
  // meanwhile is left alone, the file kept for it removed) and saves once. → {got, none}
  // reuse (the operator said yes when they ran out: the owner, 13 Nov 2026): songs already chosen, the least
  // used first, not the one the item before or after it has (StingRoll.reuse). → {got, none, missing}
  async function rollItems(ids, o, sheetRoll, reuse) {
    const stock = await StingPicker.stock(), songs = await StingRoll.pool(o, stock);
    const targets = new Set(ids), used = new Set();
    for (const it of show.items) for (const c of cues[it.id] || []) if (c.song && !(c.rolled && targets.has(it.id))) used.add(c.song);
    const songAt = new Map(), counts = new Map();      // an item's walk-up (its rolled cue, else a start cue of its own), and how many have each
    for (const it of show.items) { const l = cues[it.id] || [], c = l.find(x => x.rolled && x.song) || l.find(x => x.trigger === 'start' && x.song); if (c) { songAt.set(it.id, c.song); counts.set(c.song, (counts.get(c.song) || 0) + 1); } }
    const near = id => { const k = show.items.findIndex(x => x.id === id), s = new Set(); for (const j of [k - 1, k, k + 1]) if (show.items[j] && songAt.get(show.items[j].id)) s.add(songAt.get(show.items[j].id)); return s; };
    const picks = [], missing = [];
    let none = 0, again = 0;
    for (const id of ids) {
      const was = rolledOf(id) ? rolledOf(id).song : null;
      // Another song if there is one; rolling the sheet, its own again rather than none (🎲 on an item: only another)
      let p;
      if (reuse) p = await StingRoll.reuse(songs, counts, o, near(id));
      else { p = await StingRoll.pick(songs, used, o, was); if (!p && was && sheetRoll) p = await StingRoll.pick(songs, used, o, null); }
      if (!p) {
        none++;
        if (was && !used.has(was) && !songs.excluded.has(was)) used.add(was);    // it keeps the one it has (unless it's a file excluded from random picks since)
        else { missing.push(id); if (was && sheetRoll) picks.push([id, null]); }   // (its song went to another item: it can't keep it too)
        continue;
      }
      used.add(p.song);
      if (reuse) { counts.set(p.song, (counts.get(p.song) || 0) + 1); songAt.set(id, p.song); }
      if (p.song === was) { again++; continue; }      // its own again: the cue it has (no second copy)
      try {
        const ch = await StingRoll.choice(p.c, stock);
        if (!ch) { none++; continue; }
        const cue = await cueFrom(ch, { trigger: 'start', at: 0, rolled: true });
        cue.song = p.song;
        picks.push([id, cue]);
      } catch (err) { console.warn('Random stings: couldn’t keep a sting', err); none++; }
    }
    let got = 0;
    const fresh = [];
    const drop = c => { stopCue(c.id); window.videoStore.remove('pocue:' + c.id).catch(() => {}); };
    for (const [id, cue] of picks) {
      const it = show.items.find(x => x.id === id), old = rolledOf(id), list = cues[id] || [];
      if (!it || !rollable(it, o, false) || (sheetRoll && ownStart(id))) { if (cue) drop(cue); continue; }
      if (old) drop(old);
      if (!cue) { if (old) list.splice(list.indexOf(old), 1); }   // (its song went to another item)
      else {
        if (old) { Object.assign(cue, { trigger: old.trigger, at: old.at }, old.out ? { out: old.out } : {}); list.splice(list.indexOf(old), 1, cue); }
        else list.unshift(cue);                       // (a walk-up: first in the item's list)
        retime(id, cue);
        fresh.push(cue); got++;
      }
      if (list.length) cues[id] = list; else delete cues[id];
    }
    if (picks.length) { saveCues(); render(); }
    (async () => { for (const c of fresh) if (!Number.isFinite(c.lufs)) await measure(c); })();   // their levels, one at a time
    return { got: got + again, none, missing };
  }
  // Ran out: ask whether to reuse stings already chosen (the owner, 13 Nov 2026)
  const askReuse = (n, o) => confirm(n ? `${n} item${n === 1 ? '' : 's'} didn’t get a sting: there aren’t enough stings ${StingRoll.which(o)}for every item. OK to reuse stings already chosen for other items? (The least used first, and never the same as the item just before or after, if there’s any other.)`
    : `No other sting to pick: every one ${StingRoll.which(o)}is already chosen. OK to reuse one already chosen for another item? (The least used, and not the same as the item just before or after, if there’s any other.)`);
  async function rollAll() {
    if (rolling) return;
    const o = StingRoll.opts(ROLL);
    if (StingRoll.none(o)) return rollMsg('Tick where stings may come from.', true);
    const ids = show.items.filter(it => rollable(it, o, true)).map(it => it.id);
    if (!ids.length) return rollMsg(`No items to give a sting: none ${o.min ? 'of ' + o.min + ' min or more ' : ''}without a start cue of your own still to come.`, true);
    rolling = true; rollMsg('Rolling…'); render();
    try {
      const r = await rollItems(ids, o, true);
      const again = r.missing.length && askReuse(r.missing.length, o) ? await rollItems(r.missing, o, true, true) : null;
      const kept = show.items.filter(it => ownStart(it.id) && rollable(it, o, false)).length;
      const got = r.got + (again ? again.got : 0), none = again ? again.none : r.none;
      rollMsg(`${got} item${got === 1 ? '' : 's'} got a sting at random` + (again && again.got ? ` (${again.got} reusing one already chosen)` : '') + (kept ? `; ${kept} kept the start cue chosen for ${kept === 1 ? 'it' : 'them'}` : '') +
        (none ? `; ${none} didn’t: not enough stings ${StingRoll.which(o)}${again ? 'at all' : 'left unused'}.` : '.'), none > 0);
    } finally { rolling = false; render(); }
  }
  async function rollOne(id) {
    if (rolling) return;
    const it = show.items.find(x => x.id === id), o = StingRoll.opts(ROLL);
    if (!rollable(it, o, false)) return;
    if (StingRoll.none(o)) { $('rollpanel').open = true; alert('Choose where random stings come from in Random stings (under the run sheet) first.'); return; }
    rolling = true; status('Picking a sting…'); render();
    try {
      const r = await rollItems([id], o, false);
      if (!r.got && askReuse(0, o) && !(await rollItems([id], o, false, true)).got) alert(`No sting ${StingRoll.which(o)}to pick at all.`);
    } finally { rolling = false; showMode(); render(); }
  }
  function clearRolled() {
    const o = StingRoll.opts(ROLL), its = show.items.filter(it => rolledOf(it.id) && rollable(it, o, false));
    if (!its.length) return rollMsg('No rolled stings to remove (items that have run, and the one playing, keep theirs).');
    const n = its.reduce((a, it) => a + cues[it.id].filter(c => c.rolled).length, 0);
    if (!confirm(`Remove the ${n} sting${n === 1 ? '' : 's'} picked at random? Cues you chose stay.`)) return;
    for (const it of its) for (const c of cues[it.id].filter(x => x.rolled)) removeCue(it.id, c.id);
    rollMsg(`${n} rolled sting${n === 1 ? '' : 's'} removed.`);
  }
  async function renderRollPanel() {
    const o = StingRoll.opts(ROLL);
    $('roll-stock').checked = o.stock; $('roll-mine').checked = o.mine; $('roll-folder').checked = o.folder;
    $('roll-min').value = o.min; $('roll-lenop').value = o.lenOp; $('roll-len').value = o.len; $('roll-len').disabled = !o.lenOp;
    const folder = StingPicker.folder();
    let name = folder && folder.name;
    if (!name) { const sf = await StingPicker.savedFolder(); name = sf && sf.handle.name; }
    $('roll-foldername').textContent = name ? '“' + name + '”' : '(none chosen yet)';
    $('roll-folderpick').textContent = name ? 'Another…' : 'Choose…';
    $('roll-stylerow').hidden = !StingRoll.styled();
    if (StingRoll.styled()) renderRollChips(o);
  }
  // Random stings' styles (a trial: sting-styles.js): chips of the genres and styles the ticked sources have,
  // with how many (the owner, 13 Nov 2026: choose from what there is, several at once): stock stings, and files
  // of your own once listened to on this computer (step 4: automatic, StingRoll.listen; redrawn as each is done);
  // the hint says how many are in the ones lit, and how many of yours aren't listened to yet
  let rollChips = null, rollSeq = 0;
  async function renderRollChips(o) {
    const n = ++rollSeq, sv = await StingRoll.survey(o, await StingPicker.stock(), false);
    if (n !== rollSeq) return;                       // (a newer one is on its way)
    if (!rollChips) rollChips = StingStyles.chips($('roll-chips'), sv.lists, o.styles, () => saveRollOpts());
    else rollChips.set(sv.lists, o.styles);
    StingRoll.listen(sv);
    $('roll-stylehint').textContent = StingRoll.hint(sv, o.styles);
    $('roll-listen').textContent = StingStyles.listenNote();
  }
  if (StingRoll.styled()) StingStyles.onLocal(() => renderRollChips(StingRoll.opts(ROLL)));
  function saveRollOpts() {
    const o = StingRoll.saveOpts(ROLL, { stock: $('roll-stock').checked, mine: $('roll-mine').checked, folder: $('roll-folder').checked,
      min: $('roll-min').value, lenOp: $('roll-lenop').value, len: $('roll-len').value, styles: rollChips ? rollChips.keys() : StingRoll.opts(ROLL).styles });
    $('roll-len').disabled = !o.lenOp;
    if (StingRoll.styled()) renderRollChips(o);
  }
  for (const k of ['roll-stock', 'roll-mine', 'roll-folder', 'roll-min', 'roll-lenop', 'roll-len']) $(k).addEventListener('change', saveRollOpts);
  $('roll-all').addEventListener('click', e => { e.currentTarget.blur(); rollAll(); });
  $('roll-clear').addEventListener('click', e => { e.currentTarget.blur(); clearRolled(); });
  $('roll-folderpick').addEventListener('click', e => { e.currentTarget.blur(); StingPicker.chooseFolder(); });
  StingPicker.onFolder(() => renderRollPanel());       // (+ cue's folder, chosen there or here)
  renderRollPanel();

  // ─── Page ─────────────────────────────────────────────────────────────────
  const lenText = c => { const l = StingClip.length(c, c.duration); return l ? mmss(Math.max(1, l)) : ''; };
  // A cue's output menu: Show, this computer's sound cards (named once the browser may: AudioOut.ask),
  // and for a video No sound
  let outList = [];
  const refreshOuts = () => { if (window.AudioOut) AudioOut.devices().then(l => { outList = l; render(); }); };
  document.addEventListener('audio-out', refreshOuts);
  const cardOf = o => {                                // a cue's sound card in the list now (as audio-out.js finds it), or null
    const named = o.label ? outList.filter(d => d.label === o.label) : [];
    return outList.find(x => x.id === o.id) || (named.length === 1 ? named[0] : null);
  };
  function outMenu(c) {
    const ao = window.AudioOut && AudioOut.supported, opts = [['', '→ Show']];
    let val = '';
    if (ao) {
      outList.forEach((d, i) => opts.push([d.id, '→ ' + (d.label || 'Sound card ' + (i + 1))]));
      if (c.out && c.out.id) {
        const d = cardOf(c.out);
        if (d) val = d.id;
        else { opts.push([c.out.id, '→ ' + (c.out.label || 'Its sound card') + ' (not connected)']); val = c.out.id; }
      }
      if (!outList.some(d => d.label)) opts.push(['?', 'Name the sound cards…']);
    }
    if (c.media === 'video') { opts.push(['none', 'No sound']); if (c.out === 'none') val = 'none'; }
    if (opts.length < 2) return '';                    // (choosing sound cards needs Chrome or Edge)
    // Locked while it plays (the owner, 12 Nov 2026): a change applies from its next play, so the menu
    // mustn't look as if it moved it; and it shows the card in use
    const busy = playing.has(c.id);
    return `<select class="cout${val ? ' own' : ''}${busy ? ' busy' : ''}" data-act="out"${busy ? ' disabled' : ''} title="${busy ? 'In use: it stays on this output until it ends' : 'Where this cue plays'}">` +
      opts.map(([v, t]) => `<option value="${esc(v)}"${v === val ? ' selected' : ''}>${esc(t)}</option>`).join('') + '</select>';
  }
  // Options → Levels: Automatic levels, then a row for Show and for each sound card this run sheet's cues use
  // (all cues before there's a sheet): Level [on], ▶ Tone, and its level (its quietest cue) and the biggest cut
  const dB = v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
  const sheetCues = () => (show.items.length ? show.items.flatMap(it => cues[it.id] || []).concat(cues[BOARD] || []) : Object.values(cues).flat());
  function outputs() {                                 // {all: the cues, keys: Show and each sound card a cue has, own: key → its card}
    const all = sheetCues(), keys = [SHOW], own = {};
    for (const c of all) { const k = outKey(c); if (k && k !== SHOW && !own[k]) { own[k] = c.out; keys.push(k); } }
    return { all, keys, own };
  }
  const outName = (k, o) => { const d = o.own[k] && cardOf(o.own[k]); return k === SHOW ? 'Show' : (d ? d.label : o.own[k].label) || 'Its sound card'; };
  function levelFacts(k, o) {                          // one output's level: in use (t), its quietest (q), the loudest cue's cut
    const known = o.all.filter(c => outKey(c) === k && Number.isFinite(c.lufs)), t = targetOf(k), q = quietOf(k), ack = numOf(k, 'ack');
    const loud = known.reduce((m, c) => (!m || c.lufs > m.lufs ? c : m), null), auto = autoLevels();
    return { k, t, q, ack, known, loud, quiet: quietestOf(k), cut: loud && t != null ? Math.max(0, loud.lufs - t) : null,
      waiting: !auto && q != null && t !== q,          // automatic off: a new level not used yet
      changed: q != null && ((ack != null && q !== ack) || (!auto && t != null && t !== q)), unset: q != null && ack == null };
  }
  function renderLevels() {
    const box = $('levels'), o = outputs(), all = o.all;
    const now = o.keys.map(k => k + '=' + targetOf(k)).join(',');
    if (now !== applied) { applied = now; applyLevels(); }   // (a cue added, measured or removed moved a level)
    const a = document.activeElement;
    if (a && box.contains(a) && a.matches('input[type=number]')) return renderLevelBox(o);   // (a trim offset being typed: the rest on focusout)
    const auto = autoLevels();
    let anyWaiting = false;
    box.innerHTML = o.keys.map(k => {
      const v = levelOf(k), list = all.filter(c => outKey(c) === k), f = levelFacts(k, o), known = f.known;
      const name = outName(k, o), gone = k !== SHOW && !cardOf(o.own[k]);
      const waiting = !v.off && f.waiting, unmeasured = list.length - known.length;
      anyWaiting = anyWaiting || waiting;
      const cutText = known.length < 2 ? '' : f.cut != null && f.cut >= 0.05 ? '. The loudest, ' + f.loud.name + ', is turned down ' + f.cut.toFixed(1) + ' dB' : f.cut != null ? '. They’re all as loud as each other' : '';
      const note = !list.length ? 'No cues on it yet'
        : v.off ? 'Off: its cues play as recorded'
        : !known.length ? 'Its cues haven’t been measured yet: as recorded until they are'
        : waiting ? (f.t == null ? 'As recorded for now' : 'Level in use: ' + dB(f.t) + ' LUFS' + cutText) + '. Waiting: ' + dB(f.q) + ' LUFS, its quietest cue now (' + f.quiet.name + '): click the level box (top right) or ▶ Tone to use it'
        : 'Level: ' + dB(f.t) + ' LUFS, its quietest cue (' + f.quiet.name + ')' + cutText;
      return `<div class="lv-row${waiting ? ' waiting' : ''}" data-out="${esc(k)}"><span class="lv-what${k === SHOW ? '' : ' own'}" title="${esc(name)}">→ ${esc(name)}</span>` +
        `<label class="check" title="On: every cue on this output as loud as its quietest. Off: as recorded (only a ✂ trim)"><input type="checkbox" data-lv="on"${v.off ? '' : ' checked'}> Level</label>` +
        `<button class="small" data-lv="tone"${f.q == null || (playing.size && !tones.has(k)) ? ' disabled' : ''} title="${playing.size && !tones.has(k) ? 'Not while cues are playing' : 'A 1 kHz tone at this level, on this output: set the desk by it (and the level box counts it as set)'}">${tones.has(k) ? '■ Tone' : '▶ Tone'}</button>` +
        `<label class="lv-trim" title="Console trim = this − the level in use: the makeup gain for the desk's digital trim (or a channel compressor's makeup gain, at 1:1 or a threshold it never reaches). Set it once so the console trim reads what the desk sounds right at; after that, set the desk's trim to the console trim whenever the level changes">LUFS trim offset <input type="number" data-lv="trim" step="0.5" min="-60" max="60" value="${numOf(k, 'trim') || 0}"${v.off ? ' disabled' : ''}> dB</label>` +
        `<span class="lv-console" data-trim="${esc(k)}">${v.off || f.t == null ? '' : 'console trim ' + sdB(trimOf(k, f.t)) + ' dB'}</span>` +
        `<span class="hint lv-note">${gone ? '<span class="warn">Not connected</span> · ' : ''}${esc(note + (unmeasured && known.length ? ' · ' + unmeasured + ' not measured yet' : ''))}</span></div>`;
    }).join('');
    box.closest('.lvsec').classList.toggle('waiting', anyWaiting);
    $('lvauto').checked = auto;
    $('lvautonote').textContent = auto ? '' : 'Off: a new level waits until you click the level box (or start ▶ Tone).';
    renderLevelBox(o);
  }
  // The level box (top right, not scrolled; the owner, 13 Nov 2026): each output's level and its loudest cue's cut,
  // always (once there are cues). Neutral once the desk is set (a click on it, or ▶ Tone); amber while it never
  // was; flashing when a level changed since (automatic off: a new level waiting, used by the click)
  function renderLevelBox(o) {
    const box = $('levelbox');
    if (!box) return;
    box.hidden = !o.all.length;
    if (box.hidden) return;
    const auto = autoLevels(), rows = o.keys.filter(k => quietOf(k) != null).map(k => levelFacts(k, o));
    const flash = rows.some(r => r.changed), unset = !flash && rows.some(r => r.unset), many = rows.length > 1;
    const say = !rows.length ? (o.keys.every(k => levelOf(k).off) ? 'Levels off' : 'Levels: no cue measured yet')
      : flash ? (auto ? 'Level changed: set the desk, then click here' : 'New level waiting: click to use it')
      : unset ? (auto ? 'Set the desk (▶ Tone), then click here' : 'Click to use this level') : '✓ Desk set for this level';
    const html = rows.map(r => `<span class="lb-row">${many ? `<span class="lb-name">${esc(outName(r.k, o))}</span>` : ''}` +
        `<span class="lb-lufs">${r.waiting && r.t != null ? dB(r.t) + ' → ' : ''}${dB(r.q)} <small>LUFS</small></span></span>` +
        `<span class="lb-cut">${r.cut == null ? 'as recorded for now' : r.cut >= 0.05 ? 'loudest cue turned down ' + r.cut.toFixed(1) + ' dB' : 'no cue turned down'}</span>` +
        `<span class="lb-trim">console trim ${r.waiting && r.t != null ? sdB(trimOf(r.k, r.t)) + ' → ' : ''}${sdB(trimOf(r.k, r.waiting ? r.q : r.t != null ? r.t : r.q))} dB</span>`).join('') +
      `<span class="lb-say">${esc(say)}</span>`;
    if (box.dataset.sig !== html) { box.dataset.sig = html; box.innerHTML = html; }
    box.className = !rows.length ? 'lb-ok' : flash ? 'lb-flash' : unset ? 'lb-unset' : 'lb-ok';
    box.disabled = !rows.length;
    box.title = !rows.length ? '' : auto ? 'Each output’s level: its quietest cue. Click when the desk is set for it' : 'Each output’s level: its quietest cue. Click to use a new level (and when the desk is set for it)';
  }
  $('levelbox').addEventListener('click', e => {
    e.currentTarget.blur();
    for (const k of outputs().keys) confirmLevel(k);
    renderLevels();
  });
  $('lvauto').addEventListener('change', e => { e.target.blur(); setAuto(e.target.checked); });
  function setTrim(input, tidy) {                      // a LUFS trim offset typed (−60…+60 dB; 0 = none)
    const k = input.closest('.lv-row').dataset.out, n = Math.round(Number(input.value) * 10) / 10;
    if (input.value === '' || !Number.isFinite(n)) { if (tidy) input.value = numOf(k, 'trim') || 0; return; }
    const v = Math.max(-60, Math.min(60, n));
    levels[k] = Object.assign({}, levels[k]);
    if (v) levels[k].trim = v; else delete levels[k].trim;
    saveLevels();
    if (tidy) input.value = v;
    const el = $('levels').querySelector(`.lv-console[data-trim="${CSS.escape(k)}"]`), t = targetOf(k);
    if (el && t != null) el.textContent = 'console trim ' + sdB(trimOf(k, t)) + ' dB';
    renderLevelBox(outputs());
  }
  $('levels').addEventListener('input', e => { if (e.target.dataset.lv === 'trim') setTrim(e.target, false); });
  $('levels').addEventListener('focusout', e => { if (e.target.dataset.lv === 'trim') { setTrim(e.target, true); setTimeout(renderLevels, 0); } });
  $('levels').addEventListener('change', e => {
    if (e.target.dataset.lv === 'on') setLevel(e.target.closest('.lv-row').dataset.out, { off: !e.target.checked });
  });
  $('levels').addEventListener('click', e => {
    const b = e.target.closest('button[data-lv]'), k = b && b.closest('.lv-row').dataset.out;
    if (k && b.dataset.lv === 'tone') { if (tones.has(k)) stopTone(k); else startTone(k); renderLevels(); }
  });

  // ─── An item's own text (the owner, 12 Nov 2026: to replace the name shown here, or add notes) ───
  // ✎ on an item opens a box holding its name (one line); what's saved is shown here instead: the first
  // line as the item's name, the rest as notes under it. On this computer only, never sent to the timer.
  // Kept by item id, like the cues (playout_names: {itemId: {text, was, at}}; was = the timer's name for
  // it then, so a rename since is pointed out). Saving the timer's name itself, or nothing, goes back to
  // the timer's. An open box survives a re-render (drafts), and a list rebuild waits while it's typed in.
  const MAX_NAMES = 500, MAX_TEXT = 2000;
  const names = (() => { try { const v = JSON.parse(store.get(NAMES) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } })();
  const drafts = new Map();                            // item id → the text in its open box
  const ownText = id => { const e = names[id]; return e && typeof e.text === 'string' && e.text ? e : null; };
  const titleOf = it => { const e = ownText(it.id); return e ? e.text.split('\n')[0] : it.n || ''; };
  function setName(it, text) {
    text = String(text).replace(/\r/g, '').replace(/^\s*\n/, '').replace(/\s+$/, '').slice(0, MAX_TEXT);
    if (SOUNDBOARD && text) { it.n = text.split('\n')[0].trim().slice(0, 200) || it.n; saveSheet(); }   // (a soundboard: its own name; the rest notes)
    if (!text || text === (it.n || '')) delete names[it.id];
    else names[it.id] = { text, was: it.n || '', at: Date.now() };
    const ids = Object.keys(names);
    if (ids.length > MAX_NAMES) {                      // (the oldest of items no longer on the sheet go)
      const on = new Set(show.items.map(x => x.id));
      ids.filter(k => !on.has(k)).sort((a, b) => (names[a].at || 0) - (names[b].at || 0)).slice(0, ids.length - MAX_NAMES).forEach(k => delete names[k]);
    }
    store.set(NAMES, JSON.stringify(names));
  }
  function nameHtml(it) {
    const own = ownText(it.id), name = it.n || '(no name)';
    return `<span class="iname"${own && !SOUNDBOARD ? ` title="${esc('Your text, on this computer (✎ to change it). The timer calls it: ' + name)}"` : ''}>${esc(own ? titleOf(it) : name)}</span>`;
  }
  function notesHtml(it) {
    const own = ownText(it.id), notes = own ? own.text.split('\n').slice(1).join('\n') : '';
    return (own && own.was !== (it.n || '') ? `<div class="irenamed" title="The timer renamed this item after you wrote your text: ✎ and Save (or Use the timer’s name) to clear this">The timer now calls it: <b>${esc(it.n || '(no name)')}</b></div>` : '') +
      (notes ? `<div class="inotes">${esc(notes)}</div>` : '') +
      (drafts.has(it.id) ? `<form class="iedit"><textarea rows="${Math.min(12, drafts.get(it.id).split('\n').length)}" aria-label="Your text for this item">${esc(drafts.get(it.id))}</textarea>` +
        `<div class="row"><button class="small primary">Save</button><button type="button" class="small" data-name="cancel">Cancel</button>` +
        (SOUNDBOARD ? `<label class="ilen">Length <input data-name="len" value="${esc(mmss(it.d || 0))}" title="Minutes (5), m:ss (3:30), h:mm:ss, or 90s / 3m" aria-label="Its length"></label>` : '') +
        (own && !SOUNDBOARD ? '<button type="button" class="small" data-name="reset" title="Show the item as the timer names it again">Use the timer’s name</button>' : '') +
        `<span class="hint">${SOUNDBOARD ? 'The first line is its name, the rest notes.' : 'On this computer only. The first line is shown as the name, the rest as notes.'} Ctrl+Enter (⌘+Enter) saves.</span></div></form>` : '');
  }
  function openName(id) {
    const it = show.items.find(x => x.id === id);
    if (!it) return;
    if (document.activeElement && document.activeElement.closest('form.iedit')) document.activeElement.blur();   // (another item's box: its text stays)
    if (!drafts.has(id)) { const own = ownText(id); drafts.set(id, own ? own.text : it.n || ''); }
    render();
    const t = document.querySelector(`#items li[data-id="${CSS.escape(id)}"] form.iedit textarea`);
    if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  }
  function closeName(id, save) {
    const it = show.items.find(x => x.id === id);
    if (save === 'reset') { delete names[id]; store.set(NAMES, JSON.stringify(names)); }
    else if (save && it) {
      const len = SOUNDBOARD && document.querySelector(`#items li[data-id="${CSS.escape(id)}"] input[data-name=len]`), d = len && readLength(len.value);
      if (len && len.value.trim() && !d) { alert('That length isn’t one I can read: minutes (5), m:ss (3:30), h:mm:ss, or 90s / 3m.'); len.focus(); return; }
      if (d) { it.d = d; saveSheet(); }
      setName(it, drafts.get(id));
    }
    drafts.delete(id);
    if (document.activeElement && document.activeElement.closest('form.iedit')) document.activeElement.blur();
    render();
  }

  function render() {
    if (deckBoard) deckBoard.changed();
    document.body.classList.toggle('manual', !following());
    renderPlace();
    renderLevels();
    renderFlow();                                      // (its next follows the list)
    const items = show.items;
    $('rshint').textContent = !show.on ? 'The timer isn’t in run sheet mode' : show.fin ? 'The show has finished' : '';
    const curIdx = items.findIndex(x => x.id === show.cur);
    const open = document.activeElement && document.activeElement.closest('form.addcue, #items select.cout, #boardlist select.cout, form.iedit');
    if (open) return;                                  // don't rebuild under someone adding a cue, choosing an output or typing an item's text
    const manual = !following(), ro = StingRoll.opts(ROLL), active = manual ? activeItems() : new Set();
    $('items').innerHTML = items.map((it, i) => {
      const list = cues[it.id] || [], here = local && local.item === it.id, locked = here && !cueControl();
      const flash = active.has(it.id) && active.size > 1 && it.id !== lastRun;   // (rebuilt together, so they flash in step)
      const done = c => (i === curIdx && fired.has(c.id)) || (here && local.fired.has(c.id));
      const runBtn = !manual || it.e || !list.length ? ''
        : active.has(it.id) ? `<button class="small runon${flash ? ' superseded' : ''}" data-act="endrun" title="${flash ? 'Still playing after another item started: stop it here, or let it play to its end' : here ? 'Stop this item’s cues, and the rest of them won’t play' : 'Stop this item’s cues still playing'}">■ Stop item</button>`
        : `<button class="small" data-act="run" title="Its cues as if it started now: start cues at once, the others timed from now${it.d ? ' (its length: ' + mmss(it.d) + ')' : ''}">▶ Start item</button>`;
      return `<li data-id="${esc(it.id)}" class="${i === curIdx ? 'now' : curIdx >= 0 && i < curIdx ? 'done' : ''}${here ? ' here' : ''}">` +
        `<div class="ihead">${(st => (st ? `<span class="istart${st.late ? ' late' : ''}" title="${it.a != null ? 'Started' : st.late ? 'Expected to start (planned ' + (it.s != null ? clockOf(it.s) : 'no time') + ')' : 'Planned to start'}">${st.t}</span>` : ''))(startOf(it))}${nameHtml(it)}${i === curIdx ? '<span class="itag">now</span>' : ''}${here ? '<span class="itag ilocal"></span>' : ''}` +
        `<span class="iclock" title="When its audio ends (from its start; counting down while it runs)"></span><span class="idur">${it.e ? 'finish' : it.d ? mmss(it.d) : ''}</span>` +
        `<button class="small" data-act="name" title="${SOUNDBOARD ? 'Rename it, change its length, or add notes' : 'Your own text for this item, on this computer: replace its name, or add notes'}">✎</button>${runBtn}` +
        (rollable(it, ro, false) ? `<button class="small" data-act="roll"${rolling ? ' disabled' : ''} title="${rolledOf(it.id) ? 'Another walk-up sting at random (when and where it plays stay)' : 'A walk-up sting at random, at its start (Random stings, under the run sheet, says from where)'}">🎲</button>` : '') +
        `${it.e ? '' : '<button class="small" data-act="add">+ cue</button>'}` +
        (SOUNDBOARD ? `<span class="iorder"><button class="small" data-act="up"${i ? '' : ' disabled'} title="Move it up">↑</button><button class="small" data-act="down"${i < items.length - 1 ? '' : ' disabled'} title="Move it down">↓</button><button class="small" data-act="delitem" title="Remove it (and its cues)">✕</button></span>` : '') +
        '</div>' + notesHtml(it) +
        (list.length ? '<ul class="cues">' + list.map(c => cueRow(c, { done: done(c), locked, flash })).join('') + '</ul>' : '') +
        '</li>';
    }).join('') || (SOUNDBOARD ? '<li class="hint">No items yet: <b>+ Add item</b>, <b>Paste a list…</b>, or drop a folder of audio or video files anywhere on this page (an item for each, its file as the cue).</li>'
      : '<li class="hint">No run sheet yet: the timer sends it when it has one.</li>');
    const orphans = orphanIds(), n = orphans.reduce((a, k) => a + cues[k].length, 0);
    $('orphans').hidden = !n;
    $('orphantext').textContent = n === 1 ? '1 cue belongs to an item that isn’t on the timer’s run sheet (kept here for when it comes back).' : n + ' cues belong to items that aren’t on the timer’s run sheet (kept here for when they come back).';
    const extra = cues[BOARD] || [];                   // the Stream Deck's extra keys (playout-deck.js: files dropped on a key)
    $('boardlist').innerHTML = extra.length ? `<li data-id="${BOARD}"><div class="ihead"><span class="iname">Extra keys</span><span class="hint">not on the run sheet: they play when their key is pressed</span></div>` +
      '<ul class="cues">' + extra.map(c => cueRow(c, { board: true })).join('') + '</ul></li>' : '';
    renderNow(countdown());
    renderClocks();
  }
  // An item's start, for its row and its key (the owner, 13 Nov 2026): when it started, else when it's expected
  // (≈, from the timer: only when that isn't the plan), else planned; none for a sheet without times yet
  const clockOf = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const startOf = it => (it.a != null ? { t: clockOf(it.a) } : it.x != null ? { t: '≈ ' + clockOf(it.x), late: it.s == null || it.x > it.s } : it.s != null ? { t: clockOf(it.s) } : null);

  // ─── How long its audio has to go (the owner, 13 Nov 2026) ───
  // A cue: when it ends, from its item's start. Before the item runs, as planned (At the start: its length;
  // After n: n + its length; With n left: the item's length − n + its length; When time's up: the item's length
  // + its length; To finish n before the end: the item's length − n); while it runs, counting down (still to
  // come: until it starts, plus its length; playing: what's left of it). An item: its last cue's. The box top
  // right (#bigclock, out of the scrolling): what the audio playing (and its items' still to come) has left,
  // the one that ends last.
  function runOf(itemId) {                             // the countdown an item's cues run by now: started here, or the timer's
    if (local && local.item === itemId) return { cd: localCd(), done: c => local.fired.has(c.id) };
    if (following() && show.on && !show.fin && show.cur === itemId) return { cd: countdown(), done: c => fired.has(c.id) };
    return null;
  }
  function cueLeft(c, it, run) {                       // s, or null (nothing to count: played, or no length known)
    const p = playing.get(c.id), len = lenOf(c), d = (it && it.d) || 0;
    if (p) return p.endsAt == null ? null : Math.max(0, (p.endsAt - performance.now()) / 1000);
    if (!len) return null;
    if (!run) return c.trigger === 'start' ? len : c.trigger === 'elapsed' ? c.at + len : !d ? null
      : c.trigger === 'remaining' ? d - c.at + len : c.trigger === 'end' ? d + len : c.trigger === 'finish' ? d - c.at : null;
    if (!run.cd || run.done(c) || c.trigger === 'start') return null;
    const cd = run.cd, remain = cd.remain / 1000;
    if (c.trigger === 'elapsed') return Math.max(0, c.at - cd.elapsed / 1000) + len;
    if (!Number.isFinite(remain)) return null;
    if (c.trigger === 'remaining') return Math.max(0, remain - c.at) + len;
    if (c.trigger === 'end') return Math.max(0, remain) + len;
    if (c.trigger === 'finish') return Math.max(0, remain - c.at);
    return null;
  }
  const clockText = s => (s == null ? '' : '♪ ' + mmss(Math.ceil(s - 1e-6)));
  function renderClocks() {
    let big = null;
    for (const li of document.querySelectorAll('#items > li[data-id], #boardlist > li[data-id]')) {
      const id = li.dataset.id, it = show.items.find(x => x.id === id), list = cues[id] || [], run = it ? runOf(id) : null;
      let last = null, live = false;
      for (const c of list) {
        const left = cueLeft(c, it, run), on = playing.has(c.id) || (!!run && left != null);
        const el = li.querySelector(`.cclock[data-clock="${CSS.escape(c.id)}"]`);
        if (el) { const t = clockText(left); if (el.textContent !== t) el.textContent = t; el.classList.toggle('live', on); }
        if (left != null && (last == null || left > last)) last = left;
        if (on) { live = true; if (!big || left > big.left) big = { left, what: it ? titleOf(it) : c.name }; }
      }
      const ic = li.querySelector('.iclock');
      if (ic) { const t = clockText(last); if (ic.textContent !== t) ic.textContent = t; ic.classList.toggle('live', live); }
    }
    const box = $('bigclock');
    if (!box) return;
    box.hidden = !big;
    if (big) { const t = clockText(big.left).slice(2); if ($('bc-left').textContent !== t) $('bc-left').textContent = t; if ($('bc-what').textContent !== big.what) $('bc-what').textContent = big.what; }
  }
  // A cue's row: ▶/■, when, its name, length, output, ✎ (when), ✂, ✕. o: {done, locked, flash, board (an extra key: no when)}
  function cueRow(c, o) {
    const on = playing.has(c.id), single = on && !playing.get(c.id).run && !o.locked;   // (played on its own: its ▶, or a key)
    return `<li data-cue="${esc(c.id)}" class="${o.done ? 'fired' : ''}${on ? ' playing' : ''}">` +
      `<button class="small${o.flash && on ? ' superseded' : ''}" data-act="${on ? 'stop' : 'fire'}"${o.locked ? ' disabled' : ''} title="${o.locked ? 'The item started here plays its cues: ■ Stop item stops them (Options: play and stop single cues)' : on ? 'Stop' : 'Play it now (on this computer)'}">${on ? '■' : '▶'}</button>` +
      (single ? `<button class="small mark" data-act="markin" title="The clip starts here (half a second back, for your reaction): opens the editor on the start, to fine-tune">Mark start</button>` +
        `<button class="small mark" data-act="markout" title="The clip ends here: opens the editor on the end, to fine-tune">Mark end</button>` : '') +
      `<span class="when">${o.board ? 'Its key' : esc(whenText(c))}</span><span class="fname"${c.rolled ? ' title="Picked at random: 🎲 on the item for another; ✂ makes it yours (a roll then leaves it alone)"' : ''}>${c.rolled ? '🎲' : c.media === 'video' ? '🎞' : '🎵'} ${esc(c.name)}</span>` +
      `<span class="clen">${StingClip.region(c) ? '✂ ' : ''}${lenText(c)}</span><span class="cclock" data-clock="${esc(c.id)}"></span>` + outMenu(c) +
      (o.board ? '' : `<button class="small" data-act="when" title="Change when it plays">✎</button>`) +
      `<button class="small" data-act="edit" title="Choose the part to play, fades, a loop and its level (the file isn’t cut)">✂</button>` +
      `<button class="small" data-act="del" title="${o.board ? 'Remove it (its key is free again)' : 'Remove this cue'}">✕</button></li>`;
  }
  function renderNow(cd) {
    const it = show.items.find(x => x.id === show.cur);
    $('now').innerHTML = it && cd ? `Now: <b>${esc(titleOf(it))}</b> ·${cd.remain >= 0 ? mmss(cd.remain / 1000) + ' left' : 'over by ' + mmss(-cd.remain / 1000)}` : '';
    renderLocal();
  }
  function localText() { const cd = localCd(); return local.dur == null ? mmss(cd.elapsed / 1000) : cd.remain >= 0 ? mmss(cd.remain / 1000) + ' left' : 'over by ' + mmss(-cd.remain / 1000); }
  function renderLocal() {                             // the item run here: its time, in place (each tick)
    const el = local && document.querySelector('#items .ilocal');
    if (el) el.textContent = 'here · ' + localText();
  }
  function onListClick(e) {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const li = b.closest('li[data-id]'), itemId = li && li.dataset.id;
    const cueId = b.closest('li[data-cue]') && b.closest('li[data-cue]').dataset.cue;
    const c = cueId && (cues[itemId] || []).find(x => x.id === cueId);
    if ((b.dataset.act === 'fire' || b.dataset.act === 'stop') && local && local.item === itemId && !cueControl()) return;   // (locked: the item run has them)
    if (b.dataset.act === 'fire' && c) play(c);        // by hand: always, followed or not
    else if (b.dataset.act === 'stop' && c) { endFlow(itemId); stopCue(c.id); }
    else if (b.dataset.act === 'edit' && c) editCue(c);
    else if (b.dataset.act === 'when' && c) whenForm(b.closest('li[data-cue]'), c, 'Save', (trigger, at) => retimeCue(itemId, c, trigger, at));
    else if (b.dataset.act === 'del' && c) { if (confirm('Remove the cue “' + c.name + '”?')) removeCue(itemId, c.id); }
    else if (b.dataset.act === 'add') addForm(li);
    else if (b.dataset.act === 'name') openName(itemId);
    else if (b.dataset.act === 'run') runLocal(itemId);
    else if (b.dataset.act === 'roll') { b.blur(); rollOne(itemId); }
    else if (b.dataset.act === 'endrun') { endFlow(itemId); for (const x of cues[itemId] || []) stopCue(x.id); if (local && local.item === itemId) endLocal(); }
    else if ((b.dataset.act === 'markin' || b.dataset.act === 'markout') && c) markCue(c, b.dataset.act === 'markin' ? 'start' : 'end');
    else if (b.dataset.act === 'up' || b.dataset.act === 'down') { b.blur(); moveItem(itemId, b.dataset.act === 'up' ? -1 : 1); }
    else if (b.dataset.act === 'delitem') removeItem(itemId);
  }
  $('items').addEventListener('click', onListClick);
  $('boardlist').addEventListener('click', onListClick);   // (the extra keys' cues: ▶ ■ ✂ ✕)
  // A cue's output (from its next play)
  function onOutChange(e) {
    const s = e.target.closest('select.cout');
    if (!s) return;
    const itemId = s.closest('li[data-id]').dataset.id, cueId = s.closest('li[data-cue]').dataset.cue;
    const c = (cues[itemId] || []).find(x => x.id === cueId), v = s.value;
    s.blur();
    if (!c) return render();
    if (v === '?') { render(); AudioOut.ask(); return; }   // (the list comes back by the 'audio-out' event)
    if (!v) delete c.out;
    else if (v === 'none') c.out = 'none';
    else { const d = outList.find(x => x.id === v); c.out = { id: v, label: d ? d.label : (c.out && c.out.label) || '' }; }
    saveCues();
    render();
  }
  const onOutBlur = e => { if (e.target.matches('select.cout')) setTimeout(render, 0); };
  for (const l of ['items', 'boardlist']) { $(l).addEventListener('change', onOutChange); $(l).addEventListener('focusout', onOutBlur); }
  // An item's own text: its box (Save, Cancel, Use the timer's name; Ctrl/⌘+Enter saves, Enter is a new line)
  const nameBox = el => { const li = el.closest('form.iedit') && el.closest('li[data-id]'); return li && li.dataset.id; };
  $('items').addEventListener('submit', e => { const id = nameBox(e.target); if (id) { e.preventDefault(); closeName(id, true); } });
  $('items').addEventListener('click', e => { const b = e.target.closest('button[data-name]'), id = b && nameBox(b); if (id) closeName(id, b.dataset.name === 'reset' ? 'reset' : false); });
  $('items').addEventListener('input', e => {
    const id = e.target.matches('form.iedit textarea') && nameBox(e.target);
    if (id) { drafts.set(id, e.target.value); e.target.rows = Math.min(12, e.target.value.split('\n').length); }
  });
  $('items').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.matches('form.iedit textarea')) { e.preventDefault(); e.target.form.requestSubmit(); }
  });
  // + cue: when (a trigger, and its time), then what: the + sting dialog (sting-picker.js)
  const cueFile = $('cuefile');                        // Browse for a file… (needs the dialog's click)
  let browseFor = null;
  cueFile.addEventListener('change', () => {
    const f = cueFile.files[0]; cueFile.value = '';
    if (f && browseFor) addCue(browseFor.item, { file: f }, browseFor.trigger, browseFor.at);
    browseFor = null;
  });
  // When a cue plays: a trigger and its time (+ cue; ✎ on a cue, which starts from the cue's own)
  function whenForm(host, init, label, done) {
    if (host.querySelector(':scope > form.addcue')) return;
    const f = document.createElement('form');
    f.className = 'addcue';
    const timed = t => t === 'elapsed' || t === 'remaining' || t === 'finish';   // (To finish: empty = at the end)
    f.innerHTML = `<select name="trigger">${Object.entries(TRIGGERS).map(([k, v]) => `<option value="${k}"${k === init.trigger ? ' selected' : ''}>${v}</option>`).join('')}</select>` +
      `<input type="text" name="at" placeholder="m:ss" aria-label="Time" value="${timed(init.trigger) ? mmss(init.at) : ''}">` +
      `<button class="small primary">${esc(label)}</button><button type="button" class="small" data-x>Cancel</button>`;
    host.appendChild(f);
    const trig = f.querySelector('[name=trigger]'), at = f.querySelector('[name=at]');
    at.hidden = !timed(trig.value);
    trig.addEventListener('change', () => { at.hidden = !timed(trig.value); if (!at.hidden) at.focus(); });
    f.querySelector('[data-x]').addEventListener('click', () => { f.remove(); render(); });
    f.addEventListener('submit', e => {
      e.preventDefault();
      let secs = 0;
      if (!at.hidden) { secs = readSecs(at.value); if (secs == null) { alert('Type the time as m:ss (or h:mm:ss).'); return; } }
      f.remove();
      done(trig.value, secs);
    });
    trig.focus();                                      // (render() leaves a form with the focus alone)
  }
  function addForm(li) {
    whenForm(li, { trigger: 'start', at: 0 }, 'Choose the sound or video…', async (trigger, at) => {
      const want = { item: li.dataset.id, trigger, at };
      render();
      const ch = await StingPicker.open({
        note: whenText({ trigger: want.trigger, at: want.at }) + ': played on this computer.',
        browse: () => { browseFor = want; cueFile.click(); },
      });
      if (ch) addCue(want.item, ch, want.trigger, want.at);
    });
  }
  $('orphanx').addEventListener('click', () => {
    const ids = orphanIds(), n = ids.reduce((a, k) => a + cues[k].length, 0);
    if (!n || !confirm(`Remove the ${n} cue${n === 1 ? '' : 's'} (and ${n === 1 ? 'its file' : 'their files'}) for items that aren’t on the timer’s run sheet?`)) return;
    for (const k of ids) for (const c of [...cues[k]]) removeCue(k, c.id);
  });
  $('follow').checked = following();
  $('follow').addEventListener('change', e => { store.set(FOLLOW, e.target.checked ? '1' : '0'); if (e.target.checked) { local = null; primeTimeCues(); } render(); });
  $('stopall').addEventListener('click', () => { stopAll(); endLocal(); });
  // Options: single cues of an item started here (off by default, the owner's call: the run plays them;
  // on for rehearsals). Applies at once, mid-run included
  $('cuectl').checked = cueControl();
  $('cuectl').addEventListener('change', e => { store.set(CUE_CTL, e.target.checked ? '1' : '0'); render(); });
  $('fadeall').addEventListener('click', e => { e.currentTarget.blur(); fadeAll(FADE_MS); });
  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen(); else if (place === 'here') $('stage').requestFullscreen().catch(() => {}); };
  $('full').addEventListener('click', toggleFull);
  $('ext').addEventListener('click', e => { e.currentTarget.blur(); if (place === 'external') moveVideo('here'); else toExternal(); });
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey) return;
    if (e.target.closest('input, select, textarea') && !(e.key === 'Escape' && e.target.closest('form.iedit'))) return;   // (Esc still fades from an item's text box: its text stays)
    if (document.querySelector('.sting-dlg, .sting-libwrap, .sc-wrap')) return;   // (a dialog has the keys)
    if (e.key === 'f' || e.key === 'F') toggleFull();
    else if (e.key === 'Escape' && !document.fullscreenElement && (playing.size || tones.size)) { e.preventDefault(); fadeAll(FADE_MS); }   // (in full screen, Esc leaves it)
  });
  if (window.AudioOut) { AudioOut.picker($('ao-pick'), ['show', 'preview']); refreshOuts(); }
  $('unpair').addEventListener('click', () => {
    if (!confirm('Unpair this computer from the timer? Its cues stay here.')) return;
    store.del(SAVED_LINK);
    if (link.r) store.del(tokenKey(link.r));
    location.reload();
  });

  // ─── Stream Deck: a soundboard of the items (playout-deck.js; the owner's design, 12 Nov 2026) ───
  // A key per item with cues: with Follow off it starts the item (as ▶ Start item); on an item that's
  // playing, down starts a fade and up stops it (a tap stops, a hold fades). The last key: everything.
  const playingOf = id => (cues[id] || []).filter(c => playing.has(c.id)).map(c => c.id);
  if (window.PlayoutDeck && window.DeckHID) deckBoard = PlayoutDeck.create({
    store, prefix: KEY, soundboard: SOUNDBOARD,
    items: () => show.items.filter(it => !it.e),
    cuesOf: id => cues[id] || [],
    title: titleOf,
    startText: it => { const s = startOf(it); return s ? s.t : ''; },
    following,
    nowId: () => (show.on && !show.fin ? show.cur : null),
    isDone: id => { const i = show.items.findIndex(x => x.id === id), c = show.items.findIndex(x => x.id === show.cur); return c >= 0 && i >= 0 && i < c; },
    playingIds: playingOf,
    anyPlaying: () => !!(playing.size || tones.size || local),
    localItem: () => local && local.item,
    localText,
    start: id => { if (!following()) runLocal(id); },
    fadeItem(id, ms) { endFlow(id); if (local && local.item === id) endLocal(); const ids = playingOf(id); for (const x of ids) playing.get(x).voice.fade(ms); return ids; },
    fadeAll(ms) { endLocal(); const ids = [...playing.keys()]; fadeAll(ms); return ids; },
    stopIds: ids => { ids.forEach(id => { const q = playing.get(id); if (q && q.run) endFlow(q.item); }); ids.forEach(stopCue); },
    stopAll: () => { stopAll(); endLocal(); },
    // The extra keys: files dropped on a key (cues[BOARD]); they play by hand, Follow or not
    board: () => cues[BOARD] || [],
    isPlaying: id => playing.has(id),
    playCue: id => { const c = Object.values(cues).flat().find(x => x.id === id); if (c) play(c); },   // (an extra key's, or an item's cue 1: as its ▶)
    cueLocked: id => !!(local && local.item === id && !cueControl()),   // (as its cues' ▶ ■: the item run has them)
    playingAll: () => [...playing.keys()],             // (crossfade on release: what else is playing)
    markable: () => { let id = null; for (const [k, p] of playing) if (!p.run) id = k; return id; },   // (the newest cue playing on its own: the XL's Mark keys)
    cueName: id => { const f = findCue(id); return f ? f.c.name : ''; },
    mark: (id, edge) => { const f = findCue(id); if (f) markCue(f.c, edge); },
    fadeCue: (id, ms) => { const p = playing.get(id); if (p && p.run) endFlow(p.item); if (p) p.voice.fade(ms); return p ? [id] : []; },
    async addFiles(files) { const ids = []; for (const f of files) { const c = await addCue(BOARD, { file: f }, 'start', 0); if (c) ids.push(c.id); } return ids; },
    removeExtra: id => removeCue(BOARD, id),
    server: defaultServer,                             // (a phone's keys: this page hosts a room there)
  });

  // Test hooks: what's playing, and the cues
  window.__playout = { playing: () => [...playing.keys()], cues: () => cues, show: () => show, fired: () => [...fired], ready: () => [...buffers.keys()],
    local: () => local && { item: local.item, fired: [...local.fired] }, flow: () => flow && { item: flow.item, heard: flow.heard, crossed: !!flow.crossed }, names: () => names, active: () => [...activeItems()],
    clocks: () => ({ big: $('bigclock').hidden ? null : $('bc-left').textContent + ' ' + $('bc-what').textContent, items: Object.fromEntries([...document.querySelectorAll('#items > li[data-id]')].map(li => [li.dataset.id, li.querySelector('.iclock').textContent])),
      cues: Object.fromEntries([...document.querySelectorAll('.cclock[data-clock]')].map(e => [e.dataset.clock, e.textContent])) }),
    gain: id => { const p = playing.get(id); return p ? p.voice.gain() : null; }, levels: () => levels, target: k => targetOf(k), tones: () => [...tones.keys()],
    levelBox: () => ({ shown: !$('levelbox').hidden, cls: $('levelbox').className, text: $('levelbox').textContent }),
    video: () => ({ where: vid.ownerDocument === document ? 'here' : 'external', paused: vid.paused, t: vid.currentTime, src: !!vid.getAttribute('src') }) };

  // ─── Demo (?demo, or /p?demo on the hosted site; the owner, 12 Nov 2026: to show the idea without a
  // timer) ─────────────────────────────────────────────────────────────────────────────────────────────
  // No pairing and no timer: a run sheet of ten made-up speakers, 20 minutes each, and manual only
  // (Follow the timer off and locked: ▶ Start item and ▶ do it all). Its cues are kept apart from the real
  // ones (playout_demo_cues), and its levels too (playout_demo_levels); its names in playout_demo_sheet, the same until New speakers. The items'
  // ids (demo-1 … demo-10) never change, so cues stay on their slots whatever the names.
  const DEMO_SHEET = 'playout_demo_sheet', DEMO_N = 10, DEMO_SECS = 20 * 60;
  const FIRST = ['Amara', 'Bea', 'Carlos', 'Devi', 'Elif', 'Farah', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kemi', 'Lars', 'Mei', 'Nikhil', 'Olu', 'Priya',
    'Quinn', 'Rafael', 'Sanna', 'Tomás', 'Uma', 'Viktor', 'Wren', 'Xin', 'Yusuf', 'Zoë', 'Aiko', 'Ben', 'Chloé', 'Dmitri', 'Esi', 'Finn',
    'Grace', 'Hamid', 'Ines', 'Jonah', 'Kai', 'Leila', 'Mateo', 'Noor'];
  const LAST = ['Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Nguyen', 'Haddad', 'Kowalski', 'Mensah', 'Ferreira', 'Sato', 'Kaur', 'Rossi',
    'Andersen', 'Delgado', 'Ibrahim', 'Novak', 'Adeyemi-Hart', 'Brennan', 'Castellano', 'Horvat', 'Eriksen', 'Fontaine', 'Gupta', 'Halloran',
    'Iwasaki', 'Jansen', 'Kariuki', 'Laurent', 'Mwangi-Shaw', 'Nakamura', 'Ortega', 'Petrov', 'Quintero', 'Reyes', 'Sundberg', 'Takahashi'];
  const pick = list => list[Math.floor(Math.random() * list.length)];
  function demoNames() {                               // ten different people: no first name or surname twice
    const used = new Set(), out = [];
    while (out.length < DEMO_N) {
      const f = pick(FIRST), l = pick(LAST);
      if (used.has(f) || used.has(l)) continue;
      used.add(f); used.add(l); out.push(f + ' ' + l);
    }
    return out;
  }
  function demoSheet(fresh) {
    let names = null;
    if (!fresh) try { const v = JSON.parse(store.get(DEMO_SHEET) || 'null'); if (Array.isArray(v) && v.length === DEMO_N && v.every(n => typeof n === 'string')) names = v; } catch (_) { /* new names */ }
    if (!names) { names = demoNames(); store.set(DEMO_SHEET, JSON.stringify(names)); }
    return { items: names.map((n, i) => ({ id: 'demo-' + (i + 1), n, d: DEMO_SECS })), cur: null, run: 0, on: true, fin: false };
  }
  function startDemo() {
    document.body.classList.add('demo');
    $('paired').hidden = false; $('demobar').hidden = false; $('pairline').hidden = true;
    $('follow').checked = false; $('follow').disabled = true;
    $('follow-note').textContent = 'Demo: there’s no timer, so cues play when you start them: ▶ Start item, or ▶ on a cue.';
    showMode();
    cues = loadCues();
    onShow(demoSheet());
    $('demonames').addEventListener('click', e => { e.currentTarget.blur(); onShow(demoSheet(true)); });
    $('demoleave').addEventListener('click', () => { stopAll(); location.href = location.pathname; });
  }

  // ─── Soundboard mode (?soundboard, or /s on the hosted site; the owner, 13 Nov 2026) ───────────────────────
  // The playout page with a run sheet of your own and no timer (worked as the demo is: manual only, ▶ Start
  // item, the keys): items added one by one (a name and a length), a pasted list (a name per line, a length
  // after it if you like), or a folder dropped on the page (an item for each audio or video file, named after
  // it, its length, the file as its At the start cue); ✎ renames and sets the length, ↑ ↓ move, ✕ removes (its
  // cues too). Save… writes it all to a file (items, cues' settings, notes, the keys' arrangement; not the
  // media); Load… reads one back (media this browser still has is used, stock and link cues are fetched
  // again, files: Find files…, by name and size). Clear run sheet… empties it: items, cues, extra keys and
  // their files. Its own storage (playout_board_*), apart from the demo's and a real show's.
  const SHEET = KEY + 'sheet', DEFAULT_SECS = 20 * 60, MAX_ITEMS = 500, ID_RE = /^[\w-]{1,40}$/;
  const MEDIA_FILE = /\.(mp3|m4a|aac|wav|aif|aiff|aifc|flac|ogg|oga|opus|weba|mp4|m4v|webm|mov|ogv)$/i;
  let sheet = { items: [] }, idn = 0, missing = [];
  const sheetShow = () => ({ items: sheet.items, cur: null, run: 0, on: true, fin: false });   // (the same objects: ✎ edits them)
  const newItemId = () => 's' + Date.now().toString(36) + (idn++).toString(36) + Math.random().toString(36).slice(2, 5);
  function saveSheet() { if (SOUNDBOARD) store.set(SHEET, JSON.stringify({ items: sheet.items.map(({ id, n, d }) => ({ id, n, d })) })); }
  function cleanItems(list) {
    const seen = new Set(), out = [];
    for (const x of (Array.isArray(list) ? list : []).slice(0, MAX_ITEMS)) {
      if (!x || !ID_RE.test(x.id) || seen.has(x.id)) continue;
      seen.add(x.id);
      out.push({ id: x.id, n: String(x.n == null ? '' : x.n).slice(0, 200), d: Number.isFinite(x.d) && x.d >= 1 && x.d <= 86400 ? Math.round(x.d) : DEFAULT_SECS });
    }
    return out;
  }
  function loadSheet() { try { const v = JSON.parse(store.get(SHEET) || 'null'); return { items: cleanItems(v && v.items) }; } catch (_) { return { items: [] }; } }
  function sheetChanged() { saveSheet(); onShow(sheetShow()); }
  // A length typed or pasted: minutes (5, 2.5), m:ss (3:30), h:mm:ss, or 90s / 3m / 1h 5m → s, or null
  function readLength(text) {
    const t = String(text == null ? '' : text).trim().toLowerCase(), ok = v => (v >= 1 && v <= 86400 ? Math.round(v) : null);
    let m;
    if ((m = t.match(/^(\d+(?:\.\d+)?)$/))) return ok(Number(m[1]) * 60);
    if ((m = t.match(/^(\d+):(\d{1,2})$/))) return ok(Number(m[1]) * 60 + Number(m[2]));
    if ((m = t.match(/^(\d+):(\d{1,2}):(\d{1,2})$/))) return ok(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    if ((m = t.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?)?$/)) && (m[1] || m[2] || m[3]))
      return ok(Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0));
    return null;
  }
  // A pasted list: a name per line, then its length if you like (after a tab, a comma, a semicolon, two spaces,
  // or just a space: "Keynote 45", "Walk-on 3:30"); a header line (Name, Length) is skipped
  function parseList(text) {
    const out = [];
    String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach((line, k) => {
      let parts = line.split(/\t|;|,|\s{2,}/).map(x => x.trim()).filter(Boolean), d = null;
      if (parts.length > 1 && (d = readLength(parts[parts.length - 1]))) parts.pop();
      else if (parts.length === 1) { const m = line.match(/^(.*\S)\s+(\S+)$/); if (m && (d = readLength(m[2]))) parts = [m[1]]; }
      const n = parts.join(' ').slice(0, 200);
      if (!n || (k === 0 && /^(name|item|title|track)s?$/i.test(parts[0] || ''))) return;
      out.push({ n, d });
    });
    return out;
  }
  function addItems(list) {                            // [{n, d}], at the end
    const room = MAX_ITEMS - sheet.items.length, made = list.slice(0, Math.max(0, room)).map(x => ({ id: newItemId(), n: x.n, d: x.d || DEFAULT_SECS }));
    sheet.items.push(...made);
    sheetChanged();
    if (made.length < list.length) alert(`A soundboard holds ${MAX_ITEMS} items: ${list.length - made.length} weren’t added.`);
    return made;
  }
  function moveItem(id, dir) {
    const i = sheet.items.findIndex(x => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= sheet.items.length) return;
    [sheet.items[i], sheet.items[j]] = [sheet.items[j], sheet.items[i]];
    sheetChanged();
  }
  function removeItem(id) {
    const it = sheet.items.find(x => x.id === id), n = (cues[id] || []).length;
    if (!it || !confirm(`Remove “${it.n || 'this item'}”${n ? ' and its ' + (n === 1 ? 'cue' : n + ' cues') : ''}?`)) return;
    if (local && local.item === id) endLocal();
    for (const c of [...(cues[id] || [])]) removeCue(id, c.id);
    delete names[id]; store.set(NAMES, JSON.stringify(names)); drafts.delete(id);
    sheet.items = sheet.items.filter(x => x.id !== id);
    sheetChanged();
  }

  // A folder (or files) dropped on the page: an item for each audio or video file, in name order, its length
  // the file's, the file its At the start cue (folders walked 3 deep; files named with a dot first skipped)
  async function filesOf(got) {
    const out = [];
    const readDir = dir => new Promise(res => { const r = dir.createReader(), all = []; const next = () => r.readEntries(l => { if (!l.length) return res(all); all.push(...l); next(); }, () => res(all)); next(); });
    const fileOf = e => new Promise(res => e.file(res, () => res(null)));
    async function walk(e, path, depth) {
      if (out.length >= MAX_ITEMS || e.name.startsWith('.')) return;
      if (e.isDirectory) { if (depth < 3) for (const c of await readDir(e)) await walk(c, path + e.name + '/', depth + 1); }
      else if (MEDIA_FILE.test(e.name)) { const f = await fileOf(e); if (f) out.push({ path: path + e.name, file: f }); }
    }
    for (const g of got) {
      if (g.entry && g.entry.isDirectory) await walk(g.entry, '', 0);
      else if (g.file && MEDIA_FILE.test(g.file.name) && !g.file.name.startsWith('.')) out.push({ path: g.file.name, file: g.file });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' })).slice(0, MAX_ITEMS);
  }
  async function addFiles(list) {
    const room = MAX_ITEMS - sheet.items.length, failed = [], made = [];
    for (let k = 0; k < list.length && k < room; k++) {
      adding = `Adding ${k + 1} of ${Math.min(list.length, room)}: ${noExt(list[k].file.name)}…`; showMode();
      let c;
      try { c = await cueFrom({ file: list[k].file }, { trigger: 'start', at: 0 }); } catch (_) { failed.push(list[k].path); continue; }
      const it = { id: newItemId(), n: noExt(list[k].file.name).slice(0, 200), d: c.duration > 0 ? Math.max(1, Math.ceil(c.duration)) : DEFAULT_SECS };
      sheet.items.push(it); cues[it.id] = [c]; made.push(c);
    }
    adding = '';
    saveCues(); sheetChanged(); showMode();
    if (failed.length) alert(`${failed.length === 1 ? 'One file isn’t' : failed.length + ' files aren’t'} audio or video this browser can play, so ${failed.length === 1 ? 'it was' : 'they were'} left out: ${failed.slice(0, 8).join(', ')}${failed.length > 8 ? '…' : ''}`);
    if (list.length > room) alert(`A soundboard holds ${MAX_ITEMS} items: ${list.length - room} files weren’t added.`);
    for (const c of made) await measure(c);            // (their loudness, for the levels: one at a time)
  }
  let dropHide = 0;
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const dropHere = e => SOUNDBOARD && hasFiles(e) && !e.target.closest('#vdecks') && !e.defaultPrevented;   // (the keys take files of their own: extra keys)
  document.body.addEventListener('dragover', e => {
    if (!dropHere(e)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    $('sbdrop').hidden = false; clearTimeout(dropHide); dropHide = setTimeout(() => { $('sbdrop').hidden = true; }, 200);
  });
  document.body.addEventListener('drop', e => {
    if (!dropHere(e)) return;
    e.preventDefault(); $('sbdrop').hidden = true;
    const got = [...e.dataTransfer.items].filter(i => i.kind === 'file').map(i => ({ entry: i.webkitGetAsEntry ? i.webkitGetAsEntry() : null, file: i.getAsFile() }));   // (now: emptied after the event)
    filesOf(got).then(list => { if (list.length) addFiles(list); else alert('No audio or video files there.'); });
  });

  // Save… / Load…: the soundboard as a file. Cues are checked as they're read (a file from anywhere).
  const FILE_KIND = 'timed-show soundboard';
  function saveFile() {
    const on = new Set(sheet.items.map(x => x.id));
    let layout = null; try { layout = JSON.parse(store.get(KEY + 'deck_layout') || 'null'); } catch (_) { /* none */ }
    const data = { kind: FILE_KIND, v: 1, saved: new Date().toISOString(), items: sheet.items.map(({ id, n, d }) => ({ id, n, d })),
      cues: Object.fromEntries(Object.entries(cues).filter(([k, l]) => (k === BOARD || on.has(k)) && l.length)),
      notes: Object.fromEntries(Object.entries(names).filter(([k]) => on.has(k))), layout };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = 'soundboard-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  function cleanCue(c) {
    if (!c || typeof c !== 'object' || !ID_RE.test(c.id) || !TRIGGERS[c.trigger]) return null;
    const num = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : null);
    const o = { id: c.id, name: String(c.name == null ? 'Cue' : c.name).slice(0, 200), media: c.media === 'video' ? 'video' : 'audio',
      src: c.src === 'stock' || c.src === 'link' ? c.src : 'file', trigger: c.trigger, at: num(c.at, 0, 86400) || 0, duration: num(c.duration, 0, 86400) };
    if (typeof c.song === 'string' && /^(url:https:\/\/|size:\d)/.test(c.song)) o.song = c.song.slice(0, 2100);
    if (typeof c.file === 'string' && c.file) o.file = c.file.replace(/^.*[\\/]/, '').slice(0, 300);
    if (typeof c.lib === 'string' && c.lib) o.lib = c.lib.slice(0, 200);
    if (c.rolled === true) o.rolled = true;
    Object.assign(o, StingPicker.clipFields(c));        // (the part, fades, loop and level: checked as any clip's)
    if (c.out === 'none' && o.media === 'video') o.out = 'none';
    else if (c.out && typeof c.out === 'object' && typeof c.out.id === 'string') o.out = { id: c.out.id.slice(0, 300), label: String(c.out.label || '').slice(0, 200) };
    return o;
  }
  function cleanLayout(v) {
    if (!v || typeof v !== 'object') return null;
    const out = {};
    for (const [m, l] of Object.entries(v)) if (/^[\w-]{1,20}$/.test(m) && Array.isArray(l)) out[m] = l.slice(0, 2000).map(x => (typeof x === 'string' && x.length <= 60 ? x : null));
    return out;
  }
  function wipe(keep) {                                // everything, but the files of the cues in keep (ids)
    stopAll(); endLocal();
    for (const l of Object.values(cues)) for (const c of l) if (!keep.has(c.id)) window.videoStore.remove('pocue:' + c.id).catch(() => {});
    cues = {}; saveCues();
    for (const k of Object.keys(names)) delete names[k];
    store.set(NAMES, JSON.stringify(names)); drafts.clear();
    store.del(KEY + 'deck_layout');
  }
  async function loadFile(file) {
    let v; try { v = JSON.parse(await file.text()); } catch (_) { v = null; }
    if (!v || v.kind !== FILE_KIND || !Array.isArray(v.items)) return alert('That isn’t a soundboard file (Save… makes one).');
    const items = cleanItems(v.items), ids = new Set(items.map(x => x.id)), loaded = {}, seen = new Set();
    for (const [k, list] of Object.entries(v.cues && typeof v.cues === 'object' ? v.cues : {})) {
      if (!(k === BOARD || ids.has(k)) || !Array.isArray(list)) continue;
      const l = list.slice(0, 50).map(cleanCue).filter(c => c && !seen.has(c.id) && seen.add(c.id));
      if (l.length) loaded[k] = l;
    }
    const n = sheet.items.length + ((cues[BOARD] || []).length ? 1 : 0);
    if (n && !confirm(`Replace this soundboard (${sheet.items.length} item${sheet.items.length === 1 ? '' : 's'}) with “${file.name}” (${items.length})? Save… first to keep this one.`)) return;
    wipe(seen);                                        // (the files of cues it brings back stay: the same computer)
    cues = loaded; saveCues();
    for (const [k, x] of Object.entries(v.notes && typeof v.notes === 'object' ? v.notes : {}))
      if (ids.has(k) && x && typeof x.text === 'string' && x.text) names[k] = { text: x.text.slice(0, MAX_TEXT), was: String(x.was || '').slice(0, 200), at: Number(x.at) || Date.now() };
    store.set(NAMES, JSON.stringify(names));
    const layout = cleanLayout(v.layout);
    if (layout) store.set(KEY + 'deck_layout', JSON.stringify(layout));
    if (deckBoard && deckBoard.reloadLayout) deckBoard.reloadLayout();
    sheet = { items };
    sheetChanged();
    await checkMedia(true);
    for (const l of Object.values(cues)) for (const c of l) if (!Number.isFinite(c.lufs) && !missing.includes(c)) await measure(c);
  }
  // Cues whose media this browser hasn't got (a soundboard loaded on another computer): stock and link cues
  // fetched again (fetchLinks), files found by Find files… (a folder: by name and size, else size alone)
  async function checkMedia(fetchLinks) {
    const out = [];
    for (const l of Object.values(cues)) for (const c of l) {
      let have = false;
      try { have = !!(await window.videoStore.get('pocue:' + c.id)); } catch (_) { /* no store */ }
      if (have) continue;
      if (fetchLinks && c.song && c.song.startsWith('url:')) {
        try { const r = await fetch(c.song.slice(4)); if (r.ok) { await window.videoStore.put('pocue:' + c.id, await r.blob()); continue; } } catch (_) { /* below */ }
      }
      out.push(c);
    }
    missing = out;
    $('sb-missing').hidden = !missing.length;
    $('sb-missingtext').textContent = !missing.length ? '' : (missing.length === 1 ? '1 cue’s file isn’t' : missing.length + ' cues’ files aren’t') + ' on this computer: ' +
      missing.slice(0, 6).map(c => c.file || c.name).join(', ') + (missing.length > 6 ? '…' : '') + '.';
    prepare();
  }
  async function findFiles(files) {
    let found = 0;
    for (const c of missing) {
      const size = c.song && c.song.startsWith('size:') ? Number(c.song.slice(5)) : null;
      const f = files.find(x => (!c.file || x.name === c.file) && (size == null || x.size === size)) || (size != null ? files.find(x => x.size === size) : null);
      if (!f) continue;
      try { await window.videoStore.put('pocue:' + c.id, await StingClip.playable(f)); found++; } catch (_) { /* not kept */ }
    }
    await checkMedia(false);
    alert(found ? `Found ${found === 1 ? 'one file' : found + ' files'}${missing.length ? `: ${missing.length} still missing` : ''}.` : 'None of the missing files is there (they’re matched by name and size).');
  }
  function clearBoard() {
    if (!confirm('Clear the soundboard? Every item, its cues and the extra keys go, with their files (Save… first to keep a copy).')) return;
    wipe(new Set());
    if (deckBoard && deckBoard.reloadLayout) deckBoard.reloadLayout();
    sheet = { items: [] };
    sheetChanged();
    checkMedia(false);
  }
  function startSoundboard() {
    document.body.classList.add('soundboard');
    document.querySelector('main > h1').textContent = TITLE;
    document.querySelector('main > p.sub').textContent = 'Plays your own audio and video: a key for each item, on a Stream Deck, on this screen or on a phone. Add the items one by one, paste a list, or drop a folder of files on this page.';
    $('paired').hidden = false; $('sbbar').hidden = false; $('pairline').hidden = true;
    $('follow').checked = false; $('follow').closest('label').hidden = true; $('follow-note').hidden = true;
    showMode();
    cues = loadCues();
    sheet = loadSheet();
    onShow(sheetShow());
    checkMedia(false);
    $('sb-addform').addEventListener('submit', e => {
      e.preventDefault();
      const n = $('sb-name').value.trim().slice(0, 200), d = readLength($('sb-len').value);
      if (!n) return $('sb-name').focus();
      if ($('sb-len').value.trim() && !d) { alert('That length isn’t one I can read: minutes (5), m:ss (3:30), h:mm:ss, or 90s / 3m.'); return $('sb-len').focus(); }
      addItems([{ n, d }]);
      $('sb-name').value = ''; $('sb-len').value = ''; $('sb-name').focus();
    });
    $('sb-pastebtn').addEventListener('click', e => { e.currentTarget.blur(); $('sb-pastebox').hidden = !$('sb-pastebox').hidden; if (!$('sb-pastebox').hidden) $('sb-paste').focus(); });
    $('sb-paste').addEventListener('input', () => { const n = parseList($('sb-paste').value).length; $('sb-pastenote').textContent = n ? `${n} item${n === 1 ? '' : 's'}` : ''; });
    $('sb-pasteok').addEventListener('click', () => {
      const list = parseList($('sb-paste').value);
      if (!list.length) return $('sb-paste').focus();
      addItems(list);
      $('sb-paste').value = ''; $('sb-pastenote').textContent = ''; $('sb-pastebox').hidden = true;
    });
    $('sb-pastecancel').addEventListener('click', () => { $('sb-pastebox').hidden = true; });
    $('sb-save').addEventListener('click', e => { e.currentTarget.blur(); saveFile(); });
    $('sb-load').addEventListener('click', e => { e.currentTarget.blur(); $('sb-file').click(); });
    $('sb-file').addEventListener('change', () => { const f = $('sb-file').files[0]; $('sb-file').value = ''; if (f) loadFile(f); });
    $('sb-find').addEventListener('click', e => { e.currentTarget.blur(); $('sb-folder').click(); });
    $('sb-folder').addEventListener('change', () => { const l = [...$('sb-folder').files]; $('sb-folder').value = ''; if (l.length) findFiles(l); });
    $('sb-clear').addEventListener('click', e => { e.currentTarget.blur(); clearBoard(); });
    // Playlist flow and 🔁 Loop (chips: lit while on)
    for (const [id, k] of [['sb-flow', FLOW], ['sb-loop', FLOW_LOOP]]) $(id).addEventListener('click', e => {
      const on = store.get(k) !== '1';
      if (on) store.set(k, '1'); else store.del(k);
      e.currentTarget.blur();
      if (k === FLOW) flow = on && lastRun && activeItems().has(lastRun) ? { item: lastRun, t0: performance.now(), heard: false, len: null, silent: 0 } : null;   // (on: the item playing now flows on)
      renderFlow(); prepare();
    });
    renderFlow();
    $('sb-leave').addEventListener('click', () => { stopAll(); location.href = /\/s\/?$/.test(location.pathname) ? location.pathname.replace(/s\/?$/, 'p') : location.pathname; });
  }
  $('trysb').addEventListener('click', () => { location.href = /\/p\/?$/.test(location.pathname) ? location.pathname.replace(/p\/?$/, 's') : location.pathname + '?soundboard'; });
  $('trydemo').addEventListener('click', () => { location.href = location.pathname + '?demo'; });

  // ─── One playout page per browser (the owner, 13 Nov 2026) ───
  // Playout, its demo and the soundboard share this browser's sound cards and decks, so one tab runs at a
  // time: the Web Lock playout-page, held as long as the page lives. Another tab finds it taken and shows
  // #othertab (saying what the other runs: playout_page_mode) with Use this tab instead (steal: the other
  // tab's lock is cancelled, so it reloads and finds it taken); it takes over by itself when the other closes.
  const MODE = SOUNDBOARD ? 'soundboard' : DEMO ? 'demo' : 'playout';
  const MODE_NAME = { soundboard: 'Soundboard', demo: 'The playout demo', playout: 'Playout' };
  function oneTab(run) {
    if (!navigator.locks || !navigator.locks.request) return run();
    let started = false;
    const go = () => { if (started) return; started = true; $('othertab').hidden = true; store.set('playout_page_mode', MODE); run(); };
    const ask = opts => navigator.locks.request('playout-page', opts, lock => { if (!lock) return; go(); return new Promise(() => {}); });   // (held until the page goes)
    const stolen = err => { if (started && err && err.name === 'AbortError') { stopAll(); location.reload(); } };   // (another tab took over)
    ask({ ifAvailable: true }).then(() => {
      if (started) return;
      $('othertabtext').textContent = (MODE_NAME[store.get('playout_page_mode')] || 'Playout') + ' is running in another tab of this browser.';
      $('othertab').hidden = false;
      ask({}).catch(stolen);                           // (it takes over by itself when that tab closes)
    }).catch(stolen);
    $('othertake').addEventListener('click', e => { e.currentTarget.disabled = true; ask({ steal: true }).catch(stolen); });
  }
  oneTab(() => { if (SOUNDBOARD) startSoundboard(); else if (DEMO) startDemo(); else if (link.r && link.v) start(); else showEnter(); });
})();
