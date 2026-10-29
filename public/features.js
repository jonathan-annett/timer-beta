/*!
 * features.js — features still on trial: on for the alpha site (alpha.*) and local testing only.
 *   TimerFeatures.pptx   PowerPoint computers (pptx-hub.js, pptx.html, the run sheet's Slides column)
 * Off, their controls are hidden (html.no-pptx) and their code doesn't start. The Cloudflare Worker
 * enforces the same on its side (FEATURES: no PowerPoint pages or keys), so hiding isn't the only lock.
 * A test can set window.TimerFeatures before this loads.
 * MIT Licensed
 */
var TimerFeatures = window.TimerFeatures || (function () {
  const h = location.hostname;
  const trial = /^alpha\./.test(h) || h === 'localhost' || h === '127.0.0.1';
  return { pptx: trial };
})();
if (!TimerFeatures.pptx) document.documentElement.classList.add('no-pptx');
