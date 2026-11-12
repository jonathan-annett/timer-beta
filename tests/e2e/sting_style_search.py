import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Music styles in use (a trial, TimerFeatures.styles): stock stings carry their top styles (stock-stings.json;
# a clip borrows its song's). The + sting dialog (sting-picker.js) shows each one's top style and searches
# them ("rock": the stings in it, best first, with the style they matched), with the model's credit; Random
# stings (sting-roll.js) pick only songs in the style typed, the panel saying how many there are. On the
# playout demo (the dialog behind + cue, and its Random stings), and the run sheet editor's panel. No model
# needed: the styles come with the list.
import io, json, math, mimetypes, os, re, struct, sys, wave
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
LABELS = json.loads(re.search(r"const LABELS = (\[.*?\]);", open(os.path.join(PUBLIC, "sting-styles.js"), encoding="utf-8").read()).group(1))
L = LABELS.index
U = lambda n: BASE + "media/" + n + ".wav"
LENS = {"s1": 8, "s2": 9, "s3": 10, "s4": 11, "s5": 12, "s6": 13}
STYLES = {"s1": [[L("Rock---Hard Rock"), 0.5], [L("Rock---Arena Rock"), 0.3]],
          "s2": [[L("Electronic---House"), 0.3], [L("Electronic---Deep House"), 0.2]],
          "s3": [[L("Funk / Soul---Disco"), 0.4], [L("Electronic---Disco"), 0.25]],
          "s4": [[L("Jazz---Smooth Jazz"), 0.06]],                       # (under the floor: no style shown)
          "s5": [[L("Rock---Punk"), 0.12], [L("Rock---Pop Punk"), 0.1]]}  # s6: none at all
STOCK = {"styleModel": "discogs-effnet-bsdynamic-1", "stings": [dict({"name": n.upper(), "url": U(n), "media": "audio", "duration": d}, **({"styles": STYLES[n]} if n in STYLES else {})) for n, d in LENS.items()]
         + [{"name": "S1 cut", "url": U("s1"), "media": "audio", "duration": 8, "start": 1, "end": 5}]}   # a clip: its song's styles
def tone(seconds, hz):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * hz * i / 8000))) for i in range(int(8000 * seconds))))
    return buf.getvalue()
def h(route, req):
    u = req.url
    if not u.startswith(BASE): return route.abort()
    name = u[len(BASE):].split("?")[0].split("#")[0]
    if name == "stock-stings.json": return route.fulfill(status=200, body=json.dumps(STOCK), headers={"content-type": "application/json"})
    if name == "changelog.html": return route.fulfill(status=404, body=b"")
    n = name[6:-4] if name.startswith("media/") and name.endswith(".wav") else None
    if n in LENS: return route.fulfill(status=200, body=tone(LENS[n], 300 + 50 * int(n[1:])), headers={"content-type": "audio/wav"})
    fp = os.path.join(PUBLIC, name)
    if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
    return route.fulfill(status=404, body=b"")
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1100, "height": 1000})
    c.add_init_script("window.TimerFeatures = { playout: true, stings: true, styles: !localStorage.__nostyles };")
    c.route("**/*", h)
    po = c.new_page(); po.on("pageerror", lambda e: errs.append("playout: " + str(e)))
    po.goto(BASE + "playout.html?demo"); po.wait_for_timeout(1000)
    opts = lambda: po.evaluate("[...document.querySelectorAll('#sting-stock option')].map(o => o.textContent)")
    def dialog():
        po.click('#items li[data-id="demo-1"] button[data-act=add]')
        po.click('#items li[data-id="demo-1"] form.addcue button.primary'); po.wait_for_timeout(600)

    # the + sting dialog
    dialog()
    o = opts()
    check("the dialog: a style search box, and the model's credit", po.is_visible("#sting-style") and "Music Technology Group" in po.text_content(".sting-credit"))
    check("each stock sting with its top style (none under the floor; the genre where a name is under two)",
          o == ["S1 · 8 s · Hard Rock", "S2 · 9 s · House", "S3 · 10 s · Disco (Funk / Soul)", "S4 · 11 s", "S5 · 12 s · Punk", "S6 · 13 s", "S1 cut · 4 s · Hard Rock"], o)
    po.fill("#sting-style", "rock"); po.wait_for_timeout(200)
    check("“rock”: the stings in it, best first, with the style they matched (a clip borrows its song's)", opts() == ["S1 · 8 s · Hard Rock", "S1 cut · 4 s · Hard Rock", "S5 · 12 s · Punk"], opts())
    po.fill("#sting-style", "pop punk"); po.wait_for_timeout(200)
    check("“pop punk”: every word in the style's name", opts() == ["S5 · 12 s · Pop Punk"], opts())
    po.fill("#sting-style", "disco"); po.wait_for_timeout(200)
    check("“disco”: the stronger of a name under two genres", opts() == ["S3 · 10 s · Disco (Funk / Soul)"], opts())
    po.fill("#sting-style", "jazz"); po.wait_for_timeout(200)
    check("“jazz”: a sting under the floor isn't in it; it says so", opts() == [] and po.is_visible("#sting-none") and "No stock sting in that style" in po.text_content("#sting-none") and po.is_disabled(".sting-use"), po.text_content("#sting-none"))
    po.fill("#sting-style", ""); po.wait_for_timeout(200)
    check("cleared: all of them again", len(opts()) == 7)
    po.fill("#sting-style", "house"); po.wait_for_timeout(200)
    po.screenshot(path=OUTDIR + "/sting_style_search.png")
    po.click(".sting-dlg .sting-cancel"); po.wait_for_timeout(300)

    # Random stings in a style
    po.click("#rollpanel summary"); po.wait_for_timeout(300)
    check("Random stings: an In the style box", po.is_visible("#roll-style"))
    po.uncheck("#roll-mine"); po.uncheck("#roll-folder")
    po.fill("#roll-style", "rock"); po.press("#roll-style", "Tab"); po.wait_for_timeout(400)
    check("… how many stock stings are in it", po.text_content("#roll-stylehint") == "2 stock stings in it", po.text_content("#roll-stylehint"))
    check("… kept", json.loads(po.evaluate("localStorage.playout_roll"))["style"] == "rock")
    po.check("#roll-mine"); po.wait_for_timeout(300)
    check("… with My clips ticked: files of your own are left out", "aren’t tagged yet" in po.text_content("#roll-stylehint"), po.text_content("#roll-stylehint"))
    po.click("#roll-all"); po.wait_for_timeout(4000)
    songs = po.evaluate("Object.values(window.__playout.cues()).flat().filter(c => c.rolled).map(c => c.song)")
    check("🎲 Roll stings in “rock”: only rock songs (two for ten speakers)", sorted(songs) == sorted(["url:" + U("s1"), "url:" + U("s5")]), songs)
    check("… the message: the rest weren't, in that style", "in that style" in po.text_content("#roll-msg"), po.text_content("#roll-msg"))
    po.fill("#roll-style", "polka"); po.press("#roll-style", "Tab"); po.wait_for_timeout(300)
    check("… a style nothing's in: it says so", "no stock sting in it" in po.text_content("#roll-stylehint"), po.text_content("#roll-stylehint"))
    po.fill("#roll-style", ""); po.press("#roll-style", "Tab"); po.wait_for_timeout(300)

    # without the trial: no search, no style
    po.evaluate("localStorage.__nostyles = 1"); po.reload(); po.wait_for_timeout(1000)
    dialog()
    o = opts()
    check("without the trial: no search box, no styles on the list", not po.is_visible("#sting-style") and po.locator(".sting-credit").count() == 0 and o[0] == "S1 · 8 s", o)
    po.click(".sting-dlg .sting-cancel")
    check("… nor in Random stings", not po.is_visible("#roll-stylerow"))
    po.evaluate("delete localStorage.__nostyles")

    # the run sheet editor's panel
    ed = c.new_page(); ed.on("pageerror", lambda e: errs.append("editor: " + str(e)))
    ed.goto(BASE + "runsheet.html"); ed.wait_for_timeout(1000)
    ed.evaluate("document.getElementById('rollpanel').open = true"); ed.wait_for_timeout(200)
    ed.fill("#roll-style", "house"); ed.wait_for_timeout(400)
    check("the run sheet editor: its Random stings have the style too", ed.is_visible("#roll-style") and ed.text_content("#roll-stylehint").startswith("1 stock sting in it"), ed.text_content("#roll-stylehint"))
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
