import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
import sys, os, mimetypes, json
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; OUT=OUTDIR; BASE="https://timer.sophtwhere.com/beta/"
SHEET={"title":"Day 1","perItem":20,"items":[{"id":"a","name":"Welcome","start":None,"duration":300},{"id":"b","name":"Keynote","start":None,"duration":1800},{"id":"c","name":"Panel","start":None,"duration":1200},{"id":"z","name":"Close","start":None,"duration":None}]}
def h(route, req):
    u=req.url
    if u.startswith(BASE):
        fp=os.path.join(ROOT,u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-proxy-server"])
    c=b.new_context(ignore_https_errors=True, viewport={"width":1440,"height":900})
    c.clock.install()
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.runsheet=%s}" % json.dumps(json.dumps(SHEET)))
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html"); t.wait_for_timeout(1500)
    e=c.new_page(); e.on("pageerror", lambda x: errs.append("editor: "+str(x)))
    e.goto(BASE+"runsheet.html"); e.wait_for_timeout(1500)
    e.check("#active"); e.wait_for_timeout(500); e.click("#btn-next"); e.wait_for_timeout(1500)
    st=lambda: e.evaluate("[...document.querySelectorAll('#rs-table tbody tr')].map(tr=>tr.querySelector('[data-field=name]').value+': '+tr.querySelector('.status').innerText+' | ends '+tr.querySelector('.ends').textContent)")
    print("start:", st(), "| live:", e.text_content("#live"))
    e.click("#btn-pause"); e.wait_for_timeout(500)
    c.clock.fast_forward("02:00"); e.wait_for_timeout(2500)
    print("paused 2 min:", st()); print("  live:", e.text_content("#live"))
    print("  dashboard next:", t.text_content("#rs_next"))
    t.evaluate("(()=>{const prev=window.timerAPI; window.timerAPI={send(m){ if(prev&&prev.send) prev.send(m); if(m&&m.setVariableValues&&m.setVariableValues.rs_list) window.__rl=m.setVariableValues.rs_list; }}; processTimerApiMessage({cmd:'opened'});})()")
    print("  phone list:", [(r['n'], r['p'], r.get('x'), r.get('s')) for r in json.loads(t.evaluate("window.__rl"))['rows']])
    c.clock.fast_forward("01:00"); e.wait_for_timeout(2500)
    print("paused 3 min:", st()[1], "|", e.text_content("#live"))
    e.screenshot(path=OUT+"/rsshift_paused.png")
    e.click("#btn-pause"); e.wait_for_timeout(1500)
    print("resumed:", st()[1], "|", e.text_content("#live"))
    c.clock.fast_forward("04:00"); e.wait_for_timeout(2500)
    before=json.loads(t.evaluate("localStorage.runsheet_state"))["log"][0]
    e.click("#btn-restart"); e.click("#btn-restart"); e.wait_for_timeout(2500)
    after=json.loads(t.evaluate("localStorage.runsheet_state"))["log"][0]
    print("restart: log actual moved by", (after["actual"]-before["actual"])/1000, "s; orig kept:", after.get("orig")==before["actual"], "restarts:", after.get("restarts"))
    print("after restart:", st()); print("  live:", e.text_content("#live")); print("  dashboard cur:", t.text_content("#rs_cur"), "| next:", t.text_content("#rs_next"))
    e.screenshot(path=OUT+"/rsshift_restart.png")
    e.click("#btn-next"); e.wait_for_timeout(1500)
    print("Next after restart:", st()[:2], "|", e.text_content("#live"))
print("errors:", errs)
