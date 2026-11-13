/*!
 * deck-hid.js
 * Stream Deck hardware over WebHID (Chrome, Edge; HTTPS), any number of decks at once: open a deck,
 * hear its keys go down and up, draw a canvas on a key, set its backlight, reset it. It knows nothing of
 * what the keys do: the timer's deck (streamdeck.js) and the playout computer's soundboard (playout-deck.js)
 * both use it.
 *
 *   DeckHID.MODELS                       {mini, mk2, xl}: name, cols, rows, keySize, keyCount
 *   DeckHID.isDeck(hid), DeckHID.info(hid)   a HIDDevice that's a deck; its model and protocol
 *   DeckHID.filters()                    for navigator.hid.requestDevice
 *   DeckHID.granted()                    the decks this site may use (Promise of HIDDevices)
 *   DeckHID.idOf(hid, others)            Promise of the deck's id: 'sn:<serial>' from its feature report
 *                                        (opens it if need be), else 'pid:<product id>:<n>' (n = its place
 *                                        among `others` of that model)
 *   DeckHID.open(hid, {down(i), up(i)})  Promise of a deck: {hid, info, model, keys, keySize, id, serial,
 *                                        setKey(i, canvas) (Promise; one image at a time per deck),
 *                                        brightness(pct), reset(), blank(), detach(), close()}
 *                                        Throws when it can't be opened (the Elgato app holds it).
 *   DeckHID.orientation(kind), DeckHID.orientKind(info)   key images' rotation (editor overrides kept per kind)
 *
 * Which page drives which deck (one computer may run the timer and a playout computer side by side; both
 * see every deck the site may use, and two pages driving one deck mix up its images and both act on every
 * press): localStorage deck_claims = {deck id: 'playout'}; a deck not listed is the timer's.
 *   DeckHID.ownerOf(id), DeckHID.setOwner(id, 'timer' | 'playout'), DeckHID.onClaims(fn)
 *
 * USB device IDs and report layouts follow Julian Waller's node-elgato-stream-deck
 * (https://github.com/Julusian/node-elgato-stream-deck, MIT).
 * MIT Licensed
 */
var DeckHID = (function () {
  'use strict';

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

  // Key image orientation (degrees clockwise, after an optional horizontal mirror). gen2 (MK.2/XL) is
  // rotated 180°; the Mini's is from the owner's deck; the original v1's is still a guess. The timer's deck
  // editor (Key images) overrides it per kind on one computer (streamdeck_orientation_<kind>), for a deck
  // that differs; every page drawing on decks of that kind follows it.
  const ORIENTATION = {
    gen2: { rotate: 180, mirror: false },
    mini: { rotate: 270, mirror: true },    // the owner's Mini (Nov 2026): rotate 90° showed it flipped top to bottom
    gen1: { rotate: 180, mirror: false },   // original v1 — UNVERIFIED on hardware
  };
  const orientKind = info => (!info ? null : info.protocol === 'gen2' ? 'gen2' : info.model === 'mini' ? 'mini' : 'gen1');
  function orientation(kind) {
    try {
      const v = JSON.parse(localStorage.getItem('streamdeck_orientation_' + kind) || 'null');
      if (v && [0, 90, 180, 270].includes(v.rotate)) return { rotate: v.rotate, mirror: !!v.mirror };
    } catch (_) { /* none */ }
    return ORIENTATION[kind] || ORIENTATION.gen2;
  }

  const isDeck = hid => !!hid && DEVICE_IDS.some(d => d.vendorId === hid.vendorId && d.productId === hid.productId);
  const info = hid => DEVICE_IDS.find(d => d.vendorId === hid.vendorId && d.productId === hid.productId)
    || { model: 'mk2', protocol: 'gen2', name: 'Stream Deck (unknown model)' };
  const filters = () => DEVICE_IDS.map(d => ({ vendorId: d.vendorId, productId: d.productId }));
  const granted = () => (navigator.hid ? navigator.hid.getDevices().then(l => l.filter(isDeck)) : Promise.resolve([]));

  // The serial number, from a feature report (WebHID has no serialNumber): gen2 report 0x06 from byte 2,
  // gen1 report 0x03 from byte 5 (the report id is byte 0, as node-elgato-stream-deck reads them). Needs
  // the deck open. UNVERIFIED on hardware: if it can't be read, decks are told apart by model.
  async function readSerial(hid, inf) {
    try {
      const v = await hid.receiveFeatureReport(inf.protocol === 'gen2' ? 0x06 : 0x03);
      const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      let s = '';
      for (let i = inf.protocol === 'gen2' ? 2 : 5; i < b.length && b[i] > 0x20 && b[i] < 0x7f; i++) s += String.fromCharCode(b[i]);
      return s.length >= 4 ? s : null;
    } catch (_) { return null; }
  }
  // One open or close at a time per deck. A page asks a deck's id from more than one place at once (the
  // playout page drives its decks while it lists them): reading the serial opened the deck and closed it
  // again, which closed it under the page that had just opened it to drive it (no keys, no presses), and
  // WebHID refuses a second open while one is under way (the serial unread: another id, so not its own).
  const queues = new WeakMap(), inUse = new WeakSet();
  function serially(hid, fn) {
    const p = (queues.get(hid) || Promise.resolve()).then(fn, fn);
    queues.set(hid, p.catch(() => {}));
    return p;
  }
  const ids = new WeakMap();                           // HIDDevice → Promise of its id ('sn:': kept; by model: asked again next time)
  function idOf(hid, others) {
    if (ids.has(hid)) return ids.get(hid);
    const work = (async () => {
      let serial = null;
      try {
        serial = await serially(hid, async () => {
          const was = hid.opened;
          if (!was) await hid.open();
          try { return await readSerial(hid, info(hid)); }
          finally { if (!was && !inUse.has(hid)) await hid.close(); }   // (never a deck that's driven)
        });
      } catch (_) { /* busy (the Elgato app): by model */ }
      if (!serial) ids.delete(hid);
      const same = (others || [hid]).filter(d => d.productId === hid.productId);
      return serial ? 'sn:' + serial : 'pid:' + hid.productId.toString(16) + ':' + Math.max(0, same.indexOf(hid));
    })();
    ids.set(hid, work);
    return work;
  }

  // ─── Claims: which page drives a deck on this computer ───
  const CLAIMS = 'deck_claims';
  function claims() { try { const v = JSON.parse(localStorage.getItem(CLAIMS) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } }
  // 'playout': the playout page's; 'none': set aside there (Disconnect: neither page drives it); else the timer's
  const ownerOf = id => { const v = claims()[id]; return v === 'playout' || v === 'none' ? v : 'timer'; };
  function setOwner(id, who) {
    const c = claims();
    if (who === 'playout' || who === 'none') c[id] = who; else delete c[id];
    try { localStorage.setItem(CLAIMS, JSON.stringify(c)); } catch (_) { /* private mode */ }
  }
  const onClaims = fn => window.addEventListener('storage', e => { if (e.key === CLAIMS) fn(); });

  // ─── Images ───
  function orient(src, kind) {                         // rotated/mirrored into the orientation the device expects
    const o = orientation(kind), size = src.width;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.translate(size / 2, size / 2);
    ctx.rotate(o.rotate * Math.PI / 180);
    if (o.mirror) ctx.scale(-1, 1);
    ctx.drawImage(src, -size / 2, -size / 2);
    return c;
  }
  // A key image as JPEG, encoded now (toDataURL), not with toBlob: Chrome encodes toBlob's in idle time, which a
  // hidden tab hardly gets (its fallback timers throttled to 1 s, then 1 min), so a deck handed to a page in the
  // background took a key a second or worse to draw (the owner, 13 Nov 2026). A key's image is under 100 px a
  // side: about a millisecond.
  function jpeg(canvas) {
    const url = canvas.toDataURL('image/jpeg', 0.95), bin = atob(url.slice(url.indexOf(',') + 1)), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // gen2: report 0x02, 1024 bytes incl. report ID, 8-byte header, 1016-byte payload.
  async function sendGen2(hid, keyIndex, bytes) {
    const DATA_LEN = 1023, HEADER = 7, PAYLOAD = DATA_LEN - HEADER;
    for (let page = 0, pos = 0; pos < bytes.length; page++, pos += PAYLOAD) {
      const chunk = bytes.subarray(pos, pos + PAYLOAD);
      const isLast = pos + PAYLOAD >= bytes.length;
      const data = new Uint8Array(DATA_LEN);              // zero-padded to the full report
      data.set([0x07, keyIndex, isLast ? 1 : 0,
                chunk.length & 0xff, chunk.length >> 8,
                page & 0xff, page >> 8]);
      data.set(chunk, HEADER);
      await hid.sendReport(0x02, data);
    }
  }
  // gen1 (Mini, original v1): report 0x02, 16-byte header, BMP payload.
  async function sendGen1(hid, inf, keyIndex, bytes) {
    const DATA_LEN = inf.reportSize - 1, HEADER = 15, PAYLOAD = DATA_LEN - HEADER;
    for (let page = 0, pos = 0; pos < bytes.length; page++, pos += PAYLOAD) {
      const chunk = bytes.subarray(pos, pos + PAYLOAD);
      const isLast = pos + PAYLOAD >= bytes.length;
      const data = new Uint8Array(DATA_LEN);
      data.set([0x01, page + inf.pageBase, 0x00, isLast ? 1 : 0, keyIndex + 1]);
      data.set(chunk, HEADER);
      await hid.sendReport(0x02, data);
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

  // ─── A deck ───
  async function open(hid, on) {
    on = on || {};
    inUse.add(hid);
    try { await serially(hid, () => (hid.opened ? null : hid.open())); }
    catch (err) { inUse.delete(hid); throw err; }
    const inf = info(hid), m = MODELS[inf.model], kind = orientKind(inf);
    const id = await idOf(hid);
    // The original (v1) deck reports and addresses keys right-to-left within each row
    const physical = i => { if (!inf.mirrorCols) return i; const col = i % m.cols; return i - col + (m.cols - 1 - col); };
    const prev = [];
    function onReport(ev) {
      if (ev.reportId !== 0x01) return;
      const data = new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength);
      const offset = inf.protocol === 'gen2' ? 3 : 0;
      for (let i = 0; i < m.keyCount; i++) {
        const down = data[offset + i] === 1;
        if (down !== !!prev[i]) {                      // edges only: not while held, nor when another key changes
          prev[i] = down;
          try { if (down) { if (on.down) on.down(physical(i)); } else if (on.up) on.up(physical(i)); } catch (err) { console.warn('DeckHID: key handler', err); }
        }
      }
    }
    hid.addEventListener('inputreport', onReport);
    let queue = Promise.resolve();
    async function write(i, canvas) {
      if (!hid.opened) return;
      const img = orient(canvas, kind), k = physical(i);
      try {
        if (inf.protocol === 'gen2') {
          await sendGen2(hid, k, jpeg(img));
        } else {
          await sendGen1(hid, inf, k, toBMP(img));
        }
      } catch (err) {
        console.warn('DeckHID: key image write failed', err);
      }
    }
    const deck = {
      hid, info: inf, model: inf.model, keys: m.keyCount, keySize: m.keySize, cols: m.cols, rows: m.rows, id,
      serial: id.startsWith('sn:') ? id.slice(3) : null,
      setKey(i, canvas) { const p = queue.then(() => write(i, canvas)); queue = p; return p; },
      async brightness(pct) {
        pct = Math.max(1, Math.min(100, pct | 0));
        try {
          if (inf.protocol === 'gen2') { const d = new Uint8Array(31); d.set([0x08, pct]); await hid.sendFeatureReport(0x03, d); }
          else { const d = new Uint8Array(16); d.set([0x55, 0xaa, 0xd1, 0x01, pct]); await hid.sendFeatureReport(0x05, d); }
        } catch (err) { console.warn('DeckHID: set brightness failed', err); }
      },
      // Elgato's idle screen: one short feature report, sent without waiting (a closing page gets a
      // moment at most; blanking every key would be far too slow). Best effort.
      reset() {
        if (!hid.opened) return;
        try {
          if (inf.protocol === 'gen2') { const d = new Uint8Array(31); d[0] = 0x02; hid.sendFeatureReport(0x03, d).catch(() => {}); }
          else { const d = new Uint8Array(16); d[0] = 0x63; hid.sendFeatureReport(0x0b, d).catch(() => {}); }
        } catch (_) { /* gone already */ }
      },
      async blank() {
        const c = document.createElement('canvas');
        c.width = c.height = m.keySize;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
        for (let i = 0; i < m.keyCount; i++) await deck.setKey(i, c);
      },
      detach() { hid.removeEventListener('inputreport', onReport); },   // (stops hearing it; leaves it open)
      async close() { deck.detach(); inUse.delete(hid); await queue.catch(() => {}); try { await serially(hid, () => (hid.opened ? hid.close() : null)); } catch (_) { /* gone */ } },
    };
    return deck;
  }

  return { MODELS, DEVICE_IDS, isDeck, info, filters, granted, idOf, open, orientation, orientKind, ownerOf, setOwner, onClaims, claims };
})();
