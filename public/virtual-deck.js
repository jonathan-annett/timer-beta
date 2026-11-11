/*!
 * virtual-deck.js
 * An on-screen Stream Deck: a grid of keys drawn with deck-face.js, as on the real deck, for any model
 * (Mini 3×2, MK.2 5×3, XL 8×4). Shared by the phone remote's deck view (remote-phone.js: faces from the
 * timer over the link) and the timer's own pop-up deck (deck.html: faces from the timer window), so
 * both look and size the same.
 *
 *   const vd = VirtualDeck.create(box, {bind(canvas, i), onPress(i)})
 *     box: the element the keys go in (a CSS grid: --cols, --key, --col-gap, --row-gap are set on it)
 *     bind: wires a key's presses (the phone's pressable); else a plain press calls onPress(i)
 *   vd.setModel('xl' | 'mk2' | 'mini')   the grid (keeps the faces it has if the count is the same)
 *   vd.layout(width, height, maxGap)     the biggest square keys that fit, spare space into the gaps
 *   vd.setFace(i, face)                  a key's face (streamdeck.js faceFor: {bg, fg, label…, a, press})
 *   vd.setBacklight(pct)                 dims the keys like the deck's backlight (never quite black)
 *   vd.faces, vd.model, vd.count
 * A face's `press` says whether the key does anything (else it's drawn idle); `a` is its action.
 * MIT Licensed
 */
var VirtualDeck = (function () {
  'use strict';
  const MODELS = { mini: { cols: 3, rows: 2 }, mk2: { cols: 5, rows: 3 }, xl: { cols: 8, rows: 4 } };
  // Display keys (they don't do anything, but aren't "off" either)
  const SHOW_ONLY = new Set(['countdown', 'countdown_major', 'countdown_minor', 'rs_status', 'empty', 'kp_pv_h', 'kp_pv_m', 'kp_pv_s', 'kp_pv_typed']);

  function plainPress(c, go) {                         // down on press, act on release over the key
    c.addEventListener('pointerdown', e => { c.classList.add('down'); try { c.setPointerCapture(e.pointerId); } catch (_) { /* gone */ } });
    c.addEventListener('pointerup', e => {
      const r = c.getBoundingClientRect(), inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      c.classList.remove('down');
      if (inside) go();
    });
    c.addEventListener('pointercancel', () => c.classList.remove('down'));
  }

  function create(box, opts) {
    opts = opts || {};
    const faces = [], canvases = [];
    let model = null, cols = 8, rows = 4, keyCss = 40;

    function draw(i) {
      const c = canvases[i], f = faces[i];
      if (!c) return;
      const px = Math.round(keyCss * (window.devicePixelRatio || 1));
      if (c.width !== px) { c.width = c.height = px; }
      const ctx = c.getContext('2d');
      if (!f) { ctx.fillStyle = '#0d0d0d'; ctx.fillRect(0, 0, px, px); return; }
      DeckFace.paint(ctx, f, px);
      c.classList.toggle('idle', !f.press);
      c.classList.toggle('off', !f.press && !SHOW_ONLY.has(f.a));
    }

    function setModel(m) {
      const g = MODELS[m] || MODELS.xl;
      const n = g.cols * g.rows;
      if (model === m && canvases.length === n) return;
      model = m; cols = g.cols; rows = g.rows;
      box.style.setProperty('--cols', cols);
      if (canvases.length !== n) {
        box.innerHTML = ''; canvases.length = 0; faces.length = 0;
        for (let i = 0; i < n; i++) {
          const c = document.createElement('canvas');
          c.className = 'idle';
          c.addEventListener('pointerdown', e => e.preventDefault());
          if (opts.bind) opts.bind(c, i);
          else plainPress(c, () => { if (faces[i] && faces[i].press && opts.onPress) opts.onPress(i); });
          box.appendChild(c);
          canvases.push(c);
        }
      }
    }

    // The biggest square keys that fit width × height, the spare space shared into the gaps (up to maxGap of a key)
    function layout(W, H, maxGap) {
      const MIN_GAP = 0.08, MAX_GAP = maxGap == null ? 0.2 : maxGap;
      keyCss = Math.max(20, Math.floor(Math.min(W / (cols + (cols - 1) * MIN_GAP), H / (rows + (rows - 1) * MIN_GAP))));
      const colGap = cols > 1 ? Math.min((W - cols * keyCss) / (cols - 1), keyCss * MAX_GAP) : 0;
      const rowGap = rows > 1 ? Math.min((H - rows * keyCss) / (rows - 1), keyCss * MAX_GAP) : 0;
      box.style.setProperty('--key', keyCss + 'px');
      box.style.setProperty('--col-gap', Math.max(0, Math.floor(colGap)) + 'px');
      box.style.setProperty('--row-gap', Math.max(0, Math.floor(rowGap)) + 'px');
      canvases.forEach((_, i) => draw(i));
    }

    function setFace(i, f) {
      if (i < 0 || i >= canvases.length || !f || typeof f !== 'object') return;
      faces[i] = f;
      draw(i);
    }

    function setBacklight(pct) {
      if (typeof pct === 'number' && pct >= 1 && pct <= 100) box.style.setProperty('--deck-bl', (0.2 + 0.8 * pct / 100).toFixed(3));
    }

    return { setModel, layout, setFace, setBacklight, draw, faces,
      get model() { return model; }, get count() { return canvases.length; } };
  }

  return { create, MODELS };
})();
