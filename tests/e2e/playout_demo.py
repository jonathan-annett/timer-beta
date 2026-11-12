import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# The playout page's demo (playout.html?demo; /p?demo on the hosted site): no pairing and no timer, ten
# made-up speakers of 20 minutes each, manual only (Follow the timer off and locked). Cues are added and
# played as usual (▶ Start item, ▶), kept apart from a real show's; the names stay over a reload until
# New speakers (the cues stay on their slots); Leave the demo goes back to the pairing screen, which
# offers Try the demo.
import io, json, math, mimetypes, os, struct, sys, wave
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
def tone(seconds, hz=440):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * hz * i / 16000))) for i in range(int(16000 * seconds))))
    return buf.getvalue()
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        name = u[len(BASE):].split("?")[0].split("#")[0]
        if name in ("changelog.html", "stock-stings.json"): return route.fulfill(status=404, body=b"")
        fp = os.path.join(PUBLIC, name)
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()   # (no pairing server: a demo needs none)
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

ARGS = ["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"]
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    wav = os.path.join(OUTDIR, "po_demo_tone.wav"); open(wav, "wb").write(tone(6))
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1100, "height": 900})
    c.add_init_script("window.TimerFeatures = { playout: true };" +
      "if (!localStorage.__s) { localStorage.__s = 1; localStorage.playout_cues = JSON.stringify({ real1: [{ id: 'r1', name: 'A real cue', media: 'audio', src: 'file', trigger: 'start', at: 0 }] }); }")
    c.route("**/*", h)
    po = c.new_page(); po.on("pageerror", lambda e: errs.append("playout: " + str(e)))

    # the pairing screen offers the demo
    po.goto(BASE + "playout.html"); po.wait_for_timeout(600)
    check("the pairing screen offers Try the demo", po.is_visible("#enter") and po.is_visible("#trydemo"))
    po.click("#trydemo"); po.wait_for_timeout(1200)
    check("Try the demo: playout.html?demo, no pairing code asked", "?demo" in po.url and not po.is_visible("#enter") and po.is_visible("#demobar"), po.url)
    show = po.evaluate("window.__playout.show()")
    names = [x["n"] for x in show["items"]]
    check("ten made-up speakers, 20 minutes each", len(show["items"]) == 10 and all(x["d"] == 1200 for x in show["items"]) and len(set(names)) == 10, names)
    check("… listed with their 20:00", po.locator("#items > li .idur").all_text_contents() == ["20:00"] * 10, po.locator("#items > li .idur").all_text_contents())
    check("manual only: Follow the timer off and locked", not po.is_checked("#follow") and po.is_disabled("#follow"))
    check("… and it says it's a demo, with no timer", "Demo" in po.text_content("#status") and not po.is_visible("#pairline"), po.text_content("#status"))

    # a cue, added as usual; ▶ Start item plays it
    po.click('#items li[data-id="demo-1"] button[data-act=add]')
    po.click('#items li[data-id="demo-1"] form.addcue button.primary'); po.wait_for_timeout(500)
    po.click(".sting-dlg .sting-tab[data-mode=custom]")
    with po.expect_file_chooser() as fc: po.click("#sting-browse")
    fc.value.set_files(wav); po.wait_for_timeout(1000)
    cues = po.evaluate("window.__playout.cues()")
    check("a cue added to the first speaker", [x["name"] for x in cues.get("demo-1", [])] == ["po_demo_tone"], cues)
    check("… the status still says Demo (no Reconnecting…)", "Demo" in po.text_content("#status"), po.text_content("#status"))
    check("… kept apart from the real show's cues", json.loads(po.evaluate("localStorage.playout_cues"))["real1"][0]["id"] == "r1" and "demo-1" in json.loads(po.evaluate("localStorage.playout_demo_cues")) and "real1" not in cues, po.evaluate("Object.keys(window.__playout.cues())"))
    check("… and the real ones aren't shown as left over", not po.is_visible("#orphans"))
    cid = cues["demo-1"][0]["id"]
    po.click('#items li[data-id="demo-1"] button[data-act=run]'); po.wait_for_timeout(600)
    check("▶ Start item: the speaker's cue plays, the item counts down here", cid in po.evaluate("window.__playout.playing()") and "left" in po.text_content('#items li[data-id="demo-1"] .ilocal'), po.text_content('#items li[data-id="demo-1"] .ilocal'))
    po.screenshot(path=OUTDIR + "/playout_demo.png")
    po.click("#stopall"); po.wait_for_timeout(300)

    # the names stay over a reload; New speakers changes them, the cues stay on their slots
    po.reload(); po.wait_for_timeout(1200)
    again = [x["n"] for x in po.evaluate("window.__playout.show().items")]
    check("a reload: the same speakers, the cue still there", again == names and po.evaluate("window.__playout.cues()['demo-1'][0].id") == cid, again)
    po.click("#demonames"); po.wait_for_timeout(300)
    fresh = [x["n"] for x in po.evaluate("window.__playout.show().items")]
    check("New speakers: other names, the first slot's cue kept", fresh != names and len(set(fresh)) == 10 and po.evaluate("window.__playout.cues()['demo-1'][0].id") == cid, fresh)

    # leaving: back to the pairing screen, the real cues untouched
    po.click("#demoleave"); po.wait_for_timeout(1000)
    check("Leave the demo: the pairing screen again", "?demo" not in po.url and po.is_visible("#enter"), po.url)
    check("… the real show's cues as they were", list(json.loads(po.evaluate("localStorage.playout_cues")).keys()) == ["real1"])
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
