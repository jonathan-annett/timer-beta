/*!
 * clock-panel.js
 * The controller's clock badge and its panel. The badge says what the clock is running on: internet
 * time (green), this computer's clock (yellow) or a correction set by hand (blue). Clicking it opens
 * the panel to choose; clicking it again closes it. The clock itself is timeProvider (inettime.js).
 * Offline (no network, or the timer's server out of reach) it turns red whatever the clock, reading
 * "offline · clock synced 14:02": green read as "online" with a laptop off its wifi (Nov 2026), so
 * pairing a phone failed with the badge looking fine.
 * MIT Licensed
 */
(function () {
  'use strict';
  if (new URLSearchParams(location.search).has('presenter')) return;
  if (typeof timeProvider === 'undefined') return;

  const STEPS = [[-60000, '−1 min'], [-15000, '−15 s'], [-1000, '−1 s'], [1000, '+1 s'], [15000, '+15 s'], [60000, '+1 min']];
  const DAY = 86400000;

  const LABELS = {
    internet: ['internet', 'The clock is synced to internet time'],
    local: ['local', 'The clock is running on this computer’s own time'],
    manual: ['manual', 'The clock is corrected by hand'],
    checking: ['checking…', 'Checking the time against the internet'],
  };

  const CSS = `
#clock-badge { position: fixed; top: calc(var(--buttons-bottom, 48px) + 6px); right: 16px; z-index: 2147481001; display: flex; align-items: center; gap: 6px;
  padding: 3px 9px; font: 12px/1.4 "Helvetica Neue", Arial, sans-serif; color: #ddd; background: #111; border: 1px solid #444; border-radius: 11px; cursor: pointer; }
#clock-badge:hover { color: #fff; border-color: #777; }
#clock-badge::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--cb); }
#clock-badge.cb-internet { --cb: #3ecf5a; }
#clock-badge.cb-local, #clock-badge.cb-checking { --cb: #ffcc33; }
#clock-badge.cb-manual { --cb: #4aa8ff; }
#clock-badge.cb-offline { --cb: #ff4d4d; color: #ffb3b3; border-color: #7a2a2a; }
#clock-badge.cb-busy::before { animation: cb-pulse 1s ease-in-out infinite alternate; }
@keyframes cb-pulse { to { opacity: .25; } }
#clock-panel { position: fixed; top: calc(var(--buttons-bottom, 48px) + 36px); right: 16px; width: 320px; z-index: 2147481000;
  max-height: calc(100vh - var(--buttons-bottom, 48px) - 44px); overflow-y: auto; box-sizing: border-box;
  background: #111; border: 1px solid #333; border-radius: 8px; box-shadow: 0 4px 24px rgba(0,0,0,.6);
  color: #ddd; font: 13px/1.4 "Helvetica Neue", Arial, sans-serif; padding: 10px 12px 12px; cursor: auto; text-align: left; user-select: text; }
#clock-panel[hidden] { display: none; }
#clock-panel .cp-modes { display: flex; gap: 14px; margin-bottom: 8px; }
#clock-panel .cp-modes label { display: flex; align-items: center; gap: 4px; color: #eee; cursor: pointer; }
#clock-panel .cp-modes label.off { color: #666; cursor: default; }
#clock-panel .cp-note { font-size: 12px; color: #888; margin-bottom: 8px; }
#clock-panel .cp-note.bad { color: #ffcc33; }
#clock-panel .cp-read { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; margin-bottom: 10px; }
#clock-panel .cp-read span:nth-child(odd) { color: #888; }
#clock-panel .cp-read span:nth-child(even) { text-align: right; font-variant-numeric: tabular-nums; }
#clock-panel .cp-read .cp-now { color: #fff; font-weight: bold; }
#clock-panel .cp-read .cp-net.off { color: #ff8a8a; }
#clock-panel .cp-netnote { font-size: 12px; color: #ff8a8a; margin: -4px 0 10px; }
#clock-panel .cp-netnote[hidden] { display: none; }
#clock-panel button.cp-btn { padding: 6px 4px; font: 12px "Helvetica Neue", Arial, sans-serif; background: #222; border: 1px solid #444; color: #ccc; border-radius: 4px; cursor: pointer; }
#clock-panel button.cp-btn:hover:not(:disabled) { background: #333; color: #fff; }
#clock-panel button.cp-btn:disabled { color: #666; cursor: default; }
#clock-panel .cp-sync { width: 100%; }
#clock-panel .cp-manual { margin-top: 10px; padding-top: 10px; border-top: 1px solid #2a2a2a; }
#clock-panel .cp-manual[hidden] { display: none; }
#clock-panel .cp-set { display: flex; gap: 6px; margin-bottom: 8px; }
#clock-panel .cp-set input { flex: 1; min-width: 0; padding: 5px 8px; font: 14px "Helvetica Neue", Arial, sans-serif; color: #eee; background: #1a1a1a; border: 1px solid #333; border-radius: 5px; color-scheme: dark; }
#clock-panel .cp-set input:focus { outline: none; border-color: #4aa8ff; background: #161b22; }
#clock-panel .cp-set button { flex: none; width: 76px; }
#clock-panel .cp-steps { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
#clock-panel .cp-steps button { padding: 6px 0; font-size: 11px; }
html.reduced #clock-badge, html.reduced #clock-panel { display: none; }`;

  const pad = n => String(n).padStart(2, '0');
  const clock = d => pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  const hm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());

  function correction(ms) {
    if (!ms) return 'none';
    const sign = ms < 0 ? '−' : '+', abs = Math.abs(ms);
    if (abs < 1000) return sign + (abs / 1000).toFixed(1) + ' s';
    const sec = Math.round(abs / 1000), h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60;
    return sign + (h ? h + ':' + pad(m) : m) + ':' + pad(sec % 60);
  }

  const style = document.createElement('style');
  style.id = 'clock-panel-css';
  style.textContent = CSS;
  document.head.appendChild(style);

  const badge = document.createElement('button');
  badge.id = 'clock-badge';
  badge.type = 'button';
  badge.addEventListener('click', () => { badge.blur(); toggle(); });
  document.body.appendChild(badge);

  let panel = null, ticker = null, typed = false;   // typed: the time box holds what the operator typed, not the clock
  const $ = sel => panel.querySelector(sel);

  function panelEl() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'clock-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="cp-modes">
        <label><input type="radio" name="clock-mode" value="internet">Internet</label>
        <label><input type="radio" name="clock-mode" value="local">Local</label>
        <label><input type="radio" name="clock-mode" value="manual">Manual</label>
      </div>
      <div class="cp-note"></div>
      <div class="cp-read">
        <span>This computer</span><span class="cp-local"></span>
        <span>Correction</span><span class="cp-corr"></span>
        <span>Timer clock</span><span class="cp-now"></span>
        <span>Connection</span><span class="cp-net"></span>
      </div>
      <div class="cp-netnote" hidden></div>
      <button class="cp-btn cp-sync">Sync now</button>
      <div class="cp-manual" hidden>
        <div class="cp-set"><input type="time" step="1" aria-label="The right time"><button class="cp-btn cp-apply">Set time</button></div>
        <div class="cp-steps">${STEPS.map(([ms, name]) => `<button class="cp-btn" data-ms="${ms}">${name}</button>`).join('')}</div>
      </div>`;
    document.body.appendChild(panel);
    $('.cp-set input').addEventListener('input', () => { typed = true; });
    panel.addEventListener('change', e => { if (e.target.name === 'clock-mode') timeProvider.setMode(e.target.value); });
    panel.addEventListener('click', e => {
      if (e.target.closest('button, input[type=radio]')) e.target.blur();   // the timer's keys keep working
      if (e.target.closest('.cp-sync')) timeProvider.syncNow();
      else if (e.target.closest('.cp-apply')) applyTyped();
      else if (e.target.dataset.ms) timeProvider.setManual(timeProvider.error + Number(e.target.dataset.ms));
    });
    // Typing here mustn't work the timer (digits, Space…); Escape closes
    for (const t of ['keydown', 'keyup', 'keypress']) panel.addEventListener(t, e => {
      if (e.metaKey) return;
      e.stopPropagation();
      if (t !== 'keydown') return;
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter' && e.target.type === 'time') { applyTyped(); e.target.blur(); }
    });
    // One panel at a time
    document.addEventListener('timer-panel', e => { if (e.detail !== 'clock') close(); });
    return panel;
  }

  // The typed time is taken as the nearest such time of day, so it can't land a day out
  function applyTyped() {
    const parts = $('.cp-set input').value.split(':').map(Number);
    if (parts.length < 2 || parts.some(n => !Number.isFinite(n))) return;
    const target = new Date();
    target.setHours(parts[0], parts[1], parts[2] || 0, 0);
    let offset = target.getTime() - Date.now();
    if (offset > DAY / 2) offset -= DAY;
    if (offset < -DAY / 2) offset += DAY;
    typed = false;
    timeProvider.setManual(offset);
  }

  function noteText(t) {
    if (t.busy) return ['Checking the time servers…', false];
    if (t.state === 'internet') return ['Synced with ' + t.source + ' at ' + clock(new Date(t.syncedAt + t.error)) + '.', false];
    if (t.state === 'manual') return ['Set by hand. Changing it doesn’t disturb a running countdown.', false];
    if (t.reachable === false) return ['Couldn’t reach a time server, so internet time isn’t available.', true];
    return ['Running on this computer’s own clock.', false];
  }

  // ─── Online or not ───────────────────────────────────────────────────────
  // What pairing needs: the timer's server (remote_server, else RemotePeer.defaultServer(), as
  // remote-control.js). The browser's offline event says so at once (a dropped wifi); while the page is
  // shown, a websocket opened to the server every minute also catches a network with no way out. A
  // failed check is tried again 5 s later before it counts. Back online, internet time that couldn't
  // be had is fetched again.
  const PROBE_MS = 60000, RETRY_MS = 5000, PROBE_TIMEOUT = 4000;
  const net = { online: null, why: '' };            // online: null = not known yet; why: 'network' | 'server'
  let probing = false, probeTimer = 0;
  const server = () => localStorage.getItem('remote_server') || RemotePeer.defaultServer();
  const host = () => { try { return new URL(server()).hostname; } catch (_) { return 'the server'; } };
  function reach() {                                // true if the server takes a websocket, null if there's nothing to try
    return new Promise(done => {
      if (typeof RemotePeer === 'undefined') return done(null);
      let ws, timer = 0;
      const end = ok => {
        clearTimeout(timer);
        if (ws) { ws.onopen = ws.onerror = ws.onclose = null; try { ws.close(); } catch (_) { /* gone */ } }
        done(ok);
      };
      try { ws = new WebSocket(RemotePeer.socketUrl(server(), { time: 1 })); } catch (_) { return done(false); }
      timer = setTimeout(() => end(false), PROBE_TIMEOUT);
      ws.onopen = () => end(true);
      ws.onerror = ws.onclose = () => end(false);
    });
  }
  function setNet(on, why) {
    const was = net.online;
    net.online = on; net.why = on ? '' : why;
    const t = timeProvider;
    if (on && was === false && t.mode === 'internet' && t.state !== 'internet' && !t.busy) t.syncNow();
    render();
  }
  async function probe(again) {
    clearTimeout(probeTimer);
    if (!navigator.onLine) return setNet(false, 'network');   // the online event brings it back
    if (probing) return;
    probing = true;
    const ok = await reach();
    probing = false;
    if (ok === null) return;
    if (ok) setNet(true);
    else if (!again && net.online !== false) { probeTimer = setTimeout(() => probe(true), RETRY_MS); return; }
    else setNet(false, navigator.onLine ? 'server' : 'network');
    if (!document.hidden) probeTimer = setTimeout(probe, PROBE_MS);
  }
  addEventListener('offline', () => { clearTimeout(probeTimer); setNet(false, 'network'); });
  addEventListener('online', () => probe());
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(probeTimer); else probe(); });
  function offlineText(t) {
    const what = net.why === 'network' ? 'This computer is offline (no network).' : 'Can’t reach ' + host() + ', the timer’s server.';
    const clockNote = t.state === 'internet' && t.syncedAt ? ' The clock is fine: it keeps the internet time it got at ' + hm(new Date(t.syncedAt + t.error)) + '.' : '';
    return what + ' The timer carries on, but phones, displays and Companion can’t connect until it’s back.' + clockNote;
  }

  function render() {
    const t = timeProvider, [label, title] = LABELS[t.state], off = net.online === false;
    const synced = t.state === 'internet' && t.syncedAt ? hm(new Date(t.syncedAt + t.error)) : '';
    badge.textContent = off ? 'offline · ' + (synced ? 'clock synced ' + synced : 'clock: ' + label) : 'clock: ' + label;
    badge.title = (off ? offlineText(t) + ' ' : title + '. ') + 'Click for settings';
    badge.className = 'cb-' + t.state + (t.busy ? ' cb-busy' : '') + (off ? ' cb-offline' : '');
    if (!panel) return;
    const cn = $('.cp-net');
    cn.textContent = net.online === null ? 'checking…' : off ? (net.why === 'network' ? 'offline' : 'can’t reach ' + host()) : 'online (' + host() + ')';
    cn.classList.toggle('off', off);
    $('.cp-netnote').hidden = !off;
    $('.cp-netnote').textContent = off ? offlineText(t) : '';
    const shown = t.state === 'checking' ? 'internet' : t.state;
    panel.querySelectorAll('input[type=radio]').forEach(r => {
      r.checked = r.value === shown;
      if (r.value === 'internet') {
        r.disabled = t.reachable !== true;
        r.parentNode.classList.toggle('off', r.disabled);
      }
    });
    const [text, bad] = noteText(t), note = $('.cp-note');
    note.textContent = text;
    note.classList.toggle('bad', bad);
    $('.cp-sync').disabled = t.busy;
    $('.cp-sync').textContent = t.busy ? 'Checking…' : 'Sync now';
    $('.cp-manual').hidden = t.state !== 'manual';
    tick();
  }

  function tick() {
    const now = timeProvider.date();
    $('.cp-local').textContent = clock(new Date());   // deliberately this computer's clock, uncorrected
    $('.cp-corr').textContent = correction(timeProvider.error);
    $('.cp-now').textContent = clock(now);
    const input = $('.cp-set input');
    if (document.activeElement !== input && !typed) input.value = clock(now);
  }

  function close() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    typed = false;
    clearInterval(ticker);
    if (panel.contains(document.activeElement)) document.activeElement.blur();
  }

  function toggle() {
    const el = panelEl();
    if (!el.hidden) return close();
    el.hidden = false;
    document.dispatchEvent(new CustomEvent('timer-panel', { detail: 'clock' }));
    render();
    ticker = setInterval(tick, 250);
    if (timeProvider.state !== 'internet' && !timeProvider.busy) timeProvider.check();
    probe();
  }

  document.addEventListener('clock-state', render);
  render();
  if (!navigator.onLine) setNet(false, 'network');
  setTimeout(probe, 1500);                          // after the deferred scripts (RemotePeer)

  window.clockPanel = { toggle, close, get online() { return net.online; }, probe };
})();
