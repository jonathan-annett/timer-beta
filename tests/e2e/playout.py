import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
from _proximity import approve   # the proximity check: type each new device's number on the timer
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
# server: a playout computer (playout.html; a trial: TimerFeatures.playout) pairs by code like the
# overlay, gets the run sheet with its ids, and plays its own cues on this side: at an item's start,
# after a time into it, when its time is up. The timer knows nothing of the cues. Follow the timer
# off: nothing plays by itself, ▶ still does. Back stops what's playing. A playout computer that
# (re)connects in the middle of an item doesn't replay its start cue. Off, the page says so.
import io, json, math, mimetypes, os, struct, sys, wave
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
SHEET = {"title": "Show", "perItem": 20, "items": [
    {"id": "a", "name": "Keynote", "start": None, "duration": 600},
    {"id": "b", "name": "Panel", "start": None, "duration": 300},
    {"id": "c", "name": "Quick one", "start": None, "duration": 3},
    {"id": "d", "name": "Close", "start": None, "duration": 120}]}
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
        if name == "changelog.html": return route.fulfill(status=404, body=b"")
        fp = os.path.join(PUBLIC, name)
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

ARGS = ["--no-proxy-server", "--autoplay-policy=no-user-gesture-required", "--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"]
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    wav = os.path.join(OUTDIR, "po_tone.wav"); open(wav, "wb").write(tone(8))
    mk = b.new_page()
    import base64
    vid_b64 = mk.evaluate("""() => new Promise(res => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d');
      const rec = new MediaRecorder(c.captureStream(25), { mimeType: 'video/webm' }); const parts = [];
      rec.ondataavailable = e => parts.push(e.data);
      rec.onstop = () => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(new Blob(parts, { type: 'video/webm' })); };
      let n = 0; const iv = setInterval(() => { g.fillStyle = n++ % 2 ? '#c00' : '#00c'; g.fillRect(0, 0, 160, 90); }, 40);
      rec.start(); setTimeout(() => { clearInterval(iv); rec.stop(); }, 3000);
    })""")
    mk.close()
    vid = os.path.join(OUTDIR, "po_clip.webm"); open(vid, "wb").write(base64.b64decode(vid_b64))

    c = b.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 800})
    c.add_init_script("window.TimerFeatures = { playout: true };" +
      "if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';localStorage.runsheet=%s}" % json.dumps(json.dumps(SHEET)))
    c.route("**/*", h)
    t = c.new_page(); t.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    t.goto(BASE + "timer.html?remote=" + SERVER); t.wait_for_timeout(1500)
    t.click("#btnshare"); t.wait_for_timeout(1500)
    t.click("#phone-panel .pp-pair"); t.wait_for_timeout(800)
    code = t.text_content("#phone-panel .pp-digits").replace(" ", "")

    pc = b.new_context(ignore_https_errors=True, viewport={"width": 1100, "height": 900}); pc.route("**/*", h)
    pc.add_init_script("window.TimerFeatures = { playout: true }")
    po = pc.new_page(); po.on("pageerror", lambda e: errs.append("playout: " + str(e)))
    po.goto(BASE + "playout.html?remote=" + SERVER); po.wait_for_timeout(800)
    po.fill("#code", code); po.wait_for_timeout(3000)
    approve(t); po.wait_for_timeout(2000)
    items = po.evaluate("window.__playout.show().items.map(x => x.id + ':' + x.n)")
    check("the playout computer gets the run sheet with its ids", items == ["a:Keynote", "b:Panel", "c:Quick one", "d:Close"], items)
    dev = t.evaluate("[...window.remoteControl.peers.values()].map(e => e.role + ':' + (e.client || ''))")
    check("to the timer it's a view-only device", dev == ["view:playout"], dev)

    def add_cue(item, trigger, at, path):
        po.click('#items li[data-id="%s"] button[data-act=add]' % item)
        f = '#items li[data-id="%s"] form.addcue' % item
        po.select_option(f + " [name=trigger]", trigger)
        if at: po.fill(f + " [name=at]", at)
        po.set_input_files(f + " [name=file]", path)
        po.click(f + " button.primary"); po.wait_for_timeout(500)
    add_cue("a", "start", None, wav)
    add_cue("a", "elapsed", "0:02", wav)
    add_cue("b", "start", None, vid)
    add_cue("c", "end", None, wav)
    cues = po.evaluate("window.__playout.cues()")
    check("cues kept on the playout computer", {k: [x["trigger"] for x in v] for k, v in cues.items()} == {"a": ["start", "elapsed"], "b": ["start"], "c": ["end"]}, cues)
    ids = {k: [x["id"] for x in v] for k, v in cues.items()}
    playing = lambda: po.evaluate("window.__playout.playing()")

    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(900)
    check("Next: the item's start cue plays", ids["a"][0] in playing(), playing())
    check("… not its time cue yet", ids["a"][1] not in playing(), playing())
    t.wait_for_timeout(1800)
    check("after 0:02: the time cue plays", ids["a"][1] in playing(), playing())
    po.screenshot(path=OUTDIR + "/playout.png")

    # a reload in the middle of the item: the start cue doesn't play again
    po.reload(); po.wait_for_timeout(3500)
    check("reconnected mid-item: the start cue isn't replayed", playing() == [], playing())

    # Follow off: Next plays nothing; ▶ does
    po.uncheck("#follow")
    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(1200)
    check("follow off: nothing plays by itself", playing() == [], playing())
    po.click('#items li[data-cue="%s"] button[data-act=fire]' % ids["b"][0]); po.wait_for_timeout(800)
    check("▶ plays it anyway (a video, on the output)", ids["b"][0] in playing() and po.evaluate("!document.getElementById('vid').paused"), playing())
    po.check("#follow")

    # Back stops everything
    t.evaluate("window.runsheet.back()"); t.wait_for_timeout(800)
    check("Back stops what's playing", playing() == [], playing())

    # time's up
    t.wait_for_timeout(500); t.evaluate("window.runsheet.next()"); t.wait_for_timeout(800)
    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(1000)
    check("the short item is live", po.evaluate("window.__playout.show().cur") == "c", po.evaluate("window.__playout.show().cur"))
    t.wait_for_timeout(3000)
    check("when its time is up: the end cue plays", ids["c"][0] in playing(), playing())

    # off: the page says so
    oc = b.new_context(ignore_https_errors=True); oc.route("**/*", h)
    o = oc.new_page(); o.goto(BASE + "playout.html"); o.wait_for_timeout(500)
    check("off (not alpha): playout.html says it isn't available", "aren’t available" in o.inner_text("main"), o.inner_text("main")[:80])
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
