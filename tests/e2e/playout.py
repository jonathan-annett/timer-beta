import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
from _proximity import approve   # the proximity check: type each new device's number on the timer
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
# server: a playout computer (playout.html; a trial: TimerFeatures.playout) pairs by code like the
# overlay, gets the run sheet with its ids, and plays its own cues on this side: at an item's start,
# after a time into it, when its time is up. The timer knows nothing of the cues. Cues are chosen with
# the + sting dialog (sting-picker.js: a file via Browse, a stock sting copied into this browser, a clip
# of one), cut with ✂ (the clip editor); a clip plays from memory (made ready for the item on now and the
# next), to the Show output while previews go to Previews (audio-out.js data-role="both"). Follow the
# timer off: nothing plays by itself, ▶ still does. Back stops what's playing; Esc fades it. A playout
# computer that (re)connects in the middle of an item doesn't replay its start cue. Cues are kept by item
# id (the old per-room lists merged in); cues for items not on the sheet are listed to remove. A cue may
# have its own output (one of Chromium's fake sound cards here), or for a video No sound (its picture,
# with an audio cue starting beside it); cues on the same trigger all play, one video at a time (the
# later one, with no false alarm about the other); a cue whose sound card is gone doesn't play and says
# so. Off, the page says so.
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
SONG = tone(12, 330)
STOCK = {"stings": [{"name": "Stock one", "url": BASE + "media/song.wav", "media": "audio", "duration": 12},
                    {"name": "Stock cut", "url": BASE + "media/song.wav", "media": "audio", "duration": 12, "start": 2, "end": 6, "fadeOut": 300}]}
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        name = u[len(BASE):].split("?")[0].split("#")[0]
        if name == "changelog.html": return route.fulfill(status=404, body=b"")
        if name == "stock-stings.json": return route.fulfill(status=200, body=json.dumps(STOCK), headers={"content-type": "application/json"})
        if name == "media/song.wav": return route.fulfill(status=200, body=SONG, headers={"content-type": "audio/wav"})
        fp = os.path.join(PUBLIC, name)
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

ARGS = ["--no-proxy-server", "--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"]
OUT2 = "Fake Audio Output 2"   # one of Chromium's fake sound cards
UNPLUG = """name => { const real = navigator.mediaDevices.__real || (navigator.mediaDevices.__real = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices));
  navigator.mediaDevices.enumerateDevices = async () => (await real()).filter(d => !name || d.label !== name);
  navigator.mediaDevices.dispatchEvent(new Event('devicechange')); }"""
OLD = {"zz": [{"id": "old1", "name": "From another show", "media": "audio", "trigger": "start", "at": 0}]}   # kept per room before Nov 2026
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

    pc = b.new_context(ignore_https_errors=True, viewport={"width": 1100, "height": 900}, permissions=["microphone"]); pc.route("**/*", h)
    pc.add_init_script("window.TimerFeatures = { playout: true }; if (!localStorage.__s) { localStorage.__s = 1; localStorage.playout_cues_OLDROOM = %s; }" % json.dumps(json.dumps(OLD)))
    po = pc.new_page(); po.on("pageerror", lambda e: errs.append("playout: " + str(e)))
    po.goto(BASE + "playout.html?remote=" + SERVER); po.wait_for_timeout(800)
    po.fill("#code", code); po.wait_for_timeout(3000)
    approve(t); po.wait_for_timeout(2000)
    items = po.evaluate("window.__playout.show().items.map(x => x.id + ':' + x.n)")
    check("the playout computer gets the run sheet with its ids", items == ["a:Keynote", "b:Panel", "c:Quick one", "d:Close"], items)
    dev = t.evaluate("[...window.remoteControl.peers.values()].map(e => e.role + ':' + (e.client || ''))")
    check("to the timer it's a view-only device", dev == ["view:playout"], dev)
    kept = po.evaluate("[Object.keys(window.__playout.cues()), localStorage.playout_cues_OLDROOM === undefined, JSON.parse(localStorage.playout_cues || '{}').zz?.[0]?.id]")
    check("cues kept per room before are merged into the one list, by item id", kept == [["zz"], True, "old1"], kept)
    check("… and listed as for items not on this run sheet", po.is_visible("#orphans") and "1 cue" in po.text_content("#orphantext"), po.text_content("#orphantext"))

    def choose(item, trigger, at):                 # + cue, its trigger, then the + sting dialog
        po.click('#items li[data-id="%s"] button[data-act=add]' % item)
        f = '#items li[data-id="%s"] form.addcue' % item
        po.select_option(f + " [name=trigger]", trigger)
        if at: po.fill(f + " [name=at]", at)
        po.click(f + " button.primary"); po.wait_for_timeout(500)
    def add_file(item, trigger, at, path):
        choose(item, trigger, at)
        po.click(".sting-dlg .sting-tab[data-mode=custom]")
        with po.expect_file_chooser() as fc: po.click("#sting-browse")
        fc.value.set_files(path); po.wait_for_timeout(800)
    add_file("a", "start", None, wav)
    add_file("a", "elapsed", "0:02", wav)
    add_file("b", "start", None, vid)
    add_file("b", "start", None, vid)              # a second video at the same moment
    add_file("b", "start", None, wav)              # and an audio cue beside them
    add_file("c", "end", None, wav)
    # a stock clip (Walk-up sting tab): its ▶ plays to the preview output; Use copies it into this browser
    choose("d", "start", None)
    po.select_option("#sting-stock", "1"); po.click("#sting-prev"); po.wait_for_timeout(600)
    po.screenshot(path=OUTDIR + "/playout_dialog.png")
    roles = po.evaluate("AudioOut.sinks().then(s => s.map(x => x.kind + ':' + x.role))")
    check("the dialog's preview plays to the preview output", "context:preview" in roles and "context:show" not in roles, roles)
    po.click(".sting-dlg .sting-use"); po.wait_for_timeout(1200)
    cues = po.evaluate("window.__playout.cues()")
    check("cues kept on the playout computer", {k: [x["trigger"] for x in v] for k, v in cues.items() if k != "zz"} == {"a": ["start", "elapsed"], "b": ["start", "start", "start"], "c": ["end"], "d": ["start"]}, cues)
    d = cues["d"][0]
    check("a stock clip: copied here with its part", (d["src"], d["start"], d["end"], d["fadeOut"], d["duration"]) == ("stock", 2, 6, 300, 12), d)
    check("… its file in this browser", po.evaluate("window.videoStore.get('pocue:%s').then(b => !!b && b.size > 1000)" % d["id"]))
    po.wait_for_timeout(1500)
    check("… and its loudness measured (levelling)", isinstance(po.evaluate("window.__playout.cues().d[0].lufs"), (int, float)), po.evaluate("window.__playout.cues().d[0]"))
    ids = {k: [x["id"] for x in v] for k, v in cues.items()}
    playing = lambda: po.evaluate("window.__playout.playing()")

    # a cue's own output: the second video without its sound, the audio cue on a sound card of its own
    out = lambda cid: '#items li[data-cue="%s"] select.cout' % cid
    po.select_option(out(ids["b"][1]), label="No sound"); po.wait_for_timeout(300)
    po.select_option(out(ids["b"][2]), label="→ " + OUT2); po.wait_for_timeout(300)
    bc = po.evaluate("window.__playout.cues().b")
    check("a cue's output: kept with the cue (No sound, a sound card)", bc[0].get("out") is None and bc[1].get("out") == "none" and (bc[2].get("out") or {}).get("label") == OUT2, [x.get("out") for x in bc])
    check("… No sound offered for videos only", po.evaluate("[...document.querySelectorAll('%s option')].some(o => o.value === 'none')" % out(ids["b"][2]).replace('"', '\\"')) is False)

    # ✂ on a file cue: the clip editor; saved, the cue plays just that part
    po.click('#items li[data-cue="%s"] button[data-act=edit]' % ids["a"][1]); po.wait_for_timeout(1200)
    po.fill(".sc-t[data-k=start]", "0:01.00"); po.press(".sc-t[data-k=start]", "Tab")
    po.fill(".sc-t[data-k=end]", "4"); po.press(".sc-t[data-k=end]", "Tab")
    po.click(".sc-save"); po.wait_for_timeout(500)
    a1 = po.evaluate("window.__playout.cues().a[1]")
    check("✂: the cue keeps the part (the file isn't cut)", (a1.get("start"), a1.get("end"), a1["trigger"]) == (1, 4, "elapsed"), a1)
    check("… shown on its row", "✂" in po.text_content('#items li[data-cue="%s"] .clen' % ids["a"][1]), po.text_content('#items li[data-cue="%s"] .clen' % ids["a"][1]))

    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(900)
    check("Next: the item's start cue plays", ids["a"][0] in playing(), playing())
    check("… not its time cue yet", ids["a"][1] not in playing(), playing())
    check("… its clip is ready in memory", any(k.startswith(ids["a"][1] + "#") for k in po.evaluate("window.__playout.ready()")), po.evaluate("window.__playout.ready()"))
    t.wait_for_timeout(1800)
    check("after 0:02: the time cue plays", ids["a"][1] in playing(), playing())
    roles = po.evaluate("AudioOut.sinks().then(s => s.map(x => x.kind + ':' + x.role))")
    check("cues play to the show output", "context:show" in roles and "audio:show" in roles, roles)
    po.screenshot(path=OUTDIR + "/playout.png")
    po.keyboard.press("Escape"); po.wait_for_timeout(3600)
    check("Esc fades everything out", playing() == [], playing())

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
    t.wait_for_timeout(500); t.evaluate("window.runsheet.next()"); t.wait_for_timeout(1500)
    pl = playing()
    check("two videos and an audio cue at one start: the audio plays, and the later video", ids["b"][2] in pl and ids["b"][1] in pl and ids["b"][0] not in pl, pl)
    check("… no false alarm about the video it replaced", "didn’t let" not in po.text_content("#status"), po.text_content("#status"))
    check("… that video without its sound", po.evaluate("document.getElementById('vid').volume") == 0, po.evaluate("document.getElementById('vid').volume"))
    roles = po.evaluate("AudioOut.sinks().then(s => s.filter(x => x.kind === 'audio' && x.role.startsWith('out:')).map(x => x.label))")
    check("… the audio cue on its own sound card", OUT2 in roles, roles)
    po.click('#items li[data-cue="%s"] button[data-act=stop]' % ids["b"][2]); po.wait_for_timeout(300)
    po.evaluate(UNPLUG, OUT2); po.wait_for_timeout(500)
    check("its sound card unplugged: the menu says so", "not connected" in po.evaluate("document.querySelector('%s').selectedOptions[0].textContent" % out(ids["b"][2]).replace('"', '\\"')))
    po.click('#items li[data-cue="%s"] button[data-act=fire]' % ids["b"][2]); po.wait_for_timeout(500)
    check("… ▶ doesn't play it (never to another output), and says why", ids["b"][2] not in playing() and po.is_visible("#ao-toast") and "a cue’s own output" in po.text_content("#ao-toast"), [playing(), po.text_content("#ao-toast") if po.is_visible("#ao-toast") else None])
    po.evaluate(UNPLUG, ""); po.wait_for_timeout(500)
    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(1000)
    check("the short item is live", po.evaluate("window.__playout.show().cur") == "c", po.evaluate("window.__playout.show().cur"))
    t.wait_for_timeout(3000)
    check("when its time is up: the end cue plays", ids["c"][0] in playing(), playing())
    check("the next item's clip is ready", any(k.startswith(ids["d"][0] + "#") for k in po.evaluate("window.__playout.ready()")), po.evaluate("window.__playout.ready()"))
    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(700)
    check("the stock clip plays at its item's start", ids["d"][0] in playing(), playing())

    # the cues of items not on the sheet: removed on request
    po.once("dialog", lambda dl: dl.accept())
    po.click("#orphanx"); po.wait_for_timeout(300)
    check("Remove them: the other show's cues go", "zz" not in po.evaluate("window.__playout.cues()") and not po.is_visible("#orphans"), po.evaluate("Object.keys(window.__playout.cues())"))

    # off: the page says so
    oc = b.new_context(ignore_https_errors=True); oc.route("**/*", h)
    o = oc.new_page(); o.goto(BASE + "playout.html"); o.wait_for_timeout(500)
    check("off (not alpha): playout.html says it isn't available", "aren’t available" in o.inner_text("main"), o.inner_text("main")[:80])
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
