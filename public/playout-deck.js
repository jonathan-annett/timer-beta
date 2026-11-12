/*!
 * playout-deck.js
 * The playout computer's Stream Deck: a soundboard of the run sheet's items (the owner's design, 12 Nov
 * 2026; rehearsals, where the order depends on who's there). A key per item with cues, in run sheet order
 * unless arranged: with Follow the timer off, pressing one starts the item (▶ Start item: its cues timed
 * from the press). On an item that's playing (or started here), the key stops it: going down starts a fade
 * (over at most playout_deck_fade seconds, 2 unless set), coming up stops it at once; so a tap stops it,
 * and holding fades it out, stopped wherever it's let go. The last key does the same for everything
 * (and the line-up tones); ◀ ▶ before it turn the page when the items don't fit. With Follow on, the keys
 * show the run sheet (the live item marked) and only stop or fade: the timer starts the items.
 *
 * Keys are arranged per deck model (playout_deck_layout = {mini|mk2|xl: [item id | null, …]}, slots in
 * page order; playout_demo_deck_layout in the demo): Arrange keys on the page shows every page and a key
 * dragged onto another swaps them; items not in the arrangement go at the end; Run sheet order forgets it.
 * The same keys on the page work as a soundboard with the mouse (down and up as on the deck).
 *
 * Decks (deck-hid.js): those given to the playout on this computer (deck_claims; Connect a deck… here, or
 * Use here in the list) are driven here, any number of them, each with its own page; the rest are the
 * timer's. One playout tab drives them (Web Lock playout-streamdeck).
 *
 *   PlayoutDeck.create(api) → {changed()}: api = {store, demo, items(), cuesOf(id), title(it), following(),
 *   nowId(), isDone(id), playingIds(id), anyPlaying(), localItem(), localText(), start(id), fadeItem(id, ms) → cue ids,
 *   fadeAll(ms) → cue ids, stopIds(ids), stopAll()}
 * MIT Licensed
 */
var PlayoutDeck = (function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mmss = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const COLOURS = { idle: '#1c2a3a', none: '#121212', here: '#7a5c00', play: '#13602a', fade: '#9a5200', now: '#0b3d5c', done: '#181818', all: '#3a1212', allOn: '#8a1a1a', page: '#262626' };

  function create(api) {
    const LAYOUT = api.demo ? 'playout_demo_deck_layout' : 'playout_deck_layout', FADE = 'playout_deck_fade', MODEL = 'playout_deck_model';
    const MODELS = DeckHID.MODELS;
    let arranged = {};
    try { const v = JSON.parse(api.store.get(LAYOUT) || '{}'); if (v && typeof v === 'object') arranged = v; } catch (_) { /* none */ }
    const fadeSecs = () => { const v = parseFloat(api.store.get(FADE)); return v >= 0.2 && v <= 10 ? v : 2; };

    // ─── Keys: slots (item ids in page order) and what each key is ───
    const onSheet = () => new Map(api.items().map(it => [it.id, it]));
    function slots(model) {
      const keyed = api.items().filter(it => api.cuesOf(it.id).length).map(it => it.id);
      const saved = arranged[model];
      if (!Array.isArray(saved)) return keyed;
      const s = saved.map(x => (typeof x === 'string' ? x : null)), have = new Set(s);
      for (const id of keyed) if (!have.has(id)) s.push(id);   // new ones at the end
      return s;
    }
    function geometry(model, n) {
      const K = MODELS[model].keyCount, paged = n > K - 1, per = paged ? K - 3 : K - 1;
      return { K, paged, per, pages: Math.max(1, Math.ceil(n / per)) };
    }
    function keyAt(model, n, page, i) {                // the last key: everything; ◀ ▶ before it when paged
      const g = geometry(model, n);
      if (i === g.K - 1) return { kind: 'all' };
      if (g.paged && i === g.K - 3) return { kind: 'prev' };
      if (g.paged && i === g.K - 2) return { kind: 'next' };
      return { kind: 'item', slot: page * g.per + i };
    }

    // ─── Presses (a real deck's, or the page's keys): down, then up ───
    const boards = new Set();                          // every {model(), page, presses} that presses keys
    const fading = id => [...boards].some(b => [...b.presses.values()].some(p => p.item === id || (p.all && p.ids.length && api.playingIds(id).length)));
    function handle(b, i, down) {
      const model = b.model(), s = slots(model), g = geometry(model, s.length), k = keyAt(model, s.length, Math.min(b.page, g.pages - 1), i);
      if (down) {
        if (k.kind === 'prev') b.page = Math.max(0, Math.min(b.page, g.pages - 1) - 1);
        else if (k.kind === 'next') b.page = Math.min(g.pages - 1, b.page + 1);
        else if (k.kind === 'all') b.presses.set(i, { all: true, ids: api.fadeAll(fadeSecs() * 1000) });
        else {
          const id = s[k.slot];
          if (!id || !onSheet().has(id)) return;
          if (api.localItem() === id || api.playingIds(id).length) b.presses.set(i, { item: id, ids: api.fadeItem(id, fadeSecs() * 1000) });
          else if (!api.following() && api.cuesOf(id).length) api.start(id);
        }
      } else {
        const p = b.presses.get(i);
        if (!p) return;
        b.presses.delete(i);
        if (p.all) api.stopAll(); else api.stopIds(p.ids);
      }
      changed();
    }

    // ─── Faces (deck-face.js), the same on a deck and on the page ───
    function itemFace(id, items) {
      const it = items.get(id);
      if (!it) return { bg: '#000', fg: '#000', press: false, slot: true, a: 'empty' };   // nothing (or an item not on the sheet)
      const n = api.cuesOf(id).length, playing = api.playingIds(id).length, here = api.localItem() === id, follow = api.following();
      let bg = n ? COLOURS.idle : COLOURS.none, cap = n ? (it.d ? mmss(it.d) : '') : 'no cues';
      if (fading(id)) { bg = COLOURS.fade; cap = 'fading'; }
      else if (here) { bg = COLOURS.here; cap = api.localText(); }
      else if (playing) { bg = COLOURS.play; cap = 'playing'; }
      else if (follow && api.nowId() === id) { bg = COLOURS.now; cap = 'NOW'; }
      else if (follow && api.isDone(id)) bg = COLOURS.done;
      return { bg, fg: n ? '#fff' : '#777', rs: { cap, body: api.title(it) || '(no name)', foot: n === 1 ? '1 cue' : n + ' cues' },
        press: here || playing > 0 || (!follow && n > 0), slot: true, a: 'empty' };   // (a: never drawn "off" on the page: its colour says it)
    }
    function faces(model, page) {
      const s = slots(model), g = geometry(model, s.length), items = onSheet();
      page = Math.min(page, g.pages - 1);
      const busy = api.anyPlaying();
      return Array.from({ length: g.K }, (_, i) => {
        const k = keyAt(model, s.length, page, i);
        if (k.kind === 'all') return { bg: busy ? COLOURS.allOn : COLOURS.all, fg: '#fff', rs: { cap: 'tap: stop', body: '■ All', foot: 'hold: fade' }, press: true };
        if (k.kind === 'prev') return { bg: COLOURS.page, fg: '#fff', rs: { cap: 'page', body: '◀', foot: (page + 1) + ' / ' + g.pages }, press: page > 0 };
        if (k.kind === 'next') return { bg: COLOURS.page, fg: '#fff', rs: { cap: 'page', body: '▶', foot: (page + 1) + ' / ' + g.pages }, press: page < g.pages - 1 };
        return itemFace(s[k.slot], items);
      });
    }

    // ─── Decks (deck-hid.js) ───
    const decks = new Map();                           // deck id → {deck, page, presses, sent: [face JSON], model()}
    let owner = false, looking = false;
    const busyNote = new Set();                        // decks that wouldn't open (the Elgato app)
    async function drive(hid, list) {
      const id = await DeckHID.idOf(hid, list);
      if (decks.has(id) || DeckHID.ownerOf(id) !== 'playout') return;
      let d, b = null;
      try { d = await DeckHID.open(hid, { down: i => b && handle(b, i, true), up: i => b && handle(b, i, false) }); }
      catch (_) { busyNote.add(id); renderDecks(); return; }
      busyNote.delete(id);
      b = { deck: d, page: 0, presses: new Map(), sent: [], model: () => d.model };
      decks.set(id, b); boards.add(b);
      d.brightness(parseInt(api.store.get('streamdeck_brightness'), 10) || 100);   // (the timer's backlight setting on this computer)
      if (!api.store.get(MODEL)) setScreenModel(d.model);
      changed(); renderDecks();
    }
    function letGo(id) {                               // given back to the timer (or unplugged): the timer draws it
      const b = decks.get(id);
      if (!b) return;
      decks.delete(id); boards.delete(b);
      b.deck.close();
      renderDecks();
    }
    async function look() {                            // drive every deck that's the playout's, and list them all
      if (!owner || looking) return;
      looking = true;
      try {
        const list = await DeckHID.granted();
        for (const hid of list) await drive(hid, list);
        for (const [id, b] of decks) if (DeckHID.ownerOf(id) !== 'playout' || !list.includes(b.deck.hid)) letGo(id);
      } finally { looking = false; }
      renderDecks();
    }
    async function connect() {                         // (a click: the browser's picker) the chosen deck is the playout's
      if (!navigator.hid) return;
      let hid;
      try { [hid] = await navigator.hid.requestDevice({ filters: DeckHID.filters() }); } catch (_) { return; }
      if (!hid) return;
      const list = await DeckHID.granted();
      DeckHID.setOwner(await DeckHID.idOf(hid, list), 'playout');
      look();
    }
    let listed = [], listSeq = 0;                      // [{id, name, serial, mine, on, busy}] for the list
    async function renderDecks() {
      const box = $('decklist');
      if (!box) return;
      const seq = ++listSeq, rows = [];
      const list = navigator.hid ? await DeckHID.granted() : [];
      for (const hid of list) {
        const id = await DeckHID.idOf(hid, list), b = decks.get(id);
        rows.push({ id, name: DeckHID.info(hid).name, serial: id.startsWith('sn:') ? id.slice(-4) : '', mine: DeckHID.ownerOf(id) === 'playout', on: !!b, busy: busyNote.has(id) });
      }
      if (seq !== listSeq) return;                     // (a newer one is on its way)
      listed = rows;
      box.innerHTML = !navigator.hid ? '<p class="hint">This browser has no WebHID: use Chrome or Edge for a Stream Deck. The keys below still work with the mouse.</p>'
        : !owner ? '<p class="hint">Another playout tab is using the decks: use that one (this tab takes over when it closes).</p>'
        : listed.map(x => `<div class="dk-row" data-deck="${esc(x.id)}"><span class="dk-name">${esc(x.name)}${x.serial ? ' <span class="hint">…' + esc(x.serial) + '</span>' : ''}</span>` +
          `<span class="dk-state${x.on ? ' ok' : x.busy ? ' bad' : ''}">${x.on ? 'Used here' : x.mine ? (x.busy ? 'Busy: quit the Elgato Stream Deck app' : 'Connecting…') : 'The timer’s'}</span>` +
          `<button class="small" data-dk="${x.mine ? 'timer' : 'playout'}" title="${x.mine ? 'The timer page on this computer uses it again' : 'Use it here as a soundboard (the timer page on this computer lets go of it)'}">${x.mine ? 'Give to the timer' : 'Use here'}</button></div>`).join('')
          || '<p class="hint">No Stream Deck yet. Quit the Elgato Stream Deck app, plug one in and click <b>Connect a deck…</b></p>';
    }

    // ─── Drawing: only keys whose face changed ───
    let drawing = false, again = false;
    async function draw() {
      if (drawing) { again = true; return; }
      drawing = true;
      try {
        do {
          again = false;
          for (const b of decks.values()) {
            const f = faces(b.deck.model, b.page);
            for (let i = 0; i < f.length && decks.has(b.deck.id); i++) {
              const j = JSON.stringify(f[i]);
              if (b.sent[i] === j) continue;
              b.sent[i] = j;
              const c = document.createElement('canvas'); c.width = c.height = b.deck.keySize;
              DeckFace.paint(c.getContext('2d'), f[i], b.deck.keySize);
              await b.deck.setKey(i, c);
            }
          }
        } while (again);
      } finally { drawing = false; }
    }
    function changed() { renderScreen(); draw(); }

    // ─── On the page: the same keys (a soundboard with the mouse), and Arrange keys ───
    let screenModel = api.store.get(MODEL) || 'mk2';
    if (!MODELS[screenModel]) screenModel = 'mk2';
    let arranging = false;
    const screen = { page: 0, presses: new Map(), model: () => screenModel };
    boards.add(screen);
    let views = [];                                    // [{vd, box, page}]
    let drag = null;                                   // arranging: {from: slot, el}
    function setScreenModel(m) {
      if (!MODELS[m]) return;
      screenModel = m; api.store.set(MODEL, m);
      if ($('deckmodel')) $('deckmodel').value = m;
      views = []; renderScreen();
    }
    function slotOf(view, i) {                         // an item key's slot on a view, else null
      const s = slots(screenModel), k = keyAt(screenModel, s.length, view.page, i);
      return k.kind === 'item' ? k.slot : null;
    }
    function bind(view) {
      return (c, i) => {
        c.dataset.key = i;
        c.addEventListener('pointerdown', e => {
          try { c.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
          if (arranging) { const s = slotOf(view, i); if (s != null && slots(screenModel)[s]) { drag = { from: s, el: c }; c.classList.add('down'); } return; }
          c.classList.add('down');
          handle(screen, i, true);
        });
        const up = e => {
          c.classList.remove('down');
          if (arranging) { if (drag && e.type === 'pointerup') dropAt(e.clientX, e.clientY); drag = null; markDrop(null); return; }
          handle(screen, i, false);
        };
        c.addEventListener('pointerup', up);
        c.addEventListener('pointercancel', up);
        c.addEventListener('pointermove', e => { if (drag) markDrop(targetAt(e.clientX, e.clientY)); });
      };
    }
    function targetAt(x, y) {                          // the key under the pointer, as {view, i, slot}
      const el = document.elementFromPoint(x, y), c = el && el.closest && el.closest('#vdecks canvas');
      if (!c) return null;
      const view = views.find(v => v.box.contains(c));
      const i = Number(c.dataset.key), slot = view ? slotOf(view, i) : null;
      return slot == null ? null : { c, slot };
    }
    function markDrop(t) {
      for (const c of document.querySelectorAll('#vdecks canvas.drop')) c.classList.remove('drop');
      if (t && drag && t.slot !== drag.from) t.c.classList.add('drop');
    }
    function dropAt(x, y) {
      const t = targetAt(x, y);
      if (!t || !drag || t.slot === drag.from) return;
      const s = slots(screenModel);
      while (s.length <= Math.max(t.slot, drag.from)) s.push(null);
      [s[t.slot], s[drag.from]] = [s[drag.from], s[t.slot]];
      while (s.length && !s[s.length - 1]) s.pop();
      arranged[screenModel] = s;
      api.store.set(LAYOUT, JSON.stringify(arranged));
      for (const b of decks.values()) b.sent = [];   // (a deck of that model redraws; others are unchanged anyway)
      changed();
    }
    function renderScreen() {
      const host = $('vdecks');
      if (!host) return;
      const s = slots(screenModel), g = geometry(screenModel, s.length);
      screen.page = Math.min(screen.page, g.pages - 1);
      // Arranging: every page; else the page the mouse is on
      const pages = arranging ? Array.from({ length: g.pages }, (_, p) => p) : [screen.page];
      const geo = MODELS[screenModel], W = Math.min(host.clientWidth || 560, geo.cols * 96);
      if (views.length !== pages.length || views.some((v, j) => v.page !== pages[j] || v.model !== screenModel || v.w !== W)) {
        host.innerHTML = '';
        views = pages.map(p => {
          const wrap = document.createElement('div'); wrap.className = 'vd-page';
          if (arranging && g.pages > 1) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = 'Page ' + (p + 1); wrap.appendChild(h); }
          const box = document.createElement('div'); box.className = 'vd-keys'; wrap.appendChild(box); host.appendChild(wrap);
          const view = { box, page: p, model: screenModel, w: W };
          view.vd = VirtualDeck.create(box, { bind: bind(view) });
          view.vd.setModel(screenModel);
          view.vd.layout(W, W * geo.rows / geo.cols, 0.12);
          return view;
        });
      }
      for (const v of views) {
        const f = faces(screenModel, v.page);
        f.forEach((face, i) => {
          if (arranging) face = Object.assign({}, face, { press: !!face.slot });   // (any key can take an item)
          if (JSON.stringify(face) !== JSON.stringify(v.vd.faces[i])) v.vd.setFace(i, face);
        });
      }
      host.classList.toggle('arranging', arranging);
      if ($('deckarrange')) $('deckarrange').textContent = arranging ? 'Done' : 'Arrange keys';
      if ($('deckorder')) $('deckorder').disabled = !Array.isArray(arranged[screenModel]);
    }

    // ─── Wiring ───
    if ($('deckmodel')) { $('deckmodel').value = screenModel; $('deckmodel').addEventListener('change', e => { e.target.blur(); setScreenModel(e.target.value); }); }
    if ($('deckarrange')) $('deckarrange').addEventListener('click', e => { e.currentTarget.blur(); arranging = !arranging; views = []; renderScreen(); });
    if ($('deckorder')) $('deckorder').addEventListener('click', e => {
      e.currentTarget.blur();
      if (!confirm('Put the keys back in run sheet order (for this size of deck)?')) return;
      delete arranged[screenModel]; api.store.set(LAYOUT, JSON.stringify(arranged));
      for (const b of decks.values()) b.sent = [];
      views = []; changed();
    });
    if ($('deckfade')) {
      $('deckfade').value = fadeSecs();
      $('deckfade').addEventListener('change', e => {
        const v = parseFloat(e.target.value);
        if (v >= 0.2 && v <= 10) api.store.set(FADE, String(v)); else e.target.value = fadeSecs();
      });
    }
    if ($('deckconnect')) $('deckconnect').addEventListener('click', e => { e.currentTarget.blur(); connect(); });
    if ($('decklist')) $('decklist').addEventListener('click', e => {
      const btn = e.target.closest('button[data-dk]'), row = btn && btn.closest('[data-deck]');
      if (!row) return;
      DeckHID.setOwner(row.dataset.deck, btn.dataset.dk);
      look();
    });
    window.addEventListener('pagehide', () => { for (const b of decks.values()) b.deck.reset(); });
    (function tick(ms) {                               // a worker's tick: the keys keep up in a background window
      const fn = () => changed();
      try { const w = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},' + ms + ')'], { type: 'text/javascript' }))); w.onmessage = fn; }
      catch (_) { setInterval(fn, ms); }
    })(250);

    if (navigator.hid) {
      const own = () => {
        owner = true;
        look();
        navigator.hid.addEventListener('connect', ev => { if (DeckHID.isDeck(ev.device)) look(); });
        navigator.hid.addEventListener('disconnect', ev => { for (const [id, b] of decks) if (b.deck.hid === ev.device) letGo(id); renderDecks(); });
        DeckHID.onClaims(look);
      };
      // Held until this page closes; without Web Locks every playout tab drives them
      if (navigator.locks) navigator.locks.request('playout-streamdeck', () => { own(); return new Promise(() => {}); });
      else own();
    }
    renderDecks();
    renderScreen();

    // Test hooks
    window.__playoutDeck = {
      decks: () => [...decks.values()].map(b => ({ id: b.deck.id, model: b.deck.model, page: b.page })),
      faces: (model, page) => faces(model || screenModel, page || 0).map(f => (f.rs ? f.rs.body : '') + (f.rs && f.rs.cap ? ' | ' + f.rs.cap : '')),
      slots: model => slots(model || screenModel),
      screen: (i, down) => handle(screen, i, down),
      listed: () => listed,
    };
    return { changed };
  }
  return { create };
})();
