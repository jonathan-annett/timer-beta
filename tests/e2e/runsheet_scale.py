import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Start edits ripple; scaling a selection (preview, cancel, apply, fit while late); provisional
# times before a sheet without start times begins.
import sys, os, mimetypes, json, datetime
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; OUT=OUTDIR; BASE="https://timer.sophtwhere.com/beta/"
n=datetime.datetime.now(); base=n.hour*3600+n.minute*60+120
SHEET={"title":"Day 1","perItem":20,"items":[
 {"id":"a","name":"Welcome","start":base,"duration":None},
 {"id":"b","name":"Keynote","start":base+600,"duration":None},
 {"id":"c","name":"Panel","start":base+2400,"duration":None},
 {"id":"d","name":"Talk","start":base+3600,"duration":None},
 {"id":"l","name":"Lunch","start":base+4800,"duration":None},
 {"id":"z","name":"Close","start":base+7200,"duration":None}]}
PLAIN={"title":"No times","perItem":20,"items":[
 {"id":"p","name":"One","start":None,"duration":600},
 {"id":"q","name":"Two","start":None,"duration":1200},
 {"id":"r","name":"Three","start":None,"duration":None}]}
def h(route, req):
    u=req.url
    if u.startswith(BASE):
        fp=os.path.join(ROOT,u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
def hm(sec): sec=int(sec)%86400; return "%d:%02d"%(sec//3600,(sec%3600)//60)
errs=[]
ARGS=["--no-proxy-server","--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"]
def pages(b, sheet):
    c=b.new_context(ignore_https_errors=True, viewport={"width":1440,"height":900})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.runsheet=%s}" % json.dumps(json.dumps(sheet)))
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html"); t.wait_for_timeout(1500)
    e=c.new_page(); e.on("pageerror", lambda x: errs.append("editor: "+str(x)))
    e.goto(BASE+"runsheet.html"); e.wait_for_timeout(1200)
    return t, e
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    t, e = pages(b, SHEET)
    items=lambda: {it["id"]:it for it in json.loads(t.evaluate("localStorage.runsheet"))["items"]}
    st=lambda: {k:v.get("start") for k,v in items().items()}
    du=lambda: {k:v.get("duration") for k,v in items().items()}
    mv=lambda s0,s1: {k:(s1[k]-s0[k])/60 for k in s0 if s0[k] is not None and s1[k] is not None and s1[k]!=s0[k]}
    cell=lambda rid, f: e.input_value(f"#rs-table tr[data-id={rid}] [data-field={f}]")
    ph=lambda rid, f: e.get_attribute(f"#rs-table tr[data-id={rid}] [data-field={f}]","placeholder")
    bar=lambda: e.evaluate("document.getElementById('scalebar').hidden ? null : document.getElementById('scale-info').textContent")
    def edit(rid, field, val):
        sel=f"#rs-table tr[data-id={rid}] [data-field={field}]"; e.fill(sel, val); e.press(sel, "Tab"); e.wait_for_timeout(500)
    def pick(rid, shift=False):
        e.click(f"#rs-table tr[data-id={rid}] td.num", modifiers=["Shift"] if shift else []); e.wait_for_timeout(200)
    def slide(v):
        e.evaluate("v => { const s = document.getElementById('scale-pct'); s.value = v; s.dispatchEvent(new Event('input', {bubbles: true})); }", v); e.wait_for_timeout(300)

    # 1. any start edit ripples (not just the next item's)
    s0=st(); edit("c","start",hm(s0["c"]+300))
    print("c start +5 (show not started) -> moved:", mv(s0,st()))
    s0=st(); edit("c","start",hm(s0["c"]-300))
    print("c start -5 -> moved:", mv(s0,st()))

    # 2. scaling before the show
    pick("b"); print("one picked:", bar())
    pick("d", True); print("shift-picked b..d:", e.evaluate("[...document.querySelectorAll('#rs-table tr.picked')].map(r=>r.dataset.id)"))
    print("at 100 %:", bar(), "| apply disabled:", e.is_disabled("#scale-apply"))
    s0, d0 = st(), du()
    slide(80)
    print("80 % preview:", bar())
    print("  shown durations b/c/d:", cell("b","duration") or ph("b","duration"), "|", cell("c","duration"), "|", cell("d","duration"),
          "| c start shown:", cell("c","start"), "| lunch start:", cell("l","start"))
    print("  saved sheet unchanged:", st()==s0 and du()==d0, "| inputs read-only:", e.evaluate("document.querySelector('#rs-table tr[data-id=l] [data-field=name]').readOnly"))
    e.screenshot(path=OUT+"/rsscale_preview.png")
    e.click("#scale-cancel"); e.wait_for_timeout(300)
    print("cancel -> bar:", bar(), "| unchanged:", st()==s0 and du()==d0, "| c duration cell:", cell("c","duration"))
    pick("b"); pick("c"); pick("d"); slide(80); e.click("#scale-apply"); e.wait_for_timeout(600)
    print("apply 80 % -> durations (min):", {k:(v/60 if v else v) for k,v in du().items()}, "| moved:", mv(s0,st()), "| bar:", bar())

    # 3. running late: fit the selection to the lunch break
    e.check("#active"); e.wait_for_timeout(300); e.click("#btn-next"); e.wait_for_timeout(1500)
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 25*60000})"); e.wait_for_timeout(2500)   # Welcome runs ~15 min over
    print("live:", e.text_content("#live"))
    pick("b"); pick("c", True)
    print("late, b+c picked:", bar(), "| fit:", e.evaluate("document.getElementById('scale-fit').hidden ? null : document.getElementById('scale-fit').textContent"))
    e.click("#scale-fit"); e.wait_for_timeout(300)
    print("fit ->", e.text_content("#scale-label"), "|", bar())
    e.screenshot(path=OUT+"/rsscale_fit.png")
    s0=st(); e.click("#scale-apply"); e.wait_for_timeout(600)
    print("applied -> durations (min):", {k:(round(v/60,2) if v else v) for k,v in du().items()}, "| moved:", mv(s0,st()))
    print("  lunch shown start:", cell("l","start") or ph("l","start"), "| status:", e.text_content("#rs-table tr[data-id=l] td.status"))
    # the live item and done items can't be picked
    pick("a"); print("live item pickable:", e.evaluate("document.querySelector('#rs-table tr[data-id=a]').classList.contains('picked')"))

    # 4. provisional times before a sheet without start times begins
    t2, e2 = pages(b, PLAIN)
    phs=lambda: e2.evaluate("[...document.querySelectorAll('#rs-table [data-field=start]')].map(i=>i.placeholder)")
    nowhm=datetime.datetime.now().strftime("%H:%M")
    print("provisional starts:", phs(), "(now", nowhm + ")", "| ends:", e2.evaluate("[...document.querySelectorAll('#rs-table [data-field=end]')].map(i=>i.placeholder)"))
    print("  note:", e2.text_content("#now-next"))
    e2.check("#active"); e2.wait_for_timeout(1500)
    print("  timer status:", e2.text_content("#live"))
    # an end typed before the start counts from the provisional start
    sel="#rs-table tr[data-id=q] [data-field=end]"; endph=e2.get_attribute(sel,"placeholder"); hh,mm=map(int,endph.split(":")); new=(hh*60+mm+10)%1440
    e2.fill(sel,"%d:%02d"%(new//60,new%60)); e2.press(sel,"Tab"); e2.wait_for_timeout(600)
    print("  q end +10 before start -> q dur:", json.loads(t2.evaluate("localStorage.runsheet"))["items"][1]["duration"]/60, "| dialog:", e2.query_selector(".ask") is not None)
    e2.click("#btn-next"); e2.wait_for_timeout(1500)
    print("  after Next, note gone:", "as if" not in e2.text_content("#now-next"), "| starts:", e2.evaluate("[...document.querySelectorAll('#rs-table [data-field=start]')].map(i=>i.value||i.placeholder)"))
print("errors:", errs)
