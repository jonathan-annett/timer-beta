import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh)
# The clock badge says when the computer is offline (clock-panel.js): green "clock: internet" read as
# "online" with a laptop off its wifi, and pairing then failed. Off the network the badge turns red,
# "offline · clock synced hh:mm" (the clock keeps its internet time); back on, it's green again; and
# internet time that couldn't be had while offline is fetched once it's back.
import mimetypes, os, sys
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        if "changelog.html" in u: return route.fulfill(status=404, body=b"")
        fp = os.path.join(PUBLIC, u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)
ARGS = ["--no-proxy-server", "--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"]

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 720})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.whatsnew_seen='2099-01-01';localStorage.remote_server=%r}" % SERVER)
    c.route("**/*", h)
    t = c.new_page(); t.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    t.goto(BASE + "timer.html")
    t.wait_for_function("timeProvider.state === 'internet' && clockPanel.online === true", timeout=15000)
    badge = lambda: t.evaluate("(b => [b.className, b.textContent, b.title])(document.getElementById('clock-badge'))")
    hm = t.evaluate("(d => String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'))(new Date(timeProvider.syncedAt + timeProvider.error))")
    check("online, synced by the pairing server: green, clock: internet", badge()[:2] == ["cb-internet", "clock: internet"], badge())

    c.set_offline(True); t.wait_for_timeout(300)
    bd = badge()
    check("the network drops: red at once, offline · clock synced hh:mm", "cb-offline" in bd[0] and bd[1] == "offline · clock synced " + hm, bd)
    check("… its tooltip: offline, nothing can connect, the clock is fine", "offline (no network)" in bd[2] and "can’t connect" in bd[2] and "internet time it got at " + hm in bd[2], bd[2])
    check("… the clock stays on internet time", t.evaluate("timeProvider.state") == "internet")
    t.click("#clock-badge"); t.wait_for_timeout(300)
    check("… the panel: Connection offline, and why", t.text_content("#clock-panel .cp-net") == "offline" and t.is_visible("#clock-panel .cp-netnote"), t.text_content("#clock-panel .cp-net"))
    t.locator("#clock-badge").screenshot(path=OUTDIR + "/clock_badge_offline.png")
    t.screenshot(path=OUTDIR + "/clock_panel_offline.png", clip={"x": 880, "y": 0, "width": 400, "height": 330})

    c.set_offline(False)
    t.wait_for_function("clockPanel.online === true", timeout=10000)
    check("back online: green again", badge()[:2] == ["cb-internet", "clock: internet"] and "online (localhost)" == t.text_content("#clock-panel .cp-net"), (badge(), t.text_content("#clock-panel .cp-net")))
    t.click("#clock-badge")

    # internet time that failed while offline comes back with the network
    c.set_offline(True); t.wait_for_timeout(300)
    t.evaluate("timeProvider.syncNow()"); t.wait_for_function("!timeProvider.busy", timeout=15000)
    bd = badge()
    check("Sync now while offline: local time, red, offline · clock: local", t.evaluate("timeProvider.state") == "local" and bd[1] == "offline · clock: local" and "cb-offline" in bd[0], bd)
    c.set_offline(False)
    t.wait_for_function("timeProvider.state === 'internet' && clockPanel.online === true", timeout=15000)
    check("… back online: internet time again by itself, green", badge()[:2] == ["cb-internet", "clock: internet"], badge())
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
