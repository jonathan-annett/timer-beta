/*!
 * remote-clock.js
 * The countdown on a shared device (phone, display, overlay), worked out here from the timer's
 * anchor rather than sent every second: the timer sends {r, e, d, rr, er, f, p, a} (timer.js
 * announceClock: remaining and elapsed ms with their rates, the total, before-the-start and paused
 * flags; a = ms since it was taken) only when something changes or this side would drift by more
 * than 150 ms. That keeps the pairing server quiet (its rooms can sleep) and costs nothing on a
 * direct link either. The device counts from when the anchor arrived (performance.now(), minus a),
 * so it runs behind by the one-way delay (tens of ms): invisible at one-second resolution.
 *
 *   const clock = RemoteClock.create(values => …)   called with {remain, over, impending, pct, standby}
 *                                                   whenever one of them changes
 *   clock.set(anchor)      a new anchor (state.clk)
 *   clock.values()         the current values, or null before the first anchor
 *
 * Ticks come from a tiny worker, so it keeps counting in a background or minimized window (browsers
 * slow a hidden page's own timers to once a second, then to once a minute).
 * MIT Licensed
 */
var RemoteClock = (function () {
  'use strict';

  // timer.js secToStr, exactly (the texts must match the timer's)
  function secToStr(sec) {
    const prefix = sec < 0 ? '-' : '';
    if (sec < 0) sec = 0 - sec;
    const min = Math.trunc(sec / 60) % 60, hr = Math.trunc(sec / 3600), sx = Math.trunc(sec % 60);
    const sx_ = (sx < 10 ? '0' : '') + sx;
    if (hr < 1) return prefix + min + ':' + sx_;
    return prefix + hr + ':' + (min < 10 ? '0' : '') + min + ':' + sx_;
  }

  // The values the timer shows at this moment for anchor c, aged dt ms (timer.js displayUpdate).
  // standby: the run sheet's standby notice ("Standing by." / "Standing by to start in 5:23…",
  // timer.js standbyText), or ''.
  function compute(c, dt) {
    const r = c.r + c.rr * dt, e = c.e + c.er * dt;
    const sa = c.s && c.sa >= 0 ? c.sa - dt : -1;
    const standby = !c.s ? '' : sa > 0 ? 'Standing by to start in ' + secToStr(Math.ceil(sa / 1000)) + '…' : 'Standing by.';
    if (c.f) return { remain: secToStr(c.d / 1000), over: false, impending: e > -60000, pct: 0, standby };   // before the start
    const s = r / 1000, over = s < 0;
    return {
      remain: over ? secToStr(-s) : secToStr(s + 1),
      over,
      impending: !over && e >= 0 && s <= 60,
      pct: over ? 100 : Math.max(0, Math.min(100, Math.floor(e / c.d * 100))) || 0,
      standby,
    };
  }

  function ticker(fn, ms) {
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},' + ms + ');'], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.onmessage = fn;
      w.onerror = () => { w.terminate(); setInterval(fn, ms); };
      return;
    } catch (_) { /* no workers: a plain timer */ }
    setInterval(fn, ms);
  }

  function create(onChange) {
    let anchor = null, at = 0, last = '';
    const valid = c => c && typeof c === 'object' && [c.r, c.e, c.d, c.rr, c.er].every(Number.isFinite) && c.d > 0;
    function values() { return anchor ? compute(anchor, performance.now() - at) : null; }
    function check() {
      const v = values();
      if (!v) return;
      const sig = v.remain + '|' + v.over + '|' + v.impending + '|' + v.pct + '|' + v.standby;
      if (sig !== last) { last = sig; onChange(v); }
    }
    ticker(check, 200);
    return {
      set(c) {
        if (!valid(c)) return;
        anchor = c;
        at = performance.now() - Math.max(0, Math.min(5000, Number(c.a) || 0));
        check();
      },
      values,
      get active() { return !!anchor; },
    };
  }

  return { create, secToStr, compute };
})();
if (typeof module !== 'undefined') module.exports = RemoteClock;
