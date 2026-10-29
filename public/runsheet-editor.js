/*!
 * runsheet-editor.js
 * Run sheet editor window. Edits the sheet (localStorage.runsheet) and sends
 * commands to the timer window (localStorage.runsheet_cmd). Show state and the
 * live status are written by runsheet.js in the timer window; this page only reads them.
 *
 * Remote mode (runsheet.html?remote inside remote.html, on a computer that controls a timer
 * elsewhere): the same editor, but the sheet, state and status come from the page around it
 * (postMessage, relayed from the timer over the phone-control link) and edits and commands go
 * back the same way. This computer's own localStorage and video store aren't touched (except for
 * the editor's own Options preference). Videos are sent to the timer's computer, and only over a
 * direct (same network) link.
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
  let showHidden = false;                            // show the completed items deleted (hidden) from the sheet
  let norm;                                          // the sheet as shown: normalise(view)
  let view;                                          // the sheet as shown: the sheet, or a scaling preview of it

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
      renderStatus();                                // expected times follow the lateness
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
        const deck = m.kind === 'deck' || m.kind === 'holding';
        (deck ? deckSending : sending).set(m.id, m.pct);
        const cell = document.querySelector(`#rs-table tr[data-id="${m.id}"] td.${deck ? 'deck' : 'vid'} .vbusy`);
        if (cell) cell.textContent = deck ? `sending… ${m.pct}%` : `sending video… ${m.pct}%`;
      } else if (m.t === 'rs-vend') {
        if (m.kind === 'deck' || m.kind === 'holding') { deckSending.delete(m.id); deckBusy.delete(m.id); }
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
  // n: the normalised sheet the time belongs to (default the one shown; scaling previews pass theirs)
  function plannedMs(sec, n) {
    n = n || norm;
    if (sec == null) return null;
    if (n.anchored) return dayBase() + sec * 1000;
    if (provisional(n)) {                              // not started: as if it started now
      const f = n.items.find(x => !x.hidden);
      return f ? editorNow() + (sec - f.planned) * 1000 : null;
    }
    const log = state.log || [];
    const first = log.find(e => e.id !== 'end');
    const fi = first ? n.items.findIndex(it => it.id === first.id) : -1;
    if (fi < 0) return null;
    return (first.orig != null ? first.orig : first.actual) + (sec - n.items[fi].planned) * 1000;   // orig: before a Restart
  }
  // A sheet without start times that hasn't started yet: its times count from now (they move on
  // as the clock does, until the first Next pins them to when the show really began)
  function provisional(n) {
    n = n || norm;
    return !n.anchored && !state.finished && !(state.log || []).some(e => e.id !== 'end');
  }
  function clockOf(ms) {
    if (ms == null) return '';
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function clockSec(ms) {
    if (ms == null) return '';
    const d = new Date(ms);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(v => String(v).padStart(2, '0')).join(':');
  }
  // While an item is running: when it's due to end (its countdown, as runsheet.js reports it;
  // now, if it's over) and when each item after it should start (as runsheet.js works it out)
  function projNow(n) {
    n = n || norm;
    const cur = liveIndex();
    if (cur < 0) return null;
    const log = state.log || [], e = log[log.length - 1];
    const timerEnd = live.curId && live.curId === state.currentId ? live.curEnd : null;
    const end = timerEnd != null ? Math.max(timerEnd, editorNow()) : e && e.id === state.currentId ? e.actual + n.items[cur].eff * 1000 : null;
    return end == null ? null : { end, proj: C.project(n, cur, end, sec => plannedMs(sec, n)) };
  }
  function signed(sec) {
    if (sec == null || Math.abs(sec) < ON_TIME_SEC) return '';
    return (sec > 0 ? '+' : '−') + C.formatSpan(sec);
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  function renderAll() {
    norm = C.normalise(sheet);
    view = sheet;
    prunePicked();
    scaling = previewing();
    if (scaling) { view = scaledCopy(norm); norm = C.normalise(view); }
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
    const nHidden = view.items.filter(x => x.hidden).length;
    if (!nHidden) showHidden = false;
    $('show-hidden').hidden = !nHidden;
    $('show-hidden').textContent = showHidden ? `Hide the ${nHidden} deleted` : `Show ${nHidden} deleted (already run)`;
    norm.items.forEach((it, i) => {
      const src = view.items[i];
      if (src.hidden && !showHidden) return;       // deleted after it ran: kept for the record
      const tr = document.createElement('tr');
      tr.dataset.id = it.id;
      if (it.isEnd) tr.classList.add('endrow');
      if (src.hidden) tr.classList.add('hiddenrow');
      tr.innerHTML =
        `<td class="num">${it.isEnd ? 'End' : i + 1}</td>` +
        `<td class="start"><input data-field="start" aria-label="Start time"></td>` +
        `<td class="name"><input data-field="name" aria-label="Item name"></td>` +
        `<td class="vid"></td><td class="deck"></td>` +
        `<td class="dur"><input data-field="duration" aria-label="Duration"></td>` +
        `<td class="ends">${it.isEnd ? '' : '<input data-field="end" aria-label="End time">'}</td><td class="status"></td>` +
        `<td class="acts">` +
          // tabindex -1: Tab moves between the cells (start → name → duration → next row)
          (it.isEnd ? '' : `<button class="go" data-act="go" tabindex="-1" title="Start this item now">▶</button>`) +
          `<button data-act="up" tabindex="-1" title="Move up">↑</button><button data-act="down" tabindex="-1" title="Move down">↓</button>` +
          (src.hidden ? `<button data-act="unhide" tabindex="-1" title="Show it in the run sheet again">↺</button>`
                      : `<button data-act="del" tabindex="-1" title="Delete">✕</button>`) + `</td>`;
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
    if (picked.size && prunePicked()) { renderAll(); return; }   // the show moved on to a selected row
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

    // Once the show is under way the Start and Ends columns are what happened (started items)
    // and what's expected (the rest, see projNow()); planned times move to the Status column.
    const curIdx = curId ? norm.items.findIndex(it => it.id === curId) : (state.index == null ? -1 : state.index);
    const curEnd = live.curId && live.curId === curId ? live.curEnd : null;
    const pn = projNow(), proj = pn && pn.proj;
    const focused = document.activeElement;
    const show = (inp, value, placeholder) => {
      if (!inp) return;
      if (inp !== focused && !inp.classList.contains('invalid')) inp.value = value;   // not under the user's fingers
      inp.placeholder = placeholder;
    };

    document.querySelectorAll('#rs-table tbody tr').forEach(tr => {
      const i = norm.items.findIndex(it => it.id === tr.dataset.id);
      const it = norm.items[i];
      if (!it) return;
      const src = view.items[i];
      const p = plannedMs(it.planned);
      const k = lastById[it.id];
      const role = rowRole(i);
      const startIn = tr.querySelector('[data-field=start]');
      const endIn = tr.querySelector('[data-field=end]');   // worked out (start + duration), never stored; typing one sets the duration
      const typed = src.start != null ? C.formatClock(src.start) : '';
      // The next item starting before the current one is due to end (saved anyway, knowingly)
      const overlap = role === 'next' && src.start != null && curEnd != null && p != null ? (curEnd - p) / 1000 : 0;
      const x = proj ? proj.get(i) : undefined;
      if ((role === 'done' || role === 'now') && k != null) {
        const a = log[k].actual;                   // when it really started (Restart and ▶ included), to the second
        show(startIn, clockSec(a), '');
        if (role === 'now') show(endIn, '', clockOf(pn ? pn.end : a + it.eff * 1000));
        else show(endIn, log[k + 1] ? clockOf(log[k + 1].actual) : '', '');
      } else if (it.isEnd && state.finished && log.length) {
        show(startIn, clockSec(log[log.length - 1].actual), '');
      } else if (x != null) {
        // Expected: its own start time when that's what it waits for (or a clash saved knowingly)
        show(startIn, src.start != null && (x === p || overlap >= 1) ? typed : '', clockOf(x));
        show(endIn, '', clockOf(x + it.eff * 1000));
      } else {
        show(startIn, typed, p != null ? clockOf(p) : '');
        show(endIn, '', p == null ? '' : clockOf(p + it.eff * 1000));
      }

      const done = k != null && it.id !== curId;
      tr.classList.toggle('current', it.id === curId);
      tr.classList.toggle('done', done);
      tr.classList.toggle('next', it.id === nextId);

      // Completed items are kept as they happened; the item running now keeps its start
      tr.classList.toggle('locked', role === 'done' || it.hidden);
      tr.classList.toggle('picked', picked.has(it.id));
      tr.classList.toggle('scaled', scaling && picked.has(it.id));
      tr.querySelector('td.num').classList.toggle('pickable', canPick(i));
      tr.querySelector('td.num').title = canPick(i) ? 'Click to select it for scaling (Shift+click: a range)' : '';
      tr.querySelectorAll('input[data-field]').forEach(inp => {
        const ro = role === 'done' || it.hidden || (role === 'now' && inp.dataset.field === 'start');
        inp.readOnly = ro || scaling;
        inp.title = scaling ? 'Apply or cancel the scaling first' : ro ? (role === 'now' ? 'Running now: it started when it started' : 'Already run: kept as it happened') : (inp.classList.contains('invalid') ? inp.title : '');
      });
      tr.querySelectorAll('td.vid button, td.vid select, td.deck button').forEach(b => { b.disabled = role === 'done' || it.hidden || scaling; });
      const del = tr.querySelector('button[data-act=del]');
      if (del) del.title = role === 'done' ? 'Delete (hidden from the run sheet; it stays in the log)' : 'Delete';
      startIn.classList.toggle('conflict', overlap >= 1);

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
      } else {
        const gap = it.gapAfter > 59 || it.gapAfter < -59
          ? `<span class="st-gap">${it.gapAfter > 0 ? 'gap' : 'overlaps'} ${C.formatDuration(Math.abs(it.gapAfter))}</span>` : '';
        const ahead = x != null && p != null && clockOf(x) !== clockOf(p) && overlap < 1   // (a clash shows its own time already)
          ? `<span class="${x > p ? 'st-late' : 'st-early'}" title="The planned time">planned ${clockOf(p)}</span>` : '';
        const clash = overlap >= 1 ? `<span class="st-conflict" title="${esc(norm.items[curIdx] ? norm.items[curIdx].name : '')} is due to end at ${clockOf(curEnd)}">starts ${C.formatSpan(overlap)} before the current item ends</span>` : '';
        status.innerHTML = [clash, ahead, gap].filter(Boolean).join(' · ');
      }
      tr.querySelectorAll('button.go').forEach(b => { b.disabled = !active || it.hidden; });
      tr.querySelectorAll('td.acts button:not(.go)').forEach(b => { if (scaling) b.disabled = true; });
      // Order is fixed up to and including the item running now, and nothing moves above it:
      // the dashboard, the phones and the log all follow the live order. To stop an item,
      // delete it instead.
      const lock = moveLock(i);
      const up = tr.querySelector('button[data-act=up]'), down = tr.querySelector('button[data-act=down]');
      up.disabled = !!lock || i === 0 || scaling; down.disabled = lock === 'ran' || lock === 'now' || i === norm.items.length - 1 || scaling;
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
    if (provisional() && norm.items.length) parts.push('<span class="prov" title="The sheet has no start times, so its times count from now until the first Next">times as if it started now</span>');
    $('now-next').innerHTML = parts.join(' &nbsp;·&nbsp; ');

    renderScaleBar();
    renderLog();
  }

  // What row i is to the show: 'done' (ran, and the show has moved past it), 'now' (running),
  // 'next' (the first row after the running one, finish marker included) or null.
  function liveIndex() {
    if (!state.active || state.finished || !(state.index >= 0) || !state.currentId) return -1;
    return norm.items.findIndex(x => x.id === state.currentId);
  }
  function nextRow(cur) {
    for (let j = cur + 1; j < norm.items.length; j++) if (!norm.items[j].hidden) return j;
    return -1;
  }
  function rowRole(i) {
    const it = norm.items[i];
    if (!it) return null;
    const cur = liveIndex();
    if (cur >= 0 && i === cur) return 'now';
    const ran = (state.log || []).some(e => e.id === it.id);
    if (ran && (state.finished || (cur >= 0 && i < cur) || (cur < 0 && state.currentId && i < norm.items.findIndex(x => x.id === state.currentId)))) return 'done';
    if (cur >= 0 && i === nextRow(cur)) return 'next';
    return null;
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
    // "Auto start at 22:40": before the show, when the first item has a start time still ahead
    const auto = $('autostart'), at = state.active && Number.isFinite(live.autoAt) ? live.autoAt : null;
    auto.hidden = at == null;
    if (at != null) { auto.querySelector('span').textContent = 'Auto start at ' + clockOf(at); auto.querySelector('input').checked = !!live.auto; }
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

  // ─── Slides (PowerPoint decks and holding slides) ──────────────────────────
  // A deck on an item opens on the PowerPoint computers when Next reaches it; a holding slide (an
  // image, e.g. the event logo) becomes their wallpaper then, so it shows whenever no deck is up
  // (pptx-hub.js sends both ahead of time). Kept in the browser like videos: item.deck / item.holding
  // {key, name, size}, keys 'rsdeck:' / 'rsimg:<item id>:<time>'; name is the file name.
  const DECK_RE = /\.(pptx|ppsx|pptm|ppsm|ppt|pps|potx)$/i;
  const IMG_RE = /\.(png|jpe?g|bmp)$/i;
  const PPTX = !!(window.TimerFeatures && TimerFeatures.pptx);   // alpha-only trial (features.js): no Slides column otherwise
  const isDeck = f => !!f && DECK_RE.test(f.name || '');
  const isHolding = f => !!f && IMG_RE.test(f.name || '');
  const deckBusy = new Set();
  const deckSending = new Map();
  function renderDeckCell(td, item) {
    if (deckBusy.has(item.id)) {
      td.innerHTML = `<span class="vbusy">${REMOTE ? `sending… ${deckSending.get(item.id) || 0}%` : 'copying…'}</span>`;
      return;
    }
    const d = item.deck, h = item.holding;
    if (!d && !h) {
      td.innerHTML = `<button class="dadd" data-act="dadd" tabindex="-1" title="A PowerPoint deck to open on the PowerPoint computers when this item starts, or an image (PNG/JPG) as the holding slide shown between decks (or drop the file on the row)">+ slides</button>`;
      td.title = '';
      return;
    }
    const both = d && h;
    td.innerHTML =
      (d ? `<span class="vicon">📊</span>${both ? '' : ' <span class="dname"></span>'}<button class="ddel" data-act="ddel" tabindex="-1" title="Remove the deck">✕</button>` : '') +
      (h ? `<span class="vicon" title="Holding slide">🖼</span>${both ? '' : ' <span class="dname hname"></span>'}<button class="ddel" data-act="hdel" tabindex="-1" title="Remove the holding slide">✕</button>` : '') +
      (both ? '' : `<button class="dadd dmore" data-act="dadd" tabindex="-1" title="${d ? 'Add a holding slide (an image)' : 'Add a PowerPoint deck'}">+</button>`);
    td.title = [d ? 'Slides: ' + d.name : '', h ? 'Holding slide (wallpaper when no deck is up): ' + h.name : ''].filter(Boolean).join('\n');
    const n = td.querySelector('.dname');
    if (n) n.textContent = noExt((d || h).name);
  }
  async function attachDeck(id, file) {
    if (!PPTX) return;
    const item = sheet.items.find(it => it.id === id);
    if (!item || !file) return;
    const kind = isDeck(file) ? 'deck' : isHolding(file) ? 'holding' : null;
    if (!kind) { alert('That isn’t a PowerPoint file (.pptx, .ppsx, .ppt …) or an image for a holding slide (.png, .jpg).'); return; }
    if (REMOTE) return sendDeck(id, file, kind);
    if (!window.videoStore) { alert('Slides can’t be stored in this browser.'); return; }
    deckBusy.add(id); renderAll();
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      const key = (kind === 'deck' ? 'rsdeck:' : 'rsimg:') + id + ':' + Date.now();
      await window.videoStore.put(key, file);
      const it = sheet.items.find(x => x.id === id);
      if (!it) { window.videoStore.remove(key); return; }
      if (it[kind]) window.videoStore.remove(it[kind].key).catch(() => {});
      it[kind] = { key, name: String(file.name).slice(0, 200), size: file.size };
      if (!it.name && kind === 'deck') it.name = noExt(file.name);
      saveSheet();
    } catch (err) {
      alert('Couldn’t store the file in this browser: ' + (err && err.message || err));
    } finally {
      deckBusy.delete(id);
      renderAll();
    }
  }
  // Remote mode: like videos, straight to the timer's computer over the local network only
  function sendDeck(id, file, kind) {
    if (!link.online) { alert('Not connected to the timer right now.'); return; }
    if (!link.lan) {
      alert('Slides can only be sent to the timer over a direct link on the same network, and this computer is connected through the server.\n\n' +
        'Use the same Wi-Fi or network as the timer’s computer (the badge at the top shows ⚡ LAN direct), or add the slides on the timer’s computer.');
      return;
    }
    if (busy.size || deckBusy.size) { alert('Wait for the file being sent to finish first.'); return; }
    deckBusy.add(id); deckSending.set(id, 0); renderAll();
    toParent({ t: 'rs-video', kind, id, file, name: String(file.name).slice(0, 200) });
  }
  function removeDeck(id, kind) {
    const item = sheet.items.find(it => it.id === id);
    if (!item || !item[kind]) return;
    if (!confirm(kind === 'deck' ? `Remove the slides “${item.deck.name}” from this item?` : `Remove the holding slide “${item.holding.name}” from this item?`)) return;
    if (!REMOTE) window.videoStore && window.videoStore.remove(item[kind].key).catch(() => {});
    delete item[kind];
    saveSheet();
  }
  const deckPicker = document.createElement('input');
  deckPicker.type = 'file'; deckPicker.accept = '.pptx,.ppsx,.pptm,.ppsm,.ppt,.pps,.potx,.png,.jpg,.jpeg,.bmp'; deckPicker.hidden = true;
  document.body.appendChild(deckPicker);
  deckPicker.addEventListener('change', () => { const f = deckPicker.files[0]; deckPicker.value = ''; if (f && pickFor) attachDeck(pickFor, f); });

  // Videos and slides no longer used by the sheet (rows deleted, sheet replaced) are removed from the browser
  function cleanUpVideos() {
    if (REMOTE || !window.videoStore) return;
    const used = new Set(sheet.items.filter(it => it.video).map(it => it.video.key));
    sheet.items.forEach(it => { if (it.deck) used.add(it.deck.key); if (it.holding) used.add(it.holding.key); });
    // Videos in the timer's Recent videos list stay until they drop off it (video-library.js)
    try { (JSON.parse(localStorage.getItem('video_history') || '[]') || []).forEach(e => { if (e && e.key) used.add(e.key); }); } catch (_) { /* ignore */ }
    window.videoStore.keys().then(keys => keys.forEach(k => {
      if (/^rs(video|deck|img):/.test(String(k)) && !used.has(k)) window.videoStore.remove(k).catch(() => {});
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
    if (!tr || tr.classList.contains('endrow') || tr.classList.contains('locked') || !Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    tbodyEl.querySelectorAll('tr.vdrop').forEach(r => r !== tr && r.classList.remove('vdrop'));
    tr.classList.add('vdrop');
  });
  tbodyEl.addEventListener('dragleave', e => { const tr = e.target.closest('tr'); if (tr && !tr.contains(e.relatedTarget)) tr.classList.remove('vdrop'); });
  tbodyEl.addEventListener('drop', e => {
    const tr = e.target.closest('tr');
    tbodyEl.querySelectorAll('tr.vdrop').forEach(r => r.classList.remove('vdrop'));
    if (!tr || tr.classList.contains('endrow') || tr.classList.contains('locked')) return;
    const list = Array.from(e.dataTransfer.files || []);
    const f = list.find(x => x.type.startsWith('video/')) || (PPTX && (list.find(isDeck) || list.find(isHolding)));
    if (!f) return;
    e.preventDefault();
    if (f.type.startsWith('video/')) attachVideo(tr.dataset.id, f); else attachDeck(tr.dataset.id, f);
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
    const i = sheet.items.findIndex(it => it.id === input.closest('tr').dataset.id);
    const item = sheet.items[i];
    if (!item) return;
    const role = rowRole(i);
    if (role === 'done' || item.hidden || (role === 'now' && field === 'start') || scaling) { renderAll(); return; }   // read-only (belt and braces)
    if (field === 'name') {
      const v = input.value.trim();
      if (role === 'now' && v !== item.name) return liveRename(item, v);
      item.name = v;
    } else {
      const v = field === 'duration' ? C.parseDuration(input.value) : readClock(input.value);
      if (Number.isNaN(v)) {
        return refuse(input, field !== 'duration' ? `Couldn’t read “${esc(input.value)}” as a time. Try 9:30, 930, 9:30am or 14:00.`
                                                  : `Couldn’t read “${esc(input.value)}” as a duration. Try 20, 1:30, 20 min or 1 h 30 min.`);
      }
      input.classList.remove('invalid');
      input.title = '';
      if (field === 'end') {                         // an end time is another way of giving the duration
        if (v == null) { renderAll(); return; }
        if (role === 'now') return liveEnd(i, v);
        const d = endToDuration(i, v);
        if (typeof d === 'string') return refuse(input, d);
        return setDuration(i, d);
      }
      if (role === 'now' && field === 'duration') return liveDuration(i, v);
      if (role === 'next' && field === 'start' && v != null && v !== item.start) return nextStart(i, v);
      if (field === 'duration') return setDuration(i, v);
      if (field === 'start') return setStart(i, v);
      item[field] = v;
    }
    saveSheet();
  });

  // ─── Scaling a selection ──────────────────────────────────────────────────
  // Running late? Select two or more items still to come (click their numbers; Shift+click for a
  // range) and drag the slider to shorten (or lengthen) them all by the same percentage. The table
  // previews it; nothing is saved until Apply. Within the selection the start times move with
  // the new lengths; items after the last one selected keep theirs (lunch at 12:30 is the target),
  // so the time saved closes up lateness or becomes a gap. Videos keep their length.

  const picked = new Set();                          // ids of the selected rows
  let lastPicked = null;                             // for Shift+click ranges
  let scalePct = 100;
  let scaling = false;                               // a preview is showing (2+ selected, not 100 %): the table is read-only

  function canPick(i) {
    const it = norm.items[i];
    if (!it || it.isEnd || it.hidden || it.video || state.finished) return false;
    const role = rowRole(i);
    return role !== 'done' && role !== 'now';
  }
  // Drops rows that can't be scaled any more (the show moved on to them, deleted...); true if any went
  function prunePicked() {
    let gone = false;
    picked.forEach(id => {
      const i = norm.items.findIndex(it => it.id === id);
      if (i < 0 || !canPick(i)) { picked.delete(id); gone = true; }
    });
    if (picked.size < 2) scalePct = 100;
    return gone;
  }
  const previewing = () => picked.size >= 2 && scalePct !== 100;

  function pickRow(id, range) {
    const i = norm.items.findIndex(it => it.id === id);
    if (i < 0 || !canPick(i)) return;
    if (range && lastPicked) {
      const j = norm.items.findIndex(it => it.id === lastPicked);
      if (j >= 0) for (let k = Math.min(i, j); k <= Math.max(i, j); k++) if (canPick(k)) picked.add(norm.items[k].id);
    } else if (picked.has(id)) picked.delete(id);
    else picked.add(id);
    lastPicked = id;
    renderAll();
  }

  // The new length of one item at pct %: whole seconds, rounded to 15 s (to the second under a minute)
  function scaledDur(sec, pct) {
    if (pct === 100) return sec;
    const v = sec * pct / 100;
    return Math.max(1, v < 60 ? Math.round(v) : Math.round(v / 15) * 15);
  }
  // Applies the scaling to target (the sheet, or a copy), from the times n gives the rows now
  function scaleInto(target, n, pct) {
    const rows = n.items.map((it, i) => picked.has(it.id) ? i : -1).filter(i => i >= 0);
    const last = rows[rows.length - 1];
    rows.forEach(i => {
      const old = n.items[i].eff, d = scaledDur(old, pct);
      target.items[i].duration = d;
      C.shiftStarts(target, i, d - old, last);       // up to the last selected; the rest keep their times
    });
  }
  // n = the real sheet's normalised form (renderAll has it before the preview replaces it)
  function scaledCopy(n, pct) {
    const copy = JSON.parse(JSON.stringify(sheet));
    scaleInto(copy, n, pct == null ? scalePct : pct);
    return copy;
  }

  // What the scaling does, for the bar: the selection's total, when its last item ends, and the
  // item after it with the time it should start (its own start time, or the plan)
  function scaleFacts(pct) {
    const real = C.normalise(sheet);
    const n = pct === 100 ? real : C.normalise(scaledCopy(real, pct));
    const rows = real.items.map((it, i) => picked.has(it.id) ? i : -1).filter(i => i >= 0);
    const last = rows[rows.length - 1];
    const pn = projNow(n);
    const startOf = i => pn && pn.proj.has(i) ? pn.proj.get(i) : plannedMs(n.items[i].planned, n);
    const s = startOf(last);
    let after = -1;
    for (let j = last + 1; j < real.items.length; j++) if (!real.items[j].hidden) { after = j; break; }
    const target = after >= 0 ? plannedMs(real.items[after].planned, real) : null;
    return {
      total: rows.reduce((a, i) => a + n.items[i].eff, 0),
      lastEnd: s == null ? null : s + n.items[last].eff * 1000,
      after: after >= 0 ? real.items[after] : null,
      target,                                        // when the item after the selection should start (ms)
      fixed: after >= 0 && real.items[after].start != null,
    };
  }

  function renderScaleBar() {
    const bar = $('scalebar');
    bar.hidden = !picked.size;
    if (!picked.size) return;
    const ready = picked.size >= 2;
    bar.classList.toggle('ready', ready);
    $('scale-pct').value = scalePct;
    $('scale-pct').disabled = !ready;
    $('scale-apply').disabled = !scaling;
    if (!ready) {
      $('scale-info').innerHTML = '1 item selected: select at least one more to scale them together (click a number; Shift+click for a range).';
      $('scale-fit').hidden = true;
      $('scale-label').textContent = '100 %';
      return;
    }
    const was = scaleFacts(100), now = scalePct === 100 ? was : scaleFacts(scalePct);
    const diff = now.total - was.total;
    const parts = [`<b>${picked.size} items</b> ${C.formatDuration(was.total)}` +
      (diff ? ` → <b>${C.formatDuration(now.total)}</b> <span class="${diff < 0 ? 'st-early' : 'st-late'}">(${diff < 0 ? '−' : '+'}${C.formatSpan(diff)})</span>` : '')];
    if (now.lastEnd != null) parts.push(`last one ends ${clockOf(was.lastEnd)}` + (now.lastEnd !== was.lastEnd ? ` → <b>${clockOf(now.lastEnd)}</b>` : ''));
    if (now.after && now.target != null && now.lastEnd != null) {
      const late = Math.round((now.lastEnd - now.target) / 1000);
      const name = esc(now.after.isEnd ? (now.after.name || 'the finish') : now.after.name || 'the next item');
      parts.push(`${name} ${now.fixed ? 'at' : 'planned'} ${clockOf(now.target)}: ` +
        (late >= ON_TIME_SEC ? `<span class="st-late">${C.formatSpan(late)} late</span>`
          : late <= -ON_TIME_SEC ? `<span class="st-early">${C.formatSpan(late)} to spare</span>` : 'on time'));
    }
    $('scale-info').innerHTML = parts.join(' · ');
    $('scale-label').textContent = scalePct + ' %';
    // Fit: the gentlest scaling that gets the item after the selection started on time
    const fit = was.after && was.target != null && was.lastEnd != null && was.lastEnd - was.target >= ON_TIME_SEC * 1000;
    $('scale-fit').hidden = !fit;
    if (fit) $('scale-fit').textContent = `Fit to ${clockOf(was.target)}`;
  }

  function fitPct() {
    let lo = Number($('scale-pct').min), hi = 100;
    const fits = p => { const f = scaleFacts(p); return f.lastEnd == null || f.lastEnd - f.target < ON_TIME_SEC * 1000; };
    if (!fits(lo)) return lo;                        // can't make it all up: as far as the slider goes
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid; }
    return lo;
  }

  function endScaling(save) {
    if (save && scaling) {
      scaleInto(sheet, C.normalise(sheet), scalePct);
      picked.clear(); scalePct = 100;
      saveSheet();
      return;
    }
    picked.clear(); scalePct = 100;
    renderAll();
  }
  $('scale-pct').addEventListener('input', e => { scalePct = Number(e.target.value) || 100; renderAll(); });
  $('scale-fit').addEventListener('click', () => { scalePct = fitPct(); renderAll(); });
  $('scale-apply').addEventListener('click', () => endScaling(true));
  $('scale-cancel').addEventListener('click', () => endScaling(false));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && picked.size && !document.querySelector('.ask')) { e.preventDefault(); endScaling(false); }
  });

  // ─── Editing the item running now (and the next one's start) ──────────────
  // These change what the presenter sees, so they go to the timer window as commands
  // (runsheet.js changes the sheet and the countdown together), after a check here.

  // A dialog with a few choices; resolves with the chosen button's value (Escape: the cancel one)
  function ask(html, buttons) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'ask';
      wrap.innerHTML = '<div class="ask-box" role="alertdialog" aria-modal="true"><div class="ask-text"></div><div class="ask-btns"></div></div>';
      wrap.querySelector('.ask-text').innerHTML = html;
      const cancel = (buttons.find(b => b.cancel) || buttons[buttons.length - 1]).value;
      const done = v => { document.removeEventListener('keydown', onKey, true); wrap.remove(); resolve(v); };
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(cancel); }
        else if (e.key === 'PageDown' || e.key === 'PageUp') e.stopPropagation();   // not Next/Back behind a question
      };
      let first = null;
      buttons.forEach(b => {
        const el = document.createElement('button');
        el.textContent = b.label;
        if (b.kind) el.className = b.kind;
        el.addEventListener('click', () => done(b.value));
        wrap.querySelector('.ask-btns').appendChild(el);
        if (b.kind === 'primary' || (!first && !b.cancel)) first = b.kind === 'primary' ? el : first || el;
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(wrap);
      (first || wrap.querySelector('button')).focus();
    });
  }
  const editorNow = () => Date.now() + (REMOTE ? 0 : Number(localStorage.getItem('internetTimeError')) || 0);
  // Seconds left on the countdown, from the preview (the timer's own figure); null if unknown
  function remainingSec() {
    if (!controllerAlive() || !clock.remain) return null;
    const p = clock.remain.split(':').map(Number);
    if (p.some(Number.isNaN)) return null;
    const sec = p.reduce((a, v) => a * 60 + v, 0);
    return clock.over ? -sec : sec;
  }
  // A time of day as a timestamp: the one nearest the item running now (as runsheet.js does)
  function clockNear(sec) {
    const DAY = 86400e3, log = state.log || [], e = log[log.length - 1];
    const ref = e ? e.actual : editorNow();
    let t = dayBase() + (sec % 86400) * 1000;
    while (t < ref - DAY / 4) t += DAY;
    while (t > ref + DAY * 3 / 4) t -= DAY;
    return t;
  }

  // A time typed into a cell: as the import reads them, plus 930 / 1815 (no colon)
  function readClock(text) {
    const t = String(text == null ? '' : text).trim();
    const m = t.match(/^(\d{1,2})(\d{2})( ?(?:am|pm|a|p))?$/i);
    return C.parseClock(m ? `${m[1]}:${m[2]}${m[3] || ''}` : t);
  }
  // Says why a typed value wasn't used; the cell stays red with it as the tooltip until fixed
  function refuse(input, html) {
    input.classList.add('invalid');
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    input.title = tmp.textContent;
    ask(html, [{ label: 'OK', value: 0, kind: 'primary' }]).then(() => { input.focus(); input.select && input.select(); });
  }
  // An end time (time of day) for row i as its duration, from its start as shown (a clock time,
  // whether the sheet has start times or is pinned to when the show began); or why not.
  function endToDuration(i, sec) {
    const it = norm.items[i];
    const pn = projNow();
    const startMs = !it ? null : pn && pn.proj.has(i) ? pn.proj.get(i) : plannedMs(it.planned);   // the start the row shows
    if (startMs == null) return `There’s no start time to count from yet (the sheet has no start times and the show hasn’t started), so give <b>${esc(it ? it.name || 'this item' : 'this item')}</b> a duration instead.`;
    // From the start as the row shows it (hh:mm, seconds dropped as clockOf does): 10 minutes
    // later on screen is 10 minutes more, even when the show began at 9:00:40
    const DAY = 86400e3, shown = Math.floor(startMs / 60000) * 60000;
    const d = Math.round(((sec * 1000 - (shown - dayBase())) % DAY + DAY) % DAY / 1000);
    if (d < 1 || d > 43200) return `${C.formatClock(sec)} isn’t after <b>${esc(it.name || 'this item')}</b> starts (${clockOf(startMs)}).`;
    return d;
  }

  // A new duration (or end) for an item still to come: everything after it moves by as much.
  // Cleared (back to "from the times" or the default) moves nothing.
  function setDuration(i, sec) {
    const oldEff = norm.items[i].eff;
    sheet.items[i].duration = sec;
    if (sec != null) C.shiftStarts(sheet, i, sec - oldEff);
    saveSheet();
  }
  // A new start time: the start times after it move by as much (from the time the row had, typed
  // or worked out). Cleared, or the sheet's first start time (no times to measure from), moves nothing.
  function setStart(i, sec) {
    const old = norm.anchored ? norm.items[i].planned : null;
    sheet.items[i].start = sec;
    if (sec != null && old != null) C.shiftStarts(sheet, i, C.dayDelta(old, sec));
    saveSheet();
  }
  // A new end for the live item: its countdown ends then, and the rest of the day moves
  function liveEnd(i, sec) {
    if (clockNear(sec) <= editorNow() + 1000) {
      ask(`${C.formatClock(sec)} has already gone (it’s ${clockOf(editorNow())} now). The end wasn’t changed.`,
        [{ label: 'OK', value: 0, kind: 'primary' }]).then(() => renderAll());
      return;
    }
    send('curend', { id: sheet.items[i].id, endClock: sec });
  }

  // The live item's name is on the presenter's screen: change it there only when asked
  function liveRename(item, name) {
    ask(`<b>${esc(item.name || 'This item')}</b> is on now. The presenter's screen will show the new name, ` +
        `<b>${esc(name || '(no name)')}</b>, as soon as you confirm.`,
      [{ label: 'Change it', value: true, kind: 'primary' }, { label: 'Cancel', value: false, cancel: true }])
      .then(ok => {
        if (!ok) { renderAll(); return; }            // back to the name that's showing
        item.name = name;
        saveSheet();
        send('livename', { id: item.id, name });
      });
  }

  // A new duration for the live item: refused if more than that has already gone; otherwise
  // the countdown and every start time after it move.
  function liveDuration(i, sec) {
    const item = sheet.items[i], it = norm.items[i];
    let eff = sec;
    if (eff == null) {                                 // cleared: back to what the sheet gives it
      const copy = JSON.parse(JSON.stringify(sheet));
      copy.items[i].duration = null;
      eff = C.normalise(copy).items[i].eff;
    }
    const left = remainingSec();
    if (left != null && left + (eff - it.eff) <= 1) {
      const gone = Math.max(0, it.eff - left);
      ask(`<b>${esc(item.name || 'This item')}</b> has already run for ${C.formatSpan(gone)}, so it can’t be given ` +
          `${C.formatDuration(eff)} in all. The duration wasn’t changed.`, [{ label: 'OK', value: 0, kind: 'primary' }])
        .then(() => renderAll());
      return;
    }
    send('curdur', { id: item.id, duration: sec });
  }

  // The next item's new start is the live item's new end: ask whether the countdown moves too
  function nextStart(i, sec) {
    const item = sheet.items[i];
    const cur = norm.items[liveIndex()];
    const curName = esc((cur && cur.name) || 'The current item');
    const label = C.formatClock(sec);
    const T = clockNear(sec);
    const curEnd = cur && live.curId === cur.id ? live.curEnd : null;
    // Either way the items after the next one move by as much as its start does
    const save = () => { const old = norm.items[i].planned; item.start = sec; if (old != null) C.shiftStarts(sheet, i, C.dayDelta(old, sec)); saveSheet(); };
    const endAt = () => send('curend', { id: cur.id, endClock: sec, nextId: item.id });
    if (T <= editorNow() + 1000) {
      ask(`${label} has already gone (it’s ${clockOf(editorNow())} now). The start time wasn’t changed.`,
        [{ label: 'OK', value: 0, kind: 'primary' }]).then(() => renderAll());
      return;
    }
    if (!cur) { save(); return; }
    ask(`<b>${esc(item.name || 'The next item')}</b> starting at <b>${label}</b> means <b>${curName}</b> ends then` +
        (curEnd != null ? ` (it’s due to end at ${clockOf(curEnd)})` : '') + `. The items after it move by as much.<br>Change the countdown so it ends at ${label} too?`,
      [{ label: `Yes, end the countdown at ${label}`, value: 'end', kind: 'primary' },
       { label: 'No, just the start time', value: 'start' },
       { label: 'Cancel', value: null, cancel: true }])
      .then(a => {
        if (a === 'end') return endAt();
        if (a !== 'start') return renderAll();
        if (curEnd != null && T < curEnd - 1000) {
          return ask(`<b>${curName}</b> is due to end at <b>${clockOf(curEnd)}</b>, after ${label}: ` +
                     `<b>${esc(item.name || 'the next item')}</b> would start before it finishes.`,
            [{ label: 'Do nothing', value: null, cancel: true },
             { label: `End the countdown at ${label}`, value: 'end' },
             { label: 'Save the start time anyway', value: 'clash', kind: 'danger' }])
            .then(b => { if (b === 'end') endAt(); else if (b === 'clash') save(); else renderAll(); });
        }
        save();
      });
  }

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
    const num = e.target.closest('td.num');
    if (num) { pickRow(num.closest('tr').dataset.id, e.shiftKey); return; }
    const btn = e.target.closest('button[data-act]');
    if (!btn || (scaling && btn.dataset.act !== 'go')) return;
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
        removeDeck(id, 'deck');
        break;
      case 'hdel':
        removeDeck(id, 'holding');
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
      case 'unhide':
        delete sheet.items[i].hidden;
        saveSheet();
        break;
      case 'del':
        // Already run: hidden, not wiped (the record of the day keeps it)
        if (rowRole(i) === 'done') { sheet.items[i].hidden = true; saveSheet(); break; }
        if (id === state.currentId && !state.finished && !confirm('This item is running now. Delete it anyway?')) return;
        if (sheet.items[i].video && !confirm(`This item has a video ("${sheet.items[i].video.name}"). Delete the item and its video?`)) return;
        if ((sheet.items[i].deck || sheet.items[i].holding) && !confirm(`This item has slides ("${(sheet.items[i].deck || sheet.items[i].holding).name}"). Delete the item and its slides?`)) return;
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
    sheet.items = mode === 'replace' ? keptItems().concat(res.items) : sheet.items.concat(res.items);
    saveSheet();
    if (mode === 'replace' && (state.log || []).length && confirm('Also reset the show? This clears the log and starts again from the top.')) send('reset');

    const cols = Array.isArray(res.columns) ? res.columns.filter(Boolean).join(', ') : 'one item per line';
    msg.className = res.warnings.length ? 'warn' : 'ok';
    msg.textContent = `${mode === 'replace' ? 'Loaded' : 'Added'} ${res.items.length} item${res.items.length === 1 ? '' : 's'} (read as: ${cols}).` +
      (res.warnings.length ? '\n' + res.warnings.slice(0, 5).join('\n') : '');
    $('imp-text').value = '';
  }
  // Items that have already run survive Replace and Clear, hidden, for the record (Reset show drops them)
  function keptItems() {
    return sheet.items.filter((x, i) => x.hidden || rowRole(i) === 'done').map(x => Object.assign({}, x, { hidden: true }));
  }
  $('imp-replace').addEventListener('click', () => importText('replace'));
  $('show-hidden').addEventListener('click', () => { showHidden = !showHidden; renderAll(); });
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
    if (!sheet.items.length || !confirm('Delete every item in the run sheet?' + (keptItems().length ? ' Items that have already run stay in the record, hidden.' : ''))) return;
    sheet.items = keptItems();
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
  // Close every slide show on the PowerPoint computers: the holding slide shows
  $('btn-pptxclose').addEventListener('click', () => send('pptxclose'));
  $('btn-reset').addEventListener('click', () => {
    if (confirm('Reset the show? This clears the log and goes back to before the first item. In run sheet mode the timer then stands by with the first item, paused, until it starts.')) send('reset');
  });
  $('active').addEventListener('change', e => send('active', { on: e.target.checked }));
  $('autostart').querySelector('input').addEventListener('change', e => send('autostart', { on: e.target.checked }));

  // ─── Countdown preview, Pause and Restart ─────────────────────────────────
  // The timer's countdown as it shows it: here from the timer window's localStorage
  // (remainDisp / remainDispClass, as the presenter window reads them); in remote mode from the
  // page around this one (rs-clock, built from the timer's state).
  let clock = { remain: '', over: false, impending: false, paused: false };
  function readLocalClock() {
    const cls = ' ' + (localStorage.getItem('remainDispClass') || '') + ' ';
    clock = { remain: localStorage.getItem('remainDisp') || '', over: cls.includes(' over '),
      impending: cls.includes(' impending '), paused: cls.includes(' paused ') };
  }
  function renderClock() {
    const alive = controllerAlive() && !!clock.remain;
    $('clock-remain').textContent = alive ? (clock.over ? '+' : '') + clock.remain : '–:––';
    $('clock-state').textContent = alive && clock.paused ? 'paused' : '';
    const el = $('clock');
    el.classList.toggle('stale', !alive);
    el.classList.toggle('over', alive && clock.over);
    el.classList.toggle('impending', alive && clock.impending && !clock.over);
    el.classList.toggle('paused', alive && clock.paused);
    $('btn-pause').textContent = alive && clock.paused ? 'Resume' : 'Pause';
  }
  if (REMOTE) {
    window.addEventListener('message', e => {
      if (e.origin !== location.origin || e.source !== window.parent || !e.data || e.data.t !== 'rs-clock') return;
      const m = e.data;
      clock = { remain: String(m.remain || ''), over: !!m.over, impending: !!m.impending, paused: !!m.paused };
      renderClock();
    });
  } else {
    readLocalClock();
    window.addEventListener('storage', ev => {
      if (ev.key === 'remainDisp' || ev.key === 'remainDispClass') { readLocalClock(); renderClock(); }
    });
  }
  setInterval(renderClock, 1000);   // notices the timer window closing
  renderClock();

  $('btn-pause').addEventListener('click', () => send('pause'));
  // Options > "Restart needs a second click" (off by default): then a second click within 2 s, so
  // one stray click mid-talk can't reset the countdown. A preference of this computer, so it's kept
  // in its own localStorage in remote mode too (the only key the remote editor touches).
  const RESTART_CONFIRM_KEY = 'runsheet_restart_confirm';
  const restartConfirm = () => { try { return localStorage.getItem(RESTART_CONFIRM_KEY) === '1'; } catch (_) { return false; } };
  $('opt-restart-confirm').checked = restartConfirm();
  $('opt-restart-confirm').addEventListener('change', e => {
    try { if (e.target.checked) localStorage.setItem(RESTART_CONFIRM_KEY, '1'); else localStorage.removeItem(RESTART_CONFIRM_KEY); } catch (_) { /* ignore */ }
  });
  window.addEventListener('storage', e => { if (e.key === RESTART_CONFIRM_KEY) $('opt-restart-confirm').checked = restartConfirm(); });
  let restartArmed = null;
  $('btn-restart').addEventListener('click', () => {
    const b = $('btn-restart');
    if (restartArmed || !restartConfirm()) {
      clearTimeout(restartArmed); restartArmed = null;
      b.classList.remove('armed'); b.textContent = 'Restart';
      send('restart');
      return;
    }
    b.classList.add('armed'); b.textContent = 'Click again';
    restartArmed = setTimeout(() => { restartArmed = null; b.classList.remove('armed'); b.textContent = 'Restart'; }, 2000);
  });

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
  setInterval(() => { if (norm.items.length && provisional()) renderStatus(); }, 5000);   // times as if it started now
  setTimeout(cleanUpVideos, 3000);   // remove stored videos the sheet no longer uses
})();
