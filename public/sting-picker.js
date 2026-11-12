/*!
 * sting-picker.js
 * The + sting dialog, shared by the run sheet editor (an item's walk-up sting) and playout computers
 * (playout.html: a cue's sound or video). Three tabs along the top: Walk-up sting (the site's stock list,
 * stock-stings.json, with its clips), Custom file (a file from this computer, or one from a folder's
 * list), Edited sting (my clips: the sting library, which opens as a panel over the page). ✂ beside each
 * list goes straight into the clip editor (sting-clip.js; Save and use keeps the clip in the library and
 * chooses it). One Use button for whichever tab is showing. It only chooses: the page puts the choice
 * where it goes (and keeps any file).
 * Music styles (a trial, TimerFeatures.styles, with sting-styles.js on the page): stock stings carry their
 * top styles (styles in stock-stings.json; a clip borrows its song's, by url); files of your own (the
 * folder's, My clips') are listened to on this computer while the dialog is open (StingStyles.listen; step
 * 4, 13 Nov 2026), a note saying how far it's got. Chips of the genres and styles there are, above the tabs
 * (StingStyles.chips: the owner, 13 Nov 2026, choose rather than type), filter all three lists: with some
 * lit, only the stings in any of them (fitsAny; a file not listened to yet sits out), best first, with the
 * style they matched (else each with its top style); and the model's credit.
 *
 * window.StingPicker:
 *   open(opts) → Promise<choice | null>
 *     opts: note      the line under the tabs
 *           fileNote  the Custom file tab's line
 *           users(s)  → [names]: where else a stock sting is used (marked "in use"; the Hide tick hides
 *                     them, labelled hideLabel). Without it, no tick.
 *           browse()  Browse for a file…: called in the click (the page's own file input), then the
 *                     dialog closes with null
 *     choice: {sting: {src: 'stock'|'link', media, name, url, duration, lib?, ...clip}}   a stock sting,
 *             or a library clip of one (or of a link): played from its url
 *          or {file, extra?: {name, clip, lib}}   a file (from a folder, or a library clip's file)
 *   setup({keepFolder})  false: don't keep the folder in this browser (the remote run sheet editor)
 *   stock() → Promise<[{name, url, media, duration, ...clip, hideOriginal?}]>   the site's list
 *   clipFields(x), partFields(x), idOf(x)   a clip's fields (with its level / without), the same track cut
 *                                           the same way
 *   choiceOf(e, list) → Promise<choice | null>   a sting library clip as a choice (list: stock())
 *   folder() / chooseFolder() / savedFolder() / ensureFolder() / quietFolder() / onFolder(fn)   the Custom
 *                                           file folder (random stings use it too: sting-roll.js); quietFolder:
 *                                           listed only if the browser needn't ask (no click needed)
 *   openLibrary() → Promise (resolves when it's closed)
 * MIT Licensed
 */
var StingPicker = (function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const noExt = n => String(n || '').replace(/\.[A-Za-z0-9]{1,5}$/, '') || String(n || '');
  const fmtDur = sec => {                        // "20 min", "1 min 30 s" (as runsheet-core.js formatDuration)
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60, p = [];
    if (h) p.push(h + ' h'); if (m) p.push(m + ' min'); if (s) p.push(s + ' s');
    return p.join(' ') || '0 min';
  };
  let keepFolder = true;
  function setup(o) { if (o && o.keepFolder === false) keepFolder = false; }

  // ─── The stock list, and clips ────────────────────────────────────────────
  const mediaOf = name => /\.(mp4|m4v|webm|mov|ogv)(\?|#|$)/i.test(name || '') ? 'video' : 'audio';
  // A clip's fields (sting-clip.js): only the ones it has
  // and its level (lufs: its loudness as it plays; volume: a trim, < 1), which travel with it
  const CLIP_KEYS = ['start', 'end', 'fadeIn', 'fadeOut', 'loop', 'lufs', 'volume', 'fadeDb'];   // (fadeDb: its fades even in dB)
  const partFields = x => { const r = StingClip.region(x), o = {}; if (r) for (const k of CLIP_KEYS) if (r[k] != null && r[k] !== 0) o[k] = r[k]; return o; };
  const clipFields = x => {
    const o = partFields(x);
    if (Number.isFinite(x.lufs)) o.lufs = x.lufs;
    if (Number.isFinite(x.volume) && x.volume > 0 && x.volume < 1) o.volume = x.volume;
    return o;
  };
  const idOf = x => x.url + '#' + JSON.stringify(partFields(x));   // the same track, cut the same way (its level aside)
  let stockList = null;
  function stock() {
    if (!stockList) stockList = fetch('stock-stings.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { stings: [] }).then(j => {
      const base = new URL('stock-stings.json', location.href);
      return (Array.isArray(j && j.stings) ? j.stings : []).map(x => {
        try {
          const url = new URL(String(x.url || ''), base).href;
          const styles = window.StingStyles && StingStyles.valid(x.styles);
          return /^https:/.test(url) && x.name ? Object.assign({ name: String(x.name).slice(0, 200), url, media: x.media === 'video' ? 'video' : x.media === 'audio' ? 'audio' : mediaOf(url), duration: Number.isFinite(x.duration) ? Math.round(x.duration) : null }, clipFields(x), x.hideOriginal === true ? { hideOriginal: true } : {}, styles && styles.length ? { styles } : {}) : null;
        } catch (_) { return null; }
      }).filter(Boolean);
    }).then(list => {                              // a clip has its song's styles (the same url)
      const of = new Map(list.filter(x => x.styles).map(x => [x.url, x.styles]));
      for (const x of list) if (!x.styles && of.has(x.url)) x.styles = of.get(x.url);
      return list;
    }).catch(() => []);
    return stockList;
  }
  // A library clip as a choice: a file clip brings its file, a stock or link clip its link
  async function choiceOf(e, list) {
    const clip = clipFields(e);
    if (e.file) {
      const blob = await StingLibrary.source(e, list);
      if (!blob) { alert('That clip’s file isn’t on this computer.'); return null; }
      return { file: new File([blob], e.file, { type: blob.type || (e.media === 'video' ? 'video/mp4' : 'audio/mpeg') }), extra: { name: e.name, clip, lib: e.name } };
    }
    const url = await StingLibrary.source(e, list), base = e.stock ? list.find(x => x.name === e.stock) : null;
    return { sting: Object.assign({ src: e.stock ? 'stock' : 'link', media: e.media, name: e.name, url, duration: e.duration != null ? Math.round(e.duration) : base && base.duration, lib: e.name }, clip) };
  }

  // ─── Custom file → Choose a folder… ───────────────────────────────────────
  // Its audio and video files (subfolders too) in a list. Chrome and Edge keep the folder (its handle in
  // videoStore, FOLDER_KEY; not with keepFolder off: the remote editor doesn't touch this computer's
  // storage) and list it again next time (after a click, if the browser wants to ask again); other
  // browsers pick it with a folder input, kept until the page closes.
  const FOLDER_KEY = 'stingfolder:handle', FOLDER_MAX = 500;
  const MEDIA_EXT = /\.(mp3|m4a|aac|wav|aif|aiff|flac|ogg|oga|opus|weba|mp4|m4v|webm|mov|ogv)$/i;
  let folder = null;                             // {name, files: [{path, file | handle}]}
  const folderFns = new Set();
  const byPath = (a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
  async function listDir(dir, prefix, out, depth) {
    for await (const [name, h] of dir.entries()) {
      if (out.length >= FOLDER_MAX) return;
      if (name.startsWith('.')) continue;
      if (h.kind === 'file' && MEDIA_EXT.test(name)) out.push({ path: prefix + name, handle: h });
      else if (h.kind === 'directory' && depth < 3) await listDir(h, prefix + name + '/', out, depth + 1);
    }
  }
  async function folderOf(dir) { const files = []; await listDir(dir, '', files, 0); return { name: dir.name, files: files.sort(byPath) }; }
  async function savedFolder() {                 // the folder kept from before: {handle, ok} (ok: no need to ask)
    if (!keepFolder || !window.videoStore) return null;
    try {
      const h = await window.videoStore.get(FOLDER_KEY);
      return h && h.kind === 'directory' ? { handle: h, ok: (await h.queryPermission({ mode: 'read' })) === 'granted' } : null;
    } catch (_) { return null; }
  }
  let folderInput = null;                        // (browsers without showDirectoryPicker)
  function pickByInput() {
    if (!folderInput) {
      folderInput = document.createElement('input');
      folderInput.type = 'file'; folderInput.webkitdirectory = true; folderInput.multiple = true; folderInput.hidden = true;
      document.body.appendChild(folderInput);
      folderInput.addEventListener('change', () => {
        const all = [...folderInput.files]; folderInput.value = '';
        if (!all.length) return;
        const root = (all[0].webkitRelativePath || '').split('/')[0] || 'folder';
        const files = all.filter(f => MEDIA_EXT.test(f.name) && !/(^|\/)\./.test(f.webkitRelativePath || f.name)).slice(0, FOLDER_MAX)
          .map(f => ({ path: (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name, file: f }));
        setFolder({ name: root, files: files.sort(byPath) });
      });
    }
    folderInput.click();
  }
  function setFolder(f) { folder = f; folderFns.forEach(fn => fn()); }
  async function chooseFolder() {
    if (!window.showDirectoryPicker) return pickByInput();
    let dir; try { dir = await window.showDirectoryPicker({ id: 'stings', mode: 'read' }); } catch (_) { return; }   // (cancelled)
    const f = await folderOf(dir);
    if (keepFolder && window.videoStore) window.videoStore.put(FOLDER_KEY, dir).catch(() => {});
    setFolder(f);
  }
  async function ensureFolder() {                // the folder, listed (asking again if the browser wants: needs the click)
    if (folder || !keepFolder) return folder;
    const sf = await savedFolder();
    if (!sf) return null;
    try { if (!sf.ok && (await sf.handle.requestPermission({ mode: 'read' })) !== 'granted') return null; setFolder(await folderOf(sf.handle)); } catch (_) { return null; }
    return folder;
  }
  let quietly = null;
  function quietFolder() {                       // the folder, listed only if the browser needn't ask (no click)
    if (folder || !keepFolder) return Promise.resolve(folder);
    if (!quietly) quietly = (async () => {
      const sf = await savedFolder();
      if (sf && sf.ok && !folder) { try { setFolder(await folderOf(sf.handle)); } catch (_) { /* gone */ } }
      return folder;
    })().finally(() => { quietly = null; });
    return quietly;
  }
  window.__stingFolder = setFolder;              // (tests: {name, files: [{path, file}]})

  // ─── Previews (on the page's preview output, audio-out.js) ────────────────
  let preview = null;                            // what the dialog is playing
  const outEl = el => (window.AudioOut ? AudioOut.media(el) : Promise.resolve());
  function stopPreview() {
    if (!preview) return;
    preview.stop(); preview = null;
    for (const bid of ['sting-prev', 'sting-mprev', 'sting-fprev']) { const b = document.getElementById(bid); if (b) { b.textContent = '▶'; b.title = 'Hear it'; } }
  }
  window.__stingPreview = () => !!preview;       // (tests)

  // ─── Its look (the run sheet editor sizes it in rem; any page's colours, else these) ──
  const CSS = `
.sting-dlg, .sting-libwrap { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 50; }
.sting-libwrap { z-index: 60; }
.sting-dlg .ask-box, .sting-libwrap .ask-box { background: var(--panel, #151515); color: var(--text, #ddd); border: 1px solid var(--line2, #333); border-radius: 0.6rem; padding: 1.4rem 1.6rem; box-shadow: 0 0.6rem 2rem rgba(0,0,0,0.6); text-align: left; box-sizing: border-box; }
.sting-dlg .ask-box { width: min(36rem, 94vw); max-width: none; }
.sting-dlg .ask-btns { display: flex; gap: 0.6rem; justify-content: flex-end; flex-wrap: wrap; }
.sting-dlg .ask-btns button { padding: 0.5rem 1rem; }
.sting-dlg select { font: inherit; padding: 0.3rem 0.4rem; background: #1a1a1a; color: var(--text, #ddd); border: 1px solid var(--line2, #333); border-radius: 0.3rem; }
.sting-note { color: var(--dim, #888); margin: 0.4rem 0 0.8rem; }
.sting-row { display: flex; gap: 0.4rem; margin-top: 0.25rem; }
.sting-tabs { display: flex; margin: 0 0 0.6rem; }
.sting-tabs .sting-tab { flex: 1; border-radius: 0; padding: 0.45rem 0.6rem; }
.sting-tabs .sting-tab:first-child { border-radius: 0.35rem 0 0 0.35rem; }
.sting-tabs .sting-tab:last-child { border-radius: 0 0.35rem 0.35rem 0; }
.sting-tabs .sting-tab + .sting-tab { border-left: 0; }
.sting-tabs .sting-tab.on { background: #0b3d5c; border-color: #2a6a9a; color: #fff; }
.sting-pane { min-height: 6.5rem; margin-bottom: 0.8rem; }
.sting-pane > button { margin: 0.3rem 0 0.4rem; }
.sting-libwrap .sting-libbox { width: min(64rem, 94vw); max-width: none; max-height: 88vh; overflow: auto; }
.sting-libtop { display: flex; gap: 0.8rem; align-items: baseline; margin-bottom: 0.6rem; }
.sting-libtop .sting-note { flex: 1; margin: 0; }
.sting-row select { flex: 1; min-width: 0; margin-top: 0 !important; }   /* (min-width 0: a long file name mustn't push ▶ ✂ out of the dialog) */
.sting-row button { flex: none; padding: 0.2rem 0.7rem; }
.sting-btnrow button { padding: 0.35rem 0.8rem; }
#sting-reopen, #sting-folderbox { margin-top: 0.6rem; }
#sting-folderbox .sting-note { margin: 0 0 0.25rem; }
.sting-check { display: flex; gap: 0.4rem; align-items: center; margin: 0.2rem 0 0.6rem; color: var(--dim, #888); cursor: pointer; }
.sting-check input { width: auto; flex: none; margin: 0; }
.sting-chiphead { color: var(--dim, #888); font-size: 0.85em; margin: 0 0 0.25rem; }
.sting-chiphead span { opacity: 0.8; }
#sting-chips { margin: 0 0 0.3rem; }
#sting-chips .ss-chips { max-height: 9.5rem; }
.sting-listen { color: var(--dim, #888); font-size: 0.85em; margin: 0 0 0.6rem; min-height: 1.2em; }
.sting-credit { color: var(--dim, #888); font-size: 0.75em; margin: -0.3rem 0 0.8rem; opacity: 0.8; }`;
  function style() {
    if (document.getElementById('sting-picker-css')) return;
    const s = document.createElement('style'); s.id = 'sting-picker-css'; s.textContent = CSS;
    document.head.insertBefore(s, document.head.firstChild);   // first: the page's own rules win (the editor's dialogs)
  }

  // ─── The dialog ───────────────────────────────────────────────────────────
  const okList = (list, st) => Promise.all(list.map(async e => !!(await StingLibrary.source(e, st))));
  async function open(opts) {
    opts = opts || {};
    style();
    const users = s => (opts.users ? opts.users(s) : []);
    const stockSt = await stock();
    const styled = !!(window.StingStyles && window.TimerFeatures && TimerFeatures.styles && stockSt.some(x => x.styles));
    let mine = window.StingLibrary ? StingLibrary.read() : [];
    let mineOk = window.StingLibrary ? await okList(mine, stockSt) : [];
    const CLIP_TIP = 'Make a clip of it: just the part you want, with fades (Save and use: kept in your sting library and used here)';
    const wrap = document.createElement('div');
    wrap.className = 'ask sting-dlg';
    wrap.innerHTML = '<div class="ask-box" role="dialog" aria-modal="true">' +
      (styled ? `<div class="sting-chiphead">Styles <span>(light some to see only those, in every tab)</span></div><div id="sting-chips"></div><p class="sting-listen" id="sting-listen"></p>` : '') +
      '<div class="sting-tabs"><button class="sting-tab" data-mode="stock">Walk-up sting</button><button class="sting-tab" data-mode="custom">Custom file</button><button class="sting-tab" data-mode="edited">Edited sting</button></div>' +
      (opts.note ? `<p class="sting-note">${esc(opts.note)}</p>` : '') +
      '<div class="sting-pane" data-mode="stock">' +
        (stockSt.length ? `<span class="sting-row"><select id="sting-stock"></select><button type="button" id="sting-prev" title="Hear it">▶</button><button type="button" id="sting-sedit" title="${CLIP_TIP}">✂</button></span>` +
          (opts.users ? `<label class="sting-check"><input type="checkbox" id="sting-hideused"> ${esc(opts.hideLabel || 'Hide stings already in use')}</label>` : '') +
          `<p class="sting-note" id="sting-none" hidden>${esc(opts.noneLeft || 'Every stock sting is already in use.')}</p>` : '<p class="sting-note">This site has no stock stings.</p>') +
      '</div>' +
      '<div class="sting-pane" data-mode="custom">' +
        `<p class="sting-note">${esc(opts.fileNote || 'Music or a video of your own, from this computer: one file, or pick from a folder of them.')}</p>` +
        '<span class="sting-row sting-btnrow"><button type="button" id="sting-browse">Browse for a file…</button><button type="button" id="sting-folderpick">Choose a folder…</button></span>' +
        '<button type="button" id="sting-reopen" hidden></button>' +
        '<div id="sting-folderbox" hidden><p class="sting-note" id="sting-foldername"></p>' +
          `<span class="sting-row" id="sting-folderrow"><select id="sting-folder"></select><button type="button" id="sting-fprev" title="Hear it">▶</button><button type="button" id="sting-fedit" title="${CLIP_TIP}">✂</button></span></div>` +
      '</div>' +
      '<div class="sting-pane" data-mode="edited">' +
        '<span class="sting-row" id="sting-minerow"><select id="sting-mine"></select><button type="button" id="sting-mprev" title="Hear it">▶</button><button type="button" id="sting-medit" title="Change this clip (Save and use: kept in your sting library and used here)">✂</button></span>' +
        '<p class="sting-note" id="sting-mnone">No clips yet. In the sting library, choose just the part of a track you want, with fades: of a stock sting or a file of your own.</p>' +
        '<button type="button" id="sting-lib">Open the sting library…</button>' +
      '</div>' +
      (styled ? `<p class="sting-credit">${esc(StingStyles.CREDIT)}</p>` : '') +
      '<div class="ask-btns"><button class="primary sting-use">Use</button><button class="sting-cancel">Cancel</button></div></div>';
    document.body.appendChild(wrap);
    const $d = sel => wrap.querySelector(sel);
    const sel = $d('#sting-stock'), folderSel = $d('#sting-folder'), mineSel = $d('#sting-mine'), hideBox = $d('#sting-hideused'), prevBtn = $d('#sting-prev'), useBtn = $d('.sting-use');
    let styleKeys = [];                            // the style chips lit (none: every sting)
    let mode = 'stock';
    // Styles: a stock sting's (stored), a file's (listened to here: undefined until then), a clip's (its song's or its file's)
    const SS = window.StingStyles, lit = () => styled && styleKeys.length > 0;
    const fileOf = (name, size) => (styled ? SS.localOf(SS.localKey(name, size)) : undefined);
    const mineStyles = e => (e.file ? fileOf(e.file, e.size) : (stockSt.find(x => (e.stock ? x.name === e.stock : x.url === e.url) && x.styles) || {}).styles);
    const styleTag = (list, b) => { const st = b ? b.i : Array.isArray(list) ? SS.top(list) : -1; return st >= 0 ? ' · ' + esc(SS.nameOf(st)) : ''; };
    function rank(rows) {                          // with chips lit: only those in them, best first (each with the style it matched)
      if (!lit()) return rows;
      return rows.map(r => Object.assign(r, { b: SS.bestAny(r.s, styleKeys) })).filter(r => r.b && r.b.score >= SS.FLOOR).sort((a, b) => b.b.score - a.b.score);
    }

    // the stock list: whole tracks a better clip replaces left out; with a style typed, only the stings in it,
    // best first, each with the style it matched (else each with its top style)
    function fill() {
      if (!sel) return;
      const keep = sel.value, hide = hideBox && hideBox.checked, q = styleKeys.length > 0;
      const replaced = window.StingLibrary ? StingLibrary.hidden(stockSt, mine) : new Set();
      let rows = stockSt.map((x, i) => ({ x, i, b: q ? StingStyles.bestAny(x.styles, styleKeys) : null }));
      if (q) rows = rows.filter(r => r.b && r.b.score >= StingStyles.FLOOR).sort((a, b) => b.b.score - a.b.score);
      sel.innerHTML = rows.map(({ x, i, b }) => {
        if (replaced.has(i)) return '';
        const used = users(x);
        if (hide && used.length) return '';
        const len = StingClip.length(x, x.duration), st = b ? b.i : styled ? StingStyles.top(x.styles) : -1;
        return `<option value="${i}">${esc(x.name)}${len ? ' · ' + fmtDur(Math.max(1, Math.round(len))) : ''}${x.media === 'video' ? ' (video)' : ''}${st >= 0 ? ' · ' + esc(StingStyles.nameOf(st)) : ''}${used.length ? ' · in use: ' + esc(used.join(', ')) : ''}</option>`;
      }).join('');
      if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
      $d('#sting-none').hidden = sel.options.length > 0;
      $d('#sting-none').textContent = q ? 'No stock sting in the styles lit (or every one is in use).' : (opts.noneLeft || 'Every stock sting is already in use.');
      prevBtn.disabled = $d('#sting-sedit').disabled = !sel.options.length;
    }
    function fillMine() {
      const keep = mineSel.value;
      mineSel.innerHTML = rank(mine.map((e, i) => ({ e, i, s: styled ? mineStyles(e) : undefined }))).map(({ e, i, s, b }) => {
        const l = StingClip.length(e, e.duration);
        return `<option value="${i}"${mineOk[i] ? '' : ' disabled'}>${esc(e.name)}${l ? ' · ' + fmtDur(Math.max(1, Math.round(l))) : ''}${styled ? styleTag(s, b) : ''}${mineOk[i] ? '' : ' (its file isn’t on this computer)'}</option>`;
      }).join('');
      const ok = [...mineSel.options].filter(o => !o.disabled);
      if (ok.some(o => o.value === keep)) mineSel.value = keep; else if (ok.length) mineSel.value = ok[0].value;
      $d('#sting-minerow').style.display = mineSel.options.length ? '' : 'none';
      $d('#sting-mnone').style.display = mineSel.options.length ? 'none' : '';
      $d('#sting-mnone').textContent = mine.length ? 'None of your clips is in the styles lit (a file not listened to yet sits out).' : 'No clips yet. In the sting library, choose just the part of a track you want, with fades: of a stock sting or a file of your own.';
    }
    function fillFolder() {
      const box = $d('#sting-folderbox');
      box.hidden = !folder;
      if (!folder) return;
      const keep = folderSel.value, rows = rank(folder.files.map((f, i) => ({ f, i, s: styled && f.k ? SS.localOf(f.k) : undefined })));
      folderSel.innerHTML = rows.map(({ f, i, s, b }) => `<option value="${i}">${esc(noExt(f.path))}${styled ? styleTag(s, b) : ''}</option>`).join('');
      if ([...folderSel.options].some(o => o.value === keep)) folderSel.value = keep;
      const unheard = lit() ? folder.files.filter(f => !f.k || SS.localOf(f.k) === undefined).length : 0;
      $d('#sting-foldername').textContent = !folder.files.length ? `No audio or video files in “${folder.name}”.`
        : (lit() ? (rows.length ? `In “${folder.name}”, in the styles lit` : `Nothing in “${folder.name}” in the styles lit`) + (unheard ? ` (${unheard} not listened to yet)` : '') + (rows.length ? ':' : '.')
          : `In “${folder.name}”${folder.files.length >= FOLDER_MAX ? ' (the first ' + FOLDER_MAX + ')' : ''}:`);
      $d('#sting-folderrow').style.display = folderSel.options.length ? '' : 'none';
      $d('#sting-reopen').hidden = true;
      $d('#sting-folderpick').textContent = 'Choose another folder…';
    }
    // The chosen file, as it can play (StingClip.playable: an AIFF as WAV): converted when chosen, not when
    // listed (a folder may hold hundreds), and kept on its entry for the next ▶; false = said why it can't
    const folderFile = async () => {
      const f = folder && folder.files[Number(folderSel.value)];
      if (!f) return null;
      const raw = f.file || await f.handle.getFile(), k = raw.size + ':' + raw.lastModified;
      if (f.pk !== k) { f.pk = k; f.pf = StingClip.playable(raw); }
      try { return await f.pf; } catch (err) { f.pk = null; alert(err && err.message || err); return false; }
    };
    const canUse = () => { useBtn.disabled = mode === 'stock' ? !(sel && sel.options.length) : mode === 'custom' ? !(folder && folderSel.options.length) : ![...mineSel.options].some(o => !o.disabled); };
    function setMode(m) {
      mode = m;
      stopPreview();
      wrap.querySelectorAll('.sting-tab').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
      wrap.querySelectorAll('.sting-pane').forEach(p => { p.style.display = p.dataset.mode === m ? '' : 'none'; });
      useBtn.textContent = m === 'stock' ? 'Use this sting' : m === 'custom' ? 'Use this file' : 'Use this clip';
      canUse();
    }
    // Styles: the chips count every song here (stock, the folder's files and my clips' once listened to)
    let chipsUI = null, chipSig = '';
    function chipLists() {
      const seen = new Map();
      for (const x of stockSt) if (x.media !== 'video' && x.styles && !seen.has('url:' + x.url)) seen.set('url:' + x.url, x.styles);
      mine.forEach((e, i) => { if (mineOk[i] && e.file) { const s = fileOf(e.file, e.size); if (s) seen.set(SS.localKey(e.file, e.size), s); } });
      if (folder) for (const f of folder.files) if (f.k) { const s = SS.localOf(f.k); if (s) seen.set(f.k, s); }
      return [...seen.values()];
    }
    function refresh() {                           // a file listened to (or the folder, or my clips, changed): redrawn, nothing stopped
      if (!styled || !wrap.isConnected) return;
      const lists = chipLists(), sig = lists.length + ':' + (folder ? folder.name + ':' + folder.files.length : '') + ':' + mine.length;
      if (chipsUI && sig !== chipSig) { chipSig = sig; chipsUI.set(lists, styleKeys); }
      fill(); fillFolder(); fillMine(); canUse();
      $d('#sting-listen').textContent = SS.listenNote();
    }
    async function listenOwn() {                   // the folder's files and my clips' files: listened to (unless known)
      if (!styled) return;
      const items = [];
      if (folder) for (const f of folder.files) {
        if (!f.k) { try { const file = f.file || await f.handle.getFile(); f.k = SS.localKey(file.name, file.size); } catch (_) { continue; } }
        items.push({ key: f.k, get: () => (f.file ? Promise.resolve(f.file) : f.handle.getFile()) });
      }
      mine.forEach((e, i) => { if (mineOk[i] && e.file) items.push({ key: SS.localKey(e.file, e.size), get: () => StingLibrary.source(e, stockSt) }); });
      SS.listen(items);
      refresh();
    }
    async function libraryChanged() {
      if (!window.StingLibrary) return;
      const now = StingLibrary.read();
      if (JSON.stringify(now) === JSON.stringify(mine)) return;
      mine = now; mineOk = await okList(mine, stockSt);
      fillMine(); fill(); setMode(mode);
      listenOwn();
    }

    if (sel) {
      if (hideBox) {
        const key = opts.hideKey || 'sting_hide_used';   // this computer's choice
        try { hideBox.checked = localStorage.getItem(key) === '1'; } catch (_) { /* private mode */ }
        hideBox.addEventListener('change', () => { try { localStorage.setItem(key, hideBox.checked ? '1' : '0'); } catch (_) { /* private mode */ } stopPreview(); fill(); setMode(mode); });
      }
      sel.addEventListener('change', stopPreview);

      prevBtn.addEventListener('click', () => {
        if (preview) return stopPreview();
        const x = stockSt[Number(sel.value)];
        if (!x) return;
        if (window.AudioOut && !AudioOut.ok()) return AudioOut.warn();   // the preview output isn't there
        if (StingClip.region(x)) preview = StingClip.preview(x.url, x);   // a clip: just its part, with its fades
        else {
          const el = document.createElement(x.media === 'video' ? 'video' : 'audio');   // (a video: its sound only)
          el.src = x.url; el.onended = stopPreview; outEl(el).then(() => el.play()).catch(() => stopPreview());
          preview = { stop() { el.pause(); el.removeAttribute('src'); el.load(); } };
        }
        prevBtn.textContent = '■'; prevBtn.title = 'Stop';
      });
    }
    mineSel.addEventListener('change', stopPreview);
    $d('#sting-mprev').addEventListener('click', async () => {
      if (preview) return stopPreview();
      const e = mine[Number(mineSel.value)];
      const src = e && await StingLibrary.source(e, stockSt);
      if (!src) return;
      preview = StingClip.preview(src, e);
      if (preview.refused) { preview = null; return; }
      $d('#sting-mprev').textContent = '■';
    });
    folderSel.addEventListener('change', stopPreview);
    $d('#sting-fprev').addEventListener('click', async () => {
      if (preview) return stopPreview();
      if (window.AudioOut && !AudioOut.ok()) return AudioOut.warn();   // the preview output isn't there
      let file; try { file = await folderFile(); } catch (_) { file = null; }
      if (!file) return;
      const url = URL.createObjectURL(file), el = document.createElement(/^video\//.test(file.type) ? 'video' : 'audio');   // (a video: its sound only)
      el.src = url; el.onended = stopPreview; outEl(el).then(() => el.play()).catch(() => stopPreview());
      preview = { stop() { el.pause(); el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); } };
      $d('#sting-fprev').textContent = '■'; $d('#sting-fprev').title = 'Stop';
    });
    if (styled) chipsUI = SS.chips($d('#sting-chips'), chipLists(), [], keys => { styleKeys = keys; stopPreview(); fill(); fillFolder(); fillMine(); canUse(); });
    const offLocal = styled ? SS.onLocal(refresh) : () => {};
    const onFolder = () => { stopPreview(); fillFolder(); setMode(mode); listenOwn(); };
    folderFns.add(onFolder);
    $d('#sting-folderpick').addEventListener('click', () => { stopPreview(); chooseFolder(); });
    if (!folder) savedFolder().then(async sf => {   // the folder from last time: listed at once, or after a click if the browser asks
      if (!sf || folder || !wrap.isConnected) return;
      if (sf.ok) { try { setFolder(await folderOf(sf.handle)); } catch (_) { /* gone */ } return; }
      const b = $d('#sting-reopen');
      b.textContent = `Show the files in “${sf.handle.name}” again`; b.hidden = false;
      b.onclick = async () => { try { if ((await sf.handle.requestPermission({ mode: 'read' })) === 'granted') setFolder(await folderOf(sf.handle)); } catch (_) { b.hidden = true; } };
    });
    fill(); fillMine(); fillFolder();
    setMode(stockSt.length ? 'stock' : 'custom');
    listenOwn();

    return new Promise(resolve => {
      const onStore = ev => { if (ev.key === 'sting_library') libraryChanged(); };
      window.addEventListener('storage', onStore);
      window.addEventListener('focus', libraryChanged);   // (and on coming back from another tab)
      let done = false;
      const close = choice => {
        if (done) return;
        done = true;
        stopPreview();
        folderFns.delete(onFolder);
        offLocal();
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('storage', onStore);
        window.removeEventListener('focus', libraryChanged);
        wrap.remove();
        resolve(choice || null);
      };
      function onKey(e) {
        if (document.querySelector('.sting-libwrap, .sc-wrap')) return;   // the library or the clip editor has the keys
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); e.stopPropagation(); if (!useBtn.disabled) useBtn.click(); }
        else if (e.key === 'PageDown' || e.key === 'PageUp') e.stopPropagation();   // not Next/Back behind it
      }
      document.addEventListener('keydown', onKey, true);
      wrap.querySelectorAll('.sting-tab').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
      $d('.sting-cancel').addEventListener('click', () => close());
      $d('#sting-browse').addEventListener('click', () => { if (opts.browse) opts.browse(); close(); });   // (the page's file picker needs this click)
      $d('#sting-lib').addEventListener('click', async () => { stopPreview(); await openLibrary(); await libraryChanged(); setMode('edited'); });
      // ✂ beside each list: straight into the clip editor, as from the sting library. Save and use keeps
      // the clip in the library (index: the clip changed; null: a new one) and chooses it; Cancel comes
      // back here with nothing saved. keep: a file to store with a new clip (only once saved).
      async function editAndUse(entry, src, index, keep) {
        stopPreview();
        const r = await StingClip.open({ src, name: entry.name, region: entry, media: entry.media, original: entry.stock || null,
          hideOriginal: index == null ? true : entry.hideOriginal === true, saveLabel: 'Save and use' });
        if (!r) return;
        try { if (keep) await StingLibrary.keepFile(keep); } catch (err) { alert('Couldn’t keep the file in this browser: ' + (err && err.message || err)); return; }
        const e = StingLibrary.fromEdit(entry, Object.assign({}, r, { name: StingLibrary.freeName(r.name, index) }));
        if (!e) return;
        const list = StingLibrary.read();
        if (index == null) list.push(e); else list[index] = e;
        StingLibrary.write(list);
        close(await choiceOf(e, stockSt));
      }
      if (sel) $d('#sting-sedit').addEventListener('click', () => {
        const x = stockSt[Number(sel.value)];
        if (x) editAndUse(Object.assign({ name: x.name, stock: x.name, media: x.media || 'audio', duration: x.duration }, clipFields(x)), x.url, null);
      });
      $d('#sting-medit').addEventListener('click', async () => {
        const i = Number(mineSel.value), e = mine[i];
        const src = e && mineOk[i] && await StingLibrary.source(e, stockSt);
        if (src) editAndUse(e, src, i);
      });
      $d('#sting-fedit').addEventListener('click', async () => {
        let file; try { file = await folderFile(); } catch (_) { file = null; }
        if (file === false) return;
        if (!file) { alert('That file can’t be read any more: choose the folder again.'); return; }
        editAndUse({ name: noExt(file.name), file: file.name, size: file.size, media: /^video\//.test(file.type) ? 'video' : 'audio' }, file, null, file);
      });
      useBtn.addEventListener('click', async () => {
        if (mode === 'stock') {
          const x = sel && stockSt[Number(sel.value)];
          if (!x || !sel.options.length) return;
          close({ sting: Object.assign({ src: 'stock', media: x.media, name: x.name, url: x.url, duration: x.duration }, clipFields(x)) });
        } else if (mode === 'custom') {
          let file; try { file = await folderFile(); } catch (_) { file = null; }
          if (file === false) return;
          if (!file) { alert('That file can’t be read any more: choose the folder again.'); return; }
          close({ file });
        } else {
          const i = Number(mineSel.value), e = mine[i];
          if (!e || !mineOk[i]) return;
          const ch = await choiceOf(e, stockSt);
          if (ch) close(ch);
        }
      });
    });
  }

  // The sting library as a panel over the page (sting-library.js mount); resolves when it's closed
  function openLibrary() {
    style();
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'ask sting-libwrap';
      wrap.innerHTML = '<div class="ask-box sting-libbox"><div class="sting-libtop"><b>Sting library</b><span class="sting-note">Clips: just the part of a track you want, with fades, kept on this computer.</span><button class="sting-libdone">Done</button></div><div class="sting-libbody"></div></div>';
      document.body.appendChild(wrap);
      const lib = StingLibrary.mount(wrap.querySelector('.sting-libbody'));
      const close = () => { lib.stop(); document.removeEventListener('keydown', onKey, true); wrap.remove(); resolve(); };
      function onKey(e) {
        if (document.querySelector('.sc-wrap')) return;            // the clip editor has the keys
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
        else if (e.key === 'PageDown' || e.key === 'PageUp') e.stopPropagation();
      }
      document.addEventListener('keydown', onKey, true);
      wrap.querySelector('.sting-libdone').addEventListener('click', close);
    });
  }

  return { open, setup, stock, clipFields, partFields, idOf, CLIP_KEYS, choiceOf, folder: () => folder, chooseFolder, savedFolder, ensureFolder, quietFolder, onFolder: fn => folderFns.add(fn), openLibrary };
})();
