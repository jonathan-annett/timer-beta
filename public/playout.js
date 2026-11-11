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
 * (cut, faded, looped, levelled: only ever turned down, to this computer's house level), anything else
 * streamed. Sound outputs (audio-out.js, data-role="both"): cues go to Show, previews and editing to
 * Previews. A cue may have its own output (the owner, 12 Nov 2026: a sound card for a creative reason,
 * or a video's picture without its sound while an audio cue replaces it): out = {id, label} | 'none'
 * (videos only), absent = Show. Cues on the same trigger all play: audio together, but one video at a
 * time (the one later in the list stays on screen).
 *
 * Cues are kept by item id (an item's id survives Replace sheet and a CSV round trip: runsheet-core.js
 * matchRows), not by timer room, so they outlive a new share code and wait for their items to come back.
 * localStorage: playout_saved_link, playout_server, playout_token_<room>, playout_follow ('0' = off),
 * playout_cues ({itemId: [{id, name, media, src, trigger, at, duration, lib?, start?, end?, fadeIn?,
 * fadeOut?, loop?, lufs?, volume?, out?}]}; before Nov 2026 playout_cues_<room>, merged in once); the files
 * are in IndexedDB (video-store.js) as 'pocue:<cue id>'.
 * MIT Licensed
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  if (location.hostname) document.title = location.hostname + ' - Playout';
  if (window.TimerFeatures && !TimerFeatures.playout) {      // an alpha-only trial (features.js)
    document.querySelector('main').innerHTML = '<h1>Playout</h1><p class="sub">Playout computers aren’t available on this site.</p>';
    return;
  }

  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
    del: k => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };
  const SAVED_LINK = 'playout_saved_link', SERVER = 'playout_server', FOLLOW = 'playout_follow';
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
  const CUES = 'playout_cues', OLD_CUES = 'playout_cues_';   // (OLD_CUES + room: before Nov 2026)
  function loadCues() {
    const read = k => { try { const v = JSON.parse(store.get(k) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } };
    const all = read(CUES);
    let old = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(OLD_CUES)) old.push(k); } } catch (_) { old = []; }
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
      items: Array.isArray(m.items) ? m.items.filter(x => x && typeof x.id === 'string') : [],
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
      // A new item started: its start cues play, unless it started a while before we heard
      if (key && show.run > was.run && sinceStart() < LATE_START_MS) fireWhere(c => c.trigger === 'start');
      primeTimeCues();
    }
    prepare();
    render();
  }
  const sinceStart = () => show.age == null ? Infinity : show.age + (performance.now() - showAt);
  const following = () => store.get(FOLLOW) !== '0';
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
    return false;
  }
  // What's already true when an item is first seen doesn't play (a reconnect mid-item)
  function primeTimeCues() {
    const cd = countdown();
    for (const c of curCues()) if (c.trigger !== 'start') prevCond.set(c.id, condition(c, cd));
  }
  function fireWhere(test) {
    if (!following() || !show.on || show.fin) return;
    for (const c of curCues()) if (test(c) && !fired.has(c.id)) { fired.add(c.id); play(c); }
  }
  function tick() {
    if (local) tickLocal();
    if (place === 'external' && (!ext || ext.closed)) extGone();   // (closed without a pagehide)
    if (!show.cur || show.fin) return renderLocal();
    const cd = countdown();
    for (const c of curCues()) {
      if (c.trigger === 'start') continue;
      const now = condition(c, cd), before = prevCond.get(c.id);
      prevCond.set(c.id, now);
      if (now && before === false) fireWhere(x => x.id === c.id);
    }
    renderNow(cd);
  }

  // ─── An item run here (Follow the timer off: ▶ Start item) ─────────────────
  // Its cues as if the item had started at the press: start cues at once, the others timed from it by
  // this computer's clock ('remaining' and 'end' from the item's planned length; no pauses). One at a
  // time, like the timer's items: starting another drops this one's cues still to come (what's playing
  // plays on). Ends when nothing more can play, on ■ Stop item or Stop all, or when Follow goes back on.
  let local = null;                                    // {item, t0, dur (s) | null, fired, prev}
  const localCd = () => { const e = performance.now() - local.t0; return { elapsed: e, remain: local.dur == null ? Infinity : local.dur * 1000 - e }; };
  function runLocal(itemId) {
    const it = show.items.find(x => x.id === itemId);
    local = { item: itemId, t0: performance.now(), dur: it && it.d > 0 ? it.d : null, fired: new Set(), prev: new Map() };
    for (const c of cues[itemId] || []) if (c.trigger === 'start') { local.fired.add(c.id); play(c); }
    render();
  }
  function endLocal() { if (local) { local = null; render(); } }
  function tickLocal() {
    const cd = localCd(), list = cues[local.item] || [];
    for (const c of list) {
      if (c.trigger === 'start' || local.fired.has(c.id)) continue;
      const now = condition(c, cd), before = local.prev.get(c.id);
      local.prev.set(c.id, now);
      if (now && before !== true) { local.fired.add(c.id); play(c); }   // (true from the press: at once)
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
  // start (StingClip.gainFor: its trim, and only ever down to this computer's house level).
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
    const want = new Set();
    for (const it of ids) for (const c of (it && cues[it.id]) || []) { outKey(c); if (inMemory(c)) { want.add(clipKey(c)); bufferOf(c); } }
    for (const k of [...buffers.keys()]) if (!want.has(k)) buffers.delete(k);
  }
  function tickEvery(ms, fn) {                         // (a worker's tick: keeps time in a background window)
    let w = null, iv = 0;
    try { w = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},' + ms + ')'], { type: 'text/javascript' }))); w.onmessage = fn; }
    catch (_) { iv = setInterval(fn, ms); }
    return () => { if (w) w.terminate(); else clearInterval(iv); };
  }
  function rampEl(el, to, ms, done) {
    const steps = Math.max(1, Math.round(ms / 50)), from = el.volume;
    let n = 0;
    const stop = tickEvery(50, () => { n++; el.volume = Math.max(0, Math.min(1, from + (to - from) * n / steps)); if (n >= steps) { stop(); if (done) done(); } });
    return stop;
  }
  function bufferVoice(c, buf, onEnd, out) {
    let p = null;
    return {
      play() {
        p = StingClip.play(buf, { role: out });
        if (p.refused) { p = null; return false; }
        p.gain.gain.value = StingClip.gainFor(c);
        p.ended.then(onEnd);
        return true;
      },
      fade(ms) { if (p) p.fade(ms); },
      stop() { if (p) p.stop(); },
      release() {},
    };
  }
  // (over: stopped, or another cue took the element, while play() waited: it then leaves it alone)
  function elementVoice(c, el, url, onEnd, out) {
    const r = StingClip.region(c) || {}, start = r.start || 0;
    let stopEnd = null, stopRamp = null, over = false;
    el.src = url;
    const finish = () => { if (over) return; over = true; if (stopEnd) stopEnd(); if (stopRamp) stopRamp(); el.pause(); onEnd(); };
    const v = {
      async play() {
        if (start) await new Promise(res => { if (el.readyState >= 1) res(); else { el.addEventListener('loadedmetadata', res, { once: true }); el.addEventListener('error', res, { once: true }); } });   // (unreadable: play() says so)
        if (over) return false;
        if (start) el.currentTime = start;
        const g = out ? StingClip.gainFor(c) : 0;      // (no sound: a video's picture only)
        el.volume = r.fadeIn ? 0 : g;
        el.onended = finish;
        if (window.AudioOut && out) await AudioOut.media(el, out);
        if (over) return false;
        await el.play();
        if (over) return false;
        if (r.fadeIn) stopRamp = rampEl(el, g, r.fadeIn);
        if (r.end != null) stopEnd = tickEvery(50, () => {   // the end of the part: faded out there
          if (el.currentTime >= r.end - (r.fadeOut || 0) / 1000) { stopEnd(); stopEnd = null; v.fade(r.fadeOut || 30); }
        });
        return true;
      },
      fade(ms) { if (over) return; if (stopRamp) stopRamp(); stopRamp = rampEl(el, 0, ms, finish); },
      stop() { finish(); },
      release() { try { el.pause(); el.removeAttribute('src'); el.load(); } catch (_) { /* gone */ } URL.revokeObjectURL(url); },
    };
    return v;
  }
  const playing = new Map();                           // cue id → {voice, video}
  const vid = $('vid');                                // video cues' element: in the Output box, or the floating window
  async function play(c) {
    const out = outKey(c);
    if (out && window.AudioOut && !AudioOut.ok(out)) {   // its output isn't there: an audio cue doesn't play,
      AudioOut.warn(out);                                // a video plays without its sound (audio-out.js mutes it)
      if (c.media !== 'video') return;
    }
    const memory = inMemory(c) ? await bufferOf(c) : null;
    const blob = memory ? null : await fileOf(c);
    if (!memory && !blob) { status('The file for “' + c.name + '” isn’t in this browser any more. Add the cue again.', 'warn'); return; }
    stopCue(c.id);
    if (c.media === 'video') for (const [id, q] of playing) if (q.video) stopCue(id);   // one video on the output at a time
    const p = { video: c.media === 'video' };
    const onEnd = () => { if (playing.get(c.id) === p) stopCue(c.id); };
    p.voice = memory ? bufferVoice(c, memory, onEnd, out) : elementVoice(c, p.video ? vid : new Audio(), URL.createObjectURL(blob), onEnd, out);
    playing.set(c.id, p);
    if (p.video) $('stage').querySelector('.idle').hidden = true;
    render();
    let ok = false;
    try { ok = await p.voice.play(); }
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
  function stopAll() { for (const id of [...playing.keys()]) stopCue(id); }
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
    const b = $('ext');
    b.textContent = external ? 'Play here instead' : 'To external monitor';
    b.disabled = (external && on) || setup;
    b.title = external && on ? 'Not while a video plays on the external monitor'
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
  function fadeAll(ms) { for (const p of playing.values()) p.voice.fade(ms); }

  // ─── Cues (made here, kept here) ──────────────────────────────────────────
  const TRIGGERS = { start: 'At the start', end: 'When time’s up', elapsed: 'After', remaining: 'With … left' };
  const whenText = c => c.trigger === 'elapsed' ? 'After ' + mmss(c.at) : c.trigger === 'remaining' ? 'With ' + mmss(c.at) + ' left' : TRIGGERS[c.trigger];
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
      if (now && Number.isFinite(l)) { now.c.lufs = l; saveCues(); }
    } catch (_) { /* no sound to measure, or unreadable: plays as it is */ }
  }
  // A cue from the + sting dialog's choice (sting-picker.js): the file, or a copy of the stock sting or
  // link, kept in this browser
  async function addCue(itemId, ch, trigger, at) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    let blob, cue;
    status('Adding the cue…');
    if (ch.file) {
      let f;
      try { f = await StingClip.playable(ch.file); } catch (err) { alert(err && err.message || err); return showMode(); }   // (an AIFF as WAV)
      if (!/^(audio|video)\//.test(f.type)) { alert('Choose an audio or video file.'); return showMode(); }
      const x = ch.extra || {};
      blob = f;
      cue = Object.assign({ name: String(x.name || noExt(f.name)).slice(0, 200), media: f.type.startsWith('video/') ? 'video' : 'audio', src: 'file' }, x.clip, x.lib ? { lib: x.lib } : {});
    } else {
      const s = ch.sting;
      try { const r = await fetch(s.url); if (!r.ok) throw new Error('HTTP ' + r.status); blob = await r.blob(); }
      catch (err) { alert('Couldn’t copy “' + s.name + '” to this computer (' + (err && err.message || err) + ').'); return showMode(); }
      cue = Object.assign({ name: s.name, media: s.media === 'video' ? 'video' : 'audio', src: s.src === 'link' ? 'link' : 'stock', duration: s.duration || null }, StingPicker.clipFields(s), s.lib ? { lib: s.lib } : {});
    }
    if (cue.duration == null) cue.duration = await probeDuration(blob);
    try { await window.videoStore.put('pocue:' + id, blob); } catch (err) { alert('Couldn’t keep the file in this browser: ' + (err && err.message || err)); return showMode(); }
    cue = Object.assign({ id, trigger, at: at || 0 }, cue);
    (cues[itemId] = cues[itemId] || []).push(cue);
    saveCues();
    retime(itemId, cue);                               // added during its item: only from now on
    showMode();
    render();
    if (!Number.isFinite(cue.lufs)) measure(cue);
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
  async function editCue(c) {
    const blob = await fileOf(c);
    if (!blob) { alert('The file for “' + c.name + '” isn’t in this browser any more. Add the cue again.'); return; }
    const r = await StingClip.open({ src: blob, name: c.name, region: c, media: c.media });
    const now = r && findCue(c.id);
    if (!now) return;
    now.c.name = String(r.name || now.c.name).slice(0, 200);
    for (const k of StingPicker.CLIP_KEYS) { if (r[k] == null) delete now.c[k]; else now.c[k] = r[k]; }
    if (now.c.duration == null && r.sourceLength) now.c.duration = Math.round(r.sourceLength * 10) / 10;
    saveCues();
    render();
  }
  // Cues of items the timer's sheet doesn't have (another show's, or deleted): kept until removed here
  const orphanIds = () => show.items.length ? Object.keys(cues).filter(k => !show.items.some(it => it.id === k)) : [];

  // ─── Page ─────────────────────────────────────────────────────────────────
  const lenText = c => { const l = StingClip.length(c, c.duration); return l ? mmss(Math.max(1, l)) : ''; };
  // A cue's output menu: Show, this computer's sound cards (named once the browser may: AudioOut.ask),
  // and for a video No sound
  let outList = [];
  const refreshOuts = () => { if (window.AudioOut) AudioOut.devices().then(l => { outList = l; render(); }); };
  document.addEventListener('audio-out', refreshOuts);
  function outMenu(c) {
    const ao = window.AudioOut && AudioOut.supported, opts = [['', '→ Show']];
    let val = '';
    if (ao) {
      outList.forEach((d, i) => opts.push([d.id, '→ ' + (d.label || 'Sound card ' + (i + 1))]));
      if (c.out && c.out.id) {
        const named = c.out.label ? outList.filter(d => d.label === c.out.label) : [];
        const d = outList.find(x => x.id === c.out.id) || (named.length === 1 ? named[0] : null);   // (as audio-out.js finds it)
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
  function render() {
    document.body.classList.toggle('manual', !following());
    renderPlace();
    const items = show.items;
    $('rshint').textContent = !show.on ? 'The timer isn’t in run sheet mode' : show.fin ? 'The show has finished' : '';
    const curIdx = items.findIndex(x => x.id === show.cur);
    const open = document.activeElement && document.activeElement.closest('form.addcue, #items select.cout');
    if (open) return;                                  // don't rebuild under someone adding a cue or choosing an output
    const manual = !following();
    $('items').innerHTML = items.map((it, i) => {
      const list = cues[it.id] || [], here = local && local.item === it.id;
      const done = c => (i === curIdx && fired.has(c.id)) || (here && local.fired.has(c.id));
      const runBtn = !manual || it.e || !list.length ? ''
        : here ? '<button class="small" data-act="endrun" title="Stop this item’s cues, and the rest of them won’t play">■ Stop item</button>'
        : `<button class="small" data-act="run" title="Its cues as if it started now: start cues at once, the others timed from now${it.d ? ' (its length: ' + mmss(it.d) + ')' : ''}">▶ Start item</button>`;
      return `<li data-id="${esc(it.id)}" class="${i === curIdx ? 'now' : curIdx >= 0 && i < curIdx ? 'done' : ''}${here ? ' here' : ''}">` +
        `<div class="ihead"><span class="iname">${esc(it.n || '(no name)')}</span>${i === curIdx ? '<span class="itag">now</span>' : ''}${here ? '<span class="itag ilocal"></span>' : ''}` +
        `<span class="idur">${it.e ? 'finish' : it.d ? mmss(it.d) : ''}</span>${runBtn}${it.e ? '' : '<button class="small" data-act="add">+ cue</button>'}</div>` +
        (list.length ? '<ul class="cues">' + list.map(c => `<li data-cue="${esc(c.id)}" class="${done(c) ? 'fired' : ''}${playing.has(c.id) ? ' playing' : ''}">` +
          `<button class="small" data-act="${playing.has(c.id) ? 'stop' : 'fire'}" title="${playing.has(c.id) ? 'Stop' : 'Play it now (on this computer)'}">${playing.has(c.id) ? '■' : '▶'}</button>` +
          `<span class="when">${esc(whenText(c))}</span><span class="fname">${c.media === 'video' ? '🎞' : '🎵'} ${esc(c.name)}</span>` +
          `<span class="clen">${StingClip.region(c) ? '✂ ' : ''}${lenText(c)}</span>` + outMenu(c) +
          `<button class="small" data-act="when" title="Change when it plays">✎</button>` +
          `<button class="small" data-act="edit" title="Choose the part to play, fades, a loop and its level (the file isn’t cut)">✂</button>` +
          `<button class="small" data-act="del" title="Remove this cue">✕</button></li>`).join('') + '</ul>' : '') +
        '</li>';
    }).join('') || '<li class="hint">No run sheet yet: the timer sends it when it has one.</li>';
    const orphans = orphanIds(), n = orphans.reduce((a, k) => a + cues[k].length, 0);
    $('orphans').hidden = !n;
    $('orphantext').textContent = n === 1 ? '1 cue belongs to an item that isn’t on the timer’s run sheet (kept here for when it comes back).' : n + ' cues belong to items that aren’t on the timer’s run sheet (kept here for when they come back).';
    renderNow(countdown());
  }
  function renderNow(cd) {
    const it = show.items.find(x => x.id === show.cur);
    $('now').innerHTML = it && cd ? `Now: <b>${esc(it.n)}</b> · ${cd.remain >= 0 ? mmss(cd.remain / 1000) + ' left' : 'over by ' + mmss(-cd.remain / 1000)}` : '';
    renderLocal();
  }
  function renderLocal() {                             // the item run here: its time, in place (each tick)
    const el = local && document.querySelector('#items .ilocal');
    if (!el) return;
    const cd = localCd();
    el.textContent = 'here · ' + (local.dur == null ? mmss(cd.elapsed / 1000) : cd.remain >= 0 ? mmss(cd.remain / 1000) + ' left' : 'over by ' + mmss(-cd.remain / 1000));
  }
  $('items').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const li = b.closest('li[data-id]'), itemId = li && li.dataset.id;
    const cueId = b.closest('li[data-cue]') && b.closest('li[data-cue]').dataset.cue;
    const c = cueId && (cues[itemId] || []).find(x => x.id === cueId);
    if (b.dataset.act === 'fire' && c) play(c);        // by hand: always, followed or not
    else if (b.dataset.act === 'stop' && c) stopCue(c.id);
    else if (b.dataset.act === 'edit' && c) editCue(c);
    else if (b.dataset.act === 'when' && c) whenForm(b.closest('li[data-cue]'), c, 'Save', (trigger, at) => retimeCue(itemId, c, trigger, at));
    else if (b.dataset.act === 'del' && c) { if (confirm('Remove the cue “' + c.name + '”?')) removeCue(itemId, c.id); }
    else if (b.dataset.act === 'add') addForm(li);
    else if (b.dataset.act === 'run') runLocal(itemId);
    else if (b.dataset.act === 'endrun') { for (const x of cues[itemId] || []) stopCue(x.id); endLocal(); }
  });
  // A cue's output (from its next play)
  $('items').addEventListener('change', e => {
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
  });
  $('items').addEventListener('focusout', e => { if (e.target.matches('select.cout')) setTimeout(render, 0); });
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
    const timed = t => t === 'elapsed' || t === 'remaining';
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
  $('fadeall').addEventListener('click', e => { e.currentTarget.blur(); fadeAll(FADE_MS); });
  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen(); else if (place === 'here') $('stage').requestFullscreen().catch(() => {}); };
  $('full').addEventListener('click', toggleFull);
  $('ext').addEventListener('click', e => { e.currentTarget.blur(); if (place === 'external') moveVideo('here'); else toExternal(); });
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.target.closest('input, select, textarea')) return;
    if (document.querySelector('.sting-dlg, .sting-libwrap, .sc-wrap')) return;   // (a dialog has the keys)
    if (e.key === 'f' || e.key === 'F') toggleFull();
    else if (e.key === 'Escape' && !document.fullscreenElement && playing.size) { e.preventDefault(); fadeAll(FADE_MS); }   // (in full screen, Esc leaves it)
  });
  if (window.AudioOut) { AudioOut.picker($('ao-pick'), ['show', 'preview']); refreshOuts(); }
  $('unpair').addEventListener('click', () => {
    if (!confirm('Unpair this computer from the timer? Its cues stay here.')) return;
    store.del(SAVED_LINK);
    if (link.r) store.del(tokenKey(link.r));
    location.reload();
  });

  // Test hooks: what's playing, and the cues
  window.__playout = { playing: () => [...playing.keys()], cues: () => cues, show: () => show, fired: () => [...fired], ready: () => [...buffers.keys()],
    local: () => local && { item: local.item, fired: [...local.fired] },
    video: () => ({ where: vid.ownerDocument === document ? 'here' : 'external', paused: vid.paused, t: vid.currentTime, src: !!vid.getAttribute('src') }) };

  if (link.r && link.v) start(); else showEnter();
})();
