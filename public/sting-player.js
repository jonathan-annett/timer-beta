/*!
 * sting-player.js
 * Walk-up stings (a trial: TimerFeatures.stings): a short piece of music or video that plays as a run
 * sheet item starts. Unlike an item's video it doesn't set the timer: the item keeps its own duration
 * and the sting just plays over its start. Always on this computer (the timer owns it): audio stings
 * play from this page, video stings in the player window (dropPlayer.js, its sting mode).
 * item.sting is {src: 'file'|'link'|'stock', media: 'audio'|'video', name, duration, key?, url?, size?}:
 * key = the copy in this browser (video-store.js, 'rssting:'), url = where a link or stock sting
 * came from (played from there only if it couldn't be kept here). A clip (start, end, fadeIn, fadeOut,
 * loop: sting-clip.js) plays only that part: cut in memory when it's loaded (up to 3 minutes, from a
 * track up to 10; otherwise it streams, seeked and stopped, and a loop isn't heard), so Next starts it
 * at once and exactly.
 *
 * window.stingPlayer:
 *   play(item)     play the item's sting (the last one, if still playing, stops: a 0.3 s fade).
 *                  Resolves true, or 'missing' (not stored, no link) or 'no-player' (a video sting
 *                  and the player window is closed and can't be opened without a click)
 *   preload(item)  get it ready so Next starts it at once (audio here; video cued in the player)
 *   fadeOut(ms)    the playing sting fades out (the operator's Fade out: 3 s)
 *   stop(itemId?)  stop at once (Back: only the undone item's; a video item, run sheet off: any)
 *   state()        {audio: {id, name} | null, video: {id, name} | null}
 *   tone(on, lufs) the 1 kHz line-up tone at lufs (default: the level stings play at), on, off or toggled
 * A sting plays to its end (long tracks cover activity on stage) unless the operator fades it (the
 * sting bar on the operator's screen, the Stream Deck's Fade sting key: the stingfade command) or
 * another sting (or a video item) starts: an item without one leaves it playing, so an introduction
 * over a sting can be followed by the speaker's countdown. Bus: sting_playing and sting_name.
 * MIT Licensed
 */
(function () {
  'use strict';
  if (new URLSearchParams(location.search).has('presenter')) return;

  const FADE_MS = 300, OPERATOR_FADE_MS = 3000;   // FADE_MS: a new sting stopping the last (a clean cut, no click)
  const MEMORY_MAX = 180;                         // a clip up to this long (s) is played from memory; longer ones stream
  const tagOf = item => 'sting:' + item.id;
  const clip = s => (window.StingClip ? StingClip.region(s) : null);
  const keyOf = s => (s.key || s.url) + '#' + JSON.stringify(clip(s) || {});   // the same sting, cut the same way
  // Its level as it starts (sting-clip.js gainFor: its trim, and down to the show's level): worked out
  // at play time, so a new show level applies at once
  const gainOf = s => (window.StingClip && StingClip.gainFor ? StingClip.gainFor(s) : 1);
  let cur = null;                         // the audio sting playing: a voice (below)
  let ready = null;                       // the next one, loaded
  const fading = new Set();

  // Where to play it from: the copy kept in this browser, else its link
  async function source(sting) {
    if (sting.key && window.videoStore) {
      try {
        const blob = await window.videoStore.get(sting.key);
        if (blob) return { url: URL.createObjectURL(blob), blob, revoke: true };
      } catch (_) { /* not there */ }
    }
    return sting.url ? { url: sting.url, revoke: false } : null;
  }

  // A worker's tick: a background tab slows the page's own timers to once a second
  function tick(ms, fn) {
    let w = null, iv = 0;
    try {
      w = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},' + ms + ')'], { type: 'text/javascript' })));
      w.onmessage = fn;
    } catch (_) { iv = setInterval(fn, ms); }
    return () => { if (w) w.terminate(); else clearInterval(iv); };
  }
  function rampEl(el, to, ms, done) {
    const steps = Math.max(1, Math.round(ms / 50)), from = el.volume;
    let n = 0;
    const stop = tick(50, () => {
      n++;
      el.volume = Math.max(0, Math.min(1, from + (to - from) * n / steps));
      if (n >= steps) { stop(); if (done) done(); }
    });
    return stop;
  }

  // ─── Voices: one sting, ready to play ─────────────────────────────────────
  // From memory (a clip: the part cut out with its fades, sample-exact and instant), or streamed by an
  // <audio> element (a whole track, a long part, or one its server won't let us read), seeked to the
  // start, faded in, and stopped (faded) at its end.
  function bufferVoice(item, buf) {
    let p = null;
    const v = {
      id: item.id, key: item.loop ? 'tone' : keyOf(item.sting), name: item.sting.name, onended: null,
      async play() { p = StingClip.play(buf, { loop: !!item.loop }); p.gain.gain.value = item.loop ? 1 : gainOf(item.sting); p.ended.then(() => { p = null; if (v.onended) v.onended(); }); },
      fade(ms) { if (p) p.fade(ms); else if (v.onended) v.onended(); },
      stop() { if (p) p.stop(); },
      release() {},
      get volume() { return p ? p.gain.gain.value : 0; },
      get playing() { return !!p; },
      get time() { return p ? p.time() : 0; },
      get duration() { return item.loop ? null : buf.duration; },
    };
    return v;
  }
  function elementVoice(item, src) {
    const r = clip(item.sting) || {}, start = r.start || 0;
    const el = new Audio();
    el.preload = 'auto';
    el.src = src.url;
    if (start) el.addEventListener('loadedmetadata', () => { el.currentTime = start; }, { once: true });
    let stopEnd = null, stopRamp = null, over = false;
    const finish = () => { if (over) return; over = true; if (stopEnd) stopEnd(); if (stopRamp) stopRamp(); el.pause(); if (v.onended) v.onended(); };
    const v = {
      id: item.id, key: keyOf(item.sting), name: item.sting.name, onended: null,
      async play() {
        const g = gainOf(item.sting);
        if (start && Math.abs(el.currentTime - start) > 0.25) el.currentTime = start;
        el.volume = r.fadeIn ? 0 : g;
        el.onended = finish;
        await el.play();
        if (r.fadeIn) stopRamp = rampEl(el, g, r.fadeIn);
        if (r.end != null) stopEnd = tick(50, () => {            // the end of the part: fade out there
          if (el.currentTime >= r.end - (r.fadeOut || 0) / 1000) { stopEnd(); stopEnd = null; v.fade(r.fadeOut || 30); }
        });
      },
      fade(ms) { if (stopRamp) stopRamp(); stopRamp = rampEl(el, 0, ms, finish); },
      stop() { finish(); },
      release() {
        try { el.pause(); el.removeAttribute('src'); el.load(); } catch (_) { /* gone */ }
        if (src.revoke) URL.revokeObjectURL(src.url);
      },
      get volume() { return el.volume; },
      get playing() { return !over && !el.paused; },
      get time() { return Math.max(0, el.currentTime - start); },
      get duration() { const end = r.end != null ? r.end : el.duration; return isFinite(end) ? end - start : null; },
    };
    return v;
  }
  async function loadAudio(item) {
    const s = item.sting, src = await source(s);
    if (!src) return null;
    const len = window.StingClip ? StingClip.length(s, s.duration) : null;
    const tooBig = s.duration > ((window.StingClip && StingClip.LIMITS.source) || Infinity);   // the whole track is decoded: not an hour's worth
    if (clip(s) && len != null && len <= MEMORY_MAX && !tooBig) {
      try {
        const buf = StingClip.render(await StingClip.decode(src.blob || src.url), s);
        if (src.revoke) URL.revokeObjectURL(src.url);
        return bufferVoice(item, buf);
      } catch (err) { console.warn('Walk-up sting: couldn’t cut the clip in memory, streaming it instead', err); }
    }
    if (clip(s) && clip(s).loop) console.warn('Walk-up sting: its loop needs it in memory; playing it without the loop');
    return elementVoice(item, src);
  }

  function audioFade(ms) {
    if (!cur) return;
    const a = cur; cur = null;
    fading.add(a);
    a.onended = () => { fading.delete(a); a.release(); update(); };
    a.fade(ms);
    update();
  }

  async function play(item) {
    const s = item && item.sting;
    if (!s) return false;
    if (s.media === 'video') return playVideo(item);
    audioFade(FADE_MS);
    if (window.videoPlayer) window.videoPlayer.fadeOut(FADE_MS);
    let a = ready && ready.id === item.id && ready.key === keyOf(s) ? ready : null;
    if (a) ready = null; else a = await loadAudio(item);
    if (!a) return 'missing';
    cur = a;
    a.onended = () => { if (cur === a) cur = null; fading.delete(a); a.release(); update(); };
    try { await a.play(); } catch (err) {
      if (cur === a) cur = null;
      a.release();
      if (window.videoPlayer) window.videoPlayer.toast('The browser didn’t let the walk-up sting play. Click anywhere on the timer page once, then try again.');
      return false;
    }
    update();
    return true;
  }

  async function cue(item) {
    const p = window.videoPlayer;
    if (!p || !p.isOpen()) return false;
    const src = await source(item.sting);
    if (!src) return false;
    return p.load(src.url, { name: item.sting.name, idle: 'hide', controls: false, revoke: src.revoke, tag: tagOf(item), sting: true, region: clip(item.sting), volume: gainOf(item.sting) });
  }

  async function playVideo(item) {
    const p = window.videoPlayer;
    if (!p) return false;
    audioFade(FADE_MS);
    if (!p.isOpen() && !p.open()) return 'no-player';     // opening it needs a key press or a click
    const st = p.state();
    if (!(st.cued && st.cued.tag === tagOf(item))) {
      if (!item.sting.key && !item.sting.url) return 'missing';
      if (!(await cue(item))) return 'missing';
    }
    return p.play();
  }

  async function preload(item) {
    const s = item && item.sting;
    if (!s) return;
    if (s.media === 'video') {
      const st = window.videoPlayer && window.videoPlayer.state();
      if (st && st.cued && !st.cued.tag) return;            // a dropped video is waiting: leave it
      if (st && st.cued && st.cued.tag === tagOf(item)) return;
      await cue(item);
      return;
    }
    if (ready && ready.id === item.id && ready.key === keyOf(s)) return;
    if (ready) { ready.release(); ready = null; }
    const v = await loadAudio(item);
    if (ready) ready.release();
    ready = v;
  }

  // The line-up tone (the run sheet editor's Options, the tone command): 1 kHz at the level stings are
  // brought down to (the show's, else the house level), until stopped; in the sting bar like a sting
  function tone(on, lufs) {
    const isTone = cur && cur.id === 'tone';
    if (on === false || (on == null && isTone)) { if (isTone) stop('tone'); return false; }
    if (!window.StingClip) return false;
    const level = Number.isFinite(lufs) ? lufs : StingClip.target();
    audioFade(FADE_MS);
    const a = bufferVoice({ id: 'tone', loop: true, sting: { name: '1 kHz line-up tone · ' + level.toFixed(1) + ' LUFS' } }, StingClip.toneBuffer(level));
    cur = a;
    a.onended = () => { if (cur === a) cur = null; fading.delete(a); update(); };
    a.play();
    update();
    return true;
  }

  function fadeOut(ms) {
    audioFade(ms || FADE_MS);
    if (window.videoPlayer) window.videoPlayer.fadeOut(ms || FADE_MS);
  }

  function stop(itemId) {
    if (cur && (!itemId || cur.id === itemId)) { const a = cur; cur = null; a.onended = null; a.stop(); a.release(); }
    if (!itemId) fading.forEach(a => { a.onended = null; a.stop(); a.release(); fading.delete(a); });
    const p = window.videoPlayer, st = p && p.state();
    if (st && st.playing && st.playing.sting && (!itemId || st.playing.tag === 'sting:' + itemId)) p.stop({ quiet: true });
    update();
  }

  function state() {
    const st = window.videoPlayer && window.videoPlayer.state();
    return {
      audio: cur ? { id: cur.id, name: cur.name, volume: cur.volume, paused: !cur.playing, duration: cur.duration } : null,
      fading: fading.size,
      video: st && st.playing && st.playing.sting ? { id: String(st.playing.tag).slice(6), name: st.playing.name } : null,
    };
  }

  // ─── On the bus (the deck's Fade sting key), and the sting bar on the operator's screen ───
  let lastBus = '';
  function update() {
    const st = state(), on = st.audio || st.video, name = on ? on.name : '';
    const bus = (on ? '1' : '0') + name;
    if (bus !== lastBus && window.timerAPI) {
      lastBus = bus;
      window.timerAPI.send({ setVariableValues: { sting_playing: !!on, sting_name: name } });
    }
    renderBar(on);
  }
  const CSS = `
#sting-bar { position: fixed; left: 50%; bottom: 76px; transform: translateX(-50%); z-index: 2147481001; display: flex; align-items: center; gap: 10px;
  background: #1a1408; border: 1px solid #6b5420; border-radius: 8px; padding: 6px 10px; color: #f0d890; font: 14px "Helvetica Neue", Arial, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.5); }
#sting-bar[hidden] { display: none; }
#sting-bar .sb-time { color: #b8a060; font-variant-numeric: tabular-nums; }
#sting-bar button { font: 13px "Helvetica Neue", Arial, sans-serif; color: #fff; background: #3a2e12; border: 1px solid #8a6c28; border-radius: 5px; padding: 3px 10px; cursor: pointer; }
#sting-bar button:hover { background: #4a3a18; }
#sting-bar.fading { opacity: .6; }
html.reduced #sting-bar { display: none; }`;
  let bar = null;
  const mmss = sec => { sec = Math.max(0, Math.floor(sec || 0)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
  function renderBar(on) {
    if (!bar) {
      if (!on) return;
      const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
      bar = document.createElement('div');
      bar.id = 'sting-bar';
      bar.innerHTML = '<span>🎵</span><span class="sb-name"></span><span class="sb-time"></span>' +
        '<button data-a="fade" title="Fade the sting out over 3 seconds (the Stream Deck\'s Fade sting key does the same)">Fade out</button><button data-a="stop" title="Stop it now">Stop</button>';
      bar.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        b.blur();                                        // the timer's keys keep working
        if (b.dataset.a === 'fade') fadeOut(OPERATOR_FADE_MS); else stop();
      });
      document.body.appendChild(bar);
    }
    bar.hidden = !on;
    if (!on) return;
    bar.querySelector('.sb-name').textContent = on.name;
    bar.querySelector('.sb-time').textContent = cur && cur.duration ? mmss(cur.time) + ' / ' + mmss(cur.duration) : '';
  }
  setInterval(update, 500);

  window.stingPlayer = { play, preload, fadeOut, stop, state, tone };
})();
