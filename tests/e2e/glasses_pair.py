import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
from _proximity import approve   # the proximity check: type each new device's number on the timer
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
GLASSES = _os.path.normpath(_os.path.join(HERE, '..', '..', 'glasses', 'dist'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
# server: the Even G2 app's phone page (glasses/dist, built with `npm run build` there; skipped if
# missing) pairs with a desktop timer by code (Pair a computer), shows the proximity number on the
# phone page, then follows the countdown. Roles: approved as Presenter (the default; a tap hides
# the countdown), made Operator from the device list (the glasses move to the control link, show the
# operator's layout, three taps fire Next), made Presenter again (back to the view-only link). There's no Even app here, so what the glasses would show is
# read from window.__g2view() (main.ts glassesView).
import os, mimetypes, sys
from playwright.sync_api import sync_playwright
if not os.path.isfile(os.path.join(GLASSES, "index.html")):
    print("glasses/dist not built (cd glasses && npm install && npm run build): skipped"); print("errors: []"); sys.exit(0)
ROOT=PUBLIC; OUT=OUTDIR; BASE="https://timer.sophtwhere.com/beta/"; G2=BASE+"g2/"
def h(route, req):
    u=req.url
    root, path = (GLASSES, u[len(G2):]) if u.startswith(G2) else (ROOT, u[len(BASE):]) if u.startswith(BASE) else (None, None)
    if root:
        fp=os.path.join(root, path.split("?")[0].split("#")[0] or "index.html")
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs=[]
ARGS=["--no-proxy-server","--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"]
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    c=b.new_context(ignore_https_errors=True, viewport={"width":1280,"height":800})
    c.add_init_script("""if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';
      localStorage.runsheet=JSON.stringify({title:'Demo',perItem:20,items:[{id:'a',name:'Welcome',start:null,duration:600},{id:'b',name:'Keynote',start:null,duration:1800},{id:'c',name:'Panel',start:null,duration:1200}]});
      localStorage.runsheet_state=JSON.stringify({active:true,index:-1,history:[],log:[]})}""")
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html?remote="+SERVER); t.wait_for_timeout(1500)
    t.evaluate("document.getElementById('whats-new')?.remove()")
    t.click("#btnshare"); t.wait_for_timeout(1500)
    t.click("#phone-panel .pp-pair"); t.wait_for_timeout(800)
    code=t.text_content("#phone-panel .pp-digits").replace(" ","")
    print("timer code:", code)

    gc=b.new_context(ignore_https_errors=True, viewport={"width":390,"height":800}, has_touch=True, is_mobile=True)
    gc.add_init_script("window.TS_SERVER=%r; window.TS_SITE='timer.sophtwhere.com'" % SERVER); gc.route("**/*",h)
    g=gc.new_page(); g.on("pageerror", lambda e: errs.append("g2: "+str(e)))
    g.goto(G2+"index.html"); g.wait_for_timeout(4500)   # no Even bridge here: the page waits 4 s for it
    print("phone page: pair shown:", g.is_visible("#pair"), "| origin:", g.text_content("#origin"))
    g.fill("#code", "000000" if code != "000000" else "111111"); g.wait_for_timeout(1200)
    print("wrong code ->", g.text_content("#msg"))
    g.check("input[name=wants][value=operator]")     # asks to be the operator's: the timer still decides
    g.fill("#code", code); g.wait_for_timeout(2500)
    print("right code -> paired shown:", g.is_visible("#paired"), "| number:", g.text_content("#pinnum"), "| status:", g.text_content("#status"))
    print("timer pending:", t.evaluate("[...document.querySelectorAll('#phone-panel .pp-pending [data-id]')].map(r=>r.textContent.replace(/\\s+/g,' ').trim())"))
    print("role choice checked:", t.evaluate("document.querySelector('#phone-panel .pp-g2 input:checked')?.value"))
    t.screenshot(path=OUT+"/g2_timer_ask.png")
    g.screenshot(path=OUT+"/g2_pin.png")
    approve(t)
    g.wait_for_timeout(1000)
    print("after the check: number box:", g.is_visible("#pinbox"), "| status:", g.text_content("#status"), "| token kept:", bool(g.evaluate("localStorage.ts_token")))
    devs=lambda: t.evaluate("[...window.remoteControl.peers.values()].map(e=>e.role+':'+e.approved+':'+(e.name||e.suggest||'')+':'+(e.g2||''))")
    print("timer devices:", devs(), "| glasses role:", g.text_content("#rolename"))
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 10*60000})"); t.wait_for_timeout(2500)
    print("timer", t.text_content("#remain_disp"), "-> glasses", g.evaluate("window.__g2view && window.__g2view()"))
    t.evaluate("processTimerApiMessage({cmd:'pause'})"); t.wait_for_timeout(1500)
    print("paused -> glasses", g.evaluate("window.__g2view()"))
    g.screenshot(path=OUT+"/g2_phone_presenter.png")
    t.evaluate("processTimerApiMessage({cmd:'pause'})"); t.wait_for_timeout(800)
    g.evaluate("window.__g2tap(1)"); g.wait_for_timeout(900)
    print("presenter tap -> glasses", g.evaluate("window.__g2view()"), "| status:", g.text_content("#status"))
    g.wait_for_timeout(1500); print("  after the note:", g.evaluate("window.__g2view()"))
    g.evaluate("window.__g2tap(1); window.__g2tap(2)"); g.wait_for_timeout(900); print("  three taps (presenter): shown again:", g.evaluate("window.__g2view()"), "| run sheet item:", t.evaluate("JSON.parse(localStorage.runsheet_state).index"))
    # the operator makes them the operator's
    t.click("#btnshare"); t.wait_for_timeout(500)
    print("device row:", t.evaluate("[...document.querySelectorAll('#phone-panel .pp-dev')].map(r=>r.textContent.replace(/\\s+/g,' ').trim())"))
    t.click("#phone-panel button[data-dev=g2role]"); t.wait_for_timeout(3000)
    print("made operator -> timer:", devs(), "| glasses role:", g.text_content("#rolename"), "| control link kept:", bool(g.evaluate("localStorage.ts_ctl")))
    t.evaluate("processTimerApiMessage({cmd:'custommessage', text:'Please wrap up'})"); t.wait_for_timeout(1200)
    print("operator layout:", g.evaluate("window.__g2view()"))
    g.screenshot(path=OUT+"/g2_phone_operator.png")
    t.screenshot(path=OUT+"/g2_timer_operator.png")
    g.evaluate("window.__g2tap(2)"); g.wait_for_timeout(900); print("two taps: run sheet item", t.evaluate("JSON.parse(localStorage.runsheet_state).index"))
    g.evaluate("window.__g2tap(1); window.__g2tap(1); window.__g2tap(1)"); g.wait_for_timeout(1200)
    print("three taps: run sheet item", t.evaluate("JSON.parse(localStorage.runsheet_state).index"), "| now:", t.text_content("#rs_cur .rs-name"), "| glasses:", g.evaluate("window.__g2view()").get("msg"))
    t.click("#btnshare") if t.evaluate("document.getElementById('phone-panel').hidden") else None; t.wait_for_timeout(300)
    t.click("#phone-panel button[data-dev=g2role]"); t.wait_for_timeout(3000)
    print("made presenter again -> timer:", devs(), "| glasses role:", g.text_content("#rolename"), "| control link kept:", bool(g.evaluate("localStorage.ts_ctl")), "| glasses:", g.evaluate("window.__g2view()"))
    g.click("#corners button[data-c=br]"); print("corner kept:", g.evaluate("localStorage.ts_corner"))
    g.reload(); g.wait_for_timeout(6500)
    print("after reload: paired:", g.is_visible("#paired"), "| status:", g.text_content("#status"), "| glasses", g.evaluate("window.__g2view()"))
    t.close(); g.wait_for_timeout(2500)
    print("timer closed -> glasses", g.evaluate("window.__g2view()"), "| status:", g.text_content("#status"))
    g.click("#unpair"); g.click("#unpair"); g.wait_for_timeout(300)
    print("unpaired: pair shown:", g.is_visible("#pair"), "| glasses", g.evaluate("window.__g2view()"))
    # QR codes (the camera's reading handed straight in): the control code is refused, the countdown one pairs
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer2: "+str(e)))
    t.goto(BASE+"timer.html?remote="+SERVER); t.wait_for_timeout(2500)
    t.evaluate("document.getElementById('whats-new')?.remove()")
    t.click("#btnshare"); t.wait_for_timeout(1500)
    links={}
    for mode in ("control","countdown"):
        t.click(f"#phone-panel .pp-modes button[data-mode={mode}]"); t.wait_for_timeout(300)
        links[mode]=t.text_content("#phone-panel .pp-link")
    print("QR links:", {k:(v or '')[:60] for k,v in links.items()})
    # a photo of the code (as the Even app's camera returns it): the timer's QR, small in a bigger grey picture
    t.click("#phone-panel .pp-modes button[data-mode=countdown]"); t.wait_for_timeout(300)
    photo=t.evaluate("""(() => { const q = document.querySelector('#phone-panel .pp-qr canvas'); const c = document.createElement('canvas');
      c.width = 1600; c.height = 1200; const x = c.getContext('2d'); x.fillStyle = '#777'; x.fillRect(0, 0, 1600, 1200);
      x.fillStyle = '#fff'; x.fillRect(560, 360, 480, 480); x.drawImage(q, 600, 400, 400, 400); return c.toDataURL('image/jpeg', 0.85).split(',')[1] })()""")
    print("photo -> code:", (g.evaluate("window.__g2photo(%r)" % photo) or "(none)")[:70])
    g.evaluate("window.__g2scanned(%r)" % links["control"]); g.wait_for_timeout(300); print("control QR ->", g.text_content("#msg"))
    g.evaluate("window.__g2scanned('https://example.com/remote.html#r=X&v=Y')"); g.wait_for_timeout(300); print("other site ->", g.text_content("#msg"))
    g.evaluate("window.__g2scanned(%r)" % links["countdown"]); g.wait_for_timeout(2500)
    print("countdown QR -> paired:", g.is_visible("#paired"), "| number:", g.text_content("#pinnum"))
    approve(t); g.wait_for_timeout(1500)
    print("after the check:", g.text_content("#status"), "| timer:", t.evaluate("[...window.remoteControl.peers.values()].map(e=>e.role+':'+e.approved+':'+(e.g2||''))"))
    g.screenshot(path=OUT+"/g2_unpaired.png")
    b.close()
print("errors:", errs)
