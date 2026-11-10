import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
from _proximity import approve   # the proximity check: type each new device's number on the timer
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
# server: the assist station (assist.html) pairs by code like an overlay, sees the timer and the run
# sheet item, asks to move start times (the share panel's Allow), and a transcript line clicked moves
# the timer's start there: the whole timer by default, or only the start; the run sheet log's actual
# start follows; the timer shows the move with Undo; the station's own Undo; the permission survives
# a reconnect until Stop moving starts. The transcript is written to IndexedDB in bursts (and on
# leaving the page), so a reload keeps every line. In run sheet mode the sheet decides (the next item's auto
# start: only the start; else the whole timer and the later starts), and the show's starts are
# marked in the transcript; the live one drags onto a line. The old video assist keys (V, Shift+W) are gone from the timer.
# There's no microphone here: lines go in through window.__assistHear(text, ms ago).
import os, mimetypes, json
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
ARGS=["--no-proxy-server","--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"]
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    c=b.new_context(ignore_https_errors=True, viewport={"width":1280,"height":800}); c.add_init_script("window.TimerFeatures = { assist: true }")   # the assist station: an alpha-only trial (features.js)
    c.add_init_script("""if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';
      localStorage.runsheet=JSON.stringify({title:'Demo',perItem:20,items:[{id:'a',name:'Welcome',start:null,duration:600},{id:'b',name:'Keynote',start:null,duration:1800}]});
      localStorage.runsheet_state=JSON.stringify({active:true,index:-1,history:[],log:[]})}""")
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html?remote="+SERVER); t.wait_for_timeout(1500)
    t.evaluate("document.getElementById('whats-new')?.remove()")
    t.keyboard.press("v"); t.keyboard.press("Shift+W"); t.wait_for_timeout(300)
    print("old video assist keys: video elements:", t.evaluate("!!document.getElementById('webcam') || !!document.getElementById('wc_canvas2')"), "| class:", t.evaluate("document.documentElement.classList.contains('video-track')"))
    t.click("#btnshare"); t.wait_for_timeout(1500)
    t.click("#phone-panel .pp-pair"); t.wait_for_timeout(800)
    code=t.text_content("#phone-panel .pp-digits").replace(" ","")

    a_ctx=b.new_context(ignore_https_errors=True, viewport={"width":1100,"height":900}); a_ctx.route("**/*",h); a_ctx.add_init_script("window.TimerFeatures = { assist: true }")   # the assist station: an alpha-only trial (features.js)
    a=a_ctx.new_page(); a.on("pageerror", lambda e: errs.append("assist: "+str(e)))
    a.goto(BASE+"assist.html?remote="+SERVER); a.wait_for_timeout(800)
    a.fill("#code", code); a.wait_for_timeout(3000)
    print("station paired:", a.is_visible("#paired"), "| number asked:", a.is_visible("#pinwait"))
    approve(t); a.wait_for_timeout(1500)
    print("after the check:", a.text_content("#status"), "|", a.text_content("#allowtext"), "| ask shown:", a.is_visible("#ask"))
    devs=lambda: t.evaluate("[...document.querySelectorAll('#phone-panel .pp-dev')].map(r=>r.textContent.replace(/\\s+/g,' ').trim())")

    snap=lambda: t.evaluate("processTimerApiMessage({cmd:'snapshot'})")
    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(2000)
    print("item started -> station:", a.text_content("#item"), "|", a.text_content("#remain"), "|", a.text_content("#started"))
    a.evaluate("window.__assistHear('Thank you, and now please welcome our first speaker', 1500)")
    a.evaluate("window.__assistHear('Good morning everyone, it is great to be here', 0)")
    a.wait_for_timeout(300)
    rows=lambda: a.evaluate("[...document.querySelectorAll('#log .ln, #log .divider')].map(r=>r.className+' | '+r.textContent.replace(/\\s+/g,' ').trim())")
    print("transcript:", rows())
    a.click("#log .ln[data-i='1']"); a.wait_for_timeout(200)
    print("click before allowed -> armed:", a.evaluate("!!document.querySelector('#log .ln.armed')"))

    a.click("#ask"); a.wait_for_timeout(1200)
    print("asked:", a.text_content("#allowtext"), "| timer request:", t.evaluate("[...document.querySelectorAll('#phone-panel .pp-pending .pp-ask')].map(r=>r.textContent.replace(/\\s+/g,' ').trim().slice(0,70))"))
    t.click("#phone-panel .pp-pending button[data-act=assist-ok]"); a.wait_for_timeout(1200)
    print("allowed:", a.text_content("#allowtext"), "| device row:", devs())

    s0=snap(); log0=t.evaluate("JSON.parse(localStorage.runsheet_state).log.slice(-1)[0].actual")
    a.click("#log .ln[data-i='1']"); a.wait_for_timeout(200)
    print("armed:", a.text_content("#log .ln.armed .ask").strip()[:80])
    a.click("#log .ln.armed button[data-act=move]"); a.wait_for_timeout(1500)
    s1=snap(); log1=t.evaluate("JSON.parse(localStorage.runsheet_state).log.slice(-1)[0]")
    moved=s1["startedAt"]-s0["startedAt"]
    print("whole move: start +%.1f s | end +%.1f s | log actual +%.1f s (orig kept: %s)" % (moved/1000, (s1["seekEndsAt"]-s0["seekEndsAt"])/1000, (log1["actual"]-log0)/1000, log1.get("orig")==log0))
    print("timer notice:", t.evaluate("(document.getElementById('assist-notice')||{}).textContent"), "| station:", a.text_content("#moved"), "| line now:", a.text_content("#log .ln[data-i='1'] .o"))
    t.screenshot(path=OUT+"/assist_timer_notice.png"); a.screenshot(path=OUT+"/assist_station.png")
    t.click("#assist-notice button"); t.wait_for_timeout(1500)
    print("timer Undo: start back:", snap()["startedAt"]==s0["startedAt"], "| end back:", snap()["seekEndsAt"]==s0["seekEndsAt"], "| log back:", t.evaluate("JSON.parse(localStorage.runsheet_state).log.slice(-1)[0].actual")==log0)


    # Run sheet mode: the sheet decides how a move moves the timer, and the show's starts are marked
    modes=lambda: a.evaluate("[...document.querySelectorAll('#mode button')].map(b=>b.dataset.m+(b.disabled?' off':'')+(b.classList.contains('on')?' *':'')).join(', ')")
    mks=lambda: a.evaluate("[...document.querySelectorAll('#log .mk')].map(m=>m.textContent+(m.classList.contains('drag')?' [drag]':''))")
    print("run sheet decides:", modes(), "|", a.text_content("#modewhy"))
    print("markers:", mks())
    t.evaluate("""(()=>{const s=JSON.parse(localStorage.runsheet);const d=new Date(timeProvider.now());s.items[1].start=(d.getHours()*3600+d.getMinutes()*60+d.getSeconds()+1200)%86400;
      localStorage.runsheet=JSON.stringify(s);window.runsheet.sheetChanged()})()""")
    a.evaluate("window.__assistHear('Ladies and gentlemen, please take your seats', 30000 + 2000)")
    t.wait_for_timeout(1200)
    kstart=lambda: t.evaluate("JSON.parse(localStorage.runsheet).items[1].start")
    s0=snap(); k0=kstart()
    print("line before the start sorts first:", a.text_content("#log .ln[data-i='0'] .x span")[:30], a.text_content("#log .ln[data-i='0'] .o"))
    a.drag_and_drop("#log .mk.drag", "#log .ln[data-i='0']"); a.wait_for_timeout(1500)
    s1=snap()
    print("dragged (whole): start %+.1f s | end %+.1f s | Keynote's start %+d s | markers:" % ((s1["startedAt"]-s0["startedAt"])/1000, (s1["seekEndsAt"]-s0["seekEndsAt"])/1000, kstart()-k0), mks())
    a.click("#moved button"); a.wait_for_timeout(1500)
    print("Undo: start back:", snap()["startedAt"]==s0["startedAt"], "| Keynote's start back:", kstart()==k0)
    t.evaluate("(()=>{const s=JSON.parse(localStorage.runsheet);s.items[1].auto=true;localStorage.runsheet=JSON.stringify(s);window.runsheet.sheetChanged()})()"); a.wait_for_timeout(1200)
    print("next item auto:", modes(), "|", a.text_content("#modewhy"))
    a.drag_and_drop("#log .mk.drag", "#log .ln[data-i='0']"); a.wait_for_timeout(1500)
    s2=snap()
    print("dragged (start only): start %+.1f s | end %+.1f s | Keynote's start %+d s | timer notice:" % ((s2["startedAt"]-s0["startedAt"])/1000, (s2["seekEndsAt"]-s0["seekEndsAt"])/1000, kstart()-k0), t.evaluate("document.getElementById('assist-notice').textContent"))
    a.click("#moved button"); a.wait_for_timeout(1500)
    print("Undo: start back:", snap()["startedAt"]==s0["startedAt"])

    # Outside run sheet mode the station's own switch decides, and the marker is the timer's start
    t.evaluate("window.runsheet.setActive(false)"); t.wait_for_timeout(300); t.keyboard.press("Space"); a.wait_for_timeout(1500)
    print("run sheet off:", modes(), "| why:", repr(a.text_content("#modewhy")), "| markers:", mks())
    a.click("#mode button[data-m=start]")
    s0=snap(); a.drag_and_drop("#log .mk.drag", "#log .ln[data-i='0']"); a.wait_for_timeout(1500)
    s2=snap(); print("start only: start %+.1f s | end %+.1f s" % ((s2["startedAt"]-s0["startedAt"])/1000, (s2["seekEndsAt"]-s0["seekEndsAt"])/1000))
    a.click("#moved button"); a.wait_for_timeout(1500)
    print("station Undo: start back:", snap()["startedAt"]==s0["startedAt"], "| end:", snap()["seekEndsAt"]==s0["seekEndsAt"])
    a.click("#mode button[data-m=whole]")
    t.evaluate("window.runsheet.setActive(true)"); t.wait_for_timeout(500)

    stored=lambda: a.evaluate("new Promise(r=>{const q=indexedDB.open('assist');q.onsuccess=()=>{const c=q.result.transaction('lines').objectStore('lines').count();c.onsuccess=()=>r(c.result)}})")
    print("in IndexedDB before the burst:", stored(), end=""); a.wait_for_timeout(5500); print(" | after:", stored())
    n=a.evaluate("document.querySelectorAll('#log .ln[data-i]').length"); a.evaluate("window.__assistHear('Heard sixteen minutes ago', 16*60000)")
    print("a line older than 15 min is dropped (a loop):", a.evaluate("document.querySelectorAll('#log .ln[data-i]').length")==n)
    a.evaluate("window.__assistHear('Said just before a reload', 0)")
    a.reload(); a.wait_for_timeout(3500)
    print("station reloaded:", a.text_content("#allowtext"), "| started:", a.text_content("#started"), "| transcript kept:", a.evaluate("document.querySelectorAll('#log .ln[data-i]').length"))
    if t.evaluate("document.getElementById('phone-panel').hidden"): t.click("#btnshare"); t.wait_for_timeout(500)
    t.click("#phone-panel .pp-peers button[data-dev=noassist]"); a.wait_for_timeout(1200)
    print("Stop moving starts ->", a.text_content("#allowtext"), "| ask shown:", a.is_visible("#ask"))
    t.evaluate("window.runsheet.next()"); t.wait_for_timeout(1500)
    a.evaluate("window.__assistHear('Our keynote today', 0)"); a.wait_for_timeout(300)
    print("next item -> station:", a.text_content("#item"), "| markers:", mks())
    a.click("#clear"); a.wait_for_timeout(200); print("Clear, one click:", a.text_content("#clear"), "| lines:", a.evaluate("document.querySelectorAll('#log .ln[data-i]').length"), end="")
    a.click("#clear"); a.wait_for_timeout(200); print(" | twice:", a.evaluate("document.querySelectorAll('#log .ln[data-i]').length"), "| stored:", stored())
    b.close()
print("errors:", errs)
