/*!
 * runsheet-editor.js
 * Run sheet editor window. Edits the sheet (localStorage.runsheet) and sends
 * commands to the timer window (localStorage.runsheet_cmd). Show state and the
 * live status are written by runsheet.js in the timer window; this page only reads them.
 *
 * Remote mode (runsheet.html?remote inside remote.html, on a computer that controls a timer
 * elsewhere): the same editor, but the sheet, state and status come from the page around it
 * (postMessage, relayed from the timer over the phone-control link) and edits and commands go
 * back the same way. This computer's own localStorage and video store aren't touched. Videos
 * are sent to the timer's computer, and only over a direct (same network) link.
 * MIT Licensed
 */

/* global RunsheetCore, HelpOverlay */

(function () {
  'use strict';

  const C = RunsheetCore;
  const SHEET_KEY = 'runsheet', STATE_KEY = 'runsheet_state', CMD_KEY = 'runsheet_cmd', LIVE_KEY = 'runsheet_live';
  const ON_TIME_SEC = 30;
  const $ = id => document.getElementById(id);
  const readJSON = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (_) { return def; } };

  const REMOTE = new URLSearchParams(location.search).has('remote') && window.parent !== window;
  const toParent = msg => window.parent.postMessage(msg, location.origin);
  let link = { online: false, lan: false };          // remote mode: the link to the timer

  let sheet = REMOTE ? { title: '', perItem: 20, items: [] } : readJSON(SHEET_KEY, { title: '', perItem: 20, items: [] });
  let state = REMOTE ? {} : readJSON(STATE_KEY, {});
  let live = REMOTE ? {} : readJSON(LIVE_KEY, {});
  let norm;

  // Older/hand-made sheets may lack ids
  sheet.items.forEach(it => { if (!it.id) it.id = C.newId(); });
  if (!sheet.perItem) sheet.perItem = 20;

  // ─── Storage plumbing ─────────────────────────────────────────────────────

  // Saves now, re-renders on the next tick. Deferring matters: a cell's 'change' fires while
  // focus is moving (Tab), and rebuilding the table synchronously would drop the new focus.
  let renderPending = false;
  function saveSheet() {
    if (REMOTE) toParent({ t: 'rs-save', sheet });
    else localStorage.setItem(SHEET_KEY, JSON.stringify(sheet));
    if (!renderPending) {
      renderPending = true;
      setTimeout(() => { renderPending = false; renderAll(); }, 0);
    }
  }

  function send(cmd, extra) {
    if (REMOTE) { toParent(Object.assign({ t: 'rs-cmd', cmd }, extra || {})); return; }
    localStorage.setItem(CMD_KEY, JSON.stringify(Object.assign({ cmd, nonce: Date.now() + Math.random() }, extra || {})));
  }

  window.addEventListener('storage', ev => {
    if (REMOTE) return;                              // this computer's own timer, not the one being edited
    if (ev.key === SHEET_KEY) {
      sheet = readJSON(SHEET_KEY, sheet);
      renderAll();
    } else if (ev.key === STATE_KEY) {
      state = readJSON(STATE_KEY, {});
      renderStatus();
    } else if (ev.key === LIVE_KEY) {
      live = readJSON(LIVE_KEY, {});
      renderLive();
    }
  });

  // Is a timer (controller) window alive? It writes a heartbeat every second.
  // Is a timer window running the run sheet? runsheet.js writes runsheet_alive every second.
  // (Not the timer's controller_tab_ heartbeat: that stops when the timer window is switched
  // to presenter mode with P, but the run sheet still runs there.)
  function controllerAlive() {
    if (REMOTE) return link.online;
    return Date.now() - Number(localStorage.getItem('runsheet_alive') || 0) < 4000;
  }

  // Remote mode: data from the timer, via the page around this one
  if (REMOTE) {
    window.addEventListener('message', e => {
      if (e.origin !== location.origin || e.source !== window.parent || !e.data || typeof e.data !== 'object') return;
      const m = e.data;
      if (m.t === 'rs-data') {
        if (m.sheet && Array.isArray(m.sheet.items)) {
          sheet = m.sheet;
          sheet.items.forEach(it => { if (!it.id) it.id = C.newId(); });
          if (!sheet.perItem) sheet.perItem = 20;
        }
        if (m.state) { state = m.state; state.history = new Array(Math.min(1000, m.state.historyLen || 0)); }
        if (m.live) live = m.live;
        if (m.sheet) renderAll(); else { renderStatus(); renderLive(); }
      } else if (m.t === 'rs-link') {
        link = { online: !!m.online, lan: !!m.lan };
        renderLive();
      } else if (m.t === 'rs-vprog') {
        const deck = m.kind === 'deck';
        (deck ? deckSending : sending).set(m.id, m.pct);
        const cell = document.querySelector(`#rs-table tr[data-id="${m.id}"] td.${deck ? 'deck' : 'vid'} .vbusy`);
        if (cell) cell.textContent = `sending ${deck ? 'slides' : 'video'}… ${m.pct}%`;
      } else if (m.t === 'rs-vend') {
        if (m.kind === 'deck') { deckSending.delete(m.id); deckBusy.delete(m.id); }
        else { sending.delete(m.id); busy.delete(m.id); }
        if (m.error) alert(m.error);
        renderAll();
      }
    });
  }

  // ─── Planned times (mirrors runsheet.js) ──────────────────────────────────

  function dayBase() {
    if (state.dayBase != null) return state.dayBase;
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  function plannedMs(sec) {
    if (sec == null) return null;
    if (norm.anchored) return dayBase() + sec * 1000;
    const log = state.log || [];
    const first = log.find(e => e.id !== 'end');
    const fi = first ? norm.items.findIndex(it => it.id === first.id) : -1;
    if (fi < 0) return null;
    return first.actual + (sec - norm.items[fi].planned) * 1000;
  }
  function clockOf(ms) {
    if (ms == null) return '';
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function signed(sec) {
    if (sec == null || Math.abs(sec) < ON_TIME_SEC) return '';
    return (sec > 0 ? '+' : '−') + C.formatSpan(sec);
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  function renderAll() {
    norm = C.normalise(sheet);
    if (document.activeElement !== $('title')) $('title').value = sheet.title || '';
    if (document.activeElement !== $('per-item')) $('per-item').value = sheet.perItem || 20;
    document.title = 'Run sheet' + (sheet.title ? ' — ' + sheet.title : '');
    renderTable();
    renderStatus();
    renderLive();
  }

  const FIELDS = ['start', 'name', 'duration'];

  function renderTable() {
    // Keep focus (and any half-typed value) across the rebuild
    const ae = document.activeElement;
    const focus = ae && ae.dataset && ae.dataset.field
      ? { id: ae.closest('tr').dataset.id, field: ae.dataset.field, value: ae.value, s: ae.selectionStart, e: ae.selectionEnd }
      : null;

    const tbody = document.querySelector('#rs-table tbody');
    tbody.innerHTML = '';
    norm.items.forEach((it, i) => {
      const src = sheet.items[i];
      const tr = document.createElement('tr');
      tr.dataset.id = it.id;
      if (it.isEnd) tr.classList.add('endrow');
      tr.innerHTML =
        `<td class="num">${it.isEnd ? 'End' : i + 1}</td>` +
        `<td class="start"><input data-field="start" aria-label="Start time"></td>` +
        `<td class="name"><input data-field="name" aria-label="Item name"></td>` +
        `<td class="vid"></td><td class="deck"></td>` +
        `<td class="dur"><input data-field="duration" aria-label="Duration"></td>` +
        `<td class="ends"></td><td class="status"></td>` +
        `<td class="acts">` +
          // tabindex -1: Tab moves between the cells (start → name → duration → next row)
          (it.isEnd ? '' : `<button class="go" data-act="go" tabindex="-1" title="Start this item now">▶</button>`) +
          `<button data-act="up" tabindex="-1" title="Move up">↑</button><button data-act="down" tabindex="-1" title="Move down">↓</button>` +
          `<button data-act="del" tabindex="-1" title="Delete">✕</button></td>`;
      const [start, name, dur] = FIELDS.map(f => tr.querySelector(`[data-field=${f}]`));
      start.value = src.start != null ? C.formatClock(src.start) : '';
      name.value = src.name || '';
      dur.value = src.duration != null ? C.formatDuration(src.duration) : '';
      name.placeholder = 'Item name';
      if (!it.isEnd) { renderVideoCell(tr.querySelector('td.vid'), src); renderDeckCell(tr.querySelector('td.deck'), src); }
      dur.placeholder = it.isEnd ? 'finish' :
        C.formatDuration(it.eff) + (it.durSource === 'times' ? ' (from times)' : it.durSource === 'default' ? ' (default)' : '');
      tbody.appendChild(tr);
    });
    $('empty').style.display = norm.items.length ? 'none' : '';

    if (focus) {
      const el = tbody.querySelector(`tr[data-id="${focus.id}"] [data-field="${focus.field}"]`);
      if (el) {
        el.value = focus.value;
        el.focus();
        try { el.setSelectionRange(focus.s, focus.e); } catch (_) { /* not a text input */ }
      }
    }
  }

  // Row highlights, status column and times that depend on the show's progress.
  function renderStatus() {
    const log = state.log || [];
    const lastById = {};
    log.forEach((e, k) => { lastById[e.id] = k; });
    const active = !!state.active && norm.items.length > 0;
    const curId = !state.finished && state.index >= 0 ? state.currentId : null;
    let nextId = null;
    if (active && !state.finished) {
      for (let j = (state.index == null ? -1 : state.index) + 1; j < norm.items.length; j++) {
        if (j !== norm.endIdx) { nextId = norm.items[j].id; break; }
      }
    }

    document.querySelectorAll('#rs-table tbody tr').forEach(tr => {
      const i = norm.items.findIndex(it => it.id === tr.dataset.id);
      const it = norm.items[i];
      if (!it) return;
      const p = plannedMs(it.planned);
      tr.querySelector('[data-field=start]').placeholder = p != null ? clockOf(p) : '';
      tr.querySelector('.ends').textContent = it.isEnd || p == null ? '' : clockOf(p + it.eff * 1000);

      const k = lastById[it.id];
      const done = k != null && it.id !== curId;
      tr.classList.toggle('current', it.id === curId);
      tr.classList.toggle('done', done);
      tr.classList.toggle('next', it.id === nextId);

      const status = tr.querySelector('.status');
      if (it.id === curId) {
        const e = log[k];
        const v = e && e.planned != null ? signed((e.actual - e.planned) / 1000) : '';
        status.innerHTML = `<span class="st-now">▶ Now</span> ${clockOf(e && e.actual)} ` +
          (v ? `<span class="${v[0] === '+' ? 'st-late' : 'st-early'}">${v}</span>` : '');
      } else if (done) {
        const e = log[k], ran = log[k + 1] ? (log[k + 1].actual - e.actual) / 1000 : null;
        const v = e.planned != null ? signed((e.actual - e.planned) / 1000) : '';
        status.innerHTML = `✓ ${clockOf(e.actual)} ` + (v ? `<span class="${v[0] === '+' ? 'st-late' : 'st-early'}">${v}</span> ` : '') +
          (ran != null ? `· ${C.formatSpan(ran)}` : '');
      } else if (it.isEnd && state.finished) {
        const e = log[log.length - 1];
        const v = e && e.planned != null ? signed((e.actual - e.planned) / 1000) : '';
        status.innerHTML = `■ ${clockOf(e && e.actual)} ` + (v ? `<span class="${v[0] === '+' ? 'st-late' : 'st-early'}">${v}</span>` : '');
      } else if (it.gapAfter > 59 || it.gapAfter < -59) {
        status.innerHTML = `<span class="st-gap">${it.gapAfter > 0 ? 'gap' : 'overlaps'} ${C.formatDuration(Math.abs(it.gapAfter))}</span>`;
      } else {
        status.textContent = '';
      }
      tr.querySelectorAll('button.go').forEach(b => { b.disabled = !active; });
      // Order is fixed up to and including the item running now, and nothing moves above it:
      // the dashboard, the phones and the log all follow the live order. To stop an item,
      // delete it instead.
      const lock = moveLock(i);
      const up = tr.querySelector('button[data-act=up]'), down = tr.querySelector('button[data-act=down]');
      up.disabled = !!lock || i === 0; down.disabled = lock === 'ran' || lock === 'now' || i === norm.items.length - 1;
      up.title = lock ? LOCK_TEXT[lock] : 'Move up';
      down.title = lock === 'ran' || lock === 'now' ? LOCK_TEXT[lock] : 'Move down';
    });

    // Transport
    $('active').checked = !!state.active;
    $('btn-next').disabled = !active || !!state.finished;
    $('btn-back').disabled = !active || !(state.history && state.history.length);   // (remote: a stand-in array of the right length)
    const cur = norm.items.find(it => it.id === curId);
    const nxt = norm.items.find(it => it.id === nextId);
    const parts = [];
    if (state.finished) parts.push('<b>Show finished</b>');
    else if (cur) parts.push(`Now: <b>${esc(cur.name)}</b>`);
    else if (active) parts.push('Not started');
    if (nxt) parts.push(`Next: <b>${esc(nxt.name)}</b>`);
    else if (active && !state.finished && norm.items.length) {
      parts.push(norm.endIdx >= 0 ? `Next: <b>${esc(norm.items[norm.endIdx].name)}</b> (finish)` : 'Next: <b>end of show</b>');
    }
    if (!active && norm.items.length) parts.push('Run sheet mode is off');
    $('now-next').innerHTML = parts.join(' &nbsp;·&nbsp; ');

    renderLog();
  }

  // Why item i can't move: 'ran' (already run), 'now' (running), 'next' (can't go above the
  // running item), or null
  const LOCK_TEXT = { ran: 'This item has already run; the order up to now is fixed', now: 'This item is running now',
    next: 'Can’t move an item above the one running now; delete it instead' };
  function moveLock(i) {
    if (!state.active || !norm.items.length) return null;
    if (state.finished) return 'ran';
    const cur = state.index >= 0 && state.currentId ? norm.items.findIndex(it => it.id === state.currentId) : -1;
    if (cur < 0) return null;
    if (i < cur) return 'ran';
    if (i === cur) return 'now';
    if (i === cur + 1) return 'next';
    return null;
  }

  function renderLive() {
    const el = $('live');
    el.textContent = state.active ? (live.text || '') : '';
    el.className = live.kind || '';
    $('conn').classList.toggle('show', !controllerAlive());
    if (REMOTE) $('conn').textContent = 'Not connected to the timer right now: reconnecting… Changes made now may not reach it.';
  }

  function renderLog() {
    const log = state.log || [];
    const tbody = document.querySelector('#log-table tbody');
    tbody.innerHTML = '';
    log.forEach((e, k) => {
      const tr = document.createElement('tr');
      if (e.id === 'end') tr.className = 'finish';
      const ran = log[k + 1] ? (log[k + 1].actual - e.actual) / 1000 : null;
      const v = e.planned != null ? (e.actual - e.planned) / 1000 : null;
      tr.innerHTML = `<td class="item">${esc(e.name)}</td><td>${clockOf(e.planned)}</td><td>${clockOf(e.actual)}</td>` +
        `<td class="${v == null || Math.abs(v) < ON_TIME_SEC ? '' : v > 0 ? 'st-late' : 'st-early'}">${signed(v) || (v == null ? '' : 'on time')}</td>` +
        `<td>${e.id === 'end' ? '' : ran != null ? C.formatSpan(ran) + (e.plannedDur ? ' ' + signed(ran - e.plannedDur) : '') : 'running'}</td>`;
      tbody.appendChild(tr);
    });
    $('log-empty').style.display = log.length ? 'none' : '';
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ─── Videos ───────────────────────────────────────────────────────────────
  // A video on an item plays when Next reaches it (runsheet.js); the item's name is the message.
  // The file is copied into the browser (video-store.js), so it survives restarts. item.video is
  // {key, name, size, duration}; item.videoIdle 'show' | 'hide' is what the player shows before
  // it plays (first frame or black).

  const noExt = n => String(n || '').replace(/\.[A-Za-z0-9]{1,5}$/, '') || String(n || '');
  const busy = new Set();                      // item ids whose video is being copied
  const sending = new Map();                   // remote mode: item id → % sent to the timer

  function renderVideoCell(td, item) {
    if (busy.has(item.id)) {
      td.innerHTML = `<span class="vbusy">${REMOTE ? `sending video… ${sending.get(item.id) || 0}%` : 'copying video…'}</span>`;
      return;
    }
    if (!item.video) {
      td.innerHTML = `<button class="vadd" data-act="vadd" tabindex="-1" title="Play a video for this item (or drop a video file on the row)">+ video</button>`;
      return;
    }
    const v = item.video;
    // Compact: the Item column already shows the name; the file name is in the tooltip
    td.innerHTML = `<span class="vicon">🎬</span> <span class="vdur"></span>` +
      `<select data-vidle tabindex="-1" title="Before it plays, the player shows the video's first frame, or black">` +
      `<option value="show">frame</option><option value="hide">black</option></select>` +
      `<button class="vdel" data-act="vdel" tabindex="-1" title="Remove the video">✕</button>`;
    td.title = 'Video: ' + v.name;
    td.querySelector('.vdur').textContent = v.duration ? C.formatDuration(v.duration) : '';
    td.querySelector('select').value = item.videoIdle === 'hide' ? 'hide' : 'show';
  }

  // Length of a video file, in seconds (from its metadata)
  function probeDuration(file) {
    return new Promise(resolve => {
      const el = document.createElement('video');
      const url = URL.createObjectURL(file);
      const done = d => { URL.revokeObjectURL(url); resolve(d); };
      el.preload = 'metadata';
      el.onloadedmetadata = () => done(isFinite(el.duration) ? el.duration : null);
      el.onerror = () => done(null);
      el.src = url;
      setTimeout(() => done(null), 15000);
    });
  }

  async function attachVideo(id, file) {
    const item = sheet.items.find(it => it.id === id);
    if (!item || !file) return;
    if (!/^video\//.test(file.type)) { alert('That isn’t a video file.'); return; }
    if (REMOTE) return sendVideo(id, file);
    if (!window.videoStore) { alert('Videos can’t be stored in this browser.'); return; }
    busy.add(id); renderAll();
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      const duration = await probeDuration(file);
      const key = 'rsvideo:' + id + ':' + Date.now();
      await window.videoStore.put(key, file);
      const it = sheet.items.find(x => x.id === id);          // the sheet may have been reloaded meanwhile
      if (!it) { window.videoStore.remove(key); return; }
      if (it.video) window.videoStore.remove(it.video.key).catch(() => {});
      const secs = duration ? Math.max(1, Math.floor(duration + 0.25)) : null;
      it.video = { key, name: noExt(file.name), size: file.size, duration: secs };
      if (!it.videoIdle) it.videoIdle = 'show';
      if (!it.name) it.name = noExt(file.name);
      if (it.duration == null && secs) it.duration = secs;    // the item runs as long as the video
      saveSheet();
    } catch (err) {
      alert('Couldn’t store the video in this browser: ' + (err && err.message || err) +
        '\n(Is the disk full? Browsers can only use part of the free space.)');
    } finally {
      busy.delete(id);
      renderAll();
    }
  }

  // Remote mode: the file goes to the timer's computer, straight over the local network. Never
  // through the pairing server: on a link through it, adding videos is refused.
  async function sendVideo(id, file) {
    if (!link.online) { alert('Not connected to the timer right now.'); return; }
    if (!link.lan) {
      alert('Videos can only be sent to the timer over a direct link on the same network, and this computer is connected through the server.\n\n' +
        'Use the same Wi-Fi or network as the timer’s computer (the badge at the top shows ⚡ LAN direct), or add the video on the timer’s computer.');
      return;
    }
    if (busy.size) { alert('Wait for the video being sent to finish first.'); return; }
    busy.add(id); sending.set(id, 0); renderAll();
    const duration = await probeDuration(file);
    toParent({ t: 'rs-video', id, file, name: noExt(file.name), duration });
  }

  function removeVideo(id) {
    const item = sheet.items.find(it => it.id === id);
    if (!item || !item.video) return;
    if (!confirm(`Remove the video "${item.video.name}" from this item?`)) return;
    if (!REMOTE) window.videoStore && window.videoStore.remove(item.video.key).catch(() => {});   // remote: the timer tidies up
    delete item.video; delete item.videoIdle;
    saveSheet();
  }

  // ─── Slides (PowerPoint decks) ─────────────────────────────────────────────
  // A deck on an item opens on the PowerPoint computers when Next reaches it (pptx-hub.js sends
  // it to them ahead of time). Kept in the browser like videos: item.deck {key, name, size},
  // key 'rsdeck:<item id>:<time>'; name is the file name, extension included.
  const DECK_RE = /\.(pptx|ppsx|pptm|ppsm|ppt|pps|potx)$/i;
  const isDeck = f => !!f && DECK_RE.test(f.name || '');
  const deckBusy = new Set();
  const deckSending = new Map();
  function renderDeckCell(td, item) {
    if (deckBusy.has(item.id)) {
      td.innerHTML = `<span class="vbusy">${REMOTE ? `sending slides… ${deckSending.get(item.id) || 0}%` : 'copying slides…'}</span>`;
      return;
    }
    if (!item.deck) {
      td.innerHTML = `<button class="dadd" data-act="dadd" tabindex="-1" title="Open a PowerPoint deck on the PowerPoint computers when this item starts (or drop a .pptx file on the row)">+ slides</button>`;
      return;
    }
    td.innerHTML = `<span class="vicon">📊</span> <span class="dname"></span>` +
      `<button class="ddel" data-act="ddel" tabindex="-1" title="Remove the slides">✕</button>`;
    td.title = 'Slides: ' + item.deck.name;
    td.querySelector('.dname').textContent = noExt(item.deck.name);
  }
  async function attachDeck(id, file) {
    const item = sheet.items.find(it => it.id === id);
    if (!item || !file) return;
    if (!isDeck(file)) { alert('That isn’t a PowerPoint file (.pptx, .ppsx, .ppt …).'); return; }
    if (REMOTE) return sendDeck(id, file);
    if (!window.videoStore) { alert('Slides can’t be stored in this browser.'); return; }
    deckBusy.add(id); renderAll();
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      const key = 'rsdeck:' + id + ':' + Date.now();
      await window.videoStore.put(key, file);
      const it = sheet.items.find(x => x.id === id);
      if (!it) { window.videoStore.remove(key); return; }
      if (it.deck) window.videoStore.remove(it.deck.key).catch(() => {});
      it.deck = { key, name: String(file.name).slice(0, 200), size: file.size };
      if (!it.name) it.name = noExt(file.name);
      saveSheet();
    } catch (err) {
      alert('Couldn’t store the slides in this browser: ' + (err && err.message || err));
    } finally {
      deckBusy.delete(id);
      renderAll();
    }
  }
  // Remote mode: like videos, straight to the timer's computer over the local network only
  function sendDeck(id, file) {
    if (!link.online) { alert('Not connected to the timer right now.'); return; }
    if (!link.lan) {
      alert('Slides can only be sent to the timer over a direct link on the same network, and this computer is connected through the server.\n\n' +
        'Use the same Wi-Fi or network as the timer’s computer (the badge at the top shows ⚡ LAN direct), or add the slides on the timer’s computer.');
      return;
    }
    if (busy.size || deckBusy.size) { alert('Wait for the file being sent to finish first.'); return; }
    deckBusy.add(id); deckSending.set(id, 0); renderAll();
    toParent({ t: 'rs-video', kind: 'deck', id, file, name: String(file.name).slice(0, 200) });
  }
  function removeDeck(id) {
    const item = sheet.items.find(it => it.id === id);
    if (!item || !item.deck) return;
    if (!confirm(`Remove the slides “${item.deck.name}” from this item?`)) return;
    if (!REMOTE) window.videoStore && window.videoStore.remove(item.deck.key).catch(() => {});
    delete item.deck;
    saveSheet();
  }
  const deckPicker = document.createElement('input');
  deckPicker.type = 'file'; deckPicker.accept = '.pptx,.ppsx,.pptm,.ppsm,.ppt,.pps,.potx'; deckPicker.hidden = true;
  document.body.appendChild(deckPicker);
  deckPicker.addEventListener('change', () => { const f = deckPicker.files[0]; deckPicker.value = ''; if (f && pickFor) attachDeck(pickFor, f); });

  // Videos and slides no longer used by the sheet (rows deleted, sheet replaced) are removed from the browser
  function cleanUpVideos() {
    if (REMOTE || !window.videoStore) return;
    const used = new Set(sheet.items.filter(it => it.video).map(it => it.video.key));
    sheet.items.forEach(it => { if (it.deck) used.add(it.deck.key); });
    // Videos in the timer's Recent videos list stay until they drop off it (video-library.js)
    try { (JSON.parse(localStorage.getItem('video_history') || '[]') || []).forEach(e => { if (e && e.key) used.add(e.key); }); } catch (_) { /* ignore */ }
    window.videoStore.keys().then(keys => keys.forEach(k => {
      if ((String(k).startsWith('rsvideo:') || String(k).startsWith('rsdeck:')) && !used.has(k)) window.videoStore.remove(k).catch(() => {});
    })).catch(() => {});
  }

  // One hidden file picker, shared by the rows
  const picker = document.createElement('input');
  picker.type = 'file'; picker.accept = 'video/*'; picker.hidden = true;
  document.body.appendChild(picker);
  let pickFor = null;
  picker.addEventListener('change', () => { const f = picker.files[0]; picker.value = ''; if (f && pickFor) attachVideo(pickFor, f); });

  // Drop a video file on a row to attach it
  const tbodyEl = document.querySelector('#rs-table tbody');
  tbodyEl.addEventListener('dragover', e => {
    const tr = e.target.closest('tr');
    if (!tr || tr.classList.contains('endrow') || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    tbodyEl.querySelectorAll('tr.vdrop').forEach(r => r !== tr && r.classList.remove('vdrop'));
    tr.classList.add('vdrop');
  });
  tbodyEl.addEventListener('dragleave', e => { const tr = e.target.closest('tr'); if (tr && !tr.contains(e.relatedTarget)) tr.classList.remove('vdrop'); });
  tbodyEl.addEventListener('drop', e => {
    const tr = e.target.closest('tr');
    tbodyEl.querySelectorAll('tr.vdrop').forEach(r => r.classList.remove('vdrop'));
    if (!tr || tr.classList.contains('endrow')) return;
    const list = Array.from(e.dataTransfer.files || []);
    const f = list.find(x => x.type.startsWith('video/')) || list.find(isDeck);
    if (!f) return;
    e.preventDefault();
    if (isDeck(f) && !f.type.startsWith('video/')) attachDeck(tr.dataset.id, f); else attachVideo(tr.dataset.id, f);
  });
  // Before-play setting
  tbodyEl.addEventListener('change', e => {
    if (!e.target.matches('select[data-vidle]')) return;
    const item = sheet.items.find(it => it.id === e.target.closest('tr').dataset.id);
    if (item) { item.videoIdle = e.target.value === 'hide' ? 'hide' : 'show'; saveSheet(); }
  });

  // ─── Table editing ────────────────────────────────────────────────────────

  const tbody = document.querySelector('#rs-table tbody');

  tbody.addEventListener('change', e => {
    const input = e.target;
    const field = input.dataset.field;
    if (!field) return;
    const item = sheet.items.find(it => it.id === input.closest('tr').dataset.id);
    if (!item) return;
    if (field === 'name') {
      item.name = input.value.trim();
    } else {
      const v = field === 'start' ? C.parseClock(input.value) : C.parseDuration(input.value);
      if (Number.isNaN(v)) {
        input.classList.add('invalid');
        input.title = field === 'start' ? 'Couldn’t read that time — try 9:30, 9:30am or 14:00' : 'Couldn’t read that duration — try 20, 1:30, 20 min or 1 h 30 min';
        return;
      }
      input.classList.remove('invalid');
      input.title = '';
      item[field] = v;
    }
    saveSheet();
  });

  // Enter moves to the same field in the next row; on the last row it adds a new item
  tbody.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.dataset.field) return;
    e.preventDefault();
    const field = e.target.dataset.field;
    const tr = e.target.closest('tr');
    const nextTr = tr.nextElementSibling;
    e.target.blur();                                         // commits via 'change'
    const id = nextTr ? nextTr.dataset.id : null;
    setTimeout(() => {
      if (id) {
        document.querySelector(`#rs-table tr[data-id="${id}"] [data-field="${field}"]`)?.focus();
      } else if (field === 'name') {
        addItem();
      }
    }, 0);
  });

  tbody.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('tr').dataset.id;
    const i = sheet.items.findIndex(it => it.id === id);
    if (i < 0) return;
    switch (btn.dataset.act) {
      case 'vadd':
        pickFor = id; picker.click();
        break;
      case 'vdel':
        removeVideo(id);
        break;
      case 'dadd':
        pickFor = id; deckPicker.click();
        break;
      case 'ddel':
        removeDeck(id);
        break;
      case 'go':
        send('goto', { id });
        break;
      case 'up':
        if (i > 0 && !moveLock(i)) { [sheet.items[i - 1], sheet.items[i]] = [sheet.items[i], sheet.items[i - 1]]; saveSheet(); }
        break;
      case 'down':
        if (i < sheet.items.length - 1 && !['ran', 'now'].includes(moveLock(i))) { [sheet.items[i + 1], sheet.items[i]] = [sheet.items[i], sheet.items[i + 1]]; saveSheet(); }
        break;
      case 'del':
        if (id === state.currentId && !state.finished && !confirm('This item is running now. Delete it anyway?')) return;
        if (sheet.items[i].video && !confirm(`This item has a video ("${sheet.items[i].video.name}"). Delete the item and its video?`)) return;
        if (sheet.items[i].deck && !confirm(`This item has slides ("${sheet.items[i].deck.name}"). Delete the item and its slides?`)) return;
        sheet.items.splice(i, 1);
        saveSheet();
        cleanUpVideos();
        break;
    }
  });

  function addItem() {
    const it = { id: C.newId(), name: '', start: null, duration: null };
    sheet.items.push(it);
    saveSheet();
    setTimeout(() => document.querySelector(`#rs-table tr[data-id="${it.id}"] [data-field=name]`)?.focus(), 0);
  }
  $('add-row').addEventListener('click', addItem);

  $('title').addEventListener('change', e => { sheet.title = e.target.value.trim(); saveSheet(); });
  $('per-item').addEventListener('change', e => {
    const v = parseFloat(e.target.value);
    if (v > 0) { sheet.perItem = v; saveSheet(); }
  });

  // ─── Import / export ──────────────────────────────────────────────────────

  function importText(mode) {
    const text = $('imp-text').value;
    const msg = $('imp-msg');
    const res = C.parseText(text);
    if (!res.items.length) {
      msg.className = 'warn';
      msg.textContent = 'Nothing to add — paste some rows first.';
      return;
    }
    if (mode === 'replace' && sheet.items.length && !confirm(`Replace all ${sheet.items.length} items with the ${res.items.length} pasted?`)) return;
    sheet.items = mode === 'replace' ? res.items : sheet.items.concat(res.items);
    saveSheet();
    if (mode === 'replace' && (state.log || []).length && confirm('Also reset the show? This clears the log and starts again from the top.')) send('reset');

    const cols = Array.isArray(res.columns) ? res.columns.filter(Boolean).join(', ') : 'one item per line';
    msg.className = res.warnings.length ? 'warn' : 'ok';
    msg.textContent = `${mode === 'replace' ? 'Loaded' : 'Added'} ${res.items.length} item${res.items.length === 1 ? '' : 's'} (read as: ${cols}).` +
      (res.warnings.length ? '\n' + res.warnings.slice(0, 5).join('\n') : '');
    $('imp-text').value = '';
  }
  $('imp-replace').addEventListener('click', () => importText('replace'));
  $('imp-append').addEventListener('click', () => importText('append'));

  $('imp-file').addEventListener('click', () => $('imp-file-input').click());
  $('imp-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      $('imp-text').value = reader.result;
      const msg = $('imp-msg');
      msg.className = 'ok';
      msg.textContent = `Opened ${file.name}. Choose Replace sheet or Append.`;
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const fileBase = () => (sheet.title || 'runsheet').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'runsheet';

  $('csv-export').addEventListener('click', () => download(fileBase() + '.csv', C.toCSV(sheet)));

  $('standardise').addEventListener('click', () => {
    if (!sheet.items.length) return;
    if (!confirm('Write the calculated start times and durations into every row?')) return;
    sheet = C.standardise(sheet);
    saveSheet();
  });

  $('clear-all').addEventListener('click', () => {
    if (!sheet.items.length || !confirm('Delete every item in the run sheet?')) return;
    sheet.items = [];
    saveSheet();
  });

  $('log-export').addEventListener('click', () => {
    const log = state.log || [];
    const rows = [['Item', 'Planned start', 'Actual start', 'Start variance', 'Planned duration', 'Actual duration', 'Duration variance']];
    log.forEach((e, k) => {
      const ran = log[k + 1] ? (log[k + 1].actual - e.actual) / 1000 : null;
      const sv = e.planned != null ? (e.actual - e.planned) / 1000 : null;
      const fmtSigned = s => s == null ? '' : (s < 0 ? '-' : '+') + C.formatHMS(Math.abs(s));
      rows.push([
        e.name, clockOf(e.planned), clockOf(e.actual), fmtSigned(sv),
        e.id === 'end' ? '' : C.formatHMS(e.plannedDur || 0),
        ran == null || e.id === 'end' ? '' : C.formatHMS(ran),
        ran == null || e.id === 'end' ? '' : fmtSigned(ran - (e.plannedDur || 0)),
      ]);
    });
    download(fileBase() + '-log.csv', rows.map(r => r.map(C.csvCell).join(',')).join('\r\n') + '\r\n');
  });

  // ─── Transport ────────────────────────────────────────────────────────────

  $('btn-next').addEventListener('click', () => send('next'));
  $('btn-back').addEventListener('click', () => send('back'));
  $('btn-reset').addEventListener('click', () => {
    if (confirm('Reset the show? This clears the log and goes back to before the first item. The timer itself is not changed.')) send('reset');
  });
  $('active').addEventListener('change', e => send('active', { on: e.target.checked }));

  // A presentation clicker pointed at this window should still drive the show
  document.addEventListener('keydown', e => {
    if (e.key !== 'PageDown' && e.key !== 'PageUp') return;
    if (e.target && e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    if (e.repeat) return;
    send(e.key === 'PageDown' ? 'next' : 'back');
  });

  // ─── Help (README overlay, see help-overlay.js; ? / F1 also open it) ───────

  const help = HelpOverlay.install({ section: 'run-sheet' });
  $('btn-help').addEventListener('click', () => help.open('run-sheet'));

  // ─── Boot ─────────────────────────────────────────────────────────────────

  if (REMOTE) {
    document.title = 'Run sheet (remote)';
    const tag = document.createElement('span');
    tag.id = 'remote-tag';
    tag.textContent = 'Editing the timer on another computer';
    $('live').before(tag);
    toParent({ t: 'rs-ready' });
  }
  renderAll();
  setInterval(renderLive, 2000);
  setTimeout(cleanUpVideos, 3000);   // remove stored videos the sheet no longer uses
})();
