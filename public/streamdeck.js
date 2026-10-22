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

  // USB vendor/product IDs for model detection
  const DEVICE_IDS = [
    { vendorId: 0x0fd9, productId: 0x0063, model: 'mini' },
    { vendorId: 0x0fd9, productId: 0x006d, model: 'mini' },
    { vendorId: 0x0fd9, productId: 0x0080, model: 'mini' },
    { vendorId: 0x0fd9, productId: 0x0060, model: 'mk2'  },
    { vendorId: 0x0fd9, productId: 0x006c, model: 'mk2'  },
    { vendorId: 0x0fd9, productId: 0x0090, model: 'mk2'  },
    { vendorId: 0x0fd9, productId: 0x008f, model: 'xl'   },
    { vendorId: 0x0fd9, productId: 0x00c6, model: 'xl'   },
  ];

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
    toggle_bar:       { label: 'Bar',       group: 'Display',   toggleState: 'showbar',      cmd: () => _sendCmd({ cmd: 'bar' }) },
    toggle_time:      { label: 'Clock',     group: 'Display',   toggleState: 'showtimenow',  cmd: () => _sendCmd({ cmd: 'time' }) },
    toggle_messages:  { label: 'Messages',  group: 'Display',   toggleState: 'showmessages', cmd: () => _sendCmd({ cmd: 'messages' }) },
    toggle_presenter: { label: 'Remote',    group: 'Display',   cmd: () => _sendCmd({ cmd: 'presenter' }) },
    custom_msg:       { label: 'Message',   group: 'Other',     cmd: () => _sendCmd({ cmd: 'keys', keys: ['c'] }) },
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
      'empty','empty','empty','empty','empty','empty','empty','empty',
      'start_restart','pause_resume','add_1min','sub_1min','add_15sec','sub_15sec','undo_pause','custom_msg',
      'toggle_bar','toggle_time','toggle_messages','toggle_presenter','empty','empty','empty','empty',
    ],
  };

  // ─── Runtime state ────────────────────────────────────────────────────────

  let deckState = {
    remain: '0:00', expired: false, impending: false,
    pausing: false, showbar: false, showtimenow: false, showmessages: false,
  };

  let device = null;
  let modelKey = null;
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
            const val = (typeof v[k] === 'string') ? (v[k] === '1' || v[k] === 'true') : !!v[k];
            if (k in deckState) {
              if (deckState[k] !== val) { deckState[k] = val; changed = true; }
            }
            if (k === 'remain' && deckState.remain !== v[k]) {
              deckState.remain = v[k]; changed = true;
            }
          }
          if (changed && device) scheduleRedrawAll();
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
      keyOverrides = saved ? JSON.parse(saved) : {};
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
    if (device) { _showDeckStatus('Connected: ' + MODELS[modelKey].name, 'ok'); return; }
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

  // Shared by manual connect and auto-reconnect.
  async function attach(hid) {
    try {
      if (!hid.opened) await hid.open();
    } catch (err) {
      console.warn('StreamDeck: open failed', err);
      _showDeckStatus('Device is busy — quit the Elgato Stream Deck app, then Connect again', 'error');
      return false;
    }
    modelKey = detectModel(hid);
    device = hid;
    device.addEventListener('inputreport', onKeyEvent);
    _showDeckStatus('Connected: ' + MODELS[modelKey].name, 'ok');
    scheduleRedrawAll();
    console.log('StreamDeck: connected', modelKey);
    return true;
  }

  function onHidDisconnect(ev) {
    if (device && ev.device === device) {
      device.removeEventListener('inputreport', onKeyEvent);
      device = null;
      _showDeckStatus('Disconnected — plug it back in, or click Connect', 'idle');
    }
  }

  function detectModel(hid) {
    const match = DEVICE_IDS.find(d => d.vendorId === hid.vendorId && d.productId === hid.productId);
    return match ? match.model : 'mk2';
  }

  function onKeyEvent(ev) {
    const data = new Uint8Array(ev.data.buffer);
    const model = MODELS[modelKey];
    if (!model) return;
    // Key state starts at byte 3 for most models; byte 1 for Mini
    const offset = modelKey === 'mini' ? 1 : 3;
    for (let i = 0; i < model.keyCount; i++) {
      if (data[offset + i] === 1) {
        onKeyPress(i);
      }
    }
  }

  function onKeyPress(index) {
    const layout = layouts[modelKey];
    if (!layout) return;
    const actionKey = layout[index];
    if (!actionKey || actionKey === 'empty') return;
    const action = ACTIONS[actionKey];
    if (action && action.cmd) action.cmd();
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

  async function flushDraw() {
    drawScheduled = false;
    if (!device || !modelKey) return;
    const model = MODELS[modelKey];
    const layout = layouts[modelKey];
    for (const index of dirtyKeys) {
      if (index < model.keyCount) {
        const actionKey = layout ? layout[index] : 'empty';
        const pixels = renderKey(index, actionKey, model.keySize);
        await writeKeyImage(index, pixels, model);
      }
    }
    dirtyKeys.clear();
  }

  function renderKey(index, actionKey, size) {
    const action = ACTIONS[actionKey] || ACTIONS['empty'];
    const overrideKey = modelKey + ':' + index;
    const override = keyOverrides[overrideKey] || {};

    // Determine colours from state
    let bg = override.bg || '#1a1a2e';
    let fg = override.fg || '#ffffff';

    const isToggled = action.toggleState && deckState[action.toggleState];
    if (isToggled) { bg = '#0f3460'; fg = '#e94560'; }
    if (deckState.expired) { bg = '#2d0000'; fg = '#ff4444'; }
    else if (deckState.impending && actionKey !== 'empty') { bg = '#2d1a00'; fg = '#ff9900'; }
    if (actionKey === 'pause_resume' && deckState.pausing) { bg = '#2d1a00'; fg = '#ff9900'; }

    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    const rawLabel = override.label ||
      (action.toggleState && deckState[action.toggleState] && action.altLabel ? action.altLabel : action.label) || '';

    if (rawLabel) {
      const lines = rawLabel.split('\n');
      const fontSize = size < 90 ? 12 : 14;
      ctx.fillStyle = fg;
      ctx.font = `bold ${fontSize}px "Lucida", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lineH = fontSize * 1.4;
      const startY = size / 2 - ((lines.length - 1) * lineH) / 2;
      lines.forEach((line, i) => ctx.fillText(line, size / 2, startY + i * lineH));
    }

    // Thin state indicator bar at bottom
    if (deckState.expired) {
      ctx.fillStyle = '#ff2222';
      ctx.fillRect(0, size - 4, size, 4);
    } else if (deckState.impending) {
      ctx.fillStyle = '#ff9900';
      ctx.fillRect(0, size - 4, size, 4);
    } else if (deckState.pausing) {
      ctx.fillStyle = '#888888';
      ctx.fillRect(0, size - 4, size, 4);
    }

    return ctx.getImageData(0, 0, size, size).data;
  }

  async function writeKeyImage(keyIndex, pixels, model) {
    // Stream Deck image protocol: 16-bit BGR565 little-endian, sent in 1024-byte chunks
    // Physical key order on MK.II / XL is left-to-right, top-to-bottom
    const size = model.keySize;
    const buf565 = new Uint8Array(size * size * 2);
    for (let i = 0; i < size * size; i++) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      const val = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
      buf565[i * 2]     = val & 0xff;
      buf565[i * 2 + 1] = (val >> 8) & 0xff;
    }

    const CHUNK = 1024;
    const pageSize = modelKey === 'xl' ? 1024 : 1024;
    let pageNum = 0;
    let offset = 0;
    while (offset < buf565.length) {
      const chunk = buf565.slice(offset, offset + CHUNK);
      const isLast = (offset + CHUNK) >= buf565.length;
      const header = buildImageHeader(keyIndex, pageNum, chunk.length, isLast);
      const report = new Uint8Array(header.length + chunk.length);
      report.set(header); report.set(chunk, header.length);
      try { await device.sendReport(0x02, report); } catch (_) {}
      offset += CHUNK;
      pageNum++;
    }
  }

  function buildImageHeader(keyIndex, pageNum, payloadLen, isLast) {
    // Header format varies slightly by model generation — this covers MK.II/XL/Mini gen2
    return new Uint8Array([
      0x02, 0x07, keyIndex,
      isLast ? 0x01 : 0x00,
      payloadLen & 0xff, (payloadLen >> 8) & 0xff,
      pageNum & 0xff, (pageNum >> 8) & 0xff,
    ]);
  }

  // ─── Status indicator ─────────────────────────────────────────────────────

  // kind: 'ok' | 'error' | 'idle'
  function _showDeckStatus(text, kind = 'idle') {
    const status = document.getElementById('deck-status');
    if (status) { status.textContent = text; status.dataset.kind = kind; }
    const connectBtn = document.getElementById('deck-connect-btn');
    if (connectBtn) connectBtn.textContent = device ? 'Connected ✓' : 'Connect deck';
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
      cell.textContent = ov.label || action.label || '';
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
          if (selectedKeyIndex === i) selectKey(i);
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
    document.getElementById('deck-key-fg').value = ov.fg || '#ffffff';
    document.getElementById('deck-key-bg').value = ov.bg || '#1a1a2e';
  }

  function applyKeyOptions() {
    if (selectedKeyIndex === null) return;
    const overrideKey = editorModelKey + ':' + selectedKeyIndex;
    const label = document.getElementById('deck-key-label').value.trim();
    const fg    = document.getElementById('deck-key-fg').value;
    const bg    = document.getElementById('deck-key-bg').value;
    if (label || fg !== '#ffffff' || bg !== '#1a1a2e') {
      editorOverrides[overrideKey] = { label: label || undefined, fg, bg };
    } else {
      delete editorOverrides[overrideKey];
    }
    renderEditorGrid();
    selectKey(selectedKeyIndex);
  }

  function saveEditorChanges() {
    layouts = JSON.parse(JSON.stringify(editorLayouts));
    keyOverrides = JSON.parse(JSON.stringify(editorOverrides));
    saveLayouts();
    closeEditor();
    if (device) scheduleRedrawAll();
  }

  function resetToDefaults() {
    editorLayouts[editorModelKey] = [...DEFAULT_LAYOUTS[editorModelKey]];
    for (const k of Object.keys(editorOverrides)) {
      if (k.startsWith(editorModelKey + ':')) delete editorOverrides[k];
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
    document.getElementById('deck-connect-btn')?.addEventListener('click', connectDeck);
    document.getElementById('deck-editor-close')?.addEventListener('click', closeEditor);
    document.getElementById('deck-save-btn')?.addEventListener('click', saveEditorChanges);
    document.getElementById('deck-reset-btn')?.addEventListener('click', resetToDefaults);
    document.getElementById('deck-export-btn')?.addEventListener('click', exportLayout);
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
    ['deck-key-label','deck-key-fg','deck-key-bg'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', applyKeyOptions);
    });
    // D key opens editor
    document.addEventListener('keydown', e => {
      if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.altKey) {
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
      if (match) attach(match);
    });
    navigator.hid.addEventListener('connect', ev => { if (!device && isDeck(ev.device)) attach(ev.device); });
    navigator.hid.addEventListener('disconnect', onHidDisconnect);
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
