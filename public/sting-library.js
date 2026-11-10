/*!
 * sting-library.js
 * The sting library page (stings.html; a trial with the stings: TimerFeatures.stings): clips of stock
 * stings and of the user's own tracks (sting-clip.js), kept on this computer, offered by the run sheet
 * editor's + sting, imported and exported as JSON.
 *
 * The library (localStorage sting_library) is the stock list's format with clip fields:
 *   {stings: [{name, stock | file | url, size?, media, duration, start?, end?, fadeIn?, fadeOut?}]}
 * stock = a stock sting's name (stock-stings.json), file = a track's file name (+ size: the file is
 * kept in this browser as 'lib:<file>:<size>', video-store.js; browsers can't read paths, so an
 * imported library asks for the files once), url = a link. duration = the whole track's length.
 * hideOriginal: true on a clip of a stock sting (or link): a better edit, so the editor's + sting leaves
 * the whole original out while the clip exists (hidden()). The site's own clips can carry it too.
 * The site's owner puts an exported library in the stings folder as clips.json (sync-stings.mjs).
 * MIT Licensed
 */
var StingLibrary = (function () {
  'use strict';
  const KEY = 'sting_library';
  const read = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || '{}'); return Array.isArray(j.stings) ? j.stings : []; } catch (_) { return []; } };
  const write = list => { try { localStorage.setItem(KEY, JSON.stringify({ stings: list })); } catch (_) { /* private mode */ } };
  const fileKey = e => 'lib:' + e.file + ':' + (e.size || 0);
  const CLIP = ['start', 'end', 'fadeIn', 'fadeOut'];

  // One entry, tidied (import, save): only the fields of the format
  function clean(x) {
    if (!x || typeof x !== 'object' || typeof x.name !== 'string' || !x.name.trim()) return null;
    const e = { name: x.name.trim().slice(0, 200) };
    if (typeof x.stock === 'string' && x.stock) e.stock = x.stock.slice(0, 200);
    else if (typeof x.file === 'string' && x.file) { e.file = x.file.replace(/^.*[\\/]/, '').slice(0, 200); if (Number.isFinite(x.size)) e.size = x.size; }
    else if (typeof x.url === 'string' && /^https:\/\//.test(x.url)) e.url = x.url.slice(0, 2048);
    else return null;
    e.media = x.media === 'video' ? 'video' : 'audio';
    if (Number.isFinite(x.duration)) e.duration = Math.round(x.duration * 100) / 100;
    for (const k of CLIP) if (Number.isFinite(x[k]) && x[k] > 0) e[k] = x[k];
    if (x.hideOriginal === true && (e.stock || e.url)) e.hideOriginal = true;
    return e;
  }

  // Which stock stings + sting should leave out (their indices): those a clip with hideOriginal replaces,
  // in the stock list itself (the same track, the whole of it) or in this computer's library
  function hidden(stock, mine) {
    const out = new Set(), whole = x => !StingClip.region(x);
    (stock || []).forEach(c => { if (c.hideOriginal === true && StingClip.region(c)) stock.forEach((x, i) => { if (whole(x) && x.url === c.url) out.add(i); }); });
    (mine || read()).forEach(e => {
      if (e.hideOriginal !== true) return;
      (stock || []).forEach((x, i) => { if (e.stock ? x.name === e.stock : whole(x) && x.url === e.url) out.add(i); });
    });
    return out;
  }

  // Where to play an entry from: a stock sting's link, the file kept here, or its link (null: the file isn't here)
  async function source(e, stock) {
    if (e.stock) { const s = (stock || []).find(x => x.name === e.stock); return s ? s.url : null; }
    if (e.file) { try { return (window.videoStore && await window.videoStore.get(fileKey(e))) || null; } catch (_) { return null; } }
    return e.url || null;
  }
  async function keepFile(file) {
    const e = { file: file.name, size: file.size };
    await window.videoStore.put(fileKey(e), file);
    return e;
  }

  return { read, write, clean, source, keepFile, fileKey, hidden, CLIP };
})();

// ─── The page ─────────────────────────────────────────────────────────────
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!document.getElementById('mine')) return;              // (loaded by the run sheet editor too, for its + sting)
  if (location.hostname) document.title = location.hostname + ' - Sting library';
  if (window.TimerFeatures && !TimerFeatures.stings) {
    document.querySelector('main').innerHTML = '<h1>Sting library</h1><p class="sub">Walk-up stings aren’t available on this site.</p>';
    return;
  }
  const L = StingLibrary;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const t2 = t => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
  const len = s => { const l = StingClip.length(s, s.duration); return l == null ? '' : l >= 60 ? Math.floor(l / 60) + ' min ' + Math.round(l % 60) + ' s' : l.toFixed(1) + ' s'; };
  const msg = (text, bad) => { $('msg').textContent = text || ''; $('msg').className = bad ? 'bad' : ''; };
  let stock = [], have = new Set(), playing = null, playingId = null;

  async function loadStock() {
    try {
      const j = await (await fetch('stock-stings.json', { cache: 'no-cache' })).json();
      const base = new URL('stock-stings.json', location.href);
      stock = (j.stings || []).filter(x => x && x.name && x.url).map(x => Object.assign({}, x, { url: new URL(x.url, base).href }));
    } catch (_) { stock = []; }
  }
  async function checkFiles() {
    have = new Set();
    for (const e of L.read()) if (e.file) { try { if (await window.videoStore.get(L.fileKey(e))) have.add(L.fileKey(e)); } catch (_) { /* no */ } }
  }
  const missing = e => e.file && !have.has(L.fileKey(e));

  function stopPlay() { if (playing) playing.stop(); playing = playingId = null; render(); }
  async function preview(id, e) {
    if (playingId === id) return stopPlay();
    stopPlay();
    const src = await L.source(e, stock);
    if (!src) return msg('That clip’s file isn’t on this computer: use Find files…', true);
    playing = StingClip.preview(src, e); playingId = id;
    render();
  }

  function render() {
    const mine = L.read();
    $('mine').innerHTML = mine.map((e, i) => {
      const r = StingClip.region(e);
      const part = r ? (r.start != null || r.end != null ? t2(r.start || 0) + '–' + (r.end != null ? t2(r.end) : 'end') : 'whole track') + (r.fadeIn ? ' · in ' + r.fadeIn + ' ms' : '') + (r.fadeOut ? ' · out ' + r.fadeOut + ' ms' : '') : 'whole track';
      return `<li data-i="${i}"><button class="small" data-a="play" title="Hear it">${playingId === 'm' + i ? '■' : '▶'}</button>` +
        `<span class="name" title="${esc(e.name)}">${esc(e.name)}</span>` +
        `<span class="meta">${esc(e.stock ? 'stock: ' + e.stock : e.file ? e.file : 'link')} · ${esc(part)} · ${esc(len(e))}${e.hideOriginal ? ' · replaces it in + sting' : ''}</span>` +
        (missing(e) ? '<span class="need" title="Imported: the file isn’t on this computer yet">⚠ needs the file</span>' : '') +
        `<button class="small" data-a="edit" title="Change the part">✂</button><button class="small" data-a="del" title="Remove">✕</button></li>`;
    }).join('') || '<li class="empty">No clips yet. Make one from a stock sting below, or from a file of your own.</li>';
    $('find').hidden = !mine.some(missing);
    const hid = L.hidden(stock, mine);
    $('stock').innerHTML = stock.map((s, i) => `<li data-s="${i}"${hid.has(i) ? ' class="hid"' : ''}><button class="small" data-a="play">${playingId === 's' + i ? '■' : '▶'}</button>` +
      `<span class="name">${esc(s.name)}</span><span class="meta">${esc(len(s))}${StingClip.region(s) ? ' · a clip' : ''}${hid.has(i) ? ' · hidden from + sting (a clip replaces it)' : ''}</span>` +
      `<button class="small" data-a="clip" title="Make a clip of it">✂</button></li>`).join('') || '<li class="empty">This site has no stock stings.</li>';
  }

  async function edit(entry, src, isNew) {
    stopPlay();
    const r = await StingClip.open({ src, name: entry.name, region: entry, media: entry.media, original: entry.stock || null, hideOriginal: isNew ? true : entry.hideOriginal === true });
    if (!r) return;
    const e = Object.assign({}, entry, { name: r.name });
    if (r.hideOriginal) e.hideOriginal = true; else delete e.hideOriginal;
    for (const k of L.CLIP) { if (r[k] == null) delete e[k]; else e[k] = r[k]; }
    if (r.sourceLength) e.duration = Math.round(r.sourceLength * 100) / 100;
    const list = L.read(), clean = L.clean(e);
    if (!clean) return;
    if (isNew) list.push(clean); else list[entry.__i] = clean;
    L.write(list);
    msg(isNew ? `Added “${clean.name}”.` : `Saved “${clean.name}”.`);
    render();
  }

  $('mine').addEventListener('click', async ev => {
    const b = ev.target.closest('button[data-a]'), li = b && b.closest('li[data-i]');
    if (!li) return;
    const i = Number(li.dataset.i), list = L.read(), e = list[i];
    if (!e) return;
    if (b.dataset.a === 'play') preview('m' + i, e);
    else if (b.dataset.a === 'del') { if (confirm(`Remove “${e.name}” from your clips?`)) { list.splice(i, 1); L.write(list); render(); } }
    else if (b.dataset.a === 'edit') {
      const src = await L.source(e, stock);
      if (!src) return msg('That clip’s file isn’t on this computer: use Find files…', true);
      edit(Object.assign({ __i: i }, e), src, false);
    }
  });
  $('stock').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-a]'), li = b && b.closest('li[data-s]');
    if (!li) return;
    const s = stock[Number(li.dataset.s)];
    if (b.dataset.a === 'play') preview('s' + li.dataset.s, s);
    else if (b.dataset.a === 'clip') edit({ name: s.name, stock: s.name, media: s.media || 'audio', duration: s.duration, start: s.start, end: s.end, fadeIn: s.fadeIn, fadeOut: s.fadeOut }, s.url, true);
  });

  $('fromfile').addEventListener('click', () => $('pickfile').click());
  $('pickfile').addEventListener('change', async () => {
    const f = $('pickfile').files[0]; $('pickfile').value = '';
    if (!f) return;
    try { await L.keepFile(f); } catch (err) { return msg('Couldn’t keep the file in this browser: ' + (err && err.message || err), true); }
    have.add(L.fileKey({ file: f.name, size: f.size }));
    edit({ name: f.name.replace(/\.[^.]+$/, ''), file: f.name, size: f.size, media: f.type.startsWith('video/') ? 'video' : 'audio' }, f, true);
  });

  $('export').addEventListener('click', () => {
    const list = L.read();
    if (!list.length) return msg('There are no clips to export yet.', true);
    const json = JSON.stringify({ about: 'Walk-up sting clips (a sting library from ' + location.host + '): stock = a stock sting by name, file = a track by file name (and size), start/end in seconds, fades in ms.', stings: list }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json + '\n'], { type: 'application/json' }));
    a.download = 'sting-library.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    msg(`Exported ${list.length} clip${list.length === 1 ? '' : 's'} as sting-library.json.`);
  });
  $('import').addEventListener('click', () => $('pickjson').click());
  $('pickjson').addEventListener('change', async () => {
    const f = $('pickjson').files[0]; $('pickjson').value = '';
    if (!f) return;
    let j;
    try { j = JSON.parse(await f.text()); } catch (_) { return msg('That isn’t a sting library (not JSON).', true); }
    const incoming = (Array.isArray(j && j.stings) ? j.stings : []).map(L.clean).filter(Boolean);
    if (!incoming.length) return msg('No clips found in that file.', true);
    const list = L.read();
    for (const e of incoming) { const i = list.findIndex(x => x.name === e.name); if (i >= 0) list[i] = e; else list.push(e); }   // same name: replaced
    L.write(list);
    await checkFiles();
    const need = list.filter(missing).length;
    msg(`Imported ${incoming.length} clip${incoming.length === 1 ? '' : 's'}.` + (need ? ` ${need} need${need === 1 ? 's' : ''} its file: click Find files… and pick the folder they’re in.` : ''), need > 0);
    render();
  });
  $('find').addEventListener('click', () => $('pickdir').click());
  $('pickdir').addEventListener('change', async () => {
    const files = Array.from($('pickdir').files || []); $('pickdir').value = '';
    let found = 0;
    for (const e of L.read().filter(missing)) {
      const f = files.find(x => x.name === e.file && (!e.size || x.size === e.size)) || files.find(x => x.name === e.file);
      if (!f) continue;
      try { await window.videoStore.put(L.fileKey(e), f); found++; } catch (_) { /* full */ }
    }
    await checkFiles();
    const still = L.read().filter(missing).length;
    msg(`Found ${found} file${found === 1 ? '' : 's'}.` + (still ? ` ${still} still missing.` : ''), still > 0);
    render();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && playing) stopPlay(); });

  // (tests)
  window.__stingLibrary = { list: () => L.read(), missing: () => L.read().filter(missing).map(e => e.name), playing: () => playingId, hidden: () => [...L.hidden(stock)].map(i => stock[i].name) };

  loadStock().then(checkFiles).then(render);
})();
