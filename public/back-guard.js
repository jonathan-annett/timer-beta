/*!
 * back-guard.js
 * The browser's Back button (and the swipe-back gesture) on the timer and the phone remote.
 * Pressing it closes whatever is open on top of the page (help, a menu, a sheet); when nothing
 * is open it does nothing, instead of leaving the page in the middle of a talk.
 *
 * How: a sentinel entry is pushed onto the history, so Back pops that instead of leaving;
 * popstate then asks the registered closers in turn, and the sentinel is pushed again.
 *
 *   BackGuard.install();            once per page (safe to call again)
 *   BackGuard.register(fn);         fn() → true if it closed something (checked newest first)
 * MIT Licensed
 */

var BackGuard = (function () {
  'use strict';

  const closers = [];
  let installed = false;

  function arm() {
    try { history.pushState({ backGuard: true }, '', location.href); } catch (_) { /* file: or sandbox */ }
  }

  function install() {
    if (installed) return;
    installed = true;
    arm();
    window.addEventListener('popstate', () => {
      // The sentinel was popped (Back, or swipe back). Close the topmost thing, then re-arm so
      // the next Back is caught too. Re-arm after a tick: some browsers ignore a pushState made
      // inside the popstate handler of a swipe gesture.
      for (let i = closers.length - 1; i >= 0; i--) {
        let done = false;
        try { done = !!closers[i](); } catch (_) { /* a broken closer shouldn't block the rest */ }
        if (done) break;
      }
      setTimeout(arm, 0);
    });
  }

  function register(fn) { if (typeof fn === 'function') closers.push(fn); }

  return { install, register };
})();
