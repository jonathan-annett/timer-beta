import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# The playout computer's Stream Deck soundboard (playout-deck.js, deck-hid.js), on the demo (Follow off):
# a key per item with cues; a press starts the item; on a playing item a tap stops it and a hold fades it
# (over playout_deck_fade s, stopped wherever it's let go); the last key does it for everything; ◀ ▶ page
# when the items don't fit (the Mini on the page). Keys arranged by dragging on the page (per deck model).
# Give to the timer on a deck (next to the last key, or where the timer's layout has Give deck to playout)
# and the timer's Give deck to playout hand a deck back and forth with one key, only while the other page
# is open here, and not straight back (a key held through the hand-over).
# Decks given to the playout on this computer (deck_claims) are driven there, the rest are the timer's:
# the timer page lets go of a deck the moment the playout page takes it, and takes it back when given.
# Fake WebHID decks (an MK.2 and an XL, each with a serial number in its feature report) stand in for the
# hardware; each page gets its own fakes.
import json, mimetypes, os, sys
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
FAKE_HID = """(() => {
  const mk = (pid, serial, keys, name) => {
    const ls = {};
    // As WebHID does: opening takes a moment, and a second open (or one under way) is refused; a closed
    // deck takes no reports and sends no key presses
    const wait = ms => new Promise(r => setTimeout(r, ms)), shut = () => new DOMException('The device must be opened first.', 'InvalidStateError');
    const d = { vendorId: 0x0fd9, productId: pid, productName: name, opened: false, opening: false, images: {}, features: [],
      async open() { if (this.opened || this.opening) throw new DOMException('The device is already open.', 'InvalidStateError'); this.opening = true; await wait(40); this.opening = false; this.opened = true; },
      async close() { await wait(10); this.opened = false; },
      async sendReport(id, data) { if (!this.opened) throw shut(); if (data[0] === 0x07 && data[2] === 1) this.images[data[1]] = (this.images[data[1]] || 0) + 1; },
      async sendFeatureReport(id, b) { if (!this.opened) throw shut(); this.features.push([id, b[0]]); },
      async receiveFeatureReport(id) { if (!this.opened) throw shut(); await wait(5); const b = new Uint8Array(32); b[0] = id; b[1] = serial.length; for (let i = 0; i < serial.length; i++) b[2 + i] = serial.charCodeAt(i); return new DataView(b.buffer); },
      addEventListener(t, fn) { ls[t] = fn; }, removeEventListener(t) { delete ls[t]; },
      async forget() { granted = granted.filter(x => x !== this); this.opened = false; } };
    // a key down (v = 1) or up (0): a gen2 input report, key states from byte 3
    d.key = (i, v) => { if (!d.opened) return; const b = new Uint8Array(3 + keys); b[3 + i] = v; if (ls.inputreport) ls.inputreport({ reportId: 1, data: new DataView(b.buffer) }); };
    return d;
  };
  const mk2 = mk(0x0080, 'MK2SERIAL01', 15, 'Fake MK.2'), xl = mk(0x008f, 'XLSERIAL002', 32, 'Fake XL');
  let granted = [mk2, xl];                             // (forget() takes a deck off: WebHID's permission revoked)
  window.__decks = { mk2, xl };
  Object.defineProperty(navigator, 'hid', { configurable: true, value: {
    getDevices: async () => granted.slice(), requestDevice: async () => [xl], addEventListener() {}, removeEventListener() {} } });
})();"""
SETUP = """async () => {                     // seven speakers with a 10 s tone each (a start cue), files in the store (longer than a 5 s fade)
  const wav = sec => { const sr = 16000, n = sr * sec, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / sr) * 8000, true);
    return new Blob([b], { type: 'audio/wav' }); };
  const cues = {};
  for (let k = 1; k <= 7; k++) {
    cues['demo-' + k] = [{ id: 'c' + k, name: 'Tone ' + k, media: 'audio', src: 'file', trigger: 'start', at: 0, duration: 10 }];
    await videoStore.put('pocue:c' + k, wav(10));
  }
  localStorage.playout_demo_cues = JSON.stringify(cues);
  localStorage.deck_claims = JSON.stringify({ 'sn:MK2SERIAL01': 'playout' });
}"""
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        name = u[len(BASE):].split("?")[0].split("#")[0]
        if name in ("changelog.html", "stock-stings.json"): return route.fulfill(status=404, body=b"")
        fp = os.path.join(PUBLIC, name or "timer.html")
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1100, "height": 1000})
    c.add_init_script("window.TimerFeatures = { playout: true };" + FAKE_HID)
    c.route("**/*", h)
    po = c.new_page(); po.on("pageerror", lambda e: errs.append("playout: " + str(e)))
    po.goto(BASE + "playout.html?demo"); po.wait_for_timeout(800)
    po.evaluate(SETUP); po.reload(); po.wait_for_timeout(1500)
    names = [x["n"] for x in po.evaluate("window.__playout.show().items")]
    playing = lambda: po.evaluate("window.__playout.playing()")
    local = lambda: po.evaluate("window.__playout.local()")
    key = lambda i, v: po.evaluate("__decks.mk2.key(%d, %d)" % (i, v))

    # the decks: the playout's MK.2 driven here, the XL left to the timer
    check("the deck given to the playout is driven here", po.evaluate("window.__playoutDeck.decks()") == [{"id": "sn:MK2SERIAL01", "model": "mk2", "page": 0}], po.evaluate("window.__playoutDeck.decks()"))
    check("… all 15 of its keys drawn", sorted(int(k) for k in po.evaluate("Object.keys(__decks.mk2.images)")) == list(range(15)), po.evaluate("__decks.mk2.images"))
    check("the timer's XL: not used here (opened only to read its serial)", not po.evaluate("__decks.xl.opened") and po.evaluate("Object.keys(__decks.xl.images).length") == 0)
    rows = po.locator("#decklist .dk-row").all_text_contents()
    check("the list: the MK.2 used here, the XL the timer's", len(rows) == 2 and "Used here" in rows[0] and "Give to the timer" in rows[0] and "The timer’s" in rows[1] and "Use here" in rows[1], rows)
    faces = po.evaluate("window.__playoutDeck.faces('mk2')")
    check("a key per item with cues, in run sheet order", [f.split(" | ")[0] for f in faces[:7]] == names[:7] and faces[7] == "", faces)
    check("… the last key: everything (tap stops, hold fades)", faces[14] == "■ All | tap: stop", faces[14])
    check("… next to it: Give to the timer (dim: no timer page open)", faces[13] == "→ timer | deck", faces[13])

    # a press starts the item (Follow is off in the demo)
    key(0, 1); key(0, 0); po.wait_for_timeout(500)
    check("a press starts its item (▶ Start item): its cue plays", (local() or {}).get("item") == "demo-1" and playing() == ["c1"], [local(), playing()])
    check("… the key says so (amber: started here)", po.evaluate("window.__playoutDeck.bgs('mk2')[0]") == "#7a5c00", po.evaluate("window.__playoutDeck.bgs('mk2')[0]"))
    check("… its length at the bottom, no start time in the demo (no timer)", po.evaluate("window.__playoutDeck.face('mk2', 0, 0).rs") == {"cap": "", "body": names[0], "foot": "20:00"}, po.evaluate("window.__playoutDeck.face('mk2', 0, 0).rs"))
    # a tap on a playing item stops it
    key(0, 1); po.wait_for_timeout(80); key(0, 0); po.wait_for_timeout(300)
    check("a tap on it: stopped (and the item run ended)", playing() == [] and local() is None, [playing(), local()])

    # a hold fades it out (5 s unless changed), stopped wherever it's let go
    check("the fade time: 5 s unless changed", po.input_value("#deckfade") == "5" and po.evaluate("localStorage.playout_deck_fade ?? null") is None, po.input_value("#deckfade"))
    key(0, 1); key(0, 0); po.wait_for_timeout(600)
    g0 = po.evaluate("window.__playout.gain('c1')")
    key(0, 1); po.wait_for_timeout(1000)
    g1 = po.evaluate("window.__playout.gain('c1')")
    check("held: still playing after 1 s, fading", playing() == ["c1"] and g1 is not None and g1 < g0 * 0.8, [playing(), g0, g1])
    check("… the key says fading (orange)", po.evaluate("window.__playoutDeck.bgs('mk2')[0]") == "#9a5200", po.evaluate("window.__playoutDeck.bgs('mk2')[0]"))
    po.wait_for_timeout(4500)
    check("… held past the fade: gone", playing() == [], playing())
    key(0, 0); po.wait_for_timeout(200)
    check("… let go after: nothing more", playing() == [] and local() is None)
    key(1, 1); key(1, 0); po.wait_for_timeout(600)
    key(1, 1); po.wait_for_timeout(500); key(1, 0); po.wait_for_timeout(150)
    check("held half a second, then let go: stopped there", playing() == [], playing())

    # two items, then the last key
    key(0, 1); key(0, 0); po.wait_for_timeout(400); key(2, 1); key(2, 0); po.wait_for_timeout(500)
    check("another item started: both cues play (a cue plays on)", sorted(playing()) == ["c1", "c3"], playing())
    key(14, 1); po.wait_for_timeout(80); key(14, 0); po.wait_for_timeout(300)
    check("a tap on the last key: everything stops", playing() == [] and local() is None, [playing(), local()])

    # the fade time
    po.fill("#deckfade", "0.5"); po.press("#deckfade", "Tab")
    key(3, 1); key(3, 0); po.wait_for_timeout(500); key(3, 1); po.wait_for_timeout(900)
    check("fade time 0.5 s: held, gone after it", playing() == [] and po.evaluate("localStorage.playout_deck_fade") == "0.5", playing())
    key(3, 0)

    # Crossfade on release (the owner, 13 Nov 2026): a key that starts something while others play fades them as it's let go
    key(0, 1); key(0, 0); po.wait_for_timeout(500)
    key(1, 1); po.wait_for_timeout(500)
    check("off: another item started, both play", playing() == ["c1", "c2"], playing())
    key(1, 0); po.wait_for_timeout(300)
    po.click("#stopall"); po.wait_for_timeout(300)
    po.check("#deckxfade"); po.fill("#deckxfades", "1"); po.press("#deckxfades", "Tab")
    key(0, 1); key(0, 0); po.wait_for_timeout(500)
    g0 = po.evaluate("window.__playout.gain('c1')")
    key(1, 1); po.wait_for_timeout(700)
    g1 = po.evaluate("window.__playout.gain('c1')")
    check("Crossfade on release: while the new key is held, the other plays on as it was", sorted(playing()) == ["c1", "c2"] and g1 is not None and abs(g1 - g0) < 0.01, [playing(), g0, g1])
    key(1, 0); po.wait_for_timeout(500)
    g2 = po.evaluate("window.__playout.gain('c1')")
    check("… let go: the other fades from then (over 1 s)", g2 is not None and g2 < g0 * 0.5 and "c2" in playing(), [g0, g2, playing()])
    po.wait_for_timeout(900)
    check("… and is gone; the new one plays on", playing() == ["c2"] and (local() or {}).get("item") == "demo-2", [playing(), local()])
    check("… kept on this computer", po.evaluate("[localStorage.playout_deck_xfade, localStorage.playout_deck_xfade_s]") == ["1", "1"])
    key(1, 1); po.wait_for_timeout(80); key(1, 0); po.wait_for_timeout(300)
    check("a tap on the playing key still just stops it", playing() == [], playing())
    po.uncheck("#deckxfade")

    # the same keys on the page, with the mouse
    po.select_option("#deckmodel", "mk2"); po.wait_for_timeout(300)
    cv = lambda i, pg=0: po.locator("#vdecks .vd-page").nth(pg).locator("canvas").nth(i)
    bx = cv(4).bounding_box(); po.mouse.move(bx["x"] + 20, bx["y"] + 20); po.mouse.down(); po.mouse.up(); po.wait_for_timeout(500)
    check("the keys on the page: a click starts the item", (local() or {}).get("item") == "demo-5" and playing() == ["c5"], [local(), playing()])
    po.mouse.down(); po.wait_for_timeout(80); po.mouse.up(); po.wait_for_timeout(300)
    check("… a click on it again stops it", playing() == [], playing())

    # paging (the Mini on the page: 6 keys)
    po.select_option("#deckmodel", "mini"); po.wait_for_timeout(300)
    f = po.evaluate("window.__playoutDeck.faces('mini', 0)")
    check("a Mini: four items a page, ▶ top right over everything (no Give to the timer)", [x.split(" | ")[0] for x in f] == names[:2] + ["▶"] + names[2:4] + ["■ All"], f)
    bx = cv(2).bounding_box(); po.mouse.click(bx["x"] + 20, bx["y"] + 20); po.wait_for_timeout(300)
    f = po.evaluate("window.__playoutDeck.faces('mini', 1)")
    check("▶: the next page (seven items: two pages)", po.evaluate("window.__playoutDeck.screenPage()") == 1 and [x.split(" | ")[0] for x in f] == names[4:6] + ["▶"] + [names[6], "", "■ All"], f)
    po.mouse.click(bx["x"] + 20, bx["y"] + 20); po.wait_for_timeout(300)
    check("… ▶ on the last page: back to the first", po.evaluate("window.__playoutDeck.screenPage()") == 0)

    # a custom size on screen (the owner, 13 Nov 2026: tablets and big screens): across × down, up to 20 × 11
    po.once("dialog", lambda d: d.accept("8 x 6")); po.select_option("#deckmodel", "custom"); po.wait_for_timeout(400)
    f = po.evaluate("window.__playoutDeck.faces('c8x6', 0)")
    check("Custom size… 8 × 6: 48 keys, the items, ■ All last, no → timer (on screen only)", po.evaluate("localStorage.playout_deck_model") == "c8x6" and len(f) == 48 and [x.split(" | ")[0] for x in f[:7]] == names[:7] and f[47].startswith("■ All") and not any("timer" in x for x in f), [po.evaluate("localStorage.playout_deck_model"), len(f), f[-1]])
    check("… drawn: 48 keys, 8 across; its own menu entry", po.locator("#vdecks canvas").count() == 48 and po.evaluate("getComputedStyle(document.querySelector('#vdecks .vd-keys')).getPropertyValue('--cols').trim()") == "8"
          and po.evaluate("document.getElementById('deckmodel').selectedOptions[0].textContent") == "Custom: 8 × 6", po.evaluate("document.getElementById('deckmodel').selectedOptions[0].textContent"))
    said = []
    answer = lambda d: (said.append(d.message), d.accept("30 x 2") if d.type == "prompt" else d.accept())
    po.on("dialog", answer)
    po.select_option("#deckmodel", "custom"); po.wait_for_timeout(400)
    po.remove_listener("dialog", answer)
    check("… a size too big: refused, the menu back as it was", po.evaluate("localStorage.playout_deck_model") == "c8x6" and po.input_value("#deckmodel") == "c8x6", po.input_value("#deckmodel"))
    po.click("#deckfull"); po.wait_for_timeout(600)
    full = po.evaluate("document.fullscreenElement && document.fullscreenElement.id")
    if full == "vdecks":
        k = po.evaluate("document.querySelector('#vdecks canvas').getBoundingClientRect().width")
        check("⛶ Full screen: the keys, as big as the screen allows", k > 80, k)   # (8 × 6 beside the 320 px column)
        g = po.evaluate("""() => { const tr = document.getElementById('topright'), r = tr.getBoundingClientRect();
          const right = Math.max(...[...document.querySelectorAll('#vdecks canvas')].map(c => c.getBoundingClientRect().right));
          return {inside: tr.parentNode.id, shown: getComputedStyle(tr).display !== 'none', left: r.left, right, w: innerWidth}; }""")
        check("… with the level box and what's playing (#topright) in a column of their own, clear of the keys",
              g["inside"] == "vdecks" and g["shown"] and g["right"] <= g["left"] + 1 and g["left"] > g["w"] * 0.6, g)
        po.evaluate("document.exitFullscreen()"); po.wait_for_timeout(400)
        check("… back from full screen: #topright where it was, on the page", po.evaluate("document.getElementById('topright').parentNode === document.body && document.getElementById('topright').nextElementSibling === document.querySelector('body > main')"))
    else: print("(full screen not available headless: skipped)")
    po.select_option("#deckmodel", "mini"); po.wait_for_timeout(200); po.select_option("#deckmodel", "c8x6"); po.wait_for_timeout(300)
    check("… still in the menu after another size", po.evaluate("localStorage.playout_deck_model") == "c8x6" and po.locator("#vdecks canvas").count() == 48)

    # arranging (the MK.2): drag a key onto another to swap them
    po.select_option("#deckmodel", "mk2"); po.wait_for_timeout(300)
    po.click("#deckarrange"); po.wait_for_timeout(300)
    a, z = cv(0).bounding_box(), cv(2).bounding_box()
    po.mouse.move(a["x"] + 20, a["y"] + 20); po.mouse.down(); po.mouse.move(z["x"] + 20, z["y"] + 20, steps=5); po.mouse.up(); po.wait_for_timeout(400)
    check("Arrange keys: dragged onto another, they swap", po.evaluate("window.__playoutDeck.slots('mk2')")[:3] == ["demo-3", "demo-2", "demo-1"], po.evaluate("window.__playoutDeck.slots('mk2')"))
    check("… nothing played while arranging", playing() == [])
    check("… kept per deck model (the XL's still in run sheet order)", json.loads(po.evaluate("localStorage.playout_demo_deck_layout")).get("mk2", [])[:3] == ["demo-3", "demo-2", "demo-1"] and po.evaluate("window.__playoutDeck.slots('xl')")[0] == "demo-1")
    check("… the deck follows", po.evaluate("window.__playoutDeck.faces('mk2')[0]").split(" | ")[0] == names[2])
    z = cv(12).bounding_box(); a = cv(1).bounding_box()
    po.mouse.move(a["x"] + 20, a["y"] + 20); po.mouse.down(); po.mouse.move(z["x"] + 20, z["y"] + 20, steps=5); po.mouse.up(); po.wait_for_timeout(400)
    s = po.evaluate("window.__playoutDeck.slots('mk2')")
    check("… onto an empty key: moved there (a gap left)", s[1] is None and s[12] == "demo-2", s)
    po.screenshot(path=OUTDIR + "/playout_deck_arrange.png", full_page=True)
    po.click("#deckarrange"); po.wait_for_timeout(200)
    key(0, 1); key(0, 0); po.wait_for_timeout(500)
    check("the deck's first key now starts the third item", (local() or {}).get("item") == "demo-3", local())
    key(14, 1); key(14, 0); po.wait_for_timeout(200)
    po.once("dialog", lambda d: d.accept()); po.click("#deckorder"); po.wait_for_timeout(300)
    check("Run sheet order: the arrangement forgotten", po.evaluate("window.__playoutDeck.slots('mk2')")[:3] == ["demo-1", "demo-2", "demo-3"])

    # extra keys: files dropped on the page's keys (media not on the run sheet)
    DROP = """([sel, names, secs]) => {
      const wav = sec => { const sr = 16000, n = Math.round(sr * sec), b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
        const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
        w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
        for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 330 * i / sr) * 8000, true);
        return b; };
      const dt = new DataTransfer();
      names.forEach(n => dt.items.add(new File([wav(secs)], n, { type: n.endsWith('.txt') ? 'text/plain' : 'audio/wav' })));
      const c = document.querySelector(sel), ev = t => c.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
      ev('dragover'); const lit = c.className; ev('drop'); return lit;
    }"""
    vk = lambda pg, i: "#vdecks .vd-page:nth-child(%d) canvas:nth-child(%d)" % (pg + 1, i + 1)
    extras = lambda: po.evaluate("window.__playout.cues()['~board'] || []")
    po.select_option("#deckmodel", "mk2"); po.wait_for_timeout(300)
    lit = po.evaluate(DROP, [vk(0, 9), ["Applause.wav"], 4]); po.wait_for_timeout(1500)
    x = extras()
    check("a file dropped on a free key: an extra key", [c["name"] for c in x] == ["Applause"] and po.evaluate("window.__playoutDeck.slots('mk2')[9]") == "cue:" + x[0]["id"] and "drop" in lit, [x, lit])
    check("… on the deck too: 'extra' on top, its length at the bottom (where an item's is)", po.evaluate("window.__playoutDeck.face('mk2', 0, 9).rs") == {"cap": "extra", "body": "Applause", "foot": "0:04"}, po.evaluate("window.__playoutDeck.face('mk2', 0, 9).rs"))
    check("… listed under the deck (▶ ✂ ✕, its output; no when)", po.locator("#boardlist .cues li").count() == 1 and po.locator("#boardlist button[data-act=edit]").count() == 1 and po.locator("#boardlist button[data-act=when]").count() == 0 and po.locator("#boardlist select.cout").count() == 1)
    ax = x[0]["id"]
    key(9, 1); key(9, 0); po.wait_for_timeout(500)
    check("its key plays it (no item run)", playing() == [ax] and local() is None, [playing(), local()])
    key(9, 1); po.wait_for_timeout(80); key(9, 0); po.wait_for_timeout(300)
    check("… a tap on it again stops it", playing() == [], playing())
    key(9, 1); key(9, 0); po.wait_for_timeout(500); key(9, 1); po.wait_for_timeout(400)
    check("… held: fading", playing() == [ax] and po.evaluate("window.__playoutDeck.faces('mk2')[9]").endswith("fading"))
    key(9, 0); po.wait_for_timeout(200)
    check("… let go: stopped", playing() == [])
    lit = po.evaluate(DROP, [vk(0, 0), ["Nope.wav"], 1]); po.wait_for_timeout(800)
    check("dropped on an item's key: not taken", len(extras()) == 1 and "nodrop" in lit, lit)
    po.evaluate(DROP, [vk(0, 7), ["B.wav", "A.wav"], 1]); po.wait_for_timeout(2000)
    s = po.evaluate("window.__playoutDeck.slots('mk2')"); x = {c["id"]: c["name"] for c in extras()}
    check("two files on a free key: that key and the next free one, in name order", [x.get((s[k] or "")[4:]) for k in (7, 8, 9)] == ["A", "B", "Applause"], s)
    po.once("dialog", lambda d: d.accept())
    po.evaluate(DROP, [vk(0, 9), ["Cheers.wav"], 2]); po.wait_for_timeout(1500)
    s = po.evaluate("window.__playoutDeck.slots('mk2')"); x = {c["id"]: c["name"] for c in extras()}
    check("dropped on an extra key: replaced (after asking)", x.get((s[9] or "")[4:]) == "Cheers" and "Applause" not in x.values() and len(x) == 3, [s, x])
    check("… other sizes of deck: the extras after the items", [v[:4] for v in po.evaluate("window.__playoutDeck.slots('xl')")[7:]] == ["cue:"] * 3)
    # pages
    po.click("#deckaddpage"); po.wait_for_timeout(300)
    f = po.evaluate("window.__playoutDeck.faces('mk2', 1)")
    check("+ Page: a second page of free keys (◀ ▶ now)", len(po.evaluate("window.__playoutDeck.slots('mk2')")) == 22 and f[0] == "" and f[11].split(" | ")[0] == "◀" and f[12].split(" | ")[0] == "▶", f)
    po.click("#deckarrange"); po.wait_for_timeout(300)
    po.evaluate(DROP, [vk(1, 2), ["Late.wav"], 1]); po.wait_for_timeout(1500)
    check("arranging (every page): a file dropped on page 2", po.evaluate("window.__playoutDeck.faces('mk2', 1)[2]").startswith("Late"), po.evaluate("window.__playoutDeck.faces('mk2', 1)"))
    po.click("#deckarrange"); po.wait_for_timeout(200)
    po.once("dialog", lambda d: d.accept()); po.click("#deckdelpage"); po.wait_for_timeout(300)
    check("− Page with a key on it: refused", len(po.evaluate("window.__playoutDeck.slots('mk2')")) == 22)
    late = [c["id"] for c in extras() if c["name"] == "Late"][0]
    po.once("dialog", lambda d: d.accept()); po.click('#boardlist li[data-cue="%s"] button[data-act=del]' % late); po.wait_for_timeout(300)
    po.click("#deckdelpage"); po.wait_for_timeout(300)
    check("✕ in the list frees its key; − Page then removes the empty page", len(po.evaluate("window.__playoutDeck.slots('mk2')")) == 11 and late not in [c["id"] for c in extras()], po.evaluate("window.__playoutDeck.slots('mk2')"))
    check("a file dropped elsewhere on the page doesn't open in the tab", po.evaluate("""() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'x.wav', { type: 'audio/wav' }));
      const e = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }); document.querySelector('h1').dispatchEvent(e); return e.defaultPrevented; }"""))

    # the XL too: Use here
    po.click('#decklist [data-deck="sn:XLSERIAL002"] button'); po.wait_for_timeout(1200)
    check("Use here: the XL is driven here too", sorted(d["id"] for d in po.evaluate("window.__playoutDeck.decks()")) == ["sn:MK2SERIAL01", "sn:XLSERIAL002"] and po.evaluate("Object.keys(__decks.xl.images).length") == 32)
    rows = po.locator("#decklist .dk-row").all_text_contents()
    check("… the list: both used here, each once", len(rows) == 2 and all("Used here" in r for r in rows), rows)
    po.evaluate("__decks.xl.key(1, 1); __decks.xl.key(1, 0)"); po.wait_for_timeout(500)
    check("… its keys work", (local() or {}).get("item") == "demo-2", local())
    po.evaluate("__decks.xl.key(31, 1); __decks.xl.key(31, 0)"); po.wait_for_timeout(200)

    # the XL's Item / Cue 1 key (the owner, 13 Nov 2026), just before → timer: what the item keys play
    xf = lambda: po.evaluate("window.__playoutDeck.faces('xl')")
    xk = lambda i, v: po.evaluate("__decks.xl.key(%d, %d)" % (i, v))
    bg = lambda i: po.evaluate("window.__playoutDeck.bgs('xl')[%d]" % i)
    f = xf(); gi = f.index("→ timer | deck")
    check("the XL: Item / Cue 1 just before → timer (items unless changed)", gi == 30 and f[29] == "Item | keys play" and f[31].startswith("■ All"), f[26:])
    check("… not on the MK.2", not any(x.split(" | ")[0] in ("Item", "Cue 1") for x in po.evaluate("window.__playoutDeck.faces('mk2')")))
    idle = bg(2)
    xk(29, 1); xk(29, 0); po.wait_for_timeout(300)
    check("tapped: Cue 1, kept on this computer; the item keys a teal tint", xf()[29] == "Cue 1 | keys play" and po.evaluate("localStorage.playout_deck_xl_mode") == "cue" and bg(2) == "#123a3c" and idle != bg(2), [xf()[29], idle, bg(2)])
    check("… the key's foot: its first cue's length", po.evaluate("window.__playoutDeck.face('xl', 0, 2).rs.foot") == "0:10", po.evaluate("window.__playoutDeck.face('xl', 0, 2).rs"))
    xk(2, 1); xk(2, 0); po.wait_for_timeout(500)
    check("… an item's key plays its first cue, as the cue's ▶ (no item run)", playing() == ["c3"] and local() is None and bg(2) == "#13602a", [playing(), local(), bg(2)])
    xk(2, 1); po.wait_for_timeout(80); xk(2, 0); po.wait_for_timeout(150)
    check("… a tap stops it: the key flashes white (stopped)", playing() == [] and bg(2) == "#fff", [playing(), bg(2)])
    po.wait_for_timeout(400)
    check("… then teal again", bg(2) == "#123a3c", bg(2))
    xk(2, 1); xk(2, 0); po.wait_for_timeout(500); xk(2, 1); po.wait_for_timeout(250)   # (the fade time is 0.5 s by now)
    check("… a hold fades it (orange)", playing() == ["c3"] and bg(2) == "#9a5200", [playing(), bg(2)])
    xk(2, 0); po.wait_for_timeout(200)
    check("… let go: stopped there", playing() == [])
    before = xf()[26:29]
    xk(2, 1); xk(2, 0); po.wait_for_timeout(600)
    check("a cue playing from its key: Mark start and Mark end on the two keys before Item / Cue 1 (standing in for what's there)", xf()[27:30] == ["Start | mark", "End | mark", "Cue 1 | keys play"] and po.evaluate("window.__playoutDeck.face('xl', 0, 27).rs.foot") == "Tone 3", [xf()[26:30], po.evaluate("window.__playoutDeck.face('xl', 0, 27).rs")])
    po.wait_for_timeout(900); xk(28, 1); xk(28, 0)
    po.wait_for_function("document.querySelector('.sc-wrap') && document.querySelector('.sc-msg').textContent === ''", timeout=20000); po.wait_for_timeout(300)
    m, x = po.input_value(".sc-t[data-k=end]").split(":"); en = int(m) * 60 + float(x)
    check("… Mark end: the cue stops, the clip editor opens with the end where it was", playing() == [] and 1.2 < en < 2.2 and po.text_content(".sc-zlabel").startswith("Close up on the end"), [playing(), en])
    po.click(".sc-cancel"); po.wait_for_timeout(300)
    check("… and the keys are what they were", xf()[26:29] == before, [xf()[26:29], before])
    # cue 1 with the item's other cues playing: they play on, as with its ▶ (Crossfade on release or not)
    po.evaluate("""async () => { window.__playout.cues()['demo-3'].push({ id: 'c3b', name: 'Tone 3b', media: 'audio', src: 'file', trigger: 'start', at: 0, duration: 10 });
      await videoStore.put('pocue:c3b', await videoStore.get('pocue:c3')); }""")
    po.evaluate("window.__playout.play('c3b')"); po.wait_for_timeout(500)
    xk(2, 1); xk(2, 0); po.wait_for_timeout(600)
    check("cue 1 played while the item's second cue plays: both play", sorted(playing()) == ["c3", "c3b"], playing())
    xk(2, 1); po.wait_for_timeout(80); xk(2, 0); po.wait_for_timeout(300)
    check("… a tap stops cue 1 only", playing() == ["c3b"], playing())
    po.check("#deckxfade"); po.fill("#deckxfades", "1"); po.press("#deckxfades", "Tab")
    po.evaluate("window.__playout.play('c5')"); po.wait_for_timeout(500)
    xk(2, 1); xk(2, 0); po.wait_for_timeout(1800)
    check("… Crossfade on release: another item's cue fades, the item's own play on", sorted(playing()) == ["c3", "c3b"], playing())
    po.uncheck("#deckxfade"); po.click("#stopall"); po.wait_for_timeout(300)
    po.evaluate("window.__playout.cues()['demo-3'].pop()")
    po.click('#items li[data-id="demo-3"] .ihead button[data-act=run]'); po.wait_for_timeout(500)
    xk(2, 1); po.wait_for_timeout(80); xk(2, 0); po.wait_for_timeout(300)
    check("its item run from ▶ Start item: the key is locked, as the cue's ▶ ■", playing() == ["c3"] and (local() or {}).get("item") == "demo-3" and not po.evaluate("window.__playoutDeck.face('xl', 0, 2).press"), [playing(), local()])
    xk(31, 1); xk(31, 0); po.wait_for_timeout(300)
    xk(29, 1); xk(29, 0); po.wait_for_timeout(300)
    check("tapped again: Item, the tint gone", xf()[29] == "Item | keys play" and po.evaluate("localStorage.playout_deck_xl_mode ?? null") is None and bg(2) == idle, [xf()[29], bg(2)])

    # the timer page on the same computer: it leaves the playout's decks alone, and takes one when given it
    po.screenshot(path=OUTDIR + "/playout_deck.png", full_page=True)
    t = c.new_page(); t.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    t.goto(BASE + "timer.html"); t.wait_for_timeout(2000)
    check("the timer page: both decks are the playout's, it opens neither", not t.evaluate("__decks.mk2.opened") and not t.evaluate("__decks.xl.opened") and "playout page" in t.text_content("#deck-status"), t.text_content("#deck-status"))
    po.click('#decklist [data-deck="sn:MK2SERIAL01"] button'); po.wait_for_timeout(1500)
    check("Give to the timer: the playout page lets go of it", [d["id"] for d in po.evaluate("window.__playoutDeck.decks()")] == ["sn:XLSERIAL002"] and not po.evaluate("__decks.mk2.opened"))
    check("… and the timer page takes it", t.evaluate("__decks.mk2.opened") and "Connected" in t.text_content("#deck-status"), t.text_content("#deck-status"))
    po.click('#decklist [data-deck="sn:MK2SERIAL01"] button'); po.wait_for_timeout(1500)
    check("Use here again: the timer page lets go of it", not t.evaluate("__decks.mk2.opened") and "playout page" in t.text_content("#deck-status"), t.text_content("#deck-status"))
    check("… and the playout page drives it", po.evaluate("__decks.mk2.opened") and len(po.evaluate("window.__playoutDeck.decks()")) == 2)

    # one key hands it back and forth: Give to the timer (lit: a timer page with no deck), …
    po.wait_for_timeout(1700)
    check("Give to the timer lit: the timer page is open with no deck", po.evaluate("window.__playoutDeck.faces('mk2')[13]") == "→ timer | deck" and po.evaluate("localStorage.deck_timer ?? null") is None)
    # (held, the owner, 14 Nov 2026: a countdown on the top row, let go early to cancel; at the end, let go and it goes)
    po.evaluate("__decks.mk2.features = []; __decks.mk2.key(13, 1); __decks.mk2.key(13, 0)"); po.wait_for_timeout(800)
    check("a tap on → timer: nothing (it's held to hand over)", po.evaluate("__decks.mk2.opened") and not t.evaluate("__decks.mk2.opened"))
    po.evaluate("__decks.mk2.key(13, 1)"); po.wait_for_timeout(1500)
    check("held: still the playout's while it counts down (switching / to timer / in 3, 2, 1)", po.evaluate("__decks.mk2.opened") and not t.evaluate("__decks.mk2.opened"))
    po.wait_for_timeout(2200)
    check("… past the count: still here until it's let go", po.evaluate("__decks.mk2.opened") and not t.evaluate("__decks.mk2.opened"))
    po.evaluate("__decks.mk2.key(13, 0)"); po.wait_for_timeout(1500)
    check("let go: the deck to the timer (Elgato's screen first)", t.evaluate("__decks.mk2.opened") and not po.evaluate("__decks.mk2.opened") and po.evaluate("__decks.mk2.features") == [[3, 2]], [t.evaluate("__decks.mk2.opened"), po.evaluate("__decks.mk2.features")])
    check("… the timer notes it has a deck (the XL's key: it has one)", po.evaluate("localStorage.deck_timer") == "sn:MK2SERIAL01" and po.evaluate("window.__playoutDeck.face('xl', 0, 30).rs.foot") == "it has one", po.evaluate("window.__playoutDeck.face('xl', 0, 30)"))
    # … the timer's Give deck to playout, on a key of its layout: the playout's goes on the same key
    t.evaluate("localStorage.streamdeck_layout_mk2 = JSON.stringify(Array.from({ length: 15 }, (_, i) => i === 4 ? 'deck_to_playout' : i === 10 ? 'toggle_bar' : 'empty'))")
    t.reload(); t.wait_for_timeout(2500)
    tf = t.evaluate("StreamDeck.faces('mk2')[4]")
    check("the timer's deck → playout key: deck / → playout, lit while the playout page is open", (tf.get("rs") or {}).get("body") == "→ playout" and tf["bg"] == "#2a2200", tf)
    pf = [x.split(" | ")[0] for x in po.evaluate("window.__playoutDeck.faces('mk2')")]
    check("… the playout's Give to the timer moves to the same key (the items round it)", pf[4] == "→ timer" and pf[:4] == names[:4] and pf[5:8] == names[4:7] and pf[14] == "■ All", pf)
    top = lambda: t.evaluate("StreamDeck.faces('mk2').map(f => f.rs ? f.rs.body : '')")
    t.evaluate("__decks.mk2.key(4, 1)"); t.wait_for_timeout(1300)
    f1 = top()
    check("held on the timer's deck: the top row says switching / to playout / in 2, the rest blank", f1[:3] == ["switching", "to playout", "in 2"] and not any(f1[3:]), f1)
    t.wait_for_timeout(2100)
    check("… then: let go", top()[:3] == ["switching", "to playout", "let go"], top())
    t.evaluate("__decks.mk2.key(4, 0)"); t.wait_for_timeout(800)
    check("… let go: the playout page has it again", po.evaluate("__decks.mk2.opened") and not t.evaluate("__decks.mk2.opened") and "playout page" in t.text_content("#deck-status"), t.text_content("#deck-status"))
    po.evaluate("__decks.mk2.key(4, 1); __decks.mk2.key(4, 0)"); po.wait_for_timeout(500)
    check("… a tap on the same key: it stays", po.evaluate("__decks.mk2.opened") and not t.evaluate("__decks.mk2.opened"))
    po.wait_for_timeout(1000)
    po.evaluate("__decks.mk2.key(4, 1)"); po.wait_for_timeout(3400); po.evaluate("__decks.mk2.key(4, 0)"); po.wait_for_timeout(1500)
    check("… held and let go: back to the timer", t.evaluate("__decks.mk2.opened") and not po.evaluate("__decks.mk2.opened"))
    t.wait_for_timeout(1600)
    t.evaluate("__decks.mk2.key(4, 1)"); t.wait_for_timeout(1200); t.evaluate("__decks.mk2.key(4, 0)"); t.wait_for_timeout(800)
    check("… let go during the count: cancelled, still the timer's", t.evaluate("__decks.mk2.opened") and not po.evaluate("__decks.mk2.opened"))
    t.evaluate("__decks.mk2.key(10, 1); __decks.mk2.key(10, 0)"); t.wait_for_timeout(400)
    t.evaluate("__decks.mk2.key(4, 1)"); t.wait_for_timeout(3400); t.evaluate("__decks.mk2.key(4, 0)"); t.wait_for_timeout(1500)
    check("… and held again on the timer's: the playout's", po.evaluate("__decks.mk2.opened") and not t.evaluate("__decks.mk2.opened"))

    # Disconnect (the owner, 13 Nov 2026): set aside, Elgato's screen; neither page uses it until Use here
    row = lambda sn: po.text_content('#decklist [data-deck="sn:%s"]' % sn)
    po.evaluate("__decks.mk2.features = []")
    po.click('#decklist [data-deck="sn:MK2SERIAL01"] button[data-dk=off]'); po.wait_for_timeout(1500)
    check("Disconnect: Elgato's screen, let go, set aside (listed as Disconnected)", not po.evaluate("__decks.mk2.opened") and [3, 2] in po.evaluate("__decks.mk2.features")
          and po.evaluate("JSON.parse(localStorage.deck_claims)['sn:MK2SERIAL01']") == "none" and "Disconnected" in row("MK2SERIAL01") and "Use here" in row("MK2SERIAL01"), [po.evaluate("__decks.mk2.features"), row("MK2SERIAL01")])
    check("… and the timer page (open, no deck) leaves it alone too", not t.evaluate("__decks.mk2.opened"), t.text_content("#deck-status"))
    po.click('#decklist [data-deck="sn:MK2SERIAL01"] button[data-dk=playout]'); po.wait_for_timeout(1500)
    check("… Use here: driven here again", po.evaluate("__decks.mk2.opened") and "Used here" in row("MK2SERIAL01"), row("MK2SERIAL01"))

    # leaving: the decks back to Elgato's idle screen
    po.evaluate("__decks.mk2.features = []; __decks.xl.features = []; dispatchEvent(new Event('pagehide'))")
    check("the playout page leaving: its decks reset", po.evaluate("__decks.mk2.features") == [[3, 2]] and po.evaluate("__decks.xl.features") == [[3, 2]], [po.evaluate("__decks.mk2.features"), po.evaluate("__decks.xl.features")])
    # Forget: this browser's permission revoked (here a timer page could use it neither)
    said = []; po.on("dialog", lambda d: (said.append(d.message), d.accept()))
    po.click('#decklist [data-deck="sn:XLSERIAL002"] button[data-dk=forget]'); po.wait_for_timeout(1500)
    check("Forget: asked, then the XL let go and forgotten (off the list, no claim left)", said[-1:] and said[-1].startswith("Forget this Stream Deck?") and not po.evaluate("__decks.xl.opened")
          and po.locator('#decklist [data-deck="sn:XLSERIAL002"]').count() == 0 and "sn:XLSERIAL002" not in po.evaluate("JSON.parse(localStorage.deck_claims || '{}')")
          and [d["id"] for d in po.evaluate("window.__playoutDeck.decks()")] == ["sn:MK2SERIAL01"], [said[-1:], po.locator("#decklist .dk-row").all_text_contents()])
    po.close(); t.wait_for_timeout(2000)
    tf = t.evaluate("StreamDeck.faces('mk2')[4]")
    check("no playout page open: the timer's Give deck to playout dim", tf["bg"] == "#0d0d0d", tf)
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
