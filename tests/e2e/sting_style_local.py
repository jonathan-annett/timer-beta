import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Files of your own, listened to for their styles (step 4: StingStyles.listen, a trial): on the playout demo,
# ticking The folder in Random stings listens to its audio files in the background, one at a time, a note
# saying how far it's got and the hint how many aren't done yet; each is kept in this browser by name and size
# (sting_styles_local; one that can't be listened to, too short or not audio, kept as 0, an AIFF as WAV first);
# the chips then count them and 🎲 picks them in their styles. My clips' own files too. The + sting dialog's
# chips sit above the tabs and filter the folder's list as well. A reload doesn't listen again. A model that
# doesn't load stops it without marking any file. Uses the real model (tests/e2e/.models: npm run test:setup).
# (Listening is TimerFeatures.listen, alpha only; without it, as on beta, your files count as in the lit styles.)
import base64, json, math, mimetypes, os, random, struct, sys, wave, io
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
MODELS = os.path.join(HERE, ".models")
ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/"
if not os.path.isfile(os.path.join(MODELS, "discogs-effnet-bsdynamic-1.onnx")):
    print("FAIL the model isn't in tests/e2e/.models: run npm run test:setup"); sys.exit(1)
STOCK = {"stings": [{"name": "Stock one", "url": BASE + "media/stock1.wav", "media": "audio", "duration": 8,
                     "styles": [[0, 0.5]]}]}   # (Boogie Woogie: styles on, nothing to do with the files)

def beat(sec, seed, rate):                     # a made-up loop: kick, hats and a chord (music enough to have styles)
    r, n, bpm = random.Random(seed), int(sec * rate), 118 + 9 * seed
    out = []
    for i in range(n):
        t = i / rate; b = (t * bpm / 60) % 1 * 60 / bpm; h = (t * bpm / 30) % 1 * 30 / bpm
        v = 0.6 * math.sin(2 * math.pi * 55 * b) * math.exp(-b * 18) + 0.3 * (r.random() * 2 - 1) * math.exp(-h * 60)
        v += 0.12 * sum(math.sin(2 * math.pi * f * (1 + 0.1 * seed) * t) for f in (220, 277, 330))
        out.append(max(-1.0, min(1.0, v)))
    return out
def wav(vals, rate):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(v * 30000)) for v in vals))
    return buf.getvalue()
def aiff(vals, rate):                          # 16-bit mono AIFF (Chrome can't decode it: made a WAV first)
    e = math.floor(math.log2(rate)); rate80 = struct.pack(">HQ", e + 16383, int(rate * 2 ** (63 - e)))
    data = b"".join(struct.pack(">h", int(v * 30000)) for v in vals)
    chunk = lambda cid, body: cid + struct.pack(">I", len(body)) + body + (b"\x00" if len(body) % 2 else b"")
    form = b"AIFF" + chunk(b"COMM", struct.pack(">hIh", 1, len(vals), 16) + rate80) + chunk(b"SSND", struct.pack(">II", 0, 0) + data)
    return b"FORM" + struct.pack(">I", len(form)) + form
FILES = [("Song one.wav", wav(beat(3, 1, 16000), 16000)), ("Song two.wav", wav(beat(4, 2, 16000), 16000)),
         ("sub/Song three.wav", wav(beat(5, 3, 16000), 16000)), ("Take 4.aiff", aiff(beat(2.5, 4, 22050), 22050)),
         ("Too short.wav", wav(beat(0.5, 5, 16000), 16000)), ("Broken.mp3", bytes(random.Random(9).randrange(256) for _ in range(3001)))]
GOOD, BAD = 4, 2
LIB = ("Library song.wav", wav(beat(3.5, 6, 16000), 16000))

def handler(model_ok):
    def h(route, req):
        u = req.url
        if u.startswith(ORT):
            fp = os.path.join(MODELS, "ort", u[len(ORT):].split("?")[0])
            if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": "application/wasm" if fp.endswith(".wasm") else "text/javascript"})
            return route.fulfill(status=404, body=b"")
        if not u.startswith(BASE): return route.abort()
        name = u[len(BASE):].split("?")[0].split("#")[0]
        if name == "stock-stings.json": return route.fulfill(status=200, body=json.dumps(STOCK), headers={"content-type": "application/json"})
        if name == "changelog.html": return route.fulfill(status=404, body=b"")
        if name == "media/stock1.wav": return route.fulfill(status=200, body=wav(beat(8, 7, 8000), 8000), headers={"content-type": "audio/wav"})
        if name.startswith("models/"):
            if not model_ok: return route.fulfill(status=404, body=b"")
            return route.fulfill(status=200, body=open(os.path.join(MODELS, name[7:]), "rb").read(), headers={"content-type": "application/octet-stream"})
        fp = os.path.join(PUBLIC, name)
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return h
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)
SET_FOLDER = """files => window.__stingFolder({ name: 'My songs', files: files.map(([path, b64]) =>
  ({ path, file: new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], path.split('/').pop()) })) })"""
B64 = [[p, base64.b64encode(d).decode()] for p, d in FILES]
key = lambda name, data: name.split("/")[-1] + "|" + str(len(data))

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1100, "height": 1000})
    c.add_init_script("window.TimerFeatures = { playout: true, stings: true, styles: true, listen: true };")
    c.route("**/*", handler(True))
    po = c.new_page(); po.on("pageerror", lambda e: errs.append("playout: " + str(e)))
    po.on("dialog", lambda d: d.dismiss())          # (OK to reuse? no)
    po.goto(BASE + "playout.html?demo"); po.wait_for_timeout(1000)
    po.evaluate(SET_FOLDER, B64)
    po.click("#rollpanel summary"); po.wait_for_timeout(300)
    po.uncheck("#roll-stock"); po.uncheck("#roll-mine"); po.check("#roll-folder"); po.wait_for_timeout(600)
    hint, note = po.text_content("#roll-stylehint"), po.text_content("#roll-listen")
    check("The folder ticked: its files are listened to, the note says how far", note.startswith("Listening to your files for their styles: ") and note.endswith(" of 6…"), note)
    check("… and the hint how many aren't done yet", "of your files not listened to yet" in hint, hint)
    po.wait_for_function("!StingStyles.listening().busy", timeout=180000)
    po.wait_for_timeout(1500)
    cache = json.loads(po.evaluate("localStorage.sting_styles_local"))
    got = {k: v["s"] for k, v in cache["files"].items()}
    good = [key(n, d) for n, d in FILES[:GOOD]]
    check("each file kept by name and size, with its top styles (an AIFF too)", all(isinstance(got.get(k), list) and len(got[k]) == 20 for k in good) and cache["model"] == "discogs-effnet-bsdynamic-1", list(got))
    check("… one too short, one not audio: kept as couldn't (not tried again)", got.get(key(*FILES[4])) == 0 and got.get(key(*FILES[5])) == 0, [got.get(key(*FILES[4])), got.get(key(*FILES[5]))])
    check("… the note goes; the hint says which couldn't", po.text_content("#roll-listen") == "" and po.text_content("#roll-stylehint") == "2 of your files couldn’t be listened to", [po.text_content("#roll-listen"), po.text_content("#roll-stylehint")])
    chips = po.evaluate("[...document.querySelectorAll('#roll-chips .ss-chip')].map(c => [c.dataset.k, Number(c.querySelector('i').textContent.slice(1, -1))])")
    check("the chips count the files now (stock unticked: only them)", chips and max(n for _, n in chips) <= GOOD and chips[0][1] >= 1, chips)
    k0, n0 = chips[0]
    po.click('#roll-chips .ss-chip[data-k="%s"]' % k0); po.wait_for_timeout(500)
    check("… one lit: the hint counts them as your own", po.text_content("#roll-stylehint").startswith("%d sting%s in that style (%d your own)" % (n0, "" if n0 == 1 else "s", n0)), po.text_content("#roll-stylehint"))
    po.click("#roll-all"); po.wait_for_timeout(5000)
    songs = po.evaluate("Object.values(window.__playout.cues()).flat().filter(c => c.rolled).map(c => c.song)")
    fits = po.evaluate("([k, files]) => files.filter(f => StingStyles.fitsAny(StingStyles.localOf(f), [k])).map(f => 'size:' + f.split('|')[1])", [k0, good])
    check("🎲 Roll stings in it: your files, only the ones in that style", songs and set(songs) <= set(fits) and len(set(songs)) == min(n0, len(songs)), [songs, fits])

    # My clips' own files are listened to too
    lib_b64 = base64.b64encode(LIB[1]).decode()
    po.evaluate("""async ([name, b64]) => { const f = new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name);
      const e = await StingLibrary.keepFile(f); StingLibrary.write([{ name: 'Library song', file: e.file, size: e.size, media: 'audio', duration: 3.5 }]); }""", [LIB[0], lib_b64])
    po.check("#roll-mine"); po.wait_for_timeout(600)
    check("My clips ticked: its own file listened to", po.text_content("#roll-listen") == "Listening to your files for their styles: 0 of 1…", po.text_content("#roll-listen"))
    po.wait_for_function("!StingStyles.listening().busy", timeout=60000)
    lib = json.loads(po.evaluate("localStorage.sting_styles_local"))["files"]
    check("… kept like the folder's", isinstance(lib.get(key(*LIB), {}).get("s"), list), [key(*LIB), {k: (v["s"] if not isinstance(v["s"], list) else "list") for k, v in lib.items()}])

    # the + cue dialog: the chips above the tabs, filtering the folder's list too
    po.click('#items li[data-id="demo-1"] button[data-act=add]')
    po.click('#items li[data-id="demo-1"] form.addcue button.primary'); po.wait_for_timeout(800)
    check("the dialog: the chips above the tabs", po.evaluate("!!(document.querySelector('.sting-dlg #sting-chips').compareDocumentPosition(document.querySelector('.sting-dlg .sting-tabs')) & Node.DOCUMENT_POSITION_FOLLOWING)"))
    po.click('.sting-tab[data-mode=custom]'); po.wait_for_timeout(200)
    fopts = lambda: po.evaluate("[...document.querySelectorAll('#sting-folder option')].map(o => o.textContent)")
    o = fopts()
    check("Custom file: the folder's files, each listened to with its top style", len(o) == 6 and sum(" · " in x for x in o) >= 1 and not any(" · " in x for x in o if x.startswith(("Too short", "Broken"))), o)
    check("… nothing left to listen to: no note", po.text_content("#sting-listen") == "", po.text_content("#sting-listen"))
    po.click('#sting-chips .ss-chip[data-k="%s"]' % k0); po.wait_for_timeout(300)
    o = fopts()
    infolder = [n.split("/")[-1].rsplit(".", 1)[0] for n, d in FILES[:GOOD] if po.evaluate("([k, f]) => StingStyles.fitsAny(StingStyles.localOf(f), [k])", [k0, key(n, d)])]
    check("… a chip lit: only the files in it, with the style they matched", sorted(x.split(" · ")[0].split("/")[-1] for x in o) == sorted(infolder) and po.text_content("#sting-foldername").startswith("In “My songs”, in the styles lit"), [o, infolder])
    po.screenshot(path=OUTDIR + "/sting_style_local.png")
    po.click(".sting-dlg .sting-cancel"); po.wait_for_timeout(300)

    # a reload: known already, nothing listened to again
    po.reload(); po.wait_for_timeout(1000)
    po.evaluate(SET_FOLDER, B64); po.wait_for_timeout(1500)
    check("a reload: nothing listened to again (kept in this browser)", po.evaluate("StingStyles.listening().total") == 0 and po.text_content("#roll-listen") == "", [po.evaluate("StingStyles.listening()"), po.text_content("#roll-listen")])

    # a model that doesn't load: it stops, marking nothing
    c2 = b.new_context(ignore_https_errors=True)
    c2.add_init_script("window.TimerFeatures = { playout: true, stings: true, styles: true, listen: true };")
    c2.route("**/*", handler(False))
    p2 = c2.new_page(); p2.on("pageerror", lambda e: errs.append("playout2: " + str(e)))
    p2.goto(BASE + "playout.html?demo"); p2.wait_for_timeout(1000)
    p2.evaluate(SET_FOLDER, B64)
    p2.click("#rollpanel summary"); p2.check("#roll-folder")
    p2.wait_for_function("StingStyles.listening().stopped", timeout=60000); p2.wait_for_timeout(1500)
    check("the model doesn't load: it stops and says so", p2.text_content("#roll-listen").startswith("Couldn’t listen to your files for their styles: the style model didn’t load"), p2.text_content("#roll-listen"))
    check("… no file marked as couldn't (they'll be listened to when it can)", json.loads(p2.evaluate("localStorage.sting_styles_local || '{\"files\":{}}'"))["files"] == {}, p2.evaluate("localStorage.sting_styles_local"))

    # beta (the owner, 14 Nov 2026): no listening, so the model is never fetched or run in the page; your own
    # files count as in whichever styles are lit (a folder chosen alongside the chips: the user says they match)
    asked = []
    c3 = b.new_context(ignore_https_errors=True, viewport={"width": 1100, "height": 1000})
    c3.add_init_script("window.TimerFeatures = { playout: true, stings: true, styles: true };")
    c3.route("**/*", handler(True))
    p3 = c3.new_page(); p3.on("pageerror", lambda e: errs.append("playout3: " + str(e)))
    p3.on("request", lambda r: asked.append(r.url) if ("/models/" in r.url or r.url.startswith(ORT) or "sting-styles-worker" in r.url) else None)
    p3.goto(BASE + "playout.html?demo"); p3.wait_for_timeout(1000)
    p3.evaluate(SET_FOLDER, B64)
    p3.click("#rollpanel summary"); p3.wait_for_timeout(300)
    p3.check("#roll-folder"); p3.wait_for_timeout(800)
    k3 = p3.evaluate("document.querySelector('#roll-chips .ss-chip').dataset.k")   # (the stock sting's)
    p3.click('#roll-chips .ss-chip[data-k="%s"]' % k3); p3.wait_for_timeout(600)
    hint3 = p3.text_content("#roll-stylehint")
    check("beta: the folder ticked, nothing listened to (no note; the model never fetched)", p3.text_content("#roll-listen") == "" and asked == [] and p3.evaluate("StingStyles.listening().total") == 0, [p3.text_content("#roll-listen"), asked])
    check("… a style lit: your files taken as in it", "your own, taken as in it" in hint3, hint3)
    p3.click('#items li[data-id="demo-1"] button[data-act=add]')
    p3.click('#items li[data-id="demo-1"] form.addcue button.primary'); p3.wait_for_timeout(800)
    p3.click('.sting-tab[data-mode=custom]'); p3.wait_for_timeout(200)
    p3.click('#sting-chips .ss-chip[data-k="%s"]' % k3); p3.wait_for_timeout(300)
    o3 = p3.evaluate("[...document.querySelectorAll('#sting-folder option')].map(o => o.textContent)")
    check("… + sting with the style lit: every file of the folder still listed", len(o3) == 6 and p3.text_content("#sting-listen") == "", o3)
    check("… and still nothing of the model fetched", asked == [], asked)
    p3.click(".sting-dlg .sting-cancel")
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
