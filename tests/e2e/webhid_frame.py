import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Stream Decks through the webhid site's frame (webhid-client.js, a trial on alpha; the frame is the webhid repo's
# public/frame.html, beside this one as ../webhid, or $WEBHID_PUBLIC): the timer and playout pages served under
# their real alpha name, the frame under webhid-alpha.timed-show.com, the fake decks inside the frame only (the
# frame's origin holds the grant). The timer attaches its deck through the frame and draws it, a key press runs its
# action, the deck's reset is left with the frame for when the page goes; Connect a deck… shows the frame in a
# dialog (its own button chooses; Cancel); the playout page drives its deck through it too; a frame that doesn't
# answer leaves the page on its own WebHID.
import mimetypes, os, re, sys
from playwright.sync_api import sync_playwright
WEBHID = os.environ.get('WEBHID_PUBLIC') or os.path.normpath(os.path.join(HERE, '..', '..', '..', 'webhid', 'public'))
if not os.path.isfile(os.path.join(WEBHID, 'frame.html')):
    print("(skipped: no webhid frame at " + WEBHID + ")"); print("errors: []"); sys.exit(0)
_PD = open(os.path.join(HERE, 'playout_deck.py'), encoding='utf-8').read()
FAKE_HID = re.search(r'FAKE_HID = """(.*?)"""', _PD, re.S).group(1)
SETUP = re.search(r'SETUP = """(.*?)"""', _PD, re.S).group(1)   # (seven speakers with a tone each: item keys that do something)
SITES = {"https://alpha.timed-show.com/": PUBLIC, "https://beta.timed-show.com/": PUBLIC, "https://webhid-alpha.timed-show.com/": WEBHID}
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

# Storage partitioned as for users (Playwright turns ThirdPartyStoragePartitioning off: issue #32230), so the frame's
# table being shared by alpha and beta pages is real
def disabled_features(p):
    import subprocess
    probe = p.chromium.launch()
    try:
        out = subprocess.run(["ps", "-axo", "args"], capture_output=True, text=True).stdout
        return next((w for l in out.splitlines() if "--disable-features=" in l and "chrom" in l.lower() for w in l.split() if w.startswith("--disable-features=")), None)
    finally: probe.close()

with sync_playwright() as p:
    df = disabled_features(p)
    keep = ",".join(f for f in df.split("=", 1)[1].split(",") if f != "ThirdPartyStoragePartitioning") if df else ""
    b = p.chromium.launch(args=["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"] + (["--disable-features=" + keep] if keep else []), ignore_default_args=[df] if df else None)
    c = b.new_context(viewport={"width": 1200, "height": 900})
    c.add_init_script("if (location.hostname.startsWith('webhid')) {" + FAKE_HID + "}")   # (the decks: the frame's)
    c.route("**/*", h)
    tm = c.new_page(); tm.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    tm.goto("https://alpha.timed-show.com/timer.html"); tm.wait_for_timeout(3500)
    fr = lambda pg: [f for f in pg.frames if "webhid-alpha" in f.url][0]
    check("the timer on alpha: its decks come through the webhid frame", tm.evaluate("!!(DeckHID.hid() && DeckHID.hid().frame)") and tm.evaluate("DeckHID.hid().ready"))
    status = tm.text_content("#deck-status") or ""
    imgs = fr(tm).evaluate("Object.keys(__decks.mk2.images).length")
    check("… it attaches the MK.2 through the frame and draws its keys", "Fake" in status or "MK" in status or imgs == 15, [status, imgs])
    check("… the deck's reset left with the frame, for when the page goes", len(fr(tm).evaluate("window.__frame.leave()")) == 1, fr(tm).evaluate("window.__frame.leave()"))
    bar = tm.evaluate("document.documentElement.classList.contains('showbar')")
    fr(tm).evaluate("__decks.mk2.key(10, 1); __decks.mk2.key(10, 0)"); tm.wait_for_timeout(500)
    check("a key pressed on the deck (Bar, key 10): the timer toggles the bar", tm.evaluate("document.documentElement.classList.contains('showbar')") != bar)

    # Connect a deck…: the frame shown in a dialog, its own button chooses (WebHID asks only from a click in it)
    ASK = "(() => { window.__asked = DeckHID.hid().requestDevice({ filters: DeckHID.filters() }); })()"   # (not awaited: it waits for the click)
    tm.evaluate(ASK)
    tm.wait_for_timeout(300)
    check("requestDevice: the frame in a dialog, with its Connect a deck… button", tm.is_visible("#webhid-box.asking") and tm.frame_locator("#webhid-box iframe").locator("#connect").is_visible())
    tm.frame_locator("#webhid-box iframe").locator("#connect").click(); tm.wait_for_timeout(500)
    chosen = tm.evaluate("window.__asked.then(l => l.map(d => d.productName))")
    check("… a deck chosen in the frame: the dialog goes, the deck comes back to the page", chosen == ["Fake XL"] and not tm.is_visible("#webhid-box.asking"), [chosen, tm.is_visible("#webhid-box.asking")])
    tm.evaluate(ASK); tm.wait_for_timeout(300)
    tm.click("#webhid-box .wh-cancel"); tm.wait_for_timeout(200)
    check("… Cancel: nothing chosen, the dialog gone", tm.evaluate("window.__asked.then(l => l.length)") == 0 and not tm.is_visible("#webhid-box.asking"))
    tm.close()

    # the playout page: its deck (claimed) through the frame too
    po = c.new_page(); po.on("pageerror", lambda e: errs.append("playout: " + str(e)))
    po.goto("https://alpha.timed-show.com/playout.html?demo"); po.wait_for_timeout(500)
    po.evaluate("localStorage.deck_claims = JSON.stringify({ 'sn:MK2SERIAL01': 'playout' })"); po.reload(); po.wait_for_timeout(3500)
    check("the playout page drives its deck through the frame", po.evaluate("window.__playoutDeck.decks()") == [{"id": "sn:MK2SERIAL01", "model": "mk2", "page": 0}] and fr(po).evaluate("Object.keys(__decks.mk2.images).length") == 15,
          [po.evaluate("window.__playoutDeck.decks()"), fr(po).evaluate("Object.keys(__decks.mk2.images).length")])
    check("claims: the table is the frame's (the page's old one copied in once)", "MK2SERIAL01" in (fr(po).evaluate("localStorage.deck_claims") or "") and po.evaluate("DeckHID.ownerOf('sn:MK2SERIAL01')") == "playout",
          fr(po).evaluate("localStorage.deck_claims"))

    # a claim made on one page reaches the other: the timer takes the MK.2 back, the playout page lets go of it
    tm = c.new_page(); tm.on("pageerror", lambda e: errs.append("timer 2: " + str(e)))
    tm.goto("https://alpha.timed-show.com/timer.html"); tm.wait_for_timeout(3000)
    check("the timer leaves the playout's deck alone (the frame's claims)", tm.evaluate("DeckHID.ownerOf('sn:MK2SERIAL01')") == "playout" and po.evaluate("window.__playoutDeck.decks().length") == 1)
    tm.evaluate("DeckHID.setOwner('sn:MK2SERIAL01', 'timer')"); po.wait_for_timeout(1500)
    check("… a claim on the timer page: the playout page hears it and lets go", po.evaluate("window.__playoutDeck.decks()") == [] and po.evaluate("DeckHID.ownerOf('sn:MK2SERIAL01')") == "timer", po.evaluate("window.__playoutDeck.decks()"))

    # a beta page's frame: the same table (one per site)
    bt = c.new_page(); bt.on("pageerror", lambda e: errs.append("beta: " + str(e)))
    bt.add_init_script("window.TimerFeatures = { playout: true, webhid: true };")
    po.evaluate("DeckHID.setOwner('sn:XLSERIAL002', 'none')"); po.wait_for_timeout(300)
    bt.goto("https://beta.timed-show.com/playout.html?demo&webhid=https://webhid-alpha.timed-show.com/frame.html"); bt.wait_for_timeout(3000)
    check("a beta page through the same frame: the same claims (one table per site)", bt.evaluate("DeckHID.ownerOf('sn:XLSERIAL002')") == "none" and bt.evaluate("DeckHID.hid().live"), bt.evaluate("DeckHID.claims()"))
    bt.close(); tm.close()
    po.close()

    # One frame drives each deck (the first to take its Web Lock); another page's frame reaches it over the channel.
    # (Each frame here has its own fake decks with the same serials; on a real computer they're one deck: the
    # images land in the driving frame's fakes.)
    c3 = b.new_context(viewport={"width": 1200, "height": 900})
    c3.add_init_script("if (location.hostname.startsWith('webhid')) {" + FAKE_HID + "}"); c3.route("**/*", h)
    t3 = c3.new_page(); t3.on("pageerror", lambda e: errs.append("timer 3: " + str(e)))
    t3.goto("https://alpha.timed-show.com/timer.html"); t3.wait_for_timeout(500)
    t3.evaluate("DeckHID.setOwner('sn:XLSERIAL002', 'playout')"); t3.reload(); t3.wait_for_timeout(3000)
    p3 = c3.new_page(); p3.on("pageerror", lambda e: errs.append("playout 3: " + str(e)))
    p3.goto("https://alpha.timed-show.com/playout.html?demo"); p3.wait_for_timeout(800)
    p3.evaluate(SETUP); p3.evaluate("localStorage.removeItem('deck_claims')"); p3.reload(); p3.wait_for_timeout(3500)   # (the claims: the frame's)
    lead = lambda gid: [pg for pg in (t3, p3) if not pg.is_closed() and gid in fr(pg).evaluate("window.__frame.leading()")]
    check("the first page's frame drives both decks", lead("sn:MK2SERIAL01") == [t3] and lead("sn:XLSERIAL002") == [t3], [fr(t3).evaluate("window.__frame.leading()"), fr(p3).evaluate("window.__frame.leading()")])
    check("… the playout page drives the XL through it: its images in the driving frame's deck", p3.evaluate("window.__playoutDeck.decks().map(d => d.id)") == ["sn:XLSERIAL002"]
          and fr(t3).evaluate("Object.keys(__decks.xl.images).length") == 32 and fr(p3).evaluate("Object.keys(__decks.xl.images).length") == 0,
          [p3.evaluate("window.__playoutDeck.decks()"), fr(t3).evaluate("Object.keys(__decks.xl.images).length"), fr(p3).evaluate("Object.keys(__decks.xl.images).length"),
           p3.evaluate("DeckHID.claims()"), p3.evaluate("window.__playoutDeck.listed && window.__playoutDeck.listed()"), fr(p3).evaluate("({known: window.__frame.list(), counts: window.__frame.counts()})"), p3.evaluate("window.__wlog || null")])
    check("… and the timer its MK.2, directly", fr(t3).evaluate("Object.keys(__decks.mk2.images).length") == 15)
    fr(t3).evaluate("__decks.xl.key(0, 1); __decks.xl.key(0, 0)"); p3.wait_for_timeout(800)
    check("a press on the XL (in the driving frame) reaches the playout page: its first item starts", (p3.evaluate("window.__playout.local()") or {}).get("item") == "demo-1", p3.evaluate("window.__playout.local()"))
    p3.evaluate("window.__playout.local() && document.getElementById('stopall').click()")
    # the driving page goes: the playout page's frame takes the XL over, and the playout page carries on
    t3.close(); p3.wait_for_timeout(3000)
    check("the driving page closed: the playout page's frame drives the XL now", lead("sn:XLSERIAL002") == [p3], fr(p3).evaluate("window.__frame.leading()"))
    check("… the playout page still has its XL", p3.evaluate("window.__playoutDeck.decks().map(d => d.id)") == ["sn:XLSERIAL002"], p3.evaluate("window.__playoutDeck.decks()"))
    fr(p3).evaluate("__decks.xl.key(1, 1); __decks.xl.key(1, 0)"); p3.wait_for_timeout(800)
    check("… its presses work (through the new driver)", (p3.evaluate("window.__playout.local()") or {}).get("item") == "demo-2",
          [p3.evaluate("window.__playout.local()"), p3.evaluate("window.__playout.playing()"), fr(p3).evaluate("({known: window.__frame.list(), leading: window.__frame.leading(), opened: __decks.xl.opened, counts: window.__frame.counts()})"), p3.evaluate("window.__playoutDeck.decks()")])
    check("… and what changes on its keys is drawn there", fr(p3).evaluate("Object.keys(__decks.xl.images).length") >= 1, fr(p3).evaluate("Object.keys(__decks.xl.images).length"))
    c3.close()

    # Latest image wins (a level meter, a video on the keys): 60 images for one key sent at once reach the deck as a
    # handful, the last one included, not as a backlog of 60
    c4 = b.new_context(viewport={"width": 1000, "height": 800})
    c4.add_init_script("if (location.hostname.startsWith('webhid')) {" + FAKE_HID + "}"); c4.route("**/*", h)
    sp = c4.new_page(); sp.on("pageerror", lambda e: errs.append("spike: " + str(e)))
    sp.goto("https://alpha.timed-show.com/webhid-spike.html"); sp.wait_for_timeout(1500)
    sp.click("#viaframe"); sp.wait_for_timeout(2500)
    before = fr(sp).evaluate("__decks.mk2.images[0] || 0")
    sent = sp.evaluate("""async () => { const d = window.__spike.deck(), c = document.createElement('canvas'); c.width = c.height = d.keySize;
      const ps = []; for (let n = 0; n < 60; n++) { const k = document.createElement('canvas'); k.width = k.height = d.keySize; k.getContext('2d').fillStyle = 'hsl(' + n * 6 + ',70%,40%)'; k.getContext('2d').fillRect(0, 0, d.keySize, d.keySize); ps.push(d.setKey(0, k)); }
      await Promise.all(ps); return ps.length; }""")
    drawn = fr(sp).evaluate("__decks.mk2.images[0] || 0") - before
    check("60 images for one key at once: a handful reach the deck (latest wins), all 60 calls settle", sent == 60 and 1 <= drawn <= 5, [sent, drawn])
    c4.close()

    # a frame that doesn't answer: the page's own WebHID, as before
    c2 = b.new_context(viewport={"width": 1200, "height": 900})
    c2.add_init_script(FAKE_HID); c2.route("**/*", h)
    fb = c2.new_page(); fb.on("pageerror", lambda e: errs.append("fallback: " + str(e)))
    fb.goto("https://alpha.timed-show.com/timer.html?webhid=https://nowhere.timed-show.com/frame.html"); fb.wait_for_timeout(6500)
    check("a frame that doesn't answer: the page's own WebHID (its deck attached and drawn)", fb.evaluate("DeckHID.hid().ready") is False and fb.evaluate("Object.keys(__decks.mk2.images).length") == 15, [fb.evaluate("DeckHID.hid().ready"), fb.evaluate("Object.keys(__decks.mk2.images).length")])
    b.close()
print("errors:", errs)
