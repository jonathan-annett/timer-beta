import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
# PowerPoint computers are an alpha-only trial (features.js): on a beta address none of their controls
# show and the hub doesn't start; with the feature on (as on alpha.*), they're all there.
import os, mimetypes
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; OUT=OUTDIR; BASE="https://timer.sophtwhere.com/beta/"
def h(route, req):
    u=req.url
    if u.startswith(BASE):
        fp=os.path.join(ROOT,u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs=[]
ARGS=["--no-proxy-server","--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"]
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    for on in (False, True):
        c=b.new_context(ignore_https_errors=True, viewport={"width":1280,"height":800})
        c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.remote_link_mode='pptx'}")
        if on: c.add_init_script("window.TimerFeatures = { pptx: true }")
        c.route("**/*",h)
        t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
        t.goto(BASE+"timer.html?remote="+SERVER); t.wait_for_timeout(1500)
        t.click("#btnshare"); t.wait_for_timeout(1200)
        vis=lambda pg, sel: pg.evaluate(f"(e => !!e && getComputedStyle(e).display !== 'none')(document.querySelector({sel!r}))")
        print("pptx on" if on else "pptx off", "| hub:", t.evaluate("!!window.pptxHub"), "| share PowerPoint button:", vis(t, "#phone-panel .pp-modes button[data-mode=pptx]"),
              "| link mode shown:", t.evaluate("[...document.querySelectorAll('#phone-panel .pp-modes button.on')].map(b=>b.dataset.mode)"))
        t.click("#btnshare"); t.keyboard.press("d"); t.wait_for_timeout(600)
        print("   deck editor: chips", t.evaluate("document.querySelectorAll('.deck-palette-chip').length"), "| Close slides chip:", t.evaluate("!!document.querySelector('.deck-palette-chip[data-action=pptx_close]')"))
        e=c.new_page(); e.on("pageerror", lambda x: errs.append("editor: "+str(x)))
        e.goto(BASE+"runsheet.html"); e.wait_for_timeout(1000)
        print("   editor: Slides column:", vis(e, "#rs-table th.deck"), "| Close slides:", vis(e, "#btn-pptxclose"))
        r=c.new_page(); r.on("pageerror", lambda x: errs.append("receiver: "+str(x)))
        r.goto(BASE+"pptx.html#r=ABCDEFGH&p="+"k"*24); r.wait_for_timeout(800)
        print("   receiver page:", r.evaluate("(document.getElementById('blocked')||{}).textContent || 'running'")[:70])
        c.close()
print("errors:", errs)
