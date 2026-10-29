/*!
 * dropPlayer.js
 * Video playback in a separate player window (drag it to another screen and press F for full
 * screen). Drop a video file (or a link to one) on the timer to load it; run sheet items can
 * carry videos too (runsheet.js). While a video plays, the timer counts down its length and
 * shows a message ("Video: <name>", or the run sheet item's name).
 *
 * The player has two slots: the video PLAYING, and the video CUED (loaded, paused at the start,
 * ready to go). The run sheet cues the next item's video while the current item runs, so Next
 * starts it at once. A cued video shows its first frame or black ("before play") whenever
 * nothing is playing.
 *
 * window.videoPlayer is the one way to drive it (on-screen controls, run sheet, Stream Deck via
 * the videoplay / videostop / videorewind commands):
 *   open()      open the player window (needs a click or key press)
 *   isOpen()
 *   load(url, {name, idle, controls, message, revoke, tag, onEnd, history})   cue a video
 *   loadFile(file, handle)  cue a file the operator dropped or browsed for (handle: a
 *               FileSystemFileHandle or a promise of one, kept so the history can reopen it)
 *   play()      play the cued video; the timer counts down its length
 *   stop({quiet})  stop what's playing (or unload what's cued); unless quiet, clear the
 *               message and the timer
 *   rewind()    the playing video back to the start, cued, timer paused at its length
 *   unloadCued()  drop the cued video only
 *   setIdle('show'|'hide')  before play: first frame, or black
 *   state()     {status: 'empty'|'cued'|'playing', name, idle, duration, playing:{tag,name}, cued:{tag,name,idle}}
 *   onChange(fn)
 * onEnd: 'unload' (dropped videos: stop and clear) or 'recue' (run sheet: back to before-play,
 * timer 0:00, message kept; the operator presses Next when ready).
 *
 * history: what video-library.js needs to list the video once it has played
 * ({kind:'file', file, handle} | {kind:'link', url} | {kind:'runsheet', key} | {kind:'recall', id}).
 *
 * Publishes video_status ('empty'|'cued'|'playing') and video_name on the timerAPI bus.
 * localStorage: video_idle ('show' | 'hide'), the "Before play" setting for dropped videos.
 * MIT Licensed
 */

/* global processTimerApiMessage */

(function () {
  'use strict';

  const IDLE_KEY = 'video_idle';
  const api = msg => { if (typeof processTimerApiMessage === 'function') processTimerApiMessage(msg); };

  let win = null;                       // the player window
  let els = [];                         // its two <video> elements
  let playing = null, cued = null;      // slots: {el, url, name, idle, controls, message, revoke, tag, onEnd}
  const listeners = [];

  function storedIdle() { try { return localStorage.getItem(IDLE_KEY) === 'hide' ? 'hide' : 'show'; } catch (_) { return 'show'; } }

  // Names are shown without the file extension ("Video: Keynote intro", not "…intro.mp4")
  const noExt = n => String(n || '').replace(/\.[A-Za-z0-9]{1,5}$/, '') || String(n || '');
  function nameFromUrl(url) {
    try {
      const u = new URL(url, location.href);
      const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
      return noExt(last) || u.hostname || 'video';
    } catch (_) { return 'video'; }
  }

  function state() {
    const s = playing || cued;
    const el = s && s.el;
    return {
      status: playing ? 'playing' : cued ? 'cued' : 'empty',
      name: s ? s.name : '',
      idle: cued ? cued.idle : storedIdle(),
      duration: el && isFinite(el.duration) ? el.duration : null,
      playing: playing ? { tag: playing.tag || null, name: playing.name } : null,
      cued: cued ? { tag: cued.tag || null, name: cued.name, idle: cued.idle } : null,
    };
  }

  let lastBus = '';
  function notify() {
    const st = state();
    listeners.forEach(fn => { try { fn(st); } catch (_) { /* ignore */ } });
    renderControls();
    // On the bus, for the Stream Deck keys and anything else listening
    const bus = st.status + '|' + st.name;
    if (bus !== lastBus && window.timerAPI) {
      lastBus = bus;
      window.timerAPI.send({ setVariableValues: { video_status: st.status, video_name: st.name } });
    }
  }

  // ─── Player window ────────────────────────────────────────────────────────

  function playerHtml() {
    return `<html><head><title>${location.hostname || 'Timer'} - Video player</title><style>
      :root { --color-main-background: black; }
      html, body { margin: 0; background: var(--color-main-background); overflow: hidden; user-select: none; }
      body.fullscreen { cursor: none; }
      ::backdrop { background: var(--color-main-background); }
      video { position: absolute; left: 0; top: 0; width: 100vw; height: 100vh; object-fit: contain;
        background: black; opacity: 0; }
      #hint { position: absolute; bottom: 10px; width: 100%; text-align: center; color: #555; z-index: 10;
        font: 16px "Helvetica Neue", Arial, sans-serif; }
      body.fullscreen #hint { display: none; }
    </style></head><body>
      <video playsinline preload="auto"></video><video playsinline preload="auto"></video>
      <div id="hint">Drag this window to the screen it should play on and press F for full screen</div>
      <script>
        // Full screen without fsapi.js: an external script in a document written by the timer
        // can stall the parser, and then nothing below runs.
        function isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
        function toggleFull() {
          var el = document.documentElement;
          if (isFull()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
          else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        }
        ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (t) {
          document.addEventListener(t, function () { document.body.classList.toggle('fullscreen', isFull()); });
        });
        // F: full screen. Other keys go to the timer window, so its shortcuts work from here too.
        // (this page is about:blank, whose location has no origin: address the timer's)
        function forward(type, e) {
          if (window.opener) window.opener.postMessage({ type: 'video-player-key', event: type,
            value: { key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey } }, window.opener.location.origin);
        }
        document.addEventListener('keydown', function (e) {
          if (e.metaKey) return;                       // leave Cmd shortcuts to the browser
          if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); toggleFull(); return; }
          forward('keydown', e);
        });
        document.addEventListener('keyup', function (e) { if (!e.metaKey) forward('keyup', e); });
        // Dropping another video here loads it in the timer window's player
        ['dragenter', 'dragover', 'drop'].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); }); });
        document.addEventListener('drop', function (e) {
          if (window.opener && window.opener.videoPlayer) window.opener.videoPlayer.loadDrop(e.dataTransfer);
        });
      <\/script>
    </body></html>`;
  }

  const isOpen = () => !!(win && !win.closed && els.length);

  // Opens the player window. The browser only allows this during a click or key press.
  function open() {
    if (isOpen()) return true;
    win = window.open('', 'video_player_window', 'location=0');
    if (!win) return false;
    // Always (re)write the player: a window left open from before a reload of this page would
    // still be sending its keys to the old page.
    win.document.open();
    win.document.write(playerHtml());
    win.document.close();
    els = Array.from(win.document.querySelectorAll('video'));
    els.forEach(el => { el.addEventListener('ended', () => onEnded(el)); });
    playing = cued = null;
    win.addEventListener('beforeunload', () => {
      win = null; els = [];
      [playing, cued].forEach(release);
      playing = cued = null;
      notify();
    });
    notify();
    return true;
  }

  // Keys pressed in the player window act on the timer as if pressed here
  window.addEventListener('message', e => {
    if (!win || e.source !== win || !e.data || e.data.type !== 'video-player-key') return;
    document.dispatchEvent(new KeyboardEvent(e.data.event, e.data.value));
  });

  // ─── Slots ────────────────────────────────────────────────────────────────

  function release(slot) {
    if (!slot) return;
    if (slot.el) { slot.el.pause(); slot.el.removeAttribute('src'); slot.el.load(); slot.el.style.opacity = '0'; }
    if (slot.revoke && slot.url.startsWith('blob:')) URL.revokeObjectURL(slot.url);
  }

  // What the window shows: the playing video on top; otherwise the cued one (first frame or black)
  function arrange() {
    els.forEach(el => { el.style.zIndex = '1'; el.style.opacity = '0'; });
    if (playing) { playing.el.style.zIndex = '3'; playing.el.style.opacity = '1'; }
    else if (cued) { cued.el.style.zIndex = '2'; cued.el.style.opacity = cued.idle === 'hide' ? '0' : '1'; }
  }

  function load(url, opts) {
    opts = opts || {};
    if (!open()) { toast('Allow pop-up windows for this site to play videos (or click "video" first).'); return false; }
    if (cued) { release(cued); cued = null; }
    const el = els.find(x => !playing || x !== playing.el);
    cued = {
      el, url,
      name: opts.name || nameFromUrl(url),
      idle: opts.idle === 'hide' || opts.idle === 'show' ? opts.idle : storedIdle(),
      controls: opts.controls !== false,
      message: opts.message,
      revoke: !!opts.revoke,
      tag: opts.tag || null,
      onEnd: opts.onEnd === 'recue' ? 'recue' : 'unload',
      history: opts.history || null,
    };
    el.pause();
    el.src = url;
    el.currentTime = 0;
    arrange();
    notify();
    return true;
  }

  // The timer counts whole seconds (a 4.003 s clip would otherwise show 0:05 when cued)
  const wholeSeconds = sec => Math.max(1, Math.floor(sec + 0.25)) * 1000;
  const messageFor = s => s.message || ('Video: ' + s.name);
  function whenReady(el, fn) {
    if (el.readyState >= 1 && isFinite(el.duration)) return fn();
    el.addEventListener('loadedmetadata', fn, { once: true });
  }

  function play() {
    if (!cued || !isOpen()) return false;
    if (playing) { release(playing); playing = null; }
    playing = cued; cued = null;
    const s = playing;
    s.rewound = false;
    arrange();
    whenReady(s.el, () => {
      if (playing !== s) return;
      const remaining = Math.max(0, s.el.duration - s.el.currentTime);
      api({ cmd: 'start', msecs: wholeSeconds(remaining) });
      api({ cmd: 'custommessage', text: messageFor(s) });
      const p = s.el.play();
      // Recent videos (video-library.js): noted when it actually plays
      if (s.history && window.videoLibrary) {
        let id = null;
        try { id = window.videoLibrary.played(s.history, s.name, s.el.duration); } catch (_) { /* ignore */ }
        if (id) s.history = { kind: 'recall', id };   // played again after a rewind: the same entry
      }
      if (p && p.catch) p.catch(err => {
        if (err && err.name === 'NotAllowedError') {
          toast('The browser stopped the video playing with sound. Click once in the player window, then play again.');
          playing = null; cued = s; arrange(); notify();
        }
      });
    });
    notify();
    return true;
  }

  function clearTimer() {
    api({ cmd: 'custommessage', text: '' });
    api({ cmd: 'start', msecs: 0 });
    api({ cmd: 'pause' });
  }

  function stop(opts) {
    const quiet = opts && opts.quiet;
    if (playing) { release(playing); playing = null; }
    else if (cued) { release(cued); cued = null; }
    else return false;
    if (!quiet) clearTimer();
    arrange();
    notify();
    return true;
  }

  // Unload only the cued video (the run sheet's preload is no longer next); playing is untouched
  function unloadCued() {
    if (!cued) return false;
    release(cued); cued = null;
    arrange();
    notify();
    return true;
  }

  // The playing video back to the start, cued, with the timer paused at its length
  function rewind() {
    const s = playing;
    if (!s) return false;
    if (cued) { release(cued); cued = null; }
    s.el.pause();
    s.el.currentTime = 0;
    cued = s; playing = null;
    s.rewound = true;                       // on-screen ▶ for it, even from the run sheet
    arrange();
    whenReady(s.el, () => {
      api({ cmd: 'start', msecs: wholeSeconds(s.el.duration) });
      api({ cmd: 'custommessage', text: messageFor(s) });
      // Pause a moment later: paused at exactly N.000 s the timer would read N+1
      setTimeout(() => { if (cued === s) api({ cmd: 'pause' }); }, 60);
    });
    notify();
    return true;
  }

  function onEnded(el) {
    const s = playing;
    if (!s || s.el !== el) return;
    if (s.onEnd === 'recue') {
      // Run sheet: stay on the item. Back to before-play (unless the next video is already
      // cued, which then shows instead); the timer shows 0:00, the message stays.
      playing = null;
      if (cued) release(s);
      else { s.el.currentTime = 0; cued = s; s.rewound = true; }
      api({ cmd: 'start', msecs: 0 });
      api({ cmd: 'pause' });
      arrange();
      notify();
    } else {
      stop();                               // dropped video: unload, clear message and timer
    }
  }

  function setIdle(idle) {
    idle = idle === 'hide' ? 'hide' : 'show';
    if (cued) cued.idle = idle;
    if (!cued || cued.controls) { try { localStorage.setItem(IDLE_KEY, idle); } catch (_) { /* ignore */ } }
    arrange();
    notify();
  }

  // A drop: video files load as a blob URL (released when replaced or stopped), links as is
  function loadDrop(dataTransfer) {
    const items = Array.from(dataTransfer.items || []);
    const files = Array.from(dataTransfer.files || []);
    const i = files.findIndex(f => f.type.startsWith('video/'));
    if (i >= 0) {
      // Chrome/Edge: a handle to the file itself, so Recent videos can reopen it later without a
      // copy. It has to be asked for during the drop event.
      const fileItems = items.filter(it => it.kind === 'file');
      const item = fileItems[i];
      let handle = null;
      try { if (item && item.getAsFileSystemHandle) handle = item.getAsFileSystemHandle(); } catch (_) { handle = null; }
      return loadFile(files[i], handle);
    }
    const url = dataTransfer.getData('URL') || dataTransfer.getData('text/uri-list');
    if (url) {
      const u = url.split('\n')[0].trim();
      // blob: and data: links only last as long as the page that made them: not listed
      const keepable = /^https?:/i.test(u);
      return load(u, { controls: true, history: keepable ? { kind: 'link', url: u } : null });
    }
    return false;
  }

  // A file the operator dropped or browsed for: on-screen controls, and kept in Recent videos
  function loadFile(file, handle) {
    return load(URL.createObjectURL(file), {
      name: noExt(file.name), revoke: true, controls: true,
      history: { kind: 'file', file, handle: handle || null },
    });
  }

  // ─── Drag and drop onto the timer ─────────────────────────────────────────

  ['dragenter', 'dragover', 'drop'].forEach(t => document.addEventListener(t, e => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).some(x => x === 'Files' || x === 'text/uri-list')) e.preventDefault();
  }));
  document.addEventListener('drop', e => { if (e.dataTransfer) loadDrop(e.dataTransfer); });

  // ─── On-screen controls (dropped videos only) ─────────────────────────────

  const CSS = `
#video-controls { position: fixed; right: 10px; bottom: 40px; z-index: 9998; display: flex; align-items: center; gap: 6px;
  background: rgba(20,20,20,.92); border: 1px solid #333; border-radius: 8px; padding: 6px 8px;
  font: 13px "Helvetica Neue", Arial, sans-serif; color: #ddd; max-width: calc(100vw - 20px); }
#video-controls[hidden] { display: none; }
#video-controls .vc-name { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 4px; }
#video-controls button { font: inherit; color: #eee; background: #2a2a2a; border: 1px solid #444; border-radius: 5px;
  padding: 6px 10px; cursor: pointer; white-space: nowrap; }
#video-controls button:hover { background: #3a3a3a; }
#video-controls button[hidden] { display: none; }
#video-controls .vc-play { background: #0e3a12; border-color: #2a6a2a; color: #9cf59c; min-width: 44px; }
#video-controls .vc-stop { background: #3a0d0d; border-color: #6a2a2a; color: #ff9a9a; min-width: 44px; }
#video-controls .vc-idle { color: #aaa; }
#video-toast { position: fixed; left: 50%; bottom: 90px; transform: translateX(-50%); z-index: 10000; max-width: 80vw;
  background: #3a2a00; border: 1px solid #a07a20; color: #ffd27a; border-radius: 8px; padding: 10px 14px;
  font: 15px "Helvetica Neue", Arial, sans-serif; }
#video-toast[hidden] { display: none; }
html.reduced #video-controls, html.reduced #video-toast { display: none; }`;

  let bar = null, toastEl = null, toastTimer = null;
  function injectStyles() {
    if (document.getElementById('video-player-css')) return;
    const st = document.createElement('style');
    st.id = 'video-player-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  function toast(text) {
    injectStyles();
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'video-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 8000);
  }

  function controlsEl() {
    if (bar) return bar;
    injectStyles();
    bar = document.createElement('div');
    bar.id = 'video-controls';
    bar.hidden = true;
    bar.innerHTML = `<span class="vc-name"></span>
      <button class="vc-play" title="Play">▶</button>
      <button class="vc-rewind" title="Rewind to the start (cued, ready to play again)">⟲</button>
      <button class="vc-stop" title="Stop and unload the video">■</button>
      <button class="vc-idle" title="What the player window shows before the video plays"></button>`;
    document.body.appendChild(bar);
    bar.querySelector('.vc-play').addEventListener('click', play);
    bar.querySelector('.vc-rewind').addEventListener('click', rewind);
    bar.querySelector('.vc-stop').addEventListener('click', () => stop());
    bar.querySelector('.vc-idle').addEventListener('click', () => setIdle(cued && cued.idle === 'hide' ? 'show' : 'hide'));
    bar.addEventListener('mousedown', e => e.stopPropagation());   // not the timer's own click handling
    return bar;
  }

  // Dropped videos: all the controls. Run sheet videos: stop and rewind while one plays, and play
  // once it's been rewound or has ended; nothing for the next item's video waiting in the player
  // (Next plays that one, and ▶ or ■ here would act on it out of turn).
  function renderControls() {
    const s = playing || cued;
    const show = !!s && (s.controls || !!playing || !!s.rewound);
    if (!show && !bar) return;
    const el = controlsEl();
    el.hidden = !show;
    if (!show) return;
    el.querySelector('.vc-name').textContent = messageFor(s);
    el.querySelector('.vc-name').title = s.name;
    el.querySelector('.vc-play').hidden = !!playing;
    el.querySelector('.vc-rewind').hidden = !playing;
    el.querySelector('.vc-idle').hidden = !!playing || !s.controls;   // run sheet: set per item in the sheet
    el.querySelector('.vc-idle').textContent = 'Before play: ' + (cued && cued.idle === 'hide' ? 'black' : 'first frame');
  }

  // The "video" button (opens this window and the video panel) is in video-library.js

  window.videoPlayer = { open, isOpen, load, loadDrop, loadFile, noExt, play, stop, rewind, unloadCued, setIdle, state, toast, onChange: fn => listeners.push(fn) };
})();
