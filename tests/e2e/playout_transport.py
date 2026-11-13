import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# The rehearsal transport (the owner, 14 Nov 2026): under the playout page's clock, a badge (folded on every load)
# that opens Pause / Resume, Restart, Last 10 s and a slider for the playing cue that ends last. Both kinds of cue:
# held in memory (a source started again at the offset) and streamed (over 180 s: the element itself). Paused, its
# clock holds; Stop all still ends it; the panel folds when its cue is over.
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
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(4000)
        frame = [struct.pack("<h", int(3000 * math.sin(2 * math.pi * hz * i / 4000))) for i in range(4000)]
        w.writeframes(b"".join(frame) * int(sec))
    return buf.getvalue()
DIR = os.path.join(OUTDIR, "transport_files"); shutil.rmtree(DIR, ignore_errors=True); os.makedirs(DIR)
open(os.path.join(DIR, "A short one.wav"), "wb").write(tone(30))
open(os.path.join(DIR, "B long one.wav"), "wb").write(tone(200, 330))   # (over 180 s: streamed)
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1200, "height": 900})
    c.add_init_script("window.TimerFeatures = { playout: true };")
    c.route("**/*", h)
    po = c.new_page(); po.on("pageerror", lambda e: errs.append("playout: " + str(e)))
    po.on("dialog", lambda d: d.accept())
    po.goto(BASE + "playout.html?soundboard"); po.wait_for_timeout(1200)
    po.set_input_files("#sb-files", [os.path.join(DIR, "A short one.wav"), os.path.join(DIR, "B long one.wav")]); po.wait_for_timeout(4000)
    items = po.evaluate("window.__playout.show().items")
    cue = lambda i: po.evaluate("window.__playout.cues()[%r][0].id" % items[i]["id"])
    tp = lambda: po.evaluate("window.__playout.transport()")
    check("two items, from the files", [x["n"] for x in items] == ["A short one", "B long one"], items)
    check("nothing playing: no transport", not tp()["shown"])
    po.evaluate("(id => { const c = window.__playout.cues()[id][0]; c.start = 0; c.end = 28; })(%r)" % items[0]["id"])   # (a clip: held in memory)
    check("the short one is a clip (held in memory), the long one isn't", po.evaluate("(id => !!window.__playout.cues()[id][0].end)(%r)" % items[0]["id"]))

    for i, kind in ((0, "held in memory"), (1, "streamed")):
        po.evaluate("window.__playout.play(%r)" % cue(i)); po.wait_for_timeout(1500)
        t = tp()
        check(f"[{kind}] playing: the badge under the clock, folded", t["shown"] and not t["open"] and t["id"] == cue(i) and po.is_visible("#tp-badge") and not po.is_visible("#tp-box"), t)
        po.click("#tp-badge"); po.wait_for_timeout(200)
        check(f"[{kind}] the badge opens it, named", tp()["open"] and po.text_content("#tp-name") == items[i]["n"], po.text_content("#tp-name"))
        check(f"[{kind}] … as long as it plays, and played {kind}", abs(tp()["len"] - (28 if i == 0 else 200)) < 0.5 and tp()["memory"] == (i == 0), tp())
        po.click("#tp-pause"); po.wait_for_timeout(300)
        a = tp(); clock = po.text_content("#bc-left"); po.wait_for_timeout(1200); z = tp()
        check(f"[{kind}] ⏸ Pause: held, the clock too", a["paused"] and abs(z["pos"] - a["pos"]) < 0.05 and po.text_content("#bc-left") == clock and po.text_content("#tp-pause") == "▶ Resume", [a, z, clock, po.text_content("#bc-left")])
        po.click("#tp-pause"); po.wait_for_timeout(1200)
        z2 = tp()
        check(f"[{kind}] ▶ Resume: on from there", not z2["paused"] and 0.8 < z2["pos"] - z["pos"] < 1.8, [z["pos"], z2["pos"]])
        po.click("#tp-last"); po.wait_for_timeout(500)
        t = tp()
        check(f"[{kind}] ⏭ Last 10 s", abs((t["len"] - t["pos"]) - 9.5) < 0.8, t)
        left = po.text_content("#bc-left")
        check(f"[{kind}] … the clock follows (0:10 or under)", left in ("0:10", "0:09", "0:08"), left)
        po.click("#tp-restart"); po.wait_for_timeout(500)
        check(f"[{kind}] ⟲ Restart: from the top", tp()["pos"] < 1.0, tp())
        po.evaluate("(() => { const r = document.getElementById('tp-pos'); r.value = '15'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()"); po.wait_for_timeout(400)
        check(f"[{kind}] the slider, let go at 0:15: there", 14.8 < tp()["pos"] < 16, tp())
        po.click("#tp-pause"); po.wait_for_timeout(200)
        po.click("#stopall"); po.wait_for_timeout(500)
        check(f"[{kind}] paused, then ■ Stop all: over, the transport gone and folded", po.evaluate("window.__playout.playing()") == [] and not tp()["shown"] and not tp()["open"], [po.evaluate("window.__playout.playing()"), tp()])

    # ✂ Edit: paused, its file in the clip editor
    po.evaluate("window.__playout.play(%r)" % cue(0)); po.wait_for_timeout(1000)
    po.click("#tp-badge"); po.click("#tp-edit"); po.wait_for_timeout(2500)
    ed = po.evaluate("StingClip.editing() && StingClip.editing().name()")
    check("✂ Edit: it pauses, and its file opens in the clip editor", tp()["paused"] and ed == items[0]["n"] and po.is_visible(".sc-box"), [tp(), ed])
    po.evaluate("StingClip.editing().act('cancel')"); po.wait_for_timeout(300)
    check("… closed again: still paused, to resume", tp()["paused"] and po.evaluate("StingClip.editing()") is None, tp())
    po.click("#stopall"); po.wait_for_timeout(300)

    # a fade while paused ends it at once (nothing to hear), either kind
    for i, kind in ((0, "held in memory"), (1, "streamed")):
        po.evaluate("window.__playout.play(%r)" % cue(i)); po.wait_for_timeout(1000)
        po.click("#tp-badge"); po.click("#tp-pause"); po.wait_for_timeout(200)
        po.click("#fadeall"); po.wait_for_timeout(400)
        check(f"[{kind}] paused, then Fade out: over at once", po.evaluate("window.__playout.playing()") == [], po.evaluate("window.__playout.playing()"))

    # folded again after a reload
    po.evaluate("window.__playout.play(%r)" % cue(0)); po.wait_for_timeout(800)
    po.click("#tp-badge"); po.wait_for_timeout(100)
    po.click("#stopall"); po.reload(); po.wait_for_timeout(1500)
    po.evaluate("window.__playout.play(%r)" % po.evaluate("window.__playout.cues()[window.__playout.show().items[0].id][0].id")); po.wait_for_timeout(1000)
    check("after a reload: folded behind its badge", tp()["shown"] and not tp()["open"], tp())
    po.click("#tp-badge"); po.wait_for_timeout(200)
    po.screenshot(path=os.path.join(OUTDIR, "playout_transport.png"), clip={"x": 760, "y": 0, "width": 440, "height": 260})
    po.click("#stopall")
    b.close()
print("errors:", errs)
