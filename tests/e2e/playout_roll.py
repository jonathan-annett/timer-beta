import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Random stings on a playout computer (playout.js, the pool and the pick from sting-roll.js, shared with
# the run sheet editor), on the demo's ten 20-minute speakers: 🎲 Roll stings gives each an At the start
# cue picked at random, none used twice (a hand-picked cue's track counts), copied into the browser and
# measured; items with a start cue of their own are left alone; the site's cut and my clip stand in for
# their tracks; 🎲 on an item picks another, keeping when and where it plays (or adds one beside a cue of
# its own); ✂ makes a rolled cue yours; an item started here is never rolled; the length filter, the
# minimum item length, the folder; Remove rolled stings.
import io, json, math, mimetypes, os, struct, sys, wave
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
U = lambda n: BASE + "media/" + n + ".wav"
LENS = {"s1": 8, "s2": 12, "s3": 25, "s4": 40, "s5": 90, "s6": 60, "s7": 15, "s8": 10, "s9": 18, "s10": 22, "s11": 20, "s12": 30}   # (12 songs for 10 speakers: 🎲 has others)
STOCK = {"stings": [{"name": n.upper(), "url": U(n), "media": "audio", "duration": d} for n, d in LENS.items()] + [
    {"name": "S6 cut", "url": U("s6"), "media": "audio", "duration": 60, "start": 2, "end": 10, "hideOriginal": True},   # the site's clip, replacing S6
    {"name": "V1", "url": BASE + "media/v1.mp4", "media": "video", "duration": 10}]}                                       # (video: never rolled)
MINE = [{"name": "S2 short", "stock": "S2", "media": "audio", "duration": 12, "start": 1, "end": 5}]   # my clip of S2
CUES = {"demo-2": [{"id": "own2", "name": "S1", "media": "audio", "src": "stock", "trigger": "start", "at": 0, "duration": 8, "song": "url:" + U("s1")}],   # a walk-up chosen by hand
        "demo-3": [{"id": "own3", "name": "Bed", "media": "audio", "src": "file", "trigger": "elapsed", "at": 60}]}                                           # not a start cue

def tone(seconds, hz=440, rate=8000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * hz * i / rate))) for i in range(int(rate * seconds))))
    return buf.getvalue()
WAVS = {}
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        name = u[len(BASE):].split("?")[0].split("#")[0]
        if name == "stock-stings.json": return route.fulfill(status=200, body=json.dumps(STOCK), headers={"content-type": "application/json"})
        if name == "changelog.html": return route.fulfill(status=404, body=b"")
        n = name[len("media/"):-len(".wav")] if name.startswith("media/") and name.endswith(".wav") else None
        if n in LENS:
            if n not in WAVS: WAVS[n] = tone(LENS[n], 300 + 40 * len(WAVS))
            return route.fulfill(status=200, body=WAVS[n], headers={"content-type": "audio/wav", "access-control-allow-origin": "*"})
        fp = os.path.join(PUBLIC, name)
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()   # (no pairing server: the demo needs none)
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)
FOLDER = [("Walk on.wav", tone(3)), ("Big entrance.wav", tone(6, 550))]
INIT = ("window.TimerFeatures = { playout: true };"
        "if (!localStorage.__s) { localStorage.__s = 1; localStorage.playout_demo_cues = %s; localStorage.sting_library = %s; }"
        % (json.dumps(json.dumps(CUES)), json.dumps(json.dumps({"stings": MINE}))))
ARGS = ["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"]

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1100, "height": 1000})
    c.add_init_script(INIT); c.route("**/*", h)
    po = c.new_page(); po.on("pageerror", lambda e: errs.append("playout: " + str(e)))
    dialogs = []
    po.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss() if "OK to reuse" in d.message else d.accept()))   # (running out: no to reusing, here; sting_style_search.py says yes)
    po.goto(BASE + "playout.html?demo"); po.wait_for_timeout(1200)
    ids = ["demo-%d" % i for i in range(1, 11)]
    cues = lambda: po.evaluate("window.__playout.cues()")
    rolled = lambda: {k: [x for x in cues().get(k, []) if x.get("rolled")] for k in ids}
    songs_of = lambda: [x["song"] for k in ids for x in cues().get(k, []) if x.get("song")]
    unique = lambda: len(songs_of()) == len(set(songs_of()))
    def roll():
        po.click("#roll-all")
        po.wait_for_function("document.getElementById('roll-msg').textContent && document.getElementById('roll-msg').textContent !== 'Rolling…'", timeout=30000)
        po.wait_for_timeout(200)
        return po.text_content("#roll-msg")
    def settle():                                     # every rolled cue measured (it's written back when done)
        po.wait_for_function("() => Object.values(window.__playout.cues()).flat().filter(c => c.rolled).every(c => Number.isFinite(c.lufs))", timeout=30000)
    def stored(cue_ids):
        return po.evaluate("ids => Promise.all(ids.map(id => videoStore.get('pocue:' + id).then(b => !!b)))", cue_ids)

    po.evaluate("document.getElementById('rollpanel').open = true"); po.wait_for_timeout(200)
    check("the Random stings panel: Stock and My clips ticked, the folder not, items of at least 2 min",
          po.is_checked("#roll-stock") and po.is_checked("#roll-mine") and not po.is_checked("#roll-folder") and po.input_value("#roll-min") == "2")
    check("every speaker has 🎲 beside + cue", po.locator("#items > li button[data-act=roll]").count() == 10)

    # 🎲 Roll stings
    msg = roll(); r = rolled(); cs = cues()
    check("Roll: nine speakers get a rolled start cue (the one with a walk-up of its own doesn't)",
          all(len(r[k]) == 1 and r[k][0]["trigger"] == "start" and r[k][0]["at"] == 0 for k in ids if k != "demo-2") and not r["demo-2"], r)
    check("… the hand-picked walk-up untouched, and its S1 used nowhere else",
          [x["id"] for x in cs["demo-2"]] == ["own2"] and songs_of().count("url:" + U("s1")) == 1)
    check("… beside demo-3's own (later) cue, first in its list", [x["id"] for x in cs["demo-3"]][1:] == ["own3"] and cs["demo-3"][0].get("rolled"), [x["id"] for x in cs["demo-3"]])
    check("… it says what it did", msg.startswith("9 items got a sting at random") and "1 kept the start cue chosen for it" in msg, msg)
    allr = [x for k in ids for x in r[k]]
    check("… no song twice, audio only (never the video), never the whole S6 or S2", unique() and all(x["media"] == "audio" for x in allr)
          and not any(x["name"] in ("S6", "S2", "V1") for x in allr), [x["name"] for x in allr])
    check("… S6 as the site's cut, S2 as my clip", all(x.get("start") == 2 and x.get("end") == 10 for x in allr if x["song"] == "url:" + U("s6"))
          and all(x["name"] == "S2 short" and x.get("lib") == "S2 short" and x.get("start") == 1 for x in allr if x["song"] == "url:" + U("s2")), [(x["name"], x.get("start")) for x in allr])
    check("… each copied into this browser", all(stored([x["id"] for x in allr])))
    settle()
    check("… and measured for Levels", True)
    k1 = next(k for k in ids if r[k])
    check("a rolled cue is marked 🎲", po.text_content('#items li[data-cue="%s"] .fname' % r[k1][0]["id"]).startswith("🎲"))
    po.screenshot(path=OUTDIR + "/playout_roll.png")

    ok = True; seen = set()
    for _ in range(4):
        roll(); seen |= {x["name"] for k in ids for x in rolled()[k]}
        ok &= unique() and [x["id"] for x in cues()["demo-2"]] == ["own2"]
    check("rolled again 4 times: no song twice, the hand-picked one never changed, the picks vary", ok and len(seen) >= 9, seen)

    # 🎲 on an item: another, keeping when and where it plays
    settle(); old = rolled()["demo-4"][0]
    po.click('#items li[data-cue="%s"] button[data-act=when]' % old["id"])
    po.select_option('#items li[data-cue="%s"] form.addcue select[name=trigger]' % old["id"], "elapsed")
    po.fill('#items li[data-cue="%s"] form.addcue input[name=at]' % old["id"], "0:30")
    po.click('#items li[data-cue="%s"] form.addcue button.primary' % old["id"]); po.wait_for_timeout(300)
    po.evaluate("id => { window.__playout.cues()['demo-4'].find(c => c.id === id).out = { id: 'card-x', label: 'Card X' }; }", old["id"])
    po.click('#items li[data-id="demo-4"] button[data-act=roll]')
    po.wait_for_function("old => { const r = (window.__playout.cues()['demo-4'] || []).filter(c => c.rolled); return r.length === 1 && r[0].id !== old; }", arg=old["id"], timeout=15000)
    new = rolled()["demo-4"][0]
    check("🎲 on an item: another song, still rolled, the same trigger, time and output", new["song"] != old["song"] and new["trigger"] == "elapsed" and new["at"] == 30
          and new.get("out", {}).get("id") == "card-x" and unique(), (old["name"], new["name"], new["trigger"], new["at"], new.get("out")))
    check("… the old cue's file removed from the browser", stored([old["id"]]) == [False])

    # 🎲 beside a walk-up of its own: added, the own one kept; a roll of the sheet then leaves both
    po.click('#items li[data-id="demo-2"] button[data-act=roll]')
    po.wait_for_function("() => (window.__playout.cues()['demo-2'] || []).some(c => c.rolled)", timeout=15000)
    settle(); d2 = cues()["demo-2"]
    check("🎲 on an item with a walk-up of its own: a rolled cue beside it", [x["id"] for x in d2 if not x.get("rolled")] == ["own2"] and len(d2) == 2 and unique(), [x["name"] for x in d2])
    roll()
    check("… and a roll of the sheet leaves that item alone", cues()["demo-2"] == d2)

    # ✂ on a rolled cue: yours now
    po.evaluate("() => { StingClip.open = async o => ({ name: o.name, start: 1, end: 4 }); }")
    settle(); five = rolled()["demo-5"][0]
    po.click('#items li[data-cue="%s"] button[data-act=edit]' % five["id"]); po.wait_for_timeout(500)
    d5 = cues()["demo-5"]
    check("✂ on a rolled cue: it's yours now", len(d5) == 1 and d5[0]["id"] == five["id"] and not d5[0].get("rolled") and d5[0].get("start") == 1, d5)
    roll()
    check("… and the next roll leaves it", cues()["demo-5"] == d5)

    # An item started here is never rolled
    po.click('#items li[data-id="demo-6"] button[data-act=run]'); po.wait_for_timeout(400)
    settle(); d6 = cues()["demo-6"]
    check("an item started here: no 🎲", po.locator('#items li[data-id="demo-6"] button[data-act=roll]').count() == 0)
    roll()
    check("… and a roll leaves its cues", cues()["demo-6"] == d6)
    po.click("#stopall"); po.wait_for_timeout(300)

    # The length filter (as it plays) and the minimum item length
    po.click("#roll-clear"); po.wait_for_timeout(500)   # (from none: what a roll with the filter picks is then exact)
    po.select_option("#roll-lenop", "max"); po.fill("#roll-len", "15"); po.dispatch_event("#roll-len", "change")
    dialogs.clear()
    msg = roll()
    check("running out: it asks whether to reuse (no, here)", any("OK to reuse" in d for d in dialogs), dialogs)
    lens = po.evaluate("() => Object.values(window.__playout.cues()).flat().filter(c => c.rolled).map(c => StingClip.length(c, c.duration))")
    short = {"url:" + U("s2"): 4, "url:" + U("s6"): 8, "url:" + U("s8"): 10, "url:" + U("s7"): 15}   # (as they play: my clip of S2, the site's cut of S6)
    mine_ = {x.get("song") for l in cues().values() for x in l if not x.get("rolled")}       # (S1, and whatever ✂ made demo-5's own)
    want = sorted(v for k, v in short.items() if k not in mine_)
    check("stings no longer than 15 s: only those still free (of S2 short 4 s, S6 cut 8 s, S8 10 s, S7 15 s), the other items go without, and it says so",
          sorted(lens) == want and msg.startswith("%d items got a sting" % len(want)) and "%d didn’t" % (8 - len(want)) in msg and unique(), (lens, want, msg))
    po.select_option("#roll-lenop", "")
    po.fill("#roll-min", "25"); po.dispatch_event("#roll-min", "change")
    msg = roll()
    check("items of at least 25 min: none of these 20-minute ones, and it says so", msg.startswith("No items to give a sting"), msg)
    po.fill("#roll-min", "2"); po.dispatch_event("#roll-min", "change")
    check("the options kept on this computer", json.loads(po.evaluate("localStorage.playout_roll"))["min"] == 2)

    # The folder: files kept with the cues
    po.evaluate("files => window.__stingFolder({ name: 'Walk-ups', files: files.map(([n, b64]) => ({ path: n, file: new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], n, { type: 'audio/wav' }) })) })",
                [(n, __import__("base64").b64encode(w).decode()) for n, w in FOLDER])
    po.wait_for_timeout(300)
    check("the folder named in the panel", "Walk-ups" in po.text_content("#roll-foldername"), po.text_content("#roll-foldername"))
    po.uncheck("#roll-stock"); po.uncheck("#roll-mine"); po.check("#roll-folder")
    msg = roll()
    files = [x for k in ids for x in rolled()[k] if x["src"] == "file"]
    check("from the folder only: its two files, rolled, kept in the browser; the others keep theirs", len(files) == 2 and all(x["song"].startswith("size:") for x in files)
          and all(stored([x["id"] for x in files])) and unique() and msg.startswith("2 items got a sting"), (msg, [x["name"] for x in files]))
    po.check("#roll-stock"); po.check("#roll-mine"); po.uncheck("#roll-folder")

    # Remove rolled stings
    dialogs.clear()
    po.click("#roll-clear"); po.wait_for_timeout(500)
    cs = cues()
    check("Remove rolled stings: asked first, then every rolled cue goes; cues chosen by hand stay",
          dialogs and "picked at random" in dialogs[0] and not any(x.get("rolled") for l in cs.values() for x in l)
          and [x["id"] for x in cs["demo-2"]] == ["own2"] and [x["id"] for x in cs["demo-3"]] == ["own3"] and cs["demo-5"] == d5, (dialogs, {k: [x["name"] for x in l] for k, l in cs.items()}))
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
