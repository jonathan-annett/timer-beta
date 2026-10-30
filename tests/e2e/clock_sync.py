import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
from _proximity import approve   # the proximity check: type each new device's number on the timer
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
# Devices count the countdown themselves from the timer's anchor (timer.js announceClock, remote-clock.js)
# instead of getting a new text every second. A phone through the server (no WebRTC) and an overlay:
# their countdown must match the timer's through running, pause, resume, Ctrl+arrows, the easing
# catch-up (↑) and running over; and almost nothing should be sent while it just runs.
import os, mimetypes
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; BASE="https://timer.sophtwhere.com/beta/"
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
    c=b.new_context(ignore_https_errors=True); c.route("**/*",h)
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0'}")
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html?remote="+SERVER); t.wait_for_timeout(1500)
    t.click("#btnshare"); t.wait_for_timeout(1500)
    link=t.text_content("#phone-panel .pp-link")
    pc=b.new_context(ignore_https_errors=True, viewport={"width":400,"height":800}); pc.route("**/*",h)
    pc.add_init_script("window.RTCPeerConnection = undefined; window.__downs = 0; const W = window.WebSocket; window.WebSocket = function (...a) { const s = new W(...a); s.addEventListener('message', e => { if (String(e.data).includes('\"down\"')) window.__downs++; }); return s; }; window.WebSocket.OPEN = 1; window.WebSocket.prototype = W.prototype;")
    ph=pc.new_page(); ph.on("pageerror", lambda e: errs.append("phone: "+str(e)))
    ph.goto(link); ph.wait_for_timeout(2000); approve(t); ph.wait_for_timeout(1500)
    print("phone link:", t.evaluate("[...window.remoteControl.peers.values()].map(e=>e.role+':'+e.peer.mode+':clock='+e.clock)"))
    tr=lambda: t.text_content("#remain_disp").strip()
    pr=lambda: ph.text_content("#remain").strip().lstrip("+")
    def compare(label, secs):
        bad, n = 0, 0
        for _ in range(int(secs * 4)):
            a, b2 = tr(), pr(); n += 1
            if a != b2:
                # A second ticking over between the reads, or the timer's own text trailing (it updates at
                # most every 750 ms, so after a jump it can lag the true time by up to 250 ms): only a
                # difference that's still there on three reads 400 ms apart counts
                still = all((t.wait_for_timeout(400), tr() != pr())[1] for _ in range(3))
                if still: bad += 1; print("   mismatch:", label, "timer", tr(), "phone", pr())
            t.wait_for_timeout(250)
        print(f"{label}: {n} samples, {bad} lasting mismatches | timer {tr()} phone {pr()} | phone classes {ph.evaluate('document.body.className')}")
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 3*60000})"); t.wait_for_timeout(1500)
    d0=ph.evaluate("window.__downs"); compare("running", 6); d1=ph.evaluate("window.__downs")
    print("messages to the phone while just running (6 s):", d1 - d0)
    t.keyboard.press("Shift+Quote"); t.wait_for_timeout(800); compare("paused", 3)
    t.keyboard.press("Shift+Quote"); t.wait_for_timeout(800); compare("resumed", 3)
    t.keyboard.press("Control+ArrowUp"); t.keyboard.up("Control"); t.wait_for_timeout(800); compare("after Ctrl+Up (+1 min)", 3)
    for _ in range(8): t.keyboard.press("ArrowDown")
    t.wait_for_timeout(500); d0=ph.evaluate("window.__downs"); compare("easing after ↓×8 (catching up)", 6)
    print("messages while easing (6 s):", ph.evaluate("window.__downs") - d0, "| timer adjusting:", t.evaluate("document.documentElement.classList.contains('adjusting_time')"))
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 63000})"); t.wait_for_timeout(1000); compare("under a minute", 5)
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 2000})"); t.wait_for_timeout(3500); compare("over", 4)
    # the overlay page, as a view-only device
    oc=b.new_context(ignore_https_errors=True); oc.route("**/*",h)
    if not t.is_visible("#phone-panel"): t.click("#btnshare"); t.wait_for_timeout(500)
    t.click("#phone-panel .pp-modes button[data-mode='countdown']"); t.wait_for_timeout(300)
    vlink=t.text_content("#phone-panel .pp-link").replace("remote.html", "overlay.html").replace("m=countdown", "m=overlay")
    o=oc.new_page(); o.on("pageerror", lambda e: errs.append("overlay: "+str(e))); o.goto(vlink); o.wait_for_timeout(2000); approve(t); o.wait_for_timeout(1500)
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 5*60000})"); t.wait_for_timeout(2000)
    print("overlay:", o.evaluate("document.querySelector('#ov .ov-remain').textContent"), "| timer:", tr(), "| overlay peer clock:", t.evaluate("[...window.remoteControl.peers.values()].filter(e=>e.role==='view').map(e=>e.clock)"))
    # A device that connects while a countdown has been running a while: the last anchor is that old, so
    # it's worked forward to the moment it's sent (it was sent with its age, and devices cap that at 5 s)
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 10*60000})"); t.wait_for_timeout(12000)
    lc=b.new_context(ignore_https_errors=True, viewport={"width":400,"height":800}); lc.route("**/*",h)
    lc.add_init_script("window.RTCPeerConnection = undefined;")
    late=lc.new_page(); late.on("pageerror", lambda e: errs.append("late phone: "+str(e)))
    late.goto(link); late.wait_for_timeout(2000); approve(t); late.wait_for_timeout(2000)
    pr=lambda: late.text_content("#remain").strip().lstrip("+"); ph=late
    compare("phone joining 12 s into a countdown", 4)
print("errors:", errs)
