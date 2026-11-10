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
 * everything playing. Follow the timer off: cues only play when ▶ is pressed.
 *
 * localStorage: playout_saved_link, playout_server, playout_token_<room>, playout_follow ('0' = off),
 * playout_cues_<room> ({itemId: [{id, name, media, trigger, at}]}); the files are in IndexedDB
 * (video-store.js) as 'pocue:<cue id>'.
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
  const cuesKey = () => 'playout_cues_' + link.r;

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
    cues = (() => { try { return JSON.parse(store.get(cuesKey()) || '{}') || {}; } catch (_) { return {}; } })();
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
    if (show.run < was.run) stopAll();                 // Back: everything playing stops
    const key = show.cur ? show.run + ':' + show.cur : null;
    if (key !== runSeen) {
      runSeen = key;
      fired.clear();
      prevCond = new Map();
      // A new item started: its start cues play, unless it started a while before we heard
      if (key && show.run > was.run && sinceStart() < LATE_START_MS) fireWhere(c => c.trigger === 'start');
      primeTimeCues();
    }
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
    if (!show.cur || show.fin) return;
    const cd = countdown();
    for (const c of curCues()) {
      if (c.trigger === 'start') continue;
      const now = condition(c, cd), before = prevCond.get(c.id);
      prevCond.set(c.id, now);
      if (now && before === false) fireWhere(x => x.id === c.id);
    }
    renderNow(cd);
  }
  (function ticker(fn, ms) {                           // a worker's tick: keeps time in a background window
    try {
      const w = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},' + ms + ');'], { type: 'text/javascript' })));
      w.onmessage = fn; return;
    } catch (_) { /* no workers */ }
    setInterval(fn, ms);
  })(tick, 100);

  // ─── Playing (on this computer) ───────────────────────────────────────────
  const playing = new Map();                           // cue id → {el, url}
  async function play(c) {
    let blob = null;
    try { blob = await window.videoStore.get('pocue:' + c.id); } catch (_) { /* missing */ }
    if (!blob) { status('The file for “' + c.name + '” isn’t in this browser any more. Add the cue again.', 'warn'); return; }
    stopCue(c.id);
    const url = URL.createObjectURL(blob);
    let el;
    if (c.media === 'video') {
      for (const [id, p] of playing) if (p.video) stopCue(id);    // one video on the output at a time
      el = $('vid');
      el.src = url;
      $('stage').querySelector('.idle').hidden = true;
    } else {
      el = new Audio(url);
    }
    const p = { el, url, video: c.media === 'video' };
    playing.set(c.id, p);
    el.onended = () => stopCue(c.id);
    try { await el.play(); } catch (err) { status('The browser didn’t let “' + c.name + '” play: click anywhere on this page once.', 'warn'); stopCue(c.id); }
    render();
  }
  function stopCue(id) {
    const p = playing.get(id);
    if (!p) return;
    playing.delete(id);
    p.el.pause();
    if (p.video) { p.el.removeAttribute('src'); p.el.load(); $('stage').querySelector('.idle').hidden = false; }
    URL.revokeObjectURL(p.url);
    render();
  }
  function stopAll() { for (const id of [...playing.keys()]) stopCue(id); }

  // ─── Cues (made here, kept here) ──────────────────────────────────────────
  const TRIGGERS = { start: 'At the start', end: 'When time’s up', elapsed: 'After', remaining: 'With … left' };
  const whenText = c => c.trigger === 'elapsed' ? 'After ' + mmss(c.at) : c.trigger === 'remaining' ? 'With ' + mmss(c.at) + ' left' : TRIGGERS[c.trigger];
  function saveCues() { store.set(cuesKey(), JSON.stringify(cues)); }
  async function addCue(itemId, file, trigger, at) {
    if (!file || !/^(audio|video)\//.test(file.type)) { alert('Choose an audio or video file.'); return; }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try { await window.videoStore.put('pocue:' + id, file); } catch (err) { alert('Couldn’t keep the file in this browser: ' + (err && err.message || err)); return; }
    (cues[itemId] = cues[itemId] || []).push({ id, name: file.name.slice(0, 200), media: file.type.startsWith('video/') ? 'video' : 'audio', trigger, at: at || 0 });
    saveCues();
    if (itemId === show.cur) primeTimeCues();          // added during its item: only from now on
    render();
  }
  function removeCue(itemId, id) {
    stopCue(id);
    cues[itemId] = (cues[itemId] || []).filter(c => c.id !== id);
    if (!cues[itemId].length) delete cues[itemId];
    saveCues();
    window.videoStore.remove('pocue:' + id).catch(() => {});
    render();
  }

  // ─── Page ─────────────────────────────────────────────────────────────────
  function render() {
    document.body.classList.toggle('manual', !following());
    const items = show.items;
    $('rshint').textContent = !show.on ? 'The timer isn’t in run sheet mode' : show.fin ? 'The show has finished' : '';
    const curIdx = items.findIndex(x => x.id === show.cur);
    const open = document.activeElement && document.activeElement.closest('form.addcue');
    if (open) return;                                  // don't rebuild under someone adding a cue
    $('items').innerHTML = items.map((it, i) => {
      const list = cues[it.id] || [];
      return `<li data-id="${esc(it.id)}" class="${i === curIdx ? 'now' : curIdx >= 0 && i < curIdx ? 'done' : ''}">` +
        `<div class="ihead"><span class="iname">${esc(it.n || '(no name)')}</span>${i === curIdx ? '<span class="itag">now</span>' : ''}` +
        `<span class="idur">${it.e ? 'finish' : it.d ? mmss(it.d) : ''}</span>${it.e ? '' : '<button class="small" data-act="add">+ cue</button>'}</div>` +
        (list.length ? '<ul class="cues">' + list.map(c => `<li data-cue="${esc(c.id)}" class="${i === curIdx && fired.has(c.id) ? 'fired' : ''}${playing.has(c.id) ? ' playing' : ''}">` +
          `<button class="small" data-act="${playing.has(c.id) ? 'stop' : 'fire'}" title="${playing.has(c.id) ? 'Stop' : 'Play it now (on this computer)'}">${playing.has(c.id) ? '■' : '▶'}</button>` +
          `<span class="when">${esc(whenText(c))}</span><span class="fname">${c.media === 'video' ? '🎞' : '🎵'} ${esc(c.name)}</span>` +
          `<button class="small" data-act="del" title="Remove this cue">✕</button></li>`).join('') + '</ul>' : '') +
        '</li>';
    }).join('') || '<li class="hint">No run sheet yet: the timer sends it when it has one.</li>';
    renderNow(countdown());
  }
  function renderNow(cd) {
    const it = show.items.find(x => x.id === show.cur);
    $('now').innerHTML = it && cd ? `Now: <b>${esc(it.n)}</b> · ${cd.remain >= 0 ? mmss(cd.remain / 1000) + ' left' : 'over by ' + mmss(-cd.remain / 1000)}` : '';
  }
  $('items').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const li = b.closest('li[data-id]'), itemId = li && li.dataset.id;
    const cueId = b.closest('li[data-cue]') && b.closest('li[data-cue]').dataset.cue;
    const c = cueId && (cues[itemId] || []).find(x => x.id === cueId);
    if (b.dataset.act === 'fire' && c) play(c);        // by hand: always, followed or not
    else if (b.dataset.act === 'stop' && c) stopCue(c.id);
    else if (b.dataset.act === 'del' && c) { if (confirm('Remove the cue “' + c.name + '”?')) removeCue(itemId, c.id); }
    else if (b.dataset.act === 'add') addForm(li);
  });
  function addForm(li) {
    if (li.querySelector('form.addcue')) return;
    const f = document.createElement('form');
    f.className = 'addcue';
    f.innerHTML = `<select name="trigger">${Object.entries(TRIGGERS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>` +
      '<input type="text" name="at" placeholder="m:ss" hidden aria-label="Time">' +
      '<input type="file" name="file" accept="audio/*,video/*">' +
      '<button class="small primary">Add</button><button type="button" class="small" data-x>Cancel</button>';
    li.appendChild(f);
    const trig = f.querySelector('[name=trigger]'), at = f.querySelector('[name=at]');
    trig.addEventListener('change', () => { at.hidden = trig.value !== 'elapsed' && trig.value !== 'remaining'; });
    f.querySelector('[data-x]').addEventListener('click', () => { f.remove(); render(); });
    f.addEventListener('submit', e => {
      e.preventDefault();
      const file = f.querySelector('[name=file]').files[0];
      let secs = 0;
      if (!at.hidden) { secs = readSecs(at.value); if (secs == null) { alert('Type the time as m:ss (or h:mm:ss).'); return; } }
      f.remove();
      addCue(li.dataset.id, file, trig.value, secs);
    });
  }
  $('follow').checked = following();
  $('follow').addEventListener('change', e => { store.set(FOLLOW, e.target.checked ? '1' : '0'); if (e.target.checked) primeTimeCues(); render(); });
  $('stopall').addEventListener('click', stopAll);
  const toggleFull = () => { if (document.fullscreenElement) document.exitFullscreen(); else $('stage').requestFullscreen().catch(() => {}); };
  $('full').addEventListener('click', toggleFull);
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.target.closest('input, select, textarea')) return;
    if (e.key === 'f' || e.key === 'F') toggleFull();
  });
  $('unpair').addEventListener('click', () => {
    if (!confirm('Unpair this computer from the timer? Its cues stay here.')) return;
    store.del(SAVED_LINK);
    if (link.r) store.del(tokenKey(link.r));
    location.reload();
  });

  // Test hooks: what's playing, and the cues
  window.__playout = { playing: () => [...playing.keys()], cues: () => cues, show: () => show, fired: () => [...fired] };

  if (link.r && link.v) start(); else showEnter();
})();
