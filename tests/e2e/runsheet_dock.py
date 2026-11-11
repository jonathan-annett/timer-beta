import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# The run sheet editor docked along the bottom of the control screen (runsheet-dock.js): the run sheet
# button (and E) open and close it; the editor in it works as in its own window (edits, Next); a reload
# brings it back with its height; ⧉ moves it to its own window (and the button opens that from then
# on), whose ⇲ Dock brings it back; Shift+click still only toggles run sheet mode.
import json, mimetypes, os, sys
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
SHEET = {"title": "Dock", "perItem": 20, "items": [
    {"id": "a", "name": "Keynote", "start": None, "duration": 600},
    {"id": "b", "name": "Panel", "start": None, "duration": 300}]}
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        n = u[len(BASE):].split("?")[0].split("#")[0]
        if n == "changelog.html": return route.fulfill(status=404, body=b"")
        fp = os.path.join(PUBLIC, n)
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

INIT = "if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';localStorage.runsheet=%s}" % json.dumps(json.dumps(SHEET))
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1400, "height": 900})
    c.add_init_script(INIT); c.route("**/*", h)
    t = c.new_page(); t.on("pageerror", lambda e: errs.append("timer: " + str(e))); t.goto(BASE + "timer.html"); t.wait_for_timeout(1200)
    ls = lambda k: t.evaluate("localStorage.getItem(%s)" % json.dumps(k))
    docked = lambda: t.evaluate("!!document.querySelector('#rs-dock:not([hidden]) iframe')")
    ed = lambda: t.frame_locator("#rs-dock iframe")

    # Shift+click: run sheet mode only
    rsOn = lambda: t.evaluate("document.documentElement.classList.contains('runsheet')")
    was = rsOn()
    t.click("#btnrunsheet", modifiers=["Shift"]); t.wait_for_timeout(300)
    check("Shift+click toggles run sheet mode, opens nothing", rsOn() != was and not docked())
    if not rsOn(): t.click("#btnrunsheet", modifiers=["Shift"]); t.wait_for_timeout(300)

    # click: the editor along the bottom
    pages = len(c.pages)
    t.click("#btnrunsheet"); t.wait_for_timeout(1200)
    check("click: the editor docks along the bottom, no window", docked() and len(c.pages) == pages and t.evaluate("document.documentElement.classList.contains('rs-docked')"))
    box = t.locator("#rs-dock").bounding_box()
    check("… over the lower part of the screen", abs(box["y"] + box["height"] - 900) < 2 and 400 < box["height"] < 560, box)
    check("… with the sheet in it", ed().locator("#title").input_value() == "Dock")
    ed().locator("#title").fill("Docked show"); ed().locator("#title").press("Tab"); t.wait_for_timeout(400)
    check("an edit there reaches the sheet", json.loads(ls("runsheet"))["title"] == "Docked show", ls("runsheet"))
    ed().locator("#btn-next").click(); t.wait_for_timeout(800)
    check("Next there starts the item on the timer", json.loads(ls("runsheet_state")).get("currentId") == "a", ls("runsheet_state"))
    # something playing (the line-up tone): one bar, the timer's, on top of the dock; the docked editor shows none of its own
    t.evaluate("processTimerApiMessage({cmd: 'tone', on: true})"); t.wait_for_timeout(1600)
    bb, db = t.locator("#sting-bar").bounding_box(), t.locator("#rs-dock").bounding_box()
    check("playing: the timer's bar sits on top of the dock", bb and bb["y"] + bb["height"] <= db["y"] + 1 and "1 kHz" in t.inner_text("#sting-bar"), (bb, db))
    check("… and the docked editor doesn't show a second one", not ed().locator("#playing").is_visible())
    t.screenshot(path=OUTDIR + "/runsheet_dock.png")
    t.evaluate("processTimerApiMessage({cmd: 'tone', on: false})")

    # resize, reload
    bar = t.locator("#rs-dock .rsd-grip").bounding_box()
    t.mouse.move(bar["x"] + 10, bar["y"] + 5); t.mouse.down(); t.mouse.move(bar["x"] + 10, 500); t.mouse.move(bar["x"] + 10, 600); t.mouse.up()
    h1 = t.locator("#rs-dock").bounding_box()["height"]
    check("dragging the bar resizes it", abs(h1 - 300) < 15, h1)
    # a lost release (let go outside the window, another app took focus): the next move, with no button down, ends the drag
    bar = t.locator("#rs-dock .rsd-grip").bounding_box()
    t.mouse.move(bar["x"] + 10, bar["y"] + 5); t.mouse.down(); t.mouse.move(bar["x"] + 10, 550)
    t.evaluate("document.querySelector('#rs-dock .rsd-bar').dispatchEvent(new PointerEvent('pointermove', {clientY: 300, buttons: 0, bubbles: true, pointerId: 1}))")
    t.mouse.up()
    h1 = t.locator("#rs-dock").bounding_box()["height"]
    check("a lost release doesn't leave it resizing", abs(h1 - 350) < 15, h1)
    t.reload(); t.wait_for_timeout(1500)
    check("a reload brings it back, the same height", docked() and abs(t.locator("#rs-dock").bounding_box()["height"] - h1) < 3)

    # The deck editor (D) opens over the docked run sheet, not under it
    t.click("body", position={"x": 700, "y": 200}); t.keyboard.press("d"); t.wait_for_timeout(400)
    db = t.locator("#rs-dock").bounding_box()
    top = t.evaluate("([x, y]) => !!document.elementFromPoint(x, y).closest('#deck-editor')", [db["x"] + db["width"] / 2, db["y"] + db["height"] / 2])
    check("the deck editor opens over the docked run sheet", docked() and top)
    t.screenshot(path=OUTDIR + "/runsheet_dock_deck_editor.png")
    t.click("#deck-editor-close"); t.wait_for_timeout(300)

    # E closes and opens it (with the timer focused)
    t.click("body", position={"x": 700, "y": 300}); t.keyboard.press("e"); t.wait_for_timeout(300)
    check("E closes it", not docked() and ls("runsheet_dock_open") is None)
    t.keyboard.press("e"); t.wait_for_timeout(800)
    check("E opens it", docked())

    # ⧉: its own window from now on
    with c.expect_page() as pg: t.click("#rs-dock .rsd-pop")
    w = pg.value; w.on("pageerror", lambda e: errs.append("editor window: " + str(e))); w.wait_for_load_state(); w.wait_for_timeout(800)
    check("⧉: the editor in its own window, the dock closed", not docked() and ls("runsheet_editor_place") == "window" and "runsheet.html" in w.url)
    t.reload(); t.wait_for_timeout(1500)
    check("a reload doesn't dock it", not docked())
    w.close()                                      # (else the button reuses that window, by its name)
    with c.expect_page() as pg2: t.click("#btnrunsheet")
    w2 = pg2.value; w2.wait_for_load_state(); w2.wait_for_timeout(800)
    check("the button now opens the window", not docked() and "runsheet.html" in w2.url)
    check("the window offers ⇲ Dock", w2.is_visible("#btn-dock"))
    w2.click("#btn-dock"); t.wait_for_timeout(1200)
    check("⇲ Dock: back along the bottom, the window closed, docked from now on", docked() and w2.is_closed() and ls("runsheet_editor_place") is None)

    # ✕ closes it, and it stays closed over a reload
    t.click("#rs-dock .rsd-close"); t.wait_for_timeout(300)
    t.reload(); t.wait_for_timeout(1500)
    check("✕ closes it, and a reload leaves it closed", not docked())

    # never in the presenter window
    pr = c.new_page(); pr.on("pageerror", lambda e: errs.append("presenter: " + str(e)))
    t.click("#btnrunsheet"); t.wait_for_timeout(500)
    pr.goto(BASE + "timer.html?presenter"); pr.wait_for_timeout(1200)
    check("the presenter window never shows it", not pr.evaluate("!!document.querySelector('#rs-dock')"))
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
