/*!
 * notice-panel.js
 * The timer's ✎ notices panel (the link line's "notices"): the words every screen shows when the
 * countdown is in its last minute, over time, paused or standing by (notices.js). Changes apply as
 * they're typed: saved in localStorage notice_words, then the "notice-words" event tells timer.js,
 * which re-reads them and sends them to devices (bus notice_words). An empty box means the default.
 * MIT Licensed
 */
(function () {
  'use strict';
  if (new URLSearchParams(location.search).has('presenter')) return;
  if (typeof TimerNotices === 'undefined') return;

  const FIELDS = [
    ['wrap', 'Last minute', 'with messages on (M)'],
    ['over', 'Time’s up', 'with messages on (M)'],
    ['paused', 'Paused', 'the operator’s screen adds how long'],
    ['standby', 'Standing by', 'run sheet: Reset show'],
    ['standbyIn', 'Standing by, auto start', '{t} = the time to go'],
  ];

  const CSS = `
#notice-panel { position: fixed; top: calc(var(--buttons-bottom, 48px) + 8px); right: 16px; width: 360px; z-index: 2147481000;
  max-height: calc(100vh - var(--buttons-bottom, 48px) - 16px); overflow-y: auto; box-sizing: border-box;
  background: #111; border: 1px solid #333; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,.6);
  color: #ddd; font: 13px/1.4 "Helvetica Neue", Arial, sans-serif; padding: 10px 12px 12px; cursor: auto; text-align: left; user-select: text; }
#notice-panel[hidden] { display: none; }
#notice-panel .np-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; color: #fff; }
#notice-panel .np-close { margin-left: auto; background: none; border: 0; color: #888; font-size: 15px; cursor: pointer; padding: 0 2px; }
#notice-panel .np-hint { font-size: 12px; color: #888; margin-bottom: 8px; }
#notice-panel .np-off { font-size: 12px; color: #ffcc33; margin-bottom: 8px; }
#notice-panel .np-off[hidden] { display: none; }
#notice-panel label { display: block; margin: 8px 0 0; color: #aaa; font-size: 12px; }
#notice-panel label small { color: #666; margin-left: 4px; }
#notice-panel input { display: block; width: 100%; box-sizing: border-box; margin-top: 3px; padding: 6px 8px; font: 14px "Helvetica Neue", Arial, sans-serif;
  color: #eee; background: #1a1a1a; border: 1px solid #333; border-radius: 5px; }
#notice-panel input:focus { outline: none; border-color: #4aa8ff; background: #161b22; }
#notice-panel input::placeholder { color: #777; }
#notice-panel .np-row { display: flex; gap: 6px; margin-top: 12px; }
#notice-panel button.np-btn { flex: 1; padding: 6px 4px; font: 12px "Helvetica Neue", Arial, sans-serif; background: #222; border: 1px solid #444; color: #ccc; border-radius: 4px; cursor: pointer; }
#notice-panel button.np-btn:hover { background: #333; color: #fff; }
html.reduced #notice-panel { display: none; }`;

  let panel = null;
  function panelEl() {
    if (panel) return panel;
    const st = document.createElement('style');
    st.id = 'notice-panel-css';
    st.textContent = CSS;
    document.head.appendChild(st);
    panel = document.createElement('div');
    panel.id = 'notice-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="np-head"><b>Notices</b><button class="np-close" title="Close">✕</button></div>
      <div class="np-hint">What every screen shows: presenter, phones, displays, overlays. Leave a box empty for the default.</div>
      <div class="np-off">Messages are off (M), so the last-minute and time’s-up notices aren’t shown.</div>
      ${FIELDS.map(([k, name, note]) => `<label>${name}<small>${note}</small><input data-k="${k}" maxlength="80" spellcheck="false"></label>`).join('')}
      <div class="np-row"><button class="np-btn np-defaults">Use the defaults</button><button class="np-btn np-done">Done</button></div>`;
    document.body.appendChild(panel);
    for (const inp of panel.querySelectorAll('input')) inp.placeholder = TimerNotices.DEFAULTS[inp.dataset.k];
    panel.querySelector('.np-close').addEventListener('click', close);
    panel.querySelector('.np-done').addEventListener('click', close);
    panel.querySelector('.np-defaults').addEventListener('click', () => {
      panel.querySelectorAll('input').forEach(i => { i.value = ''; });
      save();
    });
    panel.addEventListener('input', save);
    // Typing here mustn't work the timer (digits, Space…); Escape closes
    for (const t of ['keydown', 'keyup', 'keypress']) panel.addEventListener(t, e => {
      if (e.metaKey) return;
      e.stopPropagation();
      if (t === 'keydown' && e.key === 'Escape') close();
    });
    // One panel at a time under the button bar
    document.addEventListener('timer-panel', e => { if (e.detail !== 'notices') panel.hidden = true; });
    return panel;
  }

  function fill() {
    const w = TimerNotices.stored();
    panel.querySelectorAll('input').forEach(i => { i.value = w[i.dataset.k] || ''; });
    panel.querySelector('.np-off').hidden = document.documentElement.classList.contains('showmessages');
  }
  function save() {
    const w = {};
    panel.querySelectorAll('input').forEach(i => { w[i.dataset.k] = i.value; });
    TimerNotices.save(w);
    document.dispatchEvent(new CustomEvent('notice-words'));
  }
  function close() {
    if (!panel) return;
    panel.hidden = true;
    if (panel.contains(document.activeElement)) document.activeElement.blur();
  }
  function toggle() {
    const el = panelEl();
    if (!el.hidden) return close();
    fill();
    el.hidden = false;
    document.dispatchEvent(new CustomEvent('timer-panel', { detail: 'notices' }));
  }

  window.noticePanel = { toggle, close };
})();
