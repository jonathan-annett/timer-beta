/*!
 * manage.js
 * The management console for multi-room events (manage.html, the /m shortcut on the hosted site; a trial:
 * TimerFeatures.manage, alpha only until fully tested). The owner's design, 13–15 Nov 2026: docs/manage-plan.md.
 *
 *  - One event per session: manage.html#e=<id>. Everything is kept under manage_<id>_… (the event's name,
 *    its rooms, its own pairing room and approved phones), and a Web Lock (manage-<id>) lets one tab hold it.
 *    A plain manage.html resumes the last session (manage_last); "New event in another window" starts one.
 *    (A second event normally means a second laptop, but never say never: the owner.)
 *  - Its own pairing room (manage-host.js): the admin phone (manage-phone.html) pairs with the admin key and
 *    adds rooms (name-check, add-room).
 *  - Each room's timer: a link of its own (roomLink), joined with the room's view-only key and the
 *    management token the room gave (remote-control.js answerManage). Read only: the countdown and the run
 *    sheet as the timer pushes them to any device (state, with the countdown anchor and rs_list).
 *  - The room's name is the console's: unique here (case and spaces ignored), sent to the timer (mg-name),
 *    which shows it on the operator's screen.
 * MIT Licensed
 */

/* global RemotePeer, RemoteClock, RunsheetCore, ManageHost, TimerNotices */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const TITLE = 'Management console';
  if (location.hostname) document.title = location.hostname + ' - ' + TITLE;
  if (window.TimerFeatures && !TimerFeatures.manage) {
    document.body.innerHTML = '<main style="padding:24px"><h1>' + TITLE + '</h1><p>The management console isn’t available on this site.</p></main>';
    return;
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const C = RunsheetCore;
  const params = new URLSearchParams(location.search);
  const SERVER = params.get('remote') || RemotePeer.defaultServer();   // ?remote=wss://…: a test's (or another) pairing server
  const nameKey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const cleanName = s => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) : '');

  // ─── The session ──────────────────────────────────────────────────────────
  const newId = () => ManageHost.randomString(10, 'abcdefghijkmnpqrstuvwxyz23456789');
  const ID_RE = /^[a-z0-9]{6,16}$/;
  const hash = new URLSearchParams(location.hash.slice(1));
  let sid = ID_RE.test(hash.get('e') || '') ? hash.get('e') : null;
  try { if (!sid && ID_RE.test(localStorage.getItem('manage_last') || '')) sid = localStorage.getItem('manage_last'); } catch (_) { /* private mode */ }
  if (!sid) sid = newId();
  history.replaceState(null, '', location.pathname + location.search + '#e=' + sid);
  try { localStorage.setItem('manage_last', sid); } catch (_) { /* private mode */ }
  const P = 'manage_' + sid + '_';
  const store = {
    get: k => { try { return JSON.parse(localStorage.getItem(P + k)); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch (_) { /* full, private mode */ } },
    del: k => { try { localStorage.removeItem(P + k); } catch (_) { /* private mode */ } },
  };
  const openSession = (id, here) => {
    const u = location.pathname + location.search + '#e=' + id;
    if (here) { location.href = u; location.reload(); } else window.open(u, '_blank');
  };
  $('btnnew').addEventListener('click', () => openSession(newId(), false));
  $('taken-new').addEventListener('click', () => openSession(newId(), true));

  // One tab per session: the second sees "open in another tab"
  if (navigator.locks && navigator.locks.request) {
    navigator.locks.request('manage-' + sid, { ifAvailable: true }, lock => {
      if (!lock) { $('taken').hidden = false; return null; }
      start();
      return new Promise(() => {});                // held while this tab lives
    });
  } else start();

  // ─── Rooms ────────────────────────────────────────────────────────────────
  // [{id, name, frag, token, added}]: frag = the room's view-only link (r, v, s), token = its grant
  const rooms = () => (Array.isArray(store.get('rooms')) ? store.get('rooms') : []);
  const saveRooms = list => store.set('rooms', list);
  const links = new Map();                         // room id → its link
  const nameTaken = (name, exceptId) => rooms().some(r => r.id !== exceptId && nameKey(r.name) === nameKey(name));
  const eventName = () => store.get('event') || '';

  function roomLink(room) {
    const f = new URLSearchParams(room.frag);
    const L = { id: room.id, state: {}, status: 'connecting', ws: null, peer: null, retry: 1000, timer: null, stopped: false, hostOnline: false, mode: 'server' };
    L.clock = RemoteClock.create(v => { Object.assign(L.state, v); renderSoon(); });
    const relay = msg => { if (L.ws && L.ws.readyState === WebSocket.OPEN) L.ws.send(JSON.stringify({ type: 'up', msg })); };
    function hello() {
      const r = rooms().find(x => x.id === L.id);
      if (L.peer && r) L.peer.send({ t: 'hello', client: 'manage', token: r.token, clock: 1 });
    }
    function newPeer() {
      if (L.peer) L.peer.close();
      L.peer = RemotePeer.create({ initiator: false, relay, onMessage, onModeChange: m => { L.mode = m; renderSoon(); } });
      hello();
    }
    function onMessage(m) {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'state' && m.s && typeof m.s === 'object') {
        if (m.full) for (const k of Object.keys(L.state)) delete L.state[k];
        Object.assign(L.state, m.s);
        if ('words' in m.s && window.TimerNotices) L.clock.words(TimerNotices.words(m.s.words || {}));
        if (m.s.clk) L.clock.set(m.s.clk);
        if (L.clock.active) Object.assign(L.state, L.clock.values());
        L.status = 'ok';
        renderSoon();
      } else if (m.t === 'mg-room') {
        // The timer's name for the room: the console's is the one that counts (kept unique here)
        const r = rooms().find(x => x.id === L.id);
        if (r && typeof m.name === 'string' && m.name !== r.name) L.peer.send({ t: 'mg-name', name: r.name });
      } else if (m.t === 'mg-revoked' || m.t === 'revoked') {
        L.status = 'revoked'; stop(); renderSoon();
      }
    }
    function connect() {
      clearTimeout(L.timer);
      if (L.stopped) return;
      try { L.ws = new WebSocket(RemotePeer.socketUrl(f.get('s') || SERVER, { room: f.get('r') })); RemotePeer.keepAlive(L.ws); } catch (_) { return schedule(); }
      const sock = L.ws;
      sock.onopen = () => sock.send(JSON.stringify({ type: 'join', room: f.get('r'), key: f.get('v') }));
      sock.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
        if (m.type === 'joined') { L.hostOnline = m.hostOnline; L.status = m.hostOnline ? 'connecting' : 'offline'; L.retry = 1000; newPeer(); }
        else if (m.type === 'down') { if (L.peer) L.peer.receive(m.msg); }
        else if (m.type === 'host-offline') { L.hostOnline = false; L.status = 'offline'; L.since = Date.now(); if (L.peer) L.peer.close(); L.peer = null; }
        else if (m.type === 'host-online') { L.hostOnline = true; L.status = 'connecting'; newPeer(); }
        else if (m.type === 'error') {
          // Gone while the room's timer is closed (it comes back with the same room), or it made a New code
          // (its links stop working: add the room again)
          if (m.reason === 'not-found' || m.reason === 'room-closed') { L.status = 'offline'; L.retry = 15000; }
        }
        renderSoon();
      };
      sock.onclose = () => {
        if (sock !== L.ws) return;
        if (L.peer) L.peer.close();
        L.peer = null;
        if (L.status === 'ok' || L.status === 'connecting') { L.status = 'offline'; L.since = Date.now(); }
        renderSoon();
        schedule();
      };
      sock.onerror = () => {};
    }
    function schedule() {
      if (L.stopped) return;
      L.timer = setTimeout(connect, L.retry);
      if (L.retry < 15000) L.retry = Math.min(L.retry * 2, 10000);
    }
    function stop() {
      L.stopped = true; clearTimeout(L.timer);
      if (L.peer) L.peer.close();
      L.peer = null;
      if (L.ws) { const s = L.ws; L.ws = null; s.close(); }
    }
    L.send = msg => { if (L.peer) L.peer.send(msg); };
    L.stop = stop;
    L.since = Date.now();
    connect();
    return L;
  }

  function addRoom(frag, token, name) {
    const f = Object.fromEntries(new URLSearchParams(typeof frag === 'string' ? frag.slice(0, 600) : ''));
    const okKey = k => typeof k === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(k);
    if (!/^[A-Za-z0-9]{6,32}$/.test(f.r || '') || !okKey(f.v) || !(f.s == null || /^wss?:\/\/[^\s#?]+$/i.test(f.s))) return 'bad-link';
    if (typeof token !== 'string' || !/^[A-Za-z0-9]{16,64}$/.test(token)) return 'bad-link';
    name = cleanName(name);
    if (!name) return 'no-name';
    if (nameTaken(name)) return 'taken';
    const list = rooms();
    // The same timer added again (its old grant revoked, say): replaces the old row
    const old = list.find(r => new URLSearchParams(r.frag).get('r') === f.r);
    if (old) { const l = links.get(old.id); if (l) l.stop(); links.delete(old.id); }
    const room = { id: newId(), name, frag: new URLSearchParams({ r: f.r, v: f.v, ...(f.s ? { s: f.s } : {}) }).toString(), token, added: Date.now() };
    saveRooms(list.filter(r => r !== old).concat(room));
    links.set(room.id, roomLink(room));
    render();
    return 'ok';
  }
  function renameRoom(id) {
    const r = rooms().find(x => x.id === id);
    if (!r) return;
    let name = prompt('Name for this room (shown on its timer too):', r.name);
    while (name !== null) {
      name = cleanName(name);
      if (name && !nameTaken(name, id)) break;
      name = prompt(name ? `There's already a room called “${name}”. Another name:` : 'The room needs a name:', name);
    }
    if (name === null) return;
    saveRooms(rooms().map(x => (x.id === id ? Object.assign({}, x, { name }) : x)));
    const l = links.get(id);
    if (l) l.send({ t: 'mg-name', name });
    render();
  }
  function removeRoom(id) {
    const r = rooms().find(x => x.id === id);
    if (!r || !confirm(`Remove “${r.name}” from this console? The room stops being monitored (it's told). To add it again, scan its code again.`)) return;
    const l = links.get(id);
    if (l) { l.send({ t: 'mg-leave' }); setTimeout(() => l.stop(), 600); }
    links.delete(id);
    saveRooms(rooms().filter(x => x.id !== id));
    if (openRoom === id) showRoom(null);
    render();
  }

  // ─── The admin phone (manage-host.js) ────────────────────────────────────
  let host = null;
  function fromPhone(d, m) {
    if (d.role !== 'admin') return;                // a dashboard (later) only watches
    const req = String(m.req || '').slice(0, 40);
    if (m.t === 'name-check') {
      const name = cleanName(m.name);
      host.send(d, { t: 'name-check', req, name, ok: !!name && !nameTaken(name) });
    } else if (m.t === 'add-room') {
      const res = addRoom(m.frag, m.token, m.name);
      host.send(d, { t: 'add-room', req, ok: res === 'ok', reason: res === 'ok' ? undefined : res, name: cleanName(m.name) });
    }
  }
  function phoneHello(d) { host.send(d, { t: 'console', event: eventName() || 'Unnamed event', rooms: rooms().length }); }

  function drawQR(box, text) {
    box.innerHTML = '';
    if (!window.QRCode) { box.textContent = text; return; }
    const tmp = document.createElement('div');
    const q = new window.QRCode(tmp, { text, width: 64, height: 64, correctLevel: window.QRCode.CorrectLevel.M });
    const m = q._oQRCode, n = m.getModuleCount(), quiet = 4, total = n + 2 * quiet, dpr = window.devicePixelRatio || 1;
    const scale = Math.max(1, Math.round(200 * dpr / total)), c = document.createElement('canvas');
    c.width = c.height = total * scale; c.style.width = c.style.height = (total * scale / dpr) + 'px';
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (m.isDark(r, col)) ctx.fillRect((col + quiet) * scale, (r + quiet) * scale, scale, scale);
    box.appendChild(c);
    const a = document.createElement('div');
    a.style.cssText = 'font-size:11px;color:#888;max-width:200px;word-break:break-all;margin-top:4px';
    a.textContent = text;
    a.id = 'addlink';
    box.appendChild(a);
  }
  let asksSig = '';
  function renderAdd() {
    if ($('add').hidden) return;
    $('hoststatus').textContent = host.status === 'ok' ? 'Ready: scan the code with a phone' : host.statusText;
    $('hoststatus').className = host.status;
    const asks = host.pending(), sig = asks.map(d => d.id).join(',');
    if (sig !== asksSig) {                         // (rebuilt only when they change: typing in one keeps its caret)
      asksSig = sig;
      $('asks').innerHTML = asks.map(d => `<div class="ask" data-id="${esc(d.id)}"><b>${esc(d.suggest || 'A phone')} wants to be this console's admin phone.</b> Type the number it shows:
        <input inputmode="numeric" maxlength="3" autocomplete="off" placeholder="###"> <button data-act="ok">Let it in</button> <button data-act="no">Refuse</button></div>`).join('');
      const box = $('asks').querySelector('input');
      if (box) box.focus();
    }
    const phones = [...host.devices.values()].filter(d => d.approved);
    $('phones').innerHTML = phones.length ? 'Admin phones: ' + phones.map(d => `<span>${esc(d.name || 'Phone')} <button data-token="${esc(d.token)}">Revoke</button></span>`).join(' · ') : '';
  }
  $('asks').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-act]'), row = b && b.closest('[data-id]');
    if (!row) return;
    if (b.dataset.act === 'ok') host.approve(row.dataset.id, row.querySelector('input').value); else host.refuse(row.dataset.id);
  });
  $('asks').addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') host.approve(ev.target.closest('[data-id]').dataset.id, ev.target.value); });
  $('phones').addEventListener('click', ev => { const b = ev.target.closest('button[data-token]'); if (b && confirm('Revoke this admin phone? It can’t add rooms any more.')) host.revoke(b.dataset.token); });
  function toggleAdd(show) {
    $('add').hidden = show === undefined ? !$('add').hidden : !show;
    if (!$('add').hidden) { drawQR($('addqr'), host.link('manage-phone.html', 'admin')); asksSig = ''; renderAdd(); }
  }
  $('btnadd').addEventListener('click', () => toggleAdd());
  $('addclose').addEventListener('click', () => toggleAdd(false));

  // ─── What a room is doing, worked out from what its timer pushes ─────────
  const clockSec = t => { const v = C.parseClock(t); return v == null || isNaN(v) ? null : v; };
  const mins = sec => Math.round(Math.abs(sec) / 60);
  function info(L) {
    const s = L.state, out = { name: '', at: '', left: '', next: '', ends: '', endsLate: '', pm: '', kind: '' };
    if (L.status === 'revoked') { out.name = 'The room stopped monitoring'; return out; }
    if (L.status !== 'ok') return out;
    out.left = s.remain || '';
    if (s.over === true || s.over === 'true') out.left = '+' + String(out.left).replace(/^-/, '');
    let list = null;
    try { list = s.rsList ? JSON.parse(s.rsList) : null; } catch (_) { list = null; }
    const rows = list && Array.isArray(list.rows) ? list.rows : [];
    if (!s.rsOn) { out.name = s.msg || 'Countdown only (no run sheet)'; return out; }
    const now = rows.find(r => r.s === 'now'), started = rows.some(r => r.s === 'done' || r.s === 'now');
    if (now) { out.name = s.rsNow || now.n; out.at = now.a || ''; }
    else if (!started) { const f = rows.find(r => !r.e && !r.c); out.name = '— not started' + (f && f.p ? ` (first ${f.p})` : ''); out.left = ''; }
    else out.name = 'Show finished';
    out.next = s.rsNext || '';
    // Show ends: the finish row's expected time (else its planned one), or the last row's start plus its length
    const end = rows.find(r => r.e), last = rows.filter(r => !r.e && !r.c).pop();
    let endSec = null, plannedSec = null;
    if (end) { endSec = clockSec(end.x || end.p); plannedSec = clockSec(end.p); }
    else if (last && list && !list.after) {
      const d = C.parseDuration(last.d);
      if (d != null && !isNaN(d)) { const x = clockSec(last.x || last.a || last.p), p = clockSec(last.p); if (x != null) endSec = x + d; if (p != null) plannedSec = p + d; }
    }
    if (endSec != null) {
      out.ends = C.formatClock(endSec);
      const dl = plannedSec == null ? 0 : C.dayDelta(plannedSec, endSec);
      if (dl >= 60) out.endsLate = '▲' + mins(dl);
    }
    const late = typeof s.rsLate === 'number' ? s.rsLate : null;
    if (late != null) {
      out.pm = Math.abs(late) < 30 ? 'on time' : late > 0 ? mins(late) + ' min behind' : mins(late) + ' min ahead';
      out.kind = Math.abs(late) < 30 ? 'ontime' : late < 0 ? 'ahead' : late > 300 ? 'late' : 'behind';
    }
    if (s.over === true || s.over === 'true') out.kind = 'late';
    return out;
  }
  const linkText = L => (L.status === 'revoked' ? '<span class="link off">revoked</span>'
    : L.status === 'offline' ? '<span class="link off">offline</span>'
    : L.status !== 'ok' ? '<span class="link">connecting…</span>' : '');
  const hm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

  // ─── Drawing ──────────────────────────────────────────────────────────────
  let queued = false, openRoom = null;
  function renderSoon() { if (!queued) { queued = true; setTimeout(() => { queued = false; render(); }, 120); } }
  function render() {
    const list = rooms().slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    $('count').textContent = list.length ? list.length + (list.length === 1 ? ' room' : ' rooms') : '';
    $('empty').hidden = !!list.length;
    $('rows').innerHTML = list.map(r => {
      const L = links.get(r.id), i = L ? info(L) : null;
      if (!L || L.status === 'offline' || L.status === 'revoked') {
        return `<tr data-id="${esc(r.id)}" class="offline"><td class="namecell"><span class="name">${esc(r.name)}</span></td><td colspan="5" class="dim">${L && L.status === 'revoked' ? 'stopped monitoring (the room revoked it): add it again' : 'offline' + (L && L.since ? ' since ' + hm(L.since) : '')}</td></tr>`;
      }
      return `<tr data-id="${esc(r.id)}"><td class="namecell"><span class="name">${esc(r.name)}</span>${linkText(L)}</td>` +
        `<td data-h="Now">${esc(i.name)}${i.at ? `<span class="at">${esc(i.at)}</span>` : ''}</td>` +
        `<td data-h="Left" class="left ${i.kind === 'late' && String(i.left)[0] === '+' ? 'st-late' : ''}">${esc(i.left)}</td>` +
        `<td data-h="Next">${esc(i.next)}</td>` +
        `<td data-h="Show ends" class="ends">${esc(i.ends)}${i.endsLate ? ` <span class="st-behind">${esc(i.endsLate)}</span>` : ''}</td>` +
        `<td data-h="±" class="pm st-${i.kind}">${esc(i.pm)}</td></tr>`;
    }).join('');
    renderRoom();
    renderAdd();
  }
  $('rows').addEventListener('click', ev => { const tr = ev.target.closest('tr[data-id]'); if (tr) showRoom(tr.dataset.id); });

  function showRoom(id) {
    openRoom = id;
    $('gridview').hidden = !!id; $('roomview').hidden = !id;
    render();
  }
  function renderRoom() {
    if (!openRoom) return;
    const r = rooms().find(x => x.id === openRoom), L = links.get(openRoom);
    if (!r || !L) { showRoom(null); return; }
    $('rv-name').textContent = r.name;
    $('rv-status').innerHTML = L.status === 'ok' ? (L.mode === 'server' ? 'monitored · via the server' : 'monitored · linked directly') : linkText(L);
    const i = info(L);
    $('rv-now').textContent = L.status === 'ok' ? [i.left && 'Left ' + i.left, i.pm, i.ends && 'show ends ' + i.ends].filter(Boolean).join(' · ') : '';
    let list = null;
    try { list = L.state.rsList ? JSON.parse(L.state.rsList) : null; } catch (_) { list = null; }
    const rows = list && Array.isArray(list.rows) ? list.rows : [];
    const box = $('rv-list');
    box.innerHTML = (list && list.before ? `<div class="more">… ${list.before} earlier</div>` : '') + rows.map(row => {
      const a = (row.s === 'now' || row.s === 'done') && row.a, off = a ? (row.p && a !== row.p) : !!row.x;
      const tcls = off ? ((a ? a < row.p : row.xe) ? ' early' : ' late') : '';
      return `<div class="rl${row.s ? ' ' + row.s : ''}${row.e ? ' end' : ''}${row.c ? ' cancelled' : ''}"><span class="t${tcls}"${off ? ` title="Planned ${esc(row.p)}"` : ''}>${esc(a || row.x || row.p || '')}</span>` +
        `<span class="n">${esc(row.n)}</span><span class="d">${row.e ? 'finish' : row.c ? 'cancelled' : esc(row.d || '')}</span></div>`;
    }).join('') + (list && list.after ? `<div class="more">… ${list.after} more</div>` : '') + (!rows.length && L.status === 'ok' ? '<p class="dim">No run sheet running in this room.</p>' : '');
  }
  $('rv-back').addEventListener('click', () => showRoom(null));
  $('rv-rename').addEventListener('click', () => renameRoom(openRoom));
  $('rv-remove').addEventListener('click', () => removeRoom(openRoom));

  // ─── Start ────────────────────────────────────────────────────────────────
  function start() {
    $('app').hidden = false;
    const ev = $('event');
    ev.value = eventName();
    ev.addEventListener('input', () => {
      store.set('event', ev.value.trim().slice(0, 80));
      for (const d of host.devices.values()) if (d.approved) phoneHello(d);
    });
    if (!ev.value) ev.focus();
    host = ManageHost.create({ store, server: SERVER, onHello: phoneHello, onMessage: fromPhone, onChange: renderAdd });
    host.start();
    for (const r of rooms()) links.set(r.id, roomLink(r));
    if (!rooms().length) toggleAdd(true);
    const tick = () => { const d = new Date(); $('clock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); };
    tick(); setInterval(tick, 1000);
    render();
    // For the tests (tests/e2e/manage_*.py)
    window.__manage = { sid, rooms, links, host, info: id => info(links.get(id)), addRoom };
  }
})();
