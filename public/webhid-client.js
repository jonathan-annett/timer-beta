/*!
 * webhid-client.js
 * Stream Decks through the webhid site's frame (the owner's design, 14 Nov 2026): a hidden iframe of
 * https://webhid[-alpha].<site>/frame.html (allow="hid") relays WebHID to this page, so later decks on other
 * computers, a Pi under the deck, or a virtual deck on a phone can come the same way, and the frame's own storage
 * (one per site: alpha, beta, the timer and playout alike) can hold claims and pairings. deck-hid.js asks for
 * WebHIDFrame.source() and uses it as it would navigator.hid; its devices are RemoteHID: the HIDDevice surface
 * (open, close, forget, sendReport, sendFeatureReport, receiveFeatureReport, inputreport) relayed by postMessage.
 * A trial (TimerFeatures.webhid: alpha). The frame for this site: FRAMES, or ?webhid=<frame url> (?webhid=off: none).
 * If the frame doesn't answer, the page's own WebHID is used as before.
 *
 *   WebHIDFrame.source()   null (off: use navigator.hid), or {getDevices(), requestDevice({filters}),
 *                          addEventListener('connect' | 'disconnect', fn) (ev.device), frame: true, ready: Promise<bool>}
 *                          claims: {deck id: 'playout' | 'none'} (the frame's table, one per site; loaded before ready),
 *                          claim(id, who) (applied in the frame), and a 'claims' event when another page changes them
 *                          splits() / split(deck id, product id, regions | null): a deck as virtual decks (see frame.js)
 *   RemoteHID extras       leaveReport(id, data | null): a feature report the frame sends as this page goes (a reset);
 *                          virtual {parent, region, cols, rows, keySize, protocol, model} on a split deck's region
 *
 * The first grant needs a click inside the frame: requestDevice() shows it in a dialog with its own Connect a deck…
 * button (Cancel closes it). Tested with real decks through webhid-alpha (Nov 2026): 3–4 ms a key against 3 directly.
 * MIT Licensed
 */
var WebHIDFrame = (function () {
  'use strict';
  const FRAMES = { 'alpha.timed-show.com': 'https://webhid-alpha.timed-show.com/frame.html' };
  const READY_MS = 4000;
  const CSS = `
    #webhid-box { position: fixed; left: -10000px; top: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    #webhid-box.asking { left: 0; top: 0; width: 100vw; height: 100vh; opacity: 1; pointer-events: auto; z-index: 2147483000;
      background: rgba(0, 0, 0, .55); display: flex; align-items: center; justify-content: center; }
    #webhid-box .wh-card { background: #151515; border: 1px solid #4aa8ff; border-radius: 10px; padding: 16px 18px; max-width: min(460px, calc(100vw - 32px));
      color: #ddd; font: 15px/1.45 "Helvetica Neue", Arial, sans-serif; box-shadow: 0 10px 40px rgba(0, 0, 0, .6); }
    #webhid-box iframe { display: block; width: 100%; height: 46px; border: 0; margin: 10px 0; background: transparent; }
    #webhid-box:not(.asking) .wh-say, #webhid-box:not(.asking) .wh-row { display: none; }
    #webhid-box .wh-row { display: flex; justify-content: flex-end; }
    #webhid-box button { font: inherit; color: #ddd; background: #1a1a1a; border: 1px solid #444; border-radius: 5px; padding: 4px 12px; cursor: pointer; }
  `;
  let made = null;
  const frameUrl = () => {
    const q = new URLSearchParams(location.search).get('webhid');
    if (q === 'off') return null;
    if (q && /^https:\/\//.test(q)) return q;
    return FRAMES[location.hostname] || null;
  };

  function source() {
    if (made !== null) return made;
    const presenter = new URLSearchParams(location.search).has('presenter');   // (a presenter window never drives a deck)
    const url = window.TimerFeatures && TimerFeatures.webhid && !presenter ? frameUrl() : null;
    made = url ? create(url) : false;
    return made || null;
  }

  function create(url) {
    const ORIGIN = new URL(url).origin;
    const st = document.createElement('style'); st.id = 'webhid-css'; st.textContent = CSS; document.head.appendChild(st);
    const box = document.createElement('div'); box.id = 'webhid-box';
    box.innerHTML = '<div class="wh-card"><div class="wh-say">Choose your Stream Deck: click <b>Connect a deck…</b> just below (this browser asks for the Stream Deck site you see named).</div>' +
      '<iframe allow="hid" title="Stream Deck access"></iframe><div class="wh-row"><button type="button" class="wh-cancel">Cancel</button></div></div>';
    (document.body || document.documentElement).appendChild(box);
    const frame = box.querySelector('iframe');
    const src = new EventTarget();
    let seq = 0, fallback = false;
    const waiting = new Map(), proxies = new Map();
    function call(t, fields, transfer) {
      return new Promise((res, rej) => {
        const req = ++seq;
        waiting.set(req, { res, rej });
        frame.contentWindow.postMessage(Object.assign({ t, req }, fields), ORIGIN, transfer || []);
      });
    }
    const toBuf = d => (d instanceof ArrayBuffer ? d.slice(0) : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
    class RemoteHID extends EventTarget {
      constructor(d) { super(); this.key = d.key; this.vendorId = d.vendorId; this.productId = d.productId; this.productName = d.productName; this.opened = d.opened; this.collections = []; if (d.virtual) this.virtual = d.virtual; }
      async open() { const d = await call('open', { key: this.key }); this.opened = d.opened; }
      async close() { const d = await call('close', { key: this.key }); this.opened = d.opened; }
      async forget() { await call('forget', { key: this.key }); this.opened = false; proxies.delete(this.key); }
      sendReport(id, data) { const b = toBuf(data); return call('send', { key: this.key, id, data: b }, [b]); }
      sendReports(id, list) { const bs = list.map(toBuf); return call('sendmany', { key: this.key, id, data: bs }, bs); }   // (one batch: a key's image)
      sendFeatureReport(id, data) { const b = toBuf(data); return call('fset', { key: this.key, id, data: b }, [b]); }
      async receiveFeatureReport(id) { return new DataView(await call('fget', { key: this.key, id })); }
      leaveReport(id, data) { const b = data ? toBuf(data) : null; return call('leave', { key: this.key, id, data: b }, b ? [b] : []).catch(() => {}); }
    }
    const proxyOf = d => { let p = proxies.get(d.key); if (!p) { p = new RemoteHID(d); proxies.set(d.key, p); } else p.opened = d.opened; return p; };
    let asking = null;                                // requestDevice() waiting for the frame's choice
    window.addEventListener('message', e => {
      if (e.origin !== ORIGIN || e.source !== frame.contentWindow) return;
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.t === 're') { const w = waiting.get(m.req); if (!w) return; waiting.delete(m.req); if (m.ok) w.res(m.value); else w.rej(new Error(m.error)); }
      else if (m.t === 'input') { const p = proxies.get(m.key); if (!p) return; const ev = new Event('inputreport'); ev.reportId = m.id; ev.data = new DataView(m.data); ev.device = p; p.dispatchEvent(ev); }
      else if (m.t === 'connect') { const ev = new Event('connect'); ev.device = proxyOf(m.device); src.dispatchEvent(ev); }
      else if (m.t === 'disconnect') { const p = proxies.get(m.key); if (p) { p.opened = false; const ev = new Event('disconnect'); ev.device = p; src.dispatchEvent(ev); } }
      else if (m.t === 'granted' && asking) { const a = asking; asking = null; a(m.list.map(proxyOf)); }
      else if (m.t === 'claims') { src.claims = m.value || {}; src.dispatchEvent(new Event('claims')); }
    });
    // Ready once the frame answers; if it doesn't (blocked, offline), this page's own WebHID as before
    const ready = new Promise(res => {
      const t = setTimeout(() => res(false), READY_MS);
      // (the claims table too, before anything asks who owns a deck; claims this page kept before the frame join it once)
      frame.addEventListener('load', () => call('list', {}).then(() => call('claims', {})).then(c => {
        src.claims = c || {};
        let mine = null;
        try { mine = JSON.parse(localStorage.getItem('deck_claims') || 'null'); } catch (_) { /* none */ }
        return mine && Object.keys(mine).length && !localStorage.getItem('deck_claims_moved')
          ? call('claims-merge', { value: mine }).then(v => { src.claims = v; try { localStorage.setItem('deck_claims_moved', '1'); } catch (_) { /* private */ } }) : null;
      }).then(() => { clearTimeout(t); res(true); }, () => res(false)), { once: true });
    }).then(ok => {
      src.live = ok;
      if (ok) src.dispatchEvent(new Event('claims'));   // (pages that read claims before: the frame's table now)
      if (!ok && navigator.hid) {
        fallback = true;
        console.warn('webhid: the frame at ' + url + ' didn\'t answer: this page\'s own WebHID instead');
        for (const t of ['connect', 'disconnect']) navigator.hid.addEventListener(t, e => { const ev = new Event(t); ev.device = e.device; src.dispatchEvent(ev); });
      }
      return ok;
    });
    frame.src = url;
    function hide() { box.classList.remove('asking'); if (asking) { const a = asking; asking = null; a([]); } }
    box.querySelector('.wh-cancel').addEventListener('click', hide);
    box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); hide(); } }, true);

    src.frame = true;
    src.ready = ready;
    src.claims = {};
    src.splits = () => call('splits', {});           // {deck id: [{id, x, y, w, h}]}: decks split into virtual decks
    src.split = (gid, pid, regions) => call('split', { gid, pid, regions });   // (null: whole again)
    src.claim = async (id, who) => {               // (this page's copy at once; the frame's table after)
      const c = Object.assign({}, src.claims);
      if (typeof who === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(who) && who !== 'timer') c[id] = who; else delete c[id];
      src.claims = c;
      try { src.claims = await call('claim', { id, who }); } catch (_) { /* the frame's gone: this page's copy */ }
    };
    src.getDevices = async () => ((await ready) ? (await call('list', {})).map(proxyOf) : navigator.hid ? navigator.hid.getDevices() : []);
    src.requestDevice = async opts => {
      if (!(await ready)) return navigator.hid ? navigator.hid.requestDevice(opts) : [];
      box.classList.add('asking');
      const got = await new Promise(res => { asking = res; });
      box.classList.remove('asking');
      return got;
    };
    src.__proxies = proxies;
    return src;
  }
  return { source, frameUrl, FRAMES };
})();
