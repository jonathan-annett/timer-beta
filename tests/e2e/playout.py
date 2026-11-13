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
# timer off: nothing plays by itself, ▶ still does, ▶ Start item runs an item's cues timed from the press
# (the timer's Back leaves them alone); ✎ changes when a cue plays. Back stops what's playing; Esc fades it. A playout
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
    check("… its output menu locked while it plays (marked in use)", po.is_disabled(out(ids["b"][2])) and "busy" in po.get_attribute(out(ids["b"][2]), "class"), po.get_attribute(out(ids["b"][2]), "class"))
    po.click('#items li[data-cue="%s"] button[data-act=stop]' % ids["b"][2]); po.wait_for_timeout(300)
    check("… and free again once it stops", not po.is_disabled(out(ids["b"][2])))
    po.evaluate(UNPLUG, OUT2); po.wait_for_timeout(500)
    check("its sound card unplugged: the menu says so", "not connected" in po.evaluate("document.querySelector('%s').selectedOptions[0].textContent" % out(ids["b"][2]).replace('"', '\\"')))
    po.click('#items li[data-cue="%s"] button[data-act=fire]' % ids["b"][2]); po.wait_for_timeout(500)
    check("… ▶ doesn't play it (never to another output), and says why", ids["b"][2] not in playing() and po.is_visible("#ao-toast") and "a cue’s own output" in po.text_content("#ao-toast"), [playing(), po.text_content("#ao-toast") if po.is_visible("#ao-toast") else None])
    po.evaluate(UNPLUG, ""); po.wait_for_timeout(500)
    ibox = '#items li[data-id="c"] form.iedit textarea'   # ✎ on an item: this computer's own text for it (playout_names.py has the rest)
    po.click('#items li[data-id="c"] button[data-act=name]'); po.fill(ibox, "Short one\nmic 3"); po.focus(ibox); po.keyboard.press("Control+Enter"); po.wait_for_timeout(200)
    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(1000)
    check("the short item is live", po.evaluate("window.__playout.show().cur") == "c", po.evaluate("window.__playout.show().cur"))
    check("… the status line names it as this computer does (✎)", po.text_content("#now").startswith("Now: Short one ·"), po.text_content("#now"))
    # the Stream Deck soundboard (playout_deck.py has the rest), following the timer: it shows, the timer starts
    df = po.evaluate("window.__playoutDeck.faces('mk2')")
    import re as _re
    bg = po.evaluate("window.__playoutDeck.bgs('mk2')"); ci = [x.split(" | ")[0] for x in df].index("Short one") if any(x.startswith("Short one") for x in df) else -1
    check("Follow on: the deck shows the live item (blue), named as here, with when it started", ci >= 0 and bg[ci] == "#0b3d5c" and _re.match(r"Short one \| \d\d:\d\d$", df[ci]), [df, bg])
    nx = [x for x in df if x.startswith("Close")]
    check("… the next item's key: its planned start on top", nx and _re.match(r"Close \| (≈ )?\d\d:\d\d$", nx[0]), nx)
    st = po.evaluate("[...document.querySelectorAll('#items > li .istart')].map(e => e.textContent)")
    check("… and the run sheet's rows: their starts", len(st) == 4 and all(_re.match(r"(≈ )?\d\d:\d\d$", t) for t in st), st)
    dk = po.evaluate("window.__playoutDeck.slots('mk2').indexOf('d')"); was = playing()
    po.evaluate("i => { window.__playoutDeck.screen(i, true); window.__playoutDeck.screen(i, false); }", dk); po.wait_for_timeout(300)
    check("… a press on another item doesn't start it (the timer does)", po.evaluate("window.__playout.local()") is None and playing() == was, [po.evaluate("window.__playout.local()"), playing()])
    t.wait_for_timeout(3000)
    check("when its time is up: the end cue plays", ids["c"][0] in playing(), playing())
    check("the next item's clip is ready", any(k.startswith(ids["d"][0] + "#") for k in po.evaluate("window.__playout.ready()")), po.evaluate("window.__playout.ready()"))
    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(700)
    check("the stock clip plays at its item's start", ids["d"][0] in playing(), playing())

    # the cues of items not on the sheet: removed on request
    po.once("dialog", lambda dl: dl.accept())
    po.click("#orphanx"); po.wait_for_timeout(300)
    check("Remove them: the other show's cues go", "zz" not in po.evaluate("window.__playout.cues()") and not po.is_visible("#orphans"), po.evaluate("Object.keys(window.__playout.cues())"))

    # ✎: when a cue plays, changed (the sound stays)
    po.click("#stopall"); po.wait_for_timeout(300)
    po.click('#items li[data-cue="%s"] button[data-act=when]' % ids["c"][0]); po.wait_for_timeout(200)
    f = '#items li[data-cue="%s"] form.addcue' % ids["c"][0]
    check("✎: its timing to change, starting from the cue's own", po.input_value(f + " [name=trigger]") == "end" and not po.is_visible(f + " [name=at]"), po.input_value(f + " [name=trigger]"))
    po.select_option(f + " [name=trigger]", "elapsed"); po.fill(f + " [name=at]", "0:01"); po.click(f + " button.primary"); po.wait_for_timeout(300)
    c0 = po.evaluate("window.__playout.cues().c[0]")
    check("… saved: after 0:01, the same file", (c0["trigger"], c0["at"], c0["id"]) == ("elapsed", 1, ids["c"][0]), c0)
    check("… and shown so", "After 0:01" in po.text_content('#items li[data-cue="%s"] .when' % ids["c"][0]), po.text_content('#items li[data-cue="%s"] .when' % ids["c"][0]))

    # Follow off: ▶ Start item runs an item's cues here, timed from the press (rehearsals: any order)
    po.uncheck("#follow"); po.wait_for_timeout(200)
    check("follow off: each item with cues offers ▶ Start item", po.is_visible('#items li[data-id="c"] button[data-act=run]') and po.is_visible('#items li[data-id="a"] button[data-act=run]'))
    po.click('#items li[data-id="c"] button[data-act=run]'); po.wait_for_timeout(400)
    check("▶ Start item: the item runs here", (po.evaluate("window.__playout.local()") or {}).get("item") == "c" and "here" in po.text_content('#items li[data-id="c"] .ilocal'), po.evaluate("window.__playout.local()"))
    check("… its time cue not yet", ids["c"][0] not in playing(), playing())
    fire_c = '#items li[data-cue="%s"] button[data-act=fire]' % ids["c"][0]
    check("… its cues' ▶ locked while it runs (other items' cues free)", po.is_disabled(fire_c) and not po.is_disabled('#items li[data-cue="%s"] button[data-act=fire]' % ids["a"][0]), po.get_attribute(fire_c, "title"))
    po.check("#cuectl"); po.wait_for_timeout(100)
    check("Options → single cues of an item started here: free at once, mid-run", not po.is_disabled(fire_c))
    po.uncheck("#cuectl"); po.wait_for_timeout(100)
    check("… off again (the default): locked at once", po.is_disabled(fire_c))
    po.wait_for_timeout(700)
    check("… 0:01 after the press (this computer's clock), it plays", ids["c"][0] in playing(), playing())
    po.click('#items li[data-id="a"] button[data-act=run]'); po.wait_for_timeout(500)
    check("another item started: its start cue plays at once, the last one's plays on", ids["a"][0] in playing() and ids["c"][0] in playing(), playing())
    check("… the run is that item's now", (po.evaluate("window.__playout.local()") or {}).get("item") == "a", po.evaluate("window.__playout.local()"))
    po.wait_for_timeout(2000)
    check("… its time cue 0:02 after the press", ids["a"][1] in playing(), playing())
    t.evaluate("window.runsheet.back()"); t.wait_for_timeout(800)
    check("follow off: Back on the timer leaves what's playing here alone", ids["a"][0] in playing(), playing())
    po.click('#items li[data-id="a"] button[data-act=endrun]'); po.wait_for_timeout(300)
    check("■ Stop item: its cues stop, the run ends", not any(x in playing() for x in ids["a"]) and po.evaluate("window.__playout.local()") is None, [playing(), po.evaluate("window.__playout.local()")])
    po.click("#stopall"); po.check("#follow"); po.wait_for_timeout(200)
    check("follow on: no ▶ Start item", not po.is_visible('#items button[data-act=run]'))

    # To external monitor: a floating window for the audience's screen; video cues play there
    vstate = lambda: po.evaluate("window.__playout.video()")
    po.click('#items li[data-cue="%s"] button[data-act=fire]' % ids["b"][0]); po.wait_for_timeout(500)
    check("no window yet: To external monitor is off while a video plays here (set up with nothing playing)", po.is_disabled("#ext"), po.get_attribute("#ext", "title"))
    po.click('#items li[data-cue="%s"] button[data-act=stop]' % ids["b"][0]); po.wait_for_timeout(300)
    check("… on once it stops", not po.is_disabled("#ext"))
    with po.expect_popup() as xp: po.click("#ext")
    xw = xp.value; po.wait_for_timeout(300)
    check("To external monitor: a floating window, with the video element in it", vstate()["where"] == "external" and xw.evaluate("!!document.querySelector('#xstage video')"), vstate())
    check("… here: External playback activated, Play here instead, no full screen", po.is_visible("#stage .extnote") and po.text_content("#ext") == "Play here instead" and po.is_disabled("#full"), po.text_content("#ext"))
    po.click('#items li[data-cue="%s"] button[data-act=fire]' % ids["b"][0]); po.wait_for_timeout(800)
    check("a video cue plays in the floating window", vstate()["where"] == "external" and not vstate()["paused"] and vstate()["src"], vstate())
    check("… Play here instead is off while it plays there", po.is_disabled("#ext"))
    po.click('#items li[data-cue="%s"] button[data-act=stop]' % ids["b"][0]); po.wait_for_timeout(300)
    check("… on again once it stops", not po.is_disabled("#ext"))
    po.click("#ext"); po.wait_for_timeout(300)
    check("Play here instead: back in the Output box, the window left open and black", vstate()["where"] == "here" and not xw.is_closed() and xw.evaluate("!document.querySelector('#xstage video')") and po.text_content("#ext") == "To external monitor", vstate())
    # an item started here playing its video in the Output box, not out there: the button flashes
    flashing = lambda: "flash" in (po.get_attribute("#ext", "class") or "")
    po.uncheck("#follow"); po.wait_for_timeout(200)
    po.click('#items li[data-id="b"] button[data-act=run]'); po.wait_for_timeout(800)
    check("an item started here plays its video in the Output box: To external monitor flashes (and works)", flashing() and not po.is_disabled("#ext") and vstate()["where"] == "here", [flashing(), vstate()])
    po.click("#ext"); po.wait_for_timeout(300)
    check("… moved out there: no more flashing", vstate()["where"] == "external" and not flashing(), [flashing(), vstate()])
    po.click('#items li[data-id="b"] button[data-act=endrun]'); po.wait_for_timeout(300)
    po.click("#ext"); po.check("#follow"); po.wait_for_timeout(300)
    check("a video started by hand (▶) doesn't flash it", (po.click('#items li[data-cue="%s"] button[data-act=fire]' % ids["b"][0]), po.wait_for_timeout(500), not flashing())[-1])
    po.click('#items li[data-cue="%s"] button[data-act=stop]' % ids["b"][0]); po.wait_for_timeout(300)
    po.click('#items li[data-cue="%s"] button[data-act=fire]' % ids["b"][0]); po.wait_for_timeout(1300)
    t1 = vstate()["t"]
    po.click("#ext"); po.wait_for_timeout(300)
    v = vstate()
    check("a video playing here moves to the window and carries on (not restarted)", v["where"] == "external" and not v["paused"] and v["t"] >= t1, [t1, v])
    check("… the same window again (found by name)", len(pc.pages) == 2, [x.url for x in pc.pages])
    xw.close(); po.wait_for_timeout(500)
    check("the window closed by hand: the video comes back here", vstate()["where"] == "here" and po.text_content("#ext") == "To external monitor", [vstate(), po.text_content("#ext")])
    po.click("#stopall"); po.wait_for_timeout(200)

    # Options → Levels: each output plays every cue as loud as its quietest one (never turned up), or off
    po.uncheck("#follow"); po.wait_for_timeout(200)
    lv = lambda k, el="": '#levels .lv-row[data-out="%s"] %s' % (k, el)
    fire = lambda cid: po.click('#items li[data-cue="%s"] button[data-act=fire]' % cid)
    gain = lambda cid: po.evaluate("window.__playout.gain('%s')" % cid)
    lufs = po.evaluate("Object.fromEntries(Object.values(window.__playout.cues()).flat().map(c => [c.id, c.lufs]))")
    want = lambda t, cid: min(1, 10 ** ((t - lufs[cid]) / 20)) if t is not None else 1
    out2 = po.evaluate("'out:' + window.__playout.cues().b[2].out.id")
    show = po.evaluate("Object.values(window.__playout.cues()).flat().filter(c => !c.out && Number.isFinite(c.lufs)).map(c => [c.name, c.lufs])")
    quiet, loud = min(show, key=lambda x: x[1]), max(show, key=lambda x: x[1])
    rows = po.evaluate("[...document.querySelectorAll('#levels .lv-row')].map(r => r.dataset.out + '|' + r.querySelector('.lv-what').textContent)")
    check("Options → Levels: a row for Show and one for the sound card a cue uses", rows == ["show|→ Show", out2 + "|→ " + OUT2], rows)
    note = po.text_content(lv("show", ".lv-note"))
    check("… its level is its quietest cue's, and it says which", po.evaluate("window.__playout.target('show')") == round(quiet[1], 1) and ("Level: −%.1f LUFS, its quietest cue (%s)" % (-round(quiet[1], 1), quiet[0])) in note, [note, quiet])
    check("… and the biggest cut: the loudest, turned down by so much", ("The loudest, %s, is turned down %.1f dB" % (loud[0], loud[1] - round(quiet[1], 1))) in note, note)
    check("… nothing to choose: no level box, no Match the quietest", po.locator("#levels input[data-lv=lufs], #levels button[data-lv=match]").count() == 0)
    t = round(quiet[1], 1)
    fire(ids["a"][0]); fire(ids["a"][1]); fire(ids["b"][2]); po.wait_for_timeout(500)
    g = [gain(ids["a"][0]), gain(ids["a"][1]), gain(ids["b"][2])]
    check("cues play turned down to it (streamed, from memory); a card with one cue: as it is", all(x is not None for x in g) and abs(g[0] - want(t, ids["a"][0])) < 0.01 and abs(g[1] - want(t, ids["a"][1])) < 0.01 and abs(g[2] - 1) < 0.01, [g, lufs, t])
    po.uncheck(lv("show", "input[data-lv=on]")); po.wait_for_timeout(500)
    g = [gain(ids["a"][0]), gain(ids["a"][1]), gain(ids["b"][2])]
    check("Show off: its cues as recorded (only a trim), at once", abs(g[0] - 1) < 0.01 and abs(g[1] - 1) < 0.01 and "Off" in po.text_content(lv("show", ".lv-note")), g)
    check("… and the clip editor shows a cue against its own output (off: as it is)", (po.click('#items li[data-cue="%s"] button[data-act=edit]' % ids["a"][1]), po.wait_for_timeout(1500), "its output isn’t levelled" in po.text_content(".sc-loud"))[-1], po.text_content(".sc-loud"))
    po.keyboard.press("Escape"); po.wait_for_timeout(300)
    po.check(lv("show", "input[data-lv=on]")); po.wait_for_timeout(500)
    check("on again: back to its quietest cue's, at once", po.evaluate("window.__playout.target('show')") == t and abs(gain(ids["a"][0]) - want(t, ids["a"][0])) < 0.01, [po.evaluate("window.__playout.target('show')"), gain(ids["a"][0])])
    # the level box (top right, not scrolled; the owner, 13 Nov 2026): each output's level and its biggest cut; amber until
    # the desk is set, a click = set (neutral); a level changed since: flashing
    box = lambda: po.evaluate("window.__playout.levelBox()")
    rerender = lambda: (po.evaluate("document.getElementById('cuectl').click(); document.getElementById('cuectl').click()"), po.wait_for_timeout(500))
    stored = lambda: po.evaluate("JSON.parse(localStorage.playout_levels || '{}')")
    M = lambda v: "\u2212%.1f" % -v                     # (as the page writes a level: −17.8)
    t2 = round(lufs[ids["b"][2]], 1)
    lb = box()
    check("the level box: each output's level and its loudest cue's cut", lb["shown"] and (M(t) + " LUFS") in lb["text"] and ("loudest cue turned down %.1f dB" % (loud[1] - t)) in lb["text"] and (M(t2) + " LUFS") in lb["text"] and "Show" in lb["text"] and OUT2 in lb["text"], lb)
    check("… amber until the desk is set", lb["cls"] == "lb-unset" and "Set the desk (▶ Tone), then click here" in lb["text"], lb)
    pos = lambda: po.evaluate("(() => { const r = document.getElementById('levelbox').getBoundingClientRect(); return [Math.round(innerWidth - r.right), Math.round(r.top)]; })()")
    p0 = pos(); po.evaluate("window.scrollTo(0, 600)"); po.wait_for_timeout(200); p1 = pos(); po.evaluate("window.scrollTo(0, 0)")
    check("… top right, and it stays there as the page scrolls", p0 == p1 and p0[1] == 10 and 8 <= p0[0] <= 12, [p0, p1])
    po.click("#levelbox"); po.wait_for_timeout(300)
    check("clicked: the desk is set, neutral; kept per output", box()["cls"] == "lb-ok" and "Desk set" in box()["text"] and stored()["show"].get("ack") == t and stored()[out2].get("ack") == t2, [box(), stored()])
    # console trim (the makeup gain for a desk's digital trim) = the LUFS trim offset (0 dB) − the level in use
    S = lambda v: "+%.1f" % v if v >= 0.05 else ("\u2212%.1f" % -v if v <= -0.05 else "0.0")
    trim = lambda: po.evaluate("[...document.querySelectorAll('#levelbox .lb-trim')].map(e => e.textContent)")
    check("… console trim per output: the offset (0 dB) − its level", trim() == ["console trim %s dB" % S(-t), "console trim %s dB" % S(-t2)], trim())
    po.fill(lv("show", "input[data-lv=trim]"), str(t)); po.press(lv("show", "input[data-lv=trim]"), "Tab"); po.wait_for_timeout(300)
    check("a LUFS trim offset (calibrated: it reads 0.0 dB now): kept, the box and the row follow", trim()[0] == "console trim 0.0 dB" and stored()["show"].get("trim") == t and po.text_content(lv("show", ".lv-console")) == "console trim 0.0 dB", [trim(), stored()])
    # a quieter cue arrives: the level follows (what's playing keeps its own till its next play), and the box flashes
    qid = [c for c in po.evaluate("Object.values(window.__playout.cues()).flat().filter(c => !c.out)") if c.get("lufs") == quiet[1]][0]["id"]
    nudge = lambda d: po.evaluate("([id, d]) => { const c = Object.values(window.__playout.cues()).flat().find(x => x.id === id); c.lufs = c.lufs + d; }", [qid, d])
    t6 = round(quiet[1] - 6, 1)
    nudge(-6); rerender()
    check("a quieter cue (6 dB down): the level drops with it; what's playing keeps the level it started at (it doesn't jump)", po.evaluate("window.__playout.target('show')") == t6 and abs(gain(ids["a"][0]) - want(t, ids["a"][0])) < 0.01, [po.evaluate("window.__playout.target('show')"), gain(ids["a"][0]), want(t, ids["a"][0])])
    po.click('#items li[data-cue="%s"] button[data-act=stop]' % ids["a"][0]); po.wait_for_timeout(200)
    po.click('#items li[data-cue="%s"] button[data-act=fire]' % ids["a"][0]); po.wait_for_timeout(600)
    check("… played again: at the new level", abs(gain(ids["a"][0]) - want(t6, ids["a"][0])) < 0.01, [gain(ids["a"][0]), want(t6, ids["a"][0])])
    check("… the level box flashes: the level changed since the desk was set", box()["cls"] == "lb-flash" and "Level changed" in box()["text"] and (M(t6) + " LUFS") in box()["text"], box())
    check("… and the console trim goes up by as much (6 dB quieter: +6.0 dB on the desk)", trim()[0] == "console trim +6.0 dB", trim())
    po.click("#levelbox"); po.wait_for_timeout(300)
    check("… clicked: neutral again", box()["cls"] == "lb-ok" and stored()["show"]["ack"] == t6, box())
    # Automatic levels off: a new level waits (the panel and the box say so) until the box is clicked
    po.uncheck("#lvauto"); po.wait_for_timeout(300)
    check("Automatic levels off: kept; the level in use stays", po.evaluate("localStorage.playout_levels_auto") == "0" and po.evaluate("window.__playout.target('show')") == t6 and box()["cls"] == "lb-ok", [po.evaluate("localStorage.playout_levels_auto"), box()])
    nudge(6); rerender()
    check("… the quietest goes (6 dB up): the level in use stays, and so does what's playing", po.evaluate("window.__playout.target('show')") == t6 and abs(gain(ids["a"][0]) - want(t6, ids["a"][0])) < 0.01, [po.evaluate("window.__playout.target('show')"), gain(ids["a"][0])])
    check("… the box flashes, the new level waiting", box()["cls"] == "lb-flash" and "New level waiting" in box()["text"] and (M(t6) + " → " + M(t) + " LUFS") in box()["text"], box())
    check("… with the console trim it will need", trim()[0] == "console trim +6.0 → 0.0 dB", trim())
    check("… and the Levels panel changes colour", po.evaluate("document.getElementById('levels').closest('.lvsec').classList.contains('waiting')") and po.locator(lv("show")).get_attribute("class").split().count("waiting") == 1 and "Waiting" in po.text_content(lv("show", ".lv-note")), po.text_content(lv("show", ".lv-note")))
    po.screenshot(path=OUTDIR + "/playout_levelbox.png")
    po.click("#levelbox"); po.wait_for_timeout(500)
    check("… clicked: the new level is used, by what's playing too; neutral", po.evaluate("window.__playout.target('show')") == t and abs(gain(ids["a"][0]) - want(t, ids["a"][0])) < 0.01 and box()["cls"] == "lb-ok"
          and not po.evaluate("document.getElementById('levels').closest('.lvsec').classList.contains('waiting')"), [po.evaluate("window.__playout.target('show')"), box()])
    nudge(-6); rerender()
    check("another change: waiting again", box()["cls"] == "lb-flash" and po.evaluate("window.__playout.target('show')") == t)
    po.click("#stopall"); po.wait_for_timeout(200)
    po.click(lv("show", "button[data-lv=tone]")); po.wait_for_timeout(400)
    check("… ▶ Tone counts as the click (the desk is being set by it): the new level used, the tone at it", po.evaluate("window.__playout.tones()") == ["show"] and po.evaluate("window.__playout.target('show')") == t6 and box()["cls"] == "lb-ok", [po.evaluate("window.__playout.tones()"), box()])
    po.click("#stopall"); po.wait_for_timeout(300)
    nudge(6); rerender(); po.click("#levelbox"); po.wait_for_timeout(300)
    po.check("#lvauto"); po.wait_for_timeout(300)
    check("Automatic levels on again: as before", po.evaluate("localStorage.playout_levels_auto") == "1" and po.evaluate("window.__playout.target('show')") == t and box()["cls"] == "lb-ok")
    fire(ids["a"][0]); po.wait_for_timeout(500)
    check("▶ Tone can't start while a cue plays (no 1 kHz under it)", po.is_disabled(lv("show", "button[data-lv=tone]")) and po.is_disabled(lv(out2, "button[data-lv=tone]")))
    po.click("#stopall"); po.wait_for_timeout(300)
    po.click(lv("show", "button[data-lv=tone]")); po.wait_for_timeout(300)
    fire(ids["a"][0]); po.wait_for_timeout(500)
    check("… and a cue starting stops a tone", po.evaluate("window.__playout.tones()") == [] and len(po.evaluate("window.__playout.playing()")) == 1, po.evaluate("window.__playout.tones()"))
    po.click("#stopall"); po.wait_for_timeout(300)
    po.click(lv(out2, "button[data-lv=tone]")); po.wait_for_timeout(400)
    roles = po.evaluate("AudioOut.sinks().then(s => s.filter(x => x.kind === 'context').map(x => x.role))")
    check("▶ Tone: the line-up tone on that output", po.evaluate("window.__playout.tones()") == [out2] and out2 in roles and po.text_content(lv(out2, "button[data-lv=tone]")) == "■ Tone", [po.evaluate("window.__playout.tones()"), roles])
    po.click("#stopall"); po.wait_for_timeout(300)
    check("… Stop all stops it", po.evaluate("window.__playout.tones()") == [] and po.text_content(lv(out2, "button[data-lv=tone]")) == "▶ Tone")
    po.uncheck(lv(out2, "input[data-lv=on]")); po.wait_for_timeout(200)
    st = stored()
    check("kept on this computer, per output: on/off, the level the desk was set for and the one used with Automatic off", st.get(out2) == {"ack": t2, "held": t2, "off": True} and st.get("show") == {"ack": t, "held": t, "trim": t}, st)
    po.check(lv(out2, "input[data-lv=on]"))
    po.check("#follow"); po.wait_for_timeout(200)

    # AIFF (Chrome and Edge can't play or decode it): made a WAV as it's chosen, the samples untouched
    def ext80(rate):                               # an 80-bit extended float, as AIFF keeps its sample rate
        e = math.floor(math.log2(rate)); return struct.pack(">HQ", e + 16383, int(rate * 2 ** (63 - e)))
    def aiff(ch, rate, bits, frames, kind=None):
        val = lambda c, i: 0.5 * math.sin(2 * math.pi * 440 * i / rate) if c == 0 else -0.25
        vals = [val(c, i) for i in range(frames) for c in range(ch)]
        if kind == "fl32": data = struct.pack(">%df" % len(vals), *vals)
        else:
            full = 2 ** (bits - 1)
            ints = [max(-full, min(full - 1, round(v * full))) for v in vals]
            data = b"".join(x.to_bytes(bits // 8, "little" if kind == "sowt" else "big", signed=True) for x in ints)
        comm = struct.pack(">hIh", ch, frames, bits) + ext80(rate) + (kind.encode() + b"\x00\x00" if kind else b"")
        chunk = lambda cid, body: cid + struct.pack(">I", len(body)) + body + (b"\x00" if len(body) % 2 else b"")
        form = (b"AIFC" if kind else b"AIFF") + chunk(b"COMM", comm) + chunk(b"SSND", struct.pack(">II", 0, 0) + data)
        return b"FORM" + struct.pack(">I", len(form)) + form
    def converted(raw, rate):
        return po.evaluate("""async ([b64, rate]) => {
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          try {
            const f = await StingClip.playable(new File([bytes], 'take 3.aiff', { type: 'audio/aiff' })), ab = await f.arrayBuffer();
            const buf = await new OfflineAudioContext(2, 1, rate).decodeAudioData(ab.slice(0));
            const a = buf.getChannelData(0), b = buf.getChannelData(buf.numberOfChannels - 1);
            return { name: f.name, type: f.type, rate: new DataView(ab).getUint32(24, true), ch: buf.numberOfChannels, len: buf.length, a: [a[1], a[100], a[1234]], b: b[777] };
          } catch (e) { return { error: String(e && e.message || e) }; }
        }""", [base64.b64encode(raw).decode(), rate])
    want = lambda rate: [0.5 * math.sin(2 * math.pi * 440 * i / rate) for i in (1, 100, 1234)]
    for label, ch, rate, bits, kind, tol in [("24-bit 48 kHz AIFF", 2, 48000, 24, None, 1e-5), ("16-bit AIFF-C (sowt)", 2, 44100, 16, "sowt", 1e-4),
                                              ("32-bit float AIFF-C", 2, 48000, 32, "fl32", 1e-6), ("8-bit mono AIFF", 1, 22050, 8, None, 1e-2)]:
        r = converted(aiff(ch, rate, bits, 4000, kind), rate)
        ok = "error" not in r and (r["name"], r["type"], r["rate"], r["ch"], r["len"]) == ("take 3.wav", "audio/wav", rate, ch, 4000) \
            and all(abs(x - y) < tol for x, y in zip(r["a"], want(rate))) and (ch == 1 or abs(r["b"] + 0.25) < tol)
        check("AIFF: a %s becomes a WAV with the same samples" % label, ok, r)
    r = converted(aiff(2, 48000, 16, 100, "ulaw"), 48000)
    check("… a compressed AIFF-C is refused, saying why", "compression" in r.get("error", ""), r)
    aif = os.path.join(OUTDIR, "po_tone24.aiff"); open(aif, "wb").write(aiff(2, 48000, 24, 96000))
    add_file("d", "start", None, aif)
    nd = po.evaluate("window.__playout.cues().d.at(-1)")
    check("an AIFF chosen as a cue: added (as WAV), with its length", nd["name"] == "po_tone24" and nd["media"] == "audio" and abs((nd.get("duration") or 0) - 2) < 0.05, nd)
    check("… kept in this browser as a WAV", po.evaluate("window.videoStore.get('pocue:%s').then(b => b.type)" % nd["id"]) == "audio/wav")
    po.click('#items li[data-cue="%s"] button[data-act=fire]' % nd["id"]); po.wait_for_timeout(500)
    check("… and it plays", nd["id"] in playing(), playing())
    po.click("#stopall")

    # off: the page says so
    oc = b.new_context(ignore_https_errors=True); oc.route("**/*", h)
    o = oc.new_page(); o.goto(BASE + "playout.html"); o.wait_for_timeout(500)
    check("off (not alpha): playout.html says it isn't available", "aren’t available" in o.inner_text("main"), o.inner_text("main")[:80])
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
