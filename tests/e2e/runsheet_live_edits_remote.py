import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
import sys, os, mimetypes, json, datetime
from _proximity import approve   # the proximity check: type each new device's number on the timer
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; OUT=OUTDIR; BASE="https://timer.sophtwhere.com/beta/"
n=datetime.datetime.now(); base=n.hour*3600+n.minute*60
SHEET={"title":"Day 1","perItem":20,"items":[{"id":"a","name":"Welcome","start":base,"duration":None},{"id":"b","name":"Keynote","start":base+300,"duration":None},{"id":"c","name":"Panel","start":base+900,"duration":None}]}
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
    b=p.chromium.launch(args=["--no-proxy-server","--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"])
    c=b.new_context(ignore_https_errors=True, viewport={"width":1440,"height":900})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.runsheet=%s}" % json.dumps(json.dumps(SHEET)))
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html?remote="+SERVER); t.wait_for_timeout(1500)
    t.evaluate("window.runsheet.setActive(true); window.runsheet.next()"); t.wait_for_timeout(800)
    t.click("#btnshare"); t.wait_for_timeout(1500); t.click("#phone-panel .pp-modes button[data-mode=control]"); t.wait_for_timeout(300)
    link=t.text_content("#phone-panel .pp-link"); t.click("#btnshare")
    m=b.new_context(ignore_https_errors=True, viewport={"width":1440,"height":900}); m.route("**/*",h)
    d=m.new_page(); d.on("pageerror", lambda x: errs.append("remote: "+str(x)))
    d.goto(link); approve(t); d.wait_for_timeout(3000); d.click("#viewbtn"); d.click("#viewlist button:has-text('Run sheet')"); d.wait_for_timeout(3500)
    F=lambda: d.frame(url=lambda u: 'runsheet.html' in u)
    sheet=lambda: {it["id"]:(it.get("start"),it.get("duration"),it["name"]) for it in json.loads(t.evaluate("localStorage.runsheet"))["items"]}
    snap=lambda: t.evaluate("processTimerApiMessage({cmd:'snapshot'})")
    def edit(rid, field, val):
        sel=f"#rs-table tr[data-id={rid}] [data-field={field}]"; F().fill(sel, val); F().press(sel, "Tab"); d.wait_for_timeout(500)
    edit("a","name","Welcome everyone"); print("remote rename dialog:", F().text_content(".ask .ask-text")[:60]); F().click(".ask button:has-text('Change it')"); d.wait_for_timeout(2500)
    print(" -> msg:", snap()["message"], "| sheet:", sheet()["a"][2])
    s0=sheet(); edit("a","duration","8"); d.wait_for_timeout(2500); s1=sheet()
    print("remote dur 8 -> timer:", t.text_content("#remain_disp"), "| a:", s1["a"][1], "| b moved:", (s1["b"][0]-s0["b"][0])/60)
    d.wait_for_timeout(1500); print(" editor shows:", F().input_value("#rs-table tr[data-id=a] [data-field=duration]"), F().input_value("#rs-table tr[data-id=b] [data-field=start]"))
    T=datetime.datetime.now().hour*3600+datetime.datetime.now().minute*60+300
    edit("b","start",hm(T)); F().click(".ask button:has-text('Yes')"); d.wait_for_timeout(2500)
    s2=sheet(); print("remote next start yes -> b:", hm(s2["b"][0]), "typed", hm(T), "| timer:", t.text_content("#remain_disp"), "| ends", t.text_content("#ends_disp") if t.query_selector('#ends_disp') else '')
    t.evaluate("window.runsheet.next()"); d.wait_for_timeout(2500)
    print("remote a locked:", F().evaluate("[...document.querySelectorAll('#rs-table tr[data-id=a] input')].every(i=>i.readOnly)"))
    F().click("#rs-table tr[data-id=a] button[data-act=del]"); d.wait_for_timeout(2500)
    print("remote del a -> hidden on timer:", json.loads(t.evaluate("localStorage.runsheet"))["items"][0].get("hidden"))
print("errors:", errs)
