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
  // Remote mode: editing needs the timer operator's say-so (remote-control.js editRequest). Until then
  // the editor is view only (Next, Back, Pause and Restart still work). editState: 'no', 'asked', 'yes',
  // 'refused' or 'stopped' (the last two: the operator's answer, shown until asked again).
  const TOUCH_UI = REMOTE && new URLSearchParams(location.search).has('touch');   // in the phone remote
  const DOCKED = !REMOTE && window.parent !== window;                               // in the timer's screen (runsheet-dock.js)
  let editState = REMOTE ? 'no' : 'yes';
  let canEdit = !REMOTE;
  let lastSheet = '';                                // remote: the sheet as the timer has it (to undo refused edits)
  const EDIT_CMDS = ['reset', 'autostart', 'curdur', 'curend', 'livename'];   // as remote-control.js

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
    if (!canEdit) { refused(); return; }
    if (REMOTE) { toParent({ t: 'rs-save', sheet }); lastSheet = JSON.stringify(sheet); }
    else localStorage.setItem(SHEET_KEY, JSON.stringify(sheet));
    if (!renderPending) {
      renderPending = true;
      setTimeout(() => { renderPending = false; renderAll(); }, 0);
    }
  }

  function send(cmd, extra) {
    if (!canEdit && EDIT_CMDS.includes(cmd)) { refused(); return; }
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
          lastSheet = JSON.stringify(m.sheet);
          sheet = m.sheet;
          sheet.items.forEach(it => { if (!it.id) it.id = C.newId(); });
          if (!sheet.perItem) sheet.perItem = 20;
        }
        if (m.state) { state = m.state; state.history = new Array(Math.min(1000, m.state.historyLen || 0)); }
        if (m.live) live = m.live;
        if (m.sheet) renderAll(); else { renderStatus(); renderLive(); }
      } else if (m.t === 'rs-edit') {
        const was = canEdit;
        editState = ['no', 'asked', 'yes', 'refused', 'stopped'].includes(m.state) ? m.state : 'no';
        canEdit = editState === 'yes';
        if (was && !canEdit) undoLocal();
        renderEditBar();
        renderAll();
      } else if (m.t === 'rs-link') {
        link = { online: !!m.online, lan: !!m.lan };
        renderLive();
      } else if (m.t === 'rs-vprog') {
        sending.set(m.id, m.pct);
        const cell = document.querySelector(`#rs-table tr[data-id="${m.id}"] td.vid .vbusy`);
        if (cell) cell.textContent = `sending video… ${m.pct}%`;
      } else if (m.t === 'rs-vend') {
        sending.delete(m.id); busy.delete(m.id);
        if (m.error) alert(m.error);
        renderAll();
      }
    });
  }

  // ─── View only (remote, until the timer allows editing) ───────────────────
  function renderEditBar() {
    document.documentElement.classList.toggle('viewonly', !canEdit);
    $('title').readOnly = $('per-item').readOnly = !canEdit;
    const tag = $('remote-tag');
    if (!tag) return;
    const ask = label => ` <button>${label}</button>`;
    tag.classList.toggle('ro', !canEdit);
    tag.innerHTML = canEdit ? 'Editing the timer on another computer'
      : editState === 'asked' ? 'View only · asked the timer to allow editing…'
      : editState === 'refused' ? 'View only · the timer said no.' + ask('Ask again')
      : editState === 'stopped' ? 'View only · the timer stopped your editing.' + ask('Ask again')
      : 'View only' + ask('Ask to edit');
  }
  // A change while view only: put the sheet back as the timer has it, and point at the bar
  function undoLocal() {
    if (!REMOTE || !lastSheet) return;
    try { sheet = JSON.parse(lastSheet); } catch (_) { return; }
    sheet.items.forEach(it => { if (!it.id) it.id = C.newId(); });
    if (!sheet.perItem) sheet.perItem = 20;
  }
  function refused() {
    undoLocal();
    setTimeout(renderAll, 0);
    const tag = $('remote-tag');
    if (tag) { tag.classList.remove('nudge'); void tag.offsetWidth; tag.classList.add('nudge'); }
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
  // A timestamp as a start time (seconds since midnight, on the show's day)
  function secOfDay(ms) {
    return ((Math.round((ms - dayBase()) / 1000) % 86400) + 86400) % 86400;
  }
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
    dockTitle();
    if (document.activeElement !== $('per-item')) $('per-item').value = sheet.perItem || 20;
    document.title = (location.hostname || 'Timer') + ' - Run sheet' + (sheet.title ? ' — ' + sheet.title : '');
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
        `<td class="start"><input type="checkbox" class="hard" tabindex="-1" aria-label="Start automatically at this time"><input data-field="start" aria-label="Start time"></td>` +
        `<td class="name"><input data-field="name" aria-label="Item name"></td>` +
        `<td class="vid"></td>` +
        `<td class="dur"><input data-field="duration" aria-label="Duration"></td>` +
        `<td class="ends">${it.isEnd ? '' : '<input data-field="end" aria-label="End time">'}</td><td class="status"></td>` +
        `<td class="acts">` +
          // tabindex -1: Tab moves between the cells (start → name → duration → next row)
          (it.isEnd ? '' : `<button class="go" data-act="go" tabindex="-1" title="Start this item now">▶</button>`) +
          `<button data-act="up" tabindex="-1" title="Move up">↑</button><button data-act="down" tabindex="-1" title="Move down">↓</button>` +
          (src.hidden ? `<button data-act="unhide" tabindex="-1" title="Show it in the run sheet again">↺</button>`
                      : `<button data-act="del" tabindex="-1" title="Delete">✕</button>`) + `</td>`;
      const [start, name, dur] = FIELDS.map(f => tr.querySelector(`[data-field=${f}]`));
      const hard = tr.querySelector('input.hard');       // a hard start (every item but the finish)
      hard.hidden = it.isEnd;
      hard.checked = !!src.auto;
      start.value = src.start != null ? C.formatClock(src.start) : '';
      name.value = src.name || '';
      dur.value = src.duration != null ? C.formatDuration(src.duration) : '';
      name.placeholder = 'Item name';
      if (!it.isEnd) renderVideoCell(tr.querySelector('td.vid'), src);
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
        inp.readOnly = ro || scaling || !canEdit;
        inp.title = scaling ? 'Apply or cancel the scaling first' : ro ? (role === 'now' ? 'Running now: it started when it started' : 'Already run: kept as it happened') : (inp.classList.contains('invalid') ? inp.title : '');
      });
      tr.querySelectorAll('td.vid button, td.vid select').forEach(b => { b.disabled = role === 'done' || it.hidden || scaling || (b.dataset.act === 'sroll' && role === 'now'); });
      // The hard-start tick: the first item's works before the show (it's the auto start, in standby);
      // the others only once the show is under way, for items still to come. Otherwise dimmed.
      const hard = tr.querySelector('input.hard');
      if (hard) {
        const firstIdx = norm.items.findIndex((x, j) => !x.hidden && j !== norm.endIdx);
        const started = active && !state.finished && curIdx >= 0;
        const armedNow = i === firstIdx ? active && !started && !state.finished : started && i > curIdx;
        // An item without a typed start gets the one it shows when ticked, so it needs a clock time
        const noClock = it.startDerived && !it.auto && (provisional() || plannedMs(it.planned) == null);
        hard.disabled = role === 'done' || role === 'now' || it.hidden || scaling || noClock || !canEdit;
        hard.classList.toggle('idle', !armedNow);
        hard.title = noClock && !(role === 'done' || role === 'now' || it.hidden || scaling)
          ? 'Hard start: needs a clock time. Type a start time, or start the show first'
          : hard.disabled ? '' : (it.startDerived ? 'Tick to fix this item at ' + clockOf(plannedMs(it.planned)) + '. ' : '') + (i === firstIdx ? 'Auto start: after Reset show, the show starts by itself at this time'
          : 'Hard start: when this time comes, this item starts by itself, if it\'s next') + (armedNow ? '' : ' (not active yet: ' + (i === firstIdx ? 'only before the show' : 'once the show has started') + ')');
      }
      tr.classList.toggle('hardmiss', (live.hardMiss || []).includes(it.id));
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
    el.title = el.textContent;                     // (shortened with … when the header is narrow)
    el.className = live.kind || '';
    // "Auto start at 22:40": before the show, when the first item has a start time still ahead
    const auto = $('autostart'), at = state.active && Number.isFinite(live.autoAt) ? live.autoAt : null;
    auto.hidden = at == null;
    if (at != null) { auto.querySelector('span').textContent = 'Auto start at ' + clockOf(at); auto.querySelector('input').checked = !!live.auto; }
    auto.querySelector('input').disabled = !canEdit;
    // What's playing (a video in the player, a sting, the tone): the timer's playing bar, here too (Fade
    // out, Stop). Not when docked: the timer's own bar sits on top of the editor then
    const pl = live.playing, plEl = $('playing');
    plEl.hidden = !pl || DOCKED;
    if (pl) { plEl.querySelector('.pl-icon').textContent = pl.kind === 'video' ? '🎬' : pl.kind === 'tone' ? '🔊' : '🎵'; plEl.querySelector('.pl-name').textContent = pl.name; }
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
    if (item.sting && STINGS) {
      const st = item.sting;
      td.innerHTML = `<span class="vicon">${st.media === 'video' ? '🎞' : '🎵'}</span> <span class="vdur"></span>` +
        (st.key ? '' : ' <span class="sweb" title="Not kept in the timer’s browser (yet): it plays from its link, so it needs the internet">⚠</span>') +
        `<button class="vdel vroll${st.rolled ? ' on' : ''}" data-act="sroll" tabindex="-1" title="${st.rolled ? 'Picked at random: 🎲 for another. The run sheet’s 🎲 may change it too; choose one with ✂ or + sting to keep it' : 'Another walk-up sting, at random (Random stings, on the right, says from where)'}">🎲</button>` +
        `<button class="vdel vtrim${StingClip.region(st) ? ' on' : ''}" data-act="strim" tabindex="-1" title="${StingClip.region(st) ? 'Plays part of the track: change it' : 'Choose the part to play, with fades'}">✂</button>` +
        `<button class="vdel" data-act="sdel" tabindex="-1" title="Remove the walk-up sting">✕</button>`;
      td.title = 'Walk-up sting: ' + st.name + (st.src === 'stock' ? ' (stock)' : st.src === 'link' ? '\n' + st.url : '') + '\nPlays as the item starts; the item keeps its own time.';
      const len = StingClip.length(st, st.duration);
      td.querySelector('.vdur').textContent = len ? C.formatDuration(Math.max(1, Math.round(len))) : '';
      return;
    }
    if (!item.video) {
      td.innerHTML = `<button class="vadd" data-act="vadd" tabindex="-1" title="Play a video for this item: the item runs as long as the video (or drop a video file on the row)">+ video</button>` +
        (STINGS ? `<button class="vadd sadd" data-act="sadd" tabindex="-1" title="A walk-up sting: music or a video that plays as the item starts, while the item keeps its own time (or drop an audio file on the row)">+ sting</button>` +
          `<button class="vadd vroll" data-act="sroll" tabindex="-1" title="A walk-up sting at random (Random stings, on the right, says from where)">🎲</button>` : '');
      td.title = '';
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
    if (!canEdit) return refused();
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
      if (it.sting) { if (it.sting.key) window.videoStore.remove(it.sting.key).catch(() => {}); delete it.sting; }   // a video or a sting, not both
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

  // ─── Walk-up stings (a trial: TimerFeatures.stings) ─────────────────────────
  // Music or a video that plays as the item starts (sting-player.js, on the timer's computer); the
  // item keeps its own time, unlike a video. item.sting {src: 'file'|'link'|'stock', media:
  // 'audio'|'video', name, duration, key?, url?, size?}: a file is kept in the browser like videos
  // ('rssting:'); a link or stock sting is copied there by the timer (runsheet.js keepStings).
  const STINGS = !!(window.TimerFeatures && TimerFeatures.stings);
  const isMedia = f => !!f && /^(audio|video)\//.test(f.type || '');
  // The + sting dialog, the stock list, clips and the folder: sting-picker.js (shared with playout computers)
  StingPicker.setup({ keepFolder: !REMOTE });   // (the remote editor doesn't touch this computer's storage)
  const { CLIP_KEYS, clipFields } = StingPicker, stingIdOf = StingPicker.idOf, stockStings = StingPicker.stock;
  function putSting(it, sting) {                 // (no save) the file of the sting it replaces goes
    if (!REMOTE && it.sting && it.sting.key && it.sting.key !== sting.key && window.videoStore) window.videoStore.remove(it.sting.key).catch(() => {});
    it.sting = sting;
  }
  function setSting(id, sting) {
    const it = sheet.items.find(x => x.id === id);
    if (!it) return;
    putSting(it, sting);
    if (!it.name) it.name = sting.name;
    saveSheet();
  }
  // Who else on this sheet uses a stock or link sting (some presenters want "their" sting to themselves)
  function stingUsers(s, exceptId) {
    const want = stingIdOf(s);
    return sheet.items.filter(x => x.id !== exceptId && !x.hidden && x.sting && x.sting.url && stingIdOf(x.sting) === want).map(x => x.name || 'an unnamed item');
  }
  async function againOk(name, users) {
    if (!users.length) return true;
    return ask(`<b>${esc(name)}</b> is already used for ${esc(users.join(', '))}. Use it again here?`,
      [{ label: 'Use it again', value: true, kind: 'primary' }, { label: 'Cancel', value: false, cancel: true }]);
  }
  // + sting: StingPicker's dialog chooses (a stock sting, a library clip, a file); the item gets it here
  async function stingDialog(id) {
    if (!canEdit) return refused();
    const ch = await StingPicker.open({
      note: 'Plays as this item starts, on the timer’s computer. The item keeps its own time.',
      fileNote: 'Music or a video of your own, from this computer: one file (or drop it on the item’s row), or pick from a folder of them.',
      users: s => stingUsers(s, id), hideLabel: 'Hide stings already on this run sheet', noneLeft: 'Every stock sting is already on this run sheet.',
      browse: () => { pickFor = id; stingPicker.click(); },
    });
    if (!ch) return;
    if (ch.file) return attachSting(id, ch.file, ch.extra);   // stored with the item, like a browsed file
    if (!(await againOk(ch.sting.name, stingUsers(ch.sting, id)))) return;
    setSting(id, ch.sting);
  }

  // ─── Sting levels (Options; sting-clip.js levelling) ──────────────────────
  // Stings play turned down (never up) to a level: the house level (−23 LUFS unless changed here), or
  // this show's, which Level this show… finds: every sting on the sheet measured as it plays (stored on
  // it as lufs), and the quietest one's loudness, so it plays as it is and the rest come down to it.
  // ▶ Line-up tone: 1 kHz at that level from the timer, for the mixer. On the timer's computer only
  // (it needs the files; the levels are its own), except the tone, which a remote editor can play too.
  let toneOn = false;
  function renderLevels() {
    if (!STINGS) return;
    const sh = StingClip.showLevel();
    if (!REMOTE) {
      if (document.activeElement !== $('opt-house')) $('opt-house').value = StingClip.houseLevel();
      $('lvl-show').textContent = sh ? `This show: ${sh.lufs.toFixed(1)} LUFS, the quietest of ${sh.n} sting${sh.n === 1 ? '' : 's'} (levelled ${clockOf(sh.at)}). Stings play down to it.`
        : `Stings play down to the house level. Level this show to use the quietest sting’s level instead, for more signal.`;
      $('lvl-house').hidden = !sh;
    }
    $('lvl-tone').textContent = toneOn ? '■ Stop the tone' : '▶ Line-up tone';
  }
  function toggleTone(on) { toneOn = on == null ? !toneOn : on; send('tone', { on: toneOn }); renderLevels(); }
  async function stingSource(s) {
    if (s.key && window.videoStore) { try { const b = await window.videoStore.get(s.key); if (b) return b; } catch (_) { /* not here */ } }
    return s.url || null;
  }
  async function levelShow() {
    const items = sheet.items.filter(it => !it.hidden && it.sting);
    if (!items.length) { await ask('There are no walk-up stings on this run sheet to level.', [{ label: 'OK', value: true, kind: 'primary' }]); return; }
    const wrap = document.createElement('div');
    wrap.className = 'ask lvl-dlg';
    wrap.innerHTML = '<div class="ask-box" role="dialog" aria-modal="true"><div class="ask-text"><b>Levelling this show’s stings</b></div>' +
      '<table class="lvl-table"><tbody>' + items.map(it => `<tr data-id="${esc(it.id)}"><td>${esc(it.name || '')}</td><td>${esc(it.sting.name)}</td><td class="lvl-r">waiting</td></tr>`).join('') + '</tbody></table>' +
      '<p class="lvl-sum"></p><div class="ask-btns"><button class="lvl-tone2" disabled>▶ Line-up tone</button><button class="primary lvl-close">Close</button></div></div>';
    document.body.appendChild(wrap);
    let open = true;
    const close = () => { open = false; document.removeEventListener('keydown', onKey, true); wrap.remove(); };
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } else if (e.key === 'PageDown' || e.key === 'PageUp') e.stopPropagation(); }
    document.addEventListener('keydown', onKey, true);
    wrap.querySelector('.lvl-close').addEventListener('click', close);
    const cell = id => wrap.querySelector(`tr[data-id="${id}"] .lvl-r`);
    const found = {};
    for (const it of items) {
      if (!open) return;
      const s = it.sting, c = cell(it.id);
      c.textContent = 'measuring…';
      if (s.duration > StingClip.LIMITS.source) { c.textContent = 'too long to measure'; continue; }
      try {
        const src = await stingSource(s);
        if (!src) { c.textContent = 'its file isn’t here'; continue; }
        const l = StingClip.loudness(StingClip.render(await StingClip.decode(src), s));
        found[it.id] = l;
        c.textContent = l == null ? 'silent' : l.toFixed(1) + ' LUFS';
      } catch (_) { c.textContent = s.media === 'video' ? 'no sound to measure (or unreadable)' : 'couldn’t be read'; }
    }
    if (!open) return;
    // Keep each measurement on its sting (the timer levels with it)
    let changed = false;
    for (const [id, l] of Object.entries(found)) {
      const it = sheet.items.find(x => x.id === id);
      if (it && it.sting && l != null && it.sting.lufs !== l) { it.sting.lufs = l; changed = true; }
    }
    if (changed) saveSheet();
    const vals = Object.values(found).filter(l => l != null);
    const sum = wrap.querySelector('.lvl-sum');
    if (!vals.length) { sum.textContent = 'Nothing could be measured.'; return; }
    const low = Math.max(StingClip.LEVEL.min, Math.min(StingClip.LEVEL.max, Math.min(...vals)));
    try { localStorage.setItem(StingClip.SHOW_KEY, JSON.stringify({ lufs: low, n: vals.length, at: Date.now(), title: sheet.title || '' })); } catch (_) { /* private mode */ }
    for (const [id, l] of Object.entries(found)) if (l != null) {   // the change it plays at: down to the level, and its trim
      const it = sheet.items.find(x => x.id === id), d = Math.min(0, low - l) + 20 * Math.log10(StingClip.trim(it && it.sting));
      cell(id).textContent = l.toFixed(1) + ' LUFS · ' + (d < -0.05 ? d.toFixed(1) + ' dB' : 'as it is');
    }
    sum.innerHTML = `This show’s level: <b>${low.toFixed(1)} LUFS</b>, the quietest sting’s. It plays as it is; the others are turned down to match. Play the line-up tone and set the mixer’s input so it reads your nominal level: every sting then lands there.`;
    const tb = wrap.querySelector('.lvl-tone2');
    tb.disabled = false;
    const label = () => { tb.textContent = toneOn ? '■ Stop the tone' : '▶ Line-up tone'; };
    tb.addEventListener('click', () => { toggleTone(); label(); });
    label();
    renderLevels();
  }
  if (STINGS) {
    if (REMOTE) $('lvl-local').hidden = true;
    else {
      $('opt-house').addEventListener('change', e => {
        const v = Math.round(Number(e.target.value));
        try { if (v >= StingClip.LEVEL.min && v <= StingClip.LEVEL.max) localStorage.setItem(StingClip.TARGET_KEY, String(v)); else localStorage.removeItem(StingClip.TARGET_KEY); } catch (_) { /* private mode */ }
        renderLevels();
      });
      $('lvl-scan').addEventListener('click', levelShow);
      $('lvl-house').addEventListener('click', () => { try { localStorage.removeItem(StingClip.SHOW_KEY); } catch (_) { /* private mode */ } renderLevels(); });
      window.addEventListener('storage', e => { if (e.key === StingClip.SHOW_KEY || e.key === StingClip.TARGET_KEY) renderLevels(); });
    }
    $('lvl-tone').addEventListener('click', () => toggleTone());
    renderLevels();
  } else $('lvl-box').hidden = true;
  if (window.AudioOut) AudioOut.picker($('ao-pick'), REMOTE ? ['preview'] : ['show', 'preview']);
  else $('ao-box').hidden = true;
  async function attachSting(id, file, extra) {   // extra: {name, clip, lib} (a library clip)
    const item = sheet.items.find(it => it.id === id);
    if (!item || !file) return;
    if (!isMedia(file)) { alert('That isn’t an audio or video file.'); return; }
    if (!canEdit) return refused();
    if (item.video) { alert('This item has a video. Remove it first: an item has a video or a walk-up sting, not both.'); return; }
    const media = file.type.startsWith('video/') ? 'video' : 'audio';
    if (REMOTE) {
      if (!link.online) { alert('Not connected to the timer right now.'); return; }
      if (!link.lan) { alert('A sting file can only be sent to the timer over a direct link on the same network (the badge at the top shows ⚡ LAN direct). A stock sting or a link works from anywhere.'); return; }
      if (busy.size) { alert('Wait for the file being sent to finish first.'); return; }
      busy.add(id); sending.set(id, 0); renderAll();
      const duration = await probeDuration(file);
      toParent({ t: 'rs-video', kind: 'sting', id, file, name: noExt(file.name), duration, label: extra && extra.name, clip: extra && extra.clip, lib: extra && extra.lib });
      return;
    }
    if (!window.videoStore) { alert('Stings can’t be stored in this browser.'); return; }
    busy.add(id); renderAll();
    try {
      const st = await keepStingFile(id, file, extra);
      if (!sheet.items.find(x => x.id === id)) { window.videoStore.remove(st.key); return; }
      setSting(id, st);
    } catch (err) {
      alert('Couldn’t store the sting in this browser: ' + (err && err.message || err));
    } finally {
      busy.delete(id);
      renderAll();
    }
  }
  // A file kept in this browser for item id ('rssting:'): the sting for it (not put on the item yet)
  async function keepStingFile(id, file, extra) {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const duration = await probeDuration(file);
    const key = 'rssting:' + id + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 6);
    await window.videoStore.put(key, file);
    return Object.assign({ src: 'file', media: file.type.startsWith('video/') ? 'video' : 'audio', name: String((extra && extra.name) || noExt(file.name)).slice(0, 200), size: file.size, duration: duration ? Math.round(duration) : null, key },
      extra && extra.clip, extra && extra.lib ? { lib: extra.lib } : {});
  }
  // ✂: choose the part of the track to play (sting-clip.js), with fades. The file isn't cut.
  async function trimSting(id) {
    if (!canEdit) return refused();
    const it = sheet.items.find(x => x.id === id);
    if (!it || !it.sting) return;
    const s = it.sting;
    let src = null;
    if (s.key && !REMOTE && window.videoStore) { try { src = await window.videoStore.get(s.key); } catch (_) { /* not here */ } }
    if (!src && s.url) src = s.url;
    if (!src) { alert('This sting’s file is kept on the timer’s computer: trim it there.'); return; }
    const r = await StingClip.open({ src, name: s.name, region: s, media: s.media });
    if (!r) return;
    const now = sheet.items.find(x => x.id === id);
    if (!now || !now.sting) return;
    const st = Object.assign({}, now.sting, { name: r.name });
    delete st.rolled;                              // edited: theirs now (a roll of the sheet leaves it alone)
    for (const k of CLIP_KEYS) { if (r[k] == null) delete st[k]; else st[k] = r[k]; }
    if (st.duration == null && r.sourceLength) st.duration = Math.round(r.sourceLength);   // (the whole track's length)
    // From the sting library: the same change there too, if they like (a better cut, a new name)
    const list = st.lib && window.StingLibrary ? StingLibrary.read() : [], li = list.findIndex(x => x.name === st.lib);
    if (li >= 0) {
      const both = await ask(`This sting came from <b>${esc(st.lib)}</b> in your sting library. Update the library too?`,
        [{ label: 'Update the library', value: true, kind: 'primary' }, { label: 'Just this item', value: false, cancel: true }]);
      if (both) {
        const e = Object.assign({}, list[li], { name: r.name });
        for (const k of CLIP_KEYS) { if (r[k] == null) delete e[k]; else e[k] = r[k]; }
        const clean = StingLibrary.clean(e);
        if (clean) { list[li] = clean; StingLibrary.write(list); st.lib = clean.name; }
      }
    }
    now.sting = st;
    saveSheet();
  }
  function removeSting(id) {
    const item = sheet.items.find(it => it.id === id);
    if (!item || !item.sting) return;
    if (!confirm(`Remove the walk-up sting "${item.sting.name}" from this item?`)) return;
    if (!REMOTE && item.sting.key && window.videoStore) window.videoStore.remove(item.sting.key).catch(() => {});
    delete item.sting;
    saveSheet();
  }
  const stingPicker = document.createElement('input');
  stingPicker.type = 'file'; stingPicker.accept = 'audio/*,video/*'; stingPicker.hidden = true;
  document.body.appendChild(stingPicker);
  stingPicker.addEventListener('change', () => { const f = stingPicker.files[0]; stingPicker.value = ''; if (f && pickFor) attachSting(pickFor, f); });

  // ─── Random stings (the owner's design, Nov 2026) ─────────────────────────
  // A walk-up sting picked at random for every item long enough to be a speaker (Random stings → 🎲 Roll
  // stings), none used twice on the sheet; 🎲 on a row picks another for that item. The pool: stock stings,
  // the folder (+ sting's Custom file), My clips (the sting library), and a length filter (as it plays).
  // One song, one candidate: a stock sting, its clips (the site's and mine) and a link are one song (its url),
  // a file is known by its size (all a file sting keeps of it), so no two speakers get the same track in
  // different cuts. With My clips ticked an edit stands in for its track; unticked, tracks play as supplied
  // (originals hidden behind an edit come back). Audio only (a video walk-up needs the player window).
  // Rolled stings carry rolled: true; a sting chosen by hand (+ sting, a dropped file, ✂) doesn't, and a
  // roll of the sheet leaves it, and videos, alone, as it does rows that have run and the live item. A
  // remote editor picks only stock and link stings (a file would have to be sent).
  const ROLL_KEY = 'sting_roll';
  const AUDIO_EXT = /\.(mp3|m4a|aac|wav|aif|aiff|flac|ogg|oga|opus|weba)$/i;
  function rollOpts() {
    const d = { stock: true, folder: false, mine: true, min: 2, lenOp: '', len: 30 };
    try { return Object.assign(d, JSON.parse(localStorage.getItem(ROLL_KEY) || '{}')); } catch (_) { return d; }
  }
  const songOf = s => (s.url ? 'url:' + s.url : s.size ? 'size:' + s.size : 'name:' + s.name);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  StingPicker.onFolder(() => renderRollPanel());   // (+ sting's folder, chosen there or here)
  // song → its versions [{kind: 'stock'|'mine'|'folder', len (s as it plays; undefined: probe it), x | e | file}]
  async function rollPool(o, stock) {
    const songs = new Map(), add = (song, c) => { if (!songs.has(song)) songs.set(song, []); songs.get(song).push(c); };
    const mine = o.mine && window.StingLibrary ? StingLibrary.read() : [];
    for (const e of mine) {
      if (e.media === 'video' || (e.file && REMOTE)) continue;
      const base = e.stock ? stock.find(x => x.name === e.stock) : null;
      if (e.stock && !base) continue;
      if (e.file && !(await StingLibrary.source(e, stock))) continue;   // (its file isn't on this computer)
      add(e.file ? 'size:' + e.size : 'url:' + (base ? base.url : e.url), { kind: 'mine', e, len: StingClip.length(e, e.duration != null ? e.duration : base && base.duration) });
    }
    const edited = new Set(songs.keys());         // my edits stand in for the tracks they came from
    if (o.stock) {
      const hidden = window.StingLibrary ? StingLibrary.hidden(stock, mine) : new Set();
      stock.forEach((x, i) => {
        if (hidden.has(i) || x.media === 'video' || edited.has('url:' + x.url)) return;
        add('url:' + x.url, { kind: 'stock', x, len: StingClip.length(x, x.duration) });
      });
    }
    if (o.folder && !REMOTE && await StingPicker.ensureFolder()) {
      for (const f of StingPicker.folder().files) {
        if (!AUDIO_EXT.test(f.path)) continue;
        let file; try { file = f.file || await f.handle.getFile(); } catch (_) { continue; }
        if (!edited.has('size:' + file.size)) add('size:' + file.size, { kind: 'folder', file, len: undefined });
      }
    }
    return songs;
  }
  const fitsLen = (len, o) => !o.lenOp || (len != null && (o.lenOp === 'max' ? len <= o.len : len >= o.len));
  async function pickSong(songs, used, o, avoid) {   // a random song not used (nor avoid), in a version that fits
    for (const song of shuffle([...songs.keys()])) {
      if (used.has(song) || song === avoid) continue;
      for (const c of shuffle(songs.get(song).slice())) {
        if (c.len === undefined) c.len = await probeDuration(c.file);
        if (fitsLen(c.len, o)) return { song, c };
      }
    }
    return null;
  }
  async function stingFor(id, c, stock) {        // the sting for a version (a file is stored for item id)
    if (c.kind === 'stock') return Object.assign({ src: 'stock', media: 'audio', name: c.x.name, url: c.x.url, duration: c.x.duration }, clipFields(c.x));
    const e = c.e;
    if (c.kind === 'mine' && !e.file) {
      const base = e.stock ? stock.find(x => x.name === e.stock) : null;
      return Object.assign({ src: e.stock ? 'stock' : 'link', media: 'audio', name: e.name, url: await StingLibrary.source(e, stock), duration: e.duration != null ? Math.round(e.duration) : base && base.duration, lib: e.name }, clipFields(e));
    }
    if (c.kind === 'folder') return keepStingFile(id, c.file);
    const blob = await StingLibrary.source(e, stock);
    return blob ? keepStingFile(id, new File([blob], e.file, { type: blob.type || 'audio/mpeg' }), { name: e.name, clip: clipFields(e), lib: e.name }) : null;
  }
  // Can item i have a rolled sting? (sheetRoll: and does the sheet's 🎲 roll it: long enough, not chosen by hand)
  function rollable(i, o, sheetRoll) {
    const it = sheet.items[i], n = norm && norm.items[i];
    if (!it || !n || it.hidden || n.isEnd || it.video) return false;
    const role = rowRole(i);
    if (role === 'done' || role === 'now') return false;
    return !sheetRoll || ((!it.sting || it.sting.rolled) && (n.eff || 0) >= o.min * 60);
  }
  const rollMsg = (text, bad) => { const m = $('roll-msg'); if (m) { m.textContent = text; m.classList.toggle('bad', !!bad); } };
  const noPool = o => !o.stock && !o.mine && !(o.folder && !REMOTE);
  let rolling = false;
  // Picks for the items (ids), then puts them on the sheet as it is by then (an item that changed meanwhile
  // is left alone, its stored file removed) and saves once. → {got, none}
  async function rollItems(ids, o, sheetRoll) {
    const stock = await stockStings(), songs = await rollPool(o, stock);
    const targets = new Set(ids);
    const used = new Set(sheet.items.filter(it => it.sting && !targets.has(it.id)).map(it => songOf(it.sting)));
    const picks = [];
    let none = 0;
    for (const id of ids) {
      const it = sheet.items.find(x => x.id === id), was = it && it.sting ? songOf(it.sting) : null;
      // Another song if there is one; rolling the sheet, its own again rather than none (🎲 on a row: only another)
      let p = await pickSong(songs, used, o, was);
      if (!p && was && sheetRoll) p = await pickSong(songs, used, o, null);
      if (!p) {
        none++;
        if (was && !used.has(was)) used.add(was);  // it keeps the one it has
        else if (was && sheetRoll) picks.push([id, null]);   // (its song went to another item: it can't keep it too)
        continue;
      }
      used.add(p.song);
      try { const st = await stingFor(id, p.c, stock); if (st) picks.push([id, Object.assign(st, { rolled: true })]); else none++; }
      catch (err) { console.warn('Random stings: couldn’t keep the file', err); none++; }
    }
    let got = 0;
    let changed = false;
    for (const [id, st] of picks) {
      const i = sheet.items.findIndex(x => x.id === id), it = sheet.items[i];
      const ok = i >= 0 && rollable(i, o, false) && (!sheetRoll || !it.sting || it.sting.rolled);
      if (!st) { if (ok && it.sting && it.sting.rolled) { if (!REMOTE && it.sting.key && window.videoStore) window.videoStore.remove(it.sting.key).catch(() => {}); delete it.sting; changed = true; } continue; }
      if (ok) { putSting(it, st); got++; changed = true; }
      else if (st.key && window.videoStore) window.videoStore.remove(st.key).catch(() => {});
    }
    if (changed) saveSheet();
    return { got, none };
  }
  async function rollAll() {
    if (!canEdit) return refused();
    if (rolling || scaling) return;
    const o = rollOpts();
    if (noPool(o)) return rollMsg('Tick where stings may come from.', true);
    const ids = sheet.items.filter((it, i) => rollable(i, o, true)).map(it => it.id);
    if (!ids.length) return rollMsg(`No items to give a sting: none ${o.min ? 'of ' + o.min + ' min or more ' : ''}without one of your own (or a video) still to come.`, true);
    rolling = true; rollMsg('Rolling…');
    try {
      const r = await rollItems(ids, o, true);
      const kept = sheet.items.filter((it, i) => it.sting && !it.sting.rolled && !it.hidden && rollable(i, o, false)).length;
      rollMsg(`${r.got} item${r.got === 1 ? '' : 's'} got a sting at random` + (kept ? `; ${kept} kept the one chosen for ${kept === 1 ? 'it' : 'them'}` : '') +
        (r.none ? `; ${r.none} didn’t: not enough stings ${o.lenOp ? 'of that length ' : ''}left unused.` : '.'), r.none > 0);
    } finally { rolling = false; renderAll(); }
  }
  async function rollOne(id) {
    if (!canEdit) return refused();
    if (rolling || scaling) return;
    const i = sheet.items.findIndex(x => x.id === id), o = rollOpts();
    if (i < 0 || !rollable(i, o, false)) return;
    if (noPool(o)) return ask('Choose where random stings come from in <b>Random stings</b> (on the right) first.', [{ label: 'OK', value: true, kind: 'primary', cancel: true }]);
    rolling = true; busy.add(id); renderAll();
    try {
      const r = await rollItems([id], o, false);
      if (!r.got) ask(`No ${sheet.items[i] && sheet.items[i].sting ? 'other ' : ''}sting to pick: every one ${o.lenOp ? 'of that length ' : ''}is already on the run sheet.`, [{ label: 'OK', value: true, kind: 'primary', cancel: true }]);
    } finally { rolling = false; busy.delete(id); renderAll(); }
  }
  async function clearRolled() {
    if (!canEdit) return refused();
    const o = rollOpts(), its = sheet.items.filter((it, i) => it.sting && it.sting.rolled && rollable(i, o, false));
    if (!its.length) return rollMsg('No rolled stings to remove (rows that have run keep theirs).');
    if (!(await ask(`Remove the ${its.length} sting${its.length === 1 ? '' : 's'} picked at random? Stings you chose stay.`, [{ label: 'Remove them', value: true, kind: 'danger' }, { label: 'Cancel', value: false, cancel: true }]))) return;
    for (const it of its) { if (!REMOTE && it.sting.key && window.videoStore) window.videoStore.remove(it.sting.key).catch(() => {}); delete it.sting; }
    saveSheet();
    rollMsg(`${its.length} rolled sting${its.length === 1 ? '' : 's'} removed.`);
  }
  async function renderRollPanel() {
    const box = $('rollpanel');
    if (!box) return;
    if (!STINGS) { box.hidden = true; return; }
    const o = rollOpts();
    $('roll-stock').checked = o.stock; $('roll-mine').checked = o.mine; $('roll-folder').checked = o.folder && !REMOTE;
    $('roll-folder').disabled = REMOTE;
    $('roll-min').value = o.min; $('roll-lenop').value = o.lenOp; $('roll-len').value = o.len; $('roll-len').disabled = !o.lenOp;
    const folder = StingPicker.folder();
    let name = folder && folder.name;
    if (!name && !REMOTE) { const sf = await StingPicker.savedFolder(); name = sf && sf.handle.name; }
    $('roll-foldername').textContent = REMOTE ? '(only on the timer’s computer)' : name ? '“' + name + '”' : '(none chosen yet)';
    $('roll-folderpick').hidden = REMOTE;
    $('roll-folderpick').textContent = name ? 'Another…' : 'Choose…';
  }
  function saveRollOpts() {
    const n = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? x : d; };
    const o = { stock: $('roll-stock').checked, mine: $('roll-mine').checked, folder: $('roll-folder').checked, min: n($('roll-min').value, 0, 600, 2),
      lenOp: ['max', 'min'].includes($('roll-lenop').value) ? $('roll-lenop').value : '', len: Math.round(n($('roll-len').value, 1, 3600, 30)) };
    try { localStorage.setItem(ROLL_KEY, JSON.stringify(o)); } catch (_) { /* private mode */ }
    $('roll-len').disabled = !o.lenOp;
  }
  if ($('rollpanel')) {
    for (const k of ['roll-stock', 'roll-mine', 'roll-folder', 'roll-min', 'roll-lenop', 'roll-len']) $(k).addEventListener('change', saveRollOpts);
    $('roll-all').addEventListener('click', e => { e.currentTarget.blur(); rollAll(); });
    $('roll-clear').addEventListener('click', e => { e.currentTarget.blur(); clearRolled(); });
    $('roll-folderpick').addEventListener('click', e => { e.currentTarget.blur(); StingPicker.chooseFolder(); });
    renderRollPanel();
  }

  // Videos and stings no longer used by the sheet (rows deleted, sheet replaced) are removed from the browser
  // (as are slides from before the PowerPoint computers were dropped: rsdeck:, rsimg:)
  function cleanUpVideos() {
    if (REMOTE || !window.videoStore) return;
    const used = new Set(sheet.items.filter(it => it.video).map(it => it.video.key));
    sheet.items.forEach(it => { if (it.sting && it.sting.key) used.add(it.sting.key); });
    // Videos in the timer's Recent videos list stay until they drop off it (video-library.js)
    try { (JSON.parse(localStorage.getItem('video_history') || '[]') || []).forEach(e => { if (e && e.key) used.add(e.key); }); } catch (_) { /* ignore */ }
    window.videoStore.keys().then(keys => keys.forEach(k => {
      if (/^rs(video|deck|img|sting):/.test(String(k)) && !used.has(k)) window.videoStore.remove(k).catch(() => {});
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
    const f = list.find(x => x.type.startsWith('video/')) || (STINGS && list.find(x => x.type.startsWith('audio/')));
    if (!f) return;
    e.preventDefault();
    if (f.type.startsWith('video/')) attachVideo(tr.dataset.id, f);
    else attachSting(tr.dataset.id, f);   // music: a walk-up sting
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
    if (input.classList.contains('hard')) {          // the hard-start tick: kept on the item (auto)
      const it = sheet.items.find(x => x.id === input.closest('tr').dataset.id);
      if (!it || scaling) { renderAll(); return; }
      if (input.checked) {
        // Not typed: it keeps the start it shows now, as a typed one (a hard start doesn't ripple)
        if (it.start == null) {
          const j = sheet.items.indexOf(it), ms = provisional() ? null : plannedMs(norm.items[j].planned);
          if (ms == null) { renderAll(); return; }
          // A sheet without times (show under way): pin the first row too, so nothing else moves
          const s0 = sheet.items[0];
          if (!norm.anchored && s0 !== it && s0.start == null) s0.start = secOfDay(plannedMs(norm.items[0].planned));
          it.start = secOfDay(ms);
        }
        it.auto = true;
      } else delete it.auto;
      saveSheet();
      return;
    }
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
    if (!it || it.isEnd || it.hidden || it.video || state.finished || !canEdit) return false;
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
      case 'sadd':
        stingDialog(id);
        break;
      case 'sdel':
        removeSting(id);
        break;
      case 'strim':
        trimSting(id);
        break;
      case 'sroll':
        rollOne(id);
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
  // Docked, the title is on the dock's bar (runsheet-dock.js), which has room: told what it is, sends what's typed
  let dockSent = null;
  function dockTitle() {
    if (!DOCKED) return;
    const msg = { t: 'rs-dock-title', title: sheet.title || '', ro: !canEdit };
    if (JSON.stringify(msg) === dockSent) return;
    dockSent = JSON.stringify(msg);
    try { window.parent.postMessage(msg, location.origin); } catch (_) { /* gone */ }
  }
  if (DOCKED) {
    document.documentElement.classList.add('docked');
    addEventListener('message', e => {
      if (e.origin !== location.origin || e.source !== window.parent || !e.data || e.data.t !== 'rs-dock-title' || typeof e.data.set !== 'string') return;
      if (!canEdit) { dockSent = null; dockTitle(); return refused(); }
      sheet.title = e.data.set.trim().slice(0, 200); saveSheet();
    });
  }
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
    // Replace: rows that are items already here (same id, else same name) stay those items (C.matchRows)
    let rows = res.items, matched = 0, dropped = 0;
    if (mode === 'replace') {
      const kept = keptItems(), done = new Set(kept.map(x => x.id));
      const m = C.matchRows(sheet.items.filter(x => !done.has(x.id)), rows, res.fileIds, done);
      rows = m.items; matched = m.matched; dropped = m.dropped;
      sheet.items = kept.concat(rows);
    } else sheet.items = sheet.items.concat(rows = C.freshIds(sheet.items, rows));
    saveSheet();
    if (mode === 'replace' && (state.log || []).length && confirm('Also reset the show? This clears the log and starts again from the top.')) send('reset');

    const cols = Array.isArray(res.columns) ? res.columns.filter(Boolean).join(', ') : 'one item per line';
    msg.className = res.warnings.length ? 'warn' : 'ok';
    msg.textContent = `${mode === 'replace' ? 'Loaded' : 'Added'} ${rows.length} item${rows.length === 1 ? '' : 's'} (read as: ${cols}).` +
      (matched ? ` ${matched} matched ${matched === 1 ? 'an item' : 'items'} already on the sheet (attached videos, stings and playout cues stay with them).` : '') +
      (dropped ? ` ${dropped} that ${dropped === 1 ? 'has' : 'have'} already run left out.` : '') +
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

  // Clear sheet: in the Add items panel and above the ✕ column
  function clearSheet() {
    if (scaling || !sheet.items.length || !confirm('Delete every item in the run sheet?' + (keptItems().length ? ' Items that have already run stay in the record, hidden.' : ''))) return;
    sheet.items = keptItems();
    saveSheet();
  }
  $('clear-all').addEventListener('click', clearSheet);
  $('clear-all-head').addEventListener('click', clearSheet);

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
  $('btn-fadeout').addEventListener('click', e => { e.currentTarget.blur(); send('fadeout'); });
  $('btn-plstop').addEventListener('click', e => { e.currentTarget.blur(); send('fadeout', { msecs: 300 }); });
  // Esc, when nothing here wants it (a dialog, the help, typing in a box): what's playing fades out
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.metaKey || !live.playing || typingIn(e.target)) return;
    if (document.querySelector('.ask, .sc-wrap, .sting-libwrap, #help:not([hidden])')) return;
    e.preventDefault();
    if (!e.repeat) send('fadeout');
  });
  $('btn-back').addEventListener('click', () => send('back'));
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
  // Time of day in the header, changing on the second
  const tod = $('tod');
  (function tickTod() {
    const now = editorNow();
    tod.textContent = clockSec(now);
    setTimeout(tickTod, 1000 - now % 1000 + 20);
  })();
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
  // In run sheet mode Space is Next and delete (Backspace) is Back here too, as on the timer, unless
  // something is being typed (a text box, a list) or a question is open. A focused button (Reset show…
  // just clicked, say) doesn't get Space: it would press it again. Checkboxes neither: they're not typing.
  const typingIn = t => t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
    (t.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file)$/.test(t.type)))
  const nextBackKey = e => (e.key === ' ' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !!state.active &&
    !typingIn(e.target) && !document.querySelector('.ask')
  document.addEventListener('keydown', e => {
    if (!nextBackKey(e)) return;
    e.preventDefault();
    if (!e.repeat) send(e.key === ' ' ? 'next' : 'back');
  });
  document.addEventListener('keyup', e => { if (nextBackKey(e)) e.preventDefault(); });   // buttons act on Space's keyup
  // While a text box has the keyboard (Space and delete type there) the whole surface turns navy,
  // so it's plain that they aren't Next and Back (html.typing)
  const markTyping = () => document.documentElement.classList.toggle('typing', document.hasFocus() && !!typingIn(document.activeElement));
  document.addEventListener('focusin', markTyping);
  document.addEventListener('focusout', () => setTimeout(markTyping, 0));
  addEventListener('focus', markTyping); addEventListener('blur', markTyping);

  // ─── Help (README overlay, see help-overlay.js; ? / F1 also open it) ───────

  const help = HelpOverlay.install({ section: 'run-sheet' });
  $('btn-help').addEventListener('click', () => help.open('run-sheet'));

  // ─── Boot ─────────────────────────────────────────────────────────────────

  if (REMOTE) {
    document.title = (location.hostname || 'Timer') + ' - Run sheet (remote)';
    const tag = document.createElement('span');
    tag.id = 'remote-tag';
    $('live').before(tag);
    tag.addEventListener('click', e => { if (e.target.closest('button')) { toParent({ t: 'rs-edit-ask', on: true }); } });
    if (TOUCH_UI) {                                  // the phone remote: Done goes back to its run sheet display
      document.documentElement.classList.add('touchui');
      const done = document.createElement('button');
      done.id = 'btn-done'; done.textContent = 'Done';
      done.addEventListener('click', () => toParent({ t: 'rs-done' }));
      $('title').before(done);
    }
    renderEditBar();
    toParent({ t: 'rs-ready' });
  }
  // In its own window, opened by the timer: ⇲ Dock puts it back along the bottom of the timer's
  // screen (runsheet-dock.js), where it opens from then on
  let opener = null;
  try { opener = !REMOTE && window.parent === window && window.opener && !window.opener.closed && window.opener.runsheetDock ? window.opener : null; } catch (_) { /* another site */ }
  if (opener) {
    const b = document.createElement('button');
    b.id = 'btn-dock'; b.textContent = '⇲ Dock';
    b.title = 'Put the run sheet editor back along the bottom of the timer’s screen (it opens there from then on)';
    b.addEventListener('click', () => { send('dock'); setTimeout(() => window.close(), 150); });
    $('btn-help').before(b);
  }
  renderAll();
  setInterval(renderLive, 2000);
  setInterval(() => { if (norm.items.length && provisional()) renderStatus(); }, 5000);   // times as if it started now
  setTimeout(cleanUpVideos, 3000);   // remove stored videos the sheet no longer uses
})();
