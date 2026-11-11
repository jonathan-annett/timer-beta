import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Custom presets in the Stream Deck editor (D): click a preset key, type a duration (minutes, h:mm or
# h:mm:ss) and it labels itself from it (or takes the label typed); after Save the key starts that
# duration (here pressed through StreamDeck.press, as the phone's virtual XL does). Dragging a preset
# from the palette onto the key puts that preset back, its own duration and label.
import mimetypes, os, sys
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

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1400, "height": 900})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01'}")
    c.route("**/*", h)
    t = c.new_page(); t.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    t.goto(BASE + "timer.html"); t.wait_for_timeout(1000)
    key = lambda i: '#deck-grid .deck-editor-key[data-index="%d"]' % i
    remain = lambda: t.text_content("#remain_disp").strip()

    def open_editor():
        t.keyboard.press("d"); t.wait_for_timeout(300)
        t.select_option("#deck-model-select", "xl"); t.wait_for_timeout(200)
    open_editor()
    i = t.evaluate("[...document.querySelectorAll('#deck-grid .deck-editor-key')].find(k => k.textContent === '10 min').dataset.index")
    i = int(i)
    t.click(key(i)); t.wait_for_timeout(100)
    check("clicking a preset key shows its Duration, the preset's own as the hint", t.is_visible("#deck-key-duration") and t.input_value("#deck-key-duration") == "" and "10" in t.get_attribute("#deck-key-duration", "placeholder"))
    check("… brought into view, with the caret in it", t.evaluate("document.activeElement.id") == "deck-key-duration" and t.evaluate("(() => { const r = document.getElementById('deck-key-duration').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()"))
    t.fill("#deck-key-duration", "25")
    check("typing a duration: the key labels itself", t.text_content(key(i)) == "25 min" and t.text_content("#deck-key-duration-note") == "= 25 min", t.text_content(key(i)))
    t.locator("#deck-editor").screenshot(path=OUTDIR + "/deck_custom_preset.png")
    t.fill("#deck-key-duration", "soon")
    check("… something that isn't a duration is marked and changes nothing", "invalid" in (t.get_attribute("#deck-key-duration", "class") or "") and t.text_content(key(i)) == "25 min")
    t.fill("#deck-key-duration", "1:15")
    check("h:mm, as typed into the timer", t.text_content(key(i)) == "1 h 15", t.text_content(key(i)))
    t.fill("#deck-key-duration", "0:04:30")
    check("h:mm:ss", t.text_content(key(i)) == "4:30", t.text_content(key(i)))
    t.fill("#deck-key-duration", "25")
    t.click("#deck-save-btn"); t.wait_for_timeout(300)
    face = t.evaluate("n => StreamDeck.faces('xl')[n].label", i)
    check("saved: the key's face says 25 min", face == "25 min", face)
    t.evaluate("n => StreamDeck.press(n, 'xl')", i); t.wait_for_timeout(1200)
    check("pressing it starts 25 minutes", remain() in ("24:59", "24:58", "25:00"), remain())

    open_editor()
    t.click(key(i)); t.wait_for_timeout(100)
    check("reopened: the duration is kept", t.input_value("#deck-key-duration") == "25", t.input_value("#deck-key-duration"))
    t.fill("#deck-key-label", "Keynote")
    check("a label typed wins over the duration's", t.text_content(key(i)) == "Keynote")
    t.locator('#deck-palette .deck-palette-chip[data-action="preset_20"]').drag_to(t.locator(key(i))); t.wait_for_timeout(200)
    check("dragging the 20 min preset onto it: the palette's preset again (no custom duration or label)", t.text_content(key(i)) == "20 min" and t.input_value("#deck-key-duration") == "", (t.text_content(key(i)), t.input_value("#deck-key-duration")))
    t.click("#deck-save-btn"); t.wait_for_timeout(300)
    t.evaluate("n => StreamDeck.press(n, 'xl')", i); t.wait_for_timeout(1200)
    check("pressing it starts 20 minutes", remain() in ("19:59", "19:58", "20:00"), remain())
    over = t.evaluate("n => JSON.parse(localStorage.streamdeck_key_overrides || '{}')['xl:' + n] || null", i)
    check("nothing custom left on the key", over is None or ("msecs" not in over and "label" not in over), over)
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
