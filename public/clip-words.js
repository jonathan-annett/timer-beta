/*!
 * clip-words.js
 * Transcribe and find words in the clip editor (sting-clip.js; a trial: TimerFeatures.transcribe, alpha; the owner,
 * 13 Nov 2026: vision operators cutting a clip from a long video want to find where something is said). The
 * source's speech is transcribed on this computer by Whisper (assist-asr.js, the assist station's worker: English
 * models, on the graphics chip (WebGPU) else the processor; the model fetched the first time and kept by the
 * browser) in pieces of up to 30 s, each cut at the quietest moment near its end so words aren't split, silent
 * ones skipped. Lines appear as they're done, with their times; the box finds words (every word typed, in any
 * order); a line's ▶ plays from there, Start / End set the clip's edges. A file's transcript is kept in this
 * browser (videoStore 'words:<name>|<size>', or the url), with how far it got, so it's there next time and a
 * stopped one carries on from where it stopped.
 *
 *   ClipWords.on()                         the trial is on here
 *   ClipWords.mount(box, {buf, key, play(at), setStart(at), setEnd(at)}) → {stop()}
 *   ClipWords.keyOf(src)                   a source's key (a File: name|size; a url; else null: not kept)
 * MIT Licensed
 */
var ClipWords = (function () {
  'use strict';
  const SR = 16000, MAX_PIECE = 30, MIN_PIECE = 24, MODEL_KEY = 'clip_words_model';
  const MODELS = {   // (as the assist station's; sizes: graphics chip / processor)
    'tiny.en': { id: 'onnx-community/whisper-tiny.en', gpu: '120 MB', cpu: '41 MB' },
    'base.en': { id: 'onnx-community/whisper-base.en', gpu: '206 MB', cpu: '77 MB' },
    'small.en': { id: 'onnx-community/whisper-small.en', gpu: '586 MB', cpu: '249 MB' },
  };
  // What Whisper says over silence or noise, not speech (as the assist station drops)
  const JUNK = /^\s*(\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪+|\.+|you|thank you\.?|thanks for watching!?)\s*$/i;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clock = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  const on = () => !!(window.TimerFeatures && TimerFeatures.transcribe);
  const keyOf = src => (src && typeof src === 'object' && src.name && Number.isFinite(src.size) ? src.name + '|' + src.size : typeof src === 'string' && !src.startsWith('blob:') ? src : null);
  const model = () => { try { const m = localStorage.getItem(MODEL_KEY); return MODELS[m] ? m : 'base.en'; } catch (_) { return 'base.en'; } };

  let css = false;
  function style() {
    if (css) return; css = true;
    const st = document.createElement('style');
    st.textContent = `.cw-box { margin: 0.5rem 0; border-top: 1px solid #333; padding-top: 0.5rem; }
.cw-head { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.cw-head input.cw-find { flex: 1; min-width: 10rem; font: inherit; background: #111; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 0.25rem 0.4rem; }
.cw-head select { font: inherit; background: #111; color: #ddd; border: 1px solid #444; border-radius: 4px; }
.cw-note { color: #999; font-size: 0.85em; }
.cw-lines { max-height: 11rem; overflow: auto; margin-top: 0.4rem; font-size: 0.9em; }
.cw-line { display: flex; gap: 0.4rem; align-items: baseline; padding: 0.1rem 0; }
.cw-line .cw-t { color: #8ab; font-variant-numeric: tabular-nums; min-width: 3.6rem; text-align: right; }
.cw-line .cw-text { flex: 1; }
.cw-line mark { background: #ffcc33; color: #000; border-radius: 2px; }
.cw-line button { font-size: 0.8em; padding: 0 0.4rem; }
.cw-line.cw-now { background: rgba(74, 168, 255, 0.15); }`;
    document.head.appendChild(st);
  }

  // The source at 16 kHz, mono (channels averaged by the context)
  async function at16k(buf) {
    const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * SR)), SR), s = ctx.createBufferSource();
    s.buffer = buf; s.connect(ctx.destination); s.start();
    return (await ctx.startRendering()).getChannelData(0);
  }
  // Where to cut: up to MAX_PIECE s from a, at the quietest 100 ms between MIN_PIECE and MAX_PIECE (else the end)
  function pieces(x) {
    const out = [], F = SR / 10;
    for (let a = 0; a < x.length;) {
      let z = Math.min(x.length, a + MAX_PIECE * SR);
      if (z < x.length) {
        let best = z, low = Infinity;
        for (let f = a + MIN_PIECE * SR; f + F <= z; f += F) {
          let e = 0; for (let i = f; i < f + F; i += 4) e += x[i] * x[i];
          if (e < low) { low = e; best = f + F / 2; }
        }
        z = Math.round(best);
      }
      let e = 0; for (let i = a; i < z; i += 8) e += x[i] * x[i];
      out.push({ a, z, quiet: e / ((z - a) / 8) < 1e-6 });   // (under −60 dBFS on average: nothing to hear)
      a = z;
    }
    return out;
  }

  function mount(box, o) {
    style();
    box.classList.add('cw-box');
    box.innerHTML = `<div class="cw-head"><button type="button" class="cw-go">Transcribe</button>` +
      `<select class="cw-model" title="A bigger model is more accurate and slower">${Object.entries(MODELS).map(([k, m]) => `<option value="${k}">${k.replace('.en', '')} (${'gpu' in navigator ? m.gpu : m.cpu})</option>`).join('')}</select>` +
      `<input class="cw-find" type="search" placeholder="Find words…" aria-label="Find words in the transcript" hidden>` +
      `<span class="cw-note">What’s said, so you can find the words: transcribed on this computer (English; the speech model is fetched once and kept by the browser).</span></div>` +
      `<div class="cw-lines"></div>`;
    const $ = s => box.querySelector(s), key = o.key ? 'words:' + o.key : null;
    $('.cw-model').value = model();
    let lines = [], upto = 0, done = false, worker = null, stopped = false, mod = model(), shown = null;
    let took = null;                                     // {secs, of, device}: how long the last run took, for how much sound
    const note = t => { $('.cw-note').textContent = t; };
    const store = () => window.videoStore || null;
    function save() { if (key && store()) store().put(key, { model: mod, lines, upto, done, took, at: Date.now() }).catch(() => {}); }
    function render() {
      const words = $('.cw-find').value.toLowerCase().split(/\s+/).filter(Boolean);
      const hit = l => words.every(w => l.text.toLowerCase().includes(w));
      const list = words.length ? lines.filter(hit) : lines;
      const re = words.length ? new RegExp('(' + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi') : null;
      const mark = t => (re ? String(t).split(re).map((part, k) => (k % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part))).join('') : esc(t));   // (split on the words: odd parts are them)
      $('.cw-lines').innerHTML = list.map(l => `<div class="cw-line${shown === l.at ? ' cw-now' : ''}" data-at="${l.at}" data-to="${l.to}"><button type="button" data-cw="play" title="Play from here">▶</button><span class="cw-t">${clock(l.at)}</span>` +
        `<span class="cw-text">${mark(l.text)}</span><button type="button" data-cw="start" title="The clip starts here">Start</button><button type="button" data-cw="end" title="The clip ends where this line does">End</button></div>`).join('')
        || (words.length && lines.length ? '<div class="cw-note">Not said, as far as it’s got.</div>' : '');
      $('.cw-find').hidden = !lines.length;
    }
    function status() {
      const speed = took && took.secs > 0 ? `: ${clock(took.of)} transcribed in ${clock(took.secs)} (${took.of / took.secs >= 1 ? (took.of / took.secs).toFixed(1) + '× faster than' : (took.secs / took.of).toFixed(1) + '× slower than'} real time, ${took.device === 'webgpu' ? 'graphics chip' : 'processor'})` : '';
      if (done) note(`${lines.length} line${lines.length === 1 ? '' : 's'} (Whisper ${mod.replace('.en', '')}${speed}). Find words, then ▶ to hear, Start / End to cut there.`);
      else if (upto > 0 && !worker) note(`Transcribed up to ${clock(upto)} of ${clock(o.buf.duration)}: Transcribe carries on from there.`);
    }
    async function run() {
      stopped = false;
      mod = $('.cw-model').value; try { localStorage.setItem(MODEL_KEY, mod); } catch (_) { /* private mode */ }
      $('.cw-go').textContent = 'Stop'; $('.cw-model').disabled = true;
      note('Getting the sound ready…');
      const x = await at16k(o.buf), list = pieces(x).filter(p => p.z / SR > upto + 0.5);
      let device = 'wasm';
      try { if (navigator.gpu && await navigator.gpu.requestAdapter()) device = 'webgpu'; } catch (_) { /* none */ }
      if (stopped) return finish();
      worker = new Worker(new URL('assist-asr.js', location.href), { type: 'module' });
      const files = {};
      const ask = msg => new Promise(res => {
        worker.onmessage = ev => {
          const m = ev.data || {};
          if (m.t === 'progress') {
            const p = m.p || {};
            if (p.file && p.total) files[p.file] = [p.loaded || 0, p.total];
            const all = Object.values(files), got = all.reduce((a, f) => a + f[0], 0), of = all.reduce((a, f) => a + f[1], 0);
            if (p.status === 'progress' && of) note(`Fetching the speech model: ${Math.round(100 * got / of)}% of ${Math.round(of / 1e6)} MB (once: kept by the browser after that)`);
          } else res(m);
        };
        worker.postMessage(msg);
      });
      worker.onerror = ev => { note('The speech model stopped: ' + (ev.message || 'error')); finish(); };
      const r = await ask({ t: 'load', model: MODELS[mod].id, device });
      if (r.t === 'error') { note('The speech model didn’t load: ' + r.error); return finish(); }
      const t0 = performance.now(), from = upto;
      for (const p of list) {
        if (stopped) break;
        const a = p.a / SR, z = p.z / SR;
        const left = upto > from ? (performance.now() - t0) / 1000 / (upto - from) * (o.buf.duration - upto) : null;
        note(`Transcribing (${device === 'webgpu' ? 'graphics chip' : 'processor: slower'}): ${clock(upto)} of ${clock(o.buf.duration)}${left != null ? ', about ' + clock(left) + ' to go' : ''}…`);
        if (!p.quiet) {
          const m = await ask({ t: 'run', audio: x.slice(p.a, p.z), ts: true });
          if (stopped) break;
          const ts = (c, k) => (c.timestamp && Number.isFinite(c.timestamp[k]) ? c.timestamp[k] : null);
          const got = (m.chunks && m.chunks.length ? m.chunks : [{ text: m.text, timestamp: [0, null] }])
            .map(c => ({ at: Math.round((a + (ts(c, 0) || 0)) * 100) / 100, to: Math.round(Math.min(z, a + (ts(c, 1) ?? (z - a))) * 100) / 100, text: String(c.text || '').trim() }))
            .filter(l => l.text && !JUNK.test(l.text));
          lines.push(...got);
        }
        upto = z;
        save();                                          // (as it goes: a page closed now keeps what's done)
        render();
      }
      took = { secs: Math.max(0.1, (performance.now() - t0) / 1000), of: upto - from, device };   // (the model already loaded: the transcribing alone)
      console.log(`[clip-words] ${clock(took.of)} of sound transcribed in ${took.secs.toFixed(1)} s (Whisper ${mod}, ${device})`);
      if (!stopped) done = true;
      save();
      finish();
    }
    function finish() {
      if (worker) { worker.terminate(); worker = null; }
      if (upto > 0) save();
      $('.cw-go').textContent = done ? 'Transcribe again' : 'Transcribe'; $('.cw-model').disabled = false;
      render(); status();
    }
    $('.cw-go').addEventListener('click', e => {
      e.currentTarget.blur();
      if (worker || $('.cw-go').textContent === 'Stop') { stopped = true; finish(); return; }
      if (done) { lines = []; upto = 0; done = false; }       // (again: another model, say)
      run().catch(err => { note('Couldn’t transcribe: ' + (err && err.message || err)); stopped = true; finish(); });
    });
    $('.cw-find').addEventListener('input', render);
    $('.cw-lines').addEventListener('click', e => {
      const b = e.target.closest('button[data-cw]'), l = b && b.closest('.cw-line');
      if (!l) return;
      b.blur();
      const at = Number(l.dataset.at), to = Number(l.dataset.to);
      shown = at;
      if (b.dataset.cw === 'play') o.play(at); else if (b.dataset.cw === 'start') o.setStart(at); else o.setEnd(to);
      render();
    });
    // A transcript kept from before: shown at once (a stopped one carries on from where it got to)
    if (key && store()) store().get(key).then(v => {
      if (!v || !Array.isArray(v.lines) || worker) return;
      lines = v.lines.filter(l => l && Number.isFinite(l.at) && typeof l.text === 'string');
      upto = Number(v.upto) || 0; done = !!v.done; mod = MODELS[v.model] ? v.model : mod; $('.cw-model').value = mod;
      took = v.took && Number.isFinite(v.took.secs) && Number.isFinite(v.took.of) ? v.took : null;
      $('.cw-go').textContent = done ? 'Transcribe again' : 'Transcribe';
      render(); status();
    }).catch(() => {});
    return { stop() { stopped = true; if (worker) { worker.terminate(); worker = null; } }, find: t => { $('.cw-find').value = t; render(); } };
  }

  return { on, mount, keyOf, MODELS };
})();
