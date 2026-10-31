/*!
 * assist-video.js
 * The assist station's eyes (assist.html): frames from a camera, a capture card (a vision mixer's
 * programme feed) or a shared screen, taken densely and then thinned once the transcript says
 * which matter.
 *
 *   AssistVideo.create({onKeep(frame)})
 *     start(source)        a camera's deviceId, '' (the default camera) or 'screen' (asks to share
 *                          a screen or window: needs the click)
 *     stop()
 *     running, stream      (the stream: for a live preview)
 *     want(ms)             keep the frame nearest that time (a gap's start or end)
 *     settle(horizon, protect)
 *                          frames before horizon (ms) that nobody wanted are dropped; the one
 *                          nearest protect (the last line's end: a gap may start there) stays
 *
 * Frames: FPS a second, WIDTH px wide JPEGs (a name caption on a wide shot stays readable), held
 * only until the transcript has caught up with them (seconds, normally), so memory stays small.
 * Kept: one every GRID_MS (speech or not: who was speaking, what was on screen), and those wanted
 * (the station asks for both ends of every gap of more than 2 s between words). Each kept frame
 * goes to onKeep({id, at, blob, why}) once.
 *
 * Grabbed with ImageCapture.grabFrame() where there is one (straight from the camera's track,
 * whether the page is showing or not), else drawn from a <video>; ticked by a small worker, since
 * a hidden page's own timers slow to once a second or less.
 * MIT Licensed
 */

/* exported AssistVideo */

var AssistVideo = (function () {
  'use strict';
  const FPS = 4, WIDTH = 640, QUALITY = 0.7, GRID_MS = 10000, NEAR_MS = 1500, MAX_HELD = 2400;   // 10 minutes behind at most

  function ticker(ms, fn) {
    try {
      const w = new Worker(URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms})`], { type: 'text/javascript' })));
      w.onmessage = fn;
      return () => w.terminate();
    } catch (_) {
      const t = setInterval(fn, ms);
      return () => clearInterval(t);
    }
  }

  function create(opts) {
    let stream = null, video = null, grabber = null, stopTick = null, busy = false, canvas = null;
    let held = [];                       // {id, at, blob, keep, why} oldest first
    let gridSlot = null, seq = 0;

    function keep(f, why) {
      if (f.keep) return;
      f.keep = true; f.why = why;
      if (opts.onKeep) opts.onKeep({ id: f.id, at: f.at, blob: f.blob, why });
    }
    async function grab() {
      if (busy || !stream) return;
      busy = true;
      try {
        const at = Date.now();
        let src = null;
        if (grabber) { try { src = await grabber.grabFrame(); } catch (_) { src = null; } }
        if (!src && video && video.readyState >= 2) src = video;
        if (!src) return;
        const w = src.width || src.videoWidth, h = src.height || src.videoHeight;
        if (!w || !h) return;
        if (!canvas) canvas = document.createElement('canvas');
        canvas.width = Math.min(WIDTH, w); canvas.height = Math.round((canvas.width * h) / w);
        canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
        if (src.close) src.close();
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', QUALITY));
        if (!blob || !stream) return;
        const f = { id: at * 1000 + (seq++ % 1000), at, blob, keep: false };
        held.push(f);
        const slot = Math.floor(at / GRID_MS);
        if (slot !== gridSlot) { gridSlot = slot; keep(f, 'grid'); }
        while (held.length > MAX_HELD) held.shift();      // the transcript's far behind: the oldest go
      } finally { busy = false; }
    }

    const nearest = ms => {
      let best = null;
      for (const f of held) if (Math.abs(f.at - ms) <= NEAR_MS && (!best || Math.abs(f.at - ms) < Math.abs(best.at - ms))) best = f;
      return best;
    };

    return {
      get running() { return !!stream; },
      get stream() { return stream; },
      async start(source) {
        this.stop();
        stream = source === 'screen'
          ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false })
          : await navigator.mediaDevices.getUserMedia({ video: { deviceId: source ? { exact: source } : undefined, width: { ideal: 1280 }, frameRate: { ideal: 15 } }, audio: false });
        const track = stream.getVideoTracks()[0];
        track.addEventListener('ended', () => { if (opts.onEnded) opts.onEnded(); });
        if (typeof ImageCapture === 'function') try { grabber = new ImageCapture(track); } catch (_) { grabber = null; }
        video = document.createElement('video');
        video.muted = true; video.playsInline = true; video.srcObject = stream;
        video.play().catch(() => {});
        gridSlot = null;
        stopTick = ticker(Math.round(1000 / FPS), grab);
        return track.label || '';
      },
      stop() {
        if (stopTick) stopTick();
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = video = grabber = stopTick = null;
        held = [];                                       // nothing more to decide about
      },
      want(ms) { const f = nearest(ms); if (f) keep(f, 'gap'); },
      settle(horizon, protect) {
        const p = protect == null ? null : nearest(protect);
        held = held.filter(f => f.at >= horizon || f === p);   // kept ones went to onKeep already
      },
      heldCount: () => held.length,
    };
  }
  return { create, FPS, GRID_MS };
})();
