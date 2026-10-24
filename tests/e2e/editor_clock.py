import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
import sys, os, mimetypes, json
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; OUT=OUTDIR; BASE="https://timer.sophtwhere.com/beta/"
SHEET={"title":"Day 1","perItem":20,"items":[{"id":"a","name":"Welcome","start":None,"duration":300},{"id":"b","name":"Keynote","start":None,"duration":1800}]}
def h(route, req):
    u=req.url
    if u.startswith(BASE):
        fp=os.path.join(ROOT,u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-proxy-server","--disable-features=WebRtcHideLocalIpsWithMdns"])
    c=b.new_context(ignore_https_errors=True, viewport={"width":1440,"height":900})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.runsheet=%s}" % json.dumps(json.dumps(SHEET)))
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html?remote=wss://localhost:8443/"); t.wait_for_timeout(1500)
    e=c.new_page(); e.on("pageerror", lambda x: errs.append("editor: "+str(x)))
    e.goto(BASE+"runsheet.html"); e.wait_for_timeout(1500)
    clk=lambda pg: pg.evaluate("[document.getElementById('clock-remain').textContent, document.getElementById('clock').className, document.getElementById('btn-pause').textContent]")
    print("local before:", clk(e))
    e.check("#active"); e.wait_for_timeout(500); e.click("#btn-next"); e.wait_for_timeout(2500)
    print("after Next:", clk(e), "| timer:", t.text_content("#remain_disp"))
    e.click("#btn-pause"); e.wait_for_timeout(1500); print("after Pause:", clk(e))
    e.screenshot(path=OUT+"/rsclock_paused.png", clip={"x":0,"y":0,"width":1440,"height":140})
    e.click("#btn-pause"); e.wait_for_timeout(1500); print("after Resume:", clk(e))
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 42000})"); e.wait_for_timeout(1500); print("timer at 42 s (impending):", clk(e))
    e.click("#btn-restart"); e.wait_for_timeout(300); print("one click:", e.text_content("#btn-restart"), "| timer:", t.text_content("#remain_disp"))
    e.click("#btn-restart"); e.wait_for_timeout(1500); print("two clicks:", clk(e), "| timer:", t.text_content("#remain_disp"),
        "| msg:", t.evaluate("processTimerApiMessage({cmd:'snapshot'}).message"), "| log len:", len(json.loads(t.evaluate("localStorage.runsheet_state"))["log"]))
    e.screenshot(path=OUT+"/rsclock.png", clip={"x":0,"y":0,"width":1440,"height":140})
    # outside run sheet: default duration
    e.uncheck("#active"); e.wait_for_timeout(500)
    t.evaluate("processTimerApiMessage({cmd:'default', msecs: 600000})")
    e.click("#btn-restart"); e.click("#btn-restart"); e.wait_for_timeout(1500); print("run sheet off, restart -> default 10 min:", clk(e))
    e.check("#active"); e.wait_for_timeout(500)
    # remote editor
    t.click("#btnshare"); t.wait_for_timeout(1500)
    t.click("#phone-panel .pp-modes button[data-mode=control]"); t.wait_for_timeout(300)
    link=t.text_content("#phone-panel .pp-link"); t.click("#btnshare")
    m=b.new_context(ignore_https_errors=True, viewport={"width":1400,"height":900}); m.route("**/*",h)
    d=m.new_page(); d.on("pageerror", lambda x: errs.append("remote: "+str(x)))
    d.goto(link); d.wait_for_timeout(3000)
    d.click("#viewbtn"); d.click("#viewlist button:has-text('Run sheet')"); d.wait_for_timeout(3000)
    F=lambda: d.frame(url=lambda u: 'runsheet.html' in u)
    print("remote clock:", clk(F()), "| timer:", t.text_content("#remain_disp"))
    F().click("#btn-pause"); d.wait_for_timeout(1500); print("remote Pause -> timer paused:", t.evaluate("document.documentElement.classList.contains('paused')"), clk(F()))
    F().click("#btn-pause"); d.wait_for_timeout(1500); print("remote Resume:", t.evaluate("document.documentElement.classList.contains('paused')"), clk(F()))
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 20000})"); d.wait_for_timeout(1500)
    F().click("#btn-restart"); F().click("#btn-restart"); d.wait_for_timeout(1500); print("remote Restart -> timer:", t.text_content("#remain_disp"), clk(F()))
    d.screenshot(path=OUT+"/rsclock_remote.png", clip={"x":0,"y":0,"width":1400,"height":160})
    # timer closed -> stale
    t.close(); e.wait_for_timeout(5500); print("timer closed, local:", clk(e))
print("errors:", errs)
