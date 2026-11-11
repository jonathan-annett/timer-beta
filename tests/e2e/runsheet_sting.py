import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Walk-up stings (a trial: TimerFeatures.stings; sting-player.js): the run sheet editor's + sting takes
# a stock sting or a file (browsed, picked from a folder's list, or an audio file dropped on the row); the timer keeps a copy of
# link and stock stings when their server allows it (CORS), else plays them from the link. Next plays
# the item's sting while the item keeps its own time; it plays on into an item without a sting,
# another sting stops it (a 0.3 s fade), the operator fades it (the sting bar, stingfade); Back stops
# only the undone item's; a video sting plays in the player window without touching the timer. Off, there's no
# + sting and stings don't play.
import io, json, math, mimetypes, os, struct, sys, wave, base64
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
CDN = "https://cdn.example.com/"          # a server that doesn't allow copying (no CORS header)
SHEET = {"title": "Stings", "perItem": 20, "items": [
    {"id": "a", "name": "Keynote", "start": None, "duration": 600},
    {"id": "b", "name": "Panel", "start": None, "duration": 300},
    {"id": "c", "name": "Awards", "start": None, "duration": 900},
    {"id": "d", "name": "Close", "start": None, "duration": 120},
    {"id": "e", "name": "Speaker", "start": None, "duration": 600},
    {"id": "f", "name": "Encore", "start": None, "duration": 300}]}

def tone(seconds, hz=440):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * hz * i / 16000))) for i in range(int(16000 * seconds))))
    return buf.getvalue()
WAV_LONG, WAV_SHORT = tone(6), tone(2, 660)
STOCK = {"stings": [{"name": "Fanfare", "url": "media/fanfare.wav", "media": "audio", "duration": 6},
                    {"name": "Drumroll", "url": "media/fanfare.wav?d", "media": "audio", "duration": 6}]}
VIDEO = {"data": None}
errs = []

def h(route, req):
    u = req.url
    cors = {"access-control-allow-origin": "*"}
    if u.startswith(BASE + "media/fanfare.wav"): return route.fulfill(status=200, body=WAV_LONG, headers={"content-type": "audio/wav", **cors})
    if u.startswith(BASE + "media/clip.webm"): return route.fulfill(status=200, body=VIDEO["data"] or b"", headers={"content-type": "video/webm", **cors})
    if u.startswith(CDN):   # no CORS: the browser would refuse a copy (fetch) but still play it (media); interception skips that check, so refuse it here
        if req.resource_type == "fetch": return route.abort()
        return route.fulfill(status=200, body=WAV_LONG, headers={"content-type": "audio/wav"})
    if u.startswith(BASE):
        name = u[len(BASE):].split("?")[0].split("#")[0]
        if name == "stock-stings.json": return route.fulfill(status=200, body=json.dumps(STOCK), headers={"content-type": "application/json"})
        if name == "changelog.html": return route.fulfill(status=404, body=b"")
        fp = os.path.join(PUBLIC, name)
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()

def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

ARGS = ["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"]
INIT = "if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';localStorage.runsheet=%s}" % json.dumps(json.dumps(SHEET))
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)

    # A test video with a soundtrack (1 kHz at about -12 LUFS), made in the browser (no ffmpeg here)
    mk = b.new_page()
    VIDEO["data"] = base64.b64decode(mk.evaluate("""() => new Promise(res => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d');
      const ac = new AudioContext(), o = ac.createOscillator(), gn = ac.createGain(), dst = ac.createMediaStreamDestination();
      o.frequency.value = 1000; gn.gain.value = 0.25; o.connect(gn); gn.connect(dst); o.start();
      const st = new MediaStream([...c.captureStream(25).getVideoTracks(), ...dst.stream.getAudioTracks()]);
      const rec = new MediaRecorder(st, { mimeType: 'video/webm;codecs=vp8,opus' }); const parts = [];
      rec.ondataavailable = e => parts.push(e.data);
      rec.onstop = () => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(new Blob(parts, { type: 'video/webm' })); };
      let n = 0; const iv = setInterval(() => { g.fillStyle = n++ % 2 ? '#c00' : '#00c'; g.fillRect(0, 0, 160, 90); }, 40);
      rec.start(); setTimeout(() => { clearInterval(iv); rec.stop(); }, 6000);   // long enough to still be playing into the next item
    })"""))
    mk.close()
    wav_path = os.path.join(OUTDIR, "sting_short.wav"); open(wav_path, "wb").write(WAV_SHORT)
    vid_path = os.path.join(OUTDIR, "sting_clip.webm"); open(vid_path, "wb").write(VIDEO["data"])

    c = b.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 800})
    c.add_init_script("window.TimerFeatures = { stings: true };" + INIT)
    c.route("**/*", h)
    t = c.new_page(); t.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    t.goto(BASE + "timer.html"); t.wait_for_timeout(1200)
    e = c.new_page(); e.on("pageerror", lambda x: errs.append("editor: " + str(x)))
    e.goto(BASE + "runsheet.html"); e.wait_for_timeout(1000)
    sheet = lambda: t.evaluate("JSON.parse(localStorage.runsheet).items.reduce((m, it) => (m[it.id] = it.sting || null, m), {})")
    row = lambda i: '#rs-table tr[data-id="%s"]' % i

    check("+ sting offered on rows without a video", e.locator(row("a") + " button[data-act=sadd]").count() == 1)
    # a: the stock sting
    e.click(row("a") + " button[data-act=sadd]"); e.wait_for_timeout(300)
    e.click(".sting-use"); e.wait_for_timeout(300)
    s = sheet()["a"]
    check("stock sting on the item", s and s["src"] == "stock" and s["url"] == BASE + "media/fanfare.wav" and s["media"] == "audio", s)
    # b: a link to a server that doesn't allow copying. First the dialog's preview and its "in use" marks
    e.click(row("b") + " button[data-act=sadd]"); e.wait_for_timeout(300)
    opts = lambda: e.evaluate("[...document.querySelectorAll('#sting-stock option')].map(o => o.textContent)")
    check("a stock sting in use is marked", any("Fanfare" in o and "in use: Keynote" in o for o in opts()), opts())
    e.click("#sting-prev"); e.wait_for_timeout(600)
    check("▶ previews the stock sting", e.evaluate("window.__stingPreview()") and e.text_content("#sting-prev") == "■")
    e.check("#sting-hideused"); e.wait_for_timeout(200)
    check("hide stings already on the sheet", opts() == ["Drumroll · 6 s"], opts())
    check("… and the preview stops", not e.evaluate("window.__stingPreview()"))
    e.uncheck("#sting-hideused")
    e.click(".sting-tab[data-mode=custom]")
    check("Custom file: a file or a folder, no link box", e.locator("#sting-url").count() == 0 and e.is_visible("#sting-browse") and e.is_visible("#sting-folderpick"))
    e.keyboard.press("Escape")
    # (link stings still play: one already on a sheet, say, or from the library)
    t.evaluate("u => { const sh = JSON.parse(localStorage.runsheet); sh.items.find(x => x.id === 'b').sting = { src: 'link', media: 'audio', name: 'walkup', url: u, duration: 6 }; localStorage.runsheet = JSON.stringify(sh); window.runsheet.sheetChanged(); }", CDN + "walkup.wav")
    e.wait_for_timeout(500)
    # c: a file, through the picker
    e.click(row("c") + " button[data-act=sadd]"); e.wait_for_timeout(300)
    e.click(".sting-tab[data-mode=custom]")
    with e.expect_file_chooser() as fc: e.click("#sting-browse")
    fc.value.set_files(wav_path); e.wait_for_timeout(1200)
    s = sheet()["c"]
    check("file sting kept in the browser", s and s["src"] == "file" and s["key"].startswith("rssting:c:") and s["duration"] == 2, s)
    # d: a video file dropped on the row is a video; through + sting it's a video sting
    e.click(row("d") + " button[data-act=sadd]"); e.wait_for_timeout(300)
    e.click(".sting-tab[data-mode=custom]")
    with e.expect_file_chooser() as fc: e.click("#sting-browse")
    fc.value.set_files(vid_path); e.wait_for_timeout(1500)
    s = sheet()["d"]
    check("video sting", s and s["media"] == "video" and s["key"], s)
    # f: from a folder's list (here the folder input: Chrome's folder picker can't be driven by the test), then
    # the same stock sting as the keynote, knowingly
    fdir = os.path.join(OUTDIR, "sting_folder"); os.makedirs(os.path.join(fdir, "more"), exist_ok=True)
    open(os.path.join(fdir, "b-short.wav"), "wb").write(WAV_SHORT); open(os.path.join(fdir, "more", "a-clip.webm"), "wb").write(VIDEO["data"]); open(os.path.join(fdir, "notes.txt"), "w").write("x")
    e.click(row("f") + " button[data-act=sadd]"); e.wait_for_timeout(300)
    e.click(".sting-tab[data-mode=custom]")
    check("Custom file: Use is off until a folder is chosen", e.is_disabled(".sting-use"))
    e.evaluate("window.showDirectoryPicker = undefined")
    with e.expect_file_chooser() as fc: e.click("#sting-folderpick")
    fc.value.set_files(fdir); e.wait_for_timeout(500)
    fopts = e.evaluate("[...document.querySelectorAll('#sting-folder option')].map(o => o.textContent)")
    check("Choose a folder…: its audio and video files in a list (subfolders too, sorted, nothing else)", fopts == ["b-short", "more/a-clip"], fopts)
    e.screenshot(path=OUTDIR + "/sting_folder.png")
    inside = e.evaluate("""(() => {                                // a very long file name: ▶ ✂ stay in the dialog
      const sel = document.getElementById('sting-folder'), o = document.createElement('option');
      o.textContent = 'An extremely long walk-up track name from a music folder, remastered, extended mix (2026)'; sel.appendChild(o);
      const box = document.querySelector('.sting-dlg .ask-box').getBoundingClientRect();
      const ok = ['sting-fprev', 'sting-fedit'].every(id => document.getElementById(id).getBoundingClientRect().right <= box.right);
      o.remove(); return ok; })()""")
    check("… a long file name doesn't push ▶ ✂ out of the dialog", inside)
    e.click("#sting-fprev"); e.wait_for_timeout(500)
    check("… ▶ plays the one chosen", e.evaluate("window.__stingPreview()"))
    e.click(".sting-use"); e.wait_for_timeout(1200)
    s = sheet()["f"]
    check("… Use this file: kept with the item like a browsed file", s and s["src"] == "file" and s["name"] == "b-short" and s["key"].startswith("rssting:f:"), s)
    e.once("dialog", lambda d: d.accept()); e.click(row("f") + " button[data-act=sdel]"); e.wait_for_timeout(400)
    e.click(row("f") + " button[data-act=sadd]"); e.wait_for_timeout(300); e.click(".sting-tab[data-mode=custom]")
    check("the folder's list is still there next time", e.locator("#sting-folder option").count() == 2 and not e.is_disabled(".sting-use"))
    e.click(".sting-tab[data-mode=stock]")
    e.click("#sting-prev"); e.wait_for_timeout(300)
    e.click(".sting-use"); e.wait_for_timeout(300)
    check("closing the dialog stops the preview", not e.evaluate("window.__stingPreview()"))
    asked = e.inner_text(".ask .ask-text") if e.locator(".ask").count() else ""
    check("using a sting again asks first", "already used for Keynote" in asked, asked)
    e.click(".ask button:has-text('Use it again')"); e.wait_for_timeout(300)
    check("… and uses it again", (sheet()["f"] or {}).get("url") == BASE + "media/fanfare.wav", sheet()["f"])

    t.wait_for_timeout(1500)   # the timer keeps copies of link and stock stings
    st = sheet()
    check("the timer kept a copy of the stock sting", bool(st["a"].get("key")), st["a"])
    check("a link whose server doesn't allow it isn't kept (plays from the link)", not st["b"].get("key"), st["b"])
    e.wait_for_timeout(300)
    check("the editor flags the one that needs the internet", e.locator(row("b") + " .sweb").count() == 1 and e.locator(row("a") + " .sweb").count() == 0)
    e.screenshot(path=OUTDIR + "/sting_editor.png")

    sp = lambda: t.evaluate("window.stingPlayer.state()")
    remain = lambda: t.text_content("#remain_disp")
    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(1200)
    s = sp()
    check("Next: the sting plays", s["audio"] and s["audio"]["id"] == "a" and not s["audio"]["paused"], s)
    check("Next: the item keeps its own time (not the sting's)", remain() in ("9:59", "9:58"), remain())
    check("Next: the item's name is the message", t.evaluate("localStorage.message_item") == "Keynote")

    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(100)
    s = sp()
    check("another sting: the last one stops (a 0.3 s fade) as the new one plays", s["fading"] >= 1 and s["audio"] and s["audio"]["id"] == "b", s)
    t.wait_for_timeout(1300); s = sp()
    check("… and it's gone after the fade", s["fading"] == 0, s)
    check("a sting from its link plays", s["audio"] and s["audio"]["id"] == "b" and not s["audio"]["paused"], s)
    check("the panel's own time", remain() in ("4:59", "4:58", "4:57"), remain())

    # the operator's fade: the sting bar, and the deck's key (the stingfade command)
    check("the sting bar shows while it plays", t.is_visible("#sting-bar") and "walkup" in t.inner_text("#sting-bar"), t.is_visible("#sting-bar"))
    t.click("#sting-bar button[data-a=fade]"); t.wait_for_timeout(400); s = sp()
    check("Fade out: it fades (over 3 s)", s["audio"] is None and s["fading"] == 1, s)
    t.wait_for_timeout(3000); s = sp()
    check("… and goes", s["fading"] == 0 and not t.is_visible("#sting-bar"), (s, t.is_visible("#sting-bar")))
    t.evaluate("window.runsheet.back()"); t.wait_for_timeout(1200)
    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(1200)
    t.evaluate("processTimerApiMessage({cmd:'stingfade', msecs: 500})"); t.wait_for_timeout(900); s = sp()
    check("the stingfade command (the deck's key) fades it", s["audio"] is None and s["fading"] == 0, s)
    t.evaluate("window.runsheet.back()"); t.wait_for_timeout(1200)
    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(1200)
    t.evaluate("window.runsheet.back()"); t.wait_for_timeout(200); s = sp()
    check("Back stops the sting at once", s["audio"] is None, s)
    t.wait_for_timeout(1000)   # (Next and Back are debounced)
    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(1200)
    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(800); s = sp()
    check("a file sting plays", s["audio"] and s["audio"]["id"] == "c", s)
    t.wait_for_timeout(2500); s = sp()
    check("a sting that ends goes quietly; the item runs on", s["audio"] is None and remain().startswith("14:5"), (s, remain()))

    # the video sting: the player window, timer untouched
    t.evaluate("window.videoPlayer.open()"); t.wait_for_timeout(800)
    dl = t.evaluate("(async () => { const it = JSON.parse(localStorage.runsheet).items.find(x => x.id === 'd'); return StingClip.loudness(StingClip.render(await StingClip.decode(await videoStore.get(it.sting.key)), it.sting)); })()")
    check("a video sting's soundtrack can be measured (Level this show…, the clip editor)", dl is not None and -13 < dl < -11, dl)
    t.evaluate("l => { const sh = JSON.parse(localStorage.runsheet); Object.assign(sh.items.find(x => x.id === 'd').sting, { lufs: l, volume: 0.5 }); localStorage.runsheet = JSON.stringify(sh); window.runsheet.sheetChanged(); }", dl)
    t.wait_for_timeout(300)
    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(1200); s = sp()
    pv = t.evaluate("(() => { const w = window.open('', 'video_player_window'); const v = [...w.document.querySelectorAll('video')].find(x => x.style.zIndex === '3'); return v ? v.volume : null; })()")
    check("… and it plays levelled in the player window (its level as it starts)", pv is not None and abs(pv - 0.5 * 10 ** ((-23 - dl) / 20)) < 0.002, (pv, dl))
    check("a video sting plays in the player window", s["video"] and s["video"]["id"] == "d", s)
    check("… without setting the timer to its length", remain().startswith("1:5"), remain())
    check("… or the message", t.evaluate("localStorage.message_item") == "Close")
    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(1000); s = sp()
    check("an item without a sting: the last one plays on (under the speaker's countdown)", s["video"] and s["video"]["id"] == "d" and (remain() == "10:00" or remain().startswith("9:5")), (s, remain()))
    t.evaluate("window.runsheet.back()"); t.wait_for_timeout(500); s = sp()
    check("Back from that item leaves it playing (it didn't start it)", s["video"] and s["video"]["id"] == "d", s)

    # Esc: a graceful exit for whatever is playing (not over a panel)
    vs = lambda: t.evaluate("window.videoPlayer.state().status")
    t.bring_to_front(); t.mouse.click(640, 400); t.keyboard.press("Escape"); t.wait_for_timeout(3500); s = sp()
    check("Esc fades the video sting out", s["video"] is None, s)
    t.evaluate("window.videoPlayer.load('%smedia/clip.webm', {name: 'Clip'}); setTimeout(() => window.videoPlayer.play(), 500)" % BASE); t.wait_for_timeout(1500)
    check("(a dropped video plays)", vs() == "playing", vs())   # (a recorded webm has no length until read through, so the timer may not be set yet)
    t.evaluate("window.noticePanel.toggle()"); t.wait_for_timeout(200); t.mouse.click(640, 400)
    t.keyboard.press("Escape"); t.wait_for_timeout(300)
    check("Esc with a panel open closes the panel, nothing else", t.evaluate("document.getElementById('notice-panel').hidden") and vs() == "playing", vs())
    t.keyboard.press("Escape"); t.wait_for_timeout(1000)
    op = t.evaluate("(() => { const w = window.open('', 'video_player_window'); const v = [...w.document.querySelectorAll('video')].find(x => x.style.zIndex === '3'); return v ? Number(v.style.opacity) : null; })()")
    check("Esc fades a video out, picture and sound", vs() == "playing" and op is not None and 0 < op < 1, (vs(), op))
    t.wait_for_timeout(2500)
    check("… then ends it as if it had finished: unloaded, message and timer cleared", vs() == "empty" and t.evaluate("localStorage.message_item") == "", (vs(), t.evaluate("localStorage.message_item")))
    # the run sheet editor: what's playing, ■ Fade out, and Esc there
    play = lambda: (t.evaluate("window.videoPlayer.load('%smedia/clip.webm', {name: 'Clip'}); setTimeout(() => window.videoPlayer.play(), 500)" % BASE), t.wait_for_timeout(2500))
    play()
    check("the timer's playing bar shows the video too", t.is_visible("#sting-bar") and "🎬" in t.inner_text("#sting-bar") and "Clip" in t.inner_text("#sting-bar"))
    check("the run sheet editor (its own window) shows the same bar", e.is_visible("#playing") and "Clip" in e.inner_text("#playing") and e.is_visible("#btn-plstop"), e.inner_text("#playing") if e.is_visible("#playing") else None)
    e.click("#btn-fadeout"); t.wait_for_timeout(3600)
    check("… which fades it out", vs() == "empty", vs())
    e.wait_for_timeout(1200)
    check("… and the line goes", not e.is_visible("#playing"))
    play()
    e.click("#btn-plstop"); t.wait_for_timeout(800)
    check("… Stop: at once (a quick fade)", vs() == "empty", vs())
    play()
    e.evaluate("document.activeElement && document.activeElement.blur()"); e.keyboard.press("Escape"); t.wait_for_timeout(3600)
    check("Esc in the run sheet editor fades it out too", vs() == "empty", vs())

    # Off: no + sting, nothing plays
    c2 = b.new_context(ignore_https_errors=True)
    c2.add_init_script("window.TimerFeatures = { stings: false };" + INIT.replace("localStorage.runsheet=", "localStorage.runsheet=") )
    c2.route("**/*", h)
    t2 = c2.new_page(); t2.goto(BASE + "timer.html"); t2.wait_for_timeout(800)
    t2.evaluate("s => { const sh = JSON.parse(s); sh.items[0].sting = { src: 'link', media: 'audio', name: 'x', url: '%s' }; localStorage.runsheet = JSON.stringify(sh); window.runsheet.sheetChanged(); }" % (BASE + "media/fanfare.wav"), json.dumps(SHEET))
    e2 = c2.new_page(); e2.goto(BASE + "runsheet.html"); e2.wait_for_timeout(800)
    check("off: no + sting", e2.locator("button[data-act=sadd]").count() == 0)
    t2.evaluate("window.runsheet.next()"); t2.wait_for_timeout(800)
    check("off: stings don't play", not t2.evaluate("window.stingPlayer && window.stingPlayer.state().audio"))
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
