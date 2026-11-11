import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# The Stream Deck keypad: the Keypad key turns the deck into a number pad (the XL's, through
# StreamDeck.faces/press as the phone's virtual XL uses it; the MK.2's layout checked too). Its keys
# type into the timer like the keyboard; the XL previews the typed time (hours, min, sec, typed) and
# Start / Set default carry it; Start, Set default and Cancel go back to the normal layout; Cancel
# with nothing typed doesn't send Esc (which would fade out whatever is playing). The XL's Update preset
# shows only the preset keys, in blue: one pressed takes the typed time, any other key goes back to the keypad.
import json, mimetypes, os, sys
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        fp = os.path.join(PUBLIC, u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

LAYOUT = ["keypad", "preset_10"] + ["empty"] * 30
INIT = ("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';"
        "localStorage.defaultDuration='300000';localStorage.streamdeck_layout_xl=%s}") % json.dumps(json.dumps(LAYOUT))
# the XL keypad's keys (streamdeck.js KEYPAD.xl)
K = {"1": 0, "2": 1, "3": 2, ":": 3, "cancel": 7, "4": 8, "5": 9, "6": 10, ".": 11, "h": 12, "m": 13, "s": 14, "save": 15,
     "7": 16, "8": 17, "9": 18, "back": 19, "typed": 21, "default": 23, "0": 25, "start": 31}
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 800})
    c.add_init_script(INIT); c.route("**/*", h)
    t = c.new_page(); t.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    t.goto(BASE + "timer.html"); t.wait_for_timeout(1000)
    faces = lambda m="xl": t.evaluate("m => StreamDeck.faces(m)", m)
    press = lambda k: (t.evaluate("i => StreamDeck.press(i, 'xl')", K[k] if isinstance(k, str) else k), t.wait_for_timeout(120))
    remain = lambda: t.text_content("#remain_disp").strip()
    pv = lambda f, k: f[K[k]]["rs"]["body"]

    f = faces()
    check("the Keypad key is on the deck", "Keypad" in (f[0].get("label") or ""), f[0])
    press(0); f = faces()
    check("pressing it: the deck becomes a number pad", f[0].get("big", {}).get("text") == "1" and f[K["start"]].get("label") == "Start" and f[K["cancel"]].get("label") == "Cancel", [x.get("big", x.get("label")) for x in f[:8]])
    check("… the preview keys show nothing yet", pv(f, "h") == "–" and pv(f, "typed") == "–")
    check("… and the MK.2's keypad is laid out as asked", [x.get("big", {}).get("text") or x.get("label") for x in faces("mk2")] == ["1", "2", "3", ":", "Cancel", "4", "5", "6", "0", "Set\ndefault", "7", "8", "9", ".", "Start"], [x.get("big", {}).get("text") or x.get("label") for x in faces("mk2")])
    for k in ["1", ":", "2", "5"]: press(k)
    f = faces()
    check("typing 1:25: the timer has it as a typed time", t.evaluate("document.documentElement.classList.contains('editing')"))
    check("… the XL previews it: 1 · 25 · 00, typed 1:25", (pv(f, "h"), pv(f, "m"), pv(f, "s"), pv(f, "typed")) == ("1", "25", "00", "1:25"), (pv(f, "h"), pv(f, "m"), pv(f, "s"), pv(f, "typed")))
    check("… and Start carries it (the 15-key deck's preview)", f[K["start"]].get("label") == "Start\n1:25:00" and faces("mk2")[14].get("label") == "Start\n1:25:00", f[K["start"]].get("label"))
    t.screenshot(path=OUTDIR + "/deck_keypad_timer.png")
    press("back"); f = faces()
    check("⌫ takes the last digit off", pv(f, "typed") == "1:2", pv(f, "typed"))
    press("5"); press("start"); t.wait_for_timeout(1200)
    check("Start: the typed time starts", remain() in ("1:24:59", "1:24:58", "1:25:00"), remain())
    check("… and the deck is back to its own layout", "Keypad" in (faces()[0].get("label") or ""))

    press(0); press("4"); press("5"); press("cancel"); t.wait_for_timeout(300)
    check("Cancel: the typed time is dropped, the timer runs on", not t.evaluate("document.documentElement.classList.contains('editing')") and remain().startswith("1:24"), remain())
    check("… back to its own layout", "Keypad" in (faces()[0].get("label") or ""))
    t.evaluate("window.__esc = 0; document.addEventListener('keydown', e => { if (e.key === 'Escape') window.__esc++; }, true)")
    press(0); press("cancel")
    check("Cancel with nothing typed: no Esc sent (it would fade out what's playing)", t.evaluate("window.__esc") == 0 and "Keypad" in (faces()[0].get("label") or ""))

    press(0); press("4"); press("5"); f = faces()
    check("Set default carries the typed time too", f[K["default"]].get("label") == "Default\n45:00", f[K["default"]].get("label"))
    press("default"); t.wait_for_timeout(300)
    check("Set default: the default becomes 45 minutes, the timer runs on", t.evaluate("Number(localStorage.defaultDuration)") == 2700000 and remain().startswith("1:24"), (t.evaluate("localStorage.defaultDuration"), remain()))
    check("… back to its own layout", "Keypad" in (faces()[0].get("label") or ""))
    # Update preset (the XL): only the presets, in blue; another key cancels back to the keypad; a preset takes the time
    press(0); press("1"); press(":"); press("2"); press("5"); f = faces()
    check("Update preset is lit once a time is typed", f[K["save"]].get("label") == "Update\npreset" and f[K["save"]].get("bg") == "#3a2a00", f[K["save"]])
    press("save"); f = faces()
    check("Update preset: only the preset keys, in blue; the rest blank", f[1].get("bg") == "#0b4fa8" and f[1].get("label") == "10 min" and f[0].get("bg") == "#000000" and not f[0].get("label") and all(x.get("press") for x in f), (f[0], f[1]))
    press(5); f = faces()
    check("… another key: back to the keypad, the typed time still there", f[0].get("big", {}).get("text") == "1" and pv(f, "typed") == "1:25", (f[0], pv(f, "typed")))
    press("save"); press(1); f = faces()
    check("… a preset key: it takes the time and labels itself, the deck back to normal", f[1].get("label") == "1 h 25" and "Keypad" in (f[0].get("label") or ""), (f[0].get("label"), f[1].get("label")))
    over = t.evaluate("JSON.parse(localStorage.streamdeck_key_overrides || '{}')['xl:1']")
    check("… kept (Save not needed: it's the deck's own action)", over == {"msecs": 5100000}, over)
    check("… and the typed time is used up on the timer", not t.evaluate("document.documentElement.classList.contains('editing')"))
    press(1); t.wait_for_timeout(1200)
    check("pressing that preset now starts 1:25:00", remain() in ("1:24:59", "1:24:58", "1:25:00"), remain())
    press(0); press("save"); f = faces()
    check("Update preset with nothing typed does nothing", f[0].get("big", {}).get("text") == "1", f[0])
    press("cancel")
    # The MK.2's top right: Cancel, ⌫ once something is typed, Cancel again when it's all gone (as the keyboard)
    mp = lambda i: (t.evaluate("i => StreamDeck.press(i, 'mk2')", i), t.wait_for_timeout(150))
    top = lambda: (lambda f: f.get("big", {}).get("text") or f.get("label"))(faces("mk2")[4])
    press(0)
    check("MK.2: Cancel before anything is typed", top() == "Cancel", top())
    mp(5); mp(6)                                     # 4, 5
    check("… ⌫ once a digit is typed", top() == "⌫", top())
    mp(4)
    check("… ⌫ takes one off (45 → 4), still ⌫", top() == "⌫" and t.evaluate("document.documentElement.classList.contains('editing')"), top())
    mp(4)
    check("… the last one gone: Cancel again", top() == "Cancel", top())
    mp(4)
    check("… Cancel: the entry dropped, the keypad gone", not t.evaluate("document.documentElement.classList.contains('editing')") and "Keypad" in (faces()[0].get("label") or ""))
    pal = t.evaluate("(() => { document.dispatchEvent(new KeyboardEvent('keydown', {key: 'd', bubbles: true})); return [...document.querySelectorAll('#deck-palette .deck-palette-chip')].map(c => c.dataset.action); })()")
    check("the palette offers the Keypad key, not the keypad's own keys", "keypad" in pal and not any(a.startswith("kp_") for a in pal), [a for a in pal if a.startswith("kp") or a == "keypad"])
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
