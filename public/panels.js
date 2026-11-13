/*!
 * panels.js
 * A page's cards as panels the operator arranges (the owner, 14 Nov 2026: on the playout page a long run sheet
 * buried the Stream Deck keys and the video output). Each `.panel[data-panel]` child of the box has a `.phead`
 * (its title row) and a `.pbody`; this adds a grip (⠿: drag it onto another panel, or focus it and press ↑ ↓)
 * and a fold button (▾ / ▸, or click the title) to each head. The order and what's folded are kept per
 * computer in localStorage under `key` ({order: [panel…], closed: [panel…]}).
 *
 *   Panels.mount(box, {key, onChange})   → {order(), closed(), fold(name, closed), move(name, before)}
 *   onChange() runs after a panel moves, folds or unfolds (something laid out to its width may need to be again)
 *
 * MIT Licensed
 */
(function () {
  'use strict';
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
  };
  const CSS = `
    .panel > .phead { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
    .panel > .phead .ptitle { cursor: pointer; user-select: none; }
    .panel button.p-grip, .panel button.p-fold { font: inherit; line-height: 1; background: none; border: 1px solid transparent; color: var(--dim, #888);
      border-radius: 4px; padding: 2px 4px; margin: 0; cursor: pointer; }
    .panel button.p-grip { cursor: grab; letter-spacing: -1px; }
    .panel button.p-grip:hover, .panel button.p-fold:hover, .panel button.p-grip:focus-visible, .panel button.p-fold:focus-visible { color: var(--text, #ddd); border-color: var(--line, #333); }
    .panel.p-closed > .pbody { display: none; }
    .panel.p-dragging { opacity: .45; }
    .panel.p-before { box-shadow: 0 -3px 0 0 var(--accent, #4aa8ff); }
    .panel.p-after { box-shadow: 0 3px 0 0 var(--accent, #4aa8ff); }
  `;

  function mount(box, opts) {
    const key = opts.key, onChange = opts.onChange || (() => {});
    if (!document.getElementById('panels-css')) {
      const st = document.createElement('style'); st.id = 'panels-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    const panels = () => [...box.children].filter(el => el.classList.contains('panel') && el.dataset.panel);
    const byName = n => panels().find(p => p.dataset.panel === n);
    const saved = store.get(key) || {};
    const closed = new Set(Array.isArray(saved.closed) ? saved.closed : []);
    const save = () => store.set(key, { order: panels().map(p => p.dataset.panel), closed: [...closed].filter(byName) });

    // The order kept: those named first, as they were saved; any panel not named (new since) where it is among the rest
    if (Array.isArray(saved.order)) {
      const all = panels(), anchor = all.length ? all[all.length - 1].nextSibling : null;
      const want = saved.order.map(byName).filter(Boolean);
      for (const p of all) if (!want.includes(p)) want.splice(all.indexOf(p), 0, p);
      for (const p of want) box.insertBefore(p, anchor);
    }

    function fold(name, shut) {
      const p = byName(name); if (!p) return;
      if (shut === undefined) shut = !p.classList.contains('p-closed');
      if (shut) closed.add(name); else closed.delete(name);
      paint(p); save(); onChange();
    }
    function paint(p) {
      const shut = closed.has(p.dataset.panel), b = p.querySelector(':scope > .phead > .p-fold');
      p.classList.toggle('p-closed', shut);
      if (b) { b.textContent = shut ? '▸' : '▾'; b.setAttribute('aria-expanded', String(!shut)); b.title = shut ? 'Show this panel' : 'Fold this panel away'; }
    }
    function move(name, before) {                       // before: a panel's name, or null for the end
      const p = byName(name), all = panels(); if (!p) return;
      const at = before ? byName(before) : all[all.length - 1].nextSibling;
      if (at === p) return;
      box.insertBefore(p, at); save(); onChange();
    }

    let dragging = null;
    const clearMarks = () => panels().forEach(p => p.classList.remove('p-before', 'p-after'));
    for (const p of panels()) {
      const head = p.querySelector(':scope > .phead'); if (!head) continue;
      const grip = document.createElement('button'); grip.type = 'button'; grip.className = 'p-grip'; grip.textContent = '⠿'; grip.draggable = true;
      grip.title = 'Drag to move this panel up or down the page (or focus it and press ↑ ↓)'; grip.setAttribute('aria-label', 'Move this panel');
      const fb = document.createElement('button'); fb.type = 'button'; fb.className = 'p-fold';
      head.insertBefore(fb, head.firstChild); head.insertBefore(grip, head.firstChild);
      paint(p);
      fb.addEventListener('click', e => { e.currentTarget.blur(); fold(p.dataset.panel); });
      const title = head.querySelector('.ptitle'); if (title) title.addEventListener('click', () => fold(p.dataset.panel));
      grip.addEventListener('keydown', e => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault(); e.stopPropagation();
        const all = panels(), i = all.indexOf(p);
        if (e.key === 'ArrowUp' && i > 0) move(p.dataset.panel, all[i - 1].dataset.panel);
        if (e.key === 'ArrowDown' && i < all.length - 1) move(p.dataset.panel, all[i + 2] ? all[i + 2].dataset.panel : null);
        grip.focus();
      });
      grip.addEventListener('dragstart', e => {
        dragging = p; p.classList.add('p-dragging');
        e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-panel', p.dataset.panel);
        e.dataTransfer.setDragImage(p, 24, 16);
      });
      grip.addEventListener('dragend', () => { if (dragging) dragging.classList.remove('p-dragging'); dragging = null; clearMarks(); });
      p.addEventListener('dragover', e => {
        if (!dragging || dragging === p) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        const r = p.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        clearMarks(); p.classList.add(after ? 'p-after' : 'p-before');
      });
      p.addEventListener('drop', e => {
        if (!dragging || dragging === p) return;
        e.preventDefault();
        const after = p.classList.contains('p-after'); clearMarks();
        box.insertBefore(dragging, after ? p.nextSibling : p); save(); onChange();
      });
    }
    return { order: () => panels().map(p => p.dataset.panel), closed: () => [...closed], fold, move };
  }
  window.Panels = { mount };
})();
