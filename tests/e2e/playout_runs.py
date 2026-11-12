import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Several items at once on the playout page (Follow off; on the demo): an item started with ▶ Start item
# keeps a green ■ Stop item while its cues play, even after its run ends or another item starts. With
# another started since, it flashes (and its playing cues' ■ with it, enabled whatever the option says);
# pressing it stops that item only; left alone it plays to its end and goes back to ▶ Start item.
import mimetypes, os, sys
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
SETUP = """async () => {                     // three speakers: a tone each at the start (6 s, 6 s, 3 s)
  const wav = sec => { const sr = 16000, n = sr * sec, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / sr) * 8000, true);
    return new Blob([b], { type: 'audio/wav' }); };
  const cues = {};
  [6, 6, 3].forEach((sec, k) => { cues['demo-' + (k + 1)] = [{ id: 'c' + (k + 1), name: 'Tone ' + (k + 1), media: 'audio', src: 'file', trigger: 'start', at: 0, duration: sec }]; });
  for (const [k, sec] of [[1, 6], [2, 6], [3, 3]]) await videoStore.put('pocue:c' + k, wav(sec));
  localStorage.playout_demo_cues = JSON.stringify(cues);
}"""
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        name = u[len(BASE):].split("?")[0].split("#")[0]
        if name in ("changelog.html", "stock-stings.json"): return route.fulfill(status=404, body=b"")
        fp = os.path.join(PUBLIC, name)
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1100, "height": 900})
    c.add_init_script("window.TimerFeatures = { playout: true };")
    c.route("**/*", h)
    po = c.new_page(); po.on("pageerror", lambda e: errs.append("playout: " + str(e)))
    po.goto(BASE + "playout.html?demo"); po.wait_for_timeout(800)
    po.evaluate(SETUP); po.reload(); po.wait_for_timeout(1200)
    playing = lambda: sorted(po.evaluate("window.__playout.playing()"))
    item = lambda i: '#items li[data-id="demo-%d"]' % i
    run = lambda i: item(i) + " .ihead button[data-act=run], " + item(i) + " .ihead button[data-act=endrun]"
    btn = lambda i: po.evaluate("s => { const b = document.querySelector(s); return b && { text: b.textContent, cls: b.className, disabled: b.disabled }; }", run(i))
    cue = lambda i: po.evaluate("s => { const b = document.querySelector(s); return b && { text: b.textContent, cls: b.className, disabled: b.disabled }; }", item(i) + " .cues button[data-act=stop], " + item(i) + " .cues button[data-act=fire]")
    ok_green = lambda x: x and x["text"] == "■ Stop item" and "runon" in x["cls"]

    po.click(run(1)); po.wait_for_timeout(500)
    check("▶ Start item: its cue plays, the button is ■ Stop item, green", playing() == ["c1"] and ok_green(btn(1)) and "superseded" not in btn(1)["cls"], btn(1))
    check("… green as a playing cue's output menu", po.evaluate("s => getComputedStyle(document.querySelector(s)).color", run(1)) == po.evaluate("getComputedStyle(document.querySelector('#items .cues li.playing .fname')).color"))
    check("… its own cue's ■ locked (the run has it; the option is off)", cue(1)["disabled"] and "superseded" not in cue(1)["cls"], cue(1))

    po.click(run(2)); po.wait_for_timeout(500)
    check("another item started: both play", playing() == ["c1", "c2"], playing())
    check("… the first keeps ■ Stop item, green and flashing", ok_green(btn(1)) and "superseded" in btn(1)["cls"] and po.evaluate("s => getComputedStyle(document.querySelector(s)).animationName", run(1)) == "po-flash", btn(1))
    check("… its playing cue's ■ enabled and flashing with it", cue(1)["text"] == "■" and not cue(1)["disabled"] and "superseded" in cue(1)["cls"], cue(1))
    check("… the new one steady green, its cue locked as usual", ok_green(btn(2)) and "superseded" not in btn(2)["cls"] and cue(2)["disabled"], [btn(2), cue(2)])
    check("… flashing in step (rebuilt together: one animation start)", po.evaluate("[...document.querySelectorAll('#items button.superseded')].map(b => b.getAnimations()[0].startTime).every((t, i, a) => t === a[0])"))
    po.screenshot(path=OUTDIR + "/playout_runs.png")

    po.click(run(1)); po.wait_for_timeout(300)
    check("■ Stop item on the flashing one: that item stops, the other plays on", playing() == ["c2"] and (po.evaluate("window.__playout.local()") or {}).get("item") == "demo-2", [playing(), po.evaluate("window.__playout.local()")])
    check("… it's back to ▶ Start item; the other's no longer flashes", btn(1)["text"].startswith("▶") and po.locator("#items button.superseded").count() == 0)

    # left alone: it plays to its end
    po.click(run(3)); po.wait_for_timeout(500)
    check("a third item over the second: the second flashes", "superseded" in btn(2)["cls"] and ok_green(btn(3)) and "superseded" not in btn(3)["cls"])
    po.wait_for_timeout(3200)
    check("the newest's cue ends (3 s): its run goes on (its countdown), the older still flashes", playing() == ["c2"] and ok_green(btn(3)) and "superseded" in btn(2)["cls"], [playing(), btn(2), btn(3)])
    po.wait_for_timeout(2600)
    check("… the older one left alone plays to its end: ▶ Start item again", playing() == [] and btn(2)["text"].startswith("▶") and po.evaluate("window.__playout.active()") == ["demo-3"], [playing(), btn(2), po.evaluate("window.__playout.active()")])
    po.click(run(3)); po.wait_for_timeout(300)
    check("■ Stop item on the running one: nothing left running", btn(3)["text"].startswith("▶") and po.evaluate("window.__playout.active()") == [] and po.evaluate("window.__playout.local()") is None)

    # a run that ends (its planned length) with its cue still playing: still ■ Stop item, steady
    po.evaluate("() => { const s = window.__playout.show(); s.items.find(x => x.id === 'demo-1').d = 1; }")
    po.click(run(1)); po.wait_for_timeout(1800)
    check("its run over (1 s) with the cue still playing: ■ Stop item, steady green", po.evaluate("window.__playout.local()") is None and playing() == ["c1"] and ok_green(btn(1)) and "superseded" not in btn(1)["cls"], [po.evaluate("window.__playout.local()"), playing(), btn(1)])
    check("… its cue's ■ free (the run's over)", cue(1)["text"] == "■" and not cue(1)["disabled"], cue(1))
    po.click(run(1)); po.wait_for_timeout(300)
    check("… ■ Stop item stops it", playing() == [] and btn(1)["text"].startswith("▶"))
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
