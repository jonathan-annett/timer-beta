/*!
 * assist-asr.js
 * The assist station's transcriber (a module worker, started by AssistASR in assist-audio.js):
 * Whisper through transformers.js, on the graphics chip (WebGPU) or the processor (WebAssembly).
 * The library comes from jsDelivr (pinned) and the model from Hugging Face; the browser keeps both
 * after the first time. The audio never leaves this computer.
 *
 *   in:  {t:'load', model, device}       {t:'run', audio: Float32Array (16 kHz mono)}
 *   out: {t:'progress', p} {t:'ready'} {t:'error', error}   {t:'result', text, chunks:[{text, timestamp:[s, e]}]}
 * MIT Licensed
 */

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

env.allowLocalModels = false;
let asr = null;

self.onmessage = async ev => {
  const m = ev.data || {};
  if (m.t === 'load') {
    try {
      asr = await pipeline('automatic-speech-recognition', m.model, {
        device: m.device,
        // As Hugging Face's own WebGPU Whisper demo: the encoder in full precision, the decoder small
        dtype: m.device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
        progress_callback: p => self.postMessage({ t: 'progress', p: { status: p.status, file: p.file, loaded: p.loaded, total: p.total } }),
      });
      await asr(new Float32Array(16000));       // the first run compiles everything: do it now, not on the first phrase
      self.postMessage({ t: 'ready' });
    } catch (err) {
      self.postMessage({ t: 'error', error: String((err && err.message) || err) });
    }
  } else if (m.t === 'run') {
    try {
      const out = await asr(m.audio, { return_timestamps: true });
      self.postMessage({ t: 'result', text: out.text, chunks: (out.chunks || []).map(c => ({ text: c.text, timestamp: c.timestamp })) });
    } catch (err) {
      self.postMessage({ t: 'result', error: String((err && err.message) || err) });
    }
  }
};
