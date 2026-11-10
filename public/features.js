/*!
 * features.js — features still on trial: on for the alpha site (alpha.*) and local testing only.
 *   TimerFeatures.pptx   PowerPoint computers (pptx-hub.js, pptx.html, the run sheet's Slides column)
 *   TimerFeatures.glasses  the share panel's Glasses box: type the code a pair of Even G2 glasses shows. Also on
 *                          beta (both its addresses): the glasses' server, so the only place their code can be taken
 *   TimerFeatures.assist   the assist station (assist.html; the timer ignores its messages without it)
 *   TimerFeatures.stings   walk-up stings on run sheet items (sting-player.js; the editor's + sting)
 *   TimerFeatures.playout  playout computers (playout.html; the timer sends them the run sheet)
 * Off, their controls are hidden (html.no-pptx) and their code doesn't start. The Cloudflare Worker
 * enforces the same on its side (FEATURES: no PowerPoint or assist pages, no PowerPoint keys), so hiding isn't the only lock.
 * A test can set window.TimerFeatures before this loads.
 * MIT Licensed
 */
var TimerFeatures = window.TimerFeatures || (function () {
  const h = location.hostname;
  const trial = /^alpha\./.test(h) || h === 'localhost' || h === '127.0.0.1';
  const glassesServer = h === 'beta.timed-show.com' || h === 'timer-beta.sophtwhere.com';   // where the glasses' codes live
  return { pptx: trial, glasses: trial || glassesServer, assist: trial, stings: trial, playout: trial };
})();
if (!TimerFeatures.pptx) document.documentElement.classList.add('no-pptx');
