import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
from _proximity import approve   # the proximity check: type each new device's number on the timer
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
# The assist station is an alpha-only trial (features.js TimerFeatures.assist): off, assist.html says
# it isn't available, and a timer without the trial treats a station (even a newer one) as a plain
# view-only device: no request to move starts in the share panel, and a move it sends does nothing.
import os, mimetypes, sys
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

ARGS = ["--no-proxy-server", "--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"]
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)

    # The page, off (this host isn't alpha) and on
    for on in (False, True):
        ctx = b.new_context(ignore_https_errors=True)
        ctx.route("**/*", h)
        if on: ctx.add_init_script("window.TimerFeatures = { assist: true }")
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append("assist page: " + str(e)))
        pg.goto(BASE + "assist.html?remote=" + SERVER); pg.wait_for_timeout(600)
        refused = "isn’t available" in pg.inner_text("main")
        check("assist.html " + ("on: works" if on else "off: says it isn't available"), refused != on, pg.inner_text("main")[:120])
        ctx.close()

    # A timer without the trial, a station with it
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 800})
    c.add_init_script("""if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01'}""")
    c.route("**/*", h)
    t = c.new_page(); t.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    t.goto(BASE + "timer.html?remote=" + SERVER); t.wait_for_timeout(1500)
    t.evaluate("document.getElementById('whats-new')?.remove()")
    t.click("#btnshare"); t.wait_for_timeout(1500)
    t.click("#phone-panel .pp-pair"); t.wait_for_timeout(800)
    code = t.text_content("#phone-panel .pp-digits").replace(" ", "")

    a_ctx = b.new_context(ignore_https_errors=True, viewport={"width": 1100, "height": 900}); a_ctx.route("**/*", h)
    a_ctx.add_init_script("window.TimerFeatures = { assist: true }")
    a = a_ctx.new_page(); a.on("pageerror", lambda e: errs.append("assist: " + str(e)))
    a.goto(BASE + "assist.html?remote=" + SERVER); a.wait_for_timeout(800)
    a.fill("#code", code); a.wait_for_timeout(3000)
    approve(t); a.wait_for_timeout(1500)
    check("the station pairs (as a view-only device)", a.is_visible("#paired"))

    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 600000})"); t.wait_for_timeout(1000)
    a.click("#ask"); a.wait_for_timeout(1500)
    asks = t.evaluate("document.querySelectorAll('#phone-panel .pp-pending button[data-act=assist-ok]').length")
    check("off: no request to move starts on the timer", asks == 0, asks)
    before = t.evaluate("processTimerApiMessage({cmd:'snapshot'}).startedAt")
    a.evaluate("window.__assistHear('Good morning everyone', 20000)"); a.wait_for_timeout(300)
    a.click("#log .ln[data-i='0']"); a.wait_for_timeout(300)
    if a.evaluate("!!document.querySelector('#log .ln.armed button[data-act=move]')"):
        a.click("#log .ln.armed button[data-act=move]"); a.wait_for_timeout(1500)
    after = t.evaluate("processTimerApiMessage({cmd:'snapshot'}).startedAt")
    check("off: the timer's start doesn't move", after == before, (before, after))
    check("off: no move notice on the timer", not t.evaluate("!!(document.getElementById('assist-notice') && !document.getElementById('assist-notice').hidden)"))
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
