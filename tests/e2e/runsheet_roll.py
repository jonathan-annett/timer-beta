import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Random stings (runsheet-editor.js, the Random stings panel and 🎲): every item long enough gets a sting
# at random, none used twice (one song, one candidate: the site's clip of a track and my clip of another
# stand in for the tracks); hand-picked stings and videos are left alone; the pool (stock, folder, My
# clips) and the length filter; the minimum item length (0 too); 🎲 on a row picks another (even for a
# hand-picked one); ✂ makes a rolled sting hand-picked; Remove rolled stings; rows that have run and the
# live item are never rolled.
import base64, io, json, math, mimetypes, os, struct, sys, wave
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
U = lambda n: BASE + "media/" + n + ".wav"
STOCK = {"stings": [
    {"name": "S1", "url": U("s1"), "media": "audio", "duration": 8},
    {"name": "S2", "url": U("s2"), "media": "audio", "duration": 12},
    {"name": "S3", "url": U("s3"), "media": "audio", "duration": 25},
    {"name": "S4", "url": U("s4"), "media": "audio", "duration": 40},
    {"name": "S5", "url": U("s5"), "media": "audio", "duration": 90},
    {"name": "S6", "url": U("s6"), "media": "audio", "duration": 60},
    {"name": "S6 cut", "url": U("s6"), "media": "audio", "duration": 60, "start": 2, "end": 10, "hideOriginal": True},   # the site's clip, replacing S6
    {"name": "S7", "url": U("s7"), "media": "audio", "duration": 15},
    {"name": "V1", "url": BASE + "media/v1.mp4", "media": "video", "duration": 10}]}           # (video: never rolled)
MINE = [{"name": "S2 short", "stock": "S2", "media": "audio", "duration": 12, "start": 1, "end": 5}]   # my clip of S2
SHEET = {"title": "Rolls", "perItem": 20, "items": [
    {"id": "w", "name": "Welcome", "start": None, "duration": 60},
    {"id": "a", "name": "Keynote", "start": None, "duration": 1200},
    {"id": "b", "name": "Speaker B", "start": None, "duration": 900, "sting": {"src": "stock", "media": "audio", "name": "S1", "url": U("s1"), "duration": 8}},
    {"id": "c", "name": "Speaker C", "start": None, "duration": 600, "video": {"key": "rsvideo:c:1", "name": "V", "duration": 600}},
    {"id": "r", "name": "Break", "start": None, "duration": 90},
    {"id": "d", "name": "Speaker D", "start": None, "duration": 1800},
    {"id": "e", "name": "Speaker E", "start": None, "duration": 720}]}

def tone(seconds, hz=440):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
        w.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * hz * i / 8000))) for i in range(int(8000 * seconds))))
    return base64.b64encode(buf.getvalue()).decode()
FOLDER = [("Walk on.wav", tone(3)), ("Big entrance.wav", tone(35, 550))]

def h(route, req):
    u = req.url
    if u.startswith(BASE):
        name = u[len(BASE):].split("?")[0].split("#")[0]
        if name == "stock-stings.json": return route.fulfill(status=200, body=json.dumps(STOCK), headers={"content-type": "application/json"})
        if name == "changelog.html": return route.fulfill(status=404, body=b"")
        fp = os.path.join(PUBLIC, name)
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)
INIT = ("window.TimerFeatures = { stings: true };"
        "if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';"
        "localStorage.runsheet=%s;localStorage.sting_library=%s}") % (json.dumps(json.dumps(SHEET)), json.dumps(json.dumps({"stings": MINE})))
song = lambda s: s.get("url") or "size:%s" % s.get("size")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1400, "height": 900})
    c.add_init_script(INIT); c.route("**/*", h)
    e = c.new_page(); e.on("pageerror", lambda x: errs.append("editor: " + str(x)))
    e.goto(BASE + "runsheet.html"); e.wait_for_timeout(1200)
    sheet = lambda: json.loads(e.evaluate("localStorage.runsheet"))
    stings = lambda: {it["id"]: it.get("sting") for it in sheet()["items"]}
    def roll():
        e.click("#roll-all")
        e.wait_for_function("document.getElementById('roll-msg').textContent && document.getElementById('roll-msg').textContent !== 'Rolling…'", timeout=20000)
        e.wait_for_timeout(200)
        return e.text_content("#roll-msg")
    def unique(st):
        ss = [song(v) for v in st.values() if v]
        return len(ss) == len(set(ss))
    e.evaluate("document.getElementById('rollpanel').open = true"); e.wait_for_timeout(200)
    check("the Random stings panel: Stock and My clips ticked, the folder not, items of at least 2 min",
          e.is_checked("#roll-stock") and e.is_checked("#roll-mine") and not e.is_checked("#roll-folder") and e.input_value("#roll-min") == "2")
    check("a row without a sting has 🎲 beside + sting; the video row hasn't", e.locator('tr[data-id="a"] td.vid [data-act=sroll]').count() == 1 and e.locator('tr[data-id="c"] td.vid [data-act=sroll]').count() == 0)

    msg = roll(); st = stings()
    check("Roll: the speakers (Keynote, D, E) get a sting at random", all(st[k] and st[k].get("rolled") for k in "ade"), st)
    check("… the short items, the hand-picked one and the video item left alone", st["w"] is None and st["r"] is None and st["b"].get("name") == "S1" and not st["b"].get("rolled") and st["c"] is None, (st["w"], st["r"], st["b"], st["c"]))
    check("… it says what it did", msg.startswith("3 items got a sting at random") and "1 kept the one chosen for it" in msg, msg)
    e.locator("#rollpanel").screenshot(path=OUTDIR + "/runsheet_roll_panel.png")
    e.locator("#rs-table").screenshot(path=OUTDIR + "/runsheet_roll_table.png")
    ok_unique = ok_mine = ok_cut = ok_audio = True; seen = set()
    for _ in range(10):
        st = stings(); r = [st[k] for k in "ade"]
        ok_unique &= unique(st) and all(song(x) != U("s1") for x in r)
        ok_mine &= all(x["name"] == "S2 short" and x.get("lib") == "S2 short" and x.get("start") == 1 for x in r if x["url"] == U("s2"))
        ok_cut &= all(x.get("start") == 2 for x in r if x["url"] == U("s6"))
        ok_audio &= all(x["media"] == "audio" and x["url"] != BASE + "media/v1.mp4" for x in r)
        seen |= {x["name"] for x in r}
        st0 = st["b"]; roll()
        ok_unique &= stings()["b"] == st0
    check("over 10 rolls: no song twice (nor the hand-picked S1), the hand-picked one never changed", ok_unique)
    check("… S2 only as my clip of it (My clips stand in for their tracks)", ok_mine)
    check("… S6 only as the site's cut of it", ok_cut)
    check("… never the video sting", ok_audio)
    check("… and the picks vary", len(seen) >= 4, seen)

    # My clips off: tracks as supplied (S2 whole), my clip never
    e.uncheck("#roll-mine"); ok = True; whole = False
    for _ in range(8):
        roll(); st = stings(); r = [st[k] for k in "ade"]
        ok &= unique(st) and not any(x.get("lib") for x in r) and all(x.get("start") == 2 for x in r if x["url"] == U("s6"))
        whole |= any(x["name"] == "S2" for x in r)
    check("My clips unticked: never my clip; S2 comes back whole", ok and whole, (ok, whole))

    # The length filter (as it plays)
    e.select_option("#roll-lenop", "max"); e.fill("#roll-len", "20"); e.dispatch_event("#roll-len", "change")
    ok = True
    for _ in range(5):
        roll(); st = stings()
        lens = e.evaluate("ids => ids.map(id => { const s = JSON.parse(localStorage.runsheet).items.find(x => x.id === id).sting; return StingClip.length(s, s.duration); })", list("ade"))
        ok &= all(l <= 20 for l in lens) and unique(st)
    check("stings no longer than 20 s: only those (S2 12 s, S6 cut 8 s, S7 15 s)", ok, lens)
    e.select_option("#roll-lenop", "min"); e.fill("#roll-len", "30"); e.dispatch_event("#roll-len", "change")
    msg = roll(); st = stings()
    long_ = [x for x in (st[k] for k in "ade") if x and x["name"] in ("S4", "S5")]
    check("at least 30 s: only S4 and S5 fit, so one item goes without, and it says so", len(long_) == 2 and "didn’t" in msg and unique(st), (msg, [st[k] and st[k]["name"] for k in "ade"]))
    e.select_option("#roll-lenop", "")

    # The minimum item length: 0 = every item
    e.fill("#roll-min", "0"); e.dispatch_event("#roll-min", "change"); e.check("#roll-mine")
    roll(); st = stings()
    check("items of at least 0 min: Welcome and Break get one too (the video item still not)", st["w"] and st["r"] and st["w"].get("rolled") and st["c"] is None and unique(st), (st["w"], st["r"]))
    e.fill("#roll-min", "2"); e.dispatch_event("#roll-min", "change")

    # The folder: files stored with the items
    e.evaluate("files => window.__stingFolder({ name: 'Walk-ups', files: files.map(([n, b64]) => ({ path: n, file: new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], n, { type: 'audio/wav' }) })) })", FOLDER)
    e.wait_for_timeout(300)
    check("the folder named in the panel", "Walk-ups" in e.text_content("#roll-foldername"), e.text_content("#roll-foldername"))
    e.uncheck("#roll-stock"); e.uncheck("#roll-mine"); e.check("#roll-folder")
    msg = roll(); st = stings()
    files = [st[k] for k in "ade" if st[k] and st[k].get("src") == "file"]
    check("from the folder only: its two files, stored with the items (rssting:), rolled", len(files) == 2 and all(f["key"].startswith("rssting:") and f.get("rolled") for f in files) and unique(st), [st[k] for k in "ade"])
    stored = e.evaluate("keys => Promise.all(keys.map(k => videoStore.get(k).then(b => !!b)))", [f["key"] for f in files])
    check("… the files are in the browser's store", all(stored), stored)
    e.check("#roll-stock"); e.check("#roll-mine"); e.uncheck("#roll-folder")

    # 🎲 on a row: another for that item
    roll()
    before = stings()["a"]
    e.click('tr[data-id="a"] td.vid [data-act=sroll]'); e.wait_for_timeout(800)
    after = stings()["a"]
    check("🎲 on a row: another sting for it, rolled", after and after.get("rolled") and song(after) != song(before) and unique(stings()), (before and before["name"], after and after["name"]))
    e.click('tr[data-id="b"] td.vid [data-act=sroll]'); e.wait_for_timeout(800)
    check("… on a hand-picked one too (asked for): replaced, now rolled", stings()["b"]["name"] != "S1" and stings()["b"].get("rolled"), stings()["b"])
    check("… a rolled sting's 🎲 is lit", "on" in e.get_attribute('tr[data-id="b"] td.vid [data-act=sroll]', "class"))

    # ✂ on a rolled sting: edited, so hand-picked (a roll of the sheet leaves it)
    e.evaluate("() => { StingClip.open = async o => ({ name: o.name, start: 1, end: 4 }); }")
    e.click('tr[data-id="d"] td.vid [data-act=strim]'); e.wait_for_timeout(600)
    if e.locator(".ask button", has_text="Just this item").count(): e.click(".ask button:has-text('Just this item')"); e.wait_for_timeout(400)   # (it came from my library: asked)
    d = stings()["d"]
    check("✂ on a rolled sting: it's hand-picked now", d and not d.get("rolled") and d.get("start") == 1, d)
    roll()
    check("… and the next roll leaves it", stings()["d"] == d)

    # Remove rolled stings
    e.click("#roll-clear"); e.wait_for_timeout(300)
    e.click(".ask button.danger"); e.wait_for_timeout(500)
    st = stings()
    check("Remove rolled stings: the rolled ones go, the hand-picked one stays", st["a"] is None and st["b"] is None and st["e"] is None and st["d"] == d, st)

    # During the show: rows that have run and the live item are never rolled
    roll(); st0 = stings()
    e.evaluate("""(() => { const now = Date.now();
      localStorage.runsheet_state = JSON.stringify({ active: true, index: 1, currentId: 'a', finished: false, history: [{}, {}], log: [{ id: 'w', name: 'Welcome', actual: now - 120000, planned: null }, { id: 'a', name: 'Keynote', actual: now - 60000, planned: null }] });
      window.dispatchEvent(new StorageEvent('storage', { key: 'runsheet_state', newValue: localStorage.runsheet_state })); })()""")
    e.wait_for_timeout(600)
    check("the show under way: the live item's 🎲 is off", e.is_disabled('tr[data-id="a"] td.vid [data-act=sroll]'))
    for _ in range(4): roll()
    st = stings()
    check("… rolling leaves the live item's sting (and the row that ran) as they were", st["a"] == st0["a"] and st["w"] == st0["w"] and unique(st), (st0["a"], st["a"]))
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
