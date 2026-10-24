/*!
 * pptx-hub.js  (EXPERIMENTAL)
 * PowerPoint machines, timer side. A PowerPoint machine is two connections from one computer,
 * both joined with the timer's PowerPoint key (share → PowerPoint): the receiver page
 * (pptx.html: saves decks into a folder) and the player script (Pptx-WsController.ps1: opens
 * them in PowerPoint). They are paired by the id the receiver writes into the folder and the
 * player reads back.
 *
 * Every deck on the run sheet (item.deck {key, name, size}, the file kept in this browser by
 * video-store.js) is sent to each machine ahead of time, current and next first: to the
 * receiver over the direct LAN link only, then copied into the player's Show folder. Next onto
 * an item with a deck starts it on every machine; an item without a deck leaves the last one
 * up. Several machines (a main and a backup) get the same commands at the same moment.
 *
 * remote-control.js hands over the PowerPoint peers: join(e), leave(e), message(e, m, via),
 * mode(e). runsheet.js calls changed(), start(item), current(item) and hint().
 * An item can also carry a holding slide (item.holding {key, name, size}: an image, e.g. the
 * event logo): sent ahead the same way, and set as each machine's Windows wallpaper when the item
 * starts, so it shows whenever no deck is up. close() closes every slide show on every machine
 * (revealing the holding slide).
 * The timer only gets decks there and starts them: slides are advanced on each machine itself.
 * Bus variables: pptx_machines, pptx_current, pptx_showing, pptx_next_ready.
 * Protocol: docs/powerpoint.md. MIT Licensed
 */

/* global RunsheetCore */

(function () {
  'use strict';

  if (new URLSearchParams(location.search).has('presenter')) return;

  const machines = new Map();       // pair id → machine {id, receiver, player, have, prepared, ...}
  const loose = new Set();          // players whose inbox no receiver has claimed yet
  const PAIR_RE = /^[a-z0-9]{8,40}$/;
  const LAST_KEY = 'pptx_last';     // the deck last started, for machines that connect later
  const HOLD_KEY = 'pptx_holding';  // the holding slide last set (wallpaper), likewise
  let lastKey = localStorage.getItem(LAST_KEY) || '';
  let lastHolding = localStorage.getItem(HOLD_KEY) || '';

  const readJSON = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (_) { return d; } };
  const refreshPanel = () => { if (window.remoteControl && window.remoteControl.refresh) window.remoteControl.refresh(); };

  // ─── The decks on the sheet ───────────────────────────────────────────────
  const DECK_EXT = /\.(pptx|ppsx|pptm|ppsm|ppt|pps|potx)$/i;
  const IMG_EXT = /\.(png|jpe?g|bmp)$/i;
  // The file name in the machines' folders: the deck's name plus a tag from its key, so two
  // items with "slides.pptx" never collide and a replaced deck gets a new name.
  function fileName(deck) {
    const img = /^rsimg:/.test(String(deck.key));
    const re = img ? IMG_EXT : DECK_EXT;
    const m = String(deck.name || '').match(re);
    const ext = m ? m[0].toLowerCase() : img ? '.png' : '.pptx';
    let base = String(deck.name || 'deck').replace(re, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || 'deck';
    const tag = Number(String(deck.key).split(':')[2] || 0).toString(36).slice(-6);
    return `${base} ~${tag}${ext}`;
  }
  // Files in the order they're needed: the current item's, the next item's, the rest after, then
  // before. Each item's holding slide comes before its deck. Entries: {key, name, size, file, kind}.
  const filesOf = it => [it && it.holding, it && it.deck].filter(f => f && typeof f.key === 'string');
  function deckList() {
    const sheet = readJSON('runsheet', { items: [] });
    const st = readJSON('runsheet_state', {});
    const all = (sheet.items || []);
    const cur = Math.max(0, all.findIndex(it => it && it.id === st.currentId));
    const order = all.map((it, i) => [it, i]).filter(([it]) => filesOf(it).length)
      .sort((a, b) => ((a[1] - cur + all.length) % all.length) - ((b[1] - cur + all.length) % all.length));
    const seen = new Set(), out = [];
    for (const [it] of order) for (const f of filesOf(it)) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      out.push(Object.assign({ file: fileName(f), item: it.name, kind: f === it.deck ? 'deck' : 'holding' }, f));
    }
    return out;
  }
  // The next item's files (holding slide and/or deck), for "ready" checks
  const nextFiles = () => {
    const sheet = readJSON('runsheet', { items: [] });
    const st = readJSON('runsheet_state', {});
    if (!st.active || st.finished || !window.RunsheetCore) return [];
    const norm = RunsheetCore.normalise(sheet);
    for (let j = (st.index == null ? -1 : st.index) + 1; j < norm.items.length; j++) {
      if (j === norm.endIdx) continue;
      return filesOf((sheet.items || []).find(x => x && x.id === norm.items[j].id));
    }
    return [];
  };


  // ─── Machines ─────────────────────────────────────────────────────────────
  function machine(id) {
    let M = machines.get(id);
    if (!M) {
      M = { id, receiver: null, player: null, have: new Map(), prepared: new Map(), syncing: false, again: false,
        transfer: null, pendingStart: '', pendingHolding: '', error: '', blocked: '', tidied: '' };
      machines.set(id, M);
    }
    return M;
  }
  const machineOf = e => { for (const M of machines.values()) if (M.receiver === e || M.player === e) return M; return null; };
  const label = M => (M.player && M.player.pp.name) || 'PowerPoint';
  function forget(M) { if (!M.receiver && !M.player) machines.delete(M.id); }

  function join(e) { e.pp = { kind: null, queue: [], inflight: null, seq: 0 }; }
  function leave(e) {
    if (!e.pp) return;
    loose.delete(e);
    const M = machineOf(e);
    if (M && M.receiver === e) { M.receiver = null; failTransfer(M, 'The receiver page closed'); M.have.clear(); }
    if (M && M.player === e) { M.player = null; M.prepared.clear(); }
    rejectQueue(e, 'disconnected');
    if (M) forget(M);
    announce(); refreshPanel(); infoAll();
  }
  function mode(e) {
    const M = machineOf(e);
    if (M && M.receiver === e) {
      if (e.peer.mode !== 'lan') failTransfer(M, 'The direct link was lost');
      else sync(M);
      infoAll(); refreshPanel();
    }
  }

  function message(e, m, via) {
    if (!e.pp) join(e);
    if (m.t === 'hello') return hello(e, m);
    if (m.t === 'pp-ack') return onAck(e, m);
    if (m.t === 'pp-state') return onShowState(e, m);
    if (m.t === 'pf-mode') return onReceiverMode(e, m);
    if (/^pf-/.test(m.t)) return onReceiverReply(e, m, via);
  }

  function hello(e, m) {
    if (m.kind === 'receiver') {
      if (typeof m.pair !== 'string' || !PAIR_RE.test(m.pair)) return;
      const old = machineOf(e);
      if (old && old.id !== m.pair) { old.receiver = null; forget(old); }
      e.pp.kind = 'receiver'; e.pp.folder = !!m.folder;
      e.pp.edit = !!m.edit;                              // the page's Rehearsal box: decks open for editing
      const M = machine(m.pair);
      if (M.receiver && M.receiver !== e) failTransfer(M, 'replaced');
      M.receiver = e;
      M.have = new Map();
      if (Array.isArray(m.files)) for (const f of m.files.slice(0, 1000)) {
        if (f && typeof f.key === 'string' && typeof f.name === 'string' && typeof f.size === 'number') M.have.set(f.key, f.name);
      }
      // A player waiting for its receiver may be using this folder (or its folder's id may be
      // an old one this page has just replaced): ask them to look again
      for (const p of [...loose]) checkPair(p);
      for (const other of machines.values()) if (other !== M && !other.receiver && other.player) checkPair(other.player);
      applyMode(M);
      sync(M);
    } else if (m.kind === 'player') {
      e.pp.kind = 'player';
      e.pp.name = typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 40) : 'PowerPoint';
      e.pp.version = String(m.version || '').slice(0, 10);
      e.pp.simulate = !!m.simulate;
      e.pp.presenter = m.presenter !== false;          // decks open in Presenter View (the player's default)
      e.pp.edit = !!m.edit;
      e.pp.inbox = typeof m.inbox === 'string' ? m.inbox.slice(0, 300) : '';     // its Inbox path, shown when the pairing fails
      setShowState(e, m);
      rejectQueue(e, 'reconnected');
      attachPlayer(e, typeof m.pair === 'string' && PAIR_RE.test(m.pair) ? m.pair : '');
    }
    announce(); refreshPanel(); infoAll();
  }

  // A player belongs to the machine whose id is in its inbox. If that receiver isn't connected
  // (yet), the machine just has no receiver for now.
  function attachPlayer(e, pair) {
    const old = machineOf(e);
    if (old && old.id !== pair) { old.player = null; old.prepared.clear(); forget(old); }
    if (!pair) { loose.add(e); return; }
    loose.delete(e);
    const M = machine(pair);
    if (M.player && M.player !== e) { rejectQueue(M.player, 'replaced'); loose.add(M.player); }
    M.player = e;
    M.prepared = new Map();
    applyMode(M);                                      // rehearsal or show, as its receiver page says
    if (lastHolding) M.pendingHolding = lastHolding;   // a late (or backup) machine catches up: the holding slide,
    if (lastKey) M.pendingStart = lastKey;              // and the deck that's showing
    sync(M);
  }

  async function checkPair(p) {
    const a = await cmd(p, 'check', '', null, 10000).catch(() => null);
    if (a && a.ok && typeof a.result === 'string' && PAIR_RE.test(a.result) && machines.has(a.result) && machines.get(a.result).receiver) {
      attachPlayer(p, a.result);
      announce(); refreshPanel(); infoAll();
    }
  }

  // ─── Player commands: one at a time, each answered by an ack ──────────────────
  function cmd(p, verb, arg, extra, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!p || !p.pp) return reject(new Error('no player'));
      const req = (++p.pp.seq).toString(36);
      p.pp.queue.push({ req, msg: Object.assign({ t: 'pp', req, verb, arg: arg || '' }, extra || {}), resolve, reject, timeoutMs: timeoutMs || 30000 });
      pump(p);
    });
  }
  function pump(p) {
    if (p.pp.inflight || !p.pp.queue.length) return;
    const c = p.pp.inflight = p.pp.queue.shift();
    c.timer = setTimeout(() => { if (p.pp.inflight === c) { p.pp.inflight = null; c.reject(new Error('the player didn’t answer')); pump(p); } }, c.timeoutMs);
    p.peer.send(c.msg);
  }
  function onAck(p, m) {
    const c = p.pp.inflight;
    if (!c || m.req !== c.req) return;
    clearTimeout(c.timer);
    p.pp.inflight = null;
    c.resolve(m);
    pump(p);
  }
  function rejectQueue(p, why) {
    if (!p || !p.pp) return;
    const all = (p.pp.inflight ? [p.pp.inflight] : []).concat(p.pp.queue);
    p.pp.inflight = null; p.pp.queue = [];
    for (const c of all) { clearTimeout(c.timer); c.reject(new Error(why)); }
  }

  function setShowState(p, m) {
    p.pp.current = typeof m.current === 'string' ? m.current.slice(0, 200) : '';
    p.pp.showing = !!m.showing;
  }
  function onShowState(p, m) { setShowState(p, m); announce(); refreshPanel(); }

  // ─── Sending a deck to a receiver (LAN only) ──────────────────────────────────
  const CHUNK = 64 * 1024, WINDOW = 16 << 20;
  let xferSeq = 0;
  function transfer(M, deck) {
    return new Promise(async (resolve, reject) => {
      const r = M.receiver;
      if (!r || r.peer.mode !== 'lan') return reject(Object.assign(new Error('not-lan'), { soft: true }));
      let blob = null;
      try { blob = window.videoStore && await window.videoStore.get(deck.key); } catch (_) { /* missing */ }
      if (!blob) return reject(Object.assign(new Error(`The deck “${deck.name}” isn’t stored in this browser: attach it again in the run sheet editor`), { missing: true }));
      const t = { x: ++xferSeq, key: deck.key, name: deck.file, size: blob.size, acked: 0, sent: 0, waiter: null, done: false,
        resolve, reject, receiver: r };
      M.transfer = t;
      const stall = () => { clearTimeout(t.stallTimer); t.stallTimer = setTimeout(() => finish(M, t, new Error('The receiver stopped answering')), 60000); };
      t.onReply = async m => {
        if (m.t === 'pf-have') { M.have.set(deck.key, deck.file); finish(M, t); }
        else if (m.t === 'pf-error') finish(M, t, new Error(m.reason === 'no-folder' ? 'The receiver page has no folder chosen' : m.reason === 'not-lan' ? 'not-lan' : 'The receiver couldn’t save it: ' + m.reason + (m.detail ? ' (' + m.detail + ')' : '')));
        else if (m.t === 'pf-prog') { t.acked = Number(m.got) || t.acked; stall(); if (t.waiter) { const w = t.waiter; t.waiter = null; w(); } refreshPanel(); infoAll(); }
        else if (m.t === 'pf-saved') { M.have.set(deck.key, deck.file); finish(M, t); }
        else if (m.t === 'pf-ok') {
          stall();
          try {
            for (let off = 0; off < t.size;) {
              if (t.done) return;
              while (t.sent - t.acked > WINDOW && !t.done) await new Promise(w => { t.waiter = w; });
              const ab = await blob.slice(off, Math.min(t.size, off + 16 * CHUNK)).arrayBuffer();
              for (let p = 0; p < ab.byteLength; p += CHUNK) {
                const piece = new Uint8Array(4 + Math.min(CHUNK, ab.byteLength - p));
                new DataView(piece.buffer).setUint32(0, t.x, true);
                piece.set(new Uint8Array(ab, p, piece.length - 4), 4);
                if (t.done) return;
                if (!r.peer.sendBinary(piece.buffer)) throw new Error('The direct link was lost');
              }
              off += ab.byteLength; t.sent = off;
              await r.peer.drained(4 << 20);
            }
          } catch (err) { finish(M, t, err); }
        }
      };
      stall();
      r.peer.send({ t: 'pf-offer', x: t.x, key: deck.key, name: deck.file, size: t.size });
      refreshPanel();
    });
  }
  function finish(M, t, err) {
    if (t.done) return;
    t.done = true;
    clearTimeout(t.stallTimer);
    if (M.transfer === t) M.transfer = null;
    if (t.waiter) t.waiter();
    if (err) { try { t.receiver.peer.send({ t: 'pf-cancel', x: t.x }); } catch (_) { /* gone */ } t.reject(err); }
    else t.resolve();
    refreshPanel(); infoAll();
  }
  function failTransfer(M, why) { if (M.transfer) finish(M, M.transfer, Object.assign(new Error(why), { soft: true })); }
  // Rehearsal mode is switched on the PowerPoint computer itself, with its receiver page's box; the
  // player there opens decks for editing (then F5) instead of straight into the show
  function applyMode(M) {
    if (!M.receiver || !M.player || !!M.player.pp.edit === !!M.receiver.pp.edit) return;
    const want = !!M.receiver.pp.edit;
    cmd(M.player, 'mode', want ? 'edit' : 'show').then(a => { if (a.ok && M.player) M.player.pp.edit = want; refreshPanel(); }).catch(() => {});
  }
  function onReceiverMode(e, m) {
    const M = machineOf(e);
    if (!M || M.receiver !== e) return;
    e.pp.edit = !!m.edit;
    applyMode(M);
    refreshPanel();
  }
  function onReceiverReply(e, m) {
    const M = machineOf(e);
    const t = M && M.transfer;
    if (t && t.receiver === e && m.x === t.x && t.onReply) t.onReply(m);
  }

  // ─── Keeping a machine in step with the sheet ─────────────────────────────────
  async function sync(M) {
    if (M.syncing) { M.again = true; return; }
    M.syncing = true;
    try {
      do {
        M.again = false; M.blocked = '';
        const list = deckList();
        let complete = true;
        for (const deck of list) {
          if (!M.receiver || !M.player || machines.get(M.id) !== M) { complete = false; break; }
          if (!M.have.has(deck.key)) {
            if (M.receiver.peer.mode !== 'lan') { M.blocked = 'not-lan'; complete = false; break; }
            if (!M.receiver.pp.folder) { M.blocked = 'no-folder'; complete = false; break; }
            try { await transfer(M, deck); M.error = ''; }
            catch (err) {
              complete = false;
              if (err.message === 'not-lan' || err.soft) { M.blocked = err.message === 'not-lan' ? 'not-lan' : ''; break; }
              M.error = err.message;
              if (err.missing) continue;
              break;
            }
          }
          if (!M.prepared.has(deck.key) && M.player) {
            const a = await cmd(M.player, 'send', M.have.get(deck.key) || deck.file, null, 30 * 60000).catch(err => ({ ok: false, error: err.message }));
            if (a.ok && typeof a.result === 'string') { M.prepared.set(deck.key, a.result); M.error = ''; }
            else { M.error = `Couldn’t prepare “${deck.name}”: ${a.error || 'error'}`; complete = false; continue; }
          }
          if (M.pendingHolding === deck.key) holdingOn(M, deck.key);
          if (M.pendingStart === deck.key) startOn(M, deck.key);
          refreshPanel(); infoAll(); announce();
        }
        // Tidy once everything is in place (and only when the list changed)
        const sig = list.map(d => d.key).join(',');
        if (complete && M.receiver && M.player && M.tidied !== sig) {
          M.tidied = sig;
          M.receiver.peer.send({ t: 'pf-tidy', keep: list.map(d => d.key) });
          const keepNames = list.map(d => M.prepared.get(d.key)).filter(Boolean);
          cmd(M.player, 'tidy', '', { keep: keepNames }).catch(() => {});
          for (const k of [...M.prepared.keys()]) if (!list.some(d => d.key === k)) M.prepared.delete(k);
        }
      } while (M.again);
    } finally {
      M.syncing = false;
      refreshPanel(); infoAll(); announce();
    }
  }
  let changeTimer = null;
  function changed() {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { for (const M of machines.values()) sync(M); announce(); refreshPanel(); infoAll(); }, 150);
  }

  // ─── Showing ──────────────────────────────────────────────────────────────
  function startOn(M, key) {
    if (!M.player) { M.pendingStart = key; return; }
    const name = M.prepared.get(key);
    if (!name) { M.pendingStart = key; sync(M); return; }
    M.pendingStart = '';
    cmd(M.player, 'start', name, null, 60000).then(a => {
      if (!a.ok) M.error = `Couldn’t start the deck: ${a.error || 'error'}`;
      refreshPanel();
    }).catch(err => { M.error = err.message; refreshPanel(); });
  }
  // The holding slide becomes the machine's wallpaper (shown whenever no deck is up)
  function holdingOn(M, key) {
    if (!M.player) { M.pendingHolding = key; return; }
    const name = M.prepared.get(key);
    if (!name) { M.pendingHolding = key; sync(M); return; }
    M.pendingHolding = '';
    cmd(M.player, 'wallpaper', name, null, 30000).then(a => {
      if (!a.ok) M.error = `Couldn’t set the holding slide: ${a.error || 'error'}`;
      refreshPanel();
    }).catch(err => { M.error = err.message; refreshPanel(); });
  }
  function setHolding(item) {
    lastHolding = item.holding.key;
    localStorage.setItem(HOLD_KEY, lastHolding);
    for (const M of machines.values()) holdingOn(M, lastHolding);
  }
  // Next reached an item with slides: its holding slide (if any) becomes the wallpaper, then
  // its deck (if any) starts, on every machine, at once where it's ready
  function start(item) {
    if (!item) return;
    if (item.holding && item.holding.key) setHolding(item);
    if (!item.deck || !item.deck.key) return;
    lastKey = item.deck.key;
    localStorage.setItem(LAST_KEY, lastKey);
    for (const M of machines.values()) startOn(M, lastKey);
    if (!machines.size) flash(`“${item.name}” has slides, but no PowerPoint computer is connected`);
    announce();
  }
  // Back (or a sheet edit) made `item` the current one: show its deck, unless it's already up
  function current(item) {
    if (item && item.holding && item.holding.key && item.holding.key !== lastHolding) setHolding(item);
    if (item && item.deck && item.deck.key && item.deck.key !== lastKey) start({ name: item.name, deck: item.deck });
  }
  // Close every slide show on every machine (the holding slide shows), including one opened there
  // by hand. A machine connecting later isn't told to open the last deck again.
  function close() {
    lastKey = ''; localStorage.removeItem(LAST_KEY);
    for (const M of machines.values()) { M.pendingStart = ''; if (M.player) cmd(M.player, 'stop', 'all').catch(() => {}); }
    for (const p of loose) cmd(p, 'stop', 'all').catch(() => {});
    if (!machines.size && !loose.size) flash('No PowerPoint computer is connected');
  }
  const flash = text => { if (window.runsheet && window.runsheet.flash) window.runsheet.flash(text); };

  // ─── Status ───────────────────────────────────────────────────────────────
  function summary() {
    const list = deckList();
    const out = [];
    for (const M of machines.values()) {
      const t = M.transfer;
      out.push({
        name: label(M), receiver: M.receiver ? M.receiver.peer.mode : null, folder: !!(M.receiver && M.receiver.pp.folder),
        player: !!M.player, simulate: !!(M.player && M.player.pp.simulate), presenter: !!(M.player && M.player.pp.presenter),
        edit: !!(M.player && M.player.pp.edit),
        ready: list.filter(d => M.prepared.has(d.key)).length, total: list.length,
        transfer: t ? { name: t.name, pct: t.size ? Math.floor(t.acked / t.size * 100) : 0 } : null,
        current: M.player ? M.player.pp.current : '', showing: !!(M.player && M.player.pp.showing),
        error: M.error, blocked: M.blocked,
      });
    }
    for (const p of loose) out.push({ name: p.pp.name || 'PowerPoint', receiver: null, player: true, unpaired: true, inbox: p.pp.inbox || '', ready: 0, total: list.length,
      current: p.pp.current, showing: p.pp.showing });
    return out;
  }
  // One line per machine, for the share panel
  function describe(s) {
    const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const bits = [`PowerPoint “${esc(s.name)}”`];
    if (s.unpaired) bits.push('<span class="pp-warn">player only: its receiver page isn’t open, or uses another folder</span>' + (s.inbox ? ` (the player’s inbox is <code>${esc(s.inbox)}</code>)` : ''));
    else {
      bits.push(!s.receiver ? '<span class="pp-warn">receiver page not open</span>'
        : s.receiver === 'lan' ? (s.folder ? 'receiver <b class="pp-lan">LAN direct</b>' : '<span class="pp-warn">receiver: no folder chosen</span>')
        : '<span class="pp-warn">receiver via server: decks need the same network</span>');
      bits.push(s.player ? (s.simulate ? 'player (simulating)' : 'player ✓') + (s.presenter ? ', Presenter View' : '') + (s.edit ? ', <b>rehearsal</b> (decks open for editing)' : '') : '<span class="pp-warn">player not running</span>');
      if (s.total) bits.push(s.transfer ? `sending ${esc(s.transfer.name)} ${s.transfer.pct}%` : `${s.ready}/${s.total} files ready`);
    }
    if (s.current) bits.push((s.showing ? 'showing ' : 'last: ') + esc(s.current.replace(/ ~[0-9a-z]{1,6}(?=\.\w+$)/, '')));
    let line = bits.join(' · ');
    if (s.error) line += `<div class="pp-warn">${esc(s.error)}</div>`;
    return `<div>${line}</div>`;
  }
  // Status line for the run sheet dashboard, when the next item has slides
  function hint() {
    const fs = nextFiles();
    if (!fs.length) return '';
    if (!machines.size && !loose.size) return 'next has slides: no PowerPoint computer connected';
    const notReady = [...machines.values()].filter(M => fs.some(f => !M.prepared.has(f.key)));
    if (!notReady.length) return '';
    const M = notReady[0];
    const t = M.transfer;
    return `slides for next not ready on ${label(M)}` + (t && fs.some(f => f.key === t.key) ? ` (sending ${t.size ? Math.floor(t.acked / t.size * 100) : 0}%)` : '');
  }
  // What each receiver page shows about its machine
  function infoAll() {
    const list = deckList();
    for (const M of machines.values()) {
      if (!M.receiver) continue;
      const strays = [...loose].map(p => ({ name: p.pp.name || 'PowerPoint', inbox: p.pp.inbox || '' }));
      const msg = { t: 'pp-info', player: M.player ? label(M) : '', unpaired: !M.player && loose.size > 0, strays: M.player ? [] : strays,
        ready: list.filter(d => M.prepared.has(d.key)).length, total: list.length };
      const sig = JSON.stringify(msg);
      if (M.receiver.pp.infoSent !== sig) { M.receiver.pp.infoSent = sig; M.receiver.peer.send(msg); }
    }
  }
  // Bus variables (Companion and the like): the first machine is the one reported
  let lastVars = '';
  function announce() {
    const s = summary().filter(x => x.player);
    const first = s[0];
    const fs = nextFiles();
    const vars = {
      pptx_machines: String(s.length),
      pptx_current: first && first.current ? first.current.replace(/ ~[0-9a-z]{1,6}(?=\.\w+$)/, '') : '',
      pptx_showing: first && first.showing ? '1' : '0',
      pptx_next_ready: fs.length ? ([...machines.values()].every(M => fs.every(f => M.prepared.has(f.key))) && machines.size ? '1' : '0') : '',
    };
    const v = JSON.stringify(vars);
    if (v !== lastVars && window.timerAPI && window.timerAPI.send) { lastVars = v; window.timerAPI.send({ setVariableValues: vars }); }
  }
  function opened() { lastVars = ''; announce(); }

  window.pptxHub = { join, leave, message, mode, changed, start, current, close, summary, describe, hint, opened, fileName,
    get count() { return machines.size + loose.size; } };
})();
