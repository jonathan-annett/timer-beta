/*!
 * import.js — settings brought over from the old beta (timer.sophtwhere.com/beta), whose landing
 * page and "moved" bar send people to import.html#import=<base64url JSON of localStorage keys>.
 * The #fragment never reaches any server; it only passes between the two pages in this browser.
 *
 * Only the keys in ALLOWED are kept (settings, not the running countdown, share keys or tokens);
 * run sheet items lose their video / slides (the files stay in the old site's browser storage).
 * If this browser already has different values for any of them here, it asks before replacing.
 * Then it removes the fragment and opens the timer.
 * MIT Licensed
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  // key -> what it is (for the list shown when asking)
  const SWITCHES = 'the switches (bar, time of day, messages)', DECK = 'Stream Deck layouts and keys', PHONE = 'phone settings', OVERLAY = 'overlay settings';
  const ALLOWED = {
    custom_css: 'custom colours and layout (Ctrl+S)', defaultDuration: 'the default duration',
    showbar: SWITCHES, showtimenow: SWITCHES, showmessages: SWITCHES,
    runsheet: 'the run sheet', runsheet_restart_confirm: 'run sheet editor options', video_idle: 'the video setting',
    streamdeck_layout_mini: DECK, streamdeck_layout_mk2: DECK, streamdeck_layout_xl: DECK, streamdeck_key_overrides: DECK, streamdeck_brightness: DECK,
    touch_presets: PHONE, remote_confirm: PHONE,
    overlay_layout: OVERLAY, overlay_msg: OVERLAY, overlay_bar: OVERLAY,
  };
  const MAX = 512 * 1024;

  function decode(b64) {
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
  }
  // Run sheet items keep everything but their media (whose files didn't come)
  function cleanRunsheet(text) {
    const sheet = JSON.parse(text);
    if (!sheet || !Array.isArray(sheet.items)) throw new Error('not a run sheet');
    for (const it of sheet.items) { delete it.video; delete it.videoIdle; delete it.deck; delete it.holding; }
    return JSON.stringify(sheet);
  }

  let data = null;
  try {
    const m = location.hash.match(/(?:^#|&)import=([A-Za-z0-9_-]+)/);
    if (m) data = decode(m[1]);
  } catch (_) { data = null; }
  history.replaceState(null, '', location.pathname);          // out of the address bar either way
  const open = () => location.replace('./');   // the timer (/ on the Cloudflare site)

  if (!data || typeof data !== 'object') { open(); return; }
  const take = {};
  for (const [k, v] of Object.entries(data)) {
    if (!Object.prototype.hasOwnProperty.call(ALLOWED, k) || typeof v !== 'string' || v.length > MAX) continue;
    try { take[k] = k === 'runsheet' ? cleanRunsheet(v) : v; } catch (_) { /* a broken value: leave it */ }
  }
  const keys = Object.keys(take);
  if (!keys.length) { open(); return; }

  const labels = [...new Set(keys.map(k => ALLOWED[k]))];
  const store = () => {
    for (const k of keys) { try { localStorage.setItem(k, take[k]); } catch (_) { /* full or blocked */ } }
    try { localStorage.setItem('imported_from_old_beta', new Date().toISOString()); } catch (_) { /* blocked */ }
    open();
  };
  let here = [];
  try { here = keys.filter(k => localStorage.getItem(k) !== null && localStorage.getItem(k) !== take[k]); } catch (_) { here = []; }
  if (!here.length) { store(); return; }

  $('title').textContent = 'Bring your settings from the old beta?';
  if (location.hostname) document.title = location.hostname + ' - Bring your settings';
  $('text').textContent = 'You brought:';
  $('list').innerHTML = labels.map(l => `<li>${l}</li>`).join('');
  $('ask').hidden = false;
  $('go').hidden = false; $('skip').hidden = false;
  $('note').textContent = 'Videos and slides attached to run sheet items stay on the old site; attach them again here.';
  $('go').addEventListener('click', store);
  $('skip').addEventListener('click', open);
})();
