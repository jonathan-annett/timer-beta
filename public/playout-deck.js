/*!
 * playout-deck.js
 * The playout computer's Stream Deck: a soundboard of the run sheet's items (the owner's design, 12 Nov
 * 2026; rehearsals, where the order depends on who's there). A key per item with cues, in run sheet order
 * unless arranged: with Follow the timer off, pressing one starts the item (▶ Start item: its cues timed
 * from the press). On an item that's playing (or started here), the key stops it: going down starts a fade
 * (over at most playout_deck_fade seconds, 5 unless set: even in dB, 13 Nov 2026), coming up stops it at once; so a tap stops it,
 * and holding fades it out, stopped wherever it's let go. The last key does the same for everything
 * (and the line-up tones); ◀ ▶ before it turn the page when the items don't fit (the Mini: four items, and ▶
 * top right, wrapping round to the first page). With Follow on, the keys
 * show the run sheet (the live item marked) and only stop or fade: the timer starts the items.
 *
 * Extra keys (the owner, 12 Nov 2026: media that isn't on the run sheet): files dropped on an empty key
 * on the page (several: that key and the empty ones after it; on an extra key: replaces it, asked) become
 * cues of their own (playout.js cues['~board'], listed under the deck with ▶ ■ ✂ ✕): pressed, they play;
 * playing, a tap stops and a hold fades, as an item; Follow or not. + Page adds a page of empty keys, − Page
 * removes the last one if it's empty.
 *
 * Crossfade on release (the owner, 13 Nov 2026; playout_deck_xfade = '1', over playout_deck_xfade_s seconds, 5
 * unless set): a key that starts something (an item, an extra key, cue 1) while other cues play fades all the
 * others out from the moment it's let go, so one press and release swaps one track for another cleanly.
 *
 * Item or cue 1 (the XL, the owner, 13 Nov 2026: some operators prefer it): a key just before → timer toggles
 * what the item keys do (playout_deck_xl_mode = 'cue', else items). Cue 1: an item's key stands in for its first
 * cue's ▶ / ■ (pressed, it plays; playing, a tap stops and a hold fades, as an extra key; locked as that button
 * is while its item runs from ▶ Start item), and its idle colour is a teal tint, so it's plain which way it is.
 *
 * Keys are arranged per deck model (playout_deck_layout = {mini|mk2|xl: [item id | 'cue:<id>' | null, …]},
 * slots in page order, empty pages kept; playout_demo_deck_layout in the demo): Arrange keys on the page
 * shows every page and a key dragged onto another swaps them; items and extras not in the arrangement go
 * at the end; Run sheet order forgets it. The same keys on the page work as a soundboard with the mouse
 * (down and up as on the deck).
 *
 * On a phone (the owner, 12 Nov 2026: as the timer's Show on a phone): Show on a phone… makes this page
 * host a room of its own on the pairing server (playout_phone = {room, key, on, tokens}; on until Stop
 * sharing, so a reload hosts it again) and shows a QR code of playout-phone.html#r=…&k=…[&s=…]&dm=<size>,
 * taken off the screen once a phone picks it up. The phone passes the proximity check (the number it shows,
 * typed here; one wrong try and it's out; a token after, kept in tokens: Revoke takes it back, New code
 * signs every phone out) and is a board of its own: its own page and size, the faces sent as they change
 * ({t:'deck', model, cols, rows, full, k}), and only key down / up ({t:'kd'|'ku', i}) and its size
 * ({t:'model'}) taken from it. Give to the timer is a blank key there.
 *
 * Decks (deck-hid.js): those given to the playout on this computer (deck_claims; Connect a deck… here, or
 * Use here in the list) are driven here, any number of them, each with its own page; the rest are the
 * timer's. One playout tab drives them (Web Lock playout-streamdeck).
 *
 *   PlayoutDeck.create(api) → {changed()}: api = {store, demo, items(), cuesOf(id), title(it), following(),
 *   nowId(), isDone(id), playingIds(id), anyPlaying(), localItem(), localText(), startText(it), start(id), fadeItem(id, ms) → cue ids,
 *   fadeAll(ms) → cue ids, stopIds(ids), stopAll(), board() (the extra keys' cues), isPlaying(cue id), playCue(id),
 *   fadeCue(id, ms) → ids, addFiles(files) → new cue ids, removeExtra(id), server() (the pairing server),
 *   cueLocked(item id) (its cues' ▶ ■ locked by an item run), playingAll() → every cue id playing}
 * MIT Licensed
 */
var PlayoutDeck = (function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mmss = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const COLOURS = { mark: '#5a1f44', extra: '#2e1f45', idle: '#1c2a3a', cue: '#123a3c', none: '#121212', here: '#7a5c00', play: '#13602a', fade: '#9a5200', now: '#0b3d5c', done: '#181818', all: '#3a1212', allOn: '#8a1a1a', page: '#262626' };

  function create(api) {
    const LAYOUT = api.prefix + 'deck_layout', FADE = 'playout_deck_fade', MODEL = 'playout_deck_model', XLMODE = 'playout_deck_xl_mode';
    const MODELS = DeckHID.MODELS;
    // A deck's shape: a real model's, or a custom size for the page's keys and phones ('c<cols>x<rows>': 2–20
    // across, 2–11 down; the owner, 13 Nov 2026: tablets and big screens). Its own arrangement, no → timer.
    function modelOf(m) {
      if (MODELS[m]) return MODELS[m];
      const g = window.VirtualDeck && VirtualDeck.shape(m);
      return g && g.custom ? { cols: g.cols, rows: g.rows, keyCount: g.cols * g.rows, name: g.cols + ' × ' + g.rows + ' keys', custom: true } : null;
    }
    let arranged = {};
    try { const v = JSON.parse(api.store.get(LAYOUT) || '{}'); if (v && typeof v === 'object') arranged = v; } catch (_) { /* none */ }
    const cueMode = model => model === 'xl' && api.store.get(XLMODE) === 'cue';   // (the XL's item keys play their cue 1)
    const XFADE = 'playout_deck_xfade', XFADE_S = 'playout_deck_xfade_s';
    const xfadeOn = () => api.store.get(XFADE) === '1';
    const xfadeSecs = () => { const v = parseFloat(api.store.get(XFADE_S)); return v >= 0.2 && v <= 20 ? v : 5; };
    const fadeSecs = () => { const v = parseFloat(api.store.get(FADE)); return v >= 0.2 && v <= 10 ? v : 5; };   // (5 s: the owner, 13 Nov 2026, once fades were even in dB; 2 before)

    // ─── Keys: slots (item ids in page order) and what each key is ───
    const onSheet = () => new Map(api.items().map(it => [it.id, it]));
    const extraOf = id => (typeof id === 'string' && id.startsWith('cue:') ? api.board().find(c => c.id === id.slice(4)) || null : null);
    const taken = (id, items) => !!id && (items.has(id) || !!extraOf(id));   // a key in use (else free: empty, or gone)
    function slots(model) {
      const keyed = api.items().filter(it => api.cuesOf(it.id).length).map(it => it.id).concat(api.board().map(c => 'cue:' + c.id));
      const saved = arranged[model];
      if (!Array.isArray(saved)) return keyed;
      const s = saved.map(x => (typeof x === 'string' ? x : null)), have = new Set(s);
      for (const id of keyed) if (!have.has(id)) s.push(id);   // new ones at the end
      return s;
    }
    // The Mini (the owner, 12 Nov 2026): too few keys for Give to the timer or ◀ ▶: always four items, ▶ top
    // right (the next page, back to the first after the last: tap through the run sheet) over everything.
    const MINI = { role: [null, null, 'next', null, null, 'all'], keys: [0, 1, 3, 4] };
    // Give to the timer (→ timer) goes on the key where the timer's layout for that model has Give deck to
    // playout (streamdeck.js; a layout someone has changed is in streamdeck_layout_<model>), so one key hands
    // the deck back and forth; without one, next to the last. From the end, the free keys then take everything
    // (the last), on the XL item / cue 1 just before → timer, and ◀ ▶ when the items don't fit; the rest are
    // the items' keys, in order.
    function giveKey(model) {
      try { const l = JSON.parse(api.store.get('streamdeck_layout_' + model) || 'null'), i = Array.isArray(l) ? l.indexOf('deck_to_playout') : -1; return i >= 0 && i < MODELS[model].keyCount ? i : null; }
      catch (_) { return null; }
    }
    function geometry(model, n) {
      const K = modelOf(model).keyCount, custom = modelOf(model).custom, r = giveShown() && !custom ? giveKey(model) : null;
      if (model === 'mini') return { K, paged: true, wrap: true, per: 4, pages: Math.max(1, Math.ceil(n / 4)), role: MINI.role, keys: MINI.keys };
      const build = paged => {
        const role = new Array(K).fill(null);
        const last = () => { for (let i = K - 1; i >= 0; i--) if (!role[i]) return i; return -1; };
        if (r != null) role[r] = 'give';
        role[last()] = 'all';
        if (r == null && giveShown() && !custom) role[last()] = 'give';   // (a custom size is on screen only: no deck to give)
        if (model === 'xl') { const gi = role.indexOf('give'); role[gi > 0 && !role[gi - 1] ? gi - 1 : last()] = 'mode'; }
        if (paged) { role[last()] = 'next'; role[last()] = 'prev'; }
        return { role, keys: role.map((x, i) => (x ? -1 : i)).filter(i => i >= 0) };
      };
      let g = build(false), paged = n > g.keys.length;
      if (paged) g = build(true);
      const per = Math.max(1, g.keys.length);
      return { K, paged, per, pages: Math.max(1, Math.ceil(n / per)), role: g.role, keys: g.keys };
    }
    function keyAt(model, n, page, i) {
      const g = geometry(model, n), m = markKeys(model, g);
      if (m && (i === m[0] || i === m[1])) return { kind: i === m[0] ? 'markin' : 'markout', cue: m[2] };
      return g.role[i] ? { kind: g.role[i] } : { kind: 'item', slot: page * g.per + g.keys.indexOf(i) };
    }
    // Mark start / Mark end (the owner, 13 Nov 2026): on an XL in Cue 1, while a cue plays on its own, the two keys just
    // before Item / Cue 1 (whatever they are, but never ■ All or → timer) mark its clip, as the page's buttons do
    function markKeys(model, g) {
      if (!cueMode(model) || !api.markable) return null;
      const cue = api.markable(), at = g.role.indexOf('mode');
      if (!cue || at < 0) return null;
      const free = [];
      for (let i = at - 1; i >= 0 && free.length < 2; i--) if (g.role[i] !== 'all' && g.role[i] !== 'give') free.push(i);
      return free.length === 2 ? [free[1], free[0], cue] : null;
    }

    // ─── Presses (a real deck's, or the page's keys): down, then up ───
    const boards = new Set();                          // every {model(), page, presses} that presses keys
    const fading = (id, on) => [...boards].some(b => [...b.presses.values()].some(p => p.item === id || (p.all && p.ids.length && on)));
    function handle(b, i, down) {
      const model = b.model(), s = slots(model), g = geometry(model, s.length), k = keyAt(model, s.length, Math.min(b.page, g.pages - 1), i);
      if (down) {
        if (k.kind === 'prev') b.page = Math.max(0, Math.min(b.page, g.pages - 1) - 1);
        else if (k.kind === 'next') b.page = g.wrap ? (Math.min(b.page, g.pages - 1) + 1) % g.pages : Math.min(g.pages - 1, b.page + 1);
        else if (k.kind === 'all') b.presses.set(i, { all: true, ids: api.fadeAll(fadeSecs() * 1000) });
        else if (k.kind === 'give') { if (b.deck && timerFree() && performance.now() - b.at > HANDOVER_MS) { giveBack(b.deck.id); return; } }
        else if (k.kind === 'mode') { if (cueMode(model)) api.store.del(XLMODE); else api.store.set(XLMODE, 'cue'); }
        else if (k.kind === 'markin' || k.kind === 'markout') api.mark(k.cue, k.kind === 'markin' ? 'start' : 'end');
        else {
          const id = s[k.slot], x = extraOf(id) || (cueMode(model) && onSheet().has(id) && !api.cueLocked(id) ? api.cuesOf(id)[0] : null);
          const others = xfadeOn() && api.playingAll().length > 0;   // (crossfade on release: the rest fade when it's let go)
          if (x) {                                     // an extra key (or cue 1): plays; playing, down fades and up stops
            if (api.isPlaying(x.id)) b.presses.set(i, { item: id, ids: api.fadeCue(x.id, fadeSecs() * 1000) });
            else { api.playCue(x.id); if (others) b.presses.set(i, { xfade: true, keep: x.id }); }
            return changed();
          }
          if (!id || !onSheet().has(id) || cueMode(model)) return;
          if (api.localItem() === id || api.playingIds(id).length) b.presses.set(i, { item: id, ids: api.fadeItem(id, fadeSecs() * 1000) });
          else if (!api.following() && api.cuesOf(id).length) { api.start(id); if (others) b.presses.set(i, { xfade: true, started: id }); }
        }
      } else {
        const p = b.presses.get(i);
        if (!p) return;
        b.presses.delete(i);
        if (p.xfade) crossfade(p);
        else if (p.all) api.stopAll(); else api.stopIds(p.ids);
      }
      changed();
    }

    // Let go of a key that started something: everything else playing fades out (an item run here that isn't the new
    // one ends, so its later cues don't follow)
    function crossfade(p) {
      const ms = xfadeSecs() * 1000, mine = new Set(p.keep ? [p.keep] : api.playingIds(p.started));
      const run = api.localItem();
      if (run && run !== p.started) api.fadeItem(run, ms);
      for (const id of api.playingAll()) if (!mine.has(id)) api.fadeCue(id, ms);
    }

    // ─── Faces (deck-face.js), the same on a deck and on the page ───
    function itemFace(id, items, cue1) {
      const it = items.get(id);
      if (!it) return { bg: '#000', fg: '#000', press: false, slot: true, a: 'empty' };   // nothing (or an item not on the sheet)
      if (cue1) return cueFace(id, it);
      const n = api.cuesOf(id).length, playing = api.playingIds(id).length, here = api.localItem() === id, follow = api.following();
      // Its start on top, its name, its length (the owner, 13 Nov 2026); what it's doing is its colour
      let bg = n ? COLOURS.idle : COLOURS.none;
      if (fading(id, playing > 0)) bg = COLOURS.fade;
      else if (here) bg = COLOURS.here;
      else if (playing) bg = COLOURS.play;
      else if (follow && api.nowId() === id) bg = COLOURS.now;
      else if (follow && api.isDone(id)) bg = COLOURS.done;
      return { bg, fg: n ? '#fff' : '#777', rs: { cap: api.startText(it), body: api.title(it) || '(no name)', foot: n ? (it.d ? mmss(it.d) : '') : 'no cues' },
        press: here || playing > 0 || (!follow && n > 0), slot: true, a: 'empty' };   // (a: never drawn "off" on the page: its colour says it)
    }
    // An item key in cue 1 mode (the XL): its start and name as ever, its first cue's length at the bottom; teal
    // while it isn't playing (the live item still blue with Follow on), green playing, orange fading
    function cueFace(id, it) {
      const c = api.cuesOf(id)[0], on = !!c && api.isPlaying(c.id), locked = api.cueLocked(id), len = c ? StingClip.length(c, c.duration) : 0;
      let bg = COLOURS.cue;
      if (c && fading(id, on)) bg = COLOURS.fade;
      else if (on) bg = COLOURS.play;
      else if (api.following() && api.nowId() === id) bg = COLOURS.now;
      return { bg, fg: locked ? '#8aa' : '#fff', rs: { cap: api.startText(it), body: api.title(it) || '(no name)', foot: c ? (len ? mmss(Math.max(1, len)) : '') + (api.cuesOf(id).length > 1 ? ' · cue 1' : '') : 'no cues' },
        press: !!c && !locked, slot: true, a: 'empty' };
    }
    // An extra key: what it is (or what it's doing) on top, its length at the bottom, where an item's is
    function extraFace(id, c) {
      const on = api.isPlaying(c.id), len = StingClip.length(c, c.duration);
      let bg = COLOURS.extra, cap = c.media === 'video' ? 'video' : 'extra';
      if (fading(id, on)) { bg = COLOURS.fade; cap = 'fading'; }
      else if (on) { bg = COLOURS.play; cap = 'playing'; }
      return { bg, fg: '#fff', rs: { cap, body: c.name || '(no name)', foot: len ? mmss(Math.max(1, len)) : '' }, press: true, slot: true, a: 'empty' };
    }
    function faces(model, page) {
      const s = slots(model), g = geometry(model, s.length), items = onSheet();
      page = Math.min(page, g.pages - 1);
      const busy = api.anyPlaying();
      return Array.from({ length: g.K }, (_, i) => {
        const k = keyAt(model, s.length, page, i);
        if (k.kind === 'all') return { bg: busy ? COLOURS.allOn : COLOURS.all, fg: '#fff', rs: { cap: 'tap: stop', body: '■ All', foot: 'hold: fade' }, press: true };
        if (k.kind === 'prev') return { bg: COLOURS.page, fg: '#fff', rs: { cap: 'page', body: '◀', foot: (page + 1) + ' / ' + g.pages }, press: page > 0 };
        if (k.kind === 'next') return { bg: COLOURS.page, fg: '#fff', rs: { cap: 'page', body: '▶', foot: (page + 1) + ' / ' + g.pages }, press: g.wrap ? g.pages > 1 : page < g.pages - 1 };
        if (k.kind === 'give') { const ok = timerFree(); return { bg: ok ? '#2a2200' : '#0d0d0d', fg: ok ? '#ffcc33' : '#444', rs: { cap: 'deck', body: '→ timer', foot: ok ? '' : timer.open ? 'it has one' : 'no timer page' }, press: false, a: 'empty', give: true }; }   // (on a deck only: not the page's keys)
        if (k.kind === 'markin' || k.kind === 'markout') return { bg: COLOURS.mark, fg: '#fff', rs: { cap: 'mark', body: k.kind === 'markin' ? 'Start' : 'End', foot: api.cueName(k.cue) }, press: true };
        if (k.kind === 'mode') { const cm = cueMode(model); return { bg: cm ? COLOURS.cue : COLOURS.page, fg: '#fff', rs: { cap: 'keys play', body: cm ? 'Cue 1' : 'Item', foot: cm ? 'tap: items' : 'tap: cue 1' }, press: true }; }
        const x = extraOf(s[k.slot]);
        return x ? extraFace(s[k.slot], x) : itemFace(s[k.slot], items, cueMode(model));
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
      b = { deck: d, page: 0, presses: new Map(), sent: [], model: () => d.model, at: performance.now() };
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
    // Give to the timer (the key, or the list): Elgato's screen first (a timer page with a deck already
    // leaves it there, rather than showing stale keys), then the timer's. The key only while a timer page is
    // open here (it holds timer-streamdeck) with no deck (deck_timer); not within HANDOVER_MS of taking it
    // (a key held through the hand-over mustn't hand it straight back).
    const HANDOVER_MS = 1500;
    const timer = { open: false };
    const timerFree = () => timer.open && !api.store.get('deck_timer');
    // A soundboard (the owner, 13 Nov 2026): → timer only while a timer page here has no deck (its key goes to the items otherwise)
    function giveShown() { return !api.soundboard || timerFree(); }
    // Disconnect (the owner, 13 Nov 2026): set aside, Elgato's screen; neither page drives it until Use here (or the
    // timer's Connect). Forget: the site's permission revoked (WebHID's forget()), for the timer page too
    function setAside(id) {
      const b = decks.get(id);
      if (b) b.deck.reset();
      DeckHID.setOwner(id, 'none');
      letGo(id);
    }
    async function forget(id) {
      if (!confirm('Forget this Stream Deck? This browser won’t use it (here or on the timer page) until it’s connected again with Connect a deck…')) return;
      const list = await DeckHID.granted();
      let hid = null;
      for (const h of list) if (await DeckHID.idOf(h, list) === id) hid = h;
      const b = decks.get(id);
      if (b) { b.deck.reset(); letGo(id); }
      DeckHID.setOwner(id, 'timer');                   // (no claim left behind)
      if (hid && typeof hid.forget === 'function') { try { await hid.forget(); } catch (err) { console.warn('Playout: forget failed', err); } }
      renderDecks();
    }
    function giveBack(id) {
      const b = decks.get(id);
      if (b) b.deck.reset();
      DeckHID.setOwner(id, 'timer');
      letGo(id);
    }
    function watchTimer() {
      if (!navigator.locks || !navigator.locks.query) return;
      navigator.locks.query().then(q => {
        const open = (q.held || []).some(l => l.name === 'timer-streamdeck');
        if (open !== timer.open) { timer.open = open; if (api.soundboard) renderDecks(); }   // (a soundboard lists Give to the timer only then)
      }).catch(() => {});
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
        const who = DeckHID.ownerOf(id);
        rows.push({ id, name: DeckHID.info(hid).name, serial: id.startsWith('sn:') ? id.slice(-4) : '', mine: who === 'playout', off: who === 'none', on: !!b, busy: busyNote.has(id) });
      }
      if (seq !== listSeq) return;                     // (a newer one is on its way)
      listed = rows;
      box.innerHTML = !navigator.hid ? '<p class="hint">This browser has no WebHID: use Chrome or Edge for a Stream Deck. The keys below still work with the mouse.</p>'
        : !owner ? '<p class="hint">Another playout tab is using the decks: use that one (this tab takes over when it closes).</p>'
        : listed.map(x => `<div class="dk-row" data-deck="${esc(x.id)}"><span class="dk-name">${esc(x.name)}${x.serial ? ' <span class="hint">…' + esc(x.serial) + '</span>' : ''}</span>` +
          `<span class="dk-state${x.on ? ' ok' : x.busy ? ' bad' : ''}">${x.on ? 'Used here' : x.mine ? (x.busy ? 'Busy: quit the Elgato Stream Deck app' : 'Connecting…') : x.off ? 'Disconnected' : api.soundboard ? 'Not used here' : 'The timer’s'}</span>` +
          (x.mine && api.soundboard && !timer.open ? '' :   // (a soundboard: no timer talk unless a timer page is open here)
          `<button class="small" data-dk="${x.mine ? 'timer' : 'playout'}" title="${x.mine ? 'The timer page on this computer uses it again' : api.soundboard ? 'Use it here' : 'Use it here as a soundboard (the timer page on this computer lets go of it)'}">${x.mine ? 'Give to the timer' : 'Use here'}</button>`) +
          (x.mine ? '<button class="small" data-dk="off" title="Stop using it: Elgato’s own screen, and nothing here (or on a timer page) uses it until Use here">Disconnect</button>' : '') +
          '<button class="small" data-dk="forget" title="This browser forgets it: neither this page nor the timer page can use it until it’s connected again with Connect a deck…">Forget</button>' + '</div>').join('')
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
      for (const p of phones.values()) if (p.ok) sendFaces(p);
    }
    function changed() { renderScreen(); draw(); }

    // ─── On the page: the same keys (a soundboard with the mouse), and Arrange keys ───
    let screenModel = api.store.get(MODEL) || 'mk2';
    if (!modelOf(screenModel)) screenModel = 'mk2';
    let arranging = false;
    const screen = { page: 0, presses: new Map(), model: () => screenModel };
    boards.add(screen);
    let views = [];                                    // [{vd, box, page}]
    let drag = null;                                   // arranging: {from: slot, el}
    function setScreenModel(m) {
      if (!modelOf(m)) return;
      screenModel = m; api.store.set(MODEL, m);
      if ($('deckmodel')) { customOption(m); $('deckmodel').value = m; }
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
        // Files from the computer: a free key or an extra one takes them; an item's (or a control) doesn't
        const can = () => { const s = slotOf(view, i); if (s == null) return false; const id = slots(screenModel)[s]; return !onSheet().has(id); };
        c.addEventListener('dragover', e => {
          if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
          e.preventDefault();
          const ok = can();
          e.dataTransfer.dropEffect = ok ? 'copy' : 'none';
          c.classList.toggle('drop', ok); c.classList.toggle('nodrop', !ok);
        });
        c.addEventListener('dragleave', () => c.classList.remove('drop', 'nodrop'));
        c.addEventListener('drop', e => {
          e.preventDefault(); e.stopPropagation();
          c.classList.remove('drop', 'nodrop');
          if (can() && e.dataTransfer.files.length) dropFiles(slotOf(view, i), e.dataTransfer.files);
        });
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
      keep(s);
      for (const b of decks.values()) b.sent = [];   // (a deck of that model redraws; others are unchanged anyway)
      changed();
    }
    function keep(s) {                                 // this size's arrangement (pages included, empty ones too)
      arranged[screenModel] = s;
      api.store.set(LAYOUT, JSON.stringify(arranged));
      for (const b of decks.values()) b.sent = [];
      changed();
    }
    // Files dropped on a key: on a free key (or an extra one, replaced if they say so), then the free keys after it
    const isMedia = f => /^(audio|video)\//.test(f.type) || /\.(aif|aiff|aifc|wav|mp3|m4a|aac|ogg|oga|opus|flac|mp4|m4v|mov|webm)$/i.test(f.name);
    async function dropFiles(slot, files) {
      const list = [...files].filter(isMedia).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      if (!list.length) { alert('Drop audio or video files on a key.'); return; }
      const s = slots(screenModel), items = onSheet(), old = extraOf(s[slot]);
      if (items.has(s[slot])) return;                  // (an item's key: not taken)
      if (old && !confirm('Replace “' + old.name + '” on this key with “' + list[0].name + '”?')) return;
      const ids = await api.addFiles(list);
      if (!ids.length) return;
      if (old) api.removeExtra(old.id);
      let at = slot;
      ids.forEach((id, n) => {
        if (n) { at++; while (at < s.length && taken(s[at], items)) at++; }
        while (s.length <= at) s.push(null);
        s[at] = 'cue:' + id;
      });
      keep(s);
    }
    function addPage() {                               // a page of empty keys at the end
      const s = slots(screenModel), per = geometry(screenModel, Infinity).per;   // (keys a page once there are pages)
      const want = (Math.max(1, Math.ceil(s.length / per)) + 1) * per;
      while (s.length < want) s.push(null);
      keep(s);
    }
    function removePage() {                            // the last page, if nothing's on it
      const s = slots(screenModel), g = geometry(screenModel, s.length), items = onSheet();
      if (g.pages < 2) return;
      const from = (g.pages - 1) * g.per;
      if (s.slice(from).some(id => taken(id, items))) { alert('The last page isn’t empty: move its keys (Arrange keys) or remove them first.'); return; }
      s.length = from;
      keep(s);
    }
    function renderScreen() {
      const host = $('vdecks');
      if (!host) return;
      const s = slots(screenModel), g = geometry(screenModel, s.length);
      screen.page = Math.min(screen.page, g.pages - 1);
      // Arranging: every page; else the page the mouse is on
      const pages = arranging ? Array.from({ length: g.pages }, (_, p) => p) : [screen.page];
      // On the page: as wide as the box (96 px a key at most); full screen (the Chromebook, a tablet): the whole screen
      const geo = modelOf(screenModel), full = document.fullscreenElement === host;
      const W = full ? host.clientWidth : Math.min(host.clientWidth || 560, geo.cols * 96), H = full ? host.clientHeight : W * geo.rows / geo.cols;
      if (views.length !== pages.length || views.some((v, j) => v.page !== pages[j] || v.model !== screenModel || v.w !== W || v.h !== H)) {
        host.innerHTML = '';
        views = pages.map(p => {
          const wrap = document.createElement('div'); wrap.className = 'vd-page';
          if (arranging && g.pages > 1) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = 'Page ' + (p + 1); wrap.appendChild(h); }
          const box = document.createElement('div'); box.className = 'vd-keys'; wrap.appendChild(box); host.appendChild(wrap);
          const view = { box, page: p, model: screenModel, w: W, h: H };
          view.vd = VirtualDeck.create(box, { bind: bind(view) });
          view.vd.setModel(screenModel);
          view.vd.layout(W, H, 0.12);
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

    // ─── On a phone (playout-phone.html) ───
    const SHARE = api.prefix + 'phone';               // (playout_phone, playout_demo_phone, playout_board_phone)
    const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', KEYABC = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789';
    const randStr = (n, abc) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => abc[b % abc.length]).join('');
    let share = null;                                  // {room, key, on, tokens: [{t, name}]}
    try { const v = JSON.parse(api.store.get(SHARE) || 'null'); if (v && typeof v.room === 'string' && typeof v.key === 'string') share = v; } catch (_) { /* none */ }
    const saveShare = () => api.store.set(SHARE, JSON.stringify(share));
    const tokens = () => (share && Array.isArray(share.tokens) ? share.tokens : []);
    function newShare() { share = { room: randStr(10, ABC), key: randStr(24, KEYABC), on: true, tokens: [] }; saveShare(); }
    const phones = new Map();                          // server id → {id, peer, ok, pin, name, token, model, b, sent}
    let hws = null, hretry = 1000, htimer = 0, qrOn = false;
    const sendServer = o => { if (hws && hws.readyState === WebSocket.OPEN) hws.send(JSON.stringify(o)); };
    function host() {
      clearTimeout(htimer);
      if (!share || !share.on || hws) return;
      let ws;
      try { ws = new WebSocket(RemotePeer.socketUrl(api.server(), { room: share.room })); RemotePeer.keepAlive(ws); } catch (_) { return; }
      hws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'host', room: share.room, key: share.key }));
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
        if (m.type === 'hosted') { hretry = 1000; renderPhones(); }
        else if (m.type === 'peer-join') addPhone(m.id);
        else if (m.type === 'peer-leave') dropPhone(m.id);
        else if (m.type === 'from') { const p = phones.get(m.id); if (p) p.peer.receive(m.msg); }
        else if (m.type === 'error' && m.reason === 'room-taken') { const t = share.tokens; newShare(); share.tokens = t; saveShare(); }
      };
      ws.onclose = () => {
        if (hws !== ws) return;
        hws = null;
        for (const id of [...phones.keys()]) dropPhone(id);
        if (share && share.on) { htimer = setTimeout(host, hretry); hretry = Math.min(hretry * 2, 15000); }
        renderPhones();
      };
      ws.onerror = () => {};
    }
    function unhost() { clearTimeout(htimer); const ws = hws; hws = null; for (const id of [...phones.keys()]) dropPhone(id); if (ws) ws.close(); }
    function addPhone(id) {
      dropPhone(id);
      const p = { id, ok: false, pin: null, name: '', token: null, model: screenModel, b: null, sent: [] };
      p.peer = RemotePeer.create({ initiator: true, relay: msg => sendServer({ type: 'to', id, msg }), onMessage: m => fromPhone(p, m) });
      phones.set(id, p);
      qrOn = false;                                    // picked up: the code off the screen
      renderPhones();
    }
    function dropPhone(id) {
      const p = phones.get(id);
      if (!p) return;
      phones.delete(id);
      if (p.b) { for (const i of [...p.b.presses.keys()]) handle(p.b, i, false); boards.delete(p.b); }   // (a key held as it went: let go)
      p.peer.close();
      renderPhones();
    }
    function fromPhone(p, m) {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') {
        if (modelOf(m.model)) p.model = m.model;
        if (p.ok) { p.sent = []; return draw(); }
        const known = typeof m.token === 'string' && tokens().find(x => x.t === m.token);
        if (known) return letIn(p, known);
        p.peer.send({ t: 'pin-required' });
      } else if (m.t === 'pin' && !p.ok) {
        if (/^\d{3,4}$/.test(String(m.code))) { p.pin = String(m.code); p.name = String(m.name || 'A phone').slice(0, 60); renderPhones(true); }
      } else if (p.ok && m.t === 'relink' && p.peer.mode === 'server' && !(p.relinked > Date.now() - 5000)) {
        p.relinked = Date.now(); p.peer.restart();     // (its network changed: another go at a direct link)
      } else if (p.ok && m.t === 'model' && modelOf(m.model)) {
        p.model = m.model; p.sent = []; changed();
      } else if (p.ok && (m.t === 'kd' || m.t === 'ku') && Number.isInteger(m.i) && m.i >= 0 && m.i < modelOf(p.model).keyCount) {
        handle(p.b, m.i, m.t === 'kd');
      }
    }
    function approve(id, code) {
      const p = phones.get(id);
      if (!p || !p.pin || p.ok) return;
      if (String(code).trim() !== p.pin) return refuse(id);
      const tok = { t: randStr(24, KEYABC), name: p.name };
      share.tokens = tokens().concat(tok).slice(-16); saveShare();
      p.peer.send({ t: 'pin-ok', token: tok.t });
      letIn(p, tok);
    }
    function refuse(id) {                              // one wrong number (or Refuse): out
      const p = phones.get(id);
      if (!p) return;
      p.peer.send({ t: 'pin-rejected' });
      setTimeout(() => sendServer({ type: 'kick', id }), 400);
      dropPhone(id);
    }
    function revoke(t) {
      share.tokens = tokens().filter(x => x.t !== t); saveShare();
      for (const p of [...phones.values()]) if (p.token === t) { p.peer.send({ t: 'revoked' }); setTimeout(() => sendServer({ type: 'kick', id: p.id }), 400); dropPhone(p.id); }
      renderPhones();
    }
    function letIn(p, tok) {
      p.ok = true; p.token = tok.t; p.name = tok.name || p.name; p.pin = null;
      p.b = { page: 0, presses: new Map(), model: () => p.model };
      boards.add(p.b); p.sent = [];
      changed(); renderPhones();
    }
    function sendFaces(p) {                            // the faces that changed, 8 a message (the server's 16 KB limit)
      const m = modelOf(p.model), full = !p.sent.length, k = {};
      const f = faces(p.model, p.b.page).map(x => (x.give ? { bg: '#000', fg: '#000', press: false, a: 'empty' } : x));   // (a phone has no deck to give)
      if (full) p.sent = [];
      f.forEach((face, i) => { const j = JSON.stringify(face); if (p.sent[i] !== j) { p.sent[i] = j; k[i] = face; } });
      const keys = Object.keys(k);
      if (!keys.length) return;
      for (let n = 0; n < keys.length; n += 8) {
        const part = {}; keys.slice(n, n + 8).forEach(i => { part[i] = k[i]; });
        p.peer.send({ t: 'deck', model: p.model, cols: m.cols, rows: m.rows, full: full && n === 0, k: part });
      }
    }
    function phoneLink() {
      const u = new URL('playout-phone.html', location.href), srv = api.server();
      return u.origin + u.pathname + '#r=' + share.room + '&k=' + share.key + (srv && srv !== RemotePeer.defaultServer() ? '&s=' + encodeURIComponent(srv) : '') + '&dm=' + screenModel;
    }
    let qrDrawn = '';
    function renderPhones(focusPin) {
      const box = $('phonebox');
      if (!box) return;
      box.hidden = !(share && share.on);
      $('phoneshow').textContent = share && share.on ? 'On a phone ✓' : 'Show on a phone…';
      if (box.hidden) return;
      const want = qrOn ? phoneLink() : '';
      if (want !== qrDrawn) {
        qrDrawn = want;
        const q = $('ph-qr');
        q.innerHTML = ''; q.hidden = !want; q.title = want;
        if (want) {
          const go = () => { if (qrDrawn !== want) return; try { new QRCode(q, { text: want, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M }); } catch (_) { q.textContent = want; } };
          if (window.QRCode) go(); else { const sc = document.createElement('script'); sc.src = 'qrcode.min.js'; sc.onload = go; sc.onerror = () => { q.textContent = want; }; document.head.appendChild(sc); }
        }
      }
      $('ph-note').textContent = !hws ? 'Connecting to the pairing server…'
        : qrOn ? 'Scan this with the phone’s camera: these keys open on it, as a ' + modelOf(screenModel).name + ' (the phone can change that). The code goes once a phone picks it up.'
        : 'Sharing these keys with phones.';
      const waiting = [...phones.values()].filter(p => !p.ok);
      const sig = waiting.map(p => p.id + ':' + (p.pin || '')).join(',');
      const pend = $('ph-pending');
      if (pend.dataset.sig !== sig) {                  // (rebuilt only when it changes: not under someone typing)
        pend.dataset.sig = sig;
        pend.innerHTML = waiting.map(p => `<div class="ph-row" data-ph="${esc(p.id)}">${p.pin ? `<span><b>${esc(p.name)}</b> wants to use these keys: type the number it shows</span><input class="ph-pin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="###" aria-label="Its number">` : '<span>A phone is connecting…</span>'}<button class="small" data-ph-act="refuse">Refuse</button></div>`).join('');
        if (focusPin) { const i = pend.querySelector('.ph-pin'); if (i) i.focus(); }
      }
      const on = [...phones.values()].filter(p => p.ok);
      $('ph-list').innerHTML = on.map(p => `<div class="ph-row"><span class="ok">Connected: ${esc(p.name)}</span><button class="small" data-ph-act="revoke" data-t="${esc(p.token)}" title="Disconnect it, and it needs its number typed again">Revoke</button></div>`).join('')
        + (tokens().filter(t => !on.some(p => p.token === t.t)).length ? `<p class="hint">Let in before, not connected: ${tokens().filter(t => !on.some(p => p.token === t.t)).map(t => esc(t.name)).join(', ')}</p>` : '');
      $('ph-again').hidden = qrOn;
    }

    // ─── Wiring ───
    // On screen: the three decks, a custom size (Custom size…: across × down, kept as its own choice in the menu)
    function customOption(m) {
      const sel = $('deckmodel'), g = modelOf(m);
      if (!sel || !g || !g.custom || [...sel.options].some(o => o.value === m)) return;
      const o = document.createElement('option'); o.value = m; o.textContent = 'Custom: ' + g.cols + ' × ' + g.rows;
      sel.insertBefore(o, sel.querySelector('option[value=custom]'));
    }
    if ($('deckmodel')) {
      customOption(screenModel);
      $('deckmodel').value = screenModel;
      $('deckmodel').addEventListener('change', e => {
        e.target.blur();
        if (e.target.value !== 'custom') return setScreenModel(e.target.value);
        const g = modelOf(screenModel), ask = prompt('Keys across × down (2 × 2 to 20 × 11):', g && g.custom ? g.cols + ' × ' + g.rows : '8 × 6');
        const x = /^\s*(\d{1,2})\s*[x×*,]\s*(\d{1,2})\s*$/i.exec(ask || ''), m = x && 'c' + Number(x[1]) + 'x' + Number(x[2]);
        if (m && modelOf(m)) setScreenModel(m);
        else { if (ask) alert('That isn’t a size I can make: from 2 × 2 up to 20 across and 11 down.'); e.target.value = screenModel; }
      });
    }
    // Full screen: the keys alone (a tablet or a touch screen as the soundboard); ◀ ▶ still turn the page
    if ($('deckfull')) {
      $('deckfull').hidden = !document.fullscreenEnabled;
      $('deckfull').addEventListener('click', e => { e.currentTarget.blur(); arranging = false; $('vdecks').requestFullscreen().catch(() => {}); });
      document.addEventListener('fullscreenchange', () => { views = []; renderScreen(); });
      window.addEventListener('resize', () => { if (document.fullscreenElement === $('vdecks')) { views = []; renderScreen(); } });
    }
    if ($('deckarrange')) $('deckarrange').addEventListener('click', e => { e.currentTarget.blur(); arranging = !arranging; views = []; renderScreen(); });
    if ($('phoneshow')) $('phoneshow').addEventListener('click', e => {
      e.currentTarget.blur();
      if (!share) newShare(); else if (!share.on) { share.on = true; saveShare(); }
      qrOn = true; host(); renderPhones();
    });
    if ($('phonebox')) {
      $('phonebox').addEventListener('input', e => {
        const i = e.target.closest('.ph-pin'), row = i && i.closest('[data-ph]');
        if (!row) return;
        i.value = i.value.replace(/\D/g, '');
        const p = phones.get(row.dataset.ph);
        if (p && p.pin && i.value.length === p.pin.length) approve(p.id, i.value);
      });
      $('phonebox').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        b.blur();
        const row = b.closest('[data-ph]');
        if (b.dataset.phAct === 'refuse' && row) refuse(row.dataset.ph);
        else if (b.dataset.phAct === 'revoke') revoke(b.dataset.t);
        else if (b.id === 'ph-again') { qrOn = true; renderPhones(); }
        else if (b.id === 'ph-new') { if (!confirm('A new code: every phone using these keys is signed out, and the code shown before stops working.')) return; unhost(); newShare(); qrOn = true; host(); renderPhones(); }
        else if (b.id === 'ph-stop') { share.on = false; saveShare(); qrOn = false; unhost(); renderPhones(); }
      });
    }
    if (share && share.on) host();                     // (sharing before this reload: phones come back)
    if ($('deckaddpage')) $('deckaddpage').addEventListener('click', e => { e.currentTarget.blur(); addPage(); });
    if ($('deckdelpage')) $('deckdelpage').addEventListener('click', e => { e.currentTarget.blur(); removePage(); });
    // A file dropped anywhere else on the page would open in the tab (and the page would be gone)
    document.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files') && !e.defaultPrevented) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
    document.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length && !e.defaultPrevented) e.preventDefault(); });
    if ($('deckorder')) $('deckorder').addEventListener('click', e => {
      e.currentTarget.blur();
      if (!confirm('Put the keys back in run sheet order (for this size of deck)? Extra keys go after the items, and empty pages go.')) return;
      delete arranged[screenModel]; api.store.set(LAYOUT, JSON.stringify(arranged));
      for (const b of decks.values()) b.sent = [];
      views = []; changed();
    });
    if ($('deckxfade')) {                              // Crossfade on release, and over how long
      $('deckxfade').checked = xfadeOn(); $('deckxfades').value = xfadeSecs();
      $('deckxfade').addEventListener('change', e => { e.target.blur(); if (e.target.checked) api.store.set(XFADE, '1'); else api.store.del(XFADE); });
      $('deckxfades').addEventListener('change', e => {
        const v = parseFloat(e.target.value);
        if (v >= 0.2 && v <= 20) api.store.set(XFADE_S, String(v)); else e.target.value = xfadeSecs();
      });
    }
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
      const dk = btn.dataset.dk, id = row.dataset.deck;
      if (dk === 'forget') return forget(id);
      if (dk === 'timer') giveBack(id); else if (dk === 'off') setAside(id); else DeckHID.setOwner(id, 'playout');
      look();
    });
    window.addEventListener('pagehide', () => { for (const b of decks.values()) b.deck.reset(); });
    (function tick(ms) {                               // a worker's tick: the keys keep up in a background window
      let n = 0;
      const fn = () => { if (n++ % 4 === 0) watchTimer(); changed(); };
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
      bgs: (model, page) => faces(model || screenModel, page || 0).map(f => f.bg),
      face: (model, page, i) => faces(model, page)[i],
      screenPage: () => screen.page,
      slots: model => slots(model || screenModel),
      screen: (i, down) => handle(screen, i, down),
      listed: () => listed,
      phoneLink: () => share && phoneLink(),
      phones: () => [...phones.values()].map(p => ({ id: p.id, ok: p.ok, pin: p.pin, name: p.name, model: p.model, page: p.b && p.b.page })),
    };
    // The arrangement read again (a soundboard loaded from a file, or cleared, wrote it)
    function reloadLayout() {
      arranged = {};
      try { const v = JSON.parse(api.store.get(LAYOUT) || '{}'); if (v && typeof v === 'object') arranged = v; } catch (_) { /* none */ }
      changed();
    }
    return { changed, reloadLayout };
  }
  return { create };
})();
