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
FAKE_HID = re.search(r'FAKE_HID = """(.*?)"""', open(os.path.join(HERE, 'playout_deck.py'), encoding='utf-8').read(), re.S).group(1)
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

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"])
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
    po.close()

    # a frame that doesn't answer: the page's own WebHID, as before
    c2 = b.new_context(viewport={"width": 1200, "height": 900})
    c2.add_init_script(FAKE_HID); c2.route("**/*", h)
    fb = c2.new_page(); fb.on("pageerror", lambda e: errs.append("fallback: " + str(e)))
    fb.goto("https://alpha.timed-show.com/timer.html?webhid=https://nowhere.timed-show.com/frame.html"); fb.wait_for_timeout(6500)
    check("a frame that doesn't answer: the page's own WebHID (its deck attached and drawn)", fb.evaluate("DeckHID.hid().ready") is False and fb.evaluate("Object.keys(__decks.mk2.images).length") == 15, [fb.evaluate("DeckHID.hid().ready"), fb.evaluate("Object.keys(__decks.mk2.images).length")])
    b.close()
print("errors:", errs)
