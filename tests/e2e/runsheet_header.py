import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# The run sheet editor's header keeps its height when the show starts: the status (#live) changes length
# (Ready … if started now, then the item's timings) and used to push ? and the time of day onto a second
# line or let them back, so Back and Next moved as the first item started. It now takes the space left, shortened with … (the
# whole text as its tooltip).
import json, mimetypes, os, sys
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
SHEET = {"title": "Annual general meeting of the society", "perItem": 20, "items": [
    {"id": "a", "name": "Opening keynote: the future of everything, and what comes after it", "start": None, "duration": 1200},
    {"id": "b", "name": "Panel discussion with the whole board and invited guests", "start": None, "duration": 900},
    {"id": "c", "name": "Close", "start": None, "duration": 300}]}
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        name = u[len(BASE):].split("?")[0].split("#")[0]
        if name == "changelog.html": return route.fulfill(status=404, body=b"")
        fp = os.path.join(PUBLIC, name)
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)
INIT = ("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';"
        "localStorage.runsheet=%s;localStorage.runsheet_state=JSON.stringify({active:true,index:-1,history:[],log:[]})}") % json.dumps(json.dumps(SHEET))

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server"])
    c = b.new_context(ignore_https_errors=True); c.add_init_script(INIT); c.route("**/*", h)
    t = c.new_page(); t.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    t.goto(BASE + "timer.html"); t.wait_for_timeout(1200)
    for w in (1280, 1024):
        e = c.new_page(); e.set_viewport_size({"width": w, "height": 800}); e.on("pageerror", lambda x: errs.append("editor: " + str(x)))
        e.goto(BASE + "runsheet.html"); e.wait_for_timeout(1500)
        geo = lambda: e.evaluate("""(() => { const r = id => document.getElementById(id).getBoundingClientRect();
          return { next: Math.round(r('btn-next').top), header: Math.round(document.querySelector('header').getBoundingClientRect().height),
                   tod: Math.round(r('tod').top), help: Math.round(r('btn-help').top), live: document.getElementById('live').textContent }; })()""")
        before = geo()
        t.evaluate("window.runsheet.next()"); e.wait_for_timeout(1800)
        after = geo()
        check(f"{w} px: the show starts, the status changes length", len(after["live"]) != len(before["live"]), (before["live"], after["live"]))
        check(f"… the header keeps its height, Back and Next stay put", after["header"] == before["header"] and after["next"] == before["next"], (before, after))
        check(f"… the time of day stays on the line with ?", abs(after["tod"] - after["help"]) < 12, after)
        check(f"… the whole status is its tooltip", e.get_attribute("#live", "title") == after["live"])
        e.locator("header").screenshot(path=OUTDIR + f"/runsheet_header_{w}.png")
        t.evaluate("window.runsheet.reset()"); t.wait_for_timeout(600)
        e.close()
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
