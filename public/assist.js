/*!
 * assist.js
 * The assist station (assist.html): on a second computer, it listens to the room, keeps a
 * time-stamped transcript, and moves the timer's start to the line where the speaker actually
 * began. It pairs like the overlay (6-digit code, then the proximity check: a view-only link) and
 * says client:'assist' in its hello; moving the start needs the operator's Allow in the share panel
 * (remote-control.js, "The assist station"). Only {t:'shift', msecs, whole} ever changes the timer;
 * the transcript never leaves this computer.
 *
 * Times: everything here is on this computer's clock. The timer sends its start with its own clock
 * beside it ({t:'assist-start', at, now}), so the start on this clock is at − (now − arrival): the
 * two clocks needn't agree (the trip takes milliseconds on a LAN).
 *
 * Transcription: Whisper on this computer (assist-audio.js records the room into a 15-minute
 * rolling buffer, cuts it into phrases and transcribes them in a worker, assist-asr.js; times are
 * where each phrase is in the recording), or the browser's speech service (Web Speech API: no word
 * timings, so a phrase is stamped when its first words come in, less LEAD_MS). Both feed
 * hear(at, text). The recording runs either way, so lines and the timer's start can be played back.
 *
 * Run sheet mode: the timer decides how a move moves it ({t:'assist-rs', shift}: the next item's
 * auto start keeps the end, otherwise the whole timer and the later starts move) and the switch
 * here is off; it also sends the show's actual starts (log), marked in the transcript where they
 * fell ([15:45 Mr Smith +16:40]). The live item's marker (or "Timer start" outside run sheet
 * mode) can be dragged onto the line where the speaker really began.
 *
 * localStorage: assist_saved_link, assist_server, assist_token_<room>, assist_mode (whole | start),
 *   assist_engine, assist_model, assist_mic (below). The transcript is the last 15 minutes, held in
 *   memory and copied to IndexedDB (database assist, store lines {id, at, text, item}) in bursts,
 *   only so a reload keeps it (Store below; assist_unsaved holds the last unwritten seconds over a
 *   reload); an older localStorage assist_lines is moved there once.
 *   assist_engine: whisper | browser; assist_model: tiny.en | base.en | small.en; assist_mic: device id
 * MIT Licensed
 */

/* global RemotePeer, RemoteClock, TimerNotices, AssistAudio, AssistASR */

(function () {
  'use strict';
  if (location.hostname) document.title = location.hostname + ' - Assist station';

  const $ = id => document.getElementById(id);
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
    del: k => { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };
  const SAVED_LINK = 'assist_saved_link', SERVER = 'assist_server', MODE = 'assist_mode', ENGINE = 'assist_engine', MODEL = 'assist_model', MIC = 'assist_mic';
  const parse = frag => Object.fromEntries(new URLSearchParams(frag));
  const defaultServer = () => new URLSearchParams(location.search).get('remote') || store.get(SERVER) || RemotePeer.defaultServer();
  const tokenKey = room => 'assist_token_' + room;
  const LEAD_MS = 500;                  // a phrase's first words reach us about this long after they're said
  const REACH_MS = 15 * 60000;          // lines further than this from the start can't move it
  const MAX_LINES = 3000;

  const two = n => String(n).padStart(2, '0');
  const clockOf = ms => { const d = new Date(ms); return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()); };
  const mmss = ms => { const s = Math.round(Math.abs(ms) / 1000); return (ms < 0 ? '−' : '+') + Math.floor(s / 60) + ':' + two(s % 60); };

  // ─── Which timer: a link in the address, the one saved, or pair by code ───

  let link = parse(location.hash.slice(1));
  if (link.r && link.v) { store.set(SAVED_LINK, location.hash.slice(1)); history.replaceState(null, '', location.pathname + location.search); }
  else link = parse(store.get(SAVED_LINK) || '');

  function showEnter() {
    $('enter').hidden = false;
    $('server').value = defaultServer();
    $('code').focus();
    window.addEventListener('focus', () => { if (!$('enter').hidden && !$('code').disabled && !$('server').matches(':focus')) $('code').focus(); });
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

  // ─── Connection (view only; moving the start is allowed separately) ──────

  let ws = null, peer = null, retry = 1000, retryTimer = null, hostOnline = false, waiting = false, refused = false;
  const state = {};
  const clock = RemoteClock.create(v => { Object.assign(state, v); renderTimer(); });
  let allowed = 'no';                   // no | asked | yes | refused | stopped (the timer's answer)
  let startLocal = null;                // the timer's start, on this computer's clock
  let offset = null;                    // the timer's clock − this one's (ms)
  let rsShift = null, rsLog = [];       // run sheet mode: {w, why} and [{n, p, a, e}] (the timer's clock)

  function start() {
    $('paired').hidden = false;
    $('room').textContent = link.r;
    if (link.t) store.set(tokenKey(link.r), link.t);
    connect();
    renderAll();
  }

  function status(text, kind) { $('status').textContent = text; $('status').className = kind || ''; }
  function showMode() {
    if (waiting) return status('Waiting for the timer… (closed, or it made a new share code: then unpair and pair again)', 'warn');
    if (!ws || ws.readyState !== WebSocket.OPEN) return status('Reconnecting…', 'warn');
    if (!hostOnline) return status('The timer is offline: waiting for it…', 'warn');
    status(peer && peer.mode === 'lan' ? '⚡ Connected directly (same network)' : peer && peer.mode === 'p2p' ? '⚡ Connected directly (over the internet)' : 'Connected via the server', 'ok');
  }
  RemotePeer.retryOnNetworkChange(() => { if (peer && peer.mode === 'server' && hostOnline) peer.send({ t: 'relink' }); });

  const hello = () => peer && peer.send({ t: 'hello', token: store.get(tokenKey(link.r)) || undefined, clock: 1, client: 'assist' });
  function newPeer() {
    if (peer) peer.close();
    peer = RemotePeer.create({
      initiator: false,
      relay: msg => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'up', msg })); },
      onMessage,
      onModeChange: showMode,
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
        case 'host-offline': hostOnline = false; if (peer) peer.close(); peer = null; renderTimer(); break;
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
      renderTimer(); showMode();
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
    if (m.t === 'pin-required') {
      if (!pinCode) pinCode = String(100 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900));   // 3 digits: the proximity check
      $('pincode').textContent = pinCode; $('pinwait').hidden = false;
      if (peer) peer.send({ t: 'pin', code: pinCode, name: 'Assist · ' + RemotePeer.deviceName() });
    } else if (m.t === 'pin-ok') {
      if (typeof m.token === 'string') store.set(tokenKey(link.r), m.token);
      pinCode = null; $('pinwait').hidden = true;
      hello();
    } else if (m.t === 'pin-rejected' || m.t === 'revoked') {
      refused = true;
      $('pinwait').hidden = false;
      $('pinmsg').textContent = m.t === 'revoked' ? 'The timer took this computer’s access away.' : 'The timer didn’t let this computer in. Reload this page to try again.'; $('pincode').textContent = '';
    } else if (m.t === 'state' && m.s && typeof m.s === 'object') {
      if (m.full) for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, m.s);
      if ('words' in m.s) clock.words(TimerNotices.words(m.s.words || {}));
      if (m.s.clk) clock.set(m.s.clk);
      if (clock.active) Object.assign(state, clock.values());
      renderTimer();
    } else if (m.t === 'assist' && typeof m.state === 'string') {
      allowed = m.state;
      renderAll();
    } else if (m.t === 'assist-start' && Number.isFinite(m.at) && Number.isFinite(m.now)) {
      offset = m.now - Date.now();
      startLocal = m.at - offset;
      renderAll();
    } else if (m.t === 'assist-rs' && Number.isFinite(m.now)) {
      offset = m.now - Date.now();
      const json = v => { try { return v ? JSON.parse(v) : null; } catch (_) { return null; } };
      rsShift = json(m.shift);
      rsLog = (Array.isArray(json(m.log)) ? json(m.log) : []).filter(x => x && Number.isFinite(x.a));
      renderAll();
    } else if (m.t === 'shift-result') {
      if (m.error) { moved('The timer didn’t take that (' + m.error + ').', 'bad'); return; }
      const ms = m.msecs;
      lastMove = { ms, whole: m.whole !== false };
      moved(`Start moved ${mmss(ms).slice(1)} ${ms > 0 ? 'later' : 'earlier'}${m.whole === false ? ' (end unchanged)' : ''}.`, 'ok', true);
    }
  }

  $('unpair').addEventListener('click', () => {
    store.del(SAVED_LINK);
    if (link.r) store.del(tokenKey(link.r));
    location.reload();
  });

  // ─── Moving the start ─────────────────────────────────────────────────────

  let mode = store.get(MODE) === 'start' ? 'start' : 'whole';
  let lastMove = null;
  const moveWhole = () => (rsShift ? !!rsShift.w : mode === 'whole');   // in run sheet mode the timer decides
  $('mode').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-m]');
    if (!b || rsShift) return;
    mode = b.dataset.m; store.set(MODE, mode); renderAll();
  });
  $('ask').addEventListener('click', () => { if (peer) peer.send({ t: 'assist', on: true }); });

  let req = 0;
  function shift(ms, whole) {
    if (!peer || allowed !== 'yes' || !Math.round(ms)) return;
    peer.send({ t: 'shift', msecs: Math.round(ms), whole, req: String(++req) });
  }
  function moved(text, kind, undo) {
    const box = $('moved');
    box.textContent = text; box.className = kind || '';
    if (undo && lastMove) {
      const b = document.createElement('button');
      b.textContent = 'Undo';
      b.addEventListener('click', () => { const l = lastMove; lastMove = null; if (l) shift(-l.ms, l.whole); });
      box.appendChild(b);
    }
  }

  // ─── The transcript ───────────────────────────────────────────────────────
  // lines: {at (this computer's ms), text, item (the run sheet item then, or '')}; one interim
  // (still being heard) at most, shown greyed at the end.

  // The transcript is a loop, like the recording: lines and frames go after 15 minutes (KEEP_MS).
  // It lives in memory; IndexedDB is only there to survive a reload, so changes go to it in one
  // write every few seconds (and when the page is hidden or closed), not one at a time.
  const DB_NAME = 'assist', FLUSH_MS = 5000, KEEP_MS = 15 * 60000, GAP_MS = 2000;
  const STORES = ['lines', 'frames'];
  const Store = (() => {
    let db = null, timer = null, clearAll = false;
    const pending = {}, gone = {};
    const reset = () => STORES.forEach(n => { pending[n] = new Map(); gone[n] = new Set(); });
    reset();
    const open = () => new Promise((resolve, reject) => {
      const rq = indexedDB.open(DB_NAME, 2);
      rq.onupgradeneeded = () => STORES.forEach(n => { if (!rq.result.objectStoreNames.contains(n)) rq.result.createObjectStore(n, { keyPath: 'id' }); });
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
    const dirty = () => clearAll || STORES.some(n => pending[n].size || gone[n].size);
    function flush() {
      clearTimeout(timer); timer = null;
      if (!db || !dirty()) return;
      const tx = db.transaction(STORES, 'readwrite');
      STORES.forEach(n => {
        const os = tx.objectStore(n);
        if (clearAll) os.clear();
        gone[n].forEach(id => os.delete(id));
        pending[n].forEach(r => os.put(r));
      });
      clearAll = false; reset();
    }
    const soon = () => { if (!timer) timer = setTimeout(flush, FLUSH_MS); };
    // A write started as the page goes (a reload) doesn't finish: the lines not written yet go to
    // localStorage at once instead (assist_unsaved, small: a few seconds' worth), read back by
    // load(). Frames that late are let go (pictures are too big for localStorage).
    window.addEventListener('pagehide', () => {
      if (pending.lines.size || gone.lines.size || clearAll) store.set('assist_unsaved', JSON.stringify({ put: [...pending.lines.values()], gone: [...gone.lines], clear: clearAll }));
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
    const all = n => new Promise(resolve => { const rq = db.transaction(n).objectStore(n).getAll(); rq.onsuccess = () => resolve(rq.result || []); rq.onerror = () => resolve([]); });
    return {
      async load() {
        try { db = await open(); } catch (_) { return { lines: [], frames: [] }; }   // private window etc.: memory only
        let lines = await all('lines');
        const frames = await all('frames');
        try {                                // an older station kept it in localStorage
          const old = JSON.parse(store.get('assist_lines') || '[]');
          if (Array.isArray(old) && old.length) old.forEach(l => { if (l && Number.isFinite(l.at)) { l.id = newId(); lines.push(l); pending.lines.set(l.id, l); } });
          store.del('assist_lines');
        } catch (_) { /* nothing to move */ }
        try {                                // the last few seconds before a reload
          const u = JSON.parse(store.get('assist_unsaved') || 'null');
          if (u) {
            if (u.clear) { lines = []; frames.length = 0; clearAll = true; }
            const drop = new Set(u.gone || []);
            lines = lines.filter(l => !drop.has(l.id));
            drop.forEach(id => gone.lines.add(id));
            (u.put || []).forEach(l => { if (l && Number.isFinite(l.at)) { lines = lines.filter(x => x.id !== l.id); lines.push(l); pending.lines.set(l.id, l); } });
          }
          store.del('assist_unsaved');
        } catch (_) { /* none */ }
        flush();
        return { lines: lines.filter(x => x && Number.isFinite(x.at) && typeof x.text === 'string'),
          frames: frames.filter(f => f && Number.isFinite(f.at) && f.blob instanceof Blob) };
      },
      put(n, r) { pending[n].set(r.id, r); gone[n].delete(r.id); soon(); },
      drop(n, r) { pending[n].delete(r.id); gone[n].add(r.id); soon(); },
      clear() { reset(); clearAll = true; flush(); },
      flush,
    };
  })();
  let idSeq = 0;
  const newId = () => Date.now() * 1000 + (idSeq++ % 1000);

  // lines: {id, at, to (its end, ms), text, item, gapFrom (when the words before it stopped, if
  // that was over GAP_MS earlier while listening)}
  const lines = [];
  let interim = null, armed = null;    // armed: the line asked "started here?"
  let listenSince = null;              // gaps count only while listening throughout
  function hear(at, text, to) {
    text = String(text || '').trim();
    if (!text) return;
    const l = { id: newId(), at, to: Math.max(at, to || at), text, item: String(state.rsNow || '') };
    let prev = null;
    for (const x of lines) if (x.at <= at) prev = x;
    if (prev && listenSince != null && prev.to >= listenSince && at - prev.to > GAP_MS) {
      l.gapFrom = prev.to;
      video.want(prev.to); video.want(at);        // a picture at each end of the gap
    }
    addLine(l);
    renderLog(true);
  }
  function addLine(l) {
    let i = lines.length;                 // in time order (a phrase can come back after a later one)
    while (i > 0 && lines[i - 1].at > l.at) i--;
    lines.splice(i, 0, l);
    Store.put('lines', l);
    prune();
  }

  // frames: {id, at, why (grid | gap), blob, url}: the ones kept (assist-video.js decides)
  const frames = [];
  function addFrame(f, save) {
    if (!f.url) f.url = URL.createObjectURL(f.blob);
    let i = frames.length;
    while (i > 0 && frames[i - 1].at > f.at) i--;
    frames.splice(i, 0, f);
    if (save) Store.put('frames', { id: f.id, at: f.at, why: f.why, blob: f.blob });
  }
  function prune() {
    const cut = Date.now() - KEEP_MS;
    let n = 0;
    while (lines.length && (lines.length > MAX_LINES || lines[0].at < cut)) { Store.drop('lines', lines.shift()); n++; }
    while (frames.length && frames[0].at < cut) { const f = frames.shift(); URL.revokeObjectURL(f.url); Store.drop('frames', f); n++; }
    return n;
  }
  setInterval(() => { if (prune()) renderLog(); }, 10000);
  Store.load().then(saved => {
    const now = lines.splice(0);          // heard while loading
    saved.lines.sort((a, b) => a.at - b.at).forEach(l => lines.push(l));
    now.forEach(addLine);
    saved.frames.forEach(f => addFrame(f, false));
    prune();
    logSig = ''; renderLog('force');
  });

  // ─── Pictures (assist-video.js) ───────────────────────────────────────────
  // A camera on the stage (a wide shot: the lectern and the screen), a capture card (the vision
  // mixer's programme: name captions, stings) or a shared screen (assist_cam: a device id, 'screen'
  // or 'off'). It runs while listening. Frames are taken densely and thinned once the transcript
  // has caught up: kept are one every 10 s and both ends of every gap in the words (a music sting
  // with a name on screen is a gap: Whisper hears no words in it).
  const CAM = 'assist_cam';
  let cam = store.get(CAM) ?? 'off';     // '' is the default camera
  const video = AssistVideo.create({
    onKeep: f => { addFrame(f, true); renderLog(); },
    onEnded: () => { camStatus('The picture stopped (the camera was unplugged, or the sharing ended).', 'warn'); $('camview').srcObject = null; $('camview').hidden = true; },
  });
  window.__assistFrames = () => ({ kept: frames.map(f => f.why), held: video.heldCount() });   // tests
  function camStatus(text, kind) { $('camstate').textContent = text; $('camstate').className = 'hint ' + (kind || ''); }
  async function startCam() {
    if (cam === 'off') { video.stop(); $('camview').srcObject = null; $('camview').hidden = true; return camStatus(''); }
    try {
      const label = await video.start(cam === 'screen' ? 'screen' : cam);
      $('camview').srcObject = video.stream; $('camview').hidden = false;
      camStatus('Pictures from ' + (label || 'the camera') + ': one every 10 s, and both ends of every pause in the speech.', 'ok');
      fillCams();
    } catch (err) {
      camStatus(err && err.name === 'NotAllowedError' ? 'The camera (or sharing) was blocked or cancelled.' : 'No picture: ' + ((err && err.message) || err), 'bad');
    }
  }
  function stopCam() { video.stop(); $('camview').srcObject = null; $('camview').hidden = true; }
  // Frames are let go once the transcript is past them (nothing before the oldest phrase still
  // being heard or transcribed can turn out to be a gap's end); the one at the last line's end
  // stays, as a gap may yet start there.
  setInterval(() => {
    if (!video.running) return;
    const now = Date.now();
    let horizon = now - (engine === 'whisper' ? 2500 : 5000);
    const p = audio.pendingFrom(), o = asr && engine === 'whisper' ? asr.oldest() : null;
    if (p != null) horizon = Math.min(horizon, p);
    if (o != null) horizon = Math.min(horizon, o);
    const last = lines[lines.length - 1];
    video.settle(horizon, last ? last.to : null);
  }, 1000);
  async function fillCams() {
    try {
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput' && d.deviceId);
      const sel = $('cam');
      sel.innerHTML = '<option value="off">None</option><option value="">Default camera</option>' +
        list.map(d => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Camera')}</option>`).join('') +
        (navigator.mediaDevices.getDisplayMedia ? '<option value="screen">A screen or window (share it)</option>' : '');
      sel.value = [...sel.options].some(o => o.value === cam) ? cam : 'off';
    } catch (_) { /* no devices */ }
  }
  $('cam').addEventListener('change', () => {
    cam = $('cam').value;
    store.set(CAM, cam);
    if (listening) startCam(); else if (cam === 'off') stopCam();
  });
  fillCams();

  window.__assistHear = (text, agoMs, durMs) => hear(Date.now() - (agoMs || 0), text, Date.now() - (agoMs || 0) + (durMs || 0));   // tests (and other engines)
  $('big').addEventListener('click', () => { $('big').hidden = true; });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') $('big').hidden = true; });

  // Two ways to transcribe (assist_engine): Whisper on this computer, fed from the rolling
  // recording (assist-audio.js; exact times, nothing leaves the computer, a model to fetch once), or
  // the browser's speech service (Chrome / Edge send the audio to Google / Microsoft; a phrase is
  // stamped when its first words come back, less LEAD_MS). The recording runs with either, so any
  // line (and the timer's start) can be played back while it's still held (15 minutes).
  const SRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let engine = store.get(ENGINE) === 'browser' && SRec ? 'browser' : 'whisper';
  let model = AssistASR.MODELS[store.get(MODEL)] ? store.get(MODEL) : 'base.en';
  let listening = false, rec = null, heard = {}, asr = null;
  const audio = AssistAudio.create({
    minutes: 15,
    onLevel: rms => { $('level').style.width = Math.min(100, Math.round(Math.sqrt(rms) * 220)) + '%'; },
    onSegment: seg => {
      if (asr && engine === 'whisper') { asr.add({ at: audio.wallOf(seg.from), audio: seg.audio, why: seg.why }); asrBacklog(); }
      else if (engine === 'whisper') {
        AssistLedger.t.ignoredN++; AssistLedger.t.ignoredS += seg.audio.length / AssistAudio.SR;
        AssistLedger.note('not sent', `a ${(seg.audio.length / AssistAudio.SR).toFixed(1)} s phrase: no transcriber running`);
      }
    },
  });

  // Audio accounting (AssistLedger in assist-audio.js): where every bit of the recording went
  const ledgerText = () => `Assist station audio accounting, ${new Date().toString()}\n` +
    `Engine ${engine}${engine === 'whisper' ? ` (Whisper ${model}${asr ? ', ' + (asr.device || 'loading') : ''}, ${asr ? asr.backlog() : 0} waiting)` : ''}\n\n` + AssistLedger.report();
  setInterval(() => { if ($('ledger').open) $('ledgertxt').textContent = ledgerText(); }, 1000);
  $('ledger').addEventListener('toggle', () => { if ($('ledger').open) $('ledgertxt').textContent = ledgerText(); });
  $('ledgercopy').addEventListener('click', async ev => {
    ev.preventDefault();             // it sits in the summary: don't open or close the box
    try { await navigator.clipboard.writeText(ledgerText()); $('ledgercopy').textContent = 'Copied'; } catch (_) { $('ledgercopy').textContent = 'Couldn’t copy'; }
    setTimeout(() => { $('ledgercopy').textContent = 'Copy'; }, 1500);
  });
  window.__assistLedger = ledgerText;
  function asrStatus(text, kind) { $('asrstate').textContent = text; $('asrstate').className = 'hint ' + (kind || ''); }
  function asrBacklog() {
    const n = asr ? asr.backlog() : 0;
    if (asr && asr.ready()) asrStatus(`Transcribing on this computer (Whisper ${model}, ${asr.device === 'webgpu' ? 'graphics chip' : 'processor: slower'})` + (n > 2 ? ` · ${n} phrases waiting: try a smaller model` : ''), n > 2 ? 'warn' : 'ok');
  }

  async function startListening() {
    listening = true;
    listenSince = Date.now();
    renderListen();
    if (cam !== 'off') await startCam();   // first: sharing a screen needs the click, still fresh
    try {
      await audio.start($('mic').value || undefined);
      fillMics();
    } catch (err) {
      listening = false; listenSince = null; stopCam(); renderListen();
      return asrStatus(err && err.name === 'NotAllowedError' ? 'The microphone was blocked. Allow it for this page (the icon in the address bar), then Start listening again.' : 'No microphone: ' + ((err && err.message) || err), 'bad');
    }
    if (engine === 'whisper') {
      if (!asr) {
        asr = AssistASR.create({ model, onStatus: asrStatus, onResult: r => { r.chunks.forEach(c => hear(c.at, c.text, c.to)); asrBacklog(); } });
        asr.load();
      } else asrBacklog();
    } else startBrowserSpeech();
  }
  function stopListening() {
    listening = false; listenSince = null;
    audio.stop();
    stopCam();
    $('level').style.width = '0';
    if (rec) try { rec.stop(); } catch (_) { /* not started */ }
    asrStatus(asr && asr.backlog() ? 'Stopped: the phrases already heard are still being transcribed.' : '');
    renderListen();
  }

  function startBrowserSpeech() {
    heard = {};
    rec = new SRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = ev => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i], text = r[0].transcript;
        if (!heard[i]) heard[i] = Date.now() - LEAD_MS;            // when this phrase began, near enough
        if (r.isFinal) { hear(heard[i], text, Date.now() - LEAD_MS); interim = null; }
        else interim = { at: heard[i], text: text.trim() };
      }
      renderInterim();
    };
    rec.onerror = ev => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { stopListening(); asrStatus('The browser’s speech service was blocked.', 'bad'); }
    };
    // It stops by itself now and then (silence, a network hiccup): carry on while listening
    rec.onend = () => {
      interim = null; renderInterim(); heard = {};
      if (listening && engine === 'browser') setTimeout(() => { if (listening && engine === 'browser') try { rec.start(); } catch (_) { /* already started */ } }, 250);
    };
    try { rec.start(); } catch (_) { /* already started */ }
    asrStatus('Transcribing with the browser’s speech service', 'ok');
  }

  async function fillMics() {
    try {
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default');
      const sel = $('mic'), want = store.get(MIC) || '';
      sel.innerHTML = '<option value="">Default</option>' + list.map(d => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Microphone')}</option>`).join('');
      sel.value = list.some(d => d.deviceId === want) ? want : '';
    } catch (_) { /* no devices */ }
  }
  $('mic').addEventListener('change', () => {
    store.set(MIC, $('mic').value);
    if (listening) { stopListening(); startListening(); }
  });
  $('engine').addEventListener('change', () => {
    engine = $('engine').value;
    store.set(ENGINE, engine);
    if (rec) try { rec.stop(); } catch (_) { /* not started */ }
    if (listening) { stopListening(); startListening(); }
    renderEngine();
  });
  $('model').addEventListener('change', () => {
    model = $('model').value;
    store.set(MODEL, model);
    if (asr) { asr.stop(); asr = null; }
    if (listening && engine === 'whisper') { asr = AssistASR.create({ model, onStatus: asrStatus, onResult: r => { r.chunks.forEach(c => hear(c.at, c.text, c.to)); asrBacklog(); } }); asr.load(); }
  });
  function renderEngine() {
    $('engine').value = engine;
    $('engine').querySelector('[value=browser]').disabled = !SRec;
    $('model').innerHTML = Object.entries(AssistASR.MODELS).map(([k, m]) => `<option value="${k}">${k.replace('.en', '')} (English, ${'gpu' in navigator ? m.gpu : m.cpu})</option>`).join('');
    $('model').value = model;
    $('modelbox').hidden = engine !== 'whisper';
    $('srnote').textContent = engine === 'whisper'
      ? 'Whisper runs in this browser, best on a computer with a graphics chip (Chrome or Edge). The model is fetched once, then kept. Nothing you record leaves this computer, and each line’s time is where it is in the recording.'
      : 'The browser sends the audio to its maker’s service (Google or Microsoft) to be transcribed; lines are timed when their words come back, so allow a second or so.';
  }
  // The last 15 minutes can be played back: ▶ on a line, or the timer's start
  function playAt(ms, durMs) { if (!audio.play(ms, durMs)) asrStatus('That’s no longer in the recording (it holds the last 15 minutes while listening).', 'warn'); }
  $('hearstart').addEventListener('click', () => { if (startLocal != null) playAt(startLocal - 3000, 10000); });
  setInterval(() => { $('hearstart').hidden = !held(startLocal); if (listening && engine === 'whisper') asrBacklog(); }, 1000);
  const held = ms => { const h = audio.held(); return !!h && ms != null && ms >= h.from && ms <= h.to; };
  $('listen').addEventListener('click', () => (listening ? stopListening() : startListening()));
  let clearArmed = 0;                  // two clicks within 3 s
  $('clear').addEventListener('click', () => {
    if (Date.now() - clearArmed > 3000) { clearArmed = Date.now(); $('clear').textContent = 'Sure? Click again'; setTimeout(() => { $('clear').textContent = 'Clear'; }, 3000); return; }
    clearArmed = 0; $('clear').textContent = 'Clear';
    lines.length = 0; frames.splice(0).forEach(f => URL.revokeObjectURL(f.url)); armed = null; Store.clear(); renderLog();
  });
  $('save').addEventListener('click', () => {
    const rows = lines.map(l => ({ at: l.at, s: `${clockOf(l.at)}\t${l.item ? '[' + l.item + '] ' : ''}${l.text}` }))
      .concat(markers().map(k => ({ at: k.at, s: `${clockOf(k.at)}\t[${k.label} started]` })));
    const text = rows.sort((a, b) => a.at - b.at).map(r => r.s).join('\n') + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'transcript ' + new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.') + '.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  // A line clicked asks first ("Started here? Move the start 0:42 later"), then sends the move
  $('log').addEventListener('click', ev => {
    const act = ev.target.closest('button[data-act]');
    if (act && act.dataset.act === 'play') {
      const i = Number(act.closest('.ln').dataset.i), l = lines[i], nx = lines[i + 1];
      playAt(l.at - 300, Math.min(12000, Math.max(3000, nx ? nx.at - l.at + 300 : 6000)));
      return;
    }
    if (act) {
      const l = armed;
      armed = null;
      if (act.dataset.act === 'move' && l && startLocal != null) shift(l.at - startLocal, moveWhole());
      renderLog();
      return;
    }
    const th = ev.target.closest('img.th');
    if (th) { $('bigimg').src = th.src; $('bigcap').textContent = clockOf(Number(th.dataset.at)) + (startLocal != null ? ' · ' + mmss(Number(th.dataset.at) - startLocal) + ' from the start' : ''); $('big').hidden = false; return; }
    const row = ev.target.closest('.ln[data-i]');
    if (!row || row.classList.contains('far') || ev.target.closest('.mk')) return;
    const l = lines[Number(row.dataset.i)];
    armed = armed === l ? null : l;
    renderLog();
  });

  // The live marker dragged onto a line: the start moves there (no question: the drag is the
  // decision; Undo here and on the timer). Redrawing waits while a drag is on.
  let dragging = false;
  const dropRow = ev => { const r = ev.target.closest && ev.target.closest('.ln[data-i]'); return r && !r.classList.contains('far') ? r : null; };
  const clearOver = () => $('log').querySelectorAll('.ln.over').forEach(r => r.classList.remove('over'));
  $('log').addEventListener('dragstart', ev => {
    if (!ev.target.closest || !ev.target.closest('.mk.drag')) return;
    dragging = true; armed = null;
    ev.dataTransfer.setData('text/plain', 'timer start');
    ev.dataTransfer.effectAllowed = 'move';
    $('log').classList.add('dragging');
  });
  $('log').addEventListener('dragover', ev => {
    const row = dragging && dropRow(ev);
    if (!row) return;
    ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
    if (!row.classList.contains('over')) { clearOver(); row.classList.add('over'); }
  });
  $('log').addEventListener('drop', ev => {
    const row = dragging && dropRow(ev);
    if (!row) return;
    ev.preventDefault();
    const l = lines[Number(row.dataset.i)];
    if (l && startLocal != null) shift(l.at - startLocal, moveWhole());
  });
  $('log').addEventListener('dragend', () => { dragging = false; clearOver(); $('log').classList.remove('dragging'); logSig = ''; renderLog(); });

  // ─── Drawing ─────────────────────────────────────────────────────────────

  // What the timer knows happened, on this computer's clock: the run sheet's actual starts (the
  // last one is live while it's the timer's start: draggable), or outside run sheet mode the timer's start
  const hm = ms => { const d = new Date(ms); return two(d.getHours()) + ':' + two(d.getMinutes()); };
  function markers() {
    if (offset == null) return [];
    const out = rsLog.map(x => {
      const late = x.p != null ? x.a - x.p : null;
      return { at: x.a - offset, label: [x.p != null ? hm(x.p) : '', x.e ? (x.n || 'Finish') : x.n, late == null ? '' : mmss(late)].filter(Boolean).join(' '),
        cls: late == null || Math.abs(late) < 30000 ? '' : late > 0 ? ' late' : ' early', fin: !!x.e };
    });
    const last = out[out.length - 1];
    if (last && !last.fin && startLocal != null && Math.abs(last.at - startLocal) < 1500) last.live = true;
    if (!rsLog.length && startLocal != null) out.push({ at: startLocal, label: 'Timer start', cls: '', live: true });
    return out.filter(k => k.live || k.at >= Date.now() - KEEP_MS);
  }
  const chip = k => `<span class="mk${k.cls}${k.live && allowed === 'yes' ? ' drag" draggable="true" title="Drag onto the line where the speaker really began' : '" title="'}">⏱ ${esc(k.label)}</span>`;


  function renderListen() {
    $('listen').textContent = listening ? 'Stop listening' : 'Start listening';
    $('listenstate').textContent = listening ? 'Listening' : 'Not listening';
    $('listenstate').className = listening ? 'on' : '';
  }

  function renderTimer() {
    const online = !!(ws && ws.readyState === WebSocket.OPEN && hostOnline && peer);
    $('item').textContent = online ? state.rsNow || (state.rsOn ? '' : 'Countdown') : '';
    const r = $('remain');
    r.textContent = online && state.remain ? (state.over ? '+' : '') + state.remain : '–:––';
    r.className = !online ? '' : state.over ? 'over' : state.impending ? 'impending' : state.paused ? 'paused' : '';
    $('started').textContent = startLocal != null && online ? 'Started ' + clockOf(startLocal) + ' (this computer’s clock)' : '';
  }

  function renderAll() {
    renderTimer();
    const t = $('allowtext');
    t.className = 'hint';
    t.textContent = {
      yes: 'Allowed: click the line where the speaker began to move the start there.',
      asked: 'Asked: waiting for the timer’s operator to allow it (in the timer’s share panel).',
      refused: 'The timer’s operator said no.',
      stopped: 'The timer’s operator stopped this station moving starts.',
    }[allowed] || 'Seeing the timer. To move its start from here, the timer’s operator has to allow it.';
    $('ask').hidden = allowed === 'yes' || allowed === 'asked';
    $('mode').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.m === (moveWhole() ? 'whole' : 'start')); b.disabled = !!rsShift; });
    $('modewhy').textContent = rsShift ? 'Set by the run sheet: ' + rsShift.why : '';
    renderLog();
  }

  let logSig = '';
  function renderLog(follow) {
    const box = $('log');
    const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    const mks = markers();
    const last = lines[lines.length - 1];
    const tail = listening && last && Date.now() - last.to > GAP_MS ? last.to : null;   // a pause going on now
    const h = audio.held(), sig = [lines.length, lines.length && lines[0].at, startLocal, allowed, moveWhole(), armed && armed.at, h && Math.floor(h.from / 10000), JSON.stringify(mks),
      frames.length, frames.length && frames[0].id + '/' + frames[frames.length - 1].id, tail != null && Math.floor((Date.now() - tail) / 10000)].join('|');
    if (sig !== logSig && !dragging) {
      logSig = sig;
      const out = [];
      // Each marker goes at the end of the line being spoken when it happened (within 20 s), else on its own row
      const on = new Map(), alone = [];
      mks.forEach(k => {
        let j = -1;
        for (let i = 0; i < lines.length && lines[i].at <= k.at + 250; i++) j = i;
        if (j >= 0 && k.at - lines[j].at < 20000) { if (!on.has(j)) on.set(j, []); on.get(j).push(k); } else alone.push(k);
      });
      const aloneRow = k => `<div class="mkrow"><span class="t">${clockOf(k.at)}</span><span></span><span>${chip(k)}</span></div>`;
      // Each picture shows with the row its time falls in: a pause (from its start) or a line
      const starts = [];
      lines.forEach((l, i) => { if (l.gapFrom != null) starts.push({ at: l.gapFrom, key: 'g' + i }); starts.push({ at: l.at, key: 'l' + i }); });
      if (tail != null) starts.push({ at: tail, key: 'tail' });
      starts.sort((a, b) => a.at - b.at);
      const pics = new Map();
      frames.forEach(f => {
        let key = 'before';
        for (const st of starts) { if (st.at <= f.at + 250) key = st.key; else break; }
        const li = key[0] === 'l' ? Number(key.slice(1)) : -1;     // a pause's closing picture can land just after the words start
        if (li >= 0 && f.why === 'gap' && lines[li].gapFrom != null && f.at - lines[li].at < 1500) key = 'g' + li;
        if (!pics.has(key)) pics.set(key, []);
        pics.get(key).push(f);
      });
      const strip = key => (pics.has(key) ? `<span class="thumbs">${pics.get(key).map(f => `<img class="th${f.why === 'gap' ? ' edge' : ''}" src="${f.url}" data-at="${f.at}" alt="" title="${clockOf(f.at)}${f.why === 'gap' ? ' (an end of the pause)' : ''}">`).join('')}</span>` : '');
      const span = ms => { const x = Math.round(ms / 1000); return x < 60 ? x + ' s' : Math.floor(x / 60) + ':' + two(x % 60); };
      const gapRow = (from, to, key) => `<div class="gap"><span class="t">${clockOf(from)}</span><span class="o"></span><span class="gx"><span class="gl">${span(to - from)} without speech${key === 'tail' ? ' so far' : ''}</span>${strip(key)}</span></div>`;
      if (pics.has('before')) out.push(`<div class="gap"><span class="t">${clockOf(pics.get('before')[0].at)}</span><span class="o"></span><span class="gx"><span class="gl">Before the transcript</span>${strip('before')}</span></div>`);
      lines.forEach((l, i) => {
        while (alone.length && alone[0].at < l.at) out.push(aloneRow(alone.shift()));
        if (l.gapFrom != null) out.push(gapRow(l.gapFrom, l.at, 'g' + i));
        const off = startLocal == null ? null : l.at - startLocal;
        const far = off == null || Math.abs(off) > REACH_MS || allowed !== 'yes';
        const cls = off == null ? '' : Math.abs(off) < 1000 ? 'zero' : off > 0 ? 'late' : 'early';
        out.push(`<div class="ln${far ? ' far' : ''}${armed === l ? ' armed' : ''}" data-i="${i}"><span class="t">${clockOf(l.at)}</span><span class="o ${cls}">${off == null || Math.abs(off) > REACH_MS ? '' : Math.abs(off) < 1000 ? 'start' : mmss(off)}</span><span class="x"><span>${esc(l.text)}${(on.get(i) || []).map(chip).join('')}${strip('l' + i)}</span>${held(l.at) ? '<button class="play" data-act="play" title="Hear it">▶</button>' : ''}</span>` +
          (armed === l ? `<div class="ask">Started here? Move the start ${mmss(off).slice(1)} ${off > 0 ? 'later' : 'earlier'}${moveWhole() ? ' (and the end with it)' : ' (the end stays)'}.
            <button data-act="move" class="primary">Move it</button><button data-act="cancel">Cancel</button></div>` : '') + '</div>');
      });
      alone.forEach(k => out.push(aloneRow(k)));
      if (tail != null) out.push(gapRow(tail, Date.now(), 'tail'));
      box.innerHTML = out.join('') + '<div id="interim"></div>';
    }
    renderInterim();
    if ((follow && atEnd) || follow === 'force') box.scrollTop = box.scrollHeight;
  }
  function renderInterim() {
    const el = document.getElementById('interim');
    if (!el) return;
    el.innerHTML = interim && interim.text ? `<div class="ln interim far"><span class="t">${clockOf(interim.at)}</span><span class="o"></span><span class="x">${esc(interim.text)}…</span></div>` : '';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Last, once everything above exists (a saved link connects straight away)
  renderListen();
  renderEngine();
  if (link.r && link.v) start();
  else showEnter();
})();
