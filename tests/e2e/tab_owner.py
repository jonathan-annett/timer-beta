import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# One timer tab runs the timer (tab-owner.js). A second timer tab becomes a countdown view under a
# banner (it keeps its other settings, e.g. ?remote=), runs no run sheet, and so can't fight the
# first after a run sheet Reset (the flicker it caused). "Use this tab instead" moves the timer to
# it and the old tab steps down; when the owner closes, a countdown view takes over by itself. A
# presenter window is left alone.
import json, mimetypes, os, sys
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
SHEET = {"title": "T", "perItem": 20, "items": [{"id": "a", "name": "Keynote", "start": None, "duration": 60}, {"id": "b", "name": "Panel", "start": None, "duration": 60}]}
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

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1100, "height": 700})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';localStorage.showmessages='1';localStorage.runsheet=%s;localStorage.runsheet_state=JSON.stringify({active:true,index:-1,history:[],log:[]})}" % json.dumps(json.dumps(SHEET)))
    c.route("**/*", h)
    t1 = c.new_page(); t1.on("pageerror", lambda e: errs.append("t1: " + str(e))); t1.goto(BASE + "timer.html"); t1.wait_for_timeout(1200)
    owner = lambda pg: pg.evaluate("window.timerOwner ? (window.timerOwner.other ? 'view' : 'owner') : 'none'")
    check("the first tab runs the timer", owner(t1) == "owner" and t1.evaluate("!!window.runsheet"), owner(t1))

    t2 = c.new_page(); t2.on("pageerror", lambda e: errs.append("t2: " + str(e))); t2.goto(BASE + "timer.html?remote=wss://example.test/"); t2.wait_for_timeout(1500)
    check("a second tab becomes a countdown view, keeping its settings", "presenter&othertab" in t2.url and "remote=" in t2.url and owner(t2) == "view", t2.url)
    check("… says so, with a way to take over", t2.is_visible("aside#othertab") and "another tab" in t2.inner_text("aside#othertab"))
    check("… and runs no run sheet of its own", not t2.evaluate("!!window.runsheet"))

    # the case that flickered: the run sheet running, then Reset show, with two tabs open
    e = c.new_page(); e.goto(BASE + "runsheet.html"); e.wait_for_timeout(800); e.on("dialog", lambda d: d.accept())
    e.click("#btn-next"); e.wait_for_timeout(4000)
    e.click("#btn-reset"); e.wait_for_timeout(500)
    sample = lambda pg: pg.evaluate("""() => new Promise(r => { const out = []; const iv = setInterval(() => out.push(document.getElementById('remain_disp').textContent + (document.documentElement.classList.contains('paused') ? 'P' : '-')), 100); setTimeout(() => { clearInterval(iv); r(out); }, 2500); })""")
    s1, s2 = sample(t1), sample(t2)
    check("after Reset: the timer holds still", set(s1) == {"1:00P"}, sorted(set(s1)))
    check("after Reset: the other tab shows the same, no flicker", set(s2) == {"1:00P"}, sorted(set(s2)))
    t2.screenshot(path=OUTDIR + "/tab_owner_view.png")

    # Use this tab instead
    t2.click("aside#othertab button"); t2.wait_for_timeout(1500); t1.wait_for_timeout(1500)
    check("Use this tab instead: it runs the timer now", owner(t2) == "owner" and "othertab" not in t2.url and "remote=" in t2.url and t2.evaluate("!!window.runsheet"), (owner(t2), t2.url))
    check("… and the old tab steps down to a countdown view", owner(t1) == "view" and "othertab" in t1.url, (owner(t1), t1.url))
    check("… the countdown carries on (the same show)", t2.text_content("#remain_disp") == "1:00", t2.text_content("#remain_disp"))

    # the owner closes: the countdown view takes over
    t2.close(); t1.wait_for_timeout(3000)
    check("the owner closed: the other tab takes over", owner(t1) == "owner" and "othertab" not in t1.url and t1.evaluate("!!window.runsheet"), (owner(t1), t1.url))

    # a presenter window is left alone
    pr = c.new_page(); pr.goto(BASE + "timer.html?presenter"); pr.wait_for_timeout(1500)
    check("a presenter window is left alone", "othertab" not in pr.url and not pr.is_visible("aside#othertab"), pr.url)
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
