/*!
 * dropPlayer.js
 * Video playback in a separate player window (drag it to another screen and press F for full
 * screen). Drop a video file (or a link to one) on the timer to load it. While a video plays,
 * the timer counts down its length and shows "Video: <name>" as the message.
 *
 * window.videoPlayer is the one way to drive it (on-screen controls, and later the run sheet
 * and the Stream Deck):
 *   load(url, {name, idle, controls, message, revoke})  cue a video (not playing)
 *   play()      start from the cued position; the timer counts down the video's length
 *   stop()      stop and unload; clears the message and the timer
 *   rewind()    back to the start, cued (paused), ready to play again
 *   setIdle('show'|'hide')  before playing, show the first frame or keep the window black
 *   state()     {status: 'empty'|'cued'|'playing', name, idle, duration}
 *   onChange(fn)
 *
 * Ad hoc (dropped) videos get controls on the timer screen: ▶ play, ■ stop, ⟲ rewind and the
 * "Before play" toggle.
 *
 * localStorage: video_idle ('show' | 'hide'), the "Before play" setting for dropped videos.
 * MIT Licensed
 */

/* global processTimerApiMessage */

(function () {
  'use strict';

  const IDLE_KEY = 'video_idle';
  const api = msg => { if (typeof processTimerApiMessage === 'function') processTimerApiMessage(msg); };

  let win = null;            // the player window
  let video = null;          // its <video>
  let current = null;        // {url, name, idle, controls, message, revoke}
  let status = 'empty';      // 'empty' | 'cued' | 'playing'
  const listeners = [];
  const notify = () => { listeners.forEach(fn => { try { fn(state()); } catch (_) { /* ignore */ } }); renderControls(); };

  function state() {
    return {
      status,
      name: current ? current.name : '',
      idle: current ? current.idle : storedIdle(),
      duration: video && isFinite(video.duration) ? video.duration : null,
    };
  }
  function storedIdle() { try { return localStorage.getItem(IDLE_KEY) === 'hide' ? 'hide' : 'show'; } catch (_) { return 'show'; } }

  // Names are shown without the file extension ("Video: Keynote intro", not "…intro.mp4")
  const noExt = n => String(n || '').replace(/\.[A-Za-z0-9]{1,5}$/, '') || String(n || '');

  // A readable name from a URL (last path segment, without the query)
  function nameFromUrl(url) {
    try {
      const u = new URL(url, location.href);
      const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
      return noExt(last) || u.hostname || 'video';
    } catch (_) { return 'video'; }
  }

  // ─── Player window ────────────────────────────────────────────────────────

  function playerHtml() {
    return `<html><head><title>Video player</title><style>
      :root { --color-main-background: black; }
      html, body { margin: 0; background: var(--color-main-background); overflow: hidden; user-select: none; }
      body.fullscreen { cursor: none; }
      ::backdrop { background: var(--color-main-background); }
      video { position: absolute; left: 0; top: 0; width: 100vw; height: 100vh; object-fit: contain; background: black; }
      #hint { position: absolute; bottom: 10px; width: 100%; text-align: center; color: #555;
        font: 16px "Helvetica Neue", Arial, sans-serif; }
      body.fullscreen #hint { display: none; }
    </style></head><body>
      <video playsinline></video>
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
        function forward(type, e) {
          // (this page is about:blank, whose location has no origin: address the timer's)
          if (window.opener) window.opener.postMessage({ type: 'video-player-key', event: type,
            value: { key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey } }, window.opener.location.origin);
        }
        document.addEventListener('keydown', function (e) {
          if (e.metaKey) return;                       // leave Cmd shortcuts to the browser
          if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.shiftKey) {
            e.preventDefault();
            toggleFull();
            return;
          }
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

  // Opens (or finds) the player window. Needs a user action (a click, key or drop) the first time.
  function ensureWindow() {
    if (win && !win.closed && video) return true;
    win = window.open('', 'video_player_window', 'location=0');
    if (!win) return false;
    // Always (re)write the player: a window left open from before a reload of this page would
    // still be sending its keys to the old page.
    {
      win.document.open();
      win.document.write(playerHtml());
      win.document.close();
      video = win.document.querySelector('video');
    }
    win.addEventListener('beforeunload', () => {
      win = null; video = null;
      if (status !== 'empty') { status = 'empty'; release(); current = null; notify(); }
    });
    return !!video;
  }

  // Keys pressed in the player window act on the timer as if pressed here
  window.addEventListener('message', e => {
    if (!win || e.source !== win || !e.data || e.data.type !== 'video-player-key') return;
    document.dispatchEvent(new KeyboardEvent(e.data.event, e.data.value));
  });

  // ─── Actions ──────────────────────────────────────────────────────────────

  function release() {
    if (current && current.revoke && current.url.startsWith('blob:')) URL.revokeObjectURL(current.url);
  }

  function applyIdle() {
    if (video && status !== 'playing') video.style.opacity = current && current.idle === 'hide' ? '0' : '1';
  }

  function load(url, opts) {
    opts = opts || {};
    if (!ensureWindow()) { alert('Allow pop-up windows for this site to play videos.'); return false; }
    if (current && current.url !== url) release();
    current = {
      url,
      name: opts.name || nameFromUrl(url),
      idle: opts.idle === 'hide' || opts.idle === 'show' ? opts.idle : storedIdle(),
      controls: opts.controls !== false,
      message: opts.message,                // the message while playing; default "Video: <name>"
      revoke: !!opts.revoke,
    };
    status = 'cued';
    video.onended = onEnded;
    video.pause();
    video.src = url;
    video.currentTime = 0;
    applyIdle();
    notify();
    return true;
  }

  // The timer counts whole seconds (a 4.003 s clip would otherwise show 0:05 when cued)
  const wholeSeconds = sec => Math.max(1, Math.floor(sec + 0.25)) * 1000;
  const playingMessage = () => current.message || ('Video: ' + current.name);

  function whenReady(fn) {
    if (video.readyState >= 1 && isFinite(video.duration)) return fn();
    video.addEventListener('loadedmetadata', fn, { once: true });
  }

  function play() {
    if (!current || !video || status === 'playing') return false;
    status = 'playing';
    video.style.opacity = '1';
    whenReady(() => {
      const remaining = Math.max(0, video.duration - video.currentTime);
      api({ cmd: 'start', msecs: wholeSeconds(remaining) });
      api({ cmd: 'custommessage', text: playingMessage() });
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
    });
    notify();
    return true;
  }

  function clearTimer() {
    api({ cmd: 'custommessage', text: '' });
    api({ cmd: 'start', msecs: 0 });
    api({ cmd: 'pause' });
  }

  function stop() {
    if (!current) return false;
    if (video) { video.pause(); video.removeAttribute('src'); video.load(); video.style.opacity = '0'; }
    release();
    current = null;
    status = 'empty';
    clearTimer();
    notify();
    return true;
  }

  // Back to the start, cued and paused: the timer shows the video's full length, ready to go
  function rewind() {
    if (!current || !video) return false;
    video.pause();
    video.currentTime = 0;
    status = 'cued';
    applyIdle();
    whenReady(() => {
      api({ cmd: 'start', msecs: wholeSeconds(video.duration) });
      api({ cmd: 'custommessage', text: playingMessage() });
      // Pause a moment later: paused at exactly N.000 s the timer would read N+1
      setTimeout(() => { if (status === 'cued') api({ cmd: 'pause' }); }, 60);
    });
    notify();
    return true;
  }

  function onEnded() {
    // Played to the end: unload, and clear the message and the timer (as Stop does)
    stop();
  }

  function setIdle(idle) {
    idle = idle === 'hide' ? 'hide' : 'show';
    if (current) current.idle = idle;
    if (!current || current.controls) { try { localStorage.setItem(IDLE_KEY, idle); } catch (_) { /* ignore */ } }
    applyIdle();
    notify();
  }

  // A drop: video files load as a blob URL (released when replaced or stopped), links as is
  function loadDrop(dataTransfer) {
    const file = Array.from(dataTransfer.files || []).find(f => f.type.startsWith('video/'));
    if (file) return load(URL.createObjectURL(file), { name: noExt(file.name), revoke: true, controls: true });
    const url = dataTransfer.getData('URL') || dataTransfer.getData('text/uri-list');
    if (url) return load(url.split('\n')[0].trim(), { controls: true });
    return false;
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
html.reduced #video-controls { display: none; }`;

  let bar = null;
  function controlsEl() {
    if (bar) return bar;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
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
    bar.querySelector('.vc-stop').addEventListener('click', stop);
    bar.querySelector('.vc-idle').addEventListener('click', () => setIdle(state().idle === 'hide' ? 'show' : 'hide'));
    // Clicking these mustn't also trigger the timer's own click handling
    bar.addEventListener('mousedown', e => e.stopPropagation());
    return bar;
  }

  function renderControls() {
    const show = !!current && current.controls && status !== 'empty';
    if (!show && !bar) return;
    const el = controlsEl();
    el.hidden = !show;
    if (!show) return;
    el.querySelector('.vc-name').textContent = 'Video: ' + current.name;
    el.querySelector('.vc-name').title = current.name;
    el.querySelector('.vc-play').hidden = status !== 'cued';
    el.querySelector('.vc-rewind').hidden = status !== 'playing';
    el.querySelector('.vc-idle').hidden = status !== 'cued';
    el.querySelector('.vc-idle').textContent = 'Before play: ' + (current.idle === 'hide' ? 'black' : 'first frame');
  }

  window.videoPlayer = { load, loadDrop, play, stop, rewind, setIdle, state, onChange: fn => listeners.push(fn) };

  // ─── Blob storage (IndexedDB), for keeping video files ────────────────────

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('blobDB', 1);
      request.onerror = () => reject('Failed to open database');
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = event => { event.target.result.createObjectStore('blobs', { keyPath: 'key' }); };
    });
  }
  async function storeBlob(key, blob) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(['blobs'], 'readwrite').objectStore('blobs').put({ key, data: blob });
      request.onsuccess = () => resolve();
      request.onerror = () => reject('Failed to store blob');
    });
  }
  async function retrieveBlob(key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(['blobs'], 'readonly').objectStore('blobs').get(key);
      request.onsuccess = () => resolve(request.result ? request.result.data : null);
      request.onerror = () => reject('Failed to retrieve blob');
    });
  }
  window.videoStore = { storeBlob, retrieveBlob };
})();
