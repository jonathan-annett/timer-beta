/*!
 * features.js — features still on trial: on for the alpha site (alpha.*) and local testing only.
 *   TimerFeatures.glasses  the share panel's Glasses box: type the code a pair of Even G2 glasses shows. Also on
 *                          beta (both its addresses): the glasses' server, so the only place their code can be taken
 *   TimerFeatures.assist   the assist station (assist.html; the timer ignores its messages without it)
 *   TimerFeatures.stings   walk-up stings on run sheet items (sting-player.js; the editor's + sting; clips, the
 *                          library, levels): also on beta (both its addresses) since 11 Nov 2026
 *   TimerFeatures.playout  playout computers (playout.html; the timer sends them the run sheet): also on beta
 *                          (both its addresses) since 12 Nov 2026
 *   TimerFeatures.styles   music styles of stings (sting-styles.js): the + sting dialog's style chips, Random
 *                          stings' styles, from the stock stings' styles worked out offline (the site's sync, with
 *                          MTG's model): also on beta since 14 Nov 2026, where your own files count as in the lit styles
 *   TimerFeatures.listen   your own files listened to for their styles in the browser (the model runs here: alpha
 *                          only; the owner, 14 Nov 2026: the model itself stays off beta)
 *   TimerFeatures.webhid   Stream Decks through the webhid site's frame (webhid-client.js; alpha: webhid-alpha.timed-show.com;
 *                          locally only with ?webhid=<frame url>), else the page's own WebHID as before
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
  return { glasses: trial || beta, assist: trial, stings: trial || beta, playout: trial || beta, styles: trial || beta, listen: trial, transcribe: trial, webhid: trial };
})();
