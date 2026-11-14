import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# A Stream Deck XL split into virtual decks by the webhid frame (the owner's layout, 14 Nov 2026): A = a 5 × 3 (an MK.2)
# top left, B and C = 3 × 2 (Minis) on the right, D = a 5 × 1 strip along the bottom left. The timer drives A, the
# playout page B and C, each as a deck of its own (serials '<XL>#A' …): their images land on the XL's keys of their
# region, presses reach the page and key they belong to, the backlight is the timer's while its deck is open, a page
# going clears only its region, and the deck comes back whole when the split is removed. Fake decks in the frames
# (each frame has its own; the images land in the driving frame's).
import mimetypes, os, re, sys
from playwright.sync_api import sync_playwright
WEBHID = os.environ.get('WEBHID_PUBLIC') or os.path.normpath(os.path.join(HERE, '..', '..', '..', 'webhid', 'public'))
if not os.path.isfile(os.path.join(WEBHID, 'frame.html')):
    print("(skipped: no webhid frame at " + WEBHID + ")"); print("errors: []"); sys.exit(0)
_PD = open(os.path.join(HERE, 'playout_deck.py'), encoding='utf-8').read()
FAKE_HID = re.search(r'FAKE_HID = """(.*?)"""', _PD, re.S).group(1)
SETUP = re.search(r'SETUP = """(.*?)"""', _PD, re.S).group(1)
SITES = {"https://alpha.timed-show.com/": PUBLIC, "https://webhid-alpha.timed-show.com/": WEBHID}
def h(route, req):
    for base, root in SITES.items():
        if req.url.startswith(base):
            name = req.url[len(base):].split("?")[0].split("#")[0]
            if name in ("changelog.html", "stock-stings.json"): return route.fulfill(status=404, body=b"")
            fp = os.path.join(root, name)
            if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
            return route.fulfill(status=404, body=b"")
    return route.abort()
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)
XL = "sn:XLSERIAL002"
REGIONS = [{"id": "A", "x": 0, "y": 0, "w": 5, "h": 3}, {"id": "B", "x": 5, "y": 0, "w": 3, "h": 2},
           {"id": "C", "x": 5, "y": 2, "w": 3, "h": 2}, {"id": "D", "x": 0, "y": 3, "w": 5, "h": 1}]
keys = lambda r: [(r["y"] + j) * 8 + r["x"] + i for j in range(r["h"]) for i in range(r["w"])]
A, B, C, D = (keys(r) for r in REGIONS)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"])
    c = b.new_context(viewport={"width": 1200, "height": 900})
    c.add_init_script("if (location.hostname.startsWith('webhid')) {" + FAKE_HID + "}")
    c.route("**/*", h)
    fr = lambda pg: [f for f in pg.frames if "webhid-alpha" in f.url][0]
    tm = c.new_page(); tm.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    tm.goto("https://alpha.timed-show.com/timer.html"); tm.wait_for_timeout(3000)
    # the split, and who has which part (the MK.2 set aside, so the timer takes A)
    tm.evaluate("([gid, regions]) => DeckHID.hid().split(gid, 0x008f, regions)", [XL, REGIONS])
    for gid, who in (("sn:MK2SERIAL01", "none"), (XL + "#B", "playout"), (XL + "#C", "playout"), (XL + "#D", "none")):
        tm.evaluate("([g, w]) => DeckHID.setOwner(g, w)", [gid, who])
    tm.reload(); tm.wait_for_timeout(3500)
    lead = lambda: [pg for pg in (tm, po) if not pg.is_closed() and XL in fr(pg).evaluate("window.__frame.leading()")][0]
    po = None
    names = tm.evaluate("DeckHID.granted().then(l => l.map(d => d.productName))")
    check("the XL split: offered as four virtual decks, not whole", sorted(n for n in names if "XL" in n) == ["Fake XL · A (5×3)", "Fake XL · B (3×2)", "Fake XL · C (3×2)", "Fake XL · D (5×1)"], names)
    models = tm.evaluate("DeckHID.granted().then(l => l.filter(d => d.virtual).map(d => DeckHID.info(d).model))")
    check("… as an MK.2, two Minis and a 5 × 1 strip (drawn at the XL's key size)", sorted(models) == ["c5x1", "mini", "mini", "mk2"] and tm.evaluate("DeckHID.granted().then(l => l.find(d => d.virtual).virtual.keySize)") == 96, models)
    check("the timer drives A, by its own serial", tm.evaluate("localStorage.deck_timer") == XL + "#A", tm.evaluate("localStorage.deck_timer"))
    img = lambda pg: fr(pg).evaluate("__decks.xl.images")
    im = img(tm)
    check("… its images on the XL's keys of A (5 × 3, top left), none elsewhere", all(str(k) in im for k in A) and not any(str(k) in im for k in B + C + D), sorted(int(k) for k in im))

    po = c.new_page(); po.on("pageerror", lambda e: errs.append("playout: " + str(e)))
    po.goto("https://alpha.timed-show.com/playout.html?demo"); po.wait_for_timeout(800)
    po.evaluate(SETUP); po.evaluate("localStorage.removeItem('deck_claims')"); po.reload(); po.wait_for_timeout(3500)
    check("the playout page drives B and C (as Minis)", sorted(d["id"] for d in po.evaluate("window.__playoutDeck.decks()")) == [XL + "#B", XL + "#C"]
          and all(d["model"] == "mini" for d in po.evaluate("window.__playoutDeck.decks()")), po.evaluate("window.__playoutDeck.decks()"))
    im = img(lead())
    check("… their images on B's and C's keys; D (no one's) untouched", all(str(k) in im for k in B + C) and not any(str(k) in im for k in D), sorted(int(k) for k in im))

    # presses: each to its own deck and key
    bar = tm.evaluate("document.documentElement.classList.contains('showbar')")
    fr(lead()).evaluate("__decks.xl.key(16, 1); __decks.xl.key(16, 0)"); tm.wait_for_timeout(600)   # (A's key 10: Bar on an MK.2)
    check("the XL's key 16 (A's 10th: Bar): the timer toggles the bar", tm.evaluate("document.documentElement.classList.contains('showbar')") != bar)
    fr(lead()).evaluate("__decks.xl.key(13, 1); __decks.xl.key(13, 0)"); po.wait_for_timeout(800)   # (B's key 3: a Mini's third item)
    check("the XL's key 13 (B's key 3): the playout page starts its third item", (po.evaluate("window.__playout.local()") or {}).get("item") == "demo-3", po.evaluate("window.__playout.local()"))
    po.evaluate("document.getElementById('stopall').click()")
    check("… and the timer didn't hear it", tm.evaluate("document.documentElement.classList.contains('showbar')") != bar)

    # the backlight: the timer's while its deck is open
    feats = lambda: fr(lead()).evaluate("__decks.xl.features.filter(f => f[0] === 3 && f[1] === 8).length")
    BRIGHT = "(async () => { const d = (await DeckHID.hid().getDevices()).find(x => x.key === '%s'); await d.sendFeatureReport(3, Uint8Array.of(8, 40, ...new Array(29).fill(0))); })()" % (XL + "#B")
    n0 = feats(); po.evaluate(BRIGHT); po.wait_for_timeout(300)
    check("backlight from the playout's B while the timer's A is open: not applied", feats() == n0, [n0, feats()])

    # the timer page goes: only A cleared; the playout page carries on (its frame takes the XL over)
    before = img(lead()) if lead() is not tm else None
    tm.close(); po.wait_for_timeout(3500)
    im2 = img(po)
    check("the timer page closed: the playout page's frame drives the XL now", XL in fr(po).evaluate("window.__frame.leading()"))
    check("… A cleared (its keys drawn black by the new driver), D (no one's) untouched", all(str(k) in im2 for k in A) and not any(str(k) in im2 for k in D), sorted(int(k) for k in im2))
    fr(po).evaluate("__decks.xl.key(14, 1); __decks.xl.key(14, 0)"); po.wait_for_timeout(800)   # (B's key 4: a Mini's fourth item)
    check("… and its presses still work", (po.evaluate("window.__playout.local()") or {}).get("item") == "demo-4", po.evaluate("window.__playout.local()"))
    po.evaluate("document.getElementById('stopall').click()")
    po.wait_for_timeout(6500)                                       # (the timer's deck no longer said open anywhere)
    n1 = feats(); po.evaluate(BRIGHT); po.wait_for_timeout(300)
    check("… with no timer, B may set the backlight", feats() == n1 + 1, [n1, feats()])

    # whole again
    po.evaluate("(gid) => DeckHID.hid().split(gid, 0x008f, null)", XL); po.wait_for_timeout(2500)
    names = po.evaluate("DeckHID.granted().then(l => l.map(d => d.productName))")
    check("the split removed: the XL offered whole again", "Fake XL" in names and not any("·" in n for n in names), names)
    check("… the playout page let go of B and C (gone)", not any("#" in d["id"] for d in po.evaluate("window.__playoutDeck.decks()")), po.evaluate("window.__playoutDeck.decks()"))

    # The split editor (split.html on the webhid site; the owner: drag the parts into place, the strip on top if you like)
    tm2 = c.new_page(); tm2.on("pageerror", lambda e: errs.append("timer 2: " + str(e)))
    tm2.goto("https://alpha.timed-show.com/timer.html"); tm2.wait_for_timeout(3000)
    ed = c.new_page(); ed.on("pageerror", lambda e: errs.append("editor: " + str(e)))
    ed.set_viewport_size({"width": 1000, "height": 900})
    ed.goto("https://webhid-alpha.timed-show.com/split.html"); ed.wait_for_timeout(2500)
    check("the editor lists the decks in reach (from the frames driving them)", sorted(ed.evaluate("window.__split.decks()")) == ["sn:MK2SERIAL01", XL], ed.evaluate("window.__split.decks()"))
    ed.select_option("#deck", XL); ed.wait_for_timeout(200)
    ed.select_option("#preset", "strip-mk2-minis"); ed.wait_for_timeout(200)
    cur = ed.evaluate("window.__split.cur()")
    check("Start from: a strip on top, MK.2 and two Minis (the MK.2 the timer's, the Minis the soundboard's, the strip unused)",
          [(r["id"], r["x"], r["y"], r["w"], r["h"]) for r in cur["regions"]] == [("D", 0, 0, 5, 1), ("A", 0, 1, 5, 3), ("B", 5, 0, 3, 2), ("C", 5, 2, 3, 2)]
          and cur["owners"] == {"D": "none", "A": "timer", "B": "playout", "C": "playout"}, cur)
    ed.click('.vd[data-id="D"] .x'); ed.wait_for_timeout(100)
    cell = lambda x, y: ed.locator('.cell[data-x="%d"][data-y="%d"]' % (x, y)).bounding_box()
    a0, a4 = cell(0, 0), cell(4, 0)
    ed.mouse.move(a0["x"] + 10, a0["y"] + 10); ed.mouse.down(); ed.mouse.move(a4["x"] + 10, a4["y"] + 10, steps=6); ed.mouse.up(); ed.wait_for_timeout(150)
    cur = ed.evaluate("window.__split.cur()")
    check("✕ removes the strip; dragged across the top row's empty keys: a new 5 × 1 part (unused)", any((r["x"], r["y"], r["w"], r["h"]) == (0, 0, 5, 1) for r in cur["regions"]) and len(cur["regions"]) == 4, cur["regions"])
    bx, tgt = ed.locator('.vd[data-id="B"] b').bounding_box(), cell(1, 2)
    ed.mouse.move(bx["x"] + 5, bx["y"] + 5); ed.mouse.down(); ed.mouse.move(tgt["x"] + 10, tgt["y"] + 10, steps=6); ed.mouse.up(); ed.wait_for_timeout(150)
    cur = ed.evaluate("window.__split.cur()")
    check("a part dragged onto another: refused (it stays where it was)", next(r for r in cur["regions"] if r["id"] == "B")["x"] == 5, cur["regions"])
    ed.click("#save"); ed.wait_for_timeout(3000)
    check("Save: the timer has the MK.2 part, the soundboard the two Minis", tm2.evaluate("localStorage.deck_timer") == XL + "#A"
          and sorted(d["id"] for d in po.evaluate("window.__playoutDeck.decks()")) == [XL + "#B", XL + "#C"], [tm2.evaluate("localStorage.deck_timer"), po.evaluate("window.__playoutDeck.decks()")])
    drv = [pg for pg in (tm2, po) if XL in fr(pg).evaluate("window.__frame.leading()")][0]
    rowsA = [(1 + j) * 8 + i for j in range(3) for i in range(5)]
    im3 = fr(drv).evaluate("__decks.xl.images")
    check("… the timer's MK.2 drawn on rows 2–4 (the strip's row above it left alone)", all(str(k) in im3 for k in rowsA), sorted(int(k) for k in im3))
    ed.screenshot(path=os.path.join(OUTDIR, "webhid_split_editor.png"))
    b.close()
print("errors:", errs)
