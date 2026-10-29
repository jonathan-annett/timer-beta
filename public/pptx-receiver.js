/*!
 * pptx-receiver.js  (EXPERIMENTAL)
 * The PowerPoint receiver page (pptx.html), on the computer that shows the slides. It joins the
 * timer's room with the PowerPoint key (#r=<room>&p=<key>[&s=<server>]), like a phone, and
 * receives the run sheet's decks over the direct LAN link (never through the server). They are
 * saved in a folder chosen once (File System Access API: Chrome / Edge), the inbox of the
 * PowerPoint player script (Pptx-WsController.ps1) on this computer.
 *
 * Pairing with the player: this page writes its id into <inbox>\.timer-pair; the player reads
 * it and reports it, so the timer knows which player opens the files this page saves.
 *
 * To the timer: {t:'hello', kind:'receiver', pair, folder, files:[{key,name,size}], token}
 *   {t:'pf-ok'|'pf-have'|'pf-prog'|'pf-saved'|'pf-error', x, key, ...}
 * From the timer: {t:'pf-offer', x, key, name, size} then binary messages (4-byte LE transfer
 *   number + data), {t:'pf-cancel', x}, {t:'pf-tidy', keep:[keys]}, {t:'pp-info', ...}
 * Protocol: docs/powerpoint.md. MIT Licensed
 */

/* global RemotePeer */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
  };

  // ─── The link ─────────────────────────────────────────────────────────────
  if (window.TimerFeatures && !TimerFeatures.pptx) {          // an alpha-only trial (features.js)
    $('blocked').hidden = false;
    $('blocked').textContent = 'PowerPoint computers aren’t available on this site.';
    return;
  }
  const SAVED_LINK = 'pptx_saved_link';
  const parse = frag => Object.fromEntries(new URLSearchParams(frag));
  let h = parse(location.hash.slice(1));
  if (h.r && h.p) store.set(SAVED_LINK, location.hash.slice(1));
  else if (store.get(SAVED_LINK)) h = parse(store.get(SAVED_LINK));
  const cfg = { server: h.s || RemotePeer.defaultServer(), room: h.r, key: h.p };
  if (!cfg.room || !cfg.key) {
    $('blocked').hidden = false;
    $('blocked').textContent = 'Open this page from the PowerPoint link in the timer’s share panel.';
    return;
  }
  $('app').hidden = false;
  window.addEventListener('hashchange', () => location.reload());

  // This page's link, with the server spelled out: what the player script is given
  const fullLink = (() => {
    const u = new URL(location.href);
    u.hash = new URLSearchParams({ r: cfg.room, p: cfg.key, s: cfg.server }).toString();
    return u.toString();
  })();
  // Presenter View is on unless unticked (the player's -NoPresenterView)
  const presenterBox = $('presenter');
  presenterBox.checked = store.get('pptx_presenter') !== '0';
  const showCmd = () => {
    $('cmd').textContent = `powershell -ExecutionPolicy Bypass -File .\\Pptx-WsController.ps1 -Link "${fullLink}"` + (presenterBox.checked ? '' : ' -NoPresenterView');
  };
  presenterBox.addEventListener('change', () => { store.set('pptx_presenter', presenterBox.checked ? '1' : '0'); showCmd(); });
  // Rehearsal: the player opens decks for editing (switched live, through the timer)
  const rehearsalBox = $('rehearsal');
  rehearsalBox.checked = store.get('pptx_rehearsal') === '1';
  rehearsalBox.addEventListener('change', () => {
    store.set('pptx_rehearsal', rehearsalBox.checked ? '1' : '0');
    if (peer) peer.send({ t: 'pf-mode', edit: rehearsalBox.checked });
  });
  showCmd();
  $('copycmd').addEventListener('click', () => navigator.clipboard && navigator.clipboard.writeText($('cmd').textContent));

  // Our id, written into the inbox for the player to find
  let pairId = store.get('pptx_receiver_id');
  if (!pairId) {
    pairId = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
    store.set('pptx_receiver_id', pairId);
  }

  // ─── The folder (a directory handle, kept in IndexedDB across reloads) ──────
  const canPick = typeof window.showDirectoryPicker === 'function';
  let dir = null;
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('pptx-receiver', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function kv(op, key, val) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', op === 'get' ? 'readonly' : 'readwrite');
      const req = op === 'get' ? tx.objectStore('kv').get(key) : tx.objectStore('kv').put(val, key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async function useFolder(handle) {
    dir = handle;
    try {
      const fh = await dir.getFileHandle('.timer-pair', { create: true });
      const w = await fh.createWritable();
      await w.write(pairId);
      await w.close();
    } catch (err) { setNote('Couldn’t write into that folder: ' + (err && err.message || err)); dir = null; }
    await checkFiles();
    renderAll();
    sendHello();
  }
  async function restoreFolder() {
    if (!canPick) { $('nofs').hidden = false; $('pick').disabled = true; return; }
    let handle = null;
    try { handle = await kv('get', 'dir'); } catch (_) { /* none */ }
    if (!handle) return renderAll();
    const perm = await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied');
    if (perm === 'granted') return useFolder(handle);
    // Browsers ask again after a restart: that needs a click
    pendingHandle = handle;
    $('pick').textContent = `Allow “${handle.name}” again`;
    renderAll();
  }
  let pendingHandle = null;
  $('pick').addEventListener('click', async () => {
    try {
      if (pendingHandle) {
        const h2 = pendingHandle;
        if ((await h2.requestPermission({ mode: 'readwrite' })) === 'granted') { pendingHandle = null; $('pick').textContent = 'Choose another folder…'; return useFolder(h2); }
      }
      const handle = await window.showDirectoryPicker({ id: 'timer-inbox', mode: 'readwrite', startIn: 'documents' });
      pendingHandle = null;
      await kv('put', 'dir', handle).catch(() => {});
      $('pick').textContent = 'Choose another folder…';
      await useFolder(handle);
    } catch (err) { if (err && err.name !== 'AbortError') setNote('Folder: ' + (err.message || err)); }
  });

  // ─── Files we've saved: key → {name, size}; checked against the folder ────
  const FILES_KEY = 'pptx_receiver_files_' + cfg.room;
  let files = {};
  try { files = JSON.parse(store.get(FILES_KEY) || '{}') || {}; } catch (_) { files = {}; }
  const saveIndex = () => store.set(FILES_KEY, JSON.stringify(files));
  async function checkFiles() {
    if (!dir) return;
    for (const [key, f] of Object.entries(files)) {
      try { const file = await (await dir.getFileHandle(f.name)).getFile(); if (file.size !== f.size) delete files[key]; }
      catch (_) { delete files[key]; }         // deleted or renamed by hand
    }
    saveIndex();
  }

  // ─── Connection ───────────────────────────────────────────────────────────
  let ws = null, peer = null, retry = 1000, retryTimer = null, hostOnline = false, waiting = false, fatal = false;
  let info = null;                                     // from the timer: the player we're paired with, decks
  const setNote = t => { $('note').textContent = t || ''; };
  let relinkUntil = 0;                             // a direct link is being retried until then (relink())
  function showMode() {
    const b = $('badge');
    if (waiting) { b.className = ''; b.textContent = 'timer offline'; setNote('Waiting for the timer… (it has to be open, with share on)'); }
    else if (!ws || ws.readyState !== WebSocket.OPEN) { b.className = ''; b.textContent = 'reconnecting…'; }
    else if (!hostOnline) { b.className = ''; b.textContent = 'timer offline'; setNote('Waiting for the timer…'); }
    else if (peer && peer.mode === 'lan') { b.className = 'lan'; b.textContent = '⚡ LAN direct'; setNote(''); }
    else { b.className = 'server'; b.textContent = peer && peer.mode === 'p2p' ? 'direct, other network' : Date.now() < relinkUntil ? 'retrying…' : 'via server'; setNote('Not on the same network: decks can’t be sent. This computer has to be on the same network as the timer’s computer (and the network must let devices reach each other).'); }
  }
  // Another go at a direct link (decks need one): the badge clicked while on the server, or a new network
  function relink() {
    if (!peer || peer.mode !== 'server' || !hostOnline) return;
    peer.send({ t: 'relink' });
    relinkUntil = Date.now() + 8000;
    showMode();
    setTimeout(showMode, 8100);
  }
  $('badge').addEventListener('click', relink);
  RemotePeer.retryOnNetworkChange(relink);
  function sendHello() {
    if (!peer) return;
    peer.send({ t: 'hello', kind: 'receiver', pair: pairId, folder: !!dir, folderName: dir ? dir.name : '', edit: $('rehearsal').checked,
      files: Object.entries(files).map(([key, f]) => ({ key, name: f.name, size: f.size })),
      token: store.get('pptx_token_' + cfg.room) || undefined });
  }
  function newPeer() {
    if (peer) peer.close();
    dropTransfer('The link to the timer was lost.');
    peer = RemotePeer.create({
      initiator: false,
      relay: msg => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'up', msg })); },
      onMessage,
      onBinary,
      onModeChange: () => { showMode(); if (peer && peer.mode !== 'lan') dropTransfer('The direct link was lost.'); sendHello(); },
    });
    sendHello();
  }
  function connect() {
    clearTimeout(retryTimer);
    if (fatal) return;
    try { ws = new WebSocket(RemotePeer.socketUrl(cfg.server, { room: cfg.room })); RemotePeer.keepAlive(ws); } catch (_) { return schedule(); }
    const sock = ws;
    sock.onopen = () => sock.send(JSON.stringify({ type: 'join', room: cfg.room, key: cfg.key }));
    sock.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      switch (m.type) {
        case 'joined': hostOnline = m.hostOnline; waiting = false; retry = 1000; if (hostOnline) newPeer(); break;
        case 'down': if (peer) peer.receive(m.msg); break;
        case 'host-offline': hostOnline = false; if (peer) peer.close(); peer = null; dropTransfer(null); break;
        case 'host-online': hostOnline = true; newPeer(); break;
        case 'error':
          if (m.reason === 'not-found' || m.reason === 'room-closed') { waiting = true; retry = 15000; }
          else if (m.reason === 'room-full') { fatal = true; setNote('Too many devices are connected to the timer.'); }
          break;
      }
      showMode();
    };
    sock.onclose = () => { if (sock !== ws) return; if (peer) peer.close(); peer = null; dropTransfer(null); showMode(); if (!fatal) schedule(); };
    sock.onerror = () => {};
  }
  function schedule() { retryTimer = setTimeout(connect, retry); if (!waiting) retry = Math.min(retry * 2, 10000); }

  // ─── Messages ─────────────────────────────────────────────────────────────
  let pinCode = null;
  function onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'pin-required') {
      if (!pinCode) pinCode = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
      $('pincode').textContent = pinCode; $('pinretry').hidden = true; $('pinwait').hidden = false;
      peer.send({ t: 'pin', code: pinCode });
    } else if (m.t === 'pin-ok') {
      if (typeof m.token === 'string') store.set('pptx_token_' + cfg.room, m.token);
      pinCode = null; $('pinwait').hidden = true; sendHello();
    } else if (m.t === 'pin-rejected') {
      $('pincode').textContent = ''; $('pinmsg').textContent = 'The timer didn’t let this computer in.'; $('pinretry').hidden = false; $('pinwait').hidden = false;
    } else if (m.t === 'pf-offer') offer(m);
    else if (m.t === 'pf-cancel') { if (xfer && xfer.x === m.x) dropTransfer(null); }
    else if (m.t === 'pf-tidy') tidy(m.keep);
    else if (m.t === 'pp-info') { info = m; renderAll(); }
  }
  $('pinretry').addEventListener('click', () => location.reload());

  // ─── Receiving a deck ─────────────────────────────────────────────────────
  // Names come from the timer; only plain PowerPoint file names are written, nothing else.
  const NAME_RE = /^[^\\/:*?"<>|\u0000-\u001f]{1,160}\.(pptx|ppsx|pptm|ppsm|ppt|pps|potx|png|jpe?g|bmp)$/i;   // decks and holding slides
  const MAX_SIZE = 8e9;
  let xfer = null;               // {x, key, name, size, got, written, writable, chain, nextProg}
  async function offer(m) {
    const reply = extra => peer && peer.send(Object.assign({ x: m.x, key: m.key }, extra));
    if (typeof m.key !== 'string' || !/^rs(deck|img):[\w-]{1,40}:\d{1,16}$/.test(m.key) || typeof m.name !== 'string' || !NAME_RE.test(m.name) ||
        typeof m.size !== 'number' || !(m.size > 0 && m.size <= MAX_SIZE) || !Number.isInteger(m.x)) return reply({ t: 'pf-error', reason: 'bad' });
    if (!dir) return reply({ t: 'pf-error', reason: 'no-folder' });
    if (!peer || peer.mode !== 'lan') return reply({ t: 'pf-error', reason: 'not-lan' });
    const f = files[m.key];
    if (f && f.name === m.name && f.size === m.size) {
      try { const file = await (await dir.getFileHandle(f.name)).getFile(); if (file.size === f.size) return reply({ t: 'pf-have', name: f.name }); } catch (_) { /* gone: fetch again */ }
    }
    if (xfer) return reply({ t: 'pf-error', reason: 'busy' });
    let writable;
    try { writable = await (await dir.getFileHandle(m.name, { create: true })).createWritable(); }
    catch (err) { return reply({ t: 'pf-error', reason: 'write', detail: String(err && err.message || err).slice(0, 200) }); }
    // The browser writes to a temporary file and only replaces m.name when it's complete (close)
    xfer = { x: m.x, key: m.key, name: m.name, size: m.size, got: 0, written: 0, writable, chain: Promise.resolve(), nextProg: 2 << 20, failed: false };
    rows.set(m.key, { name: m.name, size: m.size, state: 'receiving 0%' });
    renderAll();
    reply({ t: 'pf-ok' });
  }
  function onBinary(buf) {
    const t = xfer;
    if (!t || !(buf instanceof ArrayBuffer) || buf.byteLength < 5 || new DataView(buf).getUint32(0, true) !== t.x) return;
    const data = buf.slice(4);
    t.got += data.byteLength;
    if (t.got > t.size) { failTransfer(t, 'too-big'); return; }
    t.chain = t.chain.then(async () => {
      if (t.failed) return;
      await t.writable.write(data);
      t.written += data.byteLength;
      if (t.written >= t.nextProg || t.written === t.size) {
        t.nextProg += 2 << 20;
        if (peer) peer.send({ t: 'pf-prog', x: t.x, key: t.key, got: t.written });
        const r = rows.get(t.key); if (r) { r.state = `receiving ${Math.floor(t.written / t.size * 100)}%`; renderFiles(); }
      }
      if (t.written === t.size) {
        await t.writable.close();
        xfer = null;
        files[t.key] = { name: t.name, size: t.size };
        saveIndex();
        rows.set(t.key, { name: t.name, size: t.size, state: 'saved' });
        if (peer) peer.send({ t: 'pf-saved', x: t.x, key: t.key, name: t.name });
        renderAll();
      }
    }).catch(err => failTransfer(t, 'write', err));
  }
  function failTransfer(t, reason, err) {
    if (t.failed) return;
    t.failed = true;
    try { t.writable.abort(); } catch (_) { /* closed */ }
    if (xfer === t) xfer = null;
    rows.set(t.key, { name: t.name, size: t.size, state: 'failed' });
    if (peer) peer.send({ t: 'pf-error', x: t.x, key: t.key, reason, detail: err ? String(err.message || err).slice(0, 200) : undefined });
    renderAll();
  }
  function dropTransfer(why) {
    const t = xfer;
    if (!t) return;
    t.failed = true; xfer = null;
    try { t.writable.abort(); } catch (_) { /* closed */ }
    rows.set(t.key, { name: t.name, size: t.size, state: why ? 'interrupted' : 'waiting' });
    renderAll();
  }

  // Decks the run sheet no longer uses: removed (only files this page saved)
  async function tidy(keep) {
    if (!dir || !Array.isArray(keep)) return;
    const k = new Set(keep.filter(x => typeof x === 'string'));
    for (const [key, f] of Object.entries(files)) {
      if (k.has(key) || (xfer && xfer.key === key)) continue;
      try { await dir.removeEntry(f.name); } catch (_) { /* already gone, or open */ }
      delete files[key]; rows.delete(key);
    }
    saveIndex();
    renderAll();
  }

  // ─── Display ──────────────────────────────────────────────────────────────
  const rows = new Map();          // key → {name, size, state}: this session's activity
  const mb = n => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function renderFiles() {
    const all = new Map();
    for (const [key, f] of Object.entries(files)) all.set(key, { name: f.name, size: f.size, state: 'saved' });
    for (const [key, r] of rows) all.set(key, r);
    $('files').querySelector('tbody').innerHTML = [...all.values()].map(r =>
      `<tr><td>${esc(r.name)}</td><td class="sz">${mb(r.size)}</td><td class="st ${r.state === 'saved' ? 'ok' : r.state === 'failed' || r.state === 'interrupted' ? 'bad' : 'warn'}">${esc(r.state)}</td></tr>`).join('');
    const n = Object.keys(files).length;
    $('summary').textContent = info && info.total ? `${info.ready} of ${info.total} files (decks and holding slides) ready on this computer` + (info.player ? '' : ' (the player isn’t connected)') :
      n ? `${n} deck${n > 1 ? 's' : ''} saved here.` : 'Nothing received yet.';
  }
  // A player is connected but doesn't see our .timer-pair file: say exactly which folder it uses
  function strayText() {
    const s = (info && Array.isArray(info.strays) ? info.strays : []).filter(x => x && x.inbox);
    if (!s.length) return 'A player is connected but uses a different inbox: choose the Inbox folder it shows when it starts.';
    const one = s[0];
    return (dir ? `The player “${esc(one.name)}” is connected but uses a different folder. Click <b>Choose another folder…</b> and pick exactly `
                : `The player “${esc(one.name)}” is connected. Now click <b>Choose folder…</b> and pick its inbox: `) +
      `<code>${esc(one.inbox)}</code>` + (dir && dir.name ? ` (this page is saving into a folder called “${esc(dir.name)}”)` : '') + '.' +
      (/\\OneDrive\\/i.test(one.inbox) ? ' It’s in <b>OneDrive</b>: Documents on this computer is the OneDrive one, not C:\\Users\\…\\Documents.' : '');
  }
  function renderAll() {
    $('s-folder').className = dir ? 'done' : 'need';
    $('folder').textContent = dir ? (dir.name ? `Saving into “${dir.name}”` : 'Saving into the chosen folder') : pendingHandle ? `“${pendingHandle.name}” needs permission again` : 'No folder chosen yet';
    const paired = info && info.player;
    $('s-player').className = paired ? 'done' : 'need';
    $('playerst').innerHTML = paired ? `<span class="ok">Player “${esc(info.player)}” is connected and uses this folder.</span>`
      : info && info.unpaired ? '<span class="warn">' + strayText() + '</span>'
      : 'Not started yet.';
    renderFiles();
  }

  restoreFolder();
  renderAll();
  showMode();
  connect();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!ws || ws.readyState > WebSocket.OPEN)) { if (!waiting) retry = 1000; connect(); }
  });
})();
