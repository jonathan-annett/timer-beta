/*!
 * audio-out.js
 * Which sound card plays what, on this computer (Chrome and Edge: setSinkId). Two outputs, kept in
 * localStorage so every page of the site sees them:
 *   show     what the audience hears: stings (audio and video), videos and the line-up tone. The timer
 *            page is a show page (sting-player.js, the line-up tone and the video player window).
 *   preview  previews and editing: the run sheet editor (docked or in its own window), the sting library
 *            and the clip editor. Such a page loads this with data-role="preview" on the script tag.
 * Unchosen = the computer's default output, as before. A chosen show output stays put when Bluetooth
 * headphones connect (macOS makes them the default, and the stings went with them), so the operator can
 * preview on headphones while stings play out on the PA; the two kinds of page have their own audio, so
 * neither stops the other.
 * A chosen output that isn't there (unplugged, switched off) is never swapped for the default: the page's
 * sound is silenced (an AudioContext's sink 'none', media muted) and a warning shown, until it's back
 * (devicechange). For the show it's the owner's call (Nov 2026: stings don't play, videos play muted); for
 * previews it means one can never land on the PA mid-show.
 * A choice is kept as {id, label}: a device id belongs to the site and the browser profile and can change
 * (site data cleared; in Chromium's throwaway test profiles every page, the video player's pop-up too,
 * sees its own), so one not found by its id is found by its name, in each page and window for itself
 * (never written back: two pages would take turns rewriting it). The browser names sound cards only to
 * a page that may use a microphone (ask() asks; nothing is recorded). Routing that fails silences rather
 * than leaving the sound on the default output.
 *
 * A playout computer's page has both (data-role="both"): its cues play to Show, and everything that
 * doesn't name a role (the + sting dialog's previews, the clip editor, the library) to Previews.
 *   AudioOut.supported, AudioOut.role (what's routed unsaid), AudioOut.roles (this page's outputs)
 *   AudioOut.get(role) → {id, label} | null;  AudioOut.set(role, {id, label} | null)
 *   AudioOut.devices() → [{id, label}] (none until the browser will say: ask())
 *   AudioOut.ask() → devices()        the microphone permission, for the names
 *   The rest take an optional role (on a page with both; else, and unsaid, the page's own):
 *   AudioOut.attach(audioContext, role)  routes it (StingClip's contexts attach themselves)
 *   AudioOut.media(el, role) → Promise   routes a media element (await it before play())
 *   AudioOut.state(role) → 'default' | 'checking' | 'ok' | 'missing' | 'hidden'
 *   AudioOut.ok(role) → false while that output can't be used: callers warn() instead of playing
 *   AudioOut.warn(role)               says why nothing plays (show: the banner; preview: a note)
 *   AudioOut.picker(box, roles)       the choice (the run sheet editor's Options, the sting library)
 *   AudioOut.sinks()                  where each routed context/element plays now (tests)
 *   document event 'audio-out' whenever any of it changes
 * MIT Licensed
 */
var AudioOut = (function () {
  'use strict';
  const KEYS = { show: 'audio_out_show', preview: 'audio_out_preview' };
  const WHAT = { show: 'Show: stings, videos, the line-up tone', preview: 'Previews and editing' };
  const script = document.currentScript, pageRole = script && script.dataset.role;
  // A page with both (data-role="both": a playout computer) routes to Previews whatever doesn't say
  // (the + sting dialog, the clip editor, the library), so nothing reaches the show by mistake; its
  // cues ask for 'show'.
  const roles = pageRole === 'both' ? ['show', 'preview'] : [pageRole === 'preview' ? 'preview' : 'show'];
  const role = pageRole === 'both' ? 'preview' : roles[0];
  if (pageRole === 'both') WHAT.show = 'Show: the cues (audio, and videos’ sound)';
  const md = navigator.mediaDevices;
  const supported = !!(window.isSecureContext && md && md.enumerateDevices && window.AudioContext && window.WeakRef
    && 'setSinkId' in AudioContext.prototype && 'setSinkId' in HTMLMediaElement.prototype);

  function get(r) {
    try {
      const v = JSON.parse(localStorage.getItem(KEYS[r || role]) || 'null');
      return v && typeof v.id === 'string' && v.id ? { id: v.id, label: String(v.label || '') } : null;
    } catch (_) { return null; }
  }
  function set(r, dev) {
    try {
      if (dev && dev.id) localStorage.setItem(KEYS[r], JSON.stringify({ id: dev.id, label: dev.label || '' }));
      else localStorage.removeItem(KEYS[r]);
    } catch (_) { /* private mode */ }
    if (outs[r]) check(r);                           // (other pages hear of it by storage event)
    changed();
  }

  async function devices() {
    if (!supported) return [];
    try {
      return (await md.enumerateDevices())
        .filter(d => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map(d => ({ id: d.deviceId, label: d.label }));
    } catch (_) { return []; }
  }
  async function ask() {
    try { const s = await md.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); }
    catch (err) { console.warn('Sound outputs: no microphone permission, so the browser won’t name the sound cards', err); }
    await checkAll();
    changed();
    return devices();
  }

  // Where a chosen output is now: {id}, 'missing', or 'hidden' (the browser won't list them yet)
  async function find(c, list) {
    list = list || await devices();
    const byId = list.find(d => d.id === c.id);
    if (byId) return byId;
    if (!list.length) return 'hidden';
    const named = c.label ? list.filter(d => d.label === c.label) : [];
    return named.length === 1 ? named[0] : 'missing';   // (the same device under a new id)
  }
  // The id another window (the video player pop-up) knows the same card by
  async function idIn(win, id, label) {
    try {
      const list = (await win.navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
      if (list.some(d => d.deviceId === id)) return id;
      const named = label ? list.filter(d => d.label === label) : [];
      if (named.length === 1) return named[0].deviceId;
    } catch (_) { /* gone */ }
    return id;
  }

  // ─── This page's outputs, and everything routed to each ──────────────────
  // state, and sinkId: '' the default, a device id, or null = silent; ctxs, els: WeakRefs
  const outs = {};
  for (const r of roles) outs[r] = { role: r, state: 'default', sinkId: '', sinkLabel: '', turn: 0, ctxs: new Set(), els: new Set() };
  const outOf = r => outs[r] || outs[role];
  async function check(r) {
    const o = outOf(r), t = ++o.turn, c = get(o.role);
    if (!supported || !c) return settle(o, t, 'default', '');
    if (o.state === 'default') settle(o, t, 'checking', null);
    let where = await find(c);
    if (where === 'hidden') {                       // the list is hidden, but the saved id may still work
      try { await new Audio().setSinkId(c.id); where = c; } catch (_) { /* needs the permission */ }
    }
    if (typeof where === 'object') settle(o, t, 'ok', where.id, where.label || c.label);
    else settle(o, t, where, null);
  }
  const checkAll = () => Promise.all(roles.map(check));
  function settle(o, t, s, id, label) {
    if (t !== o.turn) return;
    const was = o.state + '|' + o.sinkId;
    o.state = s; o.sinkId = id; o.sinkLabel = label || '';
    each(o.ctxs, c => routeCtx(c, o)); each(o.els, e => routeEl(e, o));
    if (was !== o.state + '|' + o.sinkId) changed();
  }
  function each(set, fn) { set.forEach(ref => { const x = ref.deref(); if (x) fn(x); else set.delete(ref); }); }
  const silence = ctx => ctx.setSinkId({ type: 'none' }).catch(() => {});
  function routeCtx(ctx, o) {
    if (ctx.state === 'closed') return Promise.resolve();
    const now = ctx.sinkId, silent = o.sinkId === null;
    if (silent ? now && now.type === 'none' : now === o.sinkId) return Promise.resolve();
    if (silent) return silence(ctx);
    return ctx.setSinkId(o.sinkId).catch(err => { console.warn('Sound outputs: couldn’t route the audio, so it’s silenced', err); return silence(ctx); });
  }
  const mute = el => { if (!el.muted) { el.muted = true; el.__aoMuted = true; } };   // (unmuted only by us: never one muted otherwise)
  async function routeEl(el, o) {
    if (o.sinkId === null) return mute(el);
    const t = o.turn, win = el.ownerDocument && el.ownerDocument.defaultView;
    const want = win && win !== window ? await idIn(win, o.sinkId, o.sinkLabel) : o.sinkId;
    if (t !== o.turn) return;                       // the output changed meanwhile (settled again)
    if (el.sinkId !== want) {
      try { await el.setSinkId(want); } catch (err) { console.warn('Sound outputs: couldn’t route the audio, so it’s muted', err); return mute(el); }
    }
    if (el.__aoMuted) { el.muted = false; el.__aoMuted = false; }
  }
  // r: 'show' or 'preview' on a page with both (else, and unsaid, the page's own); once routed, stays with it
  function attach(ctx, r) {
    if (!supported || !ctx || ctx.__aoRef) return;
    const o = outOf(r);
    ctx.__aoRef = true; o.ctxs.add(new WeakRef(ctx));
    routeCtx(ctx, o);
  }
  function media(el, r) {
    if (!supported || !el) return Promise.resolve();
    const o = el.__aoOut || (el.__aoOut = outOf(r));
    if (!el.__aoRef) { el.__aoRef = true; o.els.add(new WeakRef(el)); }
    return routeEl(el, o);
  }
  const ok = r => { const s = outOf(r).state; return s !== 'missing' && s !== 'hidden'; };
  async function sinks() {                         // [{kind, sink, label: the card's name | 'default' | 'none', muted, role}]
    const out = [], names = async win => { try { return new Map((await win.navigator.mediaDevices.enumerateDevices()).map(d => [d.deviceId, d.label])); } catch (_) { return new Map(); } };
    for (const o of Object.values(outs)) {
      each(o.ctxs, c => out.push({ kind: 'context', sink: typeof c.sinkId === 'string' ? c.sinkId : 'none', role: o.role, win: window }));
      each(o.els, e => out.push({ kind: e.tagName.toLowerCase(), sink: e.sinkId, muted: e.muted, role: o.role, win: e.ownerDocument.defaultView }));
    }
    for (const o of out) {
      o.label = o.sink === '' ? 'default' : o.sink === 'none' ? 'none' : (await names(o.win)).get(o.sink) || '?';
      delete o.win;
    }
    return out;
  }

  // ─── Saying so ────────────────────────────────────────────────────────────
  const CSS = `
#ao-warn { position: fixed; top: calc(var(--buttons-bottom, 48px) + 8px); left: 50%; transform: translateX(-50%); z-index: 2147481100;
  display: flex; gap: 10px; align-items: center; max-width: min(680px, calc(100vw - 32px)); box-sizing: border-box; padding: 7px 12px;
  background: #3a0d0d; color: #ffd0d0; border: 1px solid #a33; border-radius: 8px; font: 13px/1.4 "Helvetica Neue", Arial, sans-serif; text-align: left;
  box-shadow: 0 4px 18px rgba(0,0,0,.5); }
#ao-warn[hidden] { display: none; }
#ao-warn.flash { animation: ao-flash .9s ease-in-out 2; }
@keyframes ao-flash { 50% { background: #7a1a1a; } }
#ao-warn button, #ao-toast button { flex: none; font: inherit; padding: 3px 10px; background: #222; color: #fff; border: 1px solid #777; border-radius: 5px; cursor: pointer; }
html.reduced #ao-warn { display: none; }
#ao-toast { position: fixed; left: 50%; bottom: 1.5em; transform: translateX(-50%); z-index: 2147483000; display: flex; gap: 0.7em; align-items: center;
  max-width: min(40em, calc(100vw - 2em)); box-sizing: border-box; padding: 0.6em 0.9em; background: #3a0d0d; color: #ffd0d0; border: 1px solid #a33;
  border-radius: 0.5em; font: 0.9rem/1.4 "Helvetica Neue", Arial, sans-serif; box-shadow: 0 0.3em 1.2em rgba(0,0,0,.5); }
#ao-toast[hidden] { display: none; }
.ao-pick .ao-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3em 0.6em; margin-top: 0.6em; }
.ao-pick .ao-what { flex: 1 1 100%; }
.ao-pick select { flex: 1 1 10em; min-width: 0; max-width: 100%; font: inherit; padding: 0.3em 0.4em; background: #1a1a1a; color: #ddd;
  border: 1px solid #444; border-radius: 0.3em; color-scheme: dark; }
.ao-pick .ao-name { font: inherit; padding: 0.3em 0.7em; background: #222; color: #ddd; border: 1px solid #444; border-radius: 0.3em; cursor: pointer; }
.ao-pick .ao-st { font-size: 0.85em; white-space: nowrap; }
.ao-pick .ao-st.ok { color: #8dff8d; }
.ao-pick .ao-st.bad { color: #ff8a8a; }
.ao-pick .ao-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4em 0.6em; margin-top: 0.6em; }
.ao-pick .ao-foot[hidden], .ao-pick .ao-name[hidden] { display: none; }
.ao-pick .ao-hint { font-size: 0.85em; opacity: .75; }`;
  let styled = false;
  function style() {
    if (styled) return;
    styled = true;
    const s = document.createElement('style'); s.id = 'audio-out-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  function why(r) {
    const o = outOf(r), c = get(o.role), name = c && c.label ? '“' + c.label + '”' : 'The chosen sound card';
    if (o.state === 'hidden') {
      return name + ' (the ' + (o.role === 'show' ? 'show' : 'preview') + ' output) can’t be used until the browser may use a microphone: it only lets a page pick a sound card then. Nothing is recorded.';
    }
    return o.role === 'show'
      ? name + ' (the show output) isn’t connected: ' + (pageRole === 'both' ? 'cues won’t play' : 'stings won’t play and videos are silent') + ' until it’s back. Or choose another output in ' + (pageRole === 'both' ? 'Sound outputs.' : 'the run sheet editor’s Options.')
      : name + ' (the preview output) isn’t connected, so previews don’t play: otherwise they’d go to this computer’s default output, which may be the show’s. Connect it, or choose another output in ' + (pageRole === 'both' ? 'Sound outputs.' : 'Options.');
  }
  function render() {
    if (!outs.show || !document.body) return;
    let w = document.getElementById('ao-warn');
    if (ok('show')) { if (w) w.hidden = true; return; }
    style();
    if (!w) {
      w = document.createElement('div');
      w.id = 'ao-warn';
      w.innerHTML = '<span>⚠</span><span class="ao-why"></span><button type="button">Allow</button>';
      w.querySelector('button').addEventListener('click', e => { e.currentTarget.blur(); ask(); });
      document.body.appendChild(w);
    }
    w.querySelector('.ao-why').textContent = why('show');
    w.querySelector('button').hidden = outs.show.state !== 'hidden';
    w.hidden = false;
  }
  let toastTimer = 0;
  function warn(r) {
    if (ok(r)) return;
    if (outOf(r).role === 'show') {
      render();
      const w = document.getElementById('ao-warn');
      if (w) { w.classList.remove('flash'); void w.offsetWidth; w.classList.add('flash'); }
      return;
    }
    style();
    let t = document.getElementById('ao-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'ao-toast';
      t.innerHTML = '<span>⚠</span><span class="ao-why"></span><button type="button" class="ao-allow">Allow</button><button type="button" class="ao-x">OK</button>';
      t.querySelector('.ao-allow').addEventListener('click', () => { ask(); t.hidden = true; });
      t.querySelector('.ao-x').addEventListener('click', () => { t.hidden = true; });
      document.body.appendChild(t);
    }
    t.querySelector('.ao-why').textContent = why(r);
    t.querySelector('.ao-allow').hidden = outOf(r).state !== 'hidden';
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 8000);
  }

  // ─── The choice ───────────────────────────────────────────────────────────
  const pickers = new Set();
  function picker(box, roles) {
    style();
    box.classList.add('ao-pick');
    if (!supported) { box.innerHTML = '<p class="ao-hint">Choosing sound cards needs Chrome or Edge.</p>'; return; }
    box.innerHTML = roles.map(r => '<div class="ao-row"><span class="ao-what">' + WHAT[r] + '</span><select data-role="' + r + '"></select><span class="ao-st"></span></div>').join('')
      + '<div class="ao-foot"><button type="button" class="ao-name">Name the sound cards…</button><span class="ao-hint"></span></div>';
    box.addEventListener('change', e => {
      const r = e.target.dataset.role;
      if (!r) return;
      const o = e.target.selectedOptions[0];
      set(r, o && o.value ? { id: o.value, label: o.dataset.label || '' } : null);
    });
    box.querySelector('.ao-name').addEventListener('click', e => { e.currentTarget.blur(); ask(); });
    pickers.add(box);
    fill(box);
  }
  async function fill(box) {
    const list = await devices(), named = list.some(d => d.label);
    for (const sel of box.querySelectorAll('select[data-role]')) {
      const r = sel.dataset.role, c = get(r), where = c ? await find(c, list) : null;
      const opts = [['', 'This computer’s default output', '']].concat(list.map((d, i) => [d.id, d.label || 'Sound card ' + (i + 1), d.label]));
      if (c && typeof where !== 'object') opts.push([c.id, (c.label || 'The chosen sound card') + (where === 'hidden' ? ' (the browser needs the permission)' : ' (not connected)'), c.label]);
      sel.textContent = '';
      for (const [v, text, label] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = text; o.dataset.label = label; sel.appendChild(o); }
      sel.value = c ? (typeof where === 'object' ? where.id : c.id) : '';
      const st = sel.parentNode.querySelector('.ao-st');
      st.textContent = !c ? '' : typeof where === 'object' ? '● connected' : where === 'hidden' ? '● needs the permission' : '● not connected';
      st.className = 'ao-st' + (!c ? '' : typeof where === 'object' ? ' ok' : ' bad');
    }
    box.querySelector('.ao-name').hidden = named;
    box.querySelector('.ao-hint').textContent = named ? 'Kept on this computer.' : 'The browser lists sound cards only once the site may use the microphone (nothing is recorded). Kept on this computer.';
  }
  function changed() {
    render();
    pickers.forEach(b => { if (b.isConnected) fill(b); else pickers.delete(b); });
    document.dispatchEvent(new CustomEvent('audio-out'));
  }

  if (supported) {
    md.addEventListener('devicechange', () => { checkAll(); changed(); });
    addEventListener('storage', e => {
      if (e.key !== KEYS.show && e.key !== KEYS.preview) return;
      for (const r of roles) if (e.key === KEYS[r]) check(r);
      changed();
    });
    checkAll();
    if (outs.show) {
      if (document.body) render(); else document.addEventListener('DOMContentLoaded', render);
    }
  }

  return { supported, role, roles, get, set, devices, ask, attach, media, ok, warn, picker, sinks, state: r => outOf(r).state };
})();
