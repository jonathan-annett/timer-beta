import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
import sys, os, mimetypes, json, datetime
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; OUT=OUTDIR; BASE="https://timer.sophtwhere.com/beta/"
SHEET={"title":"Day 1","perItem":20,"items":[{"id":"a","name":"Welcome","start":None,"duration":300},{"id":"b","name":"Keynote","start":None,"duration":1200},{"id":"c","name":"Panel","start":None,"duration":1200},{"id":"d","name":"Close","start":None,"duration":600}]}
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
    dur=lambda: {it["id"]:it.get("duration") for it in json.loads(t.evaluate("localStorage.runsheet"))["items"]}
    ph=lambda rid: e.get_attribute(f"#rs-table tr[data-id={rid}] [data-field=end]","placeholder")
    msg=lambda: e.text_content(".ask .ask-text") if e.query_selector(".ask") else None
    def edit(rid, field, val):
        sel=f"#rs-table tr[data-id={rid}] [data-field={field}]"; e.fill(sel, val); e.press(sel, "Tab"); e.wait_for_timeout(500)
    e.check("#active"); e.wait_for_timeout(300)
    hh,mm=map(int,ph("b").split(":")); new=(hh*60+mm+10)%1440   # not started: times are provisional (as if it started now)
    edit("b","end","%d:%02d"%(new//60,new%60)); print("not started, b end +10 (provisional) ->", msg(), "| b dur:", dur()["b"]/60)
    e.click("#btn-next"); e.wait_for_timeout(1500)
    print("started, b ends:", ph("b"))
    hh,mm=map(int,ph("b").split(":")); new=(hh*60+mm+10)%1440
    edit("b","end","%d:%02d"%(new//60,new%60)); print("b end +10 ->", msg(), "| b dur:", dur()["b"]/60, "| c ends now:", ph("c"), "| invalid:", e.evaluate("document.querySelector('#rs-table tr[data-id=b] [data-field=end]').classList.contains('invalid')"))
    hh,mm=map(int,ph("c").split(":")); new=(hh*60+mm+5)%1440
    edit("c","end","%d%02d"%(new//60,new%60)); print("c end typed as HHMM", "%d%02d"%(new//60,new%60), "->", msg(), "| c dur:", dur()["c"]/60)
    edit("d","end","banana"); print("unreadable:", msg()); e.click(".ask button:has-text('OK')"); e.wait_for_timeout(200)
    st=e.get_attribute("#rs-table tr[data-id=d] [data-field=start]","placeholder"); hh,mm=map(int,st.split(":")); bad=(hh*60+mm-10)%1440
    edit("d","end","%d:%02d"%(bad//60,bad%60)); print("10 min before its start", st, "->", msg()); e.click(".ask button:has-text('OK')")
print("errors:", errs)
