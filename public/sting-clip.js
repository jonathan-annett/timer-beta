/*!
 * sting-clip.js
 * Clips of walk-up stings (a trial with the stings: TimerFeatures.stings): the part of a track to
 * play, with fades, without cutting the file. A sting (or a library entry) may carry
 *   start, end    seconds into the source (end missing = to its end)
 *   fadeIn, fadeOut   milliseconds
 *   loop          {from, to, plays, at?}: a region (s into the source, anywhere in it) that plays
 *                 `plays` times where it is (plays − 1 copies straight after it), to make a short
 *                 sting longer; moved (at: s into the source), `plays` copies go in at `at` and the
 *                 region itself stays where it was (heard once, if it's inside the part). Built when
 *                 the clip is loaded into memory, so it has limits (LIMITS): the last play starts
 *                 within the first 90 s (it may end up to a loop later), the clip is 3 minutes at
 *                 most and the track 10 minutes. Anything longer: Save as WAV, a file of its own.
 * Shared by the timer (sting-player.js plays clips from memory), the run sheet editor (Trim…) and
 * the sting library page (stings.html).
 *
 * window.StingClip:
 *   region(s)          {start, end, fadeIn, fadeOut, loop?} if s is a clip, else null
 *   cleanLoop(l)       a valid loop {from, to, plays, at?} or null
 *   plan(s, dur)       {segs: [[from, to] …] (pieces of the source in playing order), loop: {inAt,
 *                      copies, len} | null, outside?} or null (the length isn't known)
 *   length(s, dur)     how long it plays (seconds), given the source's length if known
 *   loopCheck(s, dur)  {ok, why}: whether the timer can build it in memory (why: what's wrong, or a
 *                      note such as a loop outside the part)
 *   LIMITS             {loopMin, plays, lead, memory, download, source} (s, plays)
 *   decode(src)        a URL or Blob → AudioBuffer (the whole source)
 *   render(buf, s)     the clip as its own AudioBuffer, loop and fades included
 *   wav(buf)           an AudioBuffer → a 16-bit WAV Blob
 *   play(buf, {loop})  plays an AudioBuffer (loop: over and over until stopped) → {stop(), ended: Promise, time()}
 *   preview(src, s)    decode, render and play (the stock dialog's ▶) → {stop()}
 *   open({src, name, region, media, original, hideOriginal, saveLabel})  the clip editor: waveform (whole track + zoomed on the
 *                      selection), start/end handles, fades, a loop, loudness and trim, play (levelled), Save as WAV →
 *                      Promise<{name, start, end, fadeIn, fadeOut, loop, lufs, volume, hideOriginal} | null>;
 *   loudness(buf)      integrated loudness (LUFS, BS.1770) or null (silence)
 *   gainFor(s, target) what a sting with {lufs, volume} plays at: down to the target, never up
 *   target()           the show's level (Level this show…, localStorage SHOW_KEY) or the house level (TARGET_KEY, −23)
 *   toneBuffer(lufs)   a second of 1 kHz reading lufs: the line-up tone original (a stock sting's name) adds the
 *                      choice to hide it from + sting while this clip exists (hideOriginal: a better edit)
 * MIT Licensed
 */
var StingClip = (function () {
  'use strict';

  // A context per output (audio-out.js): the page's own, unless a role is given (a playout computer's
  // cues: 'show'; its previews and editing: the page's, 'preview')
  const ctxs = {};
  const audio = role => {
    const k = role || '';
    if (ctxs[k]) return ctxs[k];
    const ctx = ctxs[k] = new (window.AudioContext || window.webkitAudioContext)();
    if (window.AudioOut) AudioOut.attach(ctx, role);
    return ctx;
  };
  const outOk = role => !window.AudioOut || AudioOut.ok(role) || (AudioOut.warn(role), false);
  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
  const r2 = t => Math.round(t * 100) / 100;
  const clock = t => { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

  // A loop is built in memory as the clip loads: these keep it from taking gigabytes
  const LIMITS = {
    loopMin: 0.1,     // s: the shortest region that loops
    plays: 99,
    lead: 90,         // s: the last play starts by then (it may end up to a loop later)
    memory: 180,      // s: the whole clip, with a loop (sting-player.js plays clips up to this from memory)
    download: 600,    // s: Save as WAV
    source: 600,      // s: a track longer than this isn't decoded whole by the timer, so can't loop
  };
  const SEAM = 0.01;  // s: the crossfade where a copy joins (no click)

  function cleanLoop(l) {
    if (!l || typeof l !== 'object') return null;
    const from = num(l.from), to = num(l.to), plays = num(l.plays), at = num(l.at);
    if (from == null || to == null || from < 0 || to - from < LIMITS.loopMin - 1e-6 || to > 86400) return null;
    if (plays == null || plays !== Math.round(plays) || plays < 2 || plays > LIMITS.plays) return null;
    const o = { from, to, plays };
    if (at != null && at >= 0 && at <= 86400) o.at = at;
    return o;
  }
  function region(s) {
    if (!s) return null;
    const r = { start: num(s.start), end: num(s.end), fadeIn: num(s.fadeIn) || 0, fadeOut: num(s.fadeOut) || 0 }, lp = cleanLoop(s.loop);
    if (lp) r.loop = lp;
    return r.start != null || r.end != null || r.fadeIn || r.fadeOut || lp ? r : null;
  }
  function plan(s, dur) {
    const r = region(s), a = (r && r.start) || 0, b = r && r.end != null ? r.end : dur;
    if (b == null) return null;
    const lp = r && r.loop;
    if (!lp) return { segs: [[a, b]], loop: null };
    const moved = lp.at != null, at = moved ? lp.at : lp.to, copies = moved ? lp.plays : lp.plays - 1;
    if (at < a - 1e-6 || at > b + 1e-6) return { segs: [[a, b]], loop: null, outside: true };
    const segs = [];
    if (at > a) segs.push([a, at]);
    for (let i = 0; i < copies; i++) segs.push([lp.from, lp.to]);
    if (b > at) segs.push([at, b]);
    return { segs, loop: { inAt: Math.max(0, at - a), copies, len: lp.to - lp.from } };
  }
  function length(s, dur) {
    if (!region(s)) return dur != null ? dur : null;
    const p = plan(s, dur);
    return p ? p.segs.reduce((t, g) => t + Math.max(0, g[1] - g[0]), 0) : null;
  }
  function loopCheck(s, dur) {
    const p = plan(s, dur);
    if (!p || (!p.loop && !p.outside)) return { ok: true, why: '' };
    if (p.outside) return { ok: true, why: 'The loop goes in outside the part, so it isn’t heard: drag its ⟲ tab into the part, or Put back.' };
    const last = p.loop.inAt + (p.loop.copies - 1) * p.loop.len, len = length(s, dur);
    if (dur > LIMITS.source) return { ok: false, why: 'This track is over ' + clock(LIMITS.source) + ', too long for the timer to loop.' };
    if (last > LIMITS.lead + 1e-6) return { ok: false, why: 'Too long to keep as a clip: the last play would start at ' + clock(last) + ' (by ' + clock(LIMITS.lead) + ' at most).' };
    if (len > LIMITS.memory + 1e-6) return { ok: false, why: 'Too long to keep as a clip: ' + clock(len) + ' (' + clock(LIMITS.memory) + ' at most with a loop).' };
    return { ok: true, why: '' };
  }

  async function decode(src) {
    const data = src instanceof Blob ? await src.arrayBuffer() : await (await fetch(src)).arrayBuffer();
    return await new Promise((res, rej) => { const p = audio().decodeAudioData(data, res, rej); if (p && p.then) p.then(res, rej); });
  }

  function render(buf, s) {
    const r = region(s) || { fadeIn: 0, fadeOut: 0 }, sr = buf.sampleRate, n = buf.length;
    let segs = plan(s, buf.duration).segs.map(g => {
      const a = Math.max(0, Math.min(n, Math.round(g[0] * sr)));
      return [a, Math.max(a, Math.min(n, Math.round(g[1] * sr)))];
    }).filter(g => g[1] > g[0]);
    if (!segs.length) { const a = Math.max(0, Math.min(n - 1, Math.round((r.start || 0) * sr))); segs = [[a, a + 1]]; }
    const total = segs.reduce((t, g) => t + g[1] - g[0], 0), xf = Math.round(SEAM * sr);
    const out = audio().createBuffer(buf.numberOfChannels, total, sr);
    const fi = Math.min(total, Math.round(r.fadeIn / 1000 * sr)), fo = Math.min(total, Math.round(r.fadeOut / 1000 * sr));
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c), to = out.getChannelData(c);
      let o = 0;
      segs.forEach((g, i) => {
        to.set(src.subarray(g[0], g[1]), o);
        const prev = i ? segs[i - 1][1] : g[0];
        if (prev !== g[0]) {                         // a join: cross from what followed the last piece into this one
          const m = Math.min(xf, g[1] - g[0]);
          for (let j = 0; j < m; j++) { const w = j / m; to[o + j] = to[o + j] * w + (src[prev + j] || 0) * (1 - w); }
        }
        o += g[1] - g[0];
      });
      for (let i = 0; i < fi; i++) to[i] *= i / fi;
      for (let i = 0; i < fo; i++) to[to.length - 1 - i] *= i / fo;
    }
    return out;
  }

  // One pass of a region, ready to loop seamlessly: its start crossfaded from what follows its end,
  // as render() joins copies (the editor's Preview loop)
  function loopPass(buf, from, to) {
    const sr = buf.sampleRate, n = buf.length, a = Math.max(0, Math.min(n - 1, Math.round(from * sr))), b = Math.max(a + 1, Math.min(n, Math.round(to * sr)));
    const out = audio().createBuffer(buf.numberOfChannels, b - a, sr), xf = Math.min(Math.round(SEAM * sr), b - a);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c), o = out.getChannelData(c);
      o.set(src.subarray(a, b));
      for (let j = 0; j < xf; j++) { const w = j / xf; o[j] = o[j] * w + (src[b + j] || 0) * (1 - w); }
    }
    return out;
  }

  // ─── Loudness (ITU-R BS.1770-4 / EBU R128) and levelling ──────────────────
  // A clip (or whole track) carries lufs: its integrated loudness as it plays (part, loop and fades),
  // measured when it's saved or when the show is levelled, and volume: a trim by ear (0–1, default 1).
  // It plays at volume × the gain that brings it down to the target, never up: the show's level (the
  // quietest sting on the run sheet, from Level this show…) if there is one, else the house level
  // (default −23 LUFS). Turning down only, so no clipping, and streamed and video stings (whose
  // element volume stops at 1) level the same way. The line-up tone is a 1 kHz sine at the target.
  const LEVEL = { house: -23, min: -40, max: -6 };
  const TARGET_KEY = 'sting_target', SHOW_KEY = 'sting_show_level';
  function kWeighting(sr) {                      // BS.1770's two biquads, for any sample rate (as libebur128)
    let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    let K = Math.tan(Math.PI * f0 / sr);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Q + K * K;
    const pre = { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
    f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / sr);
    const d = 1 + K / Q + K * K;
    const rlb = { b: [1, -2, 1], a: [2 * (K * K - 1) / d, (1 - K / Q + K * K) / d] };
    return [pre, rlb];
  }
  // Integrated loudness in LUFS (gated: −70 absolute, −10 relative), or null for silence. Mono counts as
  // dual mono (it plays on both speakers); under 400 ms, the whole of it as one block.
  function loudness(buf) {
    const sr = buf.sampleRate, n = buf.length, C = buf.numberOfChannels;
    const W = C === 1 ? [2] : C === 6 ? [1, 1, 1, 0, 1.41, 1.41] : new Array(C).fill(1);
    const hop = Math.max(1, Math.round(sr / 10)), segs = Math.ceil(n / hop), sq = new Float64Array(segs);
    const [pre, rlb] = kWeighting(sr);
    for (let c = 0; c < C; c++) {
      if (!W[c]) continue;
      const x = buf.getChannelData(c);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;   // the two biquads' states
      for (let i = 0; i < n; i++) {
        const v = x[i];
        const y = pre.b[0] * v + pre.b[1] * x1 + pre.b[2] * x2 - pre.a[0] * y1 - pre.a[1] * y2;
        x2 = x1; x1 = v;
        const z = y - 2 * y1 + y2 - rlb.a[0] * z1 - rlb.a[1] * z2;
        y2 = y1; y1 = y; z2 = z1; z1 = z;
        sq[(i / hop) | 0] += W[c] * z * z;
      }
    }
    const L = p => -0.691 + 10 * Math.log10(p);
    const powers = [];
    if (n < 4 * hop) { let t = 0; for (let i = 0; i < segs; i++) t += sq[i]; powers.push(t / n); }
    else for (let j = 0; j + 4 <= Math.floor(n / hop); j++) powers.push((sq[j] + sq[j + 1] + sq[j + 2] + sq[j + 3]) / (4 * hop));
    const loud = powers.filter(p => p > 0 && L(p) > -70);
    if (!loud.length) return null;
    const rel = L(loud.reduce((a, p) => a + p, 0) / loud.length) - 10;
    const kept = loud.filter(p => L(p) > rel);
    return Math.round(L(kept.reduce((a, p) => a + p, 0) / kept.length) * 10) / 10;
  }
  const readLs = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const inRange = v => typeof v === 'number' && isFinite(v) && v >= LEVEL.min && v <= LEVEL.max;
  function houseLevel() { const v = Number(readLs(TARGET_KEY)); return readLs(TARGET_KEY) != null && inRange(v) ? v : LEVEL.house; }
  function showLevel() { try { const j = JSON.parse(readLs(SHOW_KEY) || 'null'); return j && inRange(j.lufs) ? j : null; } catch (_) { return null; } }
  function target() { const sh = showLevel(); return sh ? sh.lufs : houseLevel(); }
  const trim = s => { const v = num(s && s.volume); return v != null && v > 0 && v <= 1 ? v : 1; };
  // What a sting plays at: its trim, and down to the target when its loudness is known
  function gainFor(s, tgt) {
    const l = num(s && s.lufs), t = tgt === undefined ? target() : tgt;
    return trim(s) * (l != null && t != null ? Math.min(1, Math.pow(10, (t - l) / 20)) : 1);
  }
  // The line-up tone: a second of 1 kHz (whole cycles, so it loops cleanly) in both channels, scaled by
  // this meter so it reads exactly lufs
  function toneBuffer(lufs) {
    const sr = audio().sampleRate, b = audio().createBuffer(2, sr, sr), d = b.getChannelData(0);
    for (let i = 0; i < sr; i++) d[i] = Math.sin(2 * Math.PI * 1000 * i / sr);
    b.getChannelData(1).set(d);
    const a = Math.pow(10, (lufs - loudness(b)) / 20);
    for (let c = 0; c < 2; c++) { const x = b.getChannelData(c); for (let i = 0; i < sr; i++) x[i] *= a; }
    return b;
  }

  function wav(buf) {
    const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate, bytes = n * ch * 2;
    const v = new DataView(new ArrayBuffer(44 + bytes)), str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, bytes, true);
    const d = []; for (let c = 0; c < ch; c++) d.push(buf.getChannelData(c));
    for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) { const x = Math.max(-1, Math.min(1, d[c][i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    return new Blob([v], { type: 'audio/wav' });
  }

  function play(buf, opts) {
    const role = opts && opts.role, c = audio(role), loop = !!(opts && opts.loop);
    if (!outOk(role)) return { gain: c.createGain(), ended: Promise.resolve(), duration: buf.duration, refused: true, time: () => 0, stop() {}, fade() {} };   // (its output isn't there)
    if (c.state === 'suspended') c.resume().catch(() => {});
    const gain = c.createGain(), node = c.createBufferSource();
    node.buffer = buf; node.loop = loop; node.connect(gain); gain.connect(c.destination);
    let done;
    const ended = new Promise(r => { done = r; });
    node.onended = () => { try { node.disconnect(); gain.disconnect(); } catch (_) { /* gone */ } done(); };
    const t0 = c.currentTime;
    node.start();
    return {
      gain, ended, duration: buf.duration,
      time: () => (loop ? (c.currentTime - t0) % buf.duration : Math.min(buf.duration, c.currentTime - t0)),
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
    if (!outOk()) return { refused: true, stop() {} };
    let v = null, stopped = false;
    decode(src).then(buf => { if (!stopped) v = play(render(buf, s)); }).catch(() => {
      if (stopped) return;
      const el = new Audio(src instanceof Blob ? URL.createObjectURL(src) : src);   // (a server that won't let it be decoded: the whole track)
      (window.AudioOut ? AudioOut.media(el) : Promise.resolve()).then(() => { if (!stopped) el.play().catch(() => {}); });
      v = { stop: () => el.pause() };
    });
    return { stop() { stopped = true; if (v) v.stop(); } };
  }

  // ─── The clip editor ──────────────────────────────────────────────────────
  const CSS = `
.sc-wrap { position: fixed; inset: 0; z-index: 2147482000; background: rgba(0,0,0,.65); display: flex; overflow: auto; }
/* centred, but never taller than the window (a docked run sheet editor is short): it scrolls inside, the buttons stay at its foot */
.sc-box { margin: auto; max-height: calc(100vh - 1rem); overflow-y: auto; width: min(60rem, 94vw); box-sizing: border-box; background: #151515; border: 1px solid #333; border-radius: 0.6rem; padding: 1rem 1.2rem; color: #ddd;
  font: 0.95rem/1.4 "Helvetica Neue", Arial, sans-serif; box-shadow: 0 0.6rem 2rem rgba(0,0,0,.6); }
.sc-head { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.6rem; }
.sc-head b { color: #fff; font-size: 1.05rem; }
.sc-head .sc-src { color: #888; font-size: 0.85rem; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-box canvas { display: block; width: 100%; background: #0a0a0a; border: 1px solid #2a2a2a; border-radius: 0.3rem; cursor: crosshair; }
.sc-over { height: min(4.2rem, 9vh); margin-bottom: 0.4rem; }
.sc-zoom { height: min(8rem, 17vh); }
.sc-zcap { display: flex; gap: 0.6rem; align-items: center; color: #888; font-size: 0.8rem; margin: 0.1rem 0 0.2rem; min-height: 1.5rem; }
.sc-box .sc-zcap button { padding: 0.05rem 0.5rem; font-size: 0.8rem; }
.sc-box canvas.sc-grab { cursor: ew-resize; }
.sc-box canvas.sc-move { cursor: grab; }
.sc-row input.sc-ms::-webkit-inner-spin-button { opacity: 1; }
.sc-hint { color: #777; font-size: 0.8rem; margin: 0.3rem 0 0.6rem; }
.sc-row { display: flex; flex-wrap: wrap; gap: 0.6rem 1.2rem; align-items: center; margin: 0.5rem 0; }
.sc-row label { color: #aaa; display: inline-flex; gap: 0.4rem; align-items: center; }
.sc-row input { font: inherit; width: 6.5rem; padding: 0.25rem 0.4rem; background: #1a1a1a; color: #eee; border: 1px solid #333; border-radius: 0.3rem; font-variant-numeric: tabular-nums; }
.sc-row input.sc-ms { width: 4.5rem; }
.sc-row input.sc-name { width: 18rem; }
.sc-row input.sc-on { border-color: #4aa8ff; }
.sc-row input[type=checkbox] { width: auto; }
.sc-looprow { border-left: 3px solid #ff9a3c; padding-left: 0.6rem; }
.sc-looprow .sc-ltag { color: #ff9a3c; font-weight: bold; }
.sc-looprow input.sc-on { border-color: #ff9a3c; }
.sc-lnote { color: #c9a27a; font-size: 0.85rem; min-height: 1.2em; padding-left: 0.85rem; }
.sc-lnote .sc-lwarn { color: #e0b030; }
.sc-len { color: #fff; font-variant-numeric: tabular-nums; }
.sc-loud { color: #9fd8ff; font-variant-numeric: tabular-nums; }
.sc-box button { font: inherit; color: #ddd; background: #222; border: 1px solid #444; border-radius: 0.35rem; padding: 0.35rem 0.8rem; cursor: pointer; }
.sc-box button:hover { background: #2c2c2c; }
.sc-box button:disabled { opacity: .45; cursor: default; }
.sc-box button.sc-primary { background: #0b3d5c; border-color: #2a6a9a; color: #fff; }
.sc-btns { display: flex; gap: 0.6rem; justify-content: flex-end; margin: 0.8rem -1.2rem -1rem; padding: 0.6rem 1.2rem 1rem;
  position: sticky; bottom: -1rem; background: #151515; border-top: 1px solid #262626; }
@media (max-height: 640px) { .sc-hint { display: none; } .sc-box { padding-top: 0.6rem; } .sc-row { margin: 0.3rem 0; } }
.sc-btns .sc-grow { flex: 1; }
.sc-msg { color: #e0b030; min-height: 1.2em; }
.sc-box [hidden] { display: none !important; }`;

  const fmt = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
  const parse = text => {
    const p = String(text || '').trim().split(':');
    if (!p.length || p.length > 3 || p.some(x => x === '' || !isFinite(Number(x)))) return null;
    return p.reduce((a, x) => a * 60 + Number(x), 0);
  };
  // A window of an AudioBuffer (t0–t1 s) as its own buffer
  function slice(b, t0, t1) {
    const sr = b.sampleRate, a = Math.max(0, Math.min(b.length - 1, Math.round(t0 * sr))), z = Math.max(a + 1, Math.min(b.length, Math.round(t1 * sr)));
    const o = audio().createBuffer(b.numberOfChannels, z - a, sr);
    for (let c = 0; c < b.numberOfChannels; c++) o.getChannelData(c).set(b.getChannelData(c).subarray(a, z));
    return o;
  }
  // Where in the source a moment of the clip comes from (segs: plan().segs)
  function sourceAt(t, segs) {
    let acc = 0;
    for (const g of segs) { const l = g[1] - g[0]; if (t <= acc + l + 1e-9) return g[0] + Math.max(0, t - acc); acc += l; }
    return segs.length ? segs[segs.length - 1][1] : 0;
  }

  function open(opts) {
    return new Promise(resolve => {
      if (!document.getElementById('sc-css')) { const st = document.createElement('style'); st.id = 'sc-css'; st.textContent = CSS; document.head.appendChild(st); }
      const canLoop = opts.media !== 'video';         // loops and WAV files: audio only (a video would lose its picture)
      const wrap = document.createElement('div');
      wrap.className = 'sc-wrap';
      wrap.innerHTML = `<div class="sc-box" role="dialog" aria-modal="true">
        <div class="sc-head"><b>Choose the part to play</b><span class="sc-src"></span></div>
        <canvas class="sc-over" title="The whole track: drag across it to choose a part, or drag a start/end line${canLoop ? '; Shift+drag marks a loop' : ''}"></canvas>
        <div class="sc-zcap"><span class="sc-zlabel"></span><button class="sc-zall" hidden>Show the whole part</button></div>
        <canvas class="sc-zoom" title="Close up: drag the start or end line"></canvas>
        <div class="sc-hint">Drag across the whole track to choose a part; drag a white line (the pointer becomes ↔) to move that edge.${canLoop ? ' Shift+drag marks a loop (orange); drag its ⟲ tab to put the repeats somewhere else.' : ''} ← → move the selected edge (Shift: 1 s, Alt: 0.01 s); ↑ ↓ in a time or fade box step it · Space plays · Enter saves · Esc cancels</div>
        <div class="sc-row">
          <label>Start <input class="sc-t" data-k="start" spellcheck="false" title="↑ ↓: 0.01 s (Shift: 0.1 s)"></label>
          <label>End <input class="sc-t" data-k="end" spellcheck="false" title="↑ ↓: 0.01 s (Shift: 0.1 s)"></label>
          <span>Plays for <span class="sc-len"></span></span>
          <label>Fade in <input class="sc-ms" data-k="fadeIn" type="number" min="0" step="10" title="↑ ↓ or the arrows: 10 ms (Shift: 100 ms)"> ms</label>
          <label>Fade out <input class="sc-ms" data-k="fadeOut" type="number" min="0" step="10" title="↑ ↓ or the arrows: 10 ms (Shift: 100 ms)"> ms</label>
        </div>
        <div class="sc-row sc-levelrow">
          <span>Loudness <span class="sc-loud">…</span></span>
          <label>Trim <input class="sc-ms" data-k="trimdb" type="number" max="0" step="0.5" title="Turn it down by ear, in dB (↑ ↓ 0.5 dB, Shift 3 dB). It's levelled to the show anyway"> dB</label>
        </div>
        <div class="sc-row sc-looprow" hidden>
          <span class="sc-ltag">⟲ Loop</span>
          <label>From <input class="sc-t" data-k="lfrom" spellcheck="false" title="↑ ↓: 0.01 s (Shift: 0.1 s)"></label>
          <label>To <input class="sc-t" data-k="lto" spellcheck="false" title="↑ ↓: 0.01 s (Shift: 0.1 s)"></label>
          <label>Plays <input class="sc-ms" data-k="plays" type="number" min="2" max="${LIMITS.plays}" step="1" title="How many times it plays where it is (moved: how many copies go in)"></label>
          <label>Goes in at <input class="sc-t" data-k="at" spellcheck="false" placeholder="in place" title="Where the repeats go in: empty = straight after the loop (in place)"></label>
          <button class="sc-lback" title="The repeats go back straight after the loop">Put back</button>
          <button class="sc-lprev" title="Play the loop over and over, to hear it while you move its edges (it starts again when you let go of one)">▶ Preview loop</button>
          <button class="sc-lplay" title="From 2 s before the repeats to 2 s after them: hear the joins">▶ Around the loop</button>
          <button class="sc-lremove">Remove loop</button>
        </div>
        <div class="sc-lnote"></div>
        <div class="sc-row">
          <button class="sc-play">▶ Play the part</button><button class="sc-first" title="Its first 2 seconds, with the fade in">▶ First 2 s</button><button class="sc-last" title="The 2 seconds before the fade out begins, then the fade (or just the last 2 seconds)">▶ Last 2 s</button><button class="sc-lead" title="From 2 seconds before the start: hear the lead-in">▶ From 2 s before</button><button class="sc-stop">■</button>
          <label>Name <input class="sc-name" spellcheck="false"></label>
        </div>
        <div class="sc-row sc-hide" hidden><label><input type="checkbox" class="sc-hideorig"> Hide the whole “<span class="sc-orig"></span>” from + sting (its clips are offered instead)</label></div>
        <div class="sc-msg"></div>
        <div class="sc-btns"><button class="sc-whole">Whole track</button><button class="sc-addloop" title="Repeat part of the track to make the sting longer">⟲ Add a loop</button><button class="sc-wav" title="Make this edit a WAV file of its own (for edits too long to keep as a clip): add it as the sting’s file">⬇ Save as WAV</button><span class="sc-grow"></span><button class="sc-cancel">Cancel</button><button class="sc-save sc-primary">Save</button></div>
      </div>`;
      document.body.appendChild(wrap);
      const $ = sel => wrap.querySelector(sel);
      const over = $('.sc-over'), zoom = $('.sc-zoom'), msg = t => { $('.sc-msg').textContent = t || ''; };
      $('.sc-src').textContent = opts.name || '';
      $('.sc-name').value = opts.name || '';
      $('.sc-wav').hidden = !canLoop;
      if (opts.saveLabel) $('.sc-save').textContent = opts.saveLabel;   // (the + sting dialog's ✂: Save and use)
      if (opts.original) { $('.sc-hide').hidden = false; $('.sc-orig').textContent = opts.original; $('.sc-hideorig').checked = opts.hideOriginal !== false; }
      let buf = null, peaks = null, voice = null, playSegs = [], playOff = 0, active = 'start', raf = 0, hover = null;
      const r0 = region(opts.region) || {};
      const sel = { start: r0.start || 0, end: r0.end, fadeIn: r0.fadeIn || 0, fadeOut: r0.fadeOut || 0 };
      let loop = canLoop && r0.loop ? Object.assign({}, r0.loop) : null;
      let trimDb = Math.round(20 * Math.log10(trim(opts.region)) * 10) / 10;   // the trim by ear, dB (≤ 0)
      let lufs = null, lufsKey = '', lufsT = 0;      // the clip's loudness as it plays, for lufsKey

      const dur = () => (buf ? buf.duration : 0);
      const endOf = () => (sel.end != null ? sel.end : dur());
      const atOf = () => (loop.at != null ? loop.at : loop.to);
      const TIMES = ['start', 'end', 'lfrom', 'lto', 'at'], LOOPK = { lfrom: 1, lto: 1, at: 1, plays: 1 };
      const get = k => k === 'start' ? sel.start : k === 'end' ? endOf() : k === 'lfrom' ? loop.from : k === 'lto' ? loop.to : k === 'at' ? atOf() : k === 'plays' ? loop.plays : k === 'trimdb' ? trimDb : sel[k];
      function set(k, v) {
        if (k === 'start') sel.start = v; else if (k === 'end') sel.end = v;
        else if (k === 'lfrom') loop.from = v; else if (k === 'lto') loop.to = v; else if (k === 'at') loop.at = v; else if (k === 'plays') loop.plays = v;
        else if (k === 'trimdb') trimDb = Math.round(Math.max(-40, Math.min(0, v)) * 10) / 10;
        else sel[k] = v;
      }
      const cur = () => { const c = { start: sel.start, end: endOf(), fadeIn: sel.fadeIn, fadeOut: sel.fadeOut }; if (loop) c.loop = cleanLoop(loop); return c; };
      function clamp() {
        const d = dur();
        sel.start = Math.max(0, Math.min(sel.start, d - 0.05));
        if (sel.end != null) sel.end = Math.max(sel.start + 0.05, Math.min(sel.end, d));
        sel.start = r2(sel.start);
        if (sel.end != null) sel.end = r2(sel.end);
        sel.fadeIn = Math.max(0, Math.round(sel.fadeIn)); sel.fadeOut = Math.max(0, Math.round(sel.fadeOut));
        if (loop) {
          loop.from = r2(Math.max(0, Math.min(loop.from, d - LIMITS.loopMin)));
          loop.to = r2(Math.max(loop.from + LIMITS.loopMin, Math.min(loop.to, d)));
          loop.plays = Math.max(2, Math.min(LIMITS.plays, Math.round(loop.plays) || 2));
          if (loop.at != null) loop.at = r2(Math.max(0, Math.min(loop.at, d)));
        }
      }
      function fields() {
        wrap.querySelectorAll('input[data-k]').forEach(i => {
          const k = i.dataset.k;
          if (document.activeElement === i || (LOOPK[k] && !loop)) return;
          i.value = k === 'at' && loop.at == null ? '' : TIMES.includes(k) ? fmt(get(k)) : String(get(k) || 0);
          i.classList.toggle('sc-on', k === active);
        });
        $('.sc-looprow').hidden = !loop;
        $('.sc-addloop').hidden = !!loop || !canLoop;
        $('.sc-lback').disabled = !loop || loop.at == null;
        const c = cur(), len = length(c, dur()) || 0;
        $('.sc-len').textContent = len.toFixed(2) + ' s';
        const key = JSON.stringify(c);
        if (key !== lufsKey && !lufsT) lufsT = setTimeout(() => { lufsT = 0; measure(); fields(); }, 250);
        showLoud();
        const note = $('.sc-lnote');
        if (!loop) { note.textContent = ''; return; }
        const chk = loopCheck(c, dur()), l = loop.to - loop.from;
        note.textContent = loop.at == null ? 'Plays ' + loop.plays + ' times where it is (adds ' + ((loop.plays - 1) * l).toFixed(2) + ' s).'
          : loop.plays + ' copies (' + (loop.plays * l).toFixed(2) + ' s) go in at ' + fmt(loop.at) + '; the loop’s own place plays as it was.';
        if (chk.why) {
          const w = document.createElement('span');
          w.className = 'sc-lwarn';
          w.textContent = ' ' + chk.why + (chk.ok ? '' : len <= LIMITS.download ? ' Save as WAV makes it a file of its own, to use as the sting’s file.' : ' Even as a WAV file it’s too long (' + clock(LIMITS.download) + ' at most).');
          note.appendChild(w);
        }
      }

      // Loudness: measured on the clip as it plays (part, loop, fades), at most every 250 ms while it changes
      function measure() {
        const c = cur(), key = JSON.stringify(c);
        if (!buf || key === lufsKey) return lufs;
        lufsKey = key;
        try { lufs = loudness(render(buf, c)); } catch (_) { lufs = null; }
        return lufs;
      }
      const levelGain = () => gainFor({ lufs: measure(), volume: Math.pow(10, trimDb / 20) });
      function showLoud() {
        const el = $('.sc-loud');
        if (!buf) { el.textContent = '…'; return; }
        if (lufsKey !== JSON.stringify(cur())) return;                   // (being measured)
        if (lufs == null) { el.textContent = 'silent'; return; }
        const t = target(), sh = showLevel(), to = sh ? 'this show’s level' : 'the house level';
        const at = Math.min(lufs, t) + trimDb, dB = at - lufs;
        el.textContent = lufs.toFixed(1) + ' LUFS · ' + (lufs > t ? 'plays at ' + at.toFixed(1) + ' (' + dB.toFixed(1) + ' dB, down to ' + to + ', ' + t.toFixed(1) + ')'
          : 'at or under ' + to + ' (' + t.toFixed(1) + '): plays ' + (trimDb ? 'at ' + at.toFixed(1) : 'as it is'));
      }
      wrap.__lufs = () => measure();                 // (tests)

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
      const tabs = new Map();                        // canvas → its ⟲ tab's box (css px from the canvas's top left)
      function drawWave(cv, p, from, to) {
        const g = cv.getContext('2d'), W = cv.width, H = cv.height, mid = H / 2, x = t => (t - from) / (to - from) * W, dpr = devicePixelRatio;
        const edge = k => (k === hover ? 5 : k === active ? 3 : 2) * dpr;
        g.clearRect(0, 0, W, H);
        g.fillStyle = 'rgba(74,168,255,0.16)';
        g.fillRect(x(sel.start), 0, x(endOf()) - x(sel.start), H);
        for (let i = 0; i < p.length; i++) { const t = from + (i + 0.5) / p.length * (to - from), inside = t >= sel.start && t <= endOf(); g.fillStyle = inside ? '#7fc0ff' : '#3c4a58'; const h = Math.max(1, p[i] * (H - 4)); g.fillRect(i * W / p.length, mid - h / 2, Math.max(1, W / p.length), h); }
        // the loop: its region, and where the repeats go in if they've been moved
        if (loop) {
          g.fillStyle = loop.at != null ? 'rgba(255,154,60,0.10)' : 'rgba(255,154,60,0.22)';
          g.fillRect(x(loop.from), 0, x(loop.to) - x(loop.from), H);
          g.fillStyle = '#ff9a3c';
          for (const k of ['lfrom', 'lto']) g.fillRect(x(get(k)) - edge(k) / 2, 0, edge(k), H);
          if (loop.at != null) g.fillRect(x(loop.at) - edge('at') / 2, 0, edge('at'), H);
        }
        // fades as ramps over the selection
        g.strokeStyle = 'rgba(255,204,51,0.8)'; g.lineWidth = dpr;
        g.beginPath();
        g.moveTo(x(sel.start), H); g.lineTo(x(sel.start + sel.fadeIn / 1000), 2); g.lineTo(x(endOf() - sel.fadeOut / 1000), 2); g.lineTo(x(endOf()), H);
        g.stroke();
        g.fillStyle = '#fff';
        for (const k of ['start', 'end']) g.fillRect(x(get(k)) - edge(k) / 2, 0, edge(k), H);
        // the ⟲ tab: the repeats, where they go in (drag it to put them somewhere else)
        tabs.delete(cv);
        if (loop) {
          const xa = x(atOf()), label = loop.at != null ? '⟲ ×' + loop.plays + ' here' : '⟲ plays ' + loop.plays + '×';
          g.font = (11 * dpr) + 'px "Helvetica Neue", Arial, sans-serif';
          const tw = g.measureText(label).width + 8 * dpr, th = 15 * dpr;
          if (xa >= 0 && xa <= W) {
            const x0 = xa + tw > W ? Math.max(0, xa - tw) : xa;
            g.fillStyle = hover === 'tab' ? '#ffb468' : '#ff9a3c'; g.fillRect(x0, 0, tw, th);
            g.fillStyle = '#1a1000'; g.textBaseline = 'middle'; g.fillText(label, x0 + 4 * dpr, th / 2 + 0.5 * dpr);
            tabs.set(cv, { x0: x0 / dpr, x1: (x0 + tw) / dpr, y1: th / dpr });
          }
        }
        if (voice) { const t = sourceAt(playOff + voice.time(), playSegs); g.fillStyle = '#ffcc33'; g.fillRect(x(t), 0, 2 * dpr, H); }
      }
      // The close-up: the whole part, or (working on an edge: First / Last 2 s, dragging, typing, nudging)
      // 6 s at a standard scale, a left edge 1 s in from the left or a right edge 1 s in from the right
      let zmode = 'all';
      const LEFT = { start: 1, lfrom: 1, at: 1 }, RIGHT = { end: 1, lto: 1 };
      const LABELS = { start: 'Close up on the start: 1 s before, 5 s after', end: 'Close up on the end: 5 s before, 1 s after',
        lfrom: 'Close up on the loop’s start: 1 s before, 5 s after', lto: 'Close up on the loop’s end: 5 s before, 1 s after',
        at: 'Close up on where the repeats go in: 1 s before, 5 s after', all: 'Close up: the whole part' };
      const zoomRange = () => {
        if (LOOPK[zmode] && !loop) zmode = 'all';
        if (LEFT[zmode]) { const a = Math.max(0, Math.min(get(zmode) - 1, dur() - 6)); return [a, Math.min(dur(), a + 6)]; }
        if (RIGHT[zmode]) { const b = Math.min(dur(), Math.max(get(zmode) + 1, 6)); return [Math.max(0, b - 6), b]; }
        const len = endOf() - sel.start, pad = Math.max(0.5, len * 0.25); return [Math.max(0, sel.start - pad), Math.min(dur(), endOf() + pad)];
      };
      function focusOn(m) {
        zmode = LOOPK[m] && !loop ? 'all' : m;
        $('.sc-zlabel').textContent = LABELS[zmode] || LABELS.all;
        $('.sc-zall').hidden = zmode === 'all';
        draw();
      }
      wrap.__zoom = () => zoomRange();               // (tests)
      wrap.__loop = () => (loop ? cleanLoop(loop) : null);
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

      // Pointer: drag across the whole track = a new selection (Shift: a new loop); close up, drag the
      // nearer edge; anywhere, a line within GRAB moves that line and the ⟲ tab moves the repeats
      const timeAt = (cv, e, from, to) => { const r = cv.getBoundingClientRect(); return from + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (to - from); };
      const GRAB = 7;                                // css px either side of a line
      const edgeKeys = () => (loop ? ['start', 'end', 'lfrom', 'lto'].concat(loop.at != null ? ['at'] : []) : ['start', 'end']);
      function nearEdge(cv, e, from, to) {
        const r = cv.getBoundingClientRect(), px = t => r.left + (t - from) / (to - from) * r.width;
        let best = null, bd = GRAB + 1e-3;
        for (const k of edgeKeys()) { const d = Math.abs(e.clientX - px(get(k))); if (d < bd) { bd = d; best = k; } }
        return best;
      }
      function onTab(cv, e) {
        const b = tabs.get(cv);
        if (!b || !loop) return false;
        const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        return x >= b.x0 && x <= b.x1 && y >= 0 && y <= b.y1;
      }
      // A drag on a canvas: move(ev) while the button is down, then done() once. The release can go
      // missing (the button let go outside the window, another app taking focus mid-drag) and the
      // drag would carry on with the button up: a move with no button down, a lost capture or a blur
      // ends it too
      function track(cv, move, done) {
        const ENDS = ['pointerup', 'pointercancel', 'lostpointercapture'];
        let ended = false;
        const mv = ev => { if (!ev.buttons) end(); else move(ev); };
        const end = () => {
          if (ended) return;
          ended = true;
          cv.removeEventListener('pointermove', mv); ENDS.forEach(t => cv.removeEventListener(t, end)); removeEventListener('blur', end);
          if (done && wrap.isConnected) done();
        };
        cv.addEventListener('pointermove', mv); ENDS.forEach(t => cv.addEventListener(t, end)); addEventListener('blur', end);
      }
      function dragEdge(cv, e, k, range) {
        active = k;
        const move = ev => {
          const [a, b] = range(), t = timeAt(cv, ev, a, b);
          if (k === 'at' && Math.abs(t - loop.to) / (b - a) * cv.getBoundingClientRect().width <= GRAB) delete loop.at;   // back by the loop: in place
          else set(k, t);
          redraw();
        };
        track(cv, move, () => { focusOn(k === 'at' && loop.at == null ? 'all' : k); if (k === 'lfrom' || k === 'lto') reloop(); });   // then the close-up centres on it
        draw();
      }
      for (const [cv, range] of [[over, () => [0, dur()]], [zoom, zoomRange]]) {
        cv.addEventListener('pointermove', e => {
          if (!buf || e.buttons) return;
          const [a, b] = range(), h = onTab(cv, e) ? 'tab' : nearEdge(cv, e, a, b);
          cv.classList.toggle('sc-grab', !!h && h !== 'tab');
          cv.classList.toggle('sc-move', h === 'tab');
          if (h !== hover) { hover = h; draw(); }
        });
        cv.addEventListener('pointerleave', () => { cv.classList.remove('sc-grab', 'sc-move'); if (hover) { hover = null; draw(); } });
      }
      over.addEventListener('pointerdown', e => {
        if (!buf || e.button !== 0) return;          // (a right click: its menu would swallow the release)
        over.setPointerCapture(e.pointerId);
        if (onTab(over, e)) return dragEdge(over, e, 'at', () => [0, dur()]);
        const k = nearEdge(over, e, 0, dur());
        if (k) return dragEdge(over, e, k, () => [0, dur()]);
        const t0 = timeAt(over, e, 0, dur());
        let move;
        if (e.shiftKey && canLoop) {                   // a new loop
          loop = { from: t0, to: t0 + LIMITS.loopMin, plays: loop ? loop.plays : 2 };
          move = ev => { const t = timeAt(over, ev, 0, dur()); loop.from = Math.min(t0, t); loop.to = Math.max(t0, t, Math.min(t0, t) + LIMITS.loopMin); active = t < t0 ? 'lfrom' : 'lto'; redraw(); };
          active = 'lto';
        } else {
          zmode = 'all';                               // a new part: see all of it
          move = ev => { const t = timeAt(over, ev, 0, dur()); sel.start = Math.min(t0, t); sel.end = Math.max(t0, t, Math.min(t0, t) + 0.05); active = t < t0 ? 'start' : 'end'; redraw(); };
        }
        track(over, move, () => { focusOn('all'); if (e.shiftKey) reloop(); });
        redraw();
      });
      zoom.addEventListener('pointerdown', e => {
        if (!buf || e.button !== 0) return;
        zoom.setPointerCapture(e.pointerId);
        const [a, b] = zoomRange(), t = timeAt(zoom, e, a, b);
        if (onTab(zoom, e)) return dragEdge(zoom, e, 'at', () => [a, b]);
        const k = nearEdge(zoom, e, a, b);
        if (k) return dragEdge(zoom, e, k, () => [a, b]);   // (the view holds still while dragging)
        active = Math.abs(t - sel.start) <= Math.abs(t - endOf()) ? 'start' : 'end';
        const move = ev => { const tt = timeAt(zoom, ev, a, b); set(active, tt); redraw(); };
        move(e);
        track(zoom, move, () => focusOn(active));
      });
      wrap.querySelectorAll('input[data-k]').forEach(i => {
        const k = i.dataset.k;
        i.addEventListener('focus', () => { if (TIMES.includes(k)) { active = k; focusOn(k); } });
        i.addEventListener('change', () => {
          if (LOOPK[k] && !loop) return;
          if (k === 'at' && !i.value.trim()) delete loop.at;            // empty: in place
          else if (TIMES.includes(k)) { const t = parse(i.value); if (t == null) { msg('Type a time as m:ss.ss (e.g. 1:02.50) or seconds.'); fields(); return; } set(k, t); }
          else set(k, k === 'trimdb' ? Number(i.value) || 0 : Math.max(0, Number(i.value) || 0));
          msg(''); redraw();
          if (k === 'lfrom' || k === 'lto') reloop(true);
        });
        if (i.type === 'number') i.addEventListener('input', () => { if (LOOPK[k] && !loop) return; set(k, k === 'trimdb' ? Number(i.value) || 0 : Math.max(0, Number(i.value) || 0)); clamp(); draw(); });
      });

      function stopPlay() {
        if (voice) { voice.stop(); voice = null; }
        cancelAnimationFrame(raf); clearTimeout(reloopT);
        if (previewing) { previewing = false; $('.sc-lprev').textContent = '▶ Preview loop'; }
        draw();
      }
      // Preview loop: the loop's region over and over (seamless, as it will join), until stopped; it
      // starts again with the new region when a loop edge is let go of, typed or nudged (reloop)
      let previewing = false, reloopT = 0;
      function previewLoop() {
        stopPlay();
        if (!buf || !loop) return;
        clamp();
        const v = voice = play(loopPass(buf, loop.from, loop.to), { loop: true });
        v.gain.gain.value = levelGain();
        playSegs = [[loop.from, loop.to]]; playOff = 0;
        playing = { from: loop.from, to: loop.to, loop: true };
        previewing = true; $('.sc-lprev').textContent = '■ Stop preview';
        const tick = () => { if (voice !== v) return; draw(); raf = requestAnimationFrame(tick); };
        tick();
      }
      const reloop = soon => { if (!previewing) return; clearTimeout(reloopT); if (soon) reloopT = setTimeout(previewLoop, 300); else previewLoop(); };
      // Plays the clip as it's set (piece: a variation of it), or the window w0–w1 s of it
      function playPart(how) {
        stopPlay();
        if (!buf) return;
        const c = cur();
        let piece = c, w0 = 0, w1 = null;
        if (how === 'lead') piece = Object.assign({}, c, { start: Math.max(0, c.start - 2), fadeIn: 0 });
        else if (how === 'first') { piece = Object.assign({}, c, { fadeOut: 0 }); w1 = 2; }
        else if (how === 'last') { piece = Object.assign({}, c, { fadeIn: 0 }); w0 = (length(piece, dur()) || 0) - c.fadeOut / 1000 - 2; }   // 2 s before the fade out begins, then the fade
        else if (how === 'loop') {
          const p = plan(c, dur());
          if (!p || !p.loop) return msg('The loop isn’t heard: it goes in outside the part.');
          piece = Object.assign({}, c, { fadeIn: 0, fadeOut: 0 });
          w0 = p.loop.inAt - 2; w1 = p.loop.inAt + p.loop.copies * p.loop.len + 2;
        }
        const L = length(piece, dur()) || 0;
        if (L > LIMITS.download) return msg('Too long to play here (' + clock(L) + ').');
        w0 = Math.max(0, Math.min(w0, L)); w1 = w1 == null ? L : Math.min(L, Math.max(w0, w1));
        const full = render(buf, piece), out = w0 > 0 || w1 < L ? slice(full, w0, w1) : full;
        playSegs = plan(piece, dur()).segs; playOff = w0;
        playing = { from: r2(sourceAt(w0, playSegs)), to: r2(sourceAt(w1, playSegs)) };
        const v = voice = play(out);
        v.gain.gain.value = levelGain();             // as the show will hear it
        v.ended.then(() => { if (voice === v) { voice = null; draw(); } });
        const tick = () => { if (voice !== v) return; draw(); raf = requestAnimationFrame(tick); };
        tick();
      }
      let playing = null;                            // (tests: what's playing, from–to in the source)
      wrap.__playing = () => (voice ? playing : null);
      $('.sc-play').addEventListener('click', () => { focusOn('all'); playPart(); });
      $('.sc-first').addEventListener('click', () => { active = 'start'; focusOn('start'); playPart('first'); });
      $('.sc-last').addEventListener('click', () => { active = 'end'; focusOn('end'); playPart('last'); });
      $('.sc-zall').addEventListener('click', () => focusOn('all'));
      $('.sc-lead').addEventListener('click', () => playPart('lead'));
      $('.sc-stop').addEventListener('click', stopPlay);
      $('.sc-whole').addEventListener('click', () => { sel.start = 0; sel.end = null; sel.fadeIn = sel.fadeOut = 0; zmode = 'all'; redraw(); focusOn('all'); });
      $('.sc-addloop').addEventListener('click', () => {
        if (!buf) return;
        const a = sel.start, len = endOf() - a;
        loop = { from: a + len * 0.4, to: a + len * 0.6, plays: 2 };
        active = 'lfrom'; redraw(); focusOn('all');
      });
      $('.sc-lback').addEventListener('click', () => { if (loop) { delete loop.at; if (active === 'at') active = 'lto'; redraw(); focusOn('all'); } });
      $('.sc-lremove').addEventListener('click', () => { loop = null; if (LOOPK[active]) active = 'start'; stopPlay(); redraw(); focusOn('all'); });
      $('.sc-lprev').addEventListener('click', () => { if (previewing) stopPlay(); else previewLoop(); });
      $('.sc-lplay').addEventListener('click', () => { if (loop) { focusOn('at'); playPart('loop'); } });
      // Save as WAV: the edit as a file of its own (one too long to keep as a clip, a 6-minute sting…)
      $('.sc-wav').addEventListener('click', () => {
        if (!buf) return;
        clamp();
        const c = cur(), len = length(c, dur()) || 0;
        if (len > LIMITS.download) return msg('Too long to save: ' + clock(len) + ' (' + clock(LIMITS.download) + ' at most).');
        const name = ($('.sc-name').value.trim() || opts.name || 'sting').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) + '.wav';
        const a = document.createElement('a');
        a.href = URL.createObjectURL(wav(render(buf, c))); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        msg('Saved “' + name + '” to your downloads: add it as the sting’s file (+ sting → Custom file, or From a file… in the sting library).');
      });

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
        const c = cur(), chk = loopCheck(c, dur());
        if (!chk.ok) { msg(chk.why + ' Save as WAV instead, or fewer plays.'); return; }
        const whole = sel.start <= 0 && sel.end == null && !sel.fadeIn && !sel.fadeOut && !loop;
        finish({ name: $('.sc-name').value.trim().slice(0, 200) || opts.name || 'Sting',
          start: whole ? null : sel.start, end: whole ? null : endOf(), fadeIn: sel.fadeIn || null, fadeOut: sel.fadeOut || null,
          loop: c.loop || null, sourceLength: dur(),
          lufs: measure(), volume: trimDb < 0 ? Math.round(Math.pow(10, trimDb / 20) * 10000) / 10000 : null,
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
          if (LOOPK[k] && !loop) return;
          if (TIMES.includes(k)) { set(k, get(k) + dir * (e.shiftKey ? 0.1 : 0.01)); active = k; }
          else if (k === 'plays') loop.plays += dir;
          else if (k === 'trimdb') set(k, trimDb + dir * (e.shiftKey ? 3 : 0.5));
          else sel[k] = Math.max(0, (sel[k] || 0) + dir * (e.shiftKey ? 100 : 10));
          clamp(); e.target.value = k === 'at' && loop.at == null ? '' : TIMES.includes(k) ? fmt(get(k)) : String(get(k));
          if (TIMES.includes(k)) focusOn(k); else draw();
          if (k === 'lfrom' || k === 'lto') reloop(true);
          return;
        }
        if (typing) return;
        if (e.key === ' ') { e.preventDefault(); if (voice) stopPlay(); else playPart(); return; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          if (LOOPK[active] && !loop) active = 'start';
          const step = (e.shiftKey ? 1 : e.altKey ? 0.01 : 0.1) * (e.key === 'ArrowLeft' ? -1 : 1);
          set(active, get(active) + step);
          redraw();
          focusOn(active);
          if (active === 'lfrom' || active === 'lto') reloop(true);
        }
      }
      document.addEventListener('keydown', onKey, true);
      ['keyup', 'keypress'].forEach(t => wrap.addEventListener(t, e => e.stopPropagation()));
      window.addEventListener('resize', draw);

      msg('Reading the track…');
      decode(opts.src).then(b => {
        buf = b;
        msg('');
        redraw();
        focusOn('all');
        $('.sc-save').focus();
      }).catch(() => {
        msg('This track can’t be opened here (its server doesn’t allow it, or the browser can’t read the file). Use a file from your computer instead.');
        $('.sc-save').disabled = true;
      });
    });
  }

  return { region, cleanLoop, plan, length, loopCheck, LIMITS, decode, render, wav, play, preview, open,
    loudness, toneBuffer, gainFor, trim, target, houseLevel, showLevel, LEVEL, TARGET_KEY, SHOW_KEY };
})();
if (typeof module !== 'undefined') module.exports = StingClip;
