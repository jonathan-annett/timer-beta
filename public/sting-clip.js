/*!
 * sting-clip.js
 * Clips of walk-up stings (a trial with the stings: TimerFeatures.stings): the part of a track to
 * play, with fades, without cutting the file. A sting (or a library entry) may carry
 *   start, end    seconds into the source (end missing = to its end)
 *   fadeIn, fadeOut   milliseconds
 * Shared by the timer (sting-player.js plays clips from memory), the run sheet editor (Trim…) and
 * the sting library page (stings.html).
 *
 * window.StingClip:
 *   region(s)          {start, end, fadeIn, fadeOut} if s is a clip, else null
 *   length(s, dur)     how long it plays (seconds), given the source's length if known
 *   decode(src)        a URL or Blob → AudioBuffer (the whole source)
 *   render(buf, s)     the clip as its own AudioBuffer, fades included
 *   play(buf)          plays an AudioBuffer → {stop(), ended: Promise, time()}
 *   preview(src, s)    decode, render and play (the stock dialog's ▶) → {stop()}
 *   open({src, name, region, media, original, hideOriginal})  the clip editor: waveform (whole track + zoomed on the
 *                      selection), start/end handles, fades, play → Promise<{name, start, end,
 *                      fadeIn, fadeOut, hideOriginal} | null>; original (a stock sting's name) adds the
 *                      choice to hide it from + sting while this clip exists (hideOriginal: a better edit)
 * MIT Licensed
 */
var StingClip = (function () {
  'use strict';

  let ctx = null;
  const audio = () => ctx || (ctx = new (window.AudioContext || window.webkitAudioContext)());
  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);

  function region(s) {
    if (!s) return null;
    const r = { start: num(s.start), end: num(s.end), fadeIn: num(s.fadeIn) || 0, fadeOut: num(s.fadeOut) || 0 };
    return r.start != null || r.end != null || r.fadeIn || r.fadeOut ? r : null;
  }
  function length(s, dur) {
    const r = region(s);
    if (!r) return dur != null ? dur : null;
    const end = r.end != null ? r.end : dur;
    return end != null ? Math.max(0, end - (r.start || 0)) : null;
  }

  async function decode(src) {
    const data = src instanceof Blob ? await src.arrayBuffer() : await (await fetch(src)).arrayBuffer();
    return await new Promise((res, rej) => { const p = audio().decodeAudioData(data, res, rej); if (p && p.then) p.then(res, rej); });
  }

  function render(buf, s) {
    const r = region(s) || { start: 0, end: null, fadeIn: 0, fadeOut: 0 };
    const sr = buf.sampleRate, a = Math.max(0, Math.min(buf.length, Math.round((r.start || 0) * sr)));
    const b = Math.max(a + 1, Math.min(buf.length, r.end != null ? Math.round(r.end * sr) : buf.length));
    const out = audio().createBuffer(buf.numberOfChannels, b - a, sr);
    const fi = Math.min(b - a, Math.round(r.fadeIn / 1000 * sr)), fo = Math.min(b - a, Math.round(r.fadeOut / 1000 * sr));
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const from = buf.getChannelData(c).subarray(a, b), to = out.getChannelData(c);
      to.set(from);
      for (let i = 0; i < fi; i++) to[i] *= i / fi;
      for (let i = 0; i < fo; i++) to[to.length - 1 - i] *= i / fo;
    }
    return out;
  }

  function play(buf) {
    const c = audio();
    if (c.state === 'suspended') c.resume().catch(() => {});
    const gain = c.createGain(), node = c.createBufferSource();
    node.buffer = buf; node.connect(gain); gain.connect(c.destination);
    let done;
    const ended = new Promise(r => { done = r; });
    node.onended = () => { try { node.disconnect(); gain.disconnect(); } catch (_) { /* gone */ } done(); };
    const t0 = c.currentTime;
    node.start();
    return {
      gain, ended, duration: buf.duration,
      time: () => Math.min(buf.duration, c.currentTime - t0),
      stop(at) { try { node.stop(at); } catch (_) { /* stopped */ } },
      fade(ms) {                                       // fades out from here, then stops
        const now = c.currentTime, end = now + ms / 1000;
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, end);
        try { node.stop(end); } catch (_) { /* stopped */ }
      },
    };
  }

  function preview(src, s) {
    let v = null, stopped = false;
    decode(src).then(buf => { if (!stopped) v = play(render(buf, s)); }).catch(() => {
      if (stopped) return;
      const el = new Audio(src instanceof Blob ? URL.createObjectURL(src) : src);   // (a server that won't let it be decoded: the whole track)
      el.play().catch(() => {});
      v = { stop: () => el.pause() };
    });
    return { stop() { stopped = true; if (v) v.stop(); } };
  }

  // ─── The clip editor ──────────────────────────────────────────────────────
  const CSS = `
.sc-wrap { position: fixed; inset: 0; z-index: 2147482000; background: rgba(0,0,0,.65); display: flex; align-items: center; justify-content: center; }
.sc-box { width: min(60rem, 94vw); background: #151515; border: 1px solid #333; border-radius: 0.6rem; padding: 1rem 1.2rem; color: #ddd;
  font: 0.95rem/1.4 "Helvetica Neue", Arial, sans-serif; box-shadow: 0 0.6rem 2rem rgba(0,0,0,.6); }
.sc-head { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.6rem; }
.sc-head b { color: #fff; font-size: 1.05rem; }
.sc-head .sc-src { color: #888; font-size: 0.85rem; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-box canvas { display: block; width: 100%; background: #0a0a0a; border: 1px solid #2a2a2a; border-radius: 0.3rem; cursor: crosshair; }
.sc-over { height: 4.2rem; margin-bottom: 0.4rem; }
.sc-zoom { height: 8rem; }
.sc-box canvas.sc-grab { cursor: ew-resize; }
.sc-row input.sc-ms::-webkit-inner-spin-button { opacity: 1; }
.sc-hint { color: #777; font-size: 0.8rem; margin: 0.3rem 0 0.6rem; }
.sc-row { display: flex; flex-wrap: wrap; gap: 0.6rem 1.2rem; align-items: center; margin: 0.5rem 0; }
.sc-row label { color: #aaa; display: inline-flex; gap: 0.4rem; align-items: center; }
.sc-row input { font: inherit; width: 6.5rem; padding: 0.25rem 0.4rem; background: #1a1a1a; color: #eee; border: 1px solid #333; border-radius: 0.3rem; font-variant-numeric: tabular-nums; }
.sc-row input.sc-ms { width: 4.5rem; }
.sc-row input.sc-name { width: 18rem; }
.sc-row input.sc-on { border-color: #4aa8ff; }
.sc-row input[type=checkbox] { width: auto; }
.sc-len { color: #fff; font-variant-numeric: tabular-nums; }
.sc-box button { font: inherit; color: #ddd; background: #222; border: 1px solid #444; border-radius: 0.35rem; padding: 0.35rem 0.8rem; cursor: pointer; }
.sc-box button:hover { background: #2c2c2c; }
.sc-box button.sc-primary { background: #0b3d5c; border-color: #2a6a9a; color: #fff; }
.sc-btns { display: flex; gap: 0.6rem; justify-content: flex-end; margin-top: 0.8rem; }
.sc-btns .sc-grow { flex: 1; }
.sc-msg { color: #e0b030; min-height: 1.2em; }`;

  const fmt = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
  const parse = text => {
    const p = String(text || '').trim().split(':');
    if (!p.length || p.length > 3 || p.some(x => x === '' || !isFinite(Number(x)))) return null;
    return p.reduce((a, x) => a * 60 + Number(x), 0);
  };

  function open(opts) {
    return new Promise(resolve => {
      if (!document.getElementById('sc-css')) { const st = document.createElement('style'); st.id = 'sc-css'; st.textContent = CSS; document.head.appendChild(st); }
      const wrap = document.createElement('div');
      wrap.className = 'sc-wrap';
      wrap.innerHTML = `<div class="sc-box" role="dialog" aria-modal="true">
        <div class="sc-head"><b>Choose the part to play</b><span class="sc-src"></span></div>
        <canvas class="sc-over" title="The whole track: drag across it to choose a part, or drag a start/end line"></canvas>
        <canvas class="sc-zoom" title="Close up: drag the start or end line"></canvas>
        <div class="sc-hint">Drag across the whole track to choose a part; drag a white line (the pointer becomes ↔) to move that edge. ← → move the selected edge (Shift: 1 s, Alt: 0.01 s); ↑ ↓ in a time or fade box step it · Space plays · Enter saves · Esc cancels</div>
        <div class="sc-row">
          <label>Start <input class="sc-t" data-k="start" spellcheck="false" title="↑ ↓: 0.01 s (Shift: 0.1 s)"></label>
          <label>End <input class="sc-t" data-k="end" spellcheck="false" title="↑ ↓: 0.01 s (Shift: 0.1 s)"></label>
          <span>Plays for <span class="sc-len"></span></span>
          <label>Fade in <input class="sc-ms" data-k="fadeIn" type="number" min="0" step="10" title="↑ ↓ or the arrows: 10 ms (Shift: 100 ms)"> ms</label>
          <label>Fade out <input class="sc-ms" data-k="fadeOut" type="number" min="0" step="10" title="↑ ↓ or the arrows: 10 ms (Shift: 100 ms)"> ms</label>
        </div>
        <div class="sc-row">
          <button class="sc-play">▶ Play the part</button><button class="sc-first" title="Its first 2 seconds, with the fade in">▶ First 2 s</button><button class="sc-last" title="The 2 seconds before the fade out begins, then the fade (or just the last 2 seconds)">▶ Last 2 s</button><button class="sc-lead" title="From 2 seconds before the start: hear the lead-in">▶ From 2 s before</button><button class="sc-stop">■</button>
          <label>Name <input class="sc-name" spellcheck="false"></label>
        </div>
        <div class="sc-row sc-hide" hidden><label><input type="checkbox" class="sc-hideorig"> Hide “<span class="sc-orig"></span>” from + sting: use this clip instead</label></div>
        <div class="sc-msg"></div>
        <div class="sc-btns"><button class="sc-whole">Whole track</button><span class="sc-grow"></span><button class="sc-cancel">Cancel</button><button class="sc-save sc-primary">Save</button></div>
      </div>`;
      document.body.appendChild(wrap);
      const $ = sel => wrap.querySelector(sel);
      const over = $('.sc-over'), zoom = $('.sc-zoom'), msg = t => { $('.sc-msg').textContent = t || ''; };
      $('.sc-src').textContent = opts.name || '';
      $('.sc-name').value = opts.name || '';
      if (opts.original) { $('.sc-hide').hidden = false; $('.sc-orig').textContent = opts.original; $('.sc-hideorig').checked = opts.hideOriginal !== false; }
      let buf = null, peaks = null, voice = null, playFrom = 0, playT0 = 0, active = 'start', raf = 0, hover = null;
      const r0 = region(opts.region) || {};
      const sel = { start: r0.start || 0, end: r0.end, fadeIn: r0.fadeIn || 0, fadeOut: r0.fadeOut || 0 };

      const dur = () => (buf ? buf.duration : 0);
      const endOf = () => (sel.end != null ? sel.end : dur());
      function clamp() {
        const d = dur();
        sel.start = Math.max(0, Math.min(sel.start, d - 0.05));
        if (sel.end != null) sel.end = Math.max(sel.start + 0.05, Math.min(sel.end, d));
        sel.start = Math.round(sel.start * 100) / 100;
        if (sel.end != null) sel.end = Math.round(sel.end * 100) / 100;
        sel.fadeIn = Math.max(0, Math.round(sel.fadeIn)); sel.fadeOut = Math.max(0, Math.round(sel.fadeOut));
      }
      function fields() {
        wrap.querySelectorAll('input[data-k]').forEach(i => {
          if (document.activeElement === i) return;
          const k = i.dataset.k;
          i.value = k === 'start' ? fmt(sel.start) : k === 'end' ? fmt(endOf()) : String(sel[k] || 0);
          i.classList.toggle('sc-on', k === active);
        });
        $('.sc-len').textContent = (endOf() - sel.start).toFixed(2) + ' s';
      }

      // Waveform: the loudest sample per column (channels mixed)
      function columnPeaks(from, to, cols) {
        const sr = buf.sampleRate, a = Math.floor(from * sr), b = Math.ceil(to * sr), n = Math.max(1, (b - a) / cols), out = new Float32Array(cols);
        const chans = []; for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
        for (let x = 0; x < cols; x++) {
          let m = 0;
          const s0 = Math.floor(a + x * n), s1 = Math.min(buf.length, Math.floor(a + (x + 1) * n)), step = Math.max(1, Math.floor((s1 - s0) / 400));
          for (const ch of chans) for (let i = s0; i < s1; i += step) { const v = Math.abs(ch[i] || 0); if (v > m) m = v; }
          out[x] = m;
        }
        return out;
      }
      function sizeCanvas(cv) {
        const w = Math.max(10, Math.round(cv.clientWidth * devicePixelRatio)), h = Math.max(10, Math.round(cv.clientHeight * devicePixelRatio));
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; return true; }
        return false;
      }
      function drawWave(cv, p, from, to) {
        const g = cv.getContext('2d'), W = cv.width, H = cv.height, mid = H / 2, x = t => (t - from) / (to - from) * W;
        g.clearRect(0, 0, W, H);
        g.fillStyle = 'rgba(74,168,255,0.16)';
        g.fillRect(x(sel.start), 0, x(endOf()) - x(sel.start), H);
        g.fillStyle = '#5a7a96';
        for (let i = 0; i < p.length; i++) { const t = from + (i + 0.5) / p.length * (to - from), inside = t >= sel.start && t <= endOf(); g.fillStyle = inside ? '#7fc0ff' : '#3c4a58'; const h = Math.max(1, p[i] * (H - 4)); g.fillRect(i * W / p.length, mid - h / 2, Math.max(1, W / p.length), h); }
        // fades as ramps over the selection
        g.strokeStyle = 'rgba(255,204,51,0.8)'; g.lineWidth = devicePixelRatio;
        g.beginPath();
        g.moveTo(x(sel.start), H); g.lineTo(x(sel.start + sel.fadeIn / 1000), 2); g.lineTo(x(endOf() - sel.fadeOut / 1000), 2); g.lineTo(x(endOf()), H);
        g.stroke();
        g.fillStyle = '#fff';
        for (const k of ['start', 'end']) { const t = k === 'start' ? sel.start : endOf(), w = (k === hover ? 5 : k === active ? 3 : 2) * devicePixelRatio; g.fillRect(x(t) - w / 2, 0, w, H); }
        if (voice) { const t = playFrom + voice.time(); g.fillStyle = '#ffcc33'; g.fillRect(x(t), 0, 2 * devicePixelRatio, H); }
      }
      const zoomRange = () => { const len = endOf() - sel.start, pad = Math.max(0.5, len * 0.25); return [Math.max(0, sel.start - pad), Math.min(dur(), endOf() + pad)]; };
      function draw() {
        if (!buf) return;
        if (sizeCanvas(over) || !peaks) peaks = columnPeaks(0, dur(), over.width);
        sizeCanvas(zoom);
        drawWave(over, peaks, 0, dur());
        const [a, b] = zoomRange();
        drawWave(zoom, columnPeaks(a, b, Math.min(zoom.width, 1600)), a, b);
        fields();
      }
      const redraw = () => { clamp(); draw(); };

      // Pointer: drag across the whole track = a new selection; close up, drag the nearer edge
      const timeAt = (cv, e, from, to) => { const r = cv.getBoundingClientRect(); return from + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (to - from); };
      const GRAB = 7;                                // css px either side of a line
      function nearEdge(cv, e, from, to) {
        const r = cv.getBoundingClientRect(), px = t => r.left + (t - from) / (to - from) * r.width;
        const ds = Math.abs(e.clientX - px(sel.start)), de = Math.abs(e.clientX - px(endOf()));
        return Math.min(ds, de) > GRAB ? null : ds <= de ? 'start' : 'end';
      }
      function dragEdge(cv, e, k, range) {
        active = k;
        const move = ev => { const [a, b] = range(), t = timeAt(cv, ev, a, b); if (k === 'start') sel.start = t; else sel.end = t; redraw(); };
        const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); };
        cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
        draw();
      }
      for (const [cv, range] of [[over, () => [0, dur()]], [zoom, zoomRange]]) {
        cv.addEventListener('pointermove', e => {
          if (!buf || e.buttons) return;
          const [a, b] = range(), h = nearEdge(cv, e, a, b);
          cv.classList.toggle('sc-grab', !!h);
          if (h !== hover) { hover = h; draw(); }
        });
        cv.addEventListener('pointerleave', () => { cv.classList.remove('sc-grab'); if (hover) { hover = null; draw(); } });
      }
      over.addEventListener('pointerdown', e => {
        if (!buf) return;
        over.setPointerCapture(e.pointerId);
        const k = nearEdge(over, e, 0, dur());
        if (k) return dragEdge(over, e, k, () => [0, dur()]);
        const t0 = timeAt(over, e, 0, dur());
        const move = ev => { const t = timeAt(over, ev, 0, dur()); sel.start = Math.min(t0, t); sel.end = Math.max(t0, t, Math.min(t0, t) + 0.05); active = t < t0 ? 'start' : 'end'; redraw(); };
        const up = () => { over.removeEventListener('pointermove', move); over.removeEventListener('pointerup', up); };
        over.addEventListener('pointermove', move); over.addEventListener('pointerup', up);
      });
      zoom.addEventListener('pointerdown', e => {
        if (!buf) return;
        zoom.setPointerCapture(e.pointerId);
        const [a, b] = zoomRange(), t = timeAt(zoom, e, a, b);
        const k = nearEdge(zoom, e, a, b);
        if (k) return dragEdge(zoom, e, k, () => [a, b]);   // (the view holds still while dragging)
        active = Math.abs(t - sel.start) <= Math.abs(t - endOf()) ? 'start' : 'end';
        const move = ev => { const tt = timeAt(zoom, ev, a, b); if (active === 'start') sel.start = tt; else sel.end = tt; redraw(); };
        move(e);
        const up = () => { zoom.removeEventListener('pointermove', move); zoom.removeEventListener('pointerup', up); };
        zoom.addEventListener('pointermove', move); zoom.addEventListener('pointerup', up);
      });
      wrap.querySelectorAll('input[data-k]').forEach(i => {
        i.addEventListener('focus', () => { if (i.dataset.k === 'start' || i.dataset.k === 'end') { active = i.dataset.k; draw(); } });
        i.addEventListener('change', () => {
          const k = i.dataset.k;
          if (k === 'start' || k === 'end') { const t = parse(i.value); if (t == null) { msg('Type a time as m:ss.ss (e.g. 1:02.50) or seconds.'); fields(); return; } sel[k] = t; }
          else sel[k] = Math.max(0, Number(i.value) || 0);
          msg(''); redraw();
        });
        if (i.type === 'number') i.addEventListener('input', () => { sel[i.dataset.k] = Math.max(0, Number(i.value) || 0); clamp(); draw(); });
      });

      function stopPlay() { if (voice) { voice.stop(); voice = null; } cancelAnimationFrame(raf); draw(); }
      function playPart(how) {
        stopPlay();
        if (!buf) return;
        const end = endOf(), outAt = Math.max(sel.start, end - sel.fadeOut / 1000);
        const piece = how === 'lead' ? { start: Math.max(0, sel.start - 2), end, fadeIn: 0, fadeOut: sel.fadeOut }
          : how === 'first' ? { start: sel.start, end: Math.min(end, sel.start + 2), fadeIn: sel.fadeIn, fadeOut: 0 }
          : how === 'last' ? { start: Math.max(sel.start, outAt - 2), end, fadeIn: 0, fadeOut: sel.fadeOut }   // 2 s before the fade out begins, then the fade
          : sel;
        playFrom = piece.start;
        playing = { from: piece.start, to: piece.end };
        const v = voice = play(render(buf, piece));
        v.ended.then(() => { if (voice === v) { voice = null; draw(); } });
        const tick = () => { if (voice !== v) return; draw(); raf = requestAnimationFrame(tick); };
        tick();
      }
      let playing = null;                            // (tests: what's playing, from–to)
      wrap.__playing = () => (voice ? playing : null);
      $('.sc-play').addEventListener('click', () => playPart());
      $('.sc-first').addEventListener('click', () => playPart('first'));
      $('.sc-last').addEventListener('click', () => playPart('last'));
      $('.sc-lead').addEventListener('click', () => playPart('lead'));
      $('.sc-stop').addEventListener('click', stopPlay);
      $('.sc-whole').addEventListener('click', () => { sel.start = 0; sel.end = null; sel.fadeIn = sel.fadeOut = 0; redraw(); });

      function finish(result) {
        stopPlay();
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', draw);
        wrap.remove();
        resolve(result);
      }
      function save() {
        if (!buf) return finish(null);
        clamp();
        const whole = sel.start <= 0 && sel.end == null && !sel.fadeIn && !sel.fadeOut;
        finish({ name: $('.sc-name').value.trim().slice(0, 200) || opts.name || 'Sting',
          start: whole ? null : sel.start, end: whole ? null : endOf(), fadeIn: sel.fadeIn || null, fadeOut: sel.fadeOut || null, sourceLength: dur(),
          hideOriginal: opts.original ? $('.sc-hideorig').checked : undefined });
      }
      $('.sc-cancel').addEventListener('click', () => finish(null));
      $('.sc-save').addEventListener('click', save);
      // Keys stay in here (the run sheet editor's Space is Next; the timer's keys are everywhere)
      function onKey(e) {
        if (e.metaKey) return;
        const typing = e.target.closest && e.target.closest('input');
        e.stopImmediatePropagation();
        if (e.key === 'Escape') { e.preventDefault(); finish(null); return; }
        if (e.key === 'Enter') { if (typing) e.target.dispatchEvent(new Event('change')); e.preventDefault(); save(); return; }
        if (typing && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.dataset.k) {
          e.preventDefault();
          const k = e.target.dataset.k, dir = e.key === 'ArrowUp' ? 1 : -1;
          if (k === 'start' || k === 'end') { const t = (k === 'start' ? sel.start : endOf()) + dir * (e.shiftKey ? 0.1 : 0.01); if (k === 'start') sel.start = t; else sel.end = t; active = k; }
          else sel[k] = Math.max(0, (sel[k] || 0) + dir * (e.shiftKey ? 100 : 10));
          clamp(); e.target.value = k === 'start' ? fmt(sel.start) : k === 'end' ? fmt(endOf()) : String(sel[k]); draw();
          return;
        }
        if (typing) return;
        if (e.key === ' ') { e.preventDefault(); if (voice) stopPlay(); else playPart(); return; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const step = (e.shiftKey ? 1 : e.altKey ? 0.01 : 0.1) * (e.key === 'ArrowLeft' ? -1 : 1);
          if (active === 'start') sel.start += step; else sel.end = endOf() + step;
          redraw();
        }
      }
      document.addEventListener('keydown', onKey, true);
      ['keyup', 'keypress'].forEach(t => wrap.addEventListener(t, e => e.stopPropagation()));
      window.addEventListener('resize', draw);

      msg('Reading the track…');
      decode(opts.src).then(b => {
        buf = b;
        if (sel.end == null && !r0.start) sel.end = null;
        msg('');
        redraw();
        $('.sc-save').focus();
      }).catch(() => {
        msg('This track can’t be opened here (its server doesn’t allow it, or the browser can’t read the file). Use a file from your computer instead.');
        $('.sc-save').disabled = true;
      });
    });
  }

  return { region, length, decode, render, play, preview, open };
})();
if (typeof module !== 'undefined') module.exports = StingClip;
