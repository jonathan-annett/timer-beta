import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# The clock badge and panel (clock-panel.js, inettime.js): no time server → local, yellow, Internet
# disabled; Sync now when one answers → internet, green; manual corrections; and a change of clock
# leaves a running countdown, the run sheet's log and the presenter window in step.
import json, mimetypes, os, sys, time
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
SHEET = {"title": "T", "perItem": 20, "items": [{"id": "a", "name": "One", "start": None, "duration": 600}, {"id": "b", "name": "Two", "start": None, "duration": 600}]}
OFFSET = 90000
up = {"timeapi": False}
errs = []

def h(route, req):
    u = req.url
    if "worldtimeapi.org" in u or "cloudflare.com" in u: return route.abort()
    if "timeapi.io" in u:
        if not up["timeapi"]: return route.abort()
        t = datetime.now(timezone.utc) + timedelta(milliseconds=OFFSET)
        return route.fulfill(status=200, headers={"content-type": "application/json", "access-control-allow-origin": "*"},
                             body=json.dumps({"dateTime": t.strftime("%Y-%m-%dT%H:%M:%S.%f") + "0"}))
    if u.startswith(BASE):
        if "changelog.html" in u: return route.fulfill(status=404, body=b"")   # no What's new toast over the panel
        fp =os.path.join(PUBLIC, u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()

def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server", "--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 720})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.whatsnew_seen='2099-01-01';localStorage.startedAt=String(Date.now());localStorage.defaultDuration=String(600000);localStorage.remote_server='wss://localhost:1/';localStorage.runsheet=%s}" % json.dumps(json.dumps(SHEET)))   # (no pairing server: the HTTP fallbacks)
    c.route("**/*", h)
    t = c.new_page()
    t.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    t.goto(BASE + "timer.html")
    t.wait_for_function("!timeProvider.busy && timeProvider.state !== 'checking'")

    badge = lambda: t.evaluate("(b => [b.className, b.textContent])(document.getElementById('clock-badge'))")
    radio = lambda v, prop: t.evaluate("([v,p]) => document.querySelector('#clock-panel input[value='+v+']')[p]", [v, prop])
    hidden = lambda: t.evaluate("document.getElementById('clock-panel').hidden")
    remain = lambda: t.evaluate("Number(localStorage.seekEndsAt) - timeProvider.now()")
    settled = "!timeProvider.busy"
    offset = lambda: t.evaluate("timeProvider.error")
    corr = lambda: t.inner_text("#clock-panel .cp-corr")

    check("no server: local, yellow", badge() == ["cb-local", "clock: local"], badge())
    t.click("#clock-badge"); t.wait_for_function(settled)
    check("badge opens the panel", not hidden())
    check("no server: Local selected", radio("local", "checked"))
    check("no server: Internet disabled", radio("internet", "disabled"))
    check("no server: says so", "Couldn’t reach" in t.inner_text("#clock-panel .cp-note"), t.inner_text("#clock-panel .cp-note"))
    check("no server: internet stays wanted for the next load", t.evaluate("localStorage.clock_mode") == "internet")
    t.screenshot(path=OUTDIR + "/clock_local.png")
    t.click("#clock-badge")
    check("badge closes the panel", hidden())
    t.click("#clock-badge"); t.wait_for_function(settled)

    # Run sheet running, so the log has to follow the clock
    t.evaluate("processTimerApiMessage({cmd:'runsheetnext'})") if t.evaluate("window.runsheet.setActive ? (window.runsheet.setActive(true), true) : false") else None
    t.wait_for_timeout(300)
    state = lambda: t.evaluate("JSON.parse(localStorage.runsheet_state)")
    before_state = state()
    before = remain()

    up["timeapi"] = True
    t.click("#clock-panel .cp-sync"); t.wait_for_function("timeProvider.state === 'internet' && !timeProvider.busy")
    check("Sync now: internet, green", badge() == ["cb-internet", "clock: internet"], badge())
    check("Sync now: Internet enabled and selected", not radio("internet", "disabled") and radio("internet", "checked"))
    check("Sync now: the offset is the server's", abs(offset() - OFFSET) < 1000, offset())
    check("Sync now: correction shown", corr() == "+1:30", corr())
    check("the countdown didn't jump", abs(remain() - before) < 2000, (before, remain()))
    after_state = state()
    if before_state.get("log"):
        check("the run sheet's log moved with the clock", abs(after_state["log"][0]["actual"] - before_state["log"][0]["actual"] - offset()) < 1000)
        check("the run sheet still follows the timer", after_state["timerStart"] == t.evaluate("Number(localStorage.startedAt)"), after_state["timerStart"])
    else:
        check("run sheet started for the test", False, before_state)
    t.screenshot(path=OUTDIR + "/clock_internet.png")

    presenter = c.new_page(); presenter.goto(BASE + "timer.html?presenter"); presenter.wait_for_timeout(500)
    check("presenter window has no badge", presenter.evaluate("!document.getElementById('clock-badge')"))

    before = remain()
    t.check("#clock-panel input[value=manual]")
    check("manual: blue", badge() == ["cb-manual", "clock: manual"], badge())
    check("manual: starts from the current correction", abs(offset() - OFFSET) < 1000, offset())
    start = offset()
    for ms in ("60000", "15000", "1000", "-1000"):
        t.click("#clock-panel .cp-steps button[data-ms='%s']" % ms)
    check("manual: steps add up", offset() - start == 75000, offset() - start)
    check("the countdown didn't jump (manual)", abs(remain() - before) < 2000, (before, remain()))
    presenter.wait_for_timeout(200)
    check("presenter window follows the clock", presenter.evaluate("timeProvider.error") == offset())
    presenter.close()

    # A specific time: an hour and a half ahead of this computer
    target = t.evaluate("(d => [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2,'0')).join(':'))(new Date(Date.now() + 5400000))")
    t.fill("#clock-panel .cp-set input", target)
    t.click("#clock-panel .cp-apply")
    check("manual: set time", abs(offset() - 5400000) < 1500, offset())
    check("manual: correction shown", corr()[:6] in ("+1:30:", "+1:29:"), corr())
    t.wait_for_timeout(300)
    t.screenshot(path=OUTDIR + "/clock_manual.png")
    kept = offset()
    t.reload(); t.wait_for_timeout(600)
    check("manual: kept over a reload", badge()[0] == "cb-manual" and offset() == kept, (badge(), offset()))

    t.click("#clock-badge"); t.wait_for_function(settled)
    before = remain()
    t.check("#clock-panel input[value=local]")
    check("local: yellow, no correction", badge()[0] == "cb-local" and offset() == 0 and t.evaluate("localStorage.internetTimeError") == "0")
    check("the countdown didn't jump (local)", abs(remain() - before) < 2000, (before, remain()))

    # The real pairing server's `time` message, with every HTTP time server blocked
    up["timeapi"] = False
    c4 = b.new_context(ignore_https_errors=True)
    c4.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.whatsnew_seen='2099-01-01';localStorage.remote_server=%s}" % json.dumps(os.environ.get("E2E_SERVER", "wss://localhost:8443/")))
    c4.route("**/*", h)
    s = c4.new_page(); s.goto(BASE + "timer.html")
    s.wait_for_function("!timeProvider.busy && timeProvider.state !== 'checking'")
    check("pairing server: internet, green", s.evaluate("timeProvider.state") == "internet", s.evaluate("timeProvider.state"))
    check("pairing server: named as the source", s.evaluate("timeProvider.source") == "localhost", s.evaluate("timeProvider.source"))
    check("pairing server: same machine, so no real correction", abs(s.evaluate("timeProvider.error")) < 100, s.evaluate("timeProvider.error"))

    # A browser from before the modes: Shift+L had saved a 0
    c2 = b.new_context(ignore_https_errors=True)
    c2.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0'}")
    c2.route("**/*", h)
    o = c2.new_page(); o.goto(BASE + "timer.html"); o.wait_for_timeout(400)
    check("an old saved 0 means local", o.evaluate("timeProvider.mode") == "local")

    # Touch screen: the badge has to be there and clear of the strip
    c3 = b.new_context(ignore_https_errors=True, viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    c3.route("**/*", h)
    m = c3.new_page(); m.goto(BASE + "timer.html"); m.wait_for_timeout(1500)
    check("touch: badge shown", m.evaluate("(r => r.width > 0 && r.top >= 0)(document.getElementById('clock-badge').getBoundingClientRect())"))
    m.screenshot(path=OUTDIR + "/clock_touch.png")
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
