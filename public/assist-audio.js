/*!
 * assist-audio.js
 * The assist station's ears (assist.html): a rolling recording of the room and its transcription
 * on this computer.
 *
 *   AssistAudio.create({minutes, onLevel(rms), onSegment({from, to, audio})})
 *     start(deviceId)      the microphone (getUserMedia), through an AudioWorklet, as 16 kHz mono
 *     stop()
 *     wallOf(sample)       the time of day (this computer's ms) a sample was heard
 *     sampleOf(ms)         and back
 *     read(from, to)       a copy of samples [from, to), or null if they're no longer held
 *     play(ms, durMs)      play what was heard from ms, for durMs (whatever of it is still held)
 *     held()               {from, to} in ms: what the buffer holds now
 *
 * Times: the buffer counts samples, which run on the sound card's clock; each one's time of day is
 * worked out from base + sample / 16 kHz, where base is the lowest (Date.now() − samples so far)
 * seen in the last 30 s: the chunks that arrive soonest after being heard. So a phrase's time is
 * where it is in the recording, not when a service got round to sending its words back.
 *
 * Phrases: a simple voice detector (30 ms frames; speech is well above the noise floor, which
 * follows the quietest frames) cuts the stream into phrases: from 300 ms before the voice starts to
 * 700 ms of quiet, and at most 20 s (Whisper hears up to 30 s at a time). Each goes to onSegment.
 *
 *   AssistASR.create({model, onStatus(text, kind), onResult({seg, chunks:[{at, text}]})})
 *     load()               fetches the model (cached by the browser after the first time) in a worker
 *     add(seg)             transcribes a phrase (queued; one at a time)
 *     backlog()            phrases waiting
 *     device               'webgpu' or 'wasm' (the processor) once loaded
 * The worker is assist-asr.js (transformers.js, Whisper). Each chunk's time is the phrase's start
 * plus Whisper's own timestamp within it.
 * MIT Licensed
 */

/* exported AssistAudio, AssistASR */

var AssistAudio = (function () {
  'use strict';
  const SR = 16000;

  // Runs on the audio thread: the input, averaged down to 16 kHz, in 2048-sample chunks (128 ms)
  const WORKLET = `
class AssistTap extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / ${SR}; this.out = new Float32Array(2048); this.n = 0; this.acc = 0; this.cnt = 0; this.pos = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.cnt++; this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        this.out[this.n++] = this.acc / this.cnt; this.acc = 0; this.cnt = 0;
        if (this.n === this.out.length) { this.port.postMessage(this.out.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('assist-tap', AssistTap);`;

  function create(opts) {
    const minutes = opts.minutes || 15;
    const cap = SR * 60 * minutes;
    const ring = new Float32Array(cap);
    let total = 0;                       // samples written, ever
    let base = null, bases = [];         // base: ms of sample 0 (see the header)
    let ctx = null, stream = null, node = null, src = null;

    // Voice detection
    const FRAME = 480, PRE = SR * 0.3, HANG = SR * 0.7, MAXLEN = SR * 20, MINLEN = SR * 0.4;
    let floor = 0.01, frameAcc = 0, frameN = 0, seg = null, lastVoice = 0;

    function write(chunk) {
      for (let i = 0; i < chunk.length; i++) ring[(total + i) % cap] = chunk[i];
      total += chunk.length;
      const now = Date.now(), est = now - (total / SR) * 1000;
      bases.push([now, est]);
      while (bases.length && bases[0][0] < now - 30000) bases.shift();
      base = Math.min(...bases.map(b => b[1]));
      let peak = 0;
      for (let i = 0; i < chunk.length; i++) {
        const v = chunk[i];
        frameAcc += v * v; frameN++;
        if (frameN === FRAME) { frame(Math.sqrt(frameAcc / FRAME), total - chunk.length + i + 1); peak = Math.max(peak, Math.sqrt(frameAcc / FRAME)); frameAcc = 0; frameN = 0; }
      }
      if (opts.onLevel) opts.onLevel(peak);
    }
    function frame(rms, at) {
      floor = rms < floor ? rms : floor * 1.002 + 1e-6;      // drops at once, rises slowly
      const voice = rms > Math.max(floor * 3, 0.004);
      if (voice) lastVoice = at;
      if (!seg && voice) seg = { from: Math.max(0, at - FRAME - PRE, total - cap) };
      if (seg && (at - lastVoice > HANG || at - seg.from > MAXLEN)) {
        const to = at - seg.from > MAXLEN ? at : Math.min(at, lastVoice + SR * 0.3);
        if (to - seg.from >= MINLEN && opts.onSegment) opts.onSegment({ from: seg.from, to, audio: read(seg.from, to) });
        seg = voice ? { from: at } : null;
      }
    }

    function read(from, to) {
      from = Math.round(from); to = Math.round(to);
      if (to <= from || from < total - cap || to > total) return null;
      const out = new Float32Array(to - from);
      for (let i = 0; i < out.length; i++) out[i] = ring[(from + i) % cap];
      return out;
    }

    let player = null;
    return {
      SR,
      async start(deviceId) {
        // Listening again after a stop: the time in between is silence, so every sample keeps its time
        if (base != null) {
          const gap = Math.round(((Date.now() - (base + (total / SR) * 1000)) / 1000) * SR);
          if (gap > 0) { for (let i = 0; i < Math.min(gap, cap); i++) ring[(total + i) % cap] = 0; total += gap; }
          bases = [];
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
        ctx = new AudioContext();
        await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
        src = ctx.createMediaStreamSource(stream);
        node = new AudioWorkletNode(ctx, 'assist-tap');
        node.port.onmessage = ev => write(ev.data);
        src.connect(node);                     // not to the speakers: the worklet runs without an output
        if (ctx.state !== 'running') await ctx.resume();
        return stream.getAudioTracks()[0] ? stream.getAudioTracks()[0].label : '';
      },
      stop() {
        if (node) node.port.onmessage = null;
        if (stream) stream.getTracks().forEach(t => t.stop());
        if (ctx) ctx.close();
        ctx = stream = node = src = null; seg = null;
      },
      get running() { return !!ctx; },
      wallOf: s => (base == null ? null : base + (s / SR) * 1000),
      sampleOf: ms => (base == null ? null : Math.round(((ms - base) / 1000) * SR)),
      read,
      held: () => (base == null ? null : { from: base + (Math.max(0, total - cap) / SR) * 1000, to: base + (total / SR) * 1000 }),
      play(ms, durMs) {
        if (base == null) return false;
        let from = Math.round(((ms - base) / 1000) * SR), to = from + Math.round((durMs / 1000) * SR);
        from = Math.max(from, total - cap, 0); to = Math.min(to, total);
        const pcm = read(from, to);
        if (!pcm) return false;
        if (player) try { player.stop(); } catch (_) { /* ended */ }
        const out = this.out || (this.out = new AudioContext());
        const buf = out.createBuffer(1, pcm.length, SR);
        buf.copyToChannel(pcm, 0);
        player = out.createBufferSource();
        player.buffer = buf; player.connect(out.destination);
        if (out.state !== 'running') out.resume();
        player.start();
        return true;
      },
      stopPlaying() { if (player) try { player.stop(); } catch (_) { /* ended */ } player = null; },
    };
  }
  return { create, SR: 16000 };
})();

var AssistASR = (function () {
  'use strict';
  const MODELS = {
    // Download sizes (Nov 2026): on the graphics chip (fp32 encoder, q4 decoder) / on the processor (q8)
    'tiny.en': { id: 'onnx-community/whisper-tiny.en', gpu: '120 MB', cpu: '41 MB' },
    'base.en': { id: 'onnx-community/whisper-base.en', gpu: '206 MB', cpu: '77 MB' },
    'small.en': { id: 'onnx-community/whisper-small.en', gpu: '586 MB', cpu: '249 MB' },
  };
  // Things Whisper says over silence or noise, not speech
  const JUNK = /^\s*(\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪+|\.+|you|thank you\.?|thanks for watching!?)\s*$/i;

  function create(opts) {
    let worker = null, ready = false, busy = false, queue = [], current = null, files = {};
    const api = { device: null, ready: () => ready, backlog: () => queue.length + (busy ? 1 : 0) };

    async function pickDevice() {
      try { if (navigator.gpu && await navigator.gpu.requestAdapter()) return 'webgpu'; } catch (_) { /* none */ }
      return 'wasm';
    }
    api.load = async function () {
      if (worker) return;
      const model = MODELS[opts.model] || MODELS['base.en'];
      api.device = await pickDevice();
      worker = new Worker(new URL('assist-asr.js', location.href), { type: 'module' });
      worker.onmessage = ev => {
        const m = ev.data || {};
        if (m.t === 'progress') {
          const p = m.p || {};
          if (p.file && p.total) files[p.file] = [p.loaded || 0, p.total];
          const all = Object.values(files), got = all.reduce((a, f) => a + f[0], 0), of = all.reduce((a, f) => a + f[1], 0);
          if (p.status === 'progress' && of) opts.onStatus(`Fetching the speech model: ${Math.round((100 * got) / of)}% of ${Math.round(of / 1e6)} MB (once; kept by the browser after that)`, 'warn');
          else if (p.status === 'ready') opts.onStatus('Starting the speech model…', 'warn');
        } else if (m.t === 'ready') {
          ready = true;
          opts.onStatus(`Transcribing on this computer (Whisper ${opts.model}, ${api.device === 'webgpu' ? 'graphics chip' : 'processor: slower'})`, 'ok');
          pump();
        } else if (m.t === 'error') {
          opts.onStatus('The speech model didn’t load: ' + m.error, 'bad');
          worker.terminate(); worker = null;
        } else if (m.t === 'result') {
          const seg = current;
          busy = false; current = null;
          if (seg && !m.error) {
            const chunks = (m.chunks && m.chunks.length ? m.chunks : [{ text: m.text, timestamp: [0, null] }])
              .map(c => ({ at: seg.at + Math.max(0, (c.timestamp && Number.isFinite(c.timestamp[0]) ? c.timestamp[0] : 0)) * 1000, text: String(c.text || '').trim() }))
              .filter(c => c.text && !JUNK.test(c.text));
            if (chunks.length) opts.onResult({ seg, chunks });
          }
          pump();
        }
      };
      worker.onerror = ev => { opts.onStatus('The speech model stopped: ' + (ev.message || 'error'), 'bad'); };
      opts.onStatus('Loading the speech model…', 'warn');
      worker.postMessage({ t: 'load', model: model.id, device: api.device });
    };
    // seg: {at (ms of its first sample), audio}
    api.add = function (seg) {
      if (!seg || !seg.audio) return;
      queue.push(seg);
      if (queue.length > 40) queue.shift();      // far behind (a slow computer): drop the oldest
      pump();
    };
    function pump() {
      if (!ready || busy || !queue.length) return;
      current = queue.shift(); busy = true;
      const audio = current.audio;
      current.audio = null;
      worker.postMessage({ t: 'run', audio }, [audio.buffer]);
    }
    api.stop = () => { if (worker) worker.terminate(); worker = null; ready = busy = false; queue = []; };
    return api;
  }
  return { create, MODELS };
})();
