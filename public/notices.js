/*!
 * notices.js
 * The timer's notices: the words every screen shows when the countdown is paused, in its last
 * minute, over time, or standing by (run sheet Reset show). One source for the timer, its presenter
 * window, phones, desktop displays and overlays, so they all say the same thing.
 *
 * The operator can change the words (the timer's ✎ notices panel, notice-panel.js). They're kept in
 * localStorage notice_words on the timer computer and reach devices with the state (words, a JSON
 * string from the bus variable notice_words). Blank or missing words fall back to the defaults.
 *
 *   TimerNotices.words(custom?)   the words to use: defaults + custom (object or JSON string;
 *                                 omitted: this computer's notice_words)
 *   TimerNotices.notice(s, w)     the notice for s = {standby, paused, over, impending, msgs, pausedFor}:
 *                                 standby (the text) always; paused always (+ " · 2:13" with pausedFor);
 *                                 last minute / over time only with the messages switch (M) on
 *   TimerNotices.standby(ms, w)   the standby notice, ms until the auto start (≤ 0 or null: none)
 * MIT Licensed
 */
var TimerNotices = (function () {
  'use strict';

  const DEFAULTS = {
    wrap: '⏳ Wrap up – last minute',
    over: '⏰ Time’s up',
    paused: '⏸️ Paused',
    standby: '🎬 Standing by',
    standbyIn: '🎬 Standing by · starts in {t}',
  };
  const KEY = 'notice_words';
  const MAX = 80;

  // timer.js secToStr for whole positive seconds (m:ss, h:mm:ss)
  function clock(sec) {
    const hr = Math.trunc(sec / 3600), min = Math.trunc(sec / 60) % 60, sx = sec % 60;
    const ss = (sx < 10 ? '0' : '') + sx;
    return hr < 1 ? min + ':' + ss : hr + ':' + (min < 10 ? '0' : '') + min + ':' + ss;
  }

  // Only known keys, strings, trimmed and capped; blanks are left out (the default applies)
  function clean(w) {
    if (typeof w === 'string') { try { w = JSON.parse(w); } catch (_) { w = null; } }
    const out = {};
    if (!w || typeof w !== 'object') return out;
    for (const k of Object.keys(DEFAULTS)) {
      const v = typeof w[k] === 'string' ? w[k].trim().slice(0, MAX) : '';
      if (v) out[k] = v;
    }
    return out;
  }
  function stored() {
    try { return clean(localStorage.getItem(KEY)); } catch (_) { return {}; }
  }
  function words(custom) {
    return Object.assign({}, DEFAULTS, custom === undefined ? stored() : clean(custom));
  }
  // Saves this computer's words (only the ones that differ from the defaults); returns them
  function save(w) {
    const c = clean(w);
    for (const k of Object.keys(c)) if (c[k] === DEFAULTS[k]) delete c[k];
    try {
      if (Object.keys(c).length) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY);
    } catch (_) { /* no storage */ }
    return c;
  }

  function standby(ms, w) {
    w = w || DEFAULTS;
    return ms > 0 ? w.standbyIn.replace('{t}', clock(Math.ceil(ms / 1000))) : w.standby;
  }

  function notice(s, w) {
    w = w || DEFAULTS;
    if (!s) return '';
    if (s.standby) return s.standby;
    if (s.paused) return w.paused + (s.pausedFor ? ' · ' + s.pausedFor : '');
    if (!s.msgs) return '';
    return s.over ? w.over : s.impending ? w.wrap : '';
  }

  return { DEFAULTS, KEY, words, stored, save, standby, notice };
})();
if (typeof module !== 'undefined') module.exports = TimerNotices;
