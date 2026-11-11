/*!
 * runsheet-core.js
 * Pure run sheet logic shared by the controller (runsheet.js) and the editor
 * window (runsheet-editor.js): parsing, normalising, import/export. No DOM access.
 * MIT Licensed
 *
 * Sheet shape (stored in localStorage.runsheet):
 *   { title: string, perItem: minutes, items: [{ id, name, start, duration }] }
 *   start    — seconds since midnight (local clock), or null
 *   duration — seconds, or null
 * Anything left null is derived by normalise().
 */

var RunsheetCore = (function () {
  'use strict';

  const DAY = 86400;

  // ─── Parsing ──────────────────────────────────────────────────────────────

  // Clock time → seconds since midnight. '' → null, unparseable → NaN.
  // Accepts 9, 9am, 9:30, 09:30, 9.30, 9:30pm, 9:30 p.m., 21:30, 9:30:00, 9:30:00 AM.
  function parseClock(str) {
    let s = String(str == null ? '' : str).trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return null;
    s = s.replace(/\./g, (m, i) => (/\d/.test(s[i - 1]) && /\d/.test(s[i + 1])) ? ':' : '');
    const m = s.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))? ?(am|pm|a|p)?$/);
    if (!m) return NaN;
    let h = +m[1];
    const mi = +(m[2] || 0), se = +(m[3] || 0), ap = m[4];
    if (mi > 59 || se > 59) return NaN;
    if (ap) {
      if (h < 1 || h > 12) return NaN;
      if (ap[0] === 'p' && h !== 12) h += 12;
      if (ap[0] === 'a' && h === 12) h = 0;
    } else if (h > 23) {
      return NaN;
    }
    return h * 3600 + mi * 60 + se;
  }

  // Duration → seconds. '' → null, unparseable → NaN.
  //   20 / 20.5     minutes (plain numbers are minutes)
  //   1:30          hours:minutes (as when typing a duration into the timer)
  //   0:20:00       hours:minutes:seconds (Excel's duration format)
  //   20m, 20 min, 1h, 1 hr 30 min, 1h30, 90s, 1 min 30 s
  function parseDuration(str) {
    const s = String(str == null ? '' : str).trim().toLowerCase();
    if (!s) return null;
    let m;
    if ((m = s.match(/^\d+(?:\.\d+)?$/))) return Math.round(parseFloat(s) * 60);
    if ((m = s.match(/^(\d+):(\d{1,2})$/))) return +m[2] < 60 ? +m[1] * 3600 + +m[2] * 60 : NaN;
    if ((m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/))) {
      return (+m[2] < 60 && +m[3] < 60) ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN;
    }
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?\s*(\d{1,2})$/))) {   // 1h30
      return Math.round(parseFloat(m[1]) * 3600) + +m[2] * 60;
    }
    const unit = { h: 3600, m: 60, s: 1 };
    const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g;
    let total = 0, found = false;
    const rest = s.replace(re, (all, n, u) => { found = true; total += parseFloat(n) * unit[u[0]]; return ' '; });
    if (!found || rest.replace(/\b(and)\b|[,\s]/g, '') !== '') return NaN;
    return Math.round(total);
  }

  // ─── Formatting ───────────────────────────────────────────────────────────

  const pad = n => String(n).padStart(2, '0');

  // seconds since midnight → "09:30" (24-hour; seconds shown only if non-zero)
  function formatClock(sec) {
    if (sec == null || !isFinite(sec)) return '';
    sec = ((Math.round(sec) % DAY) + DAY) % DAY;
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return pad(h) + ':' + pad(m) + (s ? ':' + pad(s) : '');
  }

  // seconds → "20 min", "1 h 30 min", "1 min 30 s"  (parseDuration reads these back)
  function formatDuration(sec) {
    if (sec == null || !isFinite(sec)) return '';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    const parts = [];
    if (h) parts.push(h + ' h');
    if (m) parts.push(m + ' min');
    if (s) parts.push(s + ' s');
    return parts.join(' ') || '0 min';
  }

  // seconds → "12:05" or "1:02:05"
  function formatSpan(sec) {
    sec = Math.round(Math.abs(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }

  // seconds → "h:mm:ss" (CSV export; Excel reads it as a duration)
  function formatHMS(sec) {
    sec = Math.round(sec);
    return Math.floor(sec / 3600) + ':' + pad(Math.floor(sec % 3600 / 60)) + ':' + pad(sec % 60);
  }

  // ─── Normalising ──────────────────────────────────────────────────────────

  let idCounter = 0;
  function newId() {
    return 'i' + Date.now().toString(36) + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 6);
  }
  // An item's id is how everything else knows it (the show log, playout computers' cues), so it
  // survives a trip through a spreadsheet (the CSV's Id column) and Replace sheet (matchRows).
  const ID_RE = /^[\w-]{1,40}$/;
  const isId = v => typeof v === 'string' && ID_RE.test(v);

  // Work out every item's planned start and effective duration.
  //   - Explicit durations win.
  //   - Otherwise duration = gap to the next item's start time.
  //   - Otherwise the sheet's per-item default (perItem minutes).
  //   - The last row is the finish marker if it has a start time and no duration.
  //   - If any row has a start time the sheet is "anchored" to the clock and
  //     `planned` is seconds since midnight; otherwise `planned` is seconds from
  //     the show's start (item 0 = 0), which the controller pins to the moment
  //     the first item is started.
  function normalise(sheet) {
    const items = (sheet && sheet.items) || [];
    const perItem = Math.round(((sheet && sheet.perItem) || 20) * 60);
    const n = items.length;

    // Start times, unwrapped past midnight so they never go backwards
    const starts = [];
    let prev = null;
    for (const it of items) {
      let st = (it.start == null || !isFinite(it.start)) ? null : it.start;
      if (st != null) {
        while (prev != null && st < prev) st += DAY;
        prev = st;
      }
      starts.push(st);
    }

    const endIdx = (n > 1 && starts[n - 1] != null && items[n - 1].duration == null) ? n - 1 : -1;
    const firstStart = starts.findIndex(v => v != null);
    const anchored = firstStart >= 0;
    const planned = new Array(n), eff = new Array(n), source = new Array(n);
    const hasDur = i => items[i].duration != null && isFinite(items[i].duration);

    const effectiveDuration = (i, plannedI) => {
      if (i === endIdx) { source[i] = 'end'; return 0; }
      if (hasDur(i)) { source[i] = 'set'; return items[i].duration; }
      if (i + 1 < n && starts[i + 1] != null && plannedI != null && starts[i + 1] > plannedI) {
        source[i] = 'times'; return starts[i + 1] - plannedI;
      }
      source[i] = 'default'; return perItem;
    };

    if (anchored && firstStart > 0) {
      // Rows before the first start time are placed backwards from it
      let t = starts[firstStart];
      for (let i = firstStart - 1; i >= 0; i--) {
        eff[i] = hasDur(i) ? items[i].duration : perItem;
        source[i] = hasDur(i) ? 'set' : 'default';
        t -= eff[i];
        planned[i] = t;
      }
    }
    for (let i = anchored ? firstStart : 0; i < n; i++) {
      planned[i] = starts[i] != null ? starts[i] : (i === 0 ? 0 : planned[i - 1] + eff[i - 1]);
      eff[i] = effectiveDuration(i, planned[i]);
    }

    const out = items.map((it, i) => ({
      id: it.id,
      name: it.name || '',
      start: it.start == null ? null : it.start,
      duration: it.duration == null ? null : it.duration,
      video: it.video || null,                  // {key, name, size, duration} (run sheet videos)
      videoIdle: it.videoIdle === 'hide' ? 'hide' : 'show',
      sting: it.sting || null,                  // {src, media, name, duration, key?, url?, size?} (walk-up stings, sting-player.js)
      hidden: !!it.hidden,                      // a completed item "deleted" in the editor: kept for the record, not shown or run
      auto: !!it.auto,                          // starts by itself at its own (typed) start time: a hard start (runsheet.js)
      planned: planned[i],
      eff: eff[i],
      isEnd: i === endIdx,
      startDerived: starts[i] == null,
      durSource: source[i],
      // gap (+) or overlap (-) before the next row's start time, in seconds
      gapAfter: (i + 1 < n && i !== endIdx && starts[i + 1] != null) ? starts[i + 1] - (planned[i] + eff[i]) : 0,
    }));

    const last = n - 1;
    const finishPlanned = n === 0 ? null : endIdx >= 0 ? planned[endIdx] : planned[last] + eff[last];
    return {
      items: out,
      anchored,
      endIdx,
      finishPlanned,
      totalSec: n === 0 ? 0 : finishPlanned - planned[0],
      timedCount: n - (endIdx >= 0 ? 1 : 0),
    };
  }

  // Bake derived values into the sheet so every row has start (if anchored), name and duration.
  // ─── Rippling changes down the day ────────────────────────────────────────
  // A new duration, end or start moves everything after it: start times written on later
  // rows shift by the same amount (rows without one follow anyway). Hidden rows (already run) stay.
  // `to` (a row index, optional) stops there: rows after it keep their times (scaling a selection).
  // A row with a hard start (auto, ticked in the editor) is fixed: it stops the ripple there.
  function shiftStarts(sheet, from, delta, to) {
    if (!delta) return;
    const last = to == null ? sheet.items.length - 1 : Math.min(to, sheet.items.length - 1);
    for (let j = from + 1; j <= last; j++) {
      const x = sheet.items[j];
      if (x.auto && x.start != null && !x.hidden) break;      // a hard start doesn't move, and nothing after it does
      if (x.start != null && isFinite(x.start) && !x.hidden) x.start = ((x.start + delta) % DAY + DAY) % DAY;
    }
  }
  // b − a for two times of day, the short way round midnight (seconds)
  function dayDelta(a, b) {
    let d = ((b - a) % DAY + DAY) % DAY;
    if (d > DAY / 2) d -= DAY;
    return d;
  }

  // Once the show is under way: when each row after `cur` should start, given when row `cur`
  // ends (ms). Each follows on from the one before; a row with its own start time waits for it if
  // that's later (a gap). plannedMsOf turns normalise()'s planned seconds into a timestamp.
  // Returns a Map row index → ms (hidden rows skipped), with .finish.
  function project(norm, cur, endMs, plannedMsOf) {
    const out = new Map();
    let t = endMs;
    for (let j = cur + 1; j < norm.items.length; j++) {
      const it = norm.items[j];
      if (it.hidden) continue;
      const own = it.start != null ? plannedMsOf(it.planned) : null;
      const s = own != null && own > t ? own : t;
      out.set(j, s);
      t = s + (it.isEnd ? 0 : it.eff * 1000);
    }
    out.finish = t;                               // when the whole show would end
    return out;
  }

  function standardise(sheet) {
    const norm = normalise(sheet);
    return Object.assign({}, sheet, {
      items: norm.items.map(it => ({
        id: it.id,
        name: it.name,
        start: norm.anchored ? it.planned % DAY : null,
        duration: it.isEnd ? null : it.eff,
        ...(it.video ? { video: it.video, videoIdle: it.videoIdle } : {}),
        ...(it.sting ? { sting: it.sting } : {}),
        ...(it.hidden ? { hidden: true } : {}),
        ...(it.auto ? { auto: true } : {}),
      })),
    });
  }

  // ─── Import ───────────────────────────────────────────────────────────────

  function parseCSVLine(line, delim) {
    const cells = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"' && cur.trim() === '') { q = true; cur = ''; }
      else if (c === delim) { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    return cells.map(s => s.trim());
  }

  const HEADER = {
    id:       /^(id|item ?id)$/i,                 // (before name: "Item id" isn't the name column)
    duration: /^(dur|duration|length|len|mins?|minutes|allocated|allowed|time ?allowed|run ?time|slot)/i,
    start:    /^(start|time|begins?|from|at|when|start ?time|sched)/i,
    name:     /^(name|item|title|session|speaker|segment|who|what|desc|description|topic|event|act|presenter|program)/i,
  };

  const looksLikeClock = v => /\d\s*(am|pm|a\.m\.|p\.m\.)$/i.test(v) || /^\d{1,2}[:.]\d{2}/.test(v);

  // Classify a header-less column
  function classifyColumn(values) {
    const vals = values.filter(v => v !== '');
    if (!vals.length) return 'empty';
    if (vals.every(v => /\d\s*(am|pm|a\.?m\.?|p\.?m\.?)$/i.test(v) && isFinite(parseClock(v)))) return 'start';
    if (vals.every(v => /^\d{1,2}[:.]\d{2}(:\d{2})?$/.test(v))) {
      const secs = vals.map(parseClock);
      const nonDecreasing = secs.every((s, i) => i === 0 || s >= secs[i - 1]);
      if (secs.every(isFinite) && nonDecreasing && Math.max(...secs) >= 6 * 3600 && vals.length > 1) return 'start';
    }
    if (vals.every(v => isFinite(parseDuration(v)))) return 'duration';
    if (vals.length > 1 && vals.every(v => /^i(?=[0-9a-z]*\d)[0-9a-z]{10,}$/.test(v))) return 'id';   // newId()'s, pasted without the header
    return 'text';
  }

  // "9:00 Welcome", "9:30am – Keynote (30 min)", "Panel - 45 mins", or just "Speaker name"
  function parseFreeLine(line) {
    let start = null, duration = null, name = line.trim();
    const t = name.match(/^(\d{1,2}(?:[:.]\d{2})?(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)\s*(?:[-–—|:]\s*)?(.*)$/i);
    if (t && t[2] && looksLikeClock(t[1].trim()) && isFinite(parseClock(t[1]))) {
      start = parseClock(t[1]); name = t[2].trim();
    }
    const d = name.match(/\s*(?:[-–—,|]\s*|\(\s*)(\d+(?:\.\d+)?\s*(?:h|hrs?|hours?|m|mins?|minutes?)(?:\s*\d+\s*(?:m|mins?|minutes?))?)\s*\)?\s*$/i);
    if (d && isFinite(parseDuration(d[1]))) {
      duration = parseDuration(d[1]); name = name.slice(0, d.index).trim();
    }
    return { name, start, duration };
  }

  // Text pasted from Excel / Google Sheets (tab separated), CSV, or a plain list.
  // Returns { items, warnings, columns, fileIds } — items have new ids, except those the text gave in
  // an Id column (valid and not repeated): fileIds is the set of those.
  function parseText(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
    const warnings = [], fileIds = new Set();
    if (!lines.length) return { items: [], warnings, columns: null, fileIds };

    const delim = lines.some(l => l.includes('\t')) ? '\t'
                : lines.filter(l => l.includes(',')).length >= Math.ceil(lines.length / 2) && lines.length > 1 ? ','
                : null;

    // Plain list (one item per line, optionally with a time and/or a duration in the text)
    if (!delim) {
      const items = lines.map(parseFreeLine).filter(r => r.name);
      return { items: items.map(r => Object.assign({ id: newId() }, r)), warnings, columns: 'list', fileIds };
    }

    let rows = lines.map(l => parseCSVLine(l, delim));
    const width = Math.max(...rows.map(r => r.length));
    rows = rows.map(r => { while (r.length < width) r.push(''); return r; });

    // Header row?
    let cols = null;
    const head = rows[0];
    const headerHits = head.map(c => HEADER.id.test(c) ? 'id' : HEADER.duration.test(c) ? 'duration' : HEADER.start.test(c) ? 'start' : HEADER.name.test(c) ? 'name' : null);
    if (headerHits.some(Boolean) && head.every(c => !isFinite(parseDuration(c)) || c === '')) {
      cols = headerHits;
      rows = rows.slice(1);
    } else {
      cols = head.map((_, ci) => classifyColumn(rows.map(r => r[ci])));
      // Pick the most "texty" column as the name
      let best = -1, bestLen = -1;
      cols.forEach((c, ci) => {
        if (c !== 'text') return;
        const len = rows.reduce((a, r) => a + r[ci].length, 0);
        if (len > bestLen) { best = ci; bestLen = len; }
      });
      cols = cols.map((c, ci) => ci === best ? 'name' : c === 'text' ? null : c);
      if (best < 0) warnings.push('Could not find a column of item names.');
    }
    // Only the first column of each kind is used
    const seen = {};
    cols = cols.map(c => (c && !seen[c]) ? (seen[c] = true, c) : null);
    const idx = k => cols.indexOf(k);

    const items = [];
    rows.forEach((r, ri) => {
      const name = idx('name') >= 0 ? r[idx('name')] : '';
      let start = idx('start') >= 0 ? parseClock(r[idx('start')]) : null;
      let duration = idx('duration') >= 0 ? parseDuration(r[idx('duration')]) : null;
      if (!name && start == null && duration == null) return;
      if (Number.isNaN(start)) { warnings.push(`Row ${ri + 1}: couldn't read start time "${r[idx('start')]}".`); start = null; }
      if (Number.isNaN(duration)) { warnings.push(`Row ${ri + 1}: couldn't read duration "${r[idx('duration')]}".`); duration = null; }
      const given = idx('id') >= 0 ? r[idx('id')] : '';
      const id = isId(given) && !fileIds.has(given) ? given : newId();
      if (id === given) fileIds.add(id);
      items.push({ id, name: name || '(untitled)', start, duration });
    });
    return { items, warnings, columns: cols, fileIds };
  }

  // Replace sheet: rows that are items already on the sheet keep the item's id and its media (video,
  // walk-up sting), so the log, playout cues and attached files follow it; times and durations come
  // from the rows. A row the text gave an id (fileIds) matches only by id; the others by name (the
  // first unused item of that name, in sheet order, after the id matches). current: the items that may
  // be replaced; done: ids of items kept for the record (already run): a row with one of those is left
  // out. Returns { items, matched, dropped }.
  const nameKey = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  function matchRows(current, rows, fileIds, done) {
    const byId = new Map(current.map(x => [x.id, x]));
    const used = new Set();
    let dropped = 0;
    const pairs = [];
    for (const r of rows) {
      if (fileIds && fileIds.has(r.id)) {
        if (done && done.has(r.id)) { dropped++; continue; }
        const m = byId.get(r.id);
        if (m) used.add(m.id);
        pairs.push([r, m || null]);
      } else pairs.push([r, undefined]);
    }
    for (const p of pairs) {
      if (p[1] !== undefined) continue;
      const k = nameKey(p[0].name);
      const m = k ? current.find(x => !used.has(x.id) && nameKey(x.name) === k) : null;
      if (m) used.add(m.id);
      p[1] = m || null;
    }
    const taken = new Set(done || []);
    let matched = 0;
    const items = pairs.map(([r, m]) => {
      if (!m) return Object.assign({}, r, { id: taken.has(r.id) ? newId() : (taken.add(r.id), r.id) });
      matched++;
      taken.add(m.id);
      const media = m.video ? { video: m.video, videoIdle: m.videoIdle } : m.sting ? { sting: m.sting } : {};
      return Object.assign({}, r, { id: m.id }, media);
    });
    return { items, matched, dropped };
  }
  // Append: rows whose id the sheet already has get new ones
  function freshIds(existing, rows) {
    const taken = new Set(existing.map(x => x.id));
    return rows.map(r => Object.assign({}, r, { id: taken.has(r.id) ? newId() : (taken.add(r.id), r.id) }));
  }

  // ─── Export ───────────────────────────────────────────────────────────────

  const csvCell = v => /[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);

  // Standardised CSV: Start, Name, Duration (derived values filled in), Id (read back by parseText).
  function toCSV(sheet) {
    const norm = normalise(sheet);
    const rows = [['Start', 'Name', 'Duration', 'Id']];
    for (const it of norm.items) {
      rows.push([
        norm.anchored ? formatClock(it.planned) : '',
        it.name,
        it.isEnd ? '' : formatHMS(it.eff),
        it.id || '',
      ]);
    }
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  return {
    parseClock, parseDuration,
    formatClock, formatDuration, formatSpan, formatHMS,
    shiftStarts, dayDelta, project,
    normalise, standardise, parseText, toCSV, csvCell, newId, isId, matchRows, freshIds,
  };
})();

if (typeof module !== 'undefined') module.exports = RunsheetCore;
