/*!
 * deck-face.js
 * Draws a Stream Deck key "face" onto a canvas. Shared by streamdeck.js (images for a real
 * deck) and the phone remote (remote.html, the virtual XL), so both look the same.
 *
 * A face is a plain object built by streamdeck.js (faceFor):
 *   { bg, fg,
 *     base:  colour   fill behind a countdown (optional)
 *     big:   {text, scale}       one large line (countdown keys)
 *     wrap:  {text, maxLines}    word-wrapped text (message keys; '\n' forces lines)
 *     rs:    {cap, body, status, foot} run sheet key: small caption + content (+ a small line at the foot)
 *     rows:  [{text, scale, alpha, color}, …]  stacked lines, each fitted to the key (Start + time,
 *            Pause + time: countdown / Pause / pauses); scale = font height as a fraction of the key
 *     label: 'Line 1\nLine 2'    ordinary key label
 *     bar:   colour   thin state bar along the bottom (optional) }
 * Sizes scale with the key, so a 96 px deck key and a 300 px phone key look alike.
 * MIT Licensed
 */

(function (root) {
  'use strict';

  const FONT = '"Helvetica Neue", Arial, sans-serif';
  // Body text size: 12 px on the 72/80 px keys, 14 px on the XL's 96 px keys, scaled above that.
  const textPx = size => (size < 90 ? 12 : Math.round(size * 14 / 96));

  // Largest bold font (up to maxPx) at which `text` fits within maxWidth.
  function fitFont(ctx, text, maxWidth, maxPx) {
    let px = maxPx;
    do { ctx.font = `bold ${px}px ${FONT}`; } while (ctx.measureText(text).width > maxWidth && --px > 8);
    return px;
  }

  // Word-wrap `text` into at most maxLines lines that fit maxWidth (ellipsis if it overflows).
  function wrapLines(ctx, text, maxWidth, maxLines) {
    const words = text.split(/\s+/).filter(Boolean), lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width <= maxWidth || !line) { line = test; continue; }
      lines.push(line); line = w;
      if (lines.length === maxLines) break;
    }
    if (lines.length < maxLines && line) lines.push(line);
    const used = lines.join(' ').split(/\s+/).length;
    if (used < words.length || ctx.measureText(lines[lines.length - 1] || '').width > maxWidth) {
      let last = lines[lines.length - 1] || '';
      while (last.length > 1 && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
      lines[lines.length - 1] = last + '…';
    }
    return lines;
  }

  function paint(ctx, f, size) {
    ctx.fillStyle = f.bg || '#1a1a2e';
    ctx.fillRect(0, 0, size, size);
    if (f.base) { ctx.fillStyle = f.base; ctx.fillRect(0, 0, size, size); }
    ctx.fillStyle = f.fg || '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (f.big) {
      fitFont(ctx, f.big.text, size * 0.86, Math.round(size * f.big.scale));
      ctx.fillText(f.big.text, size / 2, size / 2 + 1);
    }

    if (f.rows) {
      const n = f.rows.length, step = size * 0.29;
      f.rows.forEach((r, i) => {
        if (!r || !r.text) return;
        fitFont(ctx, r.text, size * 0.88, Math.round(size * (r.scale || 0.18)));
        ctx.globalAlpha = r.alpha == null ? 1 : r.alpha;
        if (r.color) ctx.fillStyle = r.color;
        ctx.fillText(r.text, size / 2, size / 2 + (i - (n - 1) / 2) * step + 1);
        ctx.globalAlpha = 1; ctx.fillStyle = f.fg || '#fff';
      });
    }

    if (f.wrap) {
      const px = textPx(size);
      ctx.font = `bold ${px}px ${FONT}`;
      const lines = f.wrap.text.includes('\n') ? f.wrap.text.split('\n') : wrapLines(ctx, f.wrap.text, size * 0.9, f.wrap.maxLines || 4);
      const lineH = px * 1.25, top = size / 2 - ((lines.length - 1) * lineH) / 2;
      lines.forEach((l, i) => ctx.fillText(l, size / 2, top + i * lineH));
    }

    if (f.rs) {
      if (!f.rs.body) {
        fitFont(ctx, f.rs.cap, size * 0.86, Math.round(size * 0.2));
        ctx.fillText(f.rs.cap, size / 2, size / 2);
      } else {
        ctx.font = `bold ${Math.round(size * 0.13)}px ${FONT}`;
        ctx.globalAlpha = 0.75; ctx.fillText(f.rs.cap, size / 2, size * 0.16); ctx.globalAlpha = 1;
        if (f.rs.status) {
          fitFont(ctx, f.rs.body, size * 0.86, Math.round(size * 0.3));
          ctx.fillText(f.rs.body, size / 2, size * 0.58);
        } else {
          const px = textPx(size);
          ctx.font = `bold ${px}px ${FONT}`;
          const lines = wrapLines(ctx, f.rs.body, size * 0.9, f.rs.foot ? 2 : 3), lineH = px * 1.2;
          const top = (f.rs.foot ? size * 0.5 : size * 0.58) - ((lines.length - 1) * lineH) / 2;
          lines.forEach((l, i) => ctx.fillText(l, size / 2, top + i * lineH));
          if (f.rs.foot) {
            fitFont(ctx, f.rs.foot, size * 0.9, Math.round(size * 0.13));
            ctx.globalAlpha = 0.8; ctx.fillText(f.rs.foot, size / 2, size * 0.84); ctx.globalAlpha = 1;
          }
        }
      }
    }

    if (f.label) {
      const lines = f.label.split('\n');
      const px = textPx(size);
      ctx.font = `bold ${px}px "Lucida", sans-serif`;
      const lineH = px * 1.4, startY = size / 2 - ((lines.length - 1) * lineH) / 2;
      lines.forEach((line, i) => ctx.fillText(line, size / 2, startY + i * lineH));
    }

    if (f.bar) {
      const h = Math.max(4, Math.round(size / 24));
      ctx.fillStyle = f.bar;
      ctx.fillRect(0, size - h, size, h);
    }
  }

  // A deck being handed to another page (the owner, 14 Nov 2026: hold the key, see what's about to happen): the top
  // row says so, every other key blank. phase 'count' (in 3, 2, 1: let go to cancel), then 'release' (let go: it goes)
  function handover(cols, count, to, phase, left) {
    const when = phase === 'release' ? 'let go' : 'in ' + left;
    const words = cols >= 3 ? [['deck', 'switching'], ['', 'to ' + to], ['', when]] : cols === 2 ? [['', '→ ' + to], ['', when]] : [['', when]];
    const bg = phase === 'release' ? '#13602a' : '#7a5c00';
    return Array.from({ length: count }, (_, i) => (i < words.length ? { bg, fg: '#fff', rs: { cap: words[i][0], body: words[i][1], foot: '' }, press: true } : { bg: '#000', fg: '#000', press: false }));
  }

  root.DeckFace = { paint, fitFont, wrapLines, handover };
})(typeof window !== 'undefined' ? window : globalThis);
