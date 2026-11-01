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
 *     pendingFrom()        the start (ms) of a phrase still being heard, or null
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
 *   AssistASR.create({model, onStatus(text, kind), onResult({seg, chunks:[{at, to, text}]})})
 *     load()               fetches the model (cached by the browser after the first time) in a worker
 *     add(seg)             transcribes a phrase (queued; one at a time)
 *     backlog()            phrases waiting
 *     device               'webgpu' or 'wasm' (the processor) once loaded
 *     oldest()             the start (ms) of the oldest phrase not transcribed yet, or null
 * The worker is assist-asr.js (transformers.js, Whisper). Each chunk's time is the phrase's start
 * plus Whisper's own timestamp within it; its end likewise (or the phrase's end, when Whisper gives none).
 *
 *   AssistLedger         where every bit of audio went (the station's *Audio accounting*, and the
 *                        console as [assist] lines): heard vs the sound card's clock (gaps), speech
 *                        vs too short vs silence (and quiet frames that nearly counted as speech),
 *                        and each phrase's fate: words, no words, only Whisper's noise words, an
 *                        error, dropped (far behind, or stopped) or still waiting
 * MIT Licensed
 */

/* exported AssistAudio, AssistASR, AssistLedger */

var AssistLedger = (function () {
  'use strict';
  const t = {};
  let phrases = [], events = [], seq = 0;
  const clock = ms => (ms == null ? '?' : new Date(ms).toTimeString().slice(0, 8) + '.' + String(Math.round(ms) % 1000).padStart(3, '0').slice(0, 1));
  function reset() {
    Object.assign(t, {
      heardS: 0, clockS: 0, clockS0: 0, missS: 0, lateN: 0, lateMaxMs: 0, fillS: 0,
      speechS: 0, shortN: 0, shortS: 0, nearS: 0, cutN: 0, flushN: 0, unreadN: 0, unreadS: 0, ignoredN: 0, ignoredS: 0,
    });
    phrases = []; events = [];
  }
  reset();
  function note(kind, text) {
    events.push({ at: Date.now(), kind, text });
    if (events.length > 300) events.shift();
    console.log('[assist] ' + kind + ': ' + text);
  }
  // A phrase sent to the transcriber; its fate is filled in later
  function phrase(at, dur, why) {
    const p = { n: ++seq, at, dur, why, sent: Date.now(), fate: 'waiting', text: '' };
    phrases.push(p);
    if (phrases.length > 400) phrases.shift();
    return p;
  }
  function fate(p, f, text, detail) {
    if (!p) return;
    p.fate = f; p.text = text || ''; p.lat = Date.now() - p.sent - p.dur;
    const head = `phrase ${p.n} ${clock(p.at)} (${(p.dur / 1000).toFixed(1)} s${p.why ? ', ' + p.why : ''})`;
    if (f === 'words') console.log(`[assist] ${head} → "${p.text}"${detail ? ' ' + detail : ''}`);
    else note(f, `${head}${text ? ' → "' + text + '"' : ''}${detail ? ' ' + detail : ''}`);
  }
  function summary() {
    const by = {};
    for (const p of phrases) { const b = by[p.fate] || (by[p.fate] = { n: 0, s: 0 }); b.n++; b.s += p.dur / 1000; }
    return by;
  }
  function report() {
    const s = x => x.toFixed(1) + ' s', by = summary(), f = k => (by[k] ? `${by[k].n} (${s(by[k].s)})` : '0');
    const silence = Math.max(0, t.heardS - t.speechS - t.shortS);
    const lines = [
      `Heard ${s(t.heardS)} of ${s(t.clockS)} by the sound card's clock` + (t.clockS - t.heardS > 0.5 ? `: ${s(t.clockS - t.heardS)} MISSING` : ''),
      `  no input from the microphone: ${s(t.missS)} · pauses filled with silence (stopped): ${s(t.fillS)}`,
      `  audio arriving late (page busy): ${t.lateN} times, longest ${(t.lateMaxMs / 1000).toFixed(1)} s`,
      `Speech ${s(t.speechS)} · too short to send ${t.shortN} (${s(t.shortS)}) · silence ${s(silence)}`,
      `  quiet frames just under the speech level: ${s(t.nearS)}` + (t.nearS > 5 ? ' (speech may be too quiet for the detector)' : ''),
      `  phrases cut at 20 s: ${t.cutN} · sent on Stop: ${t.flushN} · gone from the buffer: ${t.unreadN} (${s(t.unreadS)}) · not sent (no transcriber): ${t.ignoredN} (${s(t.ignoredS)})`,
      `Phrases ${phrases.length}: words ${f('words')} · no words ${f('empty')} · noise words only ${f('junk')} · errors ${f('error')} · dropped ${f('dropped')} · waiting ${f('waiting')}`,
      '',
      'Last phrases:',
      ...phrases.slice(-40).reverse().map(p => `  ${String(p.n).padStart(4)} ${clock(p.at)} ${(p.dur / 1000).toFixed(1).padStart(4)} s  ${p.fate.padEnd(7)}${p.lat != null ? ` +${(p.lat / 1000).toFixed(1)} s` : ''}  ${p.text}`),
      '',
      'Events:',
      ...events.slice(-40).reverse().map(e => `  ${clock(e.at)} ${e.kind}: ${e.text}`),
    ];
    return lines.join('\n');
  }
  return { t, note, phrase, fate, reset, report, clock, phrases: () => phrases, events: () => events };
})();

var AssistAudio = (function () {
  'use strict';
  const SR = 16000;

  // Runs on the audio thread: the input, averaged down to 16 kHz, in 2048-sample chunks (128 ms)
  const WORKLET = `
class AssistTap extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / ${SR}; this.out = new Float32Array(2048); this.n = 0; this.acc = 0; this.cnt = 0; this.pos = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) { this.miss = (this.miss || 0) + 128; return true; }   // no input this quantum
    if (this.miss) { this.port.postMessage({ miss: this.miss / sampleRate }); this.miss = 0; }
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
    const L = AssistLedger.t;
    let lastArrive = 0, ctx0 = 0, coveredTo = 0;   // accounting: see AssistLedger

    function write(chunk) {
      for (let i = 0; i < chunk.length; i++) ring[(total + i) % cap] = chunk[i];
      total += chunk.length;
      const now = Date.now(), est = now - (total / SR) * 1000;
      L.heardS += chunk.length / SR;
      if (ctx) L.clockS = L.clockS0 + (ctx.currentTime - ctx0);
      if (lastArrive && now - lastArrive > 1000) {      // queued, not lost: the worklet keeps every sample
        L.lateN++; L.lateMaxMs = Math.max(L.lateMaxMs, now - lastArrive);
        AssistLedger.note('late', `no audio delivered for ${((now - lastArrive) / 1000).toFixed(1)} s (the page was busy); it arrives queued`);
      }
      lastArrive = now;
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
      if (!voice && rms > Math.max(floor * 1.8, 0.002)) L.nearS += FRAME / SR;
      if (voice) lastVoice = at;
      if (!seg && voice) seg = { from: Math.max(0, at - FRAME - PRE, total - cap) };
      if (seg && (at - lastVoice > HANG || at - seg.from > MAXLEN)) {
        const cut = at - seg.from > MAXLEN;
        if (cut) L.cutN++;
        endSeg(cut ? at : Math.min(at, lastVoice + SR * 0.3), cut ? 'cut at 20 s' : '');
        seg = voice ? { from: at } : null;
      }
    }
    // A phrase ends: sent on (onSegment), or counted as too short; every sample is accounted for
    function endSeg(to, why) {
      const from = seg.from, len = to - from;
      if (len <= 0) return;
      const fresh = Math.max(0, to - Math.max(from, coveredTo)) / SR;   // the pre-roll can overlap the last phrase
      coveredTo = Math.max(coveredTo, to);
      if (len < MINLEN) { L.shortN++; L.shortS += fresh; return; }
      L.speechS += fresh;
      const audio = read(from, to);
      if (!audio) {
        L.unreadN++; L.unreadS += len / SR;
        return AssistLedger.note('lost', `phrase ${AssistLedger.clock(base + (from / SR) * 1000)} (${(len / SR).toFixed(1)} s) was no longer in the buffer`);
      }
      if (opts.onSegment) opts.onSegment({ from, to, audio, why });
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
          if (gap > 0) { for (let i = 0; i < Math.min(gap, cap); i++) ring[(total + i) % cap] = 0; total += gap; L.fillS += gap / SR; }
          bases = [];
        }
        coveredTo = Math.max(coveredTo, total);
        stream = await navigator.mediaDevices.getUserMedia({ audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
        ctx = new AudioContext();
        await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
        src = ctx.createMediaStreamSource(stream);
        node = new AudioWorkletNode(ctx, 'assist-tap');
        node.port.onmessage = ev => {
          if (ev.data instanceof Float32Array) return write(ev.data);
          if (ev.data && ev.data.miss) { L.missS += ev.data.miss; AssistLedger.note('no input', `the microphone gave nothing for ${ev.data.miss.toFixed(2)} s`); }
        };
        src.connect(node);                     // not to the speakers: the worklet runs without an output
        if (ctx.state !== 'running') await ctx.resume();
        ctx0 = ctx.currentTime; L.clockS0 = L.clockS; lastArrive = 0;
        ctx.onstatechange = () => { if (ctx && ctx.state !== 'running') AssistLedger.note('audio', 'the audio system is ' + ctx.state + ': nothing is being recorded'); };
        const tr = stream.getAudioTracks()[0];
        if (tr) {
          tr.addEventListener('mute', () => AssistLedger.note('mic', 'the microphone went silent (muted by the system or another app)'));
          tr.addEventListener('unmute', () => AssistLedger.note('mic', 'the microphone is back'));
          tr.addEventListener('ended', () => AssistLedger.note('mic', 'the microphone was disconnected'));
        }
        AssistLedger.note('start', 'listening to ' + ((tr && tr.label) || 'the microphone') + ` at ${ctx.sampleRate} Hz`);
        return tr ? tr.label : '';
      },
      stop() {
        // the phrase being heard goes on rather than being lost
        if (seg) {
          const to = Math.min(total, lastVoice + SR * 0.3);
          if (to - seg.from >= MINLEN) L.flushN++;
          endSeg(to > seg.from ? to : total, 'on Stop');
        }
        if (ctx) L.clockS = L.clockS0 + (ctx.currentTime - ctx0);
        if (ctx) AssistLedger.note('stop', `stopped; heard ${L.heardS.toFixed(1)} s of ${L.clockS.toFixed(1)} s`);
        if (node) node.port.onmessage = null;
        if (stream) stream.getTracks().forEach(t => t.stop());
        if (ctx) ctx.close();
        ctx = stream = node = src = null; seg = null;
      },
      get running() { return !!ctx; },
      wallOf: s => (base == null ? null : base + (s / SR) * 1000),
      sampleOf: ms => (base == null ? null : Math.round(((ms - base) / 1000) * SR)),
      read,
      pendingFrom: () => (seg && base != null ? base + (seg.from / SR) * 1000 : null),
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
    const api = { device: null, ready: () => ready, backlog: () => queue.length + (busy ? 1 : 0),
      oldest: () => (current ? current.at : queue.length ? queue[0].at : null) };

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
          if (seg && m.error) AssistLedger.fate(seg.led, 'error', '', m.error);
          else if (seg) {
            const ts = (c, k) => (c.timestamp && Number.isFinite(c.timestamp[k]) ? Math.max(0, c.timestamp[k]) * 1000 : null);
            const raw = (m.chunks && m.chunks.length ? m.chunks : [{ text: m.text, timestamp: [0, null] }])
              .map(c => ({ at: seg.at + (ts(c, 0) || 0), to: seg.at + Math.min(ts(c, 1) ?? seg.dur, seg.dur), text: String(c.text || '').trim() }));
            const chunks = raw.filter(c => c.text && !JUNK.test(c.text));
            const said = raw.map(c => c.text).filter(Boolean).join(' ');
            if (chunks.length) {
              // Whisper sometimes stops early: say when its words end well before the phrase does
              const end = Math.max(...raw.map(c => c.to)) - seg.at, tail = seg.dur - end;
              AssistLedger.fate(seg.led, 'words', chunks.map(c => c.text).join(' '), tail > 2000 ? `(no words for its last ${(tail / 1000).toFixed(1)} s)` : '');
              if (tail > 2000) AssistLedger.note('tail', `phrase ${seg.led.n}: Whisper's words end ${(tail / 1000).toFixed(1)} s before the phrase does`);
              opts.onResult({ seg, chunks });
            } else AssistLedger.fate(seg.led, said ? 'junk' : 'empty', said);
          }
          pump();
        }
      };
      worker.onerror = ev => {
        opts.onStatus('The speech model stopped: ' + (ev.message || 'error'), 'bad');
        AssistLedger.note('error', 'the speech worker failed: ' + (ev.message || 'error'));
        if (current) AssistLedger.fate(current.led, 'error', '', 'the worker failed while on it');
        busy = false; current = null;
      };
      opts.onStatus('Loading the speech model…', 'warn');
      worker.postMessage({ t: 'load', model: model.id, device: api.device });
    };
    // seg: {at (ms of its first sample), audio}
    api.add = function (seg) {
      if (!seg || !seg.audio) return;
      seg.dur = (seg.audio.length / 16000) * 1000;
      seg.led = AssistLedger.phrase(seg.at, seg.dur, seg.why);
      queue.push(seg);
      if (!ready) console.log(`[assist] phrase ${seg.led.n} waits: the speech model is still loading`);
      if (queue.length > 40) {                   // far behind (a slow computer): drop the oldest
        const old = queue.shift();
        AssistLedger.fate(old.led, 'dropped', '', '(the transcriber was 40 phrases behind)');
      }
      pump();
    };
    function pump() {
      if (!ready || busy || !queue.length) return;
      current = queue.shift(); busy = true;
      const audio = current.audio;
      current.audio = null;
      worker.postMessage({ t: 'run', audio }, [audio.buffer]);
    }
    api.stop = () => {
      for (const q of current ? [current, ...queue] : queue) AssistLedger.fate(q.led, 'dropped', '', '(the transcriber was stopped: the model changed)');
      if (worker) worker.terminate();
      worker = null; ready = busy = false; queue = []; current = null;
    };
    return api;
  }
  return { create, MODELS };
})();
