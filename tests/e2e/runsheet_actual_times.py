import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
import sys, os, mimetypes, json
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; OUT=OUTDIR; BASE="https://timer.sophtwhere.com/beta/"
SHEET={"title":"Names only","perItem":20,"items":[{"id":"a","name":"Welcome","start":None,"duration":300},{"id":"b","name":"Keynote","start":None,"duration":1200},{"id":"c","name":"Panel","start":None,"duration":1200},{"id":"d","name":"Close","start":None,"duration":600}]}
def h(route, req):
    u=req.url
    if u.startswith(BASE):
        fp=os.path.join(ROOT,u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-proxy-server","--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"])
    c=b.new_context(ignore_https_errors=True, viewport={"width":1440,"height":900})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.runsheet=%s}" % json.dumps(json.dumps(SHEET)))
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html"); t.wait_for_timeout(1500)
    e=c.new_page(); e.on("pageerror", lambda x: errs.append("editor: "+str(x)))
    e.goto(BASE+"runsheet.html"); e.wait_for_timeout(1200)
    def rows(label):
        r=e.evaluate("[...document.querySelectorAll('#rs-table tbody tr')].map(tr=>{const s=tr.querySelector('[data-field=start]'),en=tr.querySelector('[data-field=end]');return tr.querySelector('[data-field=name]').value+': start '+(s.value||('('+s.placeholder+')'))+' ends '+(en?(en.value||('('+en.placeholder+')')):'-')+' | '+tr.querySelector('.status').innerText.replace(/\\n/g,' ')})")
        print(label); [print("   ", x) for x in r]
    def fwd(mmss): e.wait_for_timeout(6000)
    e.check("#active"); e.wait_for_timeout(300)
    rows("before start:")
    e.click("#btn-next"); e.wait_for_timeout(1500); rows("Next → Welcome:")
    fwd(0); e.click("#btn-restart"); e.wait_for_timeout(2000); rows("6 s later, Restart:")
    fwd(0); e.click("#rs-table tr[data-id=a] button.go"); e.wait_for_timeout(2000); rows("6 s later, ▶ on Welcome:")
    fwd(0); e.click("#btn-next"); e.wait_for_timeout(2000); rows("6 s later, Next → Keynote:")
    e.screenshot(path=OUT+"/rsactual.png", clip={"x":0,"y":0,"width":1060,"height":420})
print("errors:", errs)
