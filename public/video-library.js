/*!
 * video-library.js
 * The timer's video panel (the "video" button): open the player window, browse for a video,
 * and Recent videos, a list of the videos played (dropped, browsed for, links, run sheet) that
 * can be cued again, even after a reload or another day.
 *
 * How a file is kept, so it can be reopened:
 *   handle  Chrome/Edge: a handle to the file on disk (FileSystemFileHandle, from a drop or the
 *           file picker). No copy; the browser asks once per session to allow reading it again.
 *           If the file has been moved or deleted, it can't be reopened.
 *   copy    other browsers: a copy in the browser's storage (IndexedDB), while there's room
 *           (COPY_LIMIT in all; the oldest copies go first).
 *   none    neither (too big, no room): listed, but browse for it again to play it.
 * Links are kept as the link. Run sheet videos are already in the browser (rsvideo: keys);
 * the run sheet editor keeps them while they're listed here.
 *
 * localStorage video_history: [{id, kind: 'file'|'link'|'runsheet', name, size, duration, url,
 *   key, stored: 'handle'|'copy'|'none'|'runsheet', lastPlayed, plays}], newest first.
 * IndexedDB (video-store.js): vhist:<id> → the handle or the copy.
 *
 * window.videoLibrary: played(history, name, duration) → entry id (called by dropPlayer.js),
 *   list(), recall(id), remove(id), clear(), browse(), toggle()
 * MIT Licensed
 */

(function () {
  'use strict';

  const KEY = 'video_history';
  const MAX = 30;                                  // entries
  const COPY_LIMIT = 8 * 1024 * 1024 * 1024;       // bytes of copies in all (fallback only)
  const vp = () => window.videoPlayer;
  const store = () => window.videoStore;
  const now = () => (window.timeProvider ? timeProvider.now() : Date.now());

  // ─── The list ─────────────────────────────────────────────────────────────

  function list() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v.filter(e => e && e.id && e.name) : [];
    } catch (_) { return []; }
  }
  function save(entries) {
    try { localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX))); } catch (_) { /* ignore */ }
    render();
  }
  const newId = () => now().toString(36) + Math.random().toString(36).slice(2, 7);

  function sameVideo(e, h, name) {
    if (h.kind === 'link') return e.kind === 'link' && e.url === h.url;
    if (h.kind === 'runsheet') return e.kind === 'runsheet' && e.key === h.key;
    if (h.kind === 'file') return e.kind === 'file' && e.name === name && e.size === h.file.size;
    return false;
  }

  // A video has started playing. Returns its entry's id (dropPlayer then plays it again as that entry).
  function played(h, name, duration) {
    if (!h) return null;
    const entries = list();
    let e = h.kind === 'recall' ? entries.find(x => x.id === h.id) : entries.find(x => sameVideo(x, h, name));
    const fresh = !e;
    if (fresh) {
      if (h.kind === 'recall') return null;    // removed from the list meanwhile
      e = { id: newId(), kind: h.kind, name, plays: 0 };
      if (h.kind === 'link') { e.url = h.url; e.stored = 'link'; }
      if (h.kind === 'runsheet') { e.key = h.key; e.size = h.size || null; e.stored = 'runsheet'; }
      if (h.kind === 'file') { e.size = h.file.size; e.key = 'vhist:' + e.id; e.stored = 'pending'; }
    }
    e.plays = (e.plays || 0) + 1;
    e.lastPlayed = now();
    if (isFinite(duration) && duration > 0) e.duration = Math.round(duration);
    // A file dropped again gets its new handle (the old one may have been for a moved file)
    if (h.kind === 'file' && (fresh || h.handle || e.stored === 'none')) keep(e, h);
    save([e].concat(entries.filter(x => x.id !== e.id)));
    prune();
    return e.id;
  }

  function setStored(id, stored) {
    const entries = list();
    const e = entries.find(x => x.id === id);
    if (e && e.stored !== stored) { e.stored = stored; save(entries); }
  }

  // Keep a handle to the file, or else a copy of it
  async function keep(e, h) {
    const id = e.id, key = e.key;
    let handle = null;
    try { handle = h.handle ? await h.handle : null; } catch (_) { handle = null; }
    if (handle && handle.kind !== 'file') handle = null;
    if (handle && store()) {
      try { await store().put(key, handle); return setStored(id, 'handle'); } catch (_) { /* fall through to a copy */ }
    }
    if (!store()) return setStored(id, 'none');
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (est.quota && (est.usage || 0) + h.file.size > est.quota * 0.8) return setStored(id, 'none');
      }
      makeRoomForCopy(h.file.size, id);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      await store().put(key, h.file);
      setStored(id, 'copy');
    } catch (_) { setStored(id, 'none'); }
  }

  // Copies (fallback) are capped: the oldest copies are dropped (still listed, not kept)
  function makeRoomForCopy(size, exceptId) {
    const entries = list();
    let total = size;
    let changed = false;
    for (const e of entries) {
      if (e.stored !== 'copy' || e.id === exceptId) continue;
      if (total + (e.size || 0) > COPY_LIMIT) {
        store().remove(e.key).catch(() => {});
        e.stored = 'none'; changed = true;
      } else total += e.size || 0;
    }
    if (changed) save(entries);
  }

  // Entries past MAX lose what was kept for them
  function prune() {
    const entries = list();
    if (entries.length <= MAX) return;
    entries.slice(MAX).forEach(forget);
    save(entries.slice(0, MAX));
  }

  function sheetKeys() {
    try {
      const sh = JSON.parse(localStorage.getItem('runsheet') || 'null');
      return new Set(((sh && sh.items) || []).filter(it => it.video).map(it => it.video.key));
    } catch (_) { return new Set(); }
  }
  function forget(e) {
    if (!store() || !e.key) return;
    if (e.kind === 'file') store().remove(e.key).catch(() => {});
    // A run sheet video that's no longer on the sheet was only kept for this list
    else if (e.kind === 'runsheet' && !sheetKeys().has(e.key)) store().remove(e.key).catch(() => {});
  }

  function remove(id) {
    const entries = list();
    const e = entries.find(x => x.id === id);
    if (!e) return;
    forget(e);
    save(entries.filter(x => x.id !== id));
  }
  function clear() {
    list().forEach(forget);
    save([]);
  }

  // ─── Cue a listed video again ─────────────────────────────────────────────
  // Called from a click: the player window and the file permission both need one.

  async function recall(id) {
    const p = vp();
    const e = list().find(x => x.id === id);
    if (!p || !e) return false;
    if (!p.isOpen() && !p.open()) { p.toast('Allow pop-up windows for this site to play videos.'); return false; }
    const opts = { name: e.name, controls: true, history: { kind: 'recall', id: e.id } };
    if (e.kind === 'link') return p.load(e.url, opts);
    const fail = text => { p.toast(text); return false; };
    if (!store()) return fail('This browser can’t keep videos.');
    let data = null;
    try { data = await store().get(e.key); } catch (_) { data = null; }
    if (!data) {
      if (e.kind === 'runsheet') return fail(`"${e.name}" is no longer in this browser. Add it to the run sheet again, or browse for it.`);
      return fail(`"${e.name}" wasn't kept in this browser. Browse for it (or drop it on the timer) to play it again.`);
    }
    let file = data;
    if (typeof data.getFile === 'function') {             // a handle to the file on disk
      try {
        let perm = data.queryPermission ? await data.queryPermission({ mode: 'read' }) : 'granted';
        if (perm !== 'granted' && data.requestPermission) perm = await data.requestPermission({ mode: 'read' });
        if (perm !== 'granted') return fail(`Allow the browser to read "${e.name}" to play it again.`);
        file = await data.getFile();
      } catch (_) {
        return fail(`"${e.name}" can't be opened. It may have been moved, renamed or deleted; browse for it again.`);
      }
    }
    return p.load(URL.createObjectURL(file), Object.assign(opts, { revoke: true }));
  }

  // ─── Browse ───────────────────────────────────────────────────────────────

  const ACCEPT = { 'video/*': ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ogv', '.avi', '.mpg', '.mpeg'] };
  let input = null;
  function browse() {
    const p = vp();
    if (!p) return;
    // Open the player now, during the click (the picker's answer comes too late for a pop-up)
    if (!p.isOpen() && !p.open()) { p.toast('Allow pop-up windows for this site to play videos.'); return; }
    if (window.showOpenFilePicker) {
      window.showOpenFilePicker({ types: [{ description: 'Videos', accept: ACCEPT }], excludeAcceptAllOption: false, id: 'timer-video' })
        .then(async ([h]) => { if (h) p.loadFile(await h.getFile(), h); })
        .catch(err => { if (err && err.name !== 'AbortError') p.toast('Couldn’t open that file.'); });
      return;
    }
    if (!input) {
      input = document.createElement('input');
      input.type = 'file'; input.accept = 'video/*'; input.hidden = true;
      input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; if (f) p.loadFile(f, null); });
      document.body.appendChild(input);
    }
    input.click();
  }

  // ─── Panel ────────────────────────────────────────────────────────────────

  const CSS = `
#video-panel { position: fixed; top: calc(var(--buttons-bottom, 48px) + 8px); right: 16px; width: 340px; z-index: 2147481000;
  max-height: calc(100vh - var(--buttons-bottom, 48px) - 16px); overflow-y: auto; box-sizing: border-box;
  background: #111; border: 1px solid #333; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,.6);
  color: #ddd; font: 13px/1.4 "Helvetica Neue", Arial, sans-serif; padding: 10px 12px 12px; cursor: auto; text-align: left; }
#video-panel[hidden] { display: none; }
#video-panel .vp-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; color: #fff; }
#video-panel .vp-close { margin-left: auto; background: none; border: 0; color: #888; font-size: 15px; cursor: pointer; padding: 0 2px; flex: none; }
#video-panel .vp-status { font-size: 12px; color: #888; margin-bottom: 8px; }
#video-panel .vp-status[data-on="1"] { color: #7fdc7f; }
#video-panel .vp-row { display: flex; gap: 6px; margin: 6px 0; }
#video-panel button { flex: 1; padding: 6px 4px; font: 12px "Helvetica Neue", Arial, sans-serif; background: #222; border: 1px solid #444; color: #ccc; border-radius: 4px; cursor: pointer; }
#video-panel button:hover { background: #333; color: #fff; }
#video-panel .vp-browse { background: #0e2a3a; border-color: #2a5a7a; color: #9fd8ff; }
#video-panel .vp-hint { font-size: 11px; color: #666; }
#video-panel .vp-sub { margin: 12px 0 4px; color: #aaa; font-size: 12px; display: flex; align-items: baseline; }
#video-panel .vp-sub button { flex: none; margin-left: auto; padding: 2px 6px; font-size: 11px; background: none; border-color: #333; color: #888; }
#video-panel .vp-list { list-style: none; margin: 0; padding: 0; }
#video-panel .vp-item { display: flex; align-items: center; gap: 6px; padding: 5px 0; border-top: 1px solid #222; }
#video-panel .vp-item.cued .vp-name { color: #9cf59c; }
#video-panel .vp-item.lost .vp-name { color: #888; }
#video-panel .vp-text { flex: 1; min-width: 0; }
#video-panel .vp-name { color: #eee; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#video-panel .vp-meta { font-size: 11px; color: #777; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#video-panel .vp-item button { flex: none; padding: 4px 8px; }
#video-panel .vp-item .vp-cue { background: #0e3a12; border-color: #2a6a2a; color: #9cf59c; }
#video-panel .vp-item .vp-del { background: none; border-color: transparent; color: #666; padding: 4px; }
#video-panel .vp-item .vp-del:hover { color: #ff9a9a; }
#video-panel .vp-empty { color: #666; font-size: 12px; padding: 4px 0; }
html.reduced #video-panel { display: none; }`;

  let panel = null;
  function panelEl() {
    if (panel) return panel;
    const st = document.createElement('style');
    st.id = 'video-panel-css';
    st.textContent = CSS;
    document.head.appendChild(st);
    panel = document.createElement('div');
    panel.id = 'video-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="vp-head"><b>Video</b><button class="vp-close" title="Close">✕</button></div>
      <div class="vp-status"></div>
      <div class="vp-row"><button class="vp-win"></button></div>
      <div class="vp-row"><button class="vp-browse">Browse for a video…</button></div>
      <div class="vp-hint">or drop a video file (or a link to one) on the timer</div>
      <div class="vp-sub">Recent videos<button class="vp-clear" title="Clear the list">Clear</button></div>
      <ul class="vp-list"></ul>`;
    document.body.appendChild(panel);
    panel.querySelector('.vp-close').addEventListener('click', () => { panel.hidden = true; });
    panel.querySelector('.vp-browse').addEventListener('click', browse);
    panel.querySelector('.vp-win').addEventListener('click', () => {
      const p = vp();
      if (!p) return;
      if (!p.isOpen() && !p.open()) p.toast('Allow pop-up windows for this site to open the video player.');
      else focusPlayer();
      render();
    });
    panel.querySelector('.vp-clear').addEventListener('click', () => {
      if (!list().length) return;
      clear();
    });
    panel.querySelector('.vp-list').addEventListener('click', e => {
      const b = e.target.closest('button');
      const li = e.target.closest('li[data-id]');
      if (!b || !li) return;
      if (b.classList.contains('vp-cue')) recall(li.dataset.id);
      if (b.classList.contains('vp-del')) remove(li.dataset.id);
    });
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); panel.hidden = true; } });
    // Only one panel at a time under the button bar (the phone panel listens too)
    document.addEventListener('timer-panel', e => { if (e.detail !== 'video') panel.hidden = true; });
    return panel;
  }

  function focusPlayer() {
    try { const w = window.open('', 'video_player_window'); if (w) w.focus(); } catch (_) { /* ignore */ }
  }

  const fmtDur = s => {
    if (!isFinite(s) || s <= 0) return '';
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const p2 = n => String(n).padStart(2, '0');
    return h ? `${h}:${p2(m)}:${p2(x)}` : `${m}:${p2(x)}`;
  };
  const fmtSize = b => !b ? '' : b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(b / 1e6)) + ' MB';
  function fmtWhen(t) {
    if (!t) return '';
    const d = new Date(t), today = new Date(now());
    const p2 = n => String(n).padStart(2, '0');
    const time = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    if (d.toDateString() === today.toDateString()) return time;
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + time;
  }
  const SOURCE = { file: 'file', link: 'link', runsheet: 'run sheet' };

  function render() {
    if (!panel || panel.hidden) return;
    const p = vp();
    const open = !!(p && p.isOpen());
    const st = p ? p.state() : { status: 'empty' };
    const status = panel.querySelector('.vp-status');
    status.dataset.on = open ? '1' : '0';
    status.textContent = !open ? 'The player window is closed.'
      : st.status === 'playing' ? 'Playing: ' + st.name
      : st.status === 'cued' ? 'Cued: ' + st.name + ' (▶ to play)'
      : 'Player window open. Drag it to the video screen; F for full screen.';
    panel.querySelector('.vp-win').textContent = open ? 'Show the player window' : 'Open the player window';
    const entries = list();
    panel.querySelector('.vp-clear').hidden = !entries.length;
    const ul = panel.querySelector('.vp-list');
    ul.textContent = '';
    if (!entries.length) {
      const li = document.createElement('li');
      li.className = 'vp-empty';
      li.textContent = 'Videos you play are listed here, to play again later.';
      ul.appendChild(li);
      return;
    }
    const cuedName = st.cued ? st.cued.name : null;
    for (const e of entries) {
      const li = document.createElement('li');
      li.className = 'vp-item';
      li.dataset.id = e.id;
      const lost = e.stored === 'none';
      if (lost) li.classList.add('lost');
      if (cuedName === e.name && st.status === 'cued') li.classList.add('cued');
      const meta = [SOURCE[e.kind] || '', fmtDur(e.duration), fmtSize(e.size),
        'played ' + fmtWhen(e.lastPlayed) + (e.plays > 1 ? ` (${e.plays}×)` : ''),
        lost ? 'not kept' : ''].filter(Boolean).join(' · ');
      li.innerHTML = `<div class="vp-text"><div class="vp-name"></div><div class="vp-meta"></div></div>
        <button class="vp-cue" title="Cue it in the player (then ▶ to play)">Cue</button>
        <button class="vp-del" title="Remove from the list">✕</button>`;
      li.querySelector('.vp-name').textContent = e.name;
      li.querySelector('.vp-name').title = e.name + (e.url ? '\n' + e.url : '');
      li.querySelector('.vp-meta').textContent = meta;
      if (lost) li.querySelector('.vp-meta').title = 'Not kept in this browser: browse for it (or drop it) to play it again';
      ul.appendChild(li);
    }
  }

  function toggle() {
    const el = panelEl();
    el.hidden = !el.hidden;
    if (!el.hidden) {
      document.dispatchEvent(new CustomEvent('timer-panel', { detail: 'video' }));
      render();
    }
  }

  // The "video" button: opens the player window (needs the click) and the panel
  function init() {
    const b = document.getElementById('btnvideo');
    if (b) b.addEventListener('click', () => {
      const p = vp();
      if (p && !p.isOpen() && !p.open()) p.toast('Allow pop-up windows for this site to open the video player.');
      toggle();
    });
    if (vp()) vp().onChange(render);
    window.addEventListener('storage', e => { if (e.key === KEY) render(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.videoLibrary = { played, list, recall, remove, clear, browse, toggle };
})();
