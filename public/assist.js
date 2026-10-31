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
 * localStorage: assist_saved_link, assist_server, assist_token_<room>, assist_mode (whole | start),
 *   assist_lines (the transcript, JSON [{at, text, item}], so a reload keeps it; Clear empties it),
 *   assist_engine (whisper | browser), assist_model (tiny.en | base.en | small.en), assist_mic (device id)
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
      startLocal = m.at - (m.now - Date.now());
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
  $('mode').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-m]');
    if (!b) return;
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

  const LINES = 'assist_lines';
  const lines = (() => { try { const l = JSON.parse(store.get(LINES) || '[]'); return Array.isArray(l) ? l.filter(x => x && Number.isFinite(x.at) && typeof x.text === 'string') : []; } catch (_) { return []; } })();
  let interim = null, armed = null;    // armed: the line asked "started here?"
  let saveTimer = null;
  const saveLines = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set(LINES, JSON.stringify(lines)), 500); };
  function hear(at, text) {
    text = String(text || '').trim();
    if (!text) return;
    lines.push({ at, text, item: String(state.rsNow || '') });
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
    saveLines();
    renderLog(true);
  }
  window.__assistHear = (text, agoMs) => hear(Date.now() - (agoMs || 0), text);   // tests (and other engines)

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
    onSegment: seg => { if (asr && engine === 'whisper') { asr.add({ at: audio.wallOf(seg.from), audio: seg.audio }); asrBacklog(); } },
  });
  function asrStatus(text, kind) { $('asrstate').textContent = text; $('asrstate').className = 'hint ' + (kind || ''); }
  function asrBacklog() {
    const n = asr ? asr.backlog() : 0;
    if (asr && asr.ready()) asrStatus(`Transcribing on this computer (Whisper ${model}, ${asr.device === 'webgpu' ? 'graphics chip' : 'processor: slower'})` + (n > 2 ? ` · ${n} phrases waiting: try a smaller model` : ''), n > 2 ? 'warn' : 'ok');
  }

  async function startListening() {
    listening = true;
    renderListen();
    try {
      await audio.start($('mic').value || undefined);
      fillMics();
    } catch (err) {
      listening = false; renderListen();
      return asrStatus(err && err.name === 'NotAllowedError' ? 'The microphone was blocked. Allow it for this page (the icon in the address bar), then Start listening again.' : 'No microphone: ' + ((err && err.message) || err), 'bad');
    }
    if (engine === 'whisper') {
      if (!asr) {
        asr = AssistASR.create({ model, onStatus: asrStatus, onResult: r => { r.chunks.forEach(c => hear(c.at, c.text)); asrBacklog(); } });
        asr.load();
      } else asrBacklog();
    } else startBrowserSpeech();
  }
  function stopListening() {
    listening = false;
    audio.stop();
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
        if (r.isFinal) { hear(heard[i], text); interim = null; }
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
    if (listening && engine === 'whisper') { asr = AssistASR.create({ model, onStatus: asrStatus, onResult: r => { r.chunks.forEach(c => hear(c.at, c.text)); asrBacklog(); } }); asr.load(); }
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
    lines.length = 0; armed = null; store.del(LINES); renderLog();
  });
  $('save').addEventListener('click', () => {
    const text = lines.map(l => `${clockOf(l.at)}\t${l.item ? '[' + l.item + '] ' : ''}${l.text}`).join('\n') + '\n';
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
      if (act.dataset.act === 'move' && l && startLocal != null) shift(l.at - startLocal, mode === 'whole');
      renderLog();
      return;
    }
    const row = ev.target.closest('.ln[data-i]');
    if (!row || row.classList.contains('far')) return;
    const l = lines[Number(row.dataset.i)];
    armed = armed === l ? null : l;
    renderLog();
  });

  // ─── Drawing ─────────────────────────────────────────────────────────────

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
    $('mode').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
    renderLog();
  }

  let logSig = '';
  function renderLog(follow) {
    const box = $('log');
    const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    const h = audio.held(), sig = [lines.length, lines.length && lines[0].at, startLocal, allowed, mode, armed && armed.at, h && Math.floor(h.from / 10000)].join('|');
    if (sig !== logSig) {
      logSig = sig;
      const out = [];
      let item = null;
      lines.forEach((l, i) => {
        if (l.item !== item) { item = l.item; if (item) out.push(`<div class="divider">${esc(item)}</div>`); }
        const off = startLocal == null ? null : l.at - startLocal;
        const far = off == null || Math.abs(off) > REACH_MS || allowed !== 'yes';
        const cls = off == null ? '' : Math.abs(off) < 1000 ? 'zero' : off > 0 ? 'late' : 'early';
        out.push(`<div class="ln${far ? ' far' : ''}${armed === l ? ' armed' : ''}" data-i="${i}"><span class="t">${clockOf(l.at)}</span><span class="o ${cls}">${off == null || Math.abs(off) > REACH_MS ? '' : Math.abs(off) < 1000 ? 'start' : mmss(off)}</span><span class="x"><span>${esc(l.text)}</span>${held(l.at) ? '<button class="play" data-act="play" title="Hear it">▶</button>' : ''}</span>` +
          (armed === l ? `<div class="ask">Started here? Move the start ${mmss(off).slice(1)} ${off > 0 ? 'later' : 'earlier'}${mode === 'whole' ? ' (and the end with it)' : ' (the end stays)'}.
            <button data-act="move" class="primary">Move it</button><button data-act="cancel">Cancel</button></div>` : '') + '</div>');
      });
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
