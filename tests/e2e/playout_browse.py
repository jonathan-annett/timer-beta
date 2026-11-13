import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Choosing files instead of dropping them (the owner, 14 Nov 2026: a tablet or phone can't drop files). The
# soundboard's Add files… and Add a folder… make an item per audio or video file, as a drop does (name order, the
# folder 3 deep, dot files and other files left out); Add a folder… is hidden on phones and iPads, which can't pick a
# folder. The Stream Deck panel's Add files to keys… puts the files on the first empty keys, as dropped there.
import io, math, mimetypes, os, shutil, struct, wave
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        name = u[len(BASE):].split("?")[0].split("#")[0]
        if name in ("changelog.html", "stock-stings.json"): return route.fulfill(status=404, body=b"")
        fp = os.path.join(PUBLIC, name)
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
def tone(sec, hz=440):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * hz * i / 8000))) for i in range(int(8000 * sec))))
    return buf.getvalue()
DIR = os.path.join(OUTDIR, "browse_files"); shutil.rmtree(DIR, ignore_errors=True)
for rel, data in {"Show/10 Finale.wav": tone(2), "Show/2 Opening.wav": tone(3), "Show/notes.txt": b"not media", "Show/.hidden.wav": tone(1),
                  "Show/Act 2/Walk on.wav": tone(2), "Show/a/b/c/Too deep.wav": tone(1), "loose/Jingle.wav": tone(2), "loose/Sting.wav": tone(1)}.items():
    fp = os.path.join(DIR, rel); os.makedirs(os.path.dirname(fp), exist_ok=True); open(fp, "wb").write(data)
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1200, "height": 900})
    c.add_init_script("window.TimerFeatures = { playout: true };")
    c.route("**/*", h)
    po = c.new_page(); po.on("pageerror", lambda e: errs.append("soundboard: " + str(e)))
    po.on("dialog", lambda d: d.accept())
    po.goto(BASE + "playout.html?soundboard"); po.wait_for_timeout(1200)
    names = lambda: [x["n"] for x in po.evaluate("window.__playout.show().items")]

    check("Add files… and Add a folder… beside + Add item (a desktop browser picks folders)", po.is_visible("#sb-addfiles") and po.is_visible("#sb-adddir"))
    with po.expect_file_chooser() as fc: po.click("#sb-addfiles")
    fc.value.set_files([os.path.join(DIR, "loose", n) for n in ("Sting.wav", "Jingle.wav")]); po.wait_for_timeout(2500)
    check("Add files…: an item per file, in name order, its length the file's", names() == ["Jingle", "Sting"] and [x["d"] for x in po.evaluate("window.__playout.show().items")] == [2, 1], po.evaluate("window.__playout.show().items"))

    po.set_input_files("#sb-dir", os.path.join(DIR, "Show")); po.wait_for_timeout(3000)
    check("Add a folder…: its audio files (3 deep), in name order; text, dot and too-deep files left out",
          names() == ["Jingle", "Sting", "2 Opening", "10 Finale", "Walk on"], names())
    cs = po.evaluate("Object.fromEntries(window.__playout.show().items.map(it => [it.n, (window.__playout.cues()[it.id] || []).map(c => c.trigger)]))")
    check("… each with its file as its At the start cue", all(v == ["start"] for v in cs.values()) and len(cs) == 5, cs)

    # the Stream Deck panel: files onto the first empty keys
    before = po.evaluate("window.__playoutDeck.slots(localStorage.playout_board_deck_model || 'mk2')")
    with po.expect_file_chooser() as fc: po.click("#deckaddfiles")
    fc.value.set_files([os.path.join(DIR, "loose", "Sting.wav")]); po.wait_for_timeout(2000)
    model = po.evaluate("localStorage.playout_board_deck_model || 'mk2'")
    after = po.evaluate("window.__playoutDeck.slots('%s')" % model)
    extra = po.evaluate("(window.__playout.cues()['~board'] || []).map(c => c.name)")
    check("Add files to keys…: an extra key, on the first empty key after the items", extra == ["Sting"] and any(str(s).startswith("cue:") for s in after) and after.index(next(s for s in after if str(s).startswith("cue:"))) == len([s for s in before if s]), [before, after, extra])

    # a phone: no folder picker
    m = b.new_context(ignore_https_errors=True, viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                      user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
    m.add_init_script("window.TimerFeatures = { playout: true };"); m.route("**/*", h)
    ph = m.new_page(); ph.on("pageerror", lambda e: errs.append("phone: " + str(e)))
    ph.goto(BASE + "playout.html?soundboard"); ph.wait_for_timeout(1200)
    check("on an iPhone: Add files… only (it can't pick a folder)", ph.is_visible("#sb-addfiles") and not ph.is_visible("#sb-adddir"))
    po.screenshot(path=os.path.join(OUTDIR, "playout_browse.png"))
    b.close()
print("errors:", errs)
