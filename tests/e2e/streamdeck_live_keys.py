import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Start + time and Pause + time (streamdeck.js start_info, pause_info; the Mini's defaults): Start over
# the default duration (or the time being typed); the countdown over Pause / Resume over the pauses,
# counting while paused and dimmed after; and the run sheet's Now key (the item running now and its time).
# Through StreamDeck.faces / press, as the virtual decks use it.
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
INIT = "if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';localStorage.defaultDuration='600000'}"

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 800}); c.add_init_script(INIT); c.route("**/*", h)
    t = c.new_page(); t.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    t.goto(BASE + "timer.html"); t.wait_for_timeout(1200)
    mini = lambda: t.evaluate("StreamDeck.faces('mini')")
    find = lambda fs, a: next(f for f in fs if f["a"] == a)
    rows = lambda a: [(r or {}).get("text") for r in find(mini(), a)["rows"]]

    acts = [f["a"] for f in mini()]
    check("the Mini's default has Start + time and Pause + time", "start_info" in acts and "pause_info" in acts, acts)
    check("Start + time: Start over the default", rows("start_info") == ["Start", None, "10 min"], rows("start_info"))
    t.evaluate("processTimerApiMessage({cmd: 'default', msecs: 5400000})"); t.wait_for_timeout(400)
    check("… a 90-minute default reads 1h 30m", rows("start_info")[2] == "1h 30m", rows("start_info"))
    t.keyboard.press("4"); t.keyboard.press("5"); t.wait_for_timeout(300)
    st = find(mini(), "start_info")["rows"][2]
    check("… while a time is typed, that time (yellow)", st["text"] == "45:00" and st.get("color") == "#ffcc33", st)
    t.keyboard.press("Escape"); t.wait_for_timeout(300)

    t.evaluate("processTimerApiMessage({cmd: 'start', msecs: 900000})"); t.wait_for_timeout(1300)
    r = rows("pause_info")
    check("Pause + time, running: the countdown over Pause, nothing below", r[0] in ("14:59", "14:58") and r[1] == "Pause" and r[2] is None, r)
    i = acts.index("pause_info")
    t.evaluate("i => StreamDeck.press(i, 'mini')", i); t.wait_for_timeout(2300)
    f = find(mini(), "pause_info"); r = [(x or {}).get("text") for x in f["rows"]]
    check("pressed: Resume, the countdown frozen, the pause counting up, orange", r[1] == "Resume" and r[2] in ("(0:02)", "(0:03)") and f["bg"] == "#2d1a00", (r, f["bg"]))
    frozen = r[0]
    t.wait_for_timeout(1500); r2 = rows("pause_info")
    check("… a moment later: the countdown still frozen, the pause further on", r2[0] == frozen and r2[2] > r[2], (r, r2))
    t.screenshot(path=OUTDIR + "/live_keys_timer.png")
    t.evaluate("""(() => { const g = document.createElement('div'); g.id='g'; g.style.cssText='position:fixed;left:10px;top:10px;z-index:2147483647;display:grid;grid-template-columns:repeat(3,80px);gap:6px;padding:10px;background:#333';
      StreamDeck.faces('mini').forEach(f => { const c = document.createElement('canvas'); c.width = c.height = 80; DeckFace.paint(c.getContext('2d'), f, 80); g.appendChild(c); }); document.body.appendChild(g); })()""")
    t.locator("#g").screenshot(path=OUTDIR + "/live_keys_mini_paused.png"); t.evaluate("document.getElementById('g').remove()")
    t.evaluate("i => StreamDeck.press(i, 'mini')", i); t.wait_for_timeout(1300)
    f = find(mini(), "pause_info"); r = [(x or {}).get("text") for x in f["rows"]]
    check("resumed: Pause, the countdown running on, the pauses frozen and dimmed (+)", r[1] == "Pause" and r[0] != frozen and r[2].startswith("(+0:0") and f["rows"][2].get("alpha") == 0.5, (r, f["rows"][2]))
    t.evaluate("""(() => { const g = document.createElement('div'); g.id='g'; g.style.cssText='position:fixed;left:10px;top:10px;z-index:2147483647;display:grid;grid-template-columns:repeat(3,80px);gap:6px;padding:10px;background:#333';
      StreamDeck.faces('mini').forEach(f => { const c = document.createElement('canvas'); c.width = c.height = 80; DeckFace.paint(c.getContext('2d'), f, 80); g.appendChild(c); }); document.body.appendChild(g); })()""")
    t.locator("#g").screenshot(path=OUTDIR + "/live_keys_mini_running.png")
    pal = t.evaluate("(() => { document.getElementById('g').remove(); document.dispatchEvent(new KeyboardEvent('keydown', {key: 'd', bubbles: true})); return [...document.querySelectorAll('#deck-palette .deck-palette-chip')].map(c => c.dataset.action); })()")
    check("both are in the palette (for any deck)", "start_info" in pal and "pause_info" in pal)

    # the run sheet's Now key: the item running now and its time (as the dashboard's NOW row)
    c2 = b.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 800}); c2.route("**/*", h)
    sheet = {"title": "Show", "perItem": 20, "items": [{"id": "a", "name": "Keynote: the future of everything", "start": None, "duration": 600}, {"id": "b", "name": "Panel", "start": None, "duration": 300}]}
    lay = ["rs_prev", "rs_now", "rs_next", "rs_status"] + ["empty"] * 28
    c2.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';localStorage.runsheet=%s;localStorage.runsheet_state=JSON.stringify({active:true,index:-1,history:[],log:[]});localStorage.streamdeck_layout_xl=%s}" % (json.dumps(json.dumps(sheet)), json.dumps(json.dumps(lay))))
    r = c2.new_page(); r.on("pageerror", lambda e: errs.append("timer2: " + str(e)))
    r.goto(BASE + "timer.html"); r.wait_for_timeout(1500)
    now = lambda: r.evaluate("StreamDeck.faces('xl')[1]")
    back = lambda: r.evaluate("StreamDeck.faces('xl')[0]")
    f = now()
    check("Now key before the show: — and dimmed", f["rs"]["body"] == "—" and f["fg"] == "#444444", (f["rs"], f["fg"]))
    check("Back before the show: dimmed, just its caption", back()["fg"] == "#444444" and not back()["rs"]["body"], back())
    r.evaluate("window.runsheet.next()"); r.wait_for_timeout(1500)
    check("Back on the first item: where it goes, Before the show", back()["rs"]["cap"] == "◀ BACK" and back()["rs"]["body"] == "Before the show", back()["rs"])
    f = now(); hm = r.evaluate("(d => String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'))(new Date())")
    check("… after Next: NOW, the item's name, its time (duration · started)", f["rs"]["cap"] == "NOW" and f["rs"]["body"].startswith("Keynote") and f["rs"].get("foot") in ("10 min · " + hm, "10 min · " + hm) and f["bg"] == "#0b2a4a", f["rs"])
    r.evaluate("""(() => { const g = document.createElement('div'); g.id='g'; g.style.cssText='position:fixed;left:10px;top:10px;z-index:2147483647;display:grid;grid-template-columns:repeat(4,96px);gap:6px;padding:10px;background:#333';
      StreamDeck.faces('xl').slice(0, 4).forEach(f => { const c = document.createElement('canvas'); c.width = c.height = 96; DeckFace.paint(c.getContext('2d'), f, 96); g.appendChild(c); }); document.body.appendChild(g); })()""")
    r.locator("#g").screenshot(path=OUTDIR + "/rs_now_key.png")
    r.evaluate("window.runsheet.next()"); r.wait_for_timeout(1200)
    check("… and follows the show (Next: Panel)", now()["rs"]["body"] == "Panel", now()["rs"])
    check("Back then names the item it goes back to (as Next does)", back()["rs"]["body"].startswith("Keynote"), back()["rs"])
    r.evaluate("""(() => { const g = document.createElement('div'); g.id='g2'; g.style.cssText='position:fixed;left:10px;top:10px;z-index:2147483647;display:grid;grid-template-columns:repeat(4,96px);gap:6px;padding:10px;background:#333';
      StreamDeck.faces('xl').slice(0, 4).forEach(f => { const c = document.createElement('canvas'); c.width = c.height = 96; DeckFace.paint(c.getContext('2d'), f, 96); g.appendChild(c); }); document.body.appendChild(g); })()""")
    r.locator("#g2").screenshot(path=OUTDIR + "/rs_back_key.png"); r.evaluate("document.getElementById('g2').remove()")
    r.evaluate("window.runsheet.back()"); r.wait_for_timeout(1200)
    check("… and after Back, Before the show again", back()["rs"]["body"] == "Before the show" and now()["rs"]["body"].startswith("Keynote"), (back()["rs"], now()["rs"]))
    pal = r.evaluate("(() => { document.getElementById('g').remove(); document.dispatchEvent(new KeyboardEvent('keydown', {key: 'd', bubbles: true})); return [...document.querySelectorAll('#deck-palette .deck-palette-chip')].map(c => c.dataset.action); })()")
    check("Now is in the palette (Run sheet)", "rs_now" in pal)
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
