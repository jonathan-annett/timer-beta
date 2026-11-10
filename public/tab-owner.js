/*!
 * tab-owner.js
 * One timer tab runs the timer. Two control tabs each kept their own countdown in memory and both
 * wrote it, so after a run sheet Reset (handled by one) the screens flickered between them. The
 * first tab owns the timer and writes a heartbeat (localStorage timer_owner {id, t}) every second
 * from a worker tick, so a hidden tab keeps it. Another timer tab opened while it's alive turns
 * itself into a countdown view (?presenter&othertab: the presenter screen, which runs nothing of
 * its own) under a banner: "The timer is running in another tab", with Use this tab instead
 * (it claims the timer, reloading as a control tab; the old owner sees that and steps down to a
 * countdown view). When the owner closes, a countdown view takes over by itself. Presenter windows
 * (?presenter without othertab) are left alone. Loaded first on timer.html, before anything writes.
 * MIT Licensed
 */
(function () {
  'use strict';
  const KEY = 'timer_owner', CLAIM = 'timer_claim', FRESH = 5000, BEAT = 1000;
  const params = new URLSearchParams(location.search);
  const other = params.has('othertab');
  if (params.has('presenter') && !other) return;              // a presenter window: not a control tab
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (_) { return null; } };
  const fresh = o => !!o && typeof o.t === 'number' && Date.now() - o.t < FRESH;
  // The same address as a control tab (or a countdown view), keeping its other settings (?remote=…)
  function url(view) {
    const p = new URLSearchParams(location.search);
    p.delete('presenter'); p.delete('othertab');
    const rest = p.toString();
    return location.pathname + (view ? '?presenter&othertab' + (rest ? '&' + rest : '') : rest ? '?' + rest : '') + location.hash;
  }
  function tick(ms, fn) {                                      // a worker's tick: not slowed in a hidden tab
    try {
      const w = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},' + ms + ')'], { type: 'text/javascript' })));
      w.onmessage = fn;
      return () => w.terminate();
    } catch (_) { const iv = setInterval(fn, ms); return () => clearInterval(iv); }
  }
  const claimAndReload = () => { try { sessionStorage.setItem(CLAIM, '1'); } catch (_) { /* private mode */ } location.replace(url(false)); };

  if (!other) {
    // ─── A control tab: run the timer, unless another tab already does ───
    let claimed = false;
    try { claimed = sessionStorage.getItem(CLAIM) === '1'; sessionStorage.removeItem(CLAIM); } catch (_) { /* private mode */ }
    const me = Math.random().toString(36).slice(2);
    const owner = read();
    if (!claimed && fresh(owner)) {
      window.stop();                                           // first: nothing below runs (this tab mustn't write a thing)
      location.replace(url(true));                             // (after stop(), which would cancel it)
      return;
    }
    const beat = () => { try { localStorage.setItem(KEY, JSON.stringify({ id: me, t: Date.now() })); } catch (_) { /* private mode */ } };
    beat();
    const stop = tick(BEAT, () => {
      const o = read();
      if (o && o.id !== me && fresh(o)) { stop(); location.replace(url(true)); return; }   // another tab took over: step down
      beat();
    });
    addEventListener('pagehide', () => { const o = read(); if (o && o.id === me) localStorage.removeItem(KEY); });   // closed or reloaded: let another take over now
    window.timerOwner = { id: me };
    return;
  }

  // ─── A countdown view of the tab that runs the timer ───
  window.timerOwner = { other: true };
  const css = document.createElement('style');
  css.textContent = `
html body aside#othertab { position: fixed; left: 0; right: 0; top: 0; z-index: 2147483000; display: flex; gap: 14px; align-items: center; justify-content: center;
  background: #3a2a06; border-bottom: 1px solid #8a6c28; color: #f5dfa0; font: 15px "Helvetica Neue", Arial, sans-serif; padding: 10px 16px; }
html body aside#othertab button { font: inherit; color: #fff; background: #0b3d5c; border: 1px solid #2a6a9a; border-radius: 6px; padding: 5px 12px; cursor: pointer; }`;
  document.head.appendChild(css);
  const show = () => {
    const a = document.createElement('aside');
    a.id = 'othertab';
    a.innerHTML = '<span>The timer is running in another tab. This one just shows its countdown.</span><button type="button">Use this tab instead</button>';
    a.querySelector('button').addEventListener('click', claimAndReload);
    document.body.appendChild(a);
  };
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  // The tab running the timer closed (no heartbeat): this one takes over
  tick(BEAT, () => { if (!fresh(read())) claimAndReload(); });
})();
