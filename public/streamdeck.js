/*!
 * streamdeck.js
 * Stream Deck WebHID integration for Presentation Timer
 * Supports: Mini (6), MK.II (15), XL (32)
 * MIT Licensed
 */

/* global timerAPI, processTimerApiMessage, html */

(function () {
  'use strict';

  // ─── Device profiles ─────────────────────────────────────────────────────

  const MODELS = {
    mini: { name: 'Stream Deck Mini', cols: 3, rows: 2, keySize: 80,  keyCount: 6  },
    mk2:  { name: 'Stream Deck MK.II', cols: 5, rows: 3, keySize: 72,  keyCount: 15 },
    xl:   { name: 'Stream Deck XL',   cols: 8, rows: 4, keySize: 96,  keyCount: 32 },
  };

  // USB product IDs (Elgato vendor 0x0fd9), per the published @elgato-stream-deck device list.
  // protocol 'gen2': JPEG keys, 1024-byte reports, key states from input byte 3.
  //          'gen1': BMP keys, key states from input byte 0 (original v1 and both Minis).
  const DEVICE_IDS = [
    { productId: 0x0060, model: 'mk2',  protocol: 'gen1', name: 'Stream Deck (original)',    reportSize: 8191, pageBase: 1, mirrorCols: true },
    { productId: 0x006d, model: 'mk2',  protocol: 'gen2', name: 'Stream Deck (original v2)' },
    { productId: 0x0080, model: 'mk2',  protocol: 'gen2', name: 'Stream Deck MK.2' },
    { productId: 0x00a5, model: 'mk2',  protocol: 'gen2', name: 'Stream Deck MK.2' },
    { productId: 0x0063, model: 'mini', protocol: 'gen1', name: 'Stream Deck Mini',          reportSize: 1024, pageBase: 0 },
    { productId: 0x0090, model: 'mini', protocol: 'gen1', name: 'Stream Deck Mini MK.2',     reportSize: 1024, pageBase: 0 },
    { productId: 0x006c, model: 'xl',   protocol: 'gen2', name: 'Stream Deck XL' },
    { productId: 0x008f, model: 'xl',   protocol: 'gen2', name: 'Stream Deck XL' },
  ].map(d => ({ vendorId: 0x0fd9, ...d }));

  // Key image orientation. gen2 (MK.2/XL) is rotated 180°. The gen1 values are
  // best guesses — if images appear rotated or mirrored on a Mini / original,
  // adjust here (degrees clockwise, plus optional horizontal mirror).
  const ORIENTATION = {
    gen2: { rotate: 180, mirror: false },
    mini: { rotate: 90,  mirror: false },   // UNVERIFIED on hardware
    gen1: { rotate: 180, mirror: false },   // original v1 — UNVERIFIED on hardware
  };

  // ─── Action definitions ───────────────────────────────────────────────────

  const ACTIONS = {
    preset_10:        { label: '10 min',    group: 'Presets',   cmd: () => _sendCmd({ cmd: 'start', msecs: 600000 }) },
    preset_20:        { label: '20 min',    group: 'Presets',   cmd: () => _sendCmd({ cmd: 'start', msecs: 1200000 }) },
    preset_30:        { label: '30 min',    group: 'Presets',   cmd: () => _sendCmd({ cmd: 'start', msecs: 1800000 }) },
    preset_45:        { label: '45 min',    group: 'Presets',   cmd: () => _sendCmd({ cmd: 'start', msecs: 2700000 }) },
    preset_60:        { label: '1 hour',    group: 'Presets',   cmd: () => _sendCmd({ cmd: 'start', msecs: 3600000 }) },
    preset_90:        { label: '90 min',    group: 'Presets',   cmd: () => _sendCmd({ cmd: 'start', msecs: 5400000 }) },
    preset_120:       { label: '2 hours',   group: 'Presets',   cmd: () => _sendCmd({ cmd: 'start', msecs: 7200000 }) },
    preset_180:       { label: '3 hours',   group: 'Presets',   cmd: () => _sendCmd({ cmd: 'start', msecs: 10800000 }) },
    start_restart:    { label: 'Start',     group: 'Controls',  cmd: () => _sendCmd({ cmd: 'keys', keys: [' '] }) },
    pause_resume: {
      label: 'Pause', altLabel: 'Resume',
      group: 'Controls',
      toggleState: 'pausing',
      cmd: () => {
        if (deckState.pausing) {
          _sendCmd({ cmd: 'undopause' });
        } else {
          _sendCmd({ cmd: 'pause' });
        }
      }
    },
    add_1min:         { label: '+1 min',    group: 'Controls',  cmd: () => _sendCmd({ cmd: 'adjust', addtime: true,  msecs: 60000 }) },
    sub_1min:         { label: '-1 min',    group: 'Controls',  cmd: () => _sendCmd({ cmd: 'adjust', addtime: false, msecs: 60000 }) },
    add_15sec:        { label: '+15 sec',   group: 'Controls',  cmd: () => _sendCmd({ cmd: 'nudge',  addtime: true,  msecs: 15000 }) },
    sub_15sec:        { label: '-15 sec',   group: 'Controls',  cmd: () => _sendCmd({ cmd: 'nudge',  addtime: false, msecs: 15000 }) },
    undo_pause:       { label: 'Clear\nPause', group: 'Controls', cmd: () => _sendCmd({ cmd: 'undopause' }) },
    // Lit only while the timer is easing to an adjusted end time (adjusting_up / adjusting_down)
    catch_up:         { label: 'Catch\nup',  group: 'Controls',  cmd: () => _sendCmd({ cmd: 'catchup' }) },
    toggle_bar:       { label: 'Bar',       group: 'Display',   toggleState: 'showbar',      cmd: () => _sendCmd({ cmd: 'bar' }) },
    toggle_time:      { label: 'Clock',     group: 'Display',   toggleState: 'showtimenow',  cmd: () => _sendCmd({ cmd: 'time' }) },
    toggle_messages:  { label: 'Messages',  group: 'Display',   toggleState: 'showmessages', cmd: () => _sendCmd({ cmd: 'messages' }) },
    toggle_presenter: { label: 'Remote',    group: 'Display',   cmd: () => _sendCmd({ cmd: 'presenter' }) },
    brightness_cycle: { label: 'Backlight', group: 'Display',   cmd: () => cycleBrightness() },
    // Display-only keys showing the remaining time (see countdownText). Pressing them does nothing.
    countdown:        { label: 'Timer',     group: 'Countdown', display: 'full',  cmd: null },
    countdown_major:  { label: 'Min / Hr',  group: 'Countdown', display: 'major', cmd: null },
    countdown_minor:  { label: 'Sec / Min', group: 'Countdown', display: 'minor', cmd: null },
    // Preset message: text is stored per key (keyOverrides[...].message). Press shows it on the
    // presenter screen; press again (while it's showing) clears it.
    message:          { label: 'Message',   group: 'Messages',  isMessage: true, cmd: (i, m) => toggleMessage(i, m) },
    message_clear:    { label: 'Clear\nmessage', group: 'Messages', cmd: () => _sendCmd({ cmd: 'custommessage', text: '' }) },
    // Run sheet (see runsheet.js). Next shows the upcoming item's name; Schedule shows ahead/behind.
    rs_prev:          { label: '◀ Back',    group: 'Run sheet', rsKey: 'prev',   cmd: () => _sendCmd({ cmd: 'runsheetprev' }) },
    rs_next:          { label: 'Next ▶',    group: 'Run sheet', rsKey: 'next',   cmd: () => _sendCmd({ cmd: 'runsheetnext' }) },
    rs_status:        { label: 'Schedule',  group: 'Run sheet', rsKey: 'status', cmd: null },
    custom_msg:       { label: 'Type\nmessage', group: 'Messages', cmd: () => _sendCmd({ cmd: 'keys', keys: ['c'] }) },
    empty:            { label: '',          group: 'Other',     cmd: null },
  };

  // ─── Default layouts per model ────────────────────────────────────────────

  const DEFAULT_LAYOUTS = {
    mini: ['start_restart','pause_resume','undo_pause','add_1min','sub_1min','preset_30'],
    mk2: [
      'preset_10','preset_20','preset_30','preset_45','preset_60',
      'start_restart','pause_resume','add_1min','sub_1min','undo_pause',
      'toggle_bar','toggle_time','toggle_messages','toggle_presenter','custom_msg',
    ],
    xl: [
      'preset_10','preset_20','preset_30','preset_45','preset_60','preset_90','preset_120','preset_180',
      'message','message','message_clear','rs_prev','rs_next','rs_status','countdown_major','countdown_minor',
      'start_restart','pause_resume','add_1min','sub_1min','add_15sec','sub_15sec','undo_pause','custom_msg',
      'toggle_bar','toggle_time','toggle_messages','toggle_presenter','catch_up','brightness_cycle','empty','empty',
    ],
  };

  // Default per-key settings (used when nothing is saved, and by Reset defaults)
  const DEFAULT_OVERRIDES = {
    'xl:8':  { message: 'Please wrap up' },
    'xl:9':  { message: 'Time for questions' },
  };

  // ─── Runtime state ────────────────────────────────────────────────────────

  // Boolean flags that change how keys are drawn. `remain` is deliberately NOT here:
  // it changes every tick and isn't drawn on keys, so tracking it would repaint the
  // whole deck ~10x a second.
  let deckState = {
    expired: false, impending: false, adjusting_up: false, adjusting_down: false,
    pausing: false, showbar: false, showtimenow: false, showmessages: false,
  };

  // Remaining time, from the timer's `remain` text ("M:SS" or "H:MM:SS"; counts up overtime
  // once `expired`). Kept out of deckState: only countdown keys repaint when it changes.
  let currentMessage = '';   // message on the presenter screen ('' = none), from `custommsg`
  // Run sheet state pushed by runsheet.js (rs_* variables). Kept out of deckState so a
  // change repaints only the run sheet keys.
  let rs = { active: false, next: '', canBack: false, status: '', late: null };
  let remainSec = 0;
  let remainText = '';
  const countdownCache = new Map();   // key index -> text last drawn, to skip identical repaints

  let device = null;
  let deviceInfo = null;     // matching DEVICE_IDS entry
  let modelKey = null;
  let prevKeys = [];         // last key states, for press edge detection
  let pausedDevice = null;   // granted deck the user disconnected (kept for Forget / quick reconnect)
  const AUTOCONNECT_KEY = 'streamdeck_autoconnect';  // '0' = user disconnected; don't auto-attach
  const autoConnectAllowed = () => localStorage.getItem(AUTOCONNECT_KEY) !== '0';
  let layouts = {};          // { mini: [...actionKeys], mk2: [...], xl: [...] }
  let keyOverrides = {};     // { 'mk2:7': { label: 'Custom', fg: '#fff', bg: '#003' } }
  let dirtyKeys = new Set(); // keys needing redraw
  let drawScheduled = false;

  // ─── timerAPI bus integration ─────────────────────────────────────────────

  function _installTimerAPI() {
    const prev = window.timerAPI;
    window.timerAPI = {
      send(msg) {
        if (prev && prev.send) prev.send(msg); // chain (relay.js may also be installed)
        if (msg && msg.setVariableValues) {
          const v = msg.setVariableValues;
          let changed = false;
          for (const k of Object.keys(v)) {
            if (!(k in deckState)) continue;
            const val = (typeof v[k] === 'string') ? (v[k] === '1' || v[k] === 'true') : !!v[k];
            if (deckState[k] !== val) { deckState[k] = val; changed = true; }
          }
          if (changed) countdownCache.clear();
          if (changed && device) scheduleRedrawAll();
          if ('rs_active' in v) {
            const nrs = {
              active: v.rs_active === '1', next: v.rs_next || '', canBack: v.rs_can_back === '1',
              status: v.rs_status || '', late: v.rs_late === '' || v.rs_late == null ? null : Number(v.rs_late),
            };
            if (JSON.stringify(nrs) !== JSON.stringify(rs)) {
              rs = nrs;
              if (device && !changed) scheduleRsKeys();
            }
          }
          if (typeof v.custommsg === 'string' && v.custommsg !== currentMessage) {
            currentMessage = v.custommsg;
            if (device && !changed) scheduleMessageKeys();
          }
          if (typeof v.remain === 'string' && v.remain !== remainText) {
            remainText = v.remain;
            remainSec = parseRemain(v.remain);
            if (device && !changed) scheduleCountdownKeys();
          }
        }
      }
    };
    // Announce ourselves so timer.js sends initial state
    if (typeof processTimerApiMessage === 'function') {
      processTimerApiMessage({ cmd: 'opened' });
    }
  }

  function _sendCmd(msg) {
    if (typeof processTimerApiMessage === 'function') {
      processTimerApiMessage(msg);
    }
  }

  // ─── Layout persistence ───────────────────────────────────────────────────

  function loadLayouts() {
    for (const m of Object.keys(DEFAULT_LAYOUTS)) {
      try {
        const saved = localStorage.getItem('streamdeck_layout_' + m);
        layouts[m] = saved ? JSON.parse(saved) : [...DEFAULT_LAYOUTS[m]];
      } catch (_) {
        layouts[m] = [...DEFAULT_LAYOUTS[m]];
      }
    }
    try {
      const saved = localStorage.getItem('streamdeck_key_overrides');
      keyOverrides = saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(DEFAULT_OVERRIDES));
    } catch (_) {
      keyOverrides = {};
    }
  }

  function saveLayouts() {
    for (const m of Object.keys(layouts)) {
      localStorage.setItem('streamdeck_layout_' + m, JSON.stringify(layouts[m]));
    }
    localStorage.setItem('streamdeck_key_overrides', JSON.stringify(keyOverrides));
  }

  // ─── WebHID connection ────────────────────────────────────────────────────

  // Must be called from a user gesture (click) — WebHID requires it for the permission prompt.
  async function connectDeck() {
    if (!navigator.hid) {
      _showDeckStatus('WebHID unavailable — use desktop Chrome or Edge over HTTPS', 'error');
      return;
    }
    if (device) { _showDeckStatus('Connected: ' + deviceInfo.name, 'ok'); return; }
    localStorage.removeItem(AUTOCONNECT_KEY);            // explicit Connect re-enables auto-connect
    if (pausedDevice) {                                  // still granted — no picker needed
      const hid = pausedDevice; pausedDevice = null;
      if (await attach(hid)) return;
    }
    let hid;
    try {
      const filters = DEVICE_IDS.map(d => ({ vendorId: d.vendorId, productId: d.productId }));
      [hid] = await navigator.hid.requestDevice({ filters });
    } catch (err) {
      _showDeckStatus('Could not open the device picker: ' + err.message, 'error');
      return;
    }
    if (!hid) { _showDeckStatus('No device selected', 'idle'); return; }
    await attach(hid);
  }

  // ─── Backlight ────────────────────────────────────────────────────────────

  const BRIGHTNESS_KEY = 'streamdeck_brightness';
  const BRIGHTNESS_LEVELS = [100, 75, 50, 25, 10];   // editor choices
  const BRIGHTNESS_CYCLE  = [100, 50, 25, 10];       // deck key steps (quick to reach in the dark)
  let brightness = parseInt(localStorage.getItem(BRIGHTNESS_KEY), 10) || 100;

  async function applyBrightness() {
    if (!device || !deviceInfo) return;
    try {
      if (deviceInfo.protocol === 'gen2') {
        const data = new Uint8Array(31); data.set([0x08, brightness]);
        await device.sendFeatureReport(0x03, data);
      } else {
        const data = new Uint8Array(16); data.set([0x55, 0xaa, 0xd1, 0x01, brightness]);
        await device.sendFeatureReport(0x05, data);
      }
    } catch (err) {
      console.warn('StreamDeck: set brightness failed', err);
    }
  }

  function setBrightness(pct) {
    brightness = Math.max(1, Math.min(100, pct | 0));
    localStorage.setItem(BRIGHTNESS_KEY, String(brightness));
    const sel = document.getElementById('deck-brightness');
    if (sel) sel.value = String(brightness);
    applyBrightness();
    scheduleRedrawAll();   // the Backlight key shows the current level
    notifyChange();
  }

  // Next lower step, wrapping from the dimmest back to 100%.
  function cycleBrightness() {
    const next = BRIGHTNESS_CYCLE.find(l => l < brightness);
    setBrightness(next === undefined ? BRIGHTNESS_CYCLE[0] : next);
  }

  // Shared by manual connect and auto-reconnect.
  async function attach(hid) {
    try {
      if (!hid.opened) await hid.open();
    } catch (err) {
      console.warn('StreamDeck: open failed', err);
      _showDeckStatus('Device is busy — quit the Elgato Stream Deck app, then Connect again', 'error');
      return false;
    }
    deviceInfo = detectModel(hid);
    modelKey = deviceInfo.model;
    prevKeys = [];
    device = hid;
    device.addEventListener('inputreport', onKeyEvent);
    _showDeckStatus('Connected: ' + deviceInfo.name, 'ok');
    applyBrightness();
    scheduleRedrawAll();
    console.log('StreamDeck: connected', modelKey);
    return true;
  }

  function onHidDisconnect(ev) {
    if (pausedDevice && ev.device === pausedDevice) { pausedDevice = null; _showDeckStatus('Not connected', 'idle'); }
    if (device && ev.device === device) {
      device.removeEventListener('inputreport', onKeyEvent);
      device = null; deviceInfo = null;
      _showDeckStatus('Unplugged — plug it back in, or click Connect', 'idle');
    }
  }

  // Release the deck: blank its keys, close it, and stop auto-reconnect until Connect is clicked.
  async function disconnectDeck() {
    if (!device) return;
    localStorage.setItem(AUTOCONNECT_KEY, '0');
    const hid = device;
    dirtyKeys.clear();
    while (drawing) await new Promise(r => setTimeout(r, 20));   // let any in-flight flush finish
    await blankKeys();
    hid.removeEventListener('inputreport', onKeyEvent);
    device = null; deviceInfo = null;
    try { await hid.close(); } catch (_) {}
    pausedDevice = hid;
    _showDeckStatus('Disconnected — click Connect to use it again', 'idle');
  }

  // Unpair: disconnect, then revoke this site's permission so the picker is needed again.
  async function forgetDeck() {
    if (device) await disconnectDeck();
    const hid = pausedDevice;
    pausedDevice = null;
    localStorage.removeItem(AUTOCONNECT_KEY);
    if (hid && typeof hid.forget === 'function') {
      try { await hid.forget(); } catch (err) { console.warn('StreamDeck: forget failed', err); }
      _showDeckStatus('Forgotten — Connect will ask for permission again', 'idle');
    } else {
      _showDeckStatus('Disconnected (this browser cannot revoke permission; remove it in site settings)', 'idle');
    }
  }

  async function blankKeys() {
    const model = MODELS[modelKey];
    if (!device || !model) return;
    const c = document.createElement('canvas');
    c.width = c.height = model.keySize;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < model.keyCount; i++) await writeKeyImage(i, c);
  }

  function detectModel(hid) {
    return DEVICE_IDS.find(d => d.vendorId === hid.vendorId && d.productId === hid.productId)
      || { model: 'mk2', protocol: 'gen2', name: 'Stream Deck (unknown model)' };
  }

  // The original (v1) deck reports and addresses keys right-to-left within each row.
  function physicalKeyIndex(i) {
    if (!deviceInfo || !deviceInfo.mirrorCols) return i;
    const cols = MODELS[modelKey].cols, col = i % cols;
    return i - col + (cols - 1 - col);
  }

  function onKeyEvent(ev) {
    if (ev.reportId !== 0x01) return;
    const data = new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength);
    const model = MODELS[modelKey];
    if (!model) return;
    const offset = deviceInfo.protocol === 'gen2' ? 3 : 0;
    for (let i = 0; i < model.keyCount; i++) {
      const down = data[offset + i] === 1;
      // Fire on press only (not while held, and not again when another key changes)
      if (down && !prevKeys[i]) onKeyPress(physicalKeyIndex(i));
      prevKeys[i] = down;
    }
  }

  function onKeyPress(index) {
    const layout = layouts[modelKey];
    if (!layout) return;
    const actionKey = layout[index];
    if (!actionKey || actionKey === 'empty') return;
    const action = ACTIONS[actionKey];
    if (action && action.cmd) action.cmd(index, modelKey);
  }

  // ─── Key rendering ────────────────────────────────────────────────────────

  function scheduleRedrawAll() {
    const model = MODELS[modelKey];
    if (!model) return;
    for (let i = 0; i < model.keyCount; i++) dirtyKeys.add(i);
    if (!drawScheduled) {
      drawScheduled = true;
      requestAnimationFrame(flushDraw);
    }
  }

  function scheduleRedrawKey(index) {
    dirtyKeys.add(index);
    if (!drawScheduled) {
      drawScheduled = true;
      requestAnimationFrame(flushDraw);
    }
  }

  let drawing = false;
  async function flushDraw() {
    drawScheduled = false;
    if (drawing) { drawScheduled = true; setTimeout(flushDraw, 30); return; } // one flush at a time
    drawing = true;
    try {
      while (device && modelKey && dirtyKeys.size) {
        const batch = [...dirtyKeys]; dirtyKeys.clear();   // keys dirtied mid-flush go in the next pass
        const model = MODELS[modelKey];
        const layout = layouts[modelKey];
        for (const index of batch) {
          if (!device || index >= model.keyCount) continue;
          const actionKey = layout ? layout[index] : 'empty';
          await writeKeyImage(index, renderKey(index, actionKey, model.keySize));
        }
      }
    } finally {
      drawing = false;
    }
  }

  // ─── Message keys ─────────────────────────────────────────────────────────

  // m: deck model ('xl' etc.); the connected deck's by default, 'xl' for the phone's virtual deck
  const messageFor = (i, m = modelKey) => ((keyOverrides[m + ':' + i] || {}).message || '').trim();

  function toggleMessage(index, m = modelKey) {
    const text = messageFor(index, m);
    if (!text) return;   // no text set for this key yet
    _sendCmd({ cmd: 'custommessage', text: currentMessage === text ? '' : text });
  }

  function scheduleRsKeys() {
    (layouts[modelKey] || []).forEach((a, i) => { if (ACTIONS[a] && ACTIONS[a].rsKey) scheduleRedrawKey(i); });
  }

  function scheduleMessageKeys() {
    const layout = layouts[modelKey] || [];
    layout.forEach((a, i) => { if (a === 'message' || a === 'message_clear') scheduleRedrawKey(i); });
  }

  // ─── Countdown keys ───────────────────────────────────────────────────────

  function parseRemain(str) {
    const parts = str.replace(/^[-+]/, '').split(':').map(n => parseInt(n, 10) || 0);
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }

  const pad2 = n => String(n).padStart(2, '0');

  // Under an hour: major "01", minor "30" (mm / ss). From an hour: major "1h", minor "25m".
  // Overtime (expired) is prefixed "+" on the major / full key.
  function countdownText(kind) {
    const pre = deckState.expired ? '+' : '';
    const h = Math.floor(remainSec / 3600), m = Math.floor(remainSec % 3600 / 60), sec = remainSec % 60;
    if (kind === 'full')  return pre + (remainText.replace(/^[-+]/, '') || '0:00');
    if (kind === 'major') return pre + (h >= 1 ? h + 'h' : pad2(m));
    return h >= 1 ? pad2(m) + 'm' : pad2(sec);
  }

  // Repaint only countdown keys whose visible text actually changed.
  function scheduleCountdownKeys() {
    const layout = layouts[modelKey];
    if (!layout) return;
    layout.forEach((actionKey, i) => {
      const a = ACTIONS[actionKey];
      if (!a || !a.display) return;
      const text = countdownText(a.display);
      if (countdownCache.get(i) !== text) scheduleRedrawKey(i);
    });
  }

  // What a key looks like, as data (colours and text). DeckFace.paint (deck-face.js) draws it;
  // the phone's virtual XL gets the same objects, so both look the same.
  function faceFor(m, index, actionKey) {
    const action = ACTIONS[actionKey] || ACTIONS['empty'];
    const override = keyOverrides[m + ':' + index] || {};

    // Determine colours from state
    let bg = override.bg || '#1a1a2e';
    let fg = override.fg || '#ffffff';

    const isToggled = action.toggleState && deckState[action.toggleState];
    if (isToggled) { bg = '#0f3460'; fg = '#e94560'; }
    if (deckState.expired) { bg = '#2d0000'; fg = '#ff4444'; }
    else if (deckState.impending && actionKey !== 'empty') { bg = '#2d1a00'; fg = '#ff9900'; }
    if (actionKey === 'pause_resume' && deckState.pausing) { bg = '#2d1a00'; fg = '#ff9900'; }
    if (action.isMessage) {
      const text = messageFor(index, m);
      if (text && currentMessage === text) { bg = override.bg || '#0b3d5c'; fg = override.fg || '#7fd4ff'; }
      else if (!text) { fg = '#555555'; }
    }
    if (actionKey === 'message_clear') {
      bg = currentMessage ? '#3d2a00' : '#0d0d0d';
      fg = currentMessage ? '#ffcc33' : '#444444';
    }
    if (actionKey === 'catch_up') {
      const adjusting = deckState.adjusting_up || deckState.adjusting_down;
      bg = adjusting ? (override.bg || '#003300') : '#0d0d0d';
      fg = adjusting ? (override.fg || '#33ff33') : '#444444';
    }
    if (action.rsKey) {
      const on = rs.active && (action.rsKey === 'prev' ? rs.canBack : action.rsKey === 'next' ? !!rs.next : true);
      if (!on) { bg = '#0d0d0d'; fg = '#444444'; }
      else if (action.rsKey === 'next') { bg = override.bg || '#0e3a12'; fg = override.fg || '#8dff8d'; }
      else if (action.rsKey === 'prev') { bg = override.bg || '#1a1a2e'; fg = override.fg || '#ffffff'; }
      else if (rs.late != null && rs.late >= 30)  { bg = '#3a0d0d'; fg = '#ff7777'; }
      else if (rs.late != null && rs.late <= -30) { bg = '#0d2e0d'; fg = '#77ff77'; }
      else { bg = '#111111'; fg = '#cccccc'; }
    }

    const f = { bg, fg };
    if (action.display) {
      if (!override.bg) f.base = deckState.expired ? '#2d0000' : deckState.impending ? '#2d1a00' : '#000';
      f.big = { text: countdownText(action.display), scale: action.display === 'full' ? 0.5 : 0.62 };
    }
    if (action.isMessage) {
      f.wrap = { text: override.label || messageFor(index, m) || 'Message\n(no text)', maxLines: 4 };
    }
    if (action.rsKey && rs.active) {
      // Small caption on top, content below
      const cap = action.rsKey === 'next' ? 'NEXT ▶' : action.rsKey === 'prev' ? '◀ BACK' : 'SCHEDULE';
      const body = action.rsKey === 'next' ? rs.next : action.rsKey === 'status' ? (rs.status || '—') : '';
      f.rs = { cap, body, status: action.rsKey === 'status' };
    }

    const rawLabel = (action.display || action.isMessage || (action.rsKey && rs.active)) ? '' :
      actionKey === 'brightness_cycle' ? (override.label || 'Backlight') + '\n' + brightness + '%' :
      override.label ||
      (action.toggleState && deckState[action.toggleState] && action.altLabel ? action.altLabel : action.label) || '';
    if (rawLabel) f.label = rawLabel;

    // Thin state indicator bar at bottom
    const bar = deckState.expired ? '#ff2222' : deckState.impending ? '#ff9900' : deckState.pausing ? '#888888' : '';
    if (bar) f.bar = bar;
    return f;
  }

  function renderKey(index, actionKey, size) {
    const f = faceFor(modelKey, index, actionKey);
    if (f.big) countdownCache.set(index, f.big.text);
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    DeckFace.paint(canvas.getContext('2d'), f, size);
    return canvas;
  }

  // Rotate/mirror the key image into the orientation the device expects.
  function orient(src) {
    const o = deviceInfo.protocol === 'gen2' ? ORIENTATION.gen2
            : modelKey === 'mini' ? ORIENTATION.mini : ORIENTATION.gen1;
    const size = src.width;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.translate(size / 2, size / 2);
    ctx.rotate(o.rotate * Math.PI / 180);
    if (o.mirror) ctx.scale(-1, 1);
    ctx.drawImage(src, -size / 2, -size / 2);
    return c;
  }

  async function writeKeyImage(logicalIndex, canvas) {
    const keyIndex = physicalKeyIndex(logicalIndex);
    const img = orient(canvas);
    try {
      if (deviceInfo.protocol === 'gen2') {
        const blob = await new Promise(r => img.toBlob(r, 'image/jpeg', 0.95));
        await sendGen2(keyIndex, new Uint8Array(await blob.arrayBuffer()));
      } else {
        await sendGen1(keyIndex, toBMP(img));
      }
    } catch (err) {
      console.warn('StreamDeck: key image write failed', err);
    }
  }

  // gen2: report 0x02, 1024 bytes incl. report ID, 8-byte header, 1016-byte payload.
  async function sendGen2(keyIndex, bytes) {
    const DATA_LEN = 1023, HEADER = 7, PAYLOAD = DATA_LEN - HEADER;
    for (let page = 0, pos = 0; pos < bytes.length; page++, pos += PAYLOAD) {
      const chunk = bytes.subarray(pos, pos + PAYLOAD);
      const isLast = pos + PAYLOAD >= bytes.length;
      const data = new Uint8Array(DATA_LEN);              // zero-padded to the full report
      data.set([0x07, keyIndex, isLast ? 1 : 0,
                chunk.length & 0xff, chunk.length >> 8,
                page & 0xff, page >> 8]);
      data.set(chunk, HEADER);
      await device.sendReport(0x02, data);
    }
  }

  // gen1 (Mini, original v1): report 0x02, 16-byte header, BMP payload.
  async function sendGen1(keyIndex, bytes) {
    const DATA_LEN = deviceInfo.reportSize - 1, HEADER = 15, PAYLOAD = DATA_LEN - HEADER;
    for (let page = 0, pos = 0; pos < bytes.length; page++, pos += PAYLOAD) {
      const chunk = bytes.subarray(pos, pos + PAYLOAD);
      const isLast = pos + PAYLOAD >= bytes.length;
      const data = new Uint8Array(DATA_LEN);
      data.set([0x01, page + deviceInfo.pageBase, 0x00, isLast ? 1 : 0, keyIndex + 1]);
      data.set(chunk, HEADER);
      await device.sendReport(0x02, data);
    }
  }

  // 24-bit bottom-up BMP, as gen1 devices expect.
  function toBMP(canvas) {
    const w = canvas.width, h = canvas.height;
    const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const rowBytes = Math.ceil(w * 3 / 4) * 4, imgBytes = rowBytes * h;
    const buf = new Uint8Array(54 + imgBytes), dv = new DataView(buf.buffer);
    buf[0] = 0x42; buf[1] = 0x4d;                          // 'BM'
    dv.setUint32(2, buf.length, true); dv.setUint32(10, 54, true);
    dv.setUint32(14, 40, true); dv.setInt32(18, w, true); dv.setInt32(22, h, true);
    dv.setUint16(26, 1, true); dv.setUint16(28, 24, true); dv.setUint32(34, imgBytes, true);
    dv.setInt32(38, 3780, true); dv.setInt32(42, 3780, true);
    for (let y = 0; y < h; y++) {
      const row = 54 + (h - 1 - y) * rowBytes;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, o = row + x * 3;
        buf[o] = px[i + 2]; buf[o + 1] = px[i + 1]; buf[o + 2] = px[i];   // BGR
      }
    }
    return buf;
  }

  // ─── Status indicator ─────────────────────────────────────────────────────

  // kind: 'ok' | 'error' | 'idle'
  function _showDeckStatus(text, kind = 'idle') {
    const status = document.getElementById('deck-status');
    if (status) { status.textContent = text; status.dataset.kind = kind; }
    const connectBtn = document.getElementById('deck-connect-btn');
    if (connectBtn) connectBtn.textContent = device ? 'Disconnect' : 'Connect deck';
    const forgetBtn = document.getElementById('deck-forget-btn');
    if (forgetBtn) forgetBtn.style.display = (device || pausedDevice) ? '' : 'none';
    const btn = document.getElementById('btndeck');
    if (btn) btn.textContent = device ? 'deck ✓' : 'deck';
  }

  // ─── In-app visual editor ─────────────────────────────────────────────────

  let editorModelKey = modelKey || 'mk2';
  let editorLayouts = {};
  let editorOverrides = {};
  let selectedKeyIndex = null;

  function openEditor() {
    editorModelKey = modelKey || 'mk2';
    editorLayouts = JSON.parse(JSON.stringify(layouts));
    editorOverrides = JSON.parse(JSON.stringify(keyOverrides));

    const el = document.getElementById('deck-editor');
    if (!el) return;
    el.style.display = 'flex';

    const sel = document.getElementById('deck-model-select');
    if (sel) sel.value = editorModelKey;

    renderEditorGrid();
    renderEditorPalette();
    selectedKeyIndex = null;
    document.getElementById('deck-key-options').style.display = 'none';
  }

  function closeEditor() {
    const el = document.getElementById('deck-editor');
    if (el) el.style.display = 'none';
  }

  function renderEditorGrid() {
    const model = MODELS[editorModelKey];
    const layout = editorLayouts[editorModelKey] || [...DEFAULT_LAYOUTS[editorModelKey]];
    editorLayouts[editorModelKey] = layout;

    const grid = document.getElementById('deck-grid');
    if (!grid) return;
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `repeat(${model.cols}, 64px)`;
    grid.style.gridTemplateRows = `repeat(${model.rows}, 64px)`;
    grid.style.display = 'grid';
    grid.style.gap = '4px';

    for (let i = 0; i < model.keyCount; i++) {
      const actionKey = layout[i] || 'empty';
      const cell = document.createElement('div');
      cell.className = 'deck-editor-key';
      cell.dataset.index = i;
      cell.draggable = false;

      const overrideKey = editorModelKey + ':' + i;
      const ov = editorOverrides[overrideKey] || {};
      const action = ACTIONS[actionKey] || ACTIONS['empty'];
      cell.textContent = ov.label || (actionKey === 'message' && ov.message) || action.label || '';
      cell.style.background = ov.bg || '#1a1a2e';
      cell.style.color = ov.fg || '#ffffff';
      if (actionKey === 'empty') cell.style.opacity = '0.3';

      cell.addEventListener('click', () => selectKey(i));
      cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('drag-over'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', e => {
        e.preventDefault();
        cell.classList.remove('drag-over');
        const droppedAction = e.dataTransfer.getData('action');
        if (droppedAction) {
          editorLayouts[editorModelKey][i] = droppedAction;
          renderEditorGrid();
          if (droppedAction === 'message') {
            selectKey(i);
            document.getElementById('deck-key-message')?.focus();
          } else if (selectedKeyIndex === i) selectKey(i);
        }
      });
      grid.appendChild(cell);
    }
  }

  function renderEditorPalette() {
    const palette = document.getElementById('deck-palette');
    if (!palette) return;
    palette.innerHTML = '';

    const groups = {};
    for (const [key, action] of Object.entries(ACTIONS)) {
      if (!groups[action.group]) groups[action.group] = [];
      groups[action.group].push({ key, action });
    }

    for (const [group, items] of Object.entries(groups)) {
      const heading = document.createElement('div');
      heading.className = 'deck-palette-group';
      heading.textContent = group;
      palette.appendChild(heading);

      const row = document.createElement('div');
      row.className = 'deck-palette-row';
      for (const { key, action } of items) {
        const chip = document.createElement('div');
        chip.className = 'deck-palette-chip';
        chip.textContent = action.label || '–';
        chip.draggable = true;
        chip.dataset.action = key;
        chip.addEventListener('dragstart', e => {
          e.dataTransfer.setData('action', key);
          e.dataTransfer.effectAllowed = 'copy';
        });
        row.appendChild(chip);
      }
      palette.appendChild(row);
    }
  }

  function selectKey(index) {
    selectedKeyIndex = index;
    document.querySelectorAll('.deck-editor-key').forEach(el => el.classList.remove('selected'));
    const cell = document.querySelector(`.deck-editor-key[data-index="${index}"]`);
    if (cell) cell.classList.add('selected');

    const opts = document.getElementById('deck-key-options');
    if (!opts) return;
    opts.style.display = 'block';

    const overrideKey = editorModelKey + ':' + index;
    const ov = editorOverrides[overrideKey] || {};
    document.getElementById('deck-key-label').value = ov.label || '';
    const isMsg = (editorLayouts[editorModelKey] || [])[index] === 'message';
    document.getElementById('deck-key-message-row').style.display = isMsg ? '' : 'none';
    document.getElementById('deck-key-message').value = ov.message || '';
    document.getElementById('deck-key-fg').value = ov.fg || '#ffffff';
    document.getElementById('deck-key-bg').value = ov.bg || '#1a1a2e';
  }

  function applyKeyOptions() {
    if (selectedKeyIndex === null) return;
    const overrideKey = editorModelKey + ':' + selectedKeyIndex;
    const label = document.getElementById('deck-key-label').value.trim();
    const fg    = document.getElementById('deck-key-fg').value;
    const bg    = document.getElementById('deck-key-bg').value;
    const isMsg = (editorLayouts[editorModelKey] || [])[selectedKeyIndex] === 'message';
    const message = isMsg ? document.getElementById('deck-key-message').value.trim() : '';
    if (label || message || fg !== '#ffffff' || bg !== '#1a1a2e') {
      const ov = { label: label || undefined, message: message || undefined };
      if (fg !== '#ffffff') ov.fg = fg;
      if (bg !== '#1a1a2e') ov.bg = bg;
      editorOverrides[overrideKey] = ov;
    } else {
      delete editorOverrides[overrideKey];
    }
    // Refresh the preview only. Don't call selectKey(): it rewrites the input fields,
    // and writing back the trimmed value would swallow each space as it is typed.
    renderEditorGrid();
    document.querySelector(`.deck-editor-key[data-index="${selectedKeyIndex}"]`)?.classList.add('selected');
  }

  function saveEditorChanges() {
    layouts = JSON.parse(JSON.stringify(editorLayouts));
    keyOverrides = JSON.parse(JSON.stringify(editorOverrides));
    saveLayouts();
    closeEditor();
    if (device) scheduleRedrawAll();
    notifyChange();
  }

  function resetToDefaults() {
    editorLayouts[editorModelKey] = [...DEFAULT_LAYOUTS[editorModelKey]];
    for (const k of Object.keys(editorOverrides)) {
      if (k.startsWith(editorModelKey + ':')) delete editorOverrides[k];
    }
    for (const [k, v] of Object.entries(DEFAULT_OVERRIDES)) {
      if (k.startsWith(editorModelKey + ':')) editorOverrides[k] = { ...v };
    }
    renderEditorGrid();
    selectedKeyIndex = null;
    document.getElementById('deck-key-options').style.display = 'none';
  }

  function exportLayout() {
    const data = { layouts, keyOverrides };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'streamdeck-layout.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importLayout() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.layouts) editorLayouts = data.layouts;
          if (data.keyOverrides) editorOverrides = data.keyOverrides;
          renderEditorGrid();
        } catch (_) { alert('Invalid layout JSON'); }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ─── Wire up editor UI events ─────────────────────────────────────────────

  function initEditorEvents() {
    // Button bar 'deck' opens the editor; connecting happens from inside it
    // (the editor overlay covers the button bar, so it can't be a second click here).
    document.getElementById('btndeck')?.addEventListener('click', openEditor);
    document.getElementById('deck-connect-btn')?.addEventListener('click', () => device ? disconnectDeck() : connectDeck());
    document.getElementById('deck-forget-btn')?.addEventListener('click', () => {
      if (confirm('Forget this Stream Deck? You will need to grant permission again to reconnect.')) forgetDeck();
    });
    document.getElementById('deck-editor-close')?.addEventListener('click', closeEditor);
    document.getElementById('deck-save-btn')?.addEventListener('click', saveEditorChanges);
    document.getElementById('deck-reset-btn')?.addEventListener('click', resetToDefaults);
    document.getElementById('deck-export-btn')?.addEventListener('click', exportLayout);
    const bsel = document.getElementById('deck-brightness');
    if (bsel) {
      if (!BRIGHTNESS_LEVELS.includes(brightness)) bsel.add(new Option(brightness + '%', String(brightness)));
      bsel.value = String(brightness);
      bsel.addEventListener('change', e => setBrightness(parseInt(e.target.value, 10)));
    }
    document.getElementById('deck-import-btn')?.addEventListener('click', importLayout);
    document.getElementById('deck-model-select')?.addEventListener('change', e => {
      editorModelKey = e.target.value;
      selectedKeyIndex = null;
      document.getElementById('deck-key-options').style.display = 'none';
      renderEditorGrid();
    });
    document.getElementById('deck-key-clear')?.addEventListener('click', () => {
      if (selectedKeyIndex !== null) {
        editorLayouts[editorModelKey][selectedKeyIndex] = 'empty';
        delete editorOverrides[editorModelKey + ':' + selectedKeyIndex];
        renderEditorGrid();
        selectKey(selectedKeyIndex);
      }
    });
    // Live preview of colour/label changes
    // Typing in the editor's fields must not reach the timer's page-wide shortcuts
    // (e.g. "Speak up" would otherwise trigger S, P and Space).
    const editorEl = document.getElementById('deck-editor');
    ['keydown', 'keyup', 'keypress'].forEach(type => editorEl?.addEventListener(type, e => {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) e.stopPropagation();
    }));
    ['deck-key-label','deck-key-message','deck-key-fg','deck-key-bg'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', applyKeyOptions);
    });
    // D key opens editor
    document.addEventListener('keydown', e => {
      if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // Controller only, and never while typing (custom message, inputs, editor fields)
        if (new URLSearchParams(location.search).has('presenter')) return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        const editor = document.getElementById('deck-editor');
        if (!editor) return;
        if (editor.style.display === 'none') openEditor(); else closeEditor();
      }
    });
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────

  function init() {
    if (!navigator.hid) {
      console.log('StreamDeck: WebHID unavailable — editor still functional for layout prep');
    }
    loadLayouts();
    _installTimerAPI();
    initEditorEvents();

    if (!navigator.hid) {
      _showDeckStatus('WebHID unavailable here — layouts can still be edited', 'idle');
      return;
    }
    _showDeckStatus('Not connected', 'idle');

    // Re-attach a previously granted device on load, and when one is plugged back in.
    // (No user gesture needed for devices already granted to this site.)
    const isDeck = d => DEVICE_IDS.some(id => id.vendorId === d.vendorId && id.productId === d.productId);
    navigator.hid.getDevices().then(devices => {
      const match = devices.find(isDeck);
      if (!match) return;
      if (autoConnectAllowed()) attach(match);
      else { pausedDevice = match; _showDeckStatus('Disconnected — click Connect to use it again', 'idle'); }
    });
    navigator.hid.addEventListener('connect', ev => {
      if (device || !isDeck(ev.device)) return;
      if (autoConnectAllowed()) attach(ev.device);
      else { pausedDevice = ev.device; _showDeckStatus('Disconnected — click Connect to use it again', 'idle'); }
    });
    navigator.hid.addEventListener('disconnect', onHidDisconnect);
  }

  // ─── Virtual deck (phone remote, see remote-control.js) ──────────────────
  // A phone can show a deck model's layout (the XL's) and press its keys. Keys run the same
  // actions as on a real deck, chosen by the operator's layout: a phone only sends an index.
  // Not from a phone: 'Remote' opens a window here, which needs a click on this computer, and
  // 'Type message' opens the on-screen box here (the phone shows its own box instead).
  const PHONE_NO_PRESS = new Set(['toggle_presenter', 'custom_msg', 'empty']);
  const changeListeners = [];
  function notifyChange() { changeListeners.forEach(fn => { try { fn(); } catch (_) { /* ignore */ } }); }

  window.StreamDeck = {
    model: m => MODELS[m],
    // Every key's face, with `a` (its action) and `press` (whether pressing does anything)
    faces(m = 'xl') {
      const model = MODELS[m], layout = layouts[m] || [];
      if (!model) return [];
      return Array.from({ length: model.keyCount }, (_, i) => {
        const a = layout[i] || 'empty', act = ACTIONS[a] || ACTIONS.empty;
        const f = faceFor(m, i, a);
        f.a = a;
        f.press = a === 'custom_msg' || (!!act.cmd && !PHONE_NO_PRESS.has(a));
        return f;
      });
    },
    press(index, m = 'xl') {
      const a = (layouts[m] || [])[index], act = ACTIONS[a];
      if (!act || !act.cmd || PHONE_NO_PRESS.has(a)) return false;
      act.cmd(index, m);
      return true;
    },
    onChange(fn) { changeListeners.push(fn); },
  };

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
