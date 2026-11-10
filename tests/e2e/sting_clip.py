import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Sting clips (sting-clip.js; a trial with the stings): the run sheet editor's ✂ opens a waveform
# editor (the whole track and a close-up), typed or dragged start/end, fades, keys kept inside it;
# the item's sting keeps its part and the timer plays just that, from memory. The sting library page
# (stings.html, sting-library.js) makes clips of stock stings and of files, exports them as JSON
# (stock by name, file by name and size) and imports them, asking for the files once; the editor's
# + sting offers the library's clips, and a stock clip in use counts separately from its whole song.
import io, json, math, mimetypes, os, struct, sys, wave
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
def tone(sec, hz=220):
    b = io.BytesIO(); w = wave.open(b, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * (hz + 40 * int(i / 16000)) * i / 16000))) for i in range(int(16000 * sec)))); w.close()
    return b.getvalue()
SONG = tone(8)
STOCK = {"stings": [{"name": "Song", "url": "media/song.wav", "media": "audio", "duration": 8},
                    {"name": "Song — hit", "url": "media/song.wav", "media": "audio", "duration": 8, "start": 5, "end": 6.5, "fadeOut": 200},
                    {"name": "Tune", "url": "media/song.wav?t", "media": "audio", "duration": 8},
                    {"name": "Tune — tidy", "url": "media/song.wav?t", "media": "audio", "duration": 8, "start": 0.5, "end": 7, "hideOriginal": True}]}
SHEET = {"title": "Clips", "perItem": 20, "items": [
    {"id": "a", "name": "Keynote", "start": None, "duration": 600},
    {"id": "b", "name": "Panel", "start": None, "duration": 300},
    {"id": "c", "name": "Awards", "start": None, "duration": 300},
    {"id": "d", "name": "Close", "start": None, "duration": 300}]}
def h(route, req):
    u = req.url
    if u.startswith(BASE + "media/song.wav"): return route.fulfill(status=200, body=SONG, headers={"content-type": "audio/wav"})
    if u.startswith(BASE):
        n = u[len(BASE):].split("?")[0].split("#")[0]
        if n == "stock-stings.json": return route.fulfill(status=200, body=json.dumps(STOCK), headers={"content-type": "application/json"})
        if n == "changelog.html": return route.fulfill(status=404, body=b"")
        fp = os.path.join(PUBLIC, n)
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

INIT = "window.TimerFeatures={stings:true};if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';localStorage.runsheet=%s}" % json.dumps(json.dumps(SHEET))
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"])
    folder = os.path.join(OUTDIR, "clip_tracks"); os.makedirs(folder, exist_ok=True)
    mytrack = os.path.join(folder, "my-track.wav"); open(mytrack, "wb").write(tone(6, 330))

    c = b.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 800}, accept_downloads=True)
    c.add_init_script(INIT); c.route("**/*", h)
    t = c.new_page(); t.on("pageerror", lambda e: errs.append("timer: " + str(e))); t.goto(BASE + "timer.html"); t.wait_for_timeout(1000)
    e = c.new_page(); e.on("pageerror", lambda x: errs.append("editor: " + str(x))); e.goto(BASE + "runsheet.html"); e.wait_for_timeout(800)
    sheet = lambda: t.evaluate("JSON.parse(localStorage.runsheet).items.reduce((m, it) => (m[it.id] = it.sting || null, m), {})")
    row = lambda i: '#rs-table tr[data-id="%s"]' % i

    # ✂ in the run sheet editor
    e.click(row("a") + " button[data-act=sadd]"); e.wait_for_timeout(300)
    e.select_option("#sting-stock", "0"); e.click(".sting-use"); e.wait_for_timeout(400)
    e.click(row("a") + " button[data-act=strim]")
    INK = "(() => { const c = document.querySelector('.sc-over'); if (!c || !c.width) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })()"
    try: e.wait_for_function(INK + " > 1000", timeout=6000)   # decoding the track takes a moment
    except Exception: pass
    ink = e.evaluate("(() => { const c = document.querySelector('.sc-over'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })()")
    check("the waveform is drawn", ink > 1000, ink)
    # first / last 2 s (the last: 2 s before the fade out begins, then the fade)
    e.fill(".sc-t[data-k=start]", "0:02.00"); e.press(".sc-t[data-k=start]", "Tab")
    e.fill(".sc-t[data-k=end]", "7"); e.press(".sc-t[data-k=end]", "Tab")
    e.fill(".sc-ms[data-k=fadeOut]", "500"); e.press(".sc-ms[data-k=fadeOut]", "Tab")
    playing = lambda: e.evaluate("document.querySelector('.sc-wrap').__playing()")
    e.click(".sc-first"); e.wait_for_timeout(150)
    check("▶ First 2 s", playing() == {"from": 2, "to": 4}, playing())
    e.click(".sc-last"); e.wait_for_timeout(150)
    check("▶ Last 2 s starts 2 s before the fade out", playing() == {"from": 4.5, "to": 7}, playing())
    zoom = lambda: [round(x, 2) for x in e.evaluate("document.querySelector('.sc-wrap').__zoom()")]
    e.click(".sc-first"); e.wait_for_timeout(100)
    check("First 2 s: the close-up shows the start 1 s in, 6 s across", zoom() == [1, 7], zoom())
    e.click(".sc-last"); e.wait_for_timeout(100)
    check("Last 2 s: the end 1 s from the right, 6 s across", zoom() == [2, 8], zoom())
    e.click(".sc-zall"); e.wait_for_timeout(100)
    check("Show the whole part: back to all of it", zoom()[0] < 2 and zoom()[1] >= 7, zoom())
    e.click(".sc-stop")
    # the pointer over a line becomes ↔
    box = e.locator(".sc-zoom").bounding_box()
    e.mouse.move(box["x"] + box["width"] / 2, box["y"] + 20)
    check("the pointer away from a line is plain", not e.evaluate("document.querySelector('.sc-zoom').classList.contains('sc-grab')"))
    a0, b0 = e.evaluate("(() => { const s = 2, en = 7, pad = Math.max(0.5, (en - s) * 0.25); return [Math.max(0, s - pad), Math.min(8, en + pad)]; })()")
    e.mouse.move(box["x"] + (2 - a0) / (b0 - a0) * box["width"] + 2, box["y"] + 20)
    check("over the start line it becomes ↔", e.evaluate("document.querySelector('.sc-zoom').classList.contains('sc-grab')"))
    # ↑ ↓ step the boxes
    e.click(".sc-ms[data-k=fadeOut]"); e.keyboard.press("ArrowUp"); e.keyboard.press("Shift+ArrowUp")
    check("↑ in a fade box: 10 ms, Shift 100 ms", e.input_value(".sc-ms[data-k=fadeOut]") == "610", e.input_value(".sc-ms[data-k=fadeOut]"))
    e.click(".sc-t[data-k=start]"); e.keyboard.press("ArrowUp")
    check("↑ in a time box: 0.01 s", e.input_value(".sc-t[data-k=start]") == "0:02.01", e.input_value(".sc-t[data-k=start]"))
    e.fill(".sc-t[data-k=start]", "0:02.00"); e.press(".sc-t[data-k=start]", "Tab")
    e.fill(".sc-t[data-k=end]", "3.5"); e.press(".sc-t[data-k=end]", "Tab")
    e.fill(".sc-ms[data-k=fadeOut]", "200"); e.press(".sc-ms[data-k=fadeOut]", "Tab")
    e.click(".sc-len"); e.keyboard.press("ArrowRight"); e.wait_for_timeout(100)
    check("← → nudge the selected edge", e.input_value(".sc-t[data-k=end]") == "0:03.60", e.input_value(".sc-t[data-k=end]"))
    before = t.evaluate("JSON.parse(localStorage.runsheet_state || '{}').index")
    e.keyboard.press("Space"); e.wait_for_timeout(400)
    check("Space plays the part, not Next", t.evaluate("JSON.parse(localStorage.runsheet_state || '{}').index") == before)
    e.screenshot(path=OUTDIR + "/clip_editor.png")
    e.click(".sc-save"); e.wait_for_timeout(500)
    s = sheet()["a"]
    check("the sting keeps its part", s and s.get("start") == 2 and s.get("end") == 3.6 and s.get("fadeOut") == 200, s)
    check("the cell shows the part's length and a lit ✂", "2 s" in e.inner_text(row("a") + " td.vid") and e.locator(row("a") + " .vtrim.on").count() == 1)

    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(700)
    st = t.evaluate("window.stingPlayer.state()")
    check("the timer plays just the part, from memory", st["audio"] and abs(st["audio"]["duration"] - 1.6) < 0.05 and not st["audio"]["paused"], st)
    t.wait_for_timeout(1500)
    check("… and it ends there", t.evaluate("window.stingPlayer.state().audio") is None)

    # a stock clip counts separately from its whole song
    e.click(row("b") + " button[data-act=sadd]"); e.wait_for_timeout(300)
    opts = e.evaluate("[...document.querySelectorAll('#sting-stock option')].map(o => o.textContent)")
    check("a stock clip is offered with its own length", any(o.startswith("Song — hit · 2 s") for o in opts), opts)
    check("the song in use doesn't mark its clip as in use", not any("hit" in o and "in use" in o for o in opts), opts)
    check("a stock clip with hideOriginal: the whole track isn't offered, the clip is", not any(o.startswith("Tune ·") for o in opts) and any(o.startswith("Tune — tidy") for o in opts), opts)
    e.select_option("#sting-stock", "1"); e.click(".sting-use"); e.wait_for_timeout(400)
    s = sheet()["b"]
    check("a stock clip keeps its part on the item", s and s.get("start") == 5 and s.get("end") == 6.5, s)

    # the library page
    lib = c.new_page(); lib.on("pageerror", lambda x: errs.append("library: " + str(x))); lib.goto(BASE + "stings.html"); lib.wait_for_timeout(800)
    check("the library lists the stock stings (hidden ones too, marked)", lib.locator(".sl-stock li[data-s]").count() == 4 and lib.evaluate("window.__stingLibrary.hidden()") == ["Tune"], lib.evaluate("window.__stingLibrary.hidden()"))
    lib.click('.sl-stock li[data-s="0"] button[data-a=clip]'); lib.wait_for_timeout(1200)
    lib.fill(".sc-t[data-k=start]", "1"); lib.press(".sc-t[data-k=start]", "Tab")
    lib.fill(".sc-t[data-k=end]", "2.5"); lib.press(".sc-t[data-k=end]", "Tab")
    check("a clip of a stock sting offers to hide the original, ticked", lib.is_visible(".sc-hide") and lib.is_checked(".sc-hideorig") and "Song" in lib.inner_text(".sc-hide"))
    lib.fill(".sc-name", "Keynote 1.5 s"); lib.click(".sc-save"); lib.wait_for_timeout(400)
    meta = lambda i: lib.inner_text('.sl-stock li[data-s="%d"] .meta' % i)
    check("a song with several clips says how many, and that it is hidden", "2 clips" in meta(0) and "original hidden" in meta(0), meta(0))
    check("… one with one clip", "1 clip" in meta(2) and "2 clips" not in meta(2) and "original hidden" in meta(2), meta(2))
    with lib.expect_file_chooser() as fc: lib.click("button[data-a=fromfile]")
    fc.value.set_files(mytrack); lib.wait_for_timeout(1200)
    lib.fill(".sc-t[data-k=end]", "3"); lib.press(".sc-t[data-k=end]", "Tab")
    lib.fill(".sc-ms[data-k=fadeIn]", "100"); lib.press(".sc-ms[data-k=fadeIn]", "Tab")
    lib.fill(".sc-name", "Sarah's walk-on"); lib.click(".sc-save"); lib.wait_for_timeout(400)
    mine = lib.evaluate("window.__stingLibrary.list()")
    check("clips made from a stock sting and from a file", [(m["name"], m.get("stock"), m.get("file")) for m in mine] == [("Keynote 1.5 s", "Song", None), ("Sarah's walk-on", None, "my-track.wav")], mine)
    lib.click('.sl-mine li[data-i="1"] button[data-a=play]'); lib.wait_for_timeout(300)
    check("▶ plays a clip", lib.evaluate("window.__stingLibrary.playing()") == "m1")
    lib.click('.sl-mine li[data-i="1"] button[data-a=play]')
    with lib.expect_download() as dl: lib.click("button[data-a=export]")
    exported = json.loads(open(dl.value.path()).read())
    ex = exported["stings"]
    check("export: stock by name, file by name and size, the parts", ex[0].get("stock") == "Song" and ex[0].get("hideOriginal") is True and "hideOriginal" not in ex[1] and ex[0].get("start") == 1 and ex[0].get("end") == 2.5 and ex[1].get("file") == "my-track.wav" and ex[1].get("size") == os.path.getsize(mytrack) and ex[1].get("fadeIn") == 100, ex)
    lib.screenshot(path=OUTDIR + "/sting_library.png")

    # the editor offers the library's clips
    e.reload(); e.wait_for_timeout(800)
    e.click(row("c") + " button[data-act=sadd]"); e.wait_for_timeout(500)
    check("+ sting offers my clips", e.locator("#sting-mine option").count() == 2)
    opts = e.evaluate("[...document.querySelectorAll('#sting-stock option')].map(o => o.textContent)")
    check("my clip hides its original from the pick list", not any(o.startswith("Song ·") for o in opts) and any(o.startswith("Song — hit") for o in opts), opts)
    e.click(".sting-tab[data-mode=edited]")
    check("the three tabs: Edited sting shows my clips and the library button", e.is_visible("#sting-mine") and e.is_visible("#sting-lib") and not e.is_visible("#sting-stock"))
    e.select_option("#sting-mine", "1"); e.click(".sting-use"); e.wait_for_timeout(1200)
    s = sheet()["c"]
    check("a clip of my own file: the file goes with it, cut the same", s and s["src"] == "file" and s["name"] == "Sarah's walk-on" and s.get("end") == 3 and s.get("fadeIn") == 100 and s["key"], s)
    check("… and remembers its library clip", s and s.get("lib") == "Sarah's walk-on", s)

    # with the dialog open, the library changes in its own tab: the dialog follows
    e.click(row("d") + " button[data-act=sadd]"); e.wait_for_timeout(500)
    stockOpts = lambda: e.evaluate("[...document.querySelectorAll('#sting-stock option')].map(o => o.textContent)")
    mineOpts = lambda: e.evaluate("[...document.querySelectorAll('#sting-mine option')].map(o => o.textContent.split(' · ')[0])")
    check("(the original is hidden while its clip exists)", not any(o.startswith("Song ·") for o in stockOpts()), stockOpts())
    lib.on("dialog", lambda d: d.accept())
    lib.click('.sl-mine li[data-i="0"] button[data-a=del]'); lib.wait_for_timeout(600)
    check("the clip deleted in the library: gone from the open dialog, its original back", mineOpts() == ["Sarah's walk-on"] and any(o.startswith("Song ·") for o in stockOpts()), (mineOpts(), stockOpts()))
    lib.click('.sl-stock li[data-s="0"] button[data-a=clip]'); lib.wait_for_timeout(1200)
    lib.fill(".sc-name", "Fresh clip"); lib.click(".sc-save"); lib.wait_for_timeout(600)
    check("a new clip in the library: in the open dialog at once", mineOpts() == ["Sarah's walk-on", "Fresh clip"], mineOpts())
    # the library as a panel inside the run sheet editor
    e.click(".sting-tab[data-mode=edited]"); e.click("#sting-lib"); e.wait_for_timeout(800)
    check("Open the sting library: a panel over the editor, with my clips", e.is_visible(".sting-libwrap") and "Fresh clip" in e.inner_text(".sting-libwrap .sl-mine"))
    e.on("dialog", lambda d: d.accept())
    e.click('.sting-libwrap .sl-mine li[data-i="1"] button[data-a=del]'); e.wait_for_timeout(400)
    e.click(".sting-libdone"); e.wait_for_timeout(400)
    check("Done: back in the dialog, its list up to date", not e.is_visible(".sting-libwrap") and e.is_visible(".sting-dlg") and mineOpts() == ["Sarah's walk-on"], mineOpts())
    e.keyboard.press("Escape")

    # ✂ on a sting from the library: update the library too?
    e.click(row("c") + " button[data-act=strim]"); e.wait_for_timeout(1500)
    e.fill(".sc-t[data-k=end]", "2.5"); e.press(".sc-t[data-k=end]", "Tab")
    e.fill(".sc-name", "Sarah's walk-on (short)"); e.click(".sc-save"); e.wait_for_timeout(400)
    check("saving asks whether to update the library", e.locator(".ask").count() == 1 and "sting library" in e.inner_text(".ask .ask-text"))
    e.click(".ask button:has-text('Update the library')"); e.wait_for_timeout(500)
    libnow = e.evaluate("StingLibrary.read().map(x => [x.name, x.end])")
    check("… the library clip gets the new name and cut", ["Sarah's walk-on (short)", 2.5] in libnow and not any(n == "Sarah's walk-on" for n, _ in libnow), libnow)
    s = sheet()["c"]
    check("… and so does the item (still linked to it)", s and s.get("end") == 2.5 and s.get("lib") == "Sarah's walk-on (short)", s)

    # a loop: part of the track repeated to make the sting longer (built in memory, so limited)
    e.click(row("a") + " button[data-act=strim]"); e.wait_for_timeout(1500)
    e.fill(".sc-t[data-k=end]", "7"); e.press(".sc-t[data-k=end]", "Tab")
    lp = lambda: e.evaluate("document.querySelector('.sc-wrap').__loop()")
    ob = e.locator(".sc-over").bounding_box(); X = lambda t: ob["x"] + t / 8 * ob["width"]
    e.keyboard.down("Shift"); e.mouse.move(X(4), ob["y"] + 40); e.mouse.down(); e.mouse.move(X(5), ob["y"] + 40); e.mouse.move(X(6), ob["y"] + 40); e.mouse.up(); e.keyboard.up("Shift")
    l = lp()
    check("Shift+drag on the whole track marks a loop", l and abs(l["from"] - 4) < 0.1 and abs(l["to"] - 6) < 0.1 and l["plays"] == 2 and e.is_visible(".sc-looprow"), l)
    e.click(".sc-lremove")
    check("Remove loop", lp() is None and not e.is_visible(".sc-looprow") and e.is_visible(".sc-addloop"))
    e.click(".sc-addloop")
    check("Add a loop: the middle of the part", lp() == {"from": 4, "to": 5, "plays": 2}, lp())
    e.fill(".sc-t[data-k=lfrom]", "2.5"); e.press(".sc-t[data-k=lfrom]", "Tab")
    e.fill(".sc-t[data-k=lto]", "3"); e.press(".sc-t[data-k=lto]", "Tab")
    e.fill(".sc-ms[data-k=plays]", "4"); e.press(".sc-ms[data-k=plays]", "Tab")
    check("plays 4 times in place: the part grows by 3 copies", lp() == {"from": 2.5, "to": 3, "plays": 4} and e.inner_text(".sc-len") == "6.50 s", (lp(), e.inner_text(".sc-len")))
    ob = e.locator(".sc-over").bounding_box()      # (the dialog grew with the loop's row: it's centred, so the canvas moved)
    e.mouse.move(X(3) + 4, ob["y"] + 7); e.mouse.down(); e.mouse.move(X(4), ob["y"] + 7); e.mouse.move(X(5), ob["y"] + 7); e.mouse.up()
    l = lp()
    check("dragging the ⟲ tab moves the repeats (4 copies there, the loop's own place as it was)", l and abs(l.get("at", 0) - 5) < 0.1 and e.inner_text(".sc-len") == "7.00 s", (l, e.inner_text(".sc-len")))
    e.screenshot(path=OUTDIR + "/clip_loop.png")
    e.click(".sc-lback")
    check("Put back: in place again", "at" not in lp() and e.input_value(".sc-t[data-k=at]") == "", lp())
    e.click(".sc-lprev"); e.wait_for_timeout(1300)      # the loop is 0.5 s: it's been round twice
    check("▶ Preview loop: plays the loop over and over", playing() == {"from": 2.5, "to": 3, "loop": True} and e.inner_text(".sc-lprev") == "■ Stop preview", playing())
    ob = e.locator(".sc-over").bounding_box()
    e.mouse.move(X(3), ob["y"] + 40); e.mouse.down(); e.mouse.move(X(3.5), ob["y"] + 40); e.mouse.move(X(4), ob["y"] + 40); e.wait_for_timeout(150)
    check("… while an edge is dragged it keeps playing the old loop", playing() == {"from": 2.5, "to": 3, "loop": True}, playing())
    e.mouse.up(); e.wait_for_timeout(150)
    pl = playing()
    check("… and starts again with the new loop when it's let go of", pl and pl.get("loop") and abs(pl["to"] - 4) < 0.1, pl)
    e.click(".sc-lprev"); e.wait_for_timeout(100)
    check("… ■ Stop preview stops it", playing() is None and e.inner_text(".sc-lprev") == "▶ Preview loop", playing())
    e.fill(".sc-t[data-k=lto]", "3"); e.press(".sc-t[data-k=lto]", "Tab")
    e.click(".sc-lplay"); e.wait_for_timeout(150)
    check("▶ Around the loop: 2 s either side of the repeats", playing() == {"from": 2, "to": 5}, playing())
    e.click(".sc-stop")
    e.fill(".sc-t[data-k=lfrom]", "0"); e.press(".sc-t[data-k=lfrom]", "Tab")
    e.fill(".sc-ms[data-k=plays]", "40"); e.press(".sc-ms[data-k=plays]", "Tab")
    e.click(".sc-save"); e.wait_for_timeout(200)
    check("too long to keep as a clip (the last play would start after 1:30): not saved, says why", e.locator(".sc-wrap").count() == 1 and "1:30" in e.inner_text(".sc-lnote") and "WAV" in e.inner_text(".sc-msg"), (e.inner_text(".sc-lnote"), e.inner_text(".sc-msg")))
    with e.expect_download() as dl: e.click(".sc-wav")
    raw = open(dl.value.path(), "rb").read()
    ch, sr = struct.unpack("<HI", raw[22:28]); secs = struct.unpack("<I", raw[40:44])[0] / (sr * ch * 2)
    check("Save as WAV: the long edit as a file of its own", raw[:4] == b"RIFF" and dl.value.suggested_filename.endswith(".wav") and abs(secs - (5 + 39 * 3)) < 0.05, (dl.value.suggested_filename, secs))
    e.fill(".sc-ms[data-k=plays]", "3"); e.press(".sc-ms[data-k=plays]", "Tab")
    e.click(".sc-save"); e.wait_for_timeout(500)
    s = sheet()["a"]
    check("the sting keeps its loop", s and s.get("loop") == {"from": 0, "to": 3, "plays": 3} and s.get("end") == 7, s)
    t.evaluate("window.stingPlayer.play(JSON.parse(localStorage.runsheet).items[0])"); t.wait_for_timeout(700)
    st = t.evaluate("window.stingPlayer.state()")
    check("the timer builds the loop in memory and plays it", st["audio"] and abs(st["audio"]["duration"] - 11) < 0.05, st)
    t.evaluate("window.stingPlayer.stop()")

    # import on another computer: the file is asked for once
    c2 = b.new_context(ignore_https_errors=True); c2.add_init_script("window.TimerFeatures={stings:true}"); c2.route("**/*", h)
    lib2 = c2.new_page(); lib2.on("pageerror", lambda x: errs.append("library2: " + str(x))); lib2.goto(BASE + "stings.html"); lib2.wait_for_timeout(600)
    path = os.path.join(OUTDIR, "sting-library.json"); open(path, "w").write(json.dumps(exported))
    with lib2.expect_file_chooser() as fc: lib2.click("button[data-a=import]")
    fc.value.set_files(path); lib2.wait_for_timeout(800)
    check("import: the clips arrive", len(lib2.evaluate("window.__stingLibrary.list()")) == 2)
    check("import: a file clip needs its file", lib2.evaluate("window.__stingLibrary.missing()") == ["Sarah's walk-on"] and lib2.is_visible("button[data-a=find]"))
    with lib2.expect_file_chooser() as fc: lib2.click("button[data-a=find]")
    fc.value.set_files(folder); lib2.wait_for_timeout(800)
    check("Find files…: matched by name and size", lib2.evaluate("window.__stingLibrary.missing()") == [], lib2.evaluate("window.__stingLibrary.missing()"))
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
