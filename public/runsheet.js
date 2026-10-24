/*!
 * runsheet.js
 * Run sheet controller for the Presentation Timer (controller window only).
 *
 *  - Next (Page Down, Stream Deck, editor) logs the actual start, sets the message to
 *    the item name, sets the default duration and starts the timer.
 *  - Back (Page Up, Stream Deck, editor) undoes the last Next exactly, by restoring
 *    the timer snapshot taken just before it.
 *  - Draws the previous / now / next dashboard and works out ahead / behind.
 *
 * Storage (shared with the editor window, runsheet.html):
 *   runsheet        the sheet (written by the editor)
 *   runsheet_state  show state: active, index, history, log (written only here)
 *   runsheet_cmd    commands from the editor (read and removed here)
 *   runsheet_live   status text for the editor (written here, ~1/s on change)
 * MIT Licensed
 */

/* global RunsheetCore, processTimerApiMessage, timeProvider, setHtmlClass, clearHtmlClass */

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (params.has('presenter')) return;   // controller only
  if (typeof RunsheetCore === 'undefined') return;

  const C = RunsheetCore;
  const SHEET_KEY = 'runsheet', STATE_KEY = 'runsheet_state', CMD_KEY = 'runsheet_cmd', LIVE_KEY = 'runsheet_live';
  const ON_TIME_SEC = 30;        // within this many seconds counts as "on time"
  const MAX_HISTORY = 200;

  const readJSON = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (_) { return def; } };
  const emptyState = () => ({ active: false, index: -1, currentId: null, finished: false, history: [], log: [], dayBase: null });

  let sheet = readJSON(SHEET_KEY, { title: '', perItem: 20, items: [] });
  const savedState = readJSON(STATE_KEY, null);
  let state = Object.assign(emptyState(), savedState || {});
  let norm = C.normalise(sheet);
  if (!savedState && norm.items.length) state.active = true;   // first run with a sheet already loaded

  const api = msg => (typeof processTimerApiMessage === 'function' ? processTimerApiMessage(msg) : undefined);
  const now = () => timeProvider.now();
  const isActive = () => !!state.active && norm.items.length > 0;
  const idxOf = id => norm.items.findIndex(it => it.id === id);

  function dayBaseNow() {
    const d = timeProvider.date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  // First item to run after index `from` (skips the finish marker); -1 if none.
  function nextIndex(from) {
    for (let j = from + 1; j < norm.items.length; j++) if (j !== norm.endIdx && !norm.items[j].hidden) return j;
    return -1;
  }

  // Planned start of item i as a timestamp (ms), or null if not yet known.
  function plannedMs(plannedSec) {
    if (plannedSec == null) return null;
    if (norm.anchored) return (state.dayBase != null ? state.dayBase : dayBaseNow()) + plannedSec * 1000;
    // Unanchored: pinned to the actual start of the first item run in this show
    const first = state.log.find(e => e.id !== 'end');
    const fi = first ? idxOf(first.id) : -1;
    if (!first || fi < 0) return null;
    return (first.orig != null ? first.orig : first.actual) + (plannedSec - norm.items[fi].planned) * 1000;   // orig: before a Restart
  }
  const plannedStartMs = i => (norm.items[i] ? plannedMs(norm.items[i].planned) : null);
  const plannedFinishMs = () => plannedMs(norm.finishPlanned);

  // ─── Actions ──────────────────────────────────────────────────────────────

  let lastAction = 0;
  function debounced() {               // a bouncing clicker shouldn't skip two items
    const t = Date.now();
    if (t - lastAction < 300) return true;
    lastAction = t;
    return false;
  }

  function pushHistory() {
    state.history.push({
      timer: api({ cmd: 'snapshot' }),
      index: state.index, currentId: state.currentId, finished: state.finished,
      logLen: state.log.length, dayBase: state.dayBase,
    });
    if (state.history.length > MAX_HISTORY) state.history.shift();
  }

  function startItem(i) {
    const it = norm.items[i];
    if (state.dayBase == null) state.dayBase = dayBaseNow();
    state.index = i; state.currentId = it.id; state.finished = false;
    const entry = { id: it.id, name: it.name, planned: null, plannedDur: it.eff, actual: now() };
    state.log.push(entry);
    entry.planned = plannedStartMs(i);            // after push: an unanchored show is pinned to its first entry
    const ms = it.eff * 1000;
    api({ cmd: 'default', msecs: ms });
    api({ cmd: 'start', msecs: ms });
    noteTimerStart();
    api({ cmd: 'custommessage', text: it.name });
    if (it.video) playItemVideo(it);              // the player restarts the timer at the video's length
    else stopRunsheetVideo();                     // moving on from a video item stops its video
    // Slides: every PowerPoint machine sets the item's holding slide as its wallpaper and opens its
    // deck. An item without a deck leaves the last one on screen.
    if ((it.deck || it.holding) && window.pptxHub) window.pptxHub.start(it);
  }

  // The editor's Restart: the countdown again from the current item's full time (or the default
  // duration outside the run sheet). Only the timer: no log entry, message, video or slides.
  // The item gets its full time from now (a long introduction, a late walk-on), so its start in
  // the log moves to now and everything after it runs that much later (see lateness()).
  function restartCountdown() {
    const it = isActive() && !state.finished ? norm.items.find(x => x.id === state.currentId) : null;
    if (!it) { api({ cmd: 'start' }); return; }
    api({ cmd: 'start', msecs: it.eff * 1000 });
    noteTimerStart();
    const e = state.log[state.log.length - 1];
    if (e && e.id === it.id) {
      if (e.orig == null) e.orig = e.actual;      // keeps an unanchored sheet pinned to the first start
      e.actual = now();
      e.restarts = (e.restarts || 0) + 1;
    }
    commit();
  }

  function finishShow() {
    state.finished = true;
    const end = norm.endIdx >= 0 ? norm.items[norm.endIdx] : null;
    state.log.push({ id: 'end', name: end ? end.name : 'Finish', planned: plannedFinishMs(), plannedDur: 0, actual: now() });
    api({ cmd: 'custommessage', text: '' });
  }

  function next() {
    if (!isActive()) return false;
    if (debounced()) return false;
    if (state.finished) { flash('End of run sheet — Back to undo'); return false; }
    const j = nextIndex(state.index);
    pushHistory();
    if (j < 0) finishShow(); else startItem(j);
    commit();
    return true;
  }

  function goTo(id) {
    if (!isActive()) return false;
    const i = idxOf(id);
    if (i < 0 || i === norm.endIdx || norm.items[i].hidden) return false;
    pushHistory();
    startItem(i);
    commit();
    return true;
  }

  function back() {
    if (!isActive()) return false;
    if (debounced()) return false;
    const h = state.history.pop();
    if (!h) { flash('Nothing to go back to'); return false; }
    stopRunsheetVideo();                          // undoing a video item stops it (it's then cued again)
    if (h.timer) api({ cmd: 'restore', state: h.timer });
    state.index = h.index; state.currentId = h.currentId; state.finished = h.finished;
    state.log.length = Math.min(state.log.length, h.logLen);
    state.dayBase = h.dayBase;
    state.timerStart = h.timer ? h.timer.startedAt : null;
    // Back onto an item that was hidden after it ran: it's live again, so it shows again
    const back = !state.finished && state.index >= 0 ? sheet.items.find(x => x.id === state.currentId) : null;
    if (back && back.hidden) { delete back.hidden; writeSheet(); }
    // Back onto an item with slides shows them again (if another deck is up)
    const it = !state.finished && state.index >= 0 ? norm.items[state.index] : null;
    if (it && window.pptxHub) window.pptxHub.current(it);
    commit();
    return true;
  }

  function resetShow() {
    state = Object.assign(emptyState(), { active: state.active });
    // Hidden items were deleted after they ran; kept only for the log, which a reset clears
    if (sheet.items.some(x => x.hidden)) { sheet.items = sheet.items.filter(x => !x.hidden); writeSheet(); }
    commit();
  }

  // ─── Changing the current item's time ─────────────────────────────────────
  // The run sheet and the countdown are kept in step: a new duration (or end) for the item
  // running now moves the timer's end, and time added or taken off on the timer (Ctrl+arrows,
  // ↑/↓, a phone, Companion) becomes the item's duration. A pause is neither: it doesn't change
  // the time allotted (seekEndsAt − startedAt − pauseAcum), it makes the show late.

  function writeSheet() {
    localStorage.setItem(SHEET_KEY, JSON.stringify(sheet));
    norm = C.normalise(sheet);
  }
  function noteTimerStart() {
    const s = api({ cmd: 'snapshot' });
    state.timerStart = s ? s.startedAt : null;
  }
  const allottedMs = s => s.seekEndsAt - s.startedAt - (s.pauseAcum || 0);
  const timerEndMs = s => s.seekEndsAt + (s.pausedAt != null ? now() - s.pausedAt : 0);
  function liveItem(id) {
    if (!isActive() || state.finished || state.index < 0 || (id && id !== state.currentId)) return null;
    return sheet.items.find(x => x.id === state.currentId) || null;
  }
  // The item's new duration; the start times written on later rows move by the same amount
  // (shift), so the rest of the day follows. curEnd (a new end time) leaves them alone: the
  // editor has just set the next start itself.
  function setLiveDuration(src, sec, shift) {
    const i = sheet.items.indexOf(src);
    const oldEff = norm.items[i] ? norm.items[i].eff : sec;
    src.duration = sec;
    if (shift) C.shiftStarts(sheet, i, sec - oldEff);
    writeSheet();
  }
  function bumpTimer(ms) {
    if (Math.abs(ms) >= 1) api({ cmd: 'adjust', addtime: ms > 0, msecs: Math.abs(ms) });
  }
  // A new duration for the item running now (null: back to the planned one)
  function curDuration(id, sec) {
    const src = liveItem(id);
    const s = api({ cmd: 'snapshot' });
    if (!src || !s) return false;
    if (sec == null) {                              // cleared: what the sheet would give it
      const copy = JSON.parse(JSON.stringify(sheet));
      copy.items.find(x => x.id === src.id).duration = null;
      sec = C.normalise(copy).items[sheet.items.indexOf(src)].eff;
    }
    const bump = sec * 1000 - allottedMs(s);
    if (timerEndMs(s) + bump <= now() + 1000) { flash('Too late for that duration: more of it has already gone'); return false; }
    bumpTimer(bump);
    setLiveDuration(src, Math.round(sec), true);
    syncSeen = null;
    commit();
    return true;
  }
  // The item running now ends at endClock (a time of day, on this computer's clock). With nextId,
  // that's the next item's new start (its start time from the editor), and everything after the
  // next item moves by as much; without, everything after the live item moves.
  // A time of day (seconds) as a timestamp: the one nearest the item running now (past midnight too)
  function clockToMs(sec) {
    const DAY = 86400e3, e = state.log[state.log.length - 1];
    const ref = e ? e.actual : now();
    let t = (state.dayBase != null ? state.dayBase : dayBaseNow()) + (sec % 86400) * 1000;
    while (t < ref - DAY / 4) t += DAY;
    while (t > ref + DAY * 3 / 4) t -= DAY;
    return t;
  }
  function curEnd(id, endClock, nextId) {
    const src = liveItem(id);
    const s = api({ cmd: 'snapshot' });
    if (!src || !s || endClock == null || !isFinite(endClock)) return false;
    const endMs = clockToMs(endClock);
    if (!(endMs > now() + 1000)) { flash('That end time has already passed'); return false; }
    const bump = endMs - timerEndMs(s);
    bumpTimer(bump);
    const sec = Math.max(1, Math.round((allottedMs(s) + bump) / 1000));
    const ni = nextId ? sheet.items.findIndex(x => x.id === nextId) : -1;
    if (ni > sheet.items.indexOf(src) && !sheet.items[ni].hidden) {
      const oldStart = norm.items[ni].planned;
      setLiveDuration(src, sec, false);
      sheet.items[ni].start = endClock % 86400;
      C.shiftStarts(sheet, ni, C.dayDelta(oldStart, endClock));
      writeSheet();
    } else {
      setLiveDuration(src, sec, true);
    }
    syncSeen = null;
    commit();
    return true;
  }
  // The live item's new name on the presenter's screen, if its name is what's showing there
  function liveName(id, name) {
    const src = liveItem(id);
    if (!src || typeof name !== 'string') return false;
    name = name.trim().slice(0, 300);
    const e = state.log[state.log.length - 1];
    const s = api({ cmd: 'snapshot' });
    const shown = s ? s.message : null;
    if (e && e.id === src.id && (shown === e.name || shown === src.name)) api({ cmd: 'custommessage', text: name });
    if (e && e.id === src.id) e.name = name;
    if (src.name !== name) { src.name = name; writeSheet(); }
    commit();
    return true;
  }
  // Time changed on the timer → the item's duration. Only for the countdown this run sheet
  // started (a new one typed on the timer isn't the item's), not for video items (their timer is
  // the video's length), and once the value has held for two checks (keys held down).
  let syncSeen = null;
  function syncFromTimer() {
    const src = liveItem();
    const s = src ? api({ cmd: 'snapshot' }) : null;
    if (!src || !s || src.video || state.timerStart == null || s.startedAt !== state.timerStart) { syncSeen = null; return; }
    const sec = Math.round(allottedMs(s) / 1000);
    const it = norm.items[sheet.items.indexOf(src)];
    if (!it || Math.abs(sec - it.eff) < 1 || sec < 1) { syncSeen = null; return; }
    if (syncSeen !== sec) { syncSeen = sec; return; }
    syncSeen = null;
    setLiveDuration(src, sec, true);
    commit();
  }

  function setActive(on) {
    state.active = !!on;
    commit();
  }

  function commit() {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
    render();
    preloadNext();
    if (window.pptxHub) window.pptxHub.changed();   // decks to send ahead, current and next first
  }

  // ─── Videos ───────────────────────────────────────────────────────────────
  // An item can carry a video (item.video {key, name, duration}, stored by the editor in the
  // browser: video-store.js) and a before-play setting (item.videoIdle 'show' | 'hide').
  // Next on such an item plays it at once; to make that instant, the NEXT item's video is
  // cued in the player while the current item runs. The item's name is the message. When
  // the video ends the sheet stays on the item (player back to before-play, timer 0:00).

  const vp = () => window.videoPlayer || null;

  async function cueItemVideo(it) {
    const p = vp();
    if (!p || !p.isOpen() || !window.videoStore) return false;
    let blob = null;
    try { blob = await window.videoStore.get(it.video.key); } catch (_) { /* missing */ }
    if (!blob) { flash(`The video for "${it.name}" isn't stored in this browser. Add it again in the run sheet editor.`); return false; }
    return p.load(URL.createObjectURL(blob), {
      name: it.video.name, idle: it.videoIdle, controls: false, message: it.name,
      revoke: true, tag: it.id, onEnd: 'recue',
      history: { kind: 'runsheet', key: it.video.key, size: it.video.size },
    });
  }

  function playItemVideo(it) {
    const p = vp();
    if (!p) return;
    // Opening the player needs a key press or click; Next from the keyboard or a clicker is one
    if (!p.isOpen() && !p.open()) { flash('Click "video" to open the player window, then press Next again'); return; }
    const st = p.state();
    if (st.cued && st.cued.tag === it.id) { p.play(); return; }   // preloaded: starts at once
    // Not preloaded: fetch it, then play. Hold the next preload meanwhile, or it could take
    // this video's place in the player.
    pendingPlay = it.id;
    cueItemVideo(it).then(ok => {
      const c = p.state().cued;
      if (ok && state.currentId === it.id && c && c.tag === it.id) p.play();
    }).finally(() => { if (pendingPlay === it.id) pendingPlay = null; preloadNext(); });
  }
  let pendingPlay = null;

  // Stops a run sheet video that's playing (not a dropped one), leaving the timer to the sheet
  function stopRunsheetVideo() {
    const p = vp();
    const st = p && p.state();
    if (st && st.playing && st.playing.tag) p.stop({ quiet: true });
  }

  // Cue the next item's video, or drop a run sheet video that's cued but no longer next.
  // Never replaces a dropped (ad hoc) video that's waiting to play.
  let preloadFor = null;
  function preloadNext() {
    const p = vp();
    if (!p || !p.isOpen() || !isActive() || pendingPlay) return;
    const nj = state.finished ? -1 : nextIndex(state.index);
    const it = nj >= 0 ? norm.items[nj] : null;
    const st = p.state();
    if (st.cued && !st.cued.tag) return;                        // a dropped video is cued
    if (!it || !it.video) {
      if (st.cued && st.cued.tag && st.cued.tag !== state.currentId) p.unloadCued();
      preloadFor = null;
      return;
    }
    if ((st.cued && st.cued.tag === it.id) || preloadFor === it.id) return;
    preloadFor = it.id;
    cueItemVideo(it).finally(() => { preloadFor = null; });
  }

  // Shown in the dashboard status when the next item is a video and the player isn't open
  function videoHint() {
    const p = vp();
    if (!p || !isActive() || state.finished) return '';
    const nj = nextIndex(state.index);
    const it = nj >= 0 ? norm.items[nj] : null;
    return it && it.video && !p.isOpen() ? 'next is a video: click "video" to open the player' : '';
  }

  // ─── Sheet changes from the editor ────────────────────────────────────────

  function onSheetChanged() {
    const hadItems = norm.items.length > 0;
    sheet = readJSON(SHEET_KEY, { title: '', perItem: 20, items: [] });
    norm = C.normalise(sheet);
    if (!hadItems && norm.items.length > 0) state.active = true;      // loading a sheet switches it on
    if (state.currentId) {
      const i = idxOf(state.currentId);
      if (i >= 0) state.index = i;                                    // follow the item if rows moved
      else state.index = Math.min(state.index, norm.items.length - 1); // deleted: stay near it
    }
    commit();
  }

  function onCommand() {
    const raw = localStorage.getItem(CMD_KEY);
    if (!raw) return;
    localStorage.removeItem(CMD_KEY);
    let c; try { c = JSON.parse(raw); } catch (_) { return; }
    switch (c.cmd) {
      case 'next':   lastAction = 0; next(); break;
      case 'back':   lastAction = 0; back(); break;
      case 'goto':   goTo(c.id); break;
      case 'reset':  resetShow(); break;
      case 'active': setActive(c.on); break;
      case 'pptxclose': if (window.pptxHub) window.pptxHub.close(); break;   // the editor's Close slides
      case 'pause':  api({ cmd: 'pause' }); break;                           // toggles
      case 'restart': restartCountdown(); break;
      case 'curdur': curDuration(c.id, c.duration == null ? null : Number(c.duration)); break;
      case 'curend': curEnd(c.id, Number(c.endClock), c.nextId || null); break;
      case 'livename': liveName(c.id, c.name); break;
    }
  }

  window.addEventListener('storage', ev => {
    if (ev.key === SHEET_KEY) onSheetChanged();
    else if (ev.key === CMD_KEY && ev.newValue) onCommand();
  });

  // ─── Status: ahead / behind ───────────────────────────────────────────────

  // Seconds behind schedule (+) or ahead (−); null when there's nothing to compare yet.
  function lateness() {
    const t = now();
    if (state.finished) {
      const e = state.log[state.log.length - 1], pf = plannedFinishMs();
      return (e && pf != null) ? (e.actual - pf) / 1000 : null;
    }
    const cur = norm.items[state.index];
    if (state.index < 0 || !cur) {
      const first = nextIndex(-1);
      const p0 = norm.anchored && first >= 0 ? plannedStartMs(first) : null;
      return p0 != null && t > p0 ? (t - p0) / 1000 : null;        // late start
    }
    const ps = plannedStartMs(state.index);
    if (ps == null) return null;
    const plannedEnd = ps + cur.eff * 1000;
    const s = api({ cmd: 'snapshot' });
    let projectedEnd = t;
    if (s) {
      const timerEnd = s.seekEndsAt + (s.pausedAt != null ? t - s.pausedAt : 0);
      projectedEnd = Math.max(t, timerEnd);
    }
    return (projectedEnd - plannedEnd) / 1000;
  }

  // When the show is behind, everything still to come moves by the same amount: a pause keeps
  // adding to it (lateness() counts the pause so far), and so does a Restart. Ahead of time,
  // the planned times stand (the next item is held for its time, or started early by hand).
  function shiftMs(late) {
    return late != null && late >= ON_TIME_SEC ? late * 1000 : 0;
  }
  function pausedFor() {
    const s = api({ cmd: 'snapshot' });
    return s && s.pausedAt != null ? Math.max(0, (now() - s.pausedAt) / 1000) : null;
  }

  function statusInfo() {
    const late = lateness();
    const pf = plannedFinishMs();
    const finishEta = (pf != null && late != null) ? pf + late * 1000 : pf;
    let text = '', short = '', kind = 'none';
    if (!isActive()) return { text, short, kind, late: null };

    const first = nextIndex(-1);
    if (state.index < 0 && !state.finished) {
      const p0 = norm.anchored && first >= 0 ? plannedStartMs(first) : null;
      if (p0 == null) { text = 'Ready — press Next (Page Down) to start'; short = 'Ready'; }
      else if (now() < p0) { text = `Starts ${clockOf(p0)} (in ${C.formatSpan((p0 - now()) / 1000)})`; short = clockOf(p0); }
      else { text = `Late start: ${C.formatSpan(late)}`; short = '+' + C.formatSpan(late); kind = 'behind'; }
      return { text, short, kind, late };
    }
    if (late == null) { text = ''; }
    else if (Math.abs(late) < ON_TIME_SEC) { text = 'On time'; short = 'On time'; kind = 'ontime'; }
    else if (late > 0) { text = `Running ${C.formatSpan(late)} behind`; short = '+' + C.formatSpan(late); kind = 'behind'; }
    else { text = `${C.formatSpan(late)} ahead`; short = '−' + C.formatSpan(late); kind = 'ahead'; }
    if (state.finished) {
      const e = state.log[state.log.length - 1];
      text = `Finished ${clockOf(e.actual)}` + (text ? ' · ' + text.replace('Running ', '') : '');
    } else {
      if (finishEta != null) text += (text ? ' · ' : '') + `finish ≈ ${clockOf(finishEta)}`;
      const pf2 = pausedFor();                    // every later time moves while the timer is paused
      if (pf2 != null) text = `Paused ${C.formatSpan(pf2)} · ` + text.replace(/^Running /, '');
    }
    return { text, short, kind, late };
  }

  function clockOf(ms) {
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────

  const $ = id => document.getElementById(id);
  let flashText = '', flashTimer = null;
  function flash(text) {
    flashText = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flashText = ''; render(); }, 2500);
    render();
  }

  function setRow(row, name, meta) {
    const el = $('rs_' + row);
    if (!el) return;
    el.querySelector('.rs-name').textContent = name || '';
    el.querySelector('.rs-meta').textContent = meta || '';
    el.classList.toggle('rs-empty', !name);
  }

  function variance(sec) {
    if (sec == null || Math.abs(sec) < ON_TIME_SEC) return '';
    return (sec > 0 ? '+' : '−') + C.formatSpan(sec);
  }

  function render() {
    if (isActive()) setHtmlClass('runsheet'); else clearHtmlClass('runsheet');
    const dash = $('runsheet_dash');
    const info = statusInfo();

    if (dash && isActive()) {
      const log = state.log;
      // Previous: the item that ran before the current one, in the order they actually ran.
      // The last log entry is the current item (or the finish), so it's the one before that.
      const prev = log[log.length - 2];
      if (prev && prev.id !== 'end') {
        const following = log[log.length - 1];
        const ran = following ? (following.actual - prev.actual) / 1000 : null;
        setRow('prev', prev.name, `${clockOf(prev.actual)}` + (ran != null ? ` · ran ${C.formatSpan(ran)}` : '') +
               (ran != null ? ' ' + variance(ran - prev.plannedDur) : ''));
      } else setRow('prev', '', '');

      const cur = norm.items[state.index];
      const curLog = log[log.length - 1];
      if (state.finished) {
        setRow('cur', 'Show finished', curLog ? clockOf(curLog.actual) : '');
      } else if (state.index < 0 || !cur) {
        setRow('cur', 'Not started', 'Page Down / Next to begin');
      } else {
        const started = curLog && curLog.id === cur.id ? curLog : null;
        setRow('cur', cur.name, C.formatDuration(cur.eff) +
               (started ? ` · started ${clockOf(started.actual)}` + (started.planned != null ? ' ' + variance((started.actual - started.planned) / 1000) : '') : ''));
      }

      const nj = state.finished ? -1 : nextIndex(state.index);
      if (nj >= 0) {
        const it = norm.items[nj], p = plannedStartMs(nj), sh = shiftMs(info.late);
        setRow('next', it.name, C.formatDuration(it.eff) + (p != null ? ` · planned ${clockOf(p)}` + (sh ? ` · now ≈ ${clockOf(p + sh)}` : '') : ''));
      } else if (!state.finished && norm.items.length) {
        const pf = plannedFinishMs(), sh = shiftMs(info.late);
        setRow('next', norm.endIdx >= 0 ? norm.items[norm.endIdx].name : 'End of show', pf != null ? `planned ${clockOf(pf)}` + (sh ? ` · now ≈ ${clockOf(pf + sh)}` : '') : '');
      } else setRow('next', '', '');

      const pos = state.index >= 0 ? `${Math.min(state.index + 1, norm.timedCount)}/${norm.timedCount}` : `0/${norm.timedCount}`;
      const status = $('rs_status');
      if (status) {
        status.textContent = flashText || [sheet.title, pos, info.text, videoHint(), window.pptxHub ? window.pptxHub.hint() : ''].filter(Boolean).join(' · ');
        dash.classList.remove('rs-behind', 'rs-ahead', 'rs-ontime', 'rs-flash');
        dash.classList.add(flashText ? 'rs-flash' : 'rs-' + (info.kind === 'none' ? 'ontime' : info.kind));
      }
    }
    announce(false, info);
  }

  // ─── Broadcast (Stream Deck, editor window) ───────────────────────────────

  let lastVars = '', lastLive = '';

  // The schedule as compact JSON, for display-only phones (e.g. a green room screen):
  // rows {n: name, p: planned clock, d: duration, s: 'done'|'now'|'next', a: actual start, e: 1 = finish row,
  // x: expected clock when the show is running behind (rows still to come)}.
  // A few rows before the current one and up to 40 after, so a message stays small.
  function scheduleList(late) {
    if (!isActive()) return '';
    const sh = state.finished ? 0 : shiftMs(late);
    const startedAt = new Map();
    state.log.forEach(e => { if (e.id !== 'end') startedAt.set(e.id, e.actual); });
    const endLog = state.finished ? state.log[state.log.length - 1] : null;
    let cur = state.finished ? -1 : state.index, nj = state.finished ? -1 : nextIndex(state.index);
    const rows = norm.items.map((it, i) => {
      if (it.hidden) return null;                 // deleted after it ran
      const isEnd = i === norm.endIdx;
      const p = isEnd ? plannedFinishMs() : plannedStartMs(i);
      const r = { n: String(it.name || '').slice(0, 80), p: p != null ? clockOf(p) : '' };
      if (isEnd) r.e = 1; else r.d = C.formatDuration(it.eff);
      if (i === cur) r.s = 'now';
      else if (i === nj) r.s = 'next';
      else if (startedAt.has(it.id) || (isEnd && endLog)) r.s = 'done';
      const a = isEnd ? (endLog && endLog.actual) : startedAt.get(it.id);
      if (a) r.a = clockOf(a);
      if (sh && p != null && i > cur && r.s !== 'done') r.x = clockOf(p + sh);
      return r;
    });
    if (!state.finished && nj < 0 && norm.endIdx >= 0 && rows[norm.endIdx]) rows[norm.endIdx].s = 'next';
    const shown = rows.filter(Boolean), curRow = rows[cur] ? shown.indexOf(rows[cur]) : -1;
    rows.length = 0; rows.push(...shown);
    cur = curRow;
    const from = Math.max(0, (cur >= 0 ? cur : 0) - 3), to = Math.min(rows.length, from + 44);
    return JSON.stringify({ rows: rows.slice(from, to), before: from, after: rows.length - to });
  }
  function announce(force, info) {
    info = info || statusInfo();
    const nj = state.finished ? -1 : nextIndex(state.index);
    const cur = norm.items[state.index];
    const vars = {
      rs_active: isActive() ? '1' : '0',
      rs_current: !state.finished && cur ? cur.name : '',
      rs_next: !isActive() || state.finished ? '' : nj >= 0 ? norm.items[nj].name
             : (norm.endIdx >= 0 ? norm.items[norm.endIdx].name + ' (end)' : 'End of show'),
      rs_can_back: state.history.length > 0 ? '1' : '0',
      rs_status: info.short,
      rs_late: info.late == null ? '' : String(Math.round(info.late)),
      rs_title: isActive() ? (sheet.title || '') : '',
      rs_text: info.text,
      rs_list: scheduleList(info.late),
    };
    const v = JSON.stringify(vars);
    if ((force || v !== lastVars) && window.timerAPI) {
      lastVars = v;
      window.timerAPI.send({ setVariableValues: vars });
    }
    // curEnd: when the item running now is due to end (the timer's end, pauses included), for the editor's checks
    const ts = isActive() && !state.finished && state.index >= 0 ? api({ cmd: 'snapshot' }) : null;
    const live = JSON.stringify({ text: info.text, kind: info.kind, late: info.late == null ? null : Math.round(info.late),
      curId: ts ? state.currentId : null, curEnd: ts ? Math.round(timerEndMs(ts) / 1000) * 1000 : null });
    if (live !== lastLive) { lastLive = live; localStorage.setItem(LIVE_KEY, live); }
  }

  // ─── Keys ─────────────────────────────────────────────────────────────────

  const isTyping = t => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

  // Capture phase, so Page Up/Down are handled here before timer.js sees them
  // (outside run sheet mode they fall through to the old PowerPoint mode).
  document.addEventListener('keydown', e => {
    if (e.key !== 'PageDown' && e.key !== 'PageUp') return;
    if (!isActive() || isTyping(e.target) || document.documentElement.classList.contains('edit_custom_message')) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (e.key === 'PageDown') next(); else back();
  }, true);

  function openEditor() {
    const w = window.open('runsheet.html', 'runsheet_editor_window', 'width=1100,height=780');
    if (w) w.focus();
    return false;
  }

  document.addEventListener('keydown', e => {
    if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)
        && !document.documentElement.classList.contains('edit_custom_message')) {
      openEditor();
    }
  });

  // ─── Boot ─────────────────────────────────────────────────────────────────

  // sheetChanged(): the sheet in localStorage was rewritten by this window (the remote editor,
  // remote-control.js); the storage event that the editor window's writes give doesn't fire then.
  window.runsheet = { next, back, goTo, reset: resetShow, setActive, announce: f => announce(f), open: openEditor, isActive, sheetChanged: onSheetChanged, flash, restart: restartCountdown,
    curDuration, curEnd, liveName };

  // The dashboard sits just below the button bar, whose height depends on zoom and
  // window width (buttons wrap). Publish its bottom edge for the CSS.
  function trackButtonBar() {
    const bar = document.querySelector('div.buttons');
    if (!bar || !window.ResizeObserver) return;
    const update = () => {
      const bottom = bar.offsetParent ? Math.ceil(bar.getBoundingClientRect().bottom) : 0;
      document.documentElement.style.setProperty('--buttons-bottom', bottom + 'px');
    };
    new ResizeObserver(update).observe(bar);
    update();
  }

  function init() {
    trackButtonBar();
    document.getElementById('btnrunsheet')?.addEventListener('click', openEditor);
    // When the player window opens (or anything about it changes), cue the next video if needed
    if (vp()) vp().onChange(() => preloadNext());
    commit();
    // Heartbeat for the editor window, so it knows Next/Back will be handled. Written by
    // every timer window running this code, whether in controller or presenter (P) mode.
    const heartbeat = () => localStorage.setItem('runsheet_alive', String(Date.now()));
    heartbeat();
    setInterval(() => { heartbeat(); syncFromTimer(); render(); }, 1000);
    window.addEventListener('pagehide', () => localStorage.removeItem('runsheet_alive'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
