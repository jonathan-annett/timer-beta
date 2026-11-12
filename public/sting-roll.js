/*!
 * sting-roll.js: random walk-up stings (the owner's design, Nov 2026), the part the run sheet editor
 * (Random stings: an item's sting) and playout computers (an item's start cue) share. The pool: stock
 * stings, the folder (+ sting's Custom file), My clips (the sting library), and a length filter (as it
 * plays). One song, one candidate: a stock sting, its clips (the site's and mine) and a link are one
 * song (its url), a file is known by its size, so no two items get the same track in different cuts.
 * With My clips ticked an edit stands in for its track; unticked, tracks play as supplied (originals
 * hidden behind an edit come back). Audio only (a video walk-up needs the player window). Uses
 * StingClip, StingLibrary and StingPicker when called. Styles (a trial, TimerFeatures.styles; Nov 2026):
 * chosen as chips (genres and styles: StingStyles.chips), only songs in any of them (StingStyles.fitsAny on
 * their stored styles: a stock song's, which its clips and my clips of it share); folder files and file
 * clips aren't tagged yet, so they sit out while some are chosen.
 *
 * window.StingRoll:
 *   opts(key) → {stock, folder, mine, min (minutes), lenOp: ''|'max'|'min', len (s), styles: [genre | label]}   saved under key, else the defaults
 *   saveOpts(key, o) → o, cleaned and saved
 *   none(o, remote) → true when o leaves nowhere to pick from (a remote editor has no folder)
 *   songOf(s) → 'url:…' | 'size:…' | 'name:…'   a sting's track
 *   pool(o, stock, remote) → Map song → [{kind: 'stock'|'mine'|'folder', len (s as it plays; undefined: not probed yet), x | e | file}]
 *   pick(songs, used, o, avoid) → {song, c} | null   a random song not in used (nor avoid), in a version that fits
 *   reuse(songs, counts, o, avoid) → {song, c} | null  out of songs (the operator agreed): the least used, not one in
 *                                                     avoid (a Set: its neighbours') unless nothing else fits
 *   choice(c, stock) → the + sting dialog's kind of choice for a version ({sting} or {file, extra}: StingPicker.open)
 *   styled() → whether styles are on here (the trial, and sting-styles.js loaded)
 *   inStyle(stock, keys) → how many stock songs are in any of those styles (for the panel's hint)
 *   lists(stock) → the stock songs' styles lists, one a song (for the chips' counts)
 *   which(o) → 'of that length ', 'in those styles ', both, or '' (what the messages say narrowed the pool)
 * MIT Licensed
 */
var StingRoll = (function () {
  'use strict';
  const AUDIO_EXT = /\.(mp3|m4a|aac|wav|aif|aiff|flac|ogg|oga|opus|weba)$/i;
  const DEFAULTS = { stock: true, folder: false, mine: true, min: 2, lenOp: '', len: 30, styles: [] };
  const num = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? x : d; };
  const clean = o => ({ stock: !!o.stock, folder: !!o.folder, mine: !!o.mine, min: num(o.min, 0, 600, DEFAULTS.min),
    lenOp: ['max', 'min'].includes(o.lenOp) ? o.lenOp : '', len: Math.round(num(o.len, 1, 3600, DEFAULTS.len)),
    styles: Array.isArray(o.styles) ? [...new Set(o.styles.filter(k => typeof k === 'string' && k.length <= 120 && (!window.StingStyles || StingStyles.isKey(k))))].slice(0, 80) : [] });
  const styled = () => !!(window.StingStyles && window.TimerFeatures && TimerFeatures.styles);
  // A song's stored styles: a stock song's (by its url); none for files yet
  const stylesOf = (song, stock) => { if (!song.startsWith('url:')) return null; const x = stock.find(s => 'url:' + s.url === song && s.styles); return x ? x.styles : null; };
  const inStyle = (stock, keys) => new Set(stock.filter(x => x.media !== 'video' && StingStyles.fitsAny(x.styles, keys)).map(x => x.url)).size;
  const lists = stock => { const seen = new Map(); for (const x of stock) if (x.media !== 'video' && x.styles && !seen.has(x.url)) seen.set(x.url, x.styles); return [...seen.values()]; };
  const narrowed = o => o.styles.length > 0 && styled();
  function opts(key) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) { /* unreadable: the defaults */ }
    return clean(Object.assign({}, DEFAULTS, saved));
  }
  function saveOpts(key, o) {
    const c = clean(o);
    try { localStorage.setItem(key, JSON.stringify(c)); } catch (_) { /* private mode */ }
    return c;
  }
  const none = (o, remote) => !o.stock && !o.mine && !(o.folder && !remote);
  const songOf = s => (s.url ? 'url:' + s.url : s.size ? 'size:' + s.size : 'name:' + s.name);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const fitsLen = (len, o) => !o.lenOp || (len != null && (o.lenOp === 'max' ? len <= o.len : len >= o.len));
  function probe(file) {                         // a file's length (s), or null
    return new Promise(resolve => {
      const el = document.createElement('video'), url = URL.createObjectURL(file);
      const done = d => { URL.revokeObjectURL(url); el.removeAttribute('src'); resolve(d); };
      el.preload = 'metadata';
      el.onloadedmetadata = () => done(isFinite(el.duration) ? el.duration : null);
      el.onerror = () => done(null);
      el.src = url;
      setTimeout(() => done(null), 15000);
    });
  }

  async function pool(o, stock, remote) {
    const songs = new Map(), add = (song, c) => { if (!songs.has(song)) songs.set(song, []); songs.get(song).push(c); };
    const mine = o.mine && window.StingLibrary ? StingLibrary.read() : [];
    for (const e of mine) {
      if (e.media === 'video' || (e.file && remote)) continue;
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
    if (o.folder && !remote && !narrowed(o) && await StingPicker.ensureFolder()) {   // (untagged: not with styles chosen)
      for (const f of StingPicker.folder().files) {
        if (!AUDIO_EXT.test(f.path)) continue;
        let file; try { file = f.file || await f.handle.getFile(); } catch (_) { continue; }
        if (!edited.has('size:' + file.size)) add('size:' + file.size, { kind: 'folder', file, len: undefined });
      }
    }
    if (narrowed(o)) for (const song of [...songs.keys()]) if (!StingStyles.fitsAny(stylesOf(song, stock), o.styles)) songs.delete(song);
    return songs;
  }
  async function fitting(versions, o) {             // a version that fits, at random
    for (const c of shuffle(versions.slice())) {
      if (c.len === undefined && c.file) {             // (a folder file: an AIFF as WAV, only once picked)
        try { c.file = await StingClip.playable(c.file); } catch (_) { c.len = null; continue; }
        c.len = await probe(c.file);
      }
      if (fitsLen(c.len, o)) return c;
    }
    return null;
  }
  async function pick(songs, used, o, avoid) {
    for (const song of shuffle([...songs.keys()])) {
      if (used.has(song) || song === avoid) continue;
      const c = await fitting(songs.get(song), o);
      if (c) return { song, c };
    }
    return null;
  }
  // Running out (the owner, 13 Nov 2026: more items than stings, and the operator said OK to reuse): a song
  // already chosen, the least used first (counts: song → items), not one in avoid (the items either side's,
  // and its own) unless nothing else fits
  async function reuse(songs, counts, o, avoid) {
    const order = shuffle([...songs.keys()]).sort((a, b) => (counts.get(a) || 0) - (counts.get(b) || 0));
    for (const strict of [true, false]) for (const song of order) {
      if (strict && avoid && avoid.has(song)) continue;
      const c = await fitting(songs.get(song), o);
      if (c) return { song, c };
    }
    return null;
  }
  async function choice(c, stock) {
    if (c.kind === 'stock') return { sting: Object.assign({ src: 'stock', media: 'audio', name: c.x.name, url: c.x.url, duration: c.x.duration }, StingPicker.clipFields(c.x)) };
    if (c.kind === 'folder') return { file: c.file };
    return StingPicker.choiceOf(c.e, stock);
  }

  const which = o => { const w = [o.lenOp ? 'of that length' : '', narrowed(o) ? (o.styles.length === 1 ? 'in that style' : 'in those styles') : ''].filter(Boolean).join(' and '); return w ? w + ' ' : ''; };
  return { opts, saveOpts, none, songOf, pool, pick, reuse, choice, styled, inStyle, lists, which };
})();
