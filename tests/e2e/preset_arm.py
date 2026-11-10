import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Arm presets (the button bar's Presets label): off, presets start the timer as always; on, a preset
# (bar or Stream Deck) shows its time paused and standing by, and Space, Resume or the deck's Start
# key starts it from its full time.
import json, mimetypes, os, sys
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
SHEET = {"title": "T", "perItem": 20, "items": [{"id": "a", "name": "One", "start": None, "duration": 600}]}
errs = []

def h(route, req):
    u = req.url
    if u.startswith(BASE):
        if "changelog.html" in u: return route.fulfill(status=404, body=b"")
        fp = os.path.join(PUBLIC, u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()

def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 720})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';localStorage.defaultDuration=String(300000)}")
    c.route("**/*", h)
    t = c.new_page()
    t.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    t.goto(BASE + "timer.html"); t.wait_for_timeout(800)

    state = lambda: t.evaluate("""({cls: document.documentElement.className, remain: document.getElementById('remain_disp').textContent,
        def: Number(localStorage.defaultDuration), acum: Number(localStorage.pauseAcum || 0), arm: localStorage.preset_arm || null,
        info: localStorage.remainInfo || '', notice: getComputedStyle(document.getElementById('remain_info_message')).display})""")
    has = lambda s, k: (" " + s["cls"] + " ").find(" " + k + " ") >= 0
    running = lambda s: not has(s, "paused") and not has(s, "standby")
    armed = lambda s: has(s, "paused") and has(s, "standby")
    preset = lambda keys: t.click('.btn-presets div.btn[data-keys="%s"]' % keys)
    api = lambda m: t.evaluate("m => processTimerApiMessage(m)", m)

    # Off: as always
    s = state()
    check("off by default", not has(s, "presetarm") and s["arm"] is None, s)
    check("off: the label reads Presets", t.inner_text("#preset_arm") == "PRESETS", t.inner_text("#preset_arm"))
    preset(" ,2,0, "); t.wait_for_timeout(1300); s = state()
    check("off: a bar preset starts the timer", running(s) and s["remain"] in ("19:59", "19:58"), s)
    check("off: a bar preset leaves the default", s["def"] == 300000, s["def"])
    api({"cmd": "preset", "msecs": 600000}); t.wait_for_timeout(1300); s = state()
    check("off: a deck preset starts the timer", running(s) and s["remain"] in ("9:59", "9:58"), s)

    # On
    t.click("#preset_arm"); s = state()
    check("badge turns it on", has(s, "presetarm") and s["arm"] == "1", s)
    check("on: the badge says so", t.inner_text("#preset_arm") == "PRESETS ARM ONLY", t.inner_text("#preset_arm"))
    check("on: the badge is yellow", t.evaluate("getComputedStyle(document.getElementById('preset_arm')).backgroundColor") == "rgb(255, 212, 0)")
    check("on: the tip warns", "Space" in (t.get_attribute("#preset_arm", "title") or ""), t.get_attribute("#preset_arm", "title"))

    preset(" ,2,0, "); t.wait_for_timeout(1500); s = state()
    check("on: a bar preset arms (paused, standing by)", armed(s), s["cls"])
    check("on: shows the full time", s["remain"] == "20:00", s["remain"])
    check("on: becomes the default", s["def"] == 1200000, s["def"])
    check("on: the operator sees the notice", s["notice"] != "none" and "Standing by" in t.inner_text("#remain_info_message"), (s["notice"], t.inner_text("#remain_info_message")))
    check("on: the presenter's notice", "Standing by" in s["info"], s["info"])
    t.screenshot(path=OUTDIR + "/preset_armed.png")
    t.keyboard.press("Space"); t.wait_for_timeout(1300); s = state()
    check("Space starts it from its full time", running(s) and s["remain"] in ("19:59", "19:58") and s["acum"] == 0, s)

    api({"cmd": "preset", "msecs": 1800000}); t.wait_for_timeout(400); s = state()
    check("on: a deck preset arms", armed(s) and s["remain"] == "30:00", s)
    t.wait_for_timeout(1500)
    api({"cmd": "pause"}); t.wait_for_timeout(1300); s = state()
    check("Resume starts it fresh (no pause time)", running(s) and s["remain"] in ("29:59", "29:58") and s["acum"] == 0, s)

    api({"cmd": "preset", "msecs": 600000}); t.wait_for_timeout(400)
    api({"cmd": "keys", "keys": [" "]}); t.wait_for_timeout(1300); s = state()
    check("the deck's Start key starts it", running(s) and s["remain"] in ("9:59", "9:58"), s)

    api({"cmd": "preset", "msecs": 600000}); t.wait_for_timeout(400)
    t.keyboard.press("4"); t.keyboard.press("5"); t.keyboard.press("Space"); t.wait_for_timeout(1300); s = state()
    check("a time typed after arming starts that time", running(s) and s["remain"] in ("44:59", "44:58"), s)
    check("… and the armed default stays", s["def"] == 600000, s["def"])

    preset(" ,9,0, "); t.keyboard.press("Space"); t.wait_for_timeout(400); s = state()
    check("Space straight after a preset isn't paused by it", running(s), s["cls"])

    preset(" ,6,0, "); t.wait_for_timeout(400)
    t.reload(); t.wait_for_timeout(1000); s = state()
    check("reload keeps the mode and the armed timer", has(s, "presetarm") and armed(s) and s["remain"] == "1:00:00", s)
    t.keyboard.press("Space"); t.wait_for_timeout(1300); s = state()
    check("Space starts it after a reload", running(s) and s["remain"] in ("59:59", "59:58"), s)

    t.evaluate("s => { localStorage.runsheet = s; window.runsheet.sheetChanged(); window.runsheet.setActive(true); }", json.dumps(SHEET)); t.wait_for_timeout(500)
    check("run sheet mode: the badge stays in sight", t.evaluate("getComputedStyle(document.getElementById('preset_arm')).visibility") == "visible")
    t.screenshot(path=OUTDIR + "/preset_arm_runsheet.png")
    t.evaluate("window.runsheet.setActive(false)"); t.wait_for_timeout(300)

    # The XL's Arm presets key (row 3, last; in place of Type message)
    face = lambda: t.evaluate("(f => [f.a, !!f.on, f.bg])(window.StreamDeck.faces('xl')[23])")
    lit = face()
    check("XL default: Arm presets in place of Type message", lit[0] == "toggle_preset_arm", lit)
    mk2 = t.evaluate("window.StreamDeck.faces('mk2')[14].a")
    check("MK.2 default: Arm presets in place of Type message", mk2 == "toggle_preset_arm", mk2)
    t.evaluate("window.StreamDeck.press(23, 'xl')"); t.wait_for_timeout(300); s = state()
    check("the deck key turns it off", not has(s, "presetarm") and s["arm"] is None, s)
    unlit = face()
    check("the deck key's face changes with it", unlit[1:] != lit[1:], (lit, unlit))
    t.evaluate("window.StreamDeck.press(23, 'xl')"); t.wait_for_timeout(300); s = state()
    check("the deck key turns it on", has(s, "presetarm") and s["arm"] == "1", s)
    check("… and lights it", face()[1:] == lit[1:], face())

    t.click("#preset_arm"); s = state()
    check("badge turns it off", not has(s, "presetarm") and s["arm"] is None, s)
    api({"cmd": "preset", "msecs": 600000}); t.wait_for_timeout(1300); s = state()
    check("off again: presets start the timer", running(s) and s["remain"] in ("9:59", "9:58"), s)
    t.keyboard.press("Space"); t.wait_for_timeout(1300); s = state()
    check("off again: Space restarts the default as always (the last armed preset's)", running(s) and s["remain"] in ("59:59", "59:58"), s)
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
