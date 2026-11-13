/*!
 * features.js — features still on trial: on for the alpha site (alpha.*) and local testing only.
 *   TimerFeatures.glasses  the share panel's Glasses box: type the code a pair of Even G2 glasses shows. Also on
 *                          beta (both its addresses): the glasses' server, so the only place their code can be taken
 *   TimerFeatures.assist   the assist station (assist.html; the timer ignores its messages without it)
 *   TimerFeatures.stings   walk-up stings on run sheet items (sting-player.js; the editor's + sting; clips, the
 *                          library, levels): also on beta (both its addresses) since 11 Nov 2026
 *   TimerFeatures.playout  playout computers (playout.html; the timer sends them the run sheet): also on beta
 *                          (both its addresses) since 12 Nov 2026
 *   TimerFeatures.styles   music styles of stings (sting-styles.js): the + sting dialog's style search, Random
 *                          stings' style (alpha only)
 *   TimerFeatures.transcribe  Transcribe and find words in the clip editor (clip-words.js; alpha only: it uses the
 *                          assist station's speech worker, which the hosted site serves only with the assist trial)
 * Off, their controls are hidden and their code doesn't start. The Cloudflare Worker enforces the same
 * on its side (FEATURES: no assist or playout pages), so hiding isn't the only lock.
 * A test can set window.TimerFeatures before this loads.
 * MIT Licensed
 */
var TimerFeatures = window.TimerFeatures || (function () {
  const h = location.hostname;
  const trial = /^alpha\./.test(h) || h === 'localhost' || h === '127.0.0.1';
  const beta = h === 'beta.timed-show.com' || h === 'timer-beta.sophtwhere.com';   // the glasses' server (where their codes live); stings, playout
  return { glasses: trial || beta, assist: trial, stings: trial || beta, playout: trial || beta, styles: trial, transcribe: trial };
})();
