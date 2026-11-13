import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Soundboard mode (playout.html?soundboard, /s on the hosted site; the owner, 13 Nov 2026): the playout page with
# a run sheet of your own and no timer. From the pairing screen's Soundboard mode; titled Soundboard, no word of
# the timer; items added (a name and a length), pasted as a list, or dropped as files (an item each, named after
# the file, its length, the file its At the start cue); ✎ renames and sets the length, ↑ ↓ move, ✕ removes;
# Save… / Load… a file (on the same computer the media stays; elsewhere Find files… matches it by name and size);
# Clear run sheet… empties it; its own storage. And one playout page per browser: a second tab is covered
# (Use this tab instead takes over; the first takes over again when the second closes).
import io, json, math, mimetypes, os, re, struct, sys, time, wave
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
def tone(sec, hz, amp=6000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b"".join(struct.pack("<h", int(amp * math.sin(2 * math.pi * hz * i / 8000))) for i in range(int(8000 * sec))))
    return buf.getvalue()
FILES = {"02 Walk on.wav": tone(3, 440), "10 Big finish.wav": tone(5, 660)}
TMP = os.path.join(OUTDIR, "soundboard_files"); os.makedirs(TMP, exist_ok=True)
for n, d in FILES.items(): open(os.path.join(TMP, n), "wb").write(d)
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)
DROP = """([files, sel]) => {
  const dt = new DataTransfer();
  for (const [n, b64] of files) dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], n, { type: n.endsWith('.wav') ? 'audio/wav' : 'text/plain' }));
  const t = document.querySelector(sel), ev = k => t.dispatchEvent(new DragEvent(k, { dataTransfer: dt, bubbles: true, cancelable: true }));
  ev('dragover'); const shown = !document.getElementById('sbdrop').hidden; ev('drop'); return shown;
}"""
import base64
B64 = lambda d: base64.b64encode(d).decode()

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1200, "height": 900}, accept_downloads=True)
    c.add_init_script("window.TimerFeatures = { playout: true };")
    c.route("**/*", h)
    po = c.new_page(); po.on("pageerror", lambda e: errs.append("soundboard: " + str(e)))
    said = []
    po.on("dialog", lambda d: (said.append(d.message), d.accept()))
    po.goto(BASE + "playout.html"); po.wait_for_timeout(800)
    check("the pairing screen offers Soundboard mode", po.is_visible("#trysb"))
    po.click("#trysb"); po.wait_for_timeout(1000)
    check("… which opens the page in soundboard mode", po.url.endswith("playout.html?soundboard") and po.is_visible("#sbbar"), po.url)
    check("titled Soundboard", po.text_content("main > h1") == "Soundboard" and po.title().endswith(" - Soundboard"), [po.text_content("main > h1"), po.title()])
    seen = po.evaluate("document.querySelector('main').innerText")
    check("… and nothing on it speaks of a timer", "timer" not in seen.lower(), [l for l in seen.split("\n") if "timer" in l.lower()])
    check("an empty run sheet, saying how to fill it", "No items yet" in po.text_content("#items"))

    # adding: a name and a length (minutes, m:ss…), else 20 minutes; a pasted list
    items = lambda: po.evaluate("window.__playout.show().items.map(x => [x.n, x.d])")
    po.fill("#sb-name", "Welcome"); po.fill("#sb-len", "5"); po.press("#sb-name", "Enter"); po.wait_for_timeout(200)
    po.fill("#sb-name", "Keynote"); po.click("#sb-add"); po.wait_for_timeout(200)
    check("+ Add item: a name and a length (5 = minutes; none: 20 minutes)", items() == [["Welcome", 300], ["Keynote", 1200]], items())
    check("… the boxes empty, the name box ready for the next one", po.evaluate("document.activeElement.id") == "sb-name" and po.input_value("#sb-name") == "" and po.input_value("#sb-len") == "")
    po.fill("#sb-name", "Bad"); po.fill("#sb-len", "lots"); po.click("#sb-add"); po.wait_for_timeout(200)
    check("a length it can't read: said, nothing added", len(items()) == 2 and said and "isn’t one I can read" in said[-1], [items(), said[-1:]])
    po.fill("#sb-name", ""); po.fill("#sb-len", "")
    po.click("#sb-pastebtn"); po.fill("#sb-paste", "Name, Length\nPanel, 30\nBreak\t15\nWalk-on music 3:30\nAwards"); po.wait_for_timeout(100)
    check("Paste a list…: it counts them (a header line skipped)", po.text_content("#sb-pastenote") == "4 items", po.text_content("#sb-pastenote"))
    po.click("#sb-pasteok"); po.wait_for_timeout(300)
    check("… added: a length after a comma, a tab or a space (m:ss), else 20 minutes", items()[2:] == [["Panel", 1800], ["Break", 900], ["Walk-on music", 210], ["Awards", 1200]], items())

    # ↑ ↓, ✎ (its name, its length, notes), ✕
    li = lambda n: '#items li[data-id="%s"]' % po.evaluate("n => window.__playout.show().items.find(x => x.n === n).id", n)
    po.click(li("Break") + " button[data-act=up]"); po.wait_for_timeout(200)
    check("↑ moves an item up", [x[0] for x in items()][2:4] == ["Break", "Panel"], items())
    po.click(li("Keynote") + " button[data-act=name]"); po.wait_for_timeout(200)
    po.fill(li("Keynote") + " form.iedit textarea", "Keynote: Dr Lee\nBring the clicker"); po.fill(li("Keynote") + " input[data-name=len]", "45")
    po.click(li("Keynote") + " form.iedit button.primary"); po.wait_for_timeout(300)
    kid = po.evaluate("window.__playout.show().items[1].id")
    check("✎: renamed, its length set, the rest as notes", items()[1] == ["Keynote: Dr Lee", 2700] and po.text_content('#items li[data-id="%s"] .inotes' % kid) == "Bring the clicker", [items()[1], po.text_content('#items li[data-id="%s"]' % kid)])
    po.click(li("Awards") + " button[data-act=delitem]"); po.wait_for_timeout(300)
    check("✕ removes an item (asked first)", "Awards" not in [x[0] for x in items()] and "Remove “Awards”" in said[-1], said[-1:])

    # a folder (files) dropped on the page: an item each, named after the file, its length, the file its start cue
    shown = po.evaluate(DROP, [[[n, B64(d)] for n, d in FILES.items()] + [["notes.txt", B64(b"hello")]], "#items"])
    po.wait_for_function("window.__playout.show().items.length === 7", timeout=15000); po.wait_for_timeout(500)
    it = items()
    check("files dropped on the page (the drop shown as they're dragged): an item each, in name order, its length the file's", shown and it[-2:] == [["02 Walk on", 3], ["10 Big finish", 5]], [shown, it[-2:]])
    cs = po.evaluate("Object.fromEntries(window.__playout.show().items.slice(-2).map(x => [x.n, (window.__playout.cues()[x.id] || []).map(c => [c.trigger, c.src, c.file])]))")
    check("… each with its file as its At the start cue (a text file left out)", cs == {"02 Walk on": [["start", "file", "02 Walk on.wav"]], "10 Big finish": [["start", "file", "10 Big finish.wav"]]}, cs)
    faces = po.evaluate("window.__playoutDeck.faces('mk2')")
    check("… and a key each; no → timer (no timer page here)", faces[:2] == ["02 Walk on", "10 Big finish"] and not any("timer" in f for f in faces), faces)
    wid = po.evaluate("window.__playout.show().items[6].id")
    po.click('#items li[data-id="%s"] button[data-act=run]' % wid); po.wait_for_timeout(500)
    check("▶ Start item plays its file", len(po.evaluate("window.__playout.playing()")) == 1, po.evaluate("window.__playout.playing()"))
    po.click("#stopall"); po.wait_for_timeout(200)
    check("its own storage (not the demo's or a real show's)", po.evaluate("[!!localStorage.playout_board_sheet, !!localStorage.playout_board_cues, localStorage.playout_cues ?? null, localStorage.playout_demo_cues ?? null]") == [True, True, None, None])
    po.screenshot(path=OUTDIR + "/playout_soundboard.png", full_page=True)

    # Save… / Load…: on this computer the files stay
    with po.expect_download() as dl: po.click("#sb-save")
    path = os.path.join(TMP, "saved.json"); dl.value.save_as(path)
    saved = json.load(open(path))
    check("Save…: a file of its items, cues and notes", saved["kind"] == "timed-show soundboard" and len(saved["items"]) == 7 and len([k for k in saved["cues"] if saved["cues"][k]]) == 2 and saved["notes"].get(kid, {}).get("text", "").startswith("Keynote"), [len(saved["items"]), list(saved["cues"]), list(saved["notes"])])
    po.set_input_files("#sb-file", path); po.wait_for_timeout(1500)
    check("Load… on the same computer: asked, the same board back, its files still here", "Replace this soundboard" in said[-1] and items() == it and po.is_hidden("#sb-missing"), [said[-1:], items()])

    # Clear run sheet…: everything goes, files too
    po.click("#sb-clear"); po.wait_for_timeout(800)
    check("Clear run sheet…: asked, then every item, cue and file gone", "Clear the soundboard" in said[-1] and items() == [] and po.evaluate("window.__playout.cues()") == {}
          and po.evaluate("Promise.all(%s.map(id => videoStore.get('pocue:' + id))).then(l => l.every(x => !x))" % json.dumps([c["id"] for l in saved["cues"].values() for c in l])), [items(), said[-1:]])

    # Load… elsewhere (the files gone): Find files… matches them by name and size
    po.set_input_files("#sb-file", path); po.wait_for_timeout(1500)
    check("Load… with the files not here: the board back, the missing files listed", len(items()) == 7 and po.is_visible("#sb-missing") and "2 cues’ files aren’t on this computer" in po.text_content("#sb-missingtext"), [items(), po.text_content("#sb-missingtext")])
    po.set_input_files("#sb-folder", TMP); po.wait_for_timeout(1500)   # (a folder: the files matched by name and size)
    check("Find files…: both found, none missing", po.is_hidden("#sb-missing") and "Found 2 files" in said[-1], said[-1:])
    po.click('#items li[data-id="%s"] button[data-act=run]' % wid); po.wait_for_timeout(500)
    check("… and they play", len(po.evaluate("window.__playout.playing()")) == 1)
    po.click("#stopall")

    # Playlist flow (the owner, 13 Nov 2026): the items one after another, crossfading over 5 s (half a short one); 🔁 Loop
    po.click("#sb-clear"); po.wait_for_timeout(800)
    FLOW = {"A.wav": tone(12, 440, 3000), "B.wav": tone(12, 440, 6000), "C.wav": tone(12, 440, 12000)}   # (12 s each: the next from 5 s before the end; quiet, middling, loud)
    po.evaluate("""() => { window.__lv = { icons: new Set(), scan: false };   // (what the rows and the level box say while they're measured)
      new MutationObserver(() => { document.querySelectorAll('#items .clv').forEach(e => window.__lv.icons.add(e.textContent.slice(0, 1)));
        if (/Measuring loudness: \\d+ of 3/.test(document.getElementById('levelbox').textContent)) window.__lv.scan = true; })
        .observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); }""")
    po.evaluate(DROP, [[[n, B64(d)] for n, d in FLOW.items()], "#items"])
    po.wait_for_function("window.__playout.show().items.length === 3", timeout=15000)
    po.wait_for_function("Object.values(window.__playout.cues()).flat().every(c => Number.isFinite(c.lufs))", timeout=20000); po.wait_for_timeout(300)
    lv = po.evaluate("[...document.querySelectorAll('#items .clv')].map(e => [e.textContent, e.title])")
    seen = po.evaluate("({ icons: [...window.__lv.icons], scan: window.__lv.scan })")
    check("levels: each file waits ⌛, is measured ⏳, the level box counting (Measuring loudness: n of 3…)", "⏳" in seen["icons"] and seen["scan"], seen)
    check("… then each row its loudness: the quietest 🔈 (it sets the level), the loudest 🔊 (turned down), the rest 🔉", [x[0][:1] for x in lv] == ["🔈", "🔉", "🔊"] and "sets the level" in lv[0][1] and re.search(r"turned down 1(1\.9|2\.0|2\.1) dB", lv[2][1]) and lv[1][0].startswith("🔉 −"), lv)
    check("… and the level box stops counting", "Measuring" not in po.text_content("#levelbox"), po.text_content("#levelbox"))
    ids = po.evaluate("window.__playout.show().items.map(x => x.id)")
    cue = lambda i: po.evaluate("window.__playout.cues()[%s][0].id" % json.dumps(ids[i]))
    ca, cb, cc = cue(0), cue(1), cue(2)
    gain = lambda cid: po.evaluate("window.__playout.gain(%s)" % json.dumps(cid))
    fl = lambda: po.evaluate("window.__playout.flow()")
    now = lambda: sorted(po.evaluate("window.__playout.playing()"))
    run = lambda i: po.click('#items li[data-id="%s"] button[data-act=run]' % ids[i])
    until = lambda t: po.wait_for_timeout(max(0, int((t - time.time()) * 1000)))
    check("Playlist flow and 🔁 Loop: chips, off to begin with", po.get_attribute("#sb-flow", "aria-pressed") == "false" and po.get_attribute("#sb-loop", "aria-pressed") == "false")
    # Minimal run sheet view: the items without their cues; by choice, and always with the flow on
    shown = lambda: po.is_visible("#items .cues")
    check("Minimal run sheet view: a chip, off; the cues shown", po.get_attribute("#sb-minimal", "aria-pressed") == "false" and shown())
    po.click("#sb-minimal")
    check("… on: only the items (▶ Start item still there)", po.get_attribute("#sb-minimal", "aria-pressed") == "true" and not shown() and po.is_visible('#items li[data-id="%s"] button[data-act=run]' % ids[0]) and po.evaluate("localStorage.playout_board_minimal") == "1")
    po.click("#sb-minimal")
    check("… off again: the cues back", shown() and po.get_attribute("#sb-minimal", "aria-pressed") == "false")
    po.click("#sb-flow")
    check("… Playlist flow on: the minimal view with it, its chip lit (and held)", not shown() and po.get_attribute("#sb-minimal", "aria-pressed") == "true" and "held" in po.get_attribute("#sb-minimal", "class"))
    po.click("#sb-minimal")
    check("… a click on it then changes nothing", not shown() and po.evaluate("localStorage.playout_board_minimal ?? null") is None)
    check("… Playlist flow on: lit, and says what it does", po.get_attribute("#sb-flow", "aria-pressed") == "true" and po.evaluate("localStorage.playout_board_flow") == "1" and po.text_content("#sb-flowhint").startswith("On: start an item"), po.text_content("#sb-flowhint"))
    run(0); t0 = time.time(); po.wait_for_timeout(1000)
    check("an item started: the flow on it, the next named", fl() == {"item": ids[0], "heard": True, "crossed": False} and po.text_content("#sb-flowhint") == "Next: B" and now() == [ca], [fl(), po.text_content("#sb-flowhint"), now()])
    until(t0 + 8); g1 = [gain(ca), gain(cb)]; until(t0 + 10); g2 = [gain(ca), gain(cb)]
    check("5 s before its end: the next starts, one fading out as the other fades in", fl()["item"] == ids[1] and now() == sorted([ca, cb])
          and g1[1] is not None and g2[0] < g1[0] and g2[1] > g1[1], [fl(), now(), g1, g2])
    until(t0 + 13)
    check("… then only the next plays, at its level (6 dB louder than the first: turned down 6 dB)", now() == [cb] and abs(gain(cb) - 0.501) < 0.03, [now(), gain(cb), g1])
    run(2); po.wait_for_timeout(700)
    gc1, gb1 = gain(cc), gain(cb); po.wait_for_timeout(500); gc2, gb2 = gain(cc), gain(cb)
    check("starting another item jumps there: it plays at once at its level, the one before fades", fl()["item"] == ids[2] and None not in (gc1, gc2, gb1, gb2) and abs(gc1 - gc2) < 0.02 and gc1 > 0.1 and gb2 < gb1, [fl(), now(), gc1, gc2, gb1, gb2])
    check("… the last: it plays out", po.text_content("#sb-flowhint").startswith("This is the last: it plays out"), po.text_content("#sb-flowhint"))
    t1 = time.time(); until(t1 + 12.5)
    check("… and the flow ends with it (🔁 off)", fl() is None and now() == [], [fl(), now()])
    po.click("#sb-loop")
    check("🔁 Loop on: lit", po.get_attribute("#sb-loop", "aria-pressed") == "true" and po.evaluate("localStorage.playout_board_flow_loop") == "1")
    run(2); t2 = time.time(); po.wait_for_timeout(800)
    check("… the last item's next is the first", po.text_content("#sb-flowhint") == "Next: A", po.text_content("#sb-flowhint"))
    until(t2 + 8.5)
    check("… and after it, round again", fl() and fl()["item"] == ids[0] and ca in now(), [fl(), now()])
    po.locator("#sbbar").screenshot(path=OUTDIR + "/playout_flow.png")
    po.click("#stopall"); po.wait_for_timeout(300)
    check("Stop all ends the flow", fl() is None and now() == [])
    # with Crossfade on release, a key jumping the flow leaves what's playing alone until it's let go
    po.check("#deckxfade"); po.fill("#deckxfades", "1"); po.press("#deckxfades", "Tab")
    keys = po.evaluate("window.__playoutDeck.slots()")
    run(0); po.wait_for_timeout(1500); ga = gain(ca)
    po.evaluate("window.__playoutDeck.screen(%d, true)" % keys.index(ids[1])); po.wait_for_timeout(800)
    check("Crossfade on release: a key jumping the flow, held: the track playing plays on as it was", fl()["item"] == ids[1] and now() == sorted([ca, cb]) and abs(gain(ca) - ga) < 0.01, [fl(), now(), ga, gain(ca)])
    po.evaluate("window.__playoutDeck.screen(%d, false)" % keys.index(ids[1])); po.wait_for_timeout(500)
    check("… let go: it fades from then", gain(ca) is not None and gain(ca) < ga * 0.6, [ga, gain(ca)])
    po.wait_for_timeout(800)
    check("… and is gone; the flow carries on from the new one", now() == [cb] and fl()["item"] == ids[1], [now(), fl()])
    po.uncheck("#deckxfade"); po.click("#stopall"); po.wait_for_timeout(300)
    # 🔀 Shuffle: each item once in a random order, the next picked ahead (the hint names it); with 🔁 a new round
    hint = lambda: po.text_content("#sb-flowhint")
    nxt = lambda: hint()[len("Next: "):-len(" (shuffled)")] if hint().startswith("Next: ") and hint().endswith(" (shuffled)") else None
    po.click("#sb-loop"); po.click("#sb-shuffle")
    check("🔀 Shuffle: a chip beside them, lit, kept", po.get_attribute("#sb-shuffle", "aria-pressed") == "true" and po.evaluate("localStorage.playout_board_flow_shuffle") == "1" and "in a random order" in hint(), hint())
    run(1); po.wait_for_timeout(600); n1 = nxt(); po.wait_for_timeout(400)
    check("an item started: the next picked at random from the others, and it stays picked", n1 in ("A", "C") and nxt() == n1, [hint(), n1])
    run(["A", "B", "C"].index(n1)); po.wait_for_timeout(600)
    left = ({"A", "C"} - {n1}).pop()
    check("… a jump carries the round on: the one not played yet is next", nxt() == left, hint())
    run(["A", "B", "C"].index(left)); po.wait_for_timeout(600)
    check("… all played: the last of the round plays out (🔁 off)", hint() == "This is the last of this round: it plays out (🔁 to go round again).", hint())
    po.click("#sb-loop"); po.wait_for_timeout(300)
    check("… 🔁 on: a new round, not the one just played", nxt() in ("A", "B", "C") and nxt() != left, [hint(), left])
    po.click("#stopall"); po.click("#sb-shuffle"); po.wait_for_timeout(300)
    # a video flowing into a video: no crossfade (one picture: the owner); it plays to its end, then the next starts
    po.evaluate("(ids) => { const c = window.__playout.cues(); for (const id of ids) c[id][0].media = 'video'; }", ids[:2])
    run(0); t4 = time.time(); until(t4 + 9)
    check("a video into a video: no crossfade (the first plays on past the crossfade point, alone)", now() == [ca] and fl()["item"] == ids[0], [now(), fl()])
    until(t4 + 13.5)
    check("… at its end, the next starts", now() == [cb] and fl()["item"] == ids[1], [now(), fl()])
    po.click("#stopall"); po.wait_for_timeout(300)
    po.evaluate("(ids) => { const c = window.__playout.cues(); for (const id of ids) c[id][0].media = 'audio'; }", ids[:2])
    po.click("#sb-flow"); run(0); t3 = time.time(); until(t3 + 8.5)
    check("Playlist flow off: an item plays alone; the cues shown again", now() == [ca] and fl() is None and po.get_attribute("#sb-flow", "aria-pressed") == "false" and shown(), [now(), fl()])
    po.click("#stopall"); po.wait_for_timeout(200)

    # one playout page per browser
    p2 = c.new_page(); p2.on("pageerror", lambda e: errs.append("second tab: " + str(e)))
    p2.goto(BASE + "playout.html?demo"); p2.wait_for_timeout(1000)
    check("a second playout tab: covered, saying what runs in the other", p2.is_visible("#othertab") and "Soundboard is running in another tab" in p2.text_content("#othertabtext") and p2.is_hidden("#paired"), p2.text_content("#othertabtext"))
    p2.click("#othertake"); p2.wait_for_timeout(1500)
    check("Use this tab instead: it runs (the demo)", p2.is_hidden("#othertab") and p2.is_visible("#demobar"))
    check("… and the first tab steps down: covered", po.is_visible("#othertab") and "The playout demo is running" in po.text_content("#othertabtext"), po.text_content("#othertabtext"))
    p2.close(); po.wait_for_timeout(1500)
    check("the other tab closed: the first takes over by itself", po.is_hidden("#othertab") and po.is_visible("#sbbar") and len(items()) == 3)   # (the playlist flow's three)

    po.click("#sb-leave"); po.wait_for_timeout(800)
    check("Leave soundboard mode: the pairing screen", po.url.endswith("playout.html") and po.is_visible("#enter"), po.url)
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
