import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# The playout computer's Stream Deck soundboard (playout-deck.js, deck-hid.js), on the demo (Follow off):
# a key per item with cues; a press starts the item; on a playing item a tap stops it and a hold fades it
# (over playout_deck_fade s, stopped wherever it's let go); the last key does it for everything; ◀ ▶ page
# when the items don't fit (the Mini on the page). Keys arranged by dragging on the page (per deck model).
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
    const d = { vendorId: 0x0fd9, productId: pid, productName: name, opened: false, images: {}, features: [],
      async open() { this.opened = true; }, async close() { this.opened = false; },
      async sendReport(id, data) { if (data[0] === 0x07 && data[2] === 1) this.images[data[1]] = (this.images[data[1]] || 0) + 1; },
      async sendFeatureReport(id, b) { this.features.push([id, b[0]]); },
      async receiveFeatureReport(id) { const b = new Uint8Array(32); b[0] = id; b[1] = serial.length; for (let i = 0; i < serial.length; i++) b[2 + i] = serial.charCodeAt(i); return new DataView(b.buffer); },
      addEventListener(t, fn) { ls[t] = fn; }, removeEventListener(t) { delete ls[t]; } };
    // a key down (v = 1) or up (0): a gen2 input report, key states from byte 3
    d.key = (i, v) => { const b = new Uint8Array(3 + keys); b[3 + i] = v; if (ls.inputreport) ls.inputreport({ reportId: 1, data: new DataView(b.buffer) }); };
    return d;
  };
  const mk2 = mk(0x0080, 'MK2SERIAL01', 15, 'Fake MK.2'), xl = mk(0x008f, 'XLSERIAL002', 32, 'Fake XL');
  window.__decks = { mk2, xl };
  Object.defineProperty(navigator, 'hid', { configurable: true, value: {
    getDevices: async () => [mk2, xl], requestDevice: async () => [xl], addEventListener() {}, removeEventListener() {} } });
})();"""
SETUP = """async () => {                     // seven speakers with a 6 s tone each (a start cue), files in the store
  const wav = sec => { const sr = 16000, n = sr * sec, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / sr) * 8000, true);
    return new Blob([b], { type: 'audio/wav' }); };
  const cues = {};
  for (let k = 1; k <= 7; k++) {
    cues['demo-' + k] = [{ id: 'c' + k, name: 'Tone ' + k, media: 'audio', src: 'file', trigger: 'start', at: 0, duration: 6 }];
    await videoStore.put('pocue:c' + k, wav(6));
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

    # a press starts the item (Follow is off in the demo)
    key(0, 1); key(0, 0); po.wait_for_timeout(500)
    check("a press starts its item (▶ Start item): its cue plays", (local() or {}).get("item") == "demo-1" and playing() == ["c1"], [local(), playing()])
    check("… the key says so", "left" in po.evaluate("window.__playoutDeck.faces('mk2')[0]"), po.evaluate("window.__playoutDeck.faces('mk2')[0]"))
    # a tap on a playing item stops it
    key(0, 1); po.wait_for_timeout(80); key(0, 0); po.wait_for_timeout(300)
    check("a tap on it: stopped (and the item run ended)", playing() == [] and local() is None, [playing(), local()])

    # a hold fades it out (2 s), stopped wherever it's let go
    key(0, 1); key(0, 0); po.wait_for_timeout(600)
    g0 = po.evaluate("window.__playout.gain('c1')")
    key(0, 1); po.wait_for_timeout(1000)
    g1 = po.evaluate("window.__playout.gain('c1')")
    check("held: still playing after 1 s, fading", playing() == ["c1"] and g1 is not None and g1 < g0 * 0.8, [playing(), g0, g1])
    check("… the key says fading", "fading" in po.evaluate("window.__playoutDeck.faces('mk2')[0]"))
    po.wait_for_timeout(1500)
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
    check("seven items on a Mini: three a page, then ◀ ▶ and everything", [x.split(" | ")[0] for x in f] == names[:3] + ["◀", "▶", "■ All"], f)
    bx = cv(4).bounding_box(); po.mouse.click(bx["x"] + 20, bx["y"] + 20); po.wait_for_timeout(300)
    check("▶: the next page", po.evaluate("window.__playoutDeck.faces('mini', 1)")[0].split(" | ")[0] == names[3] and po.evaluate("document.querySelectorAll('#vdecks canvas').length") == 6)

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

    # the XL too: Use here
    po.click('#decklist [data-deck="sn:XLSERIAL002"] button'); po.wait_for_timeout(1200)
    check("Use here: the XL is driven here too", sorted(d["id"] for d in po.evaluate("window.__playoutDeck.decks()")) == ["sn:MK2SERIAL01", "sn:XLSERIAL002"] and po.evaluate("Object.keys(__decks.xl.images).length") == 32)
    rows = po.locator("#decklist .dk-row").all_text_contents()
    check("… the list: both used here, each once", len(rows) == 2 and all("Used here" in r for r in rows), rows)
    po.evaluate("__decks.xl.key(1, 1); __decks.xl.key(1, 0)"); po.wait_for_timeout(500)
    check("… its keys work", (local() or {}).get("item") == "demo-2", local())
    po.evaluate("__decks.xl.key(31, 1); __decks.xl.key(31, 0)"); po.wait_for_timeout(200)

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

    # leaving: the decks back to Elgato's idle screen
    po.evaluate("__decks.mk2.features = []; __decks.xl.features = []; dispatchEvent(new Event('pagehide'))")
    check("the playout page leaving: its decks reset", po.evaluate("__decks.mk2.features") == [[3, 2]] and po.evaluate("__decks.xl.features") == [[3, 2]], [po.evaluate("__decks.mk2.features"), po.evaluate("__decks.xl.features")])
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
