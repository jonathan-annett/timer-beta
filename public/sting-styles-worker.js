/*!
 * sting-styles-worker.js
 * The worker behind sting-styles.js: 16 kHz mono samples in, 400 Discogs style scores out. It does what
 * Essentia's TensorflowPredictEffnetDiscogs does, without Essentia (AGPL): our own spectrogram, written to
 * match TensorflowInputMusiCNN exactly (Essentia's C++ source, Nov 2026: FrameCutter 512 / 256 zero-centred,
 * a Hann window, the power spectrum, 96 Slaney mel bands 0–8 kHz weighted linearly and normalised as
 * 'unit_tri', then log10(1 + 10000 x)), checked against Essentia's own output; then MTG's Discogs-EffNet
 * model (ONNX, onnxruntime-web from jsDelivr, WebAssembly) on 128-frame patches every 62 frames, and the
 * mean of the patches' sigmoid scores per style. A clip under 128 frames (about 2 s) is one zero-padded
 * patch (Essentia would give nothing).
 *
 * Model: Discogs-EffNet (discogs-effnet-bsdynamic-1) by the Music Technology Group, Universitat Pompeu
 * Fabra (https://essentia.upf.edu/models.html), CC BY-NC-SA 4.0: non-commercial use. Alonso-Jiménez,
 * Serra, Bogdanov, "Music Representation Learning Based on Editorial Metadata from Discogs", ISMIR 2022.
 *
 * Messages: {id, samples: Float32Array (16 kHz mono), model: url} → {id, scores: Float32Array(400),
 * patches, frames} | {id, error, model?} (model: true when it's the model that didn't load, not the file).
 * The model loads once, on the first message.
 * In node (tests): module.exports = {melFrames, patchStarts}.
 * MIT Licensed (this file; not the model)
 */
'use strict';
const SR = 16000, FRAME = 512, HOP = 256, BANDS = 96, PATCH = 128, PATCH_HOP = 62, BATCH = 16;

// ─── The spectrogram (TensorflowInputMusiCNN) ───
const BINS = FRAME / 2 + 1;
const WINDOW = (() => {                                // Essentia's Hann: 0.5 − 0.5 cos(2πi / (N − 1)), not normalised
  const w = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FRAME - 1));
  return w;
})();
// The mel filter bank: TriangularBands over Slaney mel frequencies (MelBands), weights linear in Hz,
// each triangle divided by its theoretical area ((fstep1 + fstep2) / 2, 'unit_tri')
const hz2mel = hz => (hz < 1000 ? hz * 3 / 200 : 15 + Math.log(hz / 1000) / (Math.log(6.4) / 27));
const mel2hz = mel => (mel < 15 ? mel * 200 / 3 : 1000 * Math.exp((mel - 15) * (Math.log(6.4) / 27)));
const FILTERS = (() => {
  const lo = Math.fround(hz2mel(0)), hi = Math.fround(hz2mel(SR / 2)), step = Math.fround((hi - lo) / (BANDS + 1)), f = [];
  for (let i = 0, m = lo; i < BANDS + 2; i++, m = Math.fround(m + step)) f.push(Math.fround(mel2hz(m)));   // (as Essentia: floats, the step added up)
  const scale = (SR / 2) / (BINS - 1), bands = [];
  for (let i = 0; i < BANDS; i++) {
    const s1 = f[i + 1] - f[i], s2 = f[i + 2] - f[i + 1], from = Math.ceil(f[i] / scale), to = Math.floor(f[i + 2] / scale);
    const w = new Float64Array(to - from + 1), area = (s1 + s2) / 2;
    for (let j = from; j <= to; j++) {
      const hz = j * scale;
      w[j - from] = (hz < f[i + 1] ? (hz - f[i]) / s1 : (f[i + 2] - hz) / s2) / area;
    }
    bands.push({ from, w });
  }
  return bands;
})();
// A 512-point FFT (radix 2), power spectrum out
const REV = (() => { const r = new Uint16Array(FRAME); for (let i = 0, b = Math.log2(FRAME); i < FRAME; i++) { let x = i, y = 0; for (let k = 0; k < b; k++) { y = (y << 1) | (x & 1); x >>= 1; } r[i] = y; } return r; })();
const COS = new Float64Array(FRAME / 2), SIN = new Float64Array(FRAME / 2);
for (let i = 0; i < FRAME / 2; i++) { COS[i] = Math.cos(2 * Math.PI * i / FRAME); SIN[i] = -Math.sin(2 * Math.PI * i / FRAME); }
function power(frame, out, re, im) {
  for (let i = 0; i < FRAME; i++) { re[REV[i]] = frame[i] * WINDOW[i]; im[REV[i]] = 0; }
  for (let size = 2; size <= FRAME; size <<= 1) {
    const half = size >> 1, step = FRAME / size;
    for (let start = 0; start < FRAME; start += size) {
      for (let k = 0; k < half; k++) {
        const a = start + k, b = a + half, c = COS[k * step], s = SIN[k * step];
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  for (let j = 0; j < BINS; j++) { const m = Math.fround(Math.hypot(re[j], im[j])); out[j] = m * m; }   // (|X| as Essentia's float, squared: 'power')
}
// samples (16 kHz) → Float32Array(frames × 96). Frames as Essentia's FrameCutter (zero-centred: the first
// starts half a frame before 0:00, zero-padded; the last is the first whose centre reaches the end)
function melFrames(samples) {
  const n = samples.length;
  if (!n) return { mel: new Float32Array(0), frames: 0 };
  const frames = Math.ceil(n / HOP) + 1;
  const mel = new Float32Array(frames * BANDS), frame = new Float64Array(FRAME), spec = new Float64Array(BINS);
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME);
  for (let k = 0; k < frames; k++) {
    const start = k * HOP - FRAME / 2;
    for (let i = 0; i < FRAME; i++) { const t = start + i; frame[i] = t >= 0 && t < n ? samples[t] : 0; }
    power(frame, spec, re, im);
    for (let b = 0; b < BANDS; b++) {
      const { from, w } = FILTERS[b];
      let e = 0;
      for (let j = 0; j < w.length; j++) e += spec[from + j] * w[j];
      mel[k * BANDS + b] = Math.log10(1 + 10000 * Math.fround(e));
    }
  }
  return { mel, frames };
}
const patchStarts = frames => { const s = []; for (let p = 0; p + PATCH <= frames; p += PATCH_HOP) s.push(p); return s.length ? s : [0]; };

if (typeof module !== 'undefined' && module.exports) module.exports = { melFrames, patchStarts, SR, BANDS, PATCH };

// ─── The worker ───
if (typeof importScripts === 'function') {
  const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
  let session = null, loading = null;
  function load(url) {
    if (session) return Promise.resolve(session);
    if (!loading) loading = (async () => {
      importScripts(ORT + 'ort.min.js');
      ort.env.wasm.wasmPaths = ORT;
      ort.env.wasm.numThreads = 1;                     // (threads need a cross-origin isolated page)
      session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'] });
      return session;
    })().catch(err => { loading = null; throw err; });
    return loading;
  }
  self.onmessage = async e => {
    const { id, samples, model } = e.data || {};
    let s;
    try { s = await load(model); } catch (err) { self.postMessage({ id, error: String(err && err.message || err), model: true }); return; }
    try {
      const { mel, frames } = melFrames(samples);
      const starts = patchStarts(frames), sum = new Float64Array(400);
      for (let b = 0; b < starts.length; b += BATCH) {
        const batch = starts.slice(b, b + BATCH), input = new Float32Array(batch.length * PATCH * BANDS);
        batch.forEach((p, n) => input.set(mel.subarray(p * BANDS, Math.min(frames, p + PATCH) * BANDS), n * PATCH * BANDS));   // (short: zero-padded)
        const out = await s.run({ melspectrogram: new ort.Tensor('float32', input, [batch.length, PATCH, BANDS]) }, ['activations']);
        const act = out.activations.data;
        for (let n = 0; n < batch.length; n++) for (let i = 0; i < 400; i++) sum[i] += act[n * 400 + i];
        self.postMessage({ id, progress: Math.min(1, (b + batch.length) / starts.length) });
      }
      const scores = new Float32Array(400);
      for (let i = 0; i < 400; i++) scores[i] = sum[i] / starts.length;
      self.postMessage({ id, scores, patches: starts.length, frames }, [scores.buffer]);
    } catch (err) {
      self.postMessage({ id, error: String(err && err.message || err) });
    }
  };
}
