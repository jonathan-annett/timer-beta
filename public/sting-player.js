/*!
 * sting-player.js
 * Walk-up stings (a trial: TimerFeatures.stings): a short piece of music or video that plays as a run
 * sheet item starts. Unlike an item's video it doesn't set the timer: the item keeps its own duration
 * and the sting just plays over its start. Always on this computer (the timer owns it): audio stings
 * play from this page, video stings in the player window (dropPlayer.js, its sting mode).
 * item.sting is {src: 'file'|'link'|'stock', media: 'audio'|'video', name, duration, key?, url?, size?}:
 * key = the copy in this browser (video-store.js, 'rssting:'), url = where a link or stock sting
 * came from (played from there only if it couldn't be kept here).
 *
 * window.stingPlayer:
 *   play(item)     play the item's sting (the last one, if still playing, stops: a 0.3 s fade).
 *                  Resolves true, or 'missing' (not stored, no link) or 'no-player' (a video sting
 *                  and the player window is closed and can't be opened without a click)
 *   preload(item)  get it ready so Next starts it at once (audio here; video cued in the player)
 *   fadeOut(ms)    the playing sting fades out (the operator's Fade out: 3 s)
 *   stop(itemId?)  stop at once (Back: only the undone item's; a video item, run sheet off: any)
 *   state()        {audio: {id, name} | null, video: {id, name} | null}
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
  const tagOf = item => 'sting:' + item.id;
  let cur = null;                         // the audio sting playing: {id, name, el, url}
  let ready = null;                       // the next one, loaded: {id, key, el, url}
  const fading = new Set();

  // Where to play it from: the copy kept in this browser, else its link
  async function source(sting) {
    if (sting.key && window.videoStore) {
      try {
        const blob = await window.videoStore.get(sting.key);
        if (blob) return { url: URL.createObjectURL(blob), revoke: true };
      } catch (_) { /* not there */ }
    }
    return sting.url ? { url: sting.url, revoke: false } : null;
  }
  const sameSting = (a, b) => a && b && (a.key || a.url) === (b.key || b.url);

  function release(a) {
    if (!a) return;
    try { a.el.pause(); a.el.removeAttribute('src'); a.el.load(); } catch (_) { /* gone */ }
    if (a.revoke) URL.revokeObjectURL(a.url);
  }

  // Volume ramps on a worker's tick: a background tab slows the page's own timers to once a second
  function ramp(a, ms, done) {
    fading.add(a);
    const steps = Math.max(1, Math.round(ms / 50)), from = a.el.volume;
    let n = 0, w = null;
    const tick = () => {
      n++;
      a.el.volume = Math.max(0, from * (1 - n / steps));
      if (n >= steps) { if (w) w.terminate(); else clearInterval(iv); fading.delete(a); done(); }
    };
    let iv = 0;
    try {
      w = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},50)'], { type: 'text/javascript' })));
      w.onmessage = tick;
    } catch (_) { w = null; iv = setInterval(tick, 50); }
  }

  async function loadAudio(item) {
    const src = await source(item.sting);
    if (!src) return null;
    const el = new Audio();
    el.preload = 'auto';
    el.src = src.url;
    return { id: item.id, key: item.sting.key || item.sting.url, name: item.sting.name, el, url: src.url, revoke: src.revoke };
  }

  function audioFade(ms) {
    if (!cur) return;
    const a = cur; cur = null;
    ramp(a, ms, () => { release(a); update(); });
    update();
  }

  async function play(item) {
    const s = item && item.sting;
    if (!s) return false;
    if (s.media === 'video') return playVideo(item);
    audioFade(FADE_MS);
    if (window.videoPlayer) window.videoPlayer.fadeOut(FADE_MS);
    let a = ready && ready.id === item.id && ready.key === (s.key || s.url) ? ready : null;
    if (a) ready = null; else a = await loadAudio(item);
    if (!a) return 'missing';
    cur = a;
    a.el.volume = 1;
    a.el.onended = () => { if (cur === a) { cur = null; release(a); } update(); };
    a.el.onplaying = update;
    try { await a.el.play(); } catch (err) {
      if (cur === a) cur = null;
      release(a);
      if (window.videoPlayer) window.videoPlayer.toast('The browser didn’t let the walk-up sting play. Click anywhere on the timer page once, then try again.');
      return false;
    }
    return true;
  }

  async function cue(item) {
    const p = window.videoPlayer;
    if (!p || !p.isOpen()) return false;
    const src = await source(item.sting);
    if (!src) return false;
    return p.load(src.url, { name: item.sting.name, idle: 'hide', controls: false, revoke: src.revoke, tag: tagOf(item), sting: true });
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
    if (ready && ready.id === item.id && sameSting({ key: ready.key }, { key: s.key || s.url })) return;
    if (ready) { release(ready); ready = null; }
    ready = await loadAudio(item);
  }

  function fadeOut(ms) {
    audioFade(ms || FADE_MS);
    if (window.videoPlayer) window.videoPlayer.fadeOut(ms || FADE_MS);
  }

  function stop(itemId) {
    if (cur && (!itemId || cur.id === itemId)) { release(cur); cur = null; }
    if (!itemId) fading.forEach(a => { a.el.volume = 0; });
    const p = window.videoPlayer, st = p && p.state();
    if (st && st.playing && st.playing.sting && (!itemId || st.playing.tag === 'sting:' + itemId)) p.stop({ quiet: true });
    update();
  }

  function state() {
    const st = window.videoPlayer && window.videoPlayer.state();
    return {
      audio: cur ? { id: cur.id, name: cur.name, volume: cur.el.volume, paused: cur.el.paused } : null,
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
    const el = cur ? cur.el : null;
    bar.querySelector('.sb-time').textContent = el && isFinite(el.duration) ? mmss(el.currentTime) + ' / ' + mmss(el.duration) : '';
  }
  setInterval(update, 500);

  window.stingPlayer = { play, preload, fadeOut, stop, state };
})();
