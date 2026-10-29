import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Hard starts: the tick before a typed start time in the editor (item.auto). The first item's tick is
# the dashboard's "Auto start at" box (one setting). During the show a ticked item starts by itself at
# its time if it's next; if items before it haven't run, it doesn't jump: its row flashes red and the
# dashboard says why. Ripples stop at a ticked start. Every item has a tick: one without a typed start
# keeps the start it shows (typed, to the second) when ticked. (Real time: start times are seconds since midnight.)
import os, mimetypes, json, datetime, subprocess
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; OUT=OUTDIR; BASE="https://timer.sophtwhere.com/beta/"
def nowsec():
    n=datetime.datetime.now(); return n.hour*3600+n.minute*60+n.second
def h(route, req):
    u=req.url
    if u.startswith(BASE):
        fp=os.path.join(ROOT,u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
# ripples stop at a ticked start (runsheet-core, in node)
print("ripple:", subprocess.run(["node","-e","""
const C=require('%s/runsheet-core.js');
const sh={items:[{id:'a',start:36000,duration:600},{id:'b',start:36600,duration:600},{id:'c',start:37200,duration:600,auto:true},{id:'d',start:37800,duration:600}]};
C.shiftStarts(sh,0,300); console.log(sh.items.map(x=>x.id+'@'+C.formatClock(x.start)+(x.auto?'(hard)':'')).join(' '));""" % PUBLIC],capture_output=True,text=True).stdout.strip())
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-proxy-server"])
    s0=nowsec()
    SHEET1={"title":"Mirror","perItem":20,"items":[{"id":"a","name":"Welcome","start":s0+900,"duration":300},{"id":"b","name":"Talk","start":None,"duration":600}]}
    c=b.new_context(ignore_https_errors=True, viewport={"width":1440,"height":900})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.runsheet=%s}" % json.dumps(json.dumps(SHEET1)))
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e))); t.goto(BASE+"timer.html"); t.wait_for_timeout(1200)
    e=c.new_page(); e.on("pageerror", lambda x: errs.append("editor: "+str(x))); e.goto(BASE+"runsheet.html"); e.wait_for_timeout(1200)
    e.check("#active"); t.wait_for_timeout(800)
    tick=lambda i: e.evaluate(f"(c=>c?{{checked:c.checked, idle:c.classList.contains('idle'), hidden:c.hidden, disabled:c.disabled}}:null)(document.querySelectorAll('#rs-table tbody tr')[{i}].querySelector('input.hard'))")
    dash=lambda: t.evaluate("(l=>({shown:!l.hidden, checked:l.querySelector('input').checked}))(document.getElementById('rs_auto'))")
    print("before: first row tick", tick(0), "| 2nd row (no start) tick", tick(1), "| dashboard", dash())
    t.click("#rs_auto input"); e.wait_for_timeout(1200); print("dashboard ticked -> editor first row", tick(0), "| header box", e.is_checked("#autostart input"))
    e.locator("#rs-table tbody tr").nth(0).locator("input.hard").click(); t.wait_for_timeout(1200); print("editor row unticked -> dashboard", dash(), "| sheet auto:", json.loads(t.evaluate("localStorage.runsheet"))["items"][0].get("auto"))
    c.close()

    s0=nowsec()
    SHEET2={"title":"Day","perItem":20,"items":[
      {"id":"a","name":"Opening","start":s0-30,"duration":600},
      {"id":"b","name":"Session","start":None,"duration":600},
      {"id":"c","name":"Lunch","start":s0+25,"duration":600,"auto":True},
      {"id":"d","name":"Afternoon","start":s0+55,"duration":600,"auto":True},
      {"id":"z","name":"Close","start":None,"duration":None}]}
    c=b.new_context(ignore_https_errors=True, viewport={"width":1440,"height":900})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.runsheet=%s}" % json.dumps(json.dumps(SHEET2)))
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda x: errs.append("timer2: "+str(x))); t.goto(BASE+"timer.html"); t.wait_for_timeout(1200)
    e=c.new_page(); e.on("pageerror", lambda x: errs.append("editor2: "+str(x))); e.goto(BASE+"runsheet.html"); e.wait_for_timeout(1200)
    e.check("#active"); t.wait_for_timeout(500)
    rows=lambda: e.evaluate("[...document.querySelectorAll('#rs-table tbody tr')].map(tr=>tr.querySelector('[data-field=name]').value+(tr.querySelector('input.hard')&&!tr.querySelector('input.hard').hidden?(tr.querySelector('input.hard').checked?'[✓':'[ ')+(tr.querySelector('input.hard').classList.contains('idle')?' dim]':']'):'')+(tr.classList.contains('hardmiss')?' RED':'')+(tr.classList.contains('current')?' NOW':''))")
    idx=lambda: json.loads(t.evaluate("localStorage.runsheet_state"))["index"]
    print("before the show:", rows())
    e.click("#btn-next"); t.wait_for_timeout(1200)
    print("Opening running:", rows(), "| dashboard next:", t.text_content("#rs_next").strip())
    t.wait_for_timeout(max(0, s0+25-nowsec()+2)*1000)
    print("Lunch's time came, Session not run:", rows(), "| index", idx(), "| status:", t.text_content("#rs_status")[:90])
    e.screenshot(path=OUT+"/hardstart_miss.png")
    e.click("#btn-next"); t.wait_for_timeout(700); e.click("#btn-next"); t.wait_for_timeout(1200)
    print("Next, Next (Session, then Lunch by hand):", rows(), "| index", idx())
    print("  dashboard next:", t.text_content("#rs_next").strip())
    t.wait_for_timeout(max(0, s0+55-nowsec()+2)*1000)
    print("Afternoon's time (it's next):", rows(), "| index", idx(), "| timer", t.text_content("#remain_disp"), "| message", t.text_content("#custom_message"))
    c.close()

    # Ticking an item without a typed start: it keeps the start it shows, typed (a hard start)
    s0=nowsec()
    SHEET3={"title":"Pin","perItem":20,"items":[{"id":"a","name":"One","start":s0+3600,"duration":600},{"id":"b","name":"Two","start":None,"duration":600},{"id":"c","name":"Three","start":None,"duration":600}]}
    SHEET4={"title":"Loose","perItem":20,"items":[{"id":"a","name":"One","start":None,"duration":600},{"id":"b","name":"Two","start":None,"duration":600},{"id":"c","name":"Three","start":None,"duration":600}]}
    for name, sheet in (("anchored", SHEET3), ("no times", SHEET4)):
        c=b.new_context(ignore_https_errors=True, viewport={"width":1440,"height":900})
        c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.runsheet=%s}" % json.dumps(json.dumps(sheet)))
        c.route("**/*",h)
        t=c.new_page(); t.on("pageerror", lambda x: errs.append("timer3: "+str(x))); t.goto(BASE+"timer.html"); t.wait_for_timeout(1200)
        e=c.new_page(); e.on("pageerror", lambda x: errs.append("editor3: "+str(x))); e.goto(BASE+"runsheet.html"); e.wait_for_timeout(1200)
        e.check("#active"); t.wait_for_timeout(500)
        starts=lambda: [(x["id"], x["start"] if x.get("start") is None else (x["start"]-s0), bool(x.get("auto"))) for x in json.loads(t.evaluate("localStorage.runsheet"))["items"]]
        shown=lambda: e.evaluate("[...document.querySelectorAll('#rs-table tbody tr')].map(tr=>{const i=tr.querySelector('[data-field=start]');return (i.value||i.placeholder).slice(0,5)})")
        print(name, "before the show: row 3 tick", tick(2))
        if name == "no times": e.click("#btn-next"); t.wait_for_timeout(1200); print("  after Next: row 3 tick", tick(2))
        before=shown()
        e.locator("#rs-table tbody tr").nth(2).locator("input.hard").click(); t.wait_for_timeout(1000)
        print("  ticked row 3: sheet (start - now, auto)", starts(), "| times unchanged:", shown()==before, shown())
        if name == "anchored":
            e.locator("#rs-table tbody tr").nth(0).locator("[data-field=duration]").fill("20"); e.keyboard.press("Enter"); t.wait_for_timeout(800)
            e.on("dialog", lambda d: d.accept())
            print("  row 1 to 20 min (ripple stops at the tick):", shown())
        c.close()
print("errors:", errs)
