import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
import sys, os, mimetypes, json, datetime
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; OUT=OUTDIR; BASE="https://timer.sophtwhere.com/beta/"
n=datetime.datetime.now(); base=n.hour*3600+n.minute*60
SHEET={"title":"Day 1","perItem":20,"items":[
 {"id":"a","name":"Welcome","start":base,"duration":None},
 {"id":"b","name":"Keynote","start":base+600,"duration":None},
 {"id":"c","name":"Panel","start":base+1800,"duration":None},
 {"id":"d","name":"Lunch","start":base+3000,"duration":None},
 {"id":"z","name":"Close","start":base+4800,"duration":None}]}
def h(route, req):
    u=req.url
    if u.startswith(BASE):
        fp=os.path.join(ROOT,u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
def hm(sec): sec=int(sec)%86400; return "%d:%02d"%(sec//3600,(sec%3600)//60)
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-proxy-server"])
    c=b.new_context(ignore_https_errors=True, viewport={"width":1440,"height":900})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.runsheet=%s}" % json.dumps(json.dumps(SHEET)))
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html"); t.wait_for_timeout(1500)
    e=c.new_page(); e.on("pageerror", lambda x: errs.append("editor: "+str(x)))
    e.goto(BASE+"runsheet.html"); e.wait_for_timeout(1200)
    st=lambda: {it["id"]:it.get("start") for it in json.loads(t.evaluate("localStorage.runsheet"))["items"]}
    du=lambda rid: [it.get("duration") for it in json.loads(t.evaluate("localStorage.runsheet"))["items"] if it["id"]==rid][0]
    mv=lambda s0,s1: {k:(s1[k]-s0[k])/60 for k in s0 if s0[k] is not None}
    def edit(rid, field, val):
        sel=f"#rs-table tr[data-id={rid}] [data-field={field}]"; e.fill(sel, val); e.press(sel, "Tab"); e.wait_for_timeout(500)
    e.check("#active"); e.wait_for_timeout(300); e.click("#btn-next"); e.wait_for_timeout(1500)
    print("ends placeholders:", e.evaluate("[...document.querySelectorAll('[data-field=end]')].map(i=>i.placeholder)"))
    nowsec=lambda: datetime.datetime.now().hour*3600+datetime.datetime.now().minute*60
    # next start, No -> later items ripple
    s0=st(); edit("b","start",hm(s0["b"]+300)); e.click(".ask button:has-text('No, just')"); e.wait_for_timeout(800)
    print("next start +5, No -> moved:", mv(s0,st()), "| timer:", t.text_content("#remain_disp"))
    # next start, Yes -> countdown + ripple
    s0=st(); T=nowsec()+420; edit("b","start",hm(T)); e.click(".ask button:has-text('Yes')"); e.wait_for_timeout(1800)
    print("next start Yes ->", hm(st()["b"]), "| moved:", mv(s0,st()), "| timer:", t.text_content("#remain_disp"), "| a dur:", du("a"))
    # undo by editing next item's end: b end back -> c, d, z ripple
    s0=st(); bend=s0["c"]  # b currently ends at c start
    edit("b","end",hm(bend-600)); e.wait_for_timeout(800)
    print("b end -10 min -> b dur:", du("b")/60, "| moved:", mv(s0,st()))
    # duration of an upcoming item ripples
    s0=st(); edit("c","duration","30"); e.wait_for_timeout(800)
    print("c dur 30 (was 20) -> moved:", mv(s0,st()))
    # end of the live item
    s0=st(); T=nowsec()+600; edit("a","end",hm(T)); e.wait_for_timeout(1800)
    print("live end", hm(T), "-> timer:", t.text_content("#remain_disp"), "| moved:", mv(s0,st()))
    # end in the past
    edit("a","end",hm(nowsec()-120)); print("past end:", e.text_content(".ask .ask-text") if e.query_selector(".ask") else None); e.click(".ask button:has-text('OK')")
    # end before start
    edit("d","end",hm(st()["d"]-60)); print("end before start invalid:", e.evaluate("document.querySelector('#rs-table tr[data-id=d] [data-field=end]').classList.contains('invalid')"))
    e.screenshot(path=OUT+"/rsripple.png")
print("errors:", errs)
