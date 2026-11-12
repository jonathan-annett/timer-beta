/*!
 * sting-roll.js: random walk-up stings (the owner's design, Nov 2026), the part the run sheet editor
 * (Random stings: an item's sting) and playout computers (an item's start cue) share. The pool: stock
 * stings, the folder (+ sting's Custom file), My clips (the sting library), and a length filter (as it
 * plays). One song, one candidate: a stock sting, its clips (the site's and mine) and a link are one
 * song (its url), a file is known by its size, so no two items get the same track in different cuts.
 * With My clips ticked an edit stands in for its track; unticked, tracks play as supplied (originals
 * hidden behind an edit come back). Audio only (a video walk-up needs the player window). Uses
 * StingClip, StingLibrary and StingPicker when called.
 *
 * window.StingRoll:
 *   opts(key) → {stock, folder, mine, min (minutes), lenOp: ''|'max'|'min', len (s)}   saved under key, else the defaults
 *   saveOpts(key, o) → o, cleaned and saved
 *   none(o, remote) → true when o leaves nowhere to pick from (a remote editor has no folder)
 *   songOf(s) → 'url:…' | 'size:…' | 'name:…'   a sting's track
 *   pool(o, stock, remote) → Map song → [{kind: 'stock'|'mine'|'folder', len (s as it plays; undefined: not probed yet), x | e | file}]
 *   pick(songs, used, o, avoid) → {song, c} | null   a random song not in used (nor avoid), in a version that fits
 *   choice(c, stock) → the + sting dialog's kind of choice for a version ({sting} or {file, extra}: StingPicker.open)
 * MIT Licensed
 */
var StingRoll = (function () {
  'use strict';
  const AUDIO_EXT = /\.(mp3|m4a|aac|wav|aif|aiff|flac|ogg|oga|opus|weba)$/i;
  const DEFAULTS = { stock: true, folder: false, mine: true, min: 2, lenOp: '', len: 30 };
  const num = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? x : d; };
  const clean = o => ({ stock: !!o.stock, folder: !!o.folder, mine: !!o.mine, min: num(o.min, 0, 600, DEFAULTS.min),
    lenOp: ['max', 'min'].includes(o.lenOp) ? o.lenOp : '', len: Math.round(num(o.len, 1, 3600, DEFAULTS.len)) });
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
    if (o.folder && !remote && await StingPicker.ensureFolder()) {
      for (const f of StingPicker.folder().files) {
        if (!AUDIO_EXT.test(f.path)) continue;
        let file; try { file = f.file || await f.handle.getFile(); } catch (_) { continue; }
        if (!edited.has('size:' + file.size)) add('size:' + file.size, { kind: 'folder', file, len: undefined });
      }
    }
    return songs;
  }
  async function pick(songs, used, o, avoid) {
    for (const song of shuffle([...songs.keys()])) {
      if (used.has(song) || song === avoid) continue;
      for (const c of shuffle(songs.get(song).slice())) {
        if (c.len === undefined && c.file) {           // (a folder file: an AIFF as WAV, only once picked)
          try { c.file = await StingClip.playable(c.file); } catch (_) { c.len = null; continue; }
          c.len = await probe(c.file);
        }
        if (fitsLen(c.len, o)) return { song, c };
      }
    }
    return null;
  }
  async function choice(c, stock) {
    if (c.kind === 'stock') return { sting: Object.assign({ src: 'stock', media: 'audio', name: c.x.name, url: c.x.url, duration: c.x.duration }, StingPicker.clipFields(c.x)) };
    if (c.kind === 'folder') return { file: c.file };
    return StingPicker.choiceOf(c.e, stock);
  }

  return { opts, saveOpts, none, songOf, pool, pick, choice };
})();
