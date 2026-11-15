import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# A display strip (the owner, 14 Nov 2026): the 5 × 1 row of a split XL claimed for the timer, a second deck beside its
# main one, drawn as one display: the countdown (one character a key, right-aligned), the message on screen (scrolled
# when too long), the time of day; a tap on the strip shows the next, and it's kept. Fake decks in the webhid frame.
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
XL = "sn:XLSERIAL002"
REGIONS = [{"id": "A", "x": 0, "y": 0, "w": 5, "h": 3}, {"id": "B", "x": 5, "y": 0, "w": 3, "h": 2},
           {"id": "C", "x": 5, "y": 2, "w": 3, "h": 2}, {"id": "D", "x": 0, "y": 3, "w": 5, "h": 1}]
D = [24, 25, 26, 27, 28]

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server"])
    c = b.new_context(viewport={"width": 1200, "height": 900})
    c.add_init_script("if (location.hostname.startsWith('webhid')) {" + FAKE_HID + "}")
    c.route("**/*", h)
    tm = c.new_page(); tm.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    tm.goto("https://alpha.timed-show.com/timer.html"); tm.wait_for_timeout(3000)
    tm.evaluate("([gid, regions]) => DeckHID.hid().split(gid, 0x008f, regions)", [XL, REGIONS])
    for gid, who in (("sn:MK2SERIAL01", "none"), (XL + "#B", "none"), (XL + "#C", "none")):   # (A and D: not listed, the timer's)
        tm.evaluate("([g, w]) => DeckHID.setOwner(g, w)", [gid, who])
    tm.evaluate("localStorage.removeItem('streamdeck_strip_mode')")
    tm.reload(); tm.wait_for_timeout(3500)
    fr = [f for f in tm.frames if "webhid-alpha" in f.url][0]
    st = lambda: tm.evaluate("StreamDeck.strip()")
    check("the timer drives its main deck (A, an MK.2) and the strip (D) beside it", tm.evaluate("localStorage.deck_timer") == XL + "#A" and (st() or {}).get("id") == XL + "#D", [tm.evaluate("localStorage.deck_timer"), st()])
    tm.evaluate("processTimerApiMessage({ cmd: 'start', msecs: 600000 })"); tm.wait_for_timeout(1500)
    s = st()
    check("the strip shows the countdown (as the timer does)", s["mode"] == "countdown" and s["text"] == tm.evaluate("StreamDeck.strip() && document.getElementById('remain_disp') ? (document.getElementById('remain_disp').textContent || '').trim() : ''") or s["text"] in ("9:59", "9:58", "10:00"), s)
    im = fr.evaluate("__decks.xl.images")
    check("… drawn on the strip's keys (D: the XL's bottom-left five)", all(str(k) in im for k in D[1:]), sorted(int(k) for k in im))
    before = {k: im.get(str(k), 0) for k in D}
    tm.wait_for_timeout(2200)
    im2 = fr.evaluate("__decks.xl.images")
    changed = [k for k in D if im2.get(str(k), 0) != before[k]]
    check("… one character a key: as it counts down, only the last key (the seconds' units) changes most seconds", D[-1] in changed and D[0] not in changed, changed)

    # a tap: the next thing it shows
    fr.evaluate("__decks.xl.key(24, 1); __decks.xl.key(24, 0)"); tm.wait_for_timeout(200)
    check("a tap on the strip: it says what it shows now (message)", st()["mode"] == "message" and st()["text"] == "message", st())
    tm.wait_for_timeout(1100)
    check("… then shows it: none yet", st()["text"] == "no message", st())
    tm.evaluate("processTimerApiMessage({ cmd: 'custommessage', text: 'Please wrap up now, the next speaker is waiting in the wings' })"); tm.wait_for_timeout(600)
    check("… the message on screen", st()["text"].startswith("Please wrap up"), st())
    a = fr.evaluate("__decks.xl.images"); tm.wait_for_timeout(1200); z = fr.evaluate("__decks.xl.images")
    check("… a long one scrolls (its keys keep changing)", sum(z.get(str(k), 0) - a.get(str(k), 0) for k in D) >= 5, [a, z])
    fr.evaluate("__decks.xl.key(25, 1); __decks.xl.key(25, 0)"); tm.wait_for_timeout(1300)
    t = st()["text"]
    check("another tap: the time of day (hh:mm:ss)", st()["mode"] == "clock" and re.match(r"^\d\d:\d\d:\d\d$", t) is not None, st())
    check("… kept for next time", tm.evaluate("localStorage.streamdeck_strip_mode") == "clock")

    # the main deck: unaffected
    bar = tm.evaluate("document.documentElement.classList.contains('showbar')")
    fr.evaluate("__decks.xl.key(16, 1); __decks.xl.key(16, 0)"); tm.wait_for_timeout(500)   # (A's key 10: Bar)
    check("the main deck's keys work as ever (Bar)", tm.evaluate("document.documentElement.classList.contains('showbar')") != bar)
    tm.reload(); tm.wait_for_timeout(3500)
    check("a reload: the strip back, still on the clock", (st() or {}).get("mode") == "clock", st())
    b.close()
print("errors:", errs)
