import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
from _proximity import approve   # the proximity check: type each new device's number on the timer
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
# server: "let a friend control this timer" by code. The timer runs on a phone (touch panel): the
# panel shows a 6-digit code by default; the friend's phone types it on control.html and lands on
# remote.html with the control (or countdown) link, then the proximity check. Also: the QR choice
# is remembered, the countdown mode gives a view-only link, wrong codes are refused.
import os, mimetypes
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
PHONE=dict(ignore_https_errors=True, viewport={"width":390,"height":800}, has_touch=True, is_mobile=True)
def friend(b, label):
    ctx=b.new_context(**PHONE); ctx.route("**/*",h)
    pg=ctx.new_page(); pg.on("pageerror", lambda e: errs.append(label+": "+str(e)))
    pg.goto(BASE+"control.html?remote="+SERVER); pg.wait_for_timeout(600)
    return pg
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    c=b.new_context(**PHONE)
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0'}")
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html?remote="+SERVER); t.wait_for_timeout(1500)
    t.evaluate("document.getElementById('touch-quickstart')?.remove()")
    t.evaluate("window.remoteControl.open()"); t.wait_for_timeout(1500)
    vis=lambda sel: t.evaluate(f"(e => !!e && getComputedStyle(e).display !== 'none' && !e.hidden)(document.querySelector('{sel}'))")
    code=(t.text_content("#phone-panel .pp-digits") or "").replace(" ","")
    print("touch panel: code", code, "| QR shown:", vis("#phone-panel .pp-qr"), "| modes shown:", vis("#phone-panel .pp-modes"),
          "| switch:", t.text_content("#phone-panel .pp-qrswitch"), "| status:", t.text_content("#phone-panel .pp-status"))
    print("hint:", t.text_content("#phone-panel .pp-codehint"))
    print("intro:", t.text_content("#phone-panel .pp-intro"))
    t.screenshot(path=OUT+"/control_code.png")

    f=friend(b, "friend")
    f.fill("#code", "000000" if code != "000000" else "111111"); f.wait_for_timeout(800)
    print("wrong code ->", f.text_content("#msg"))
    f.fill("#code", code); f.wait_for_timeout(3000)
    print("right code -> friend at:", f.url.split("/")[-1].split("#")[0], "| link has k:", "k=" in f.url, "| number asked:", f.is_visible("#pinwait"), f.text_content("#pincode"))
    print("timer note:", t.text_content("#phone-panel .pp-code"), "| pending rows:", t.evaluate("document.querySelectorAll('#phone-panel .pp-pending [data-id]').length"))
    approve(t)
    print("after the check -> panel hidden:", t.evaluate("document.getElementById('phone-panel').hidden"),
          "| peers:", t.evaluate("[...window.remoteControl.peers.values()].map(e=>e.role+':'+e.approved)"), "| number box:", f.is_visible("#pinwait"))
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 10*60000})"); t.wait_for_timeout(1500)
    print("timer", t.text_content("#remain_disp"), "-> friend", f.text_content("#remain"))
    f.screenshot(path=OUT+"/control_friend.png")

    # countdown display by code: a view-only link
    t.evaluate("window.remoteControl.open()"); t.wait_for_timeout(800)
    t.click("#phone-panel .pp-modes button[data-mode='countdown']"); t.wait_for_timeout(300)
    code2=(t.text_content("#phone-panel .pp-digits") or "").replace(" ","")
    print("reopened: fresh code:", code2 != code and len(code2) == 6, "| modehint:", t.text_content("#phone-panel .pp-modehint")[:40])
    f2=friend(b, "friend2"); f2.fill("#code", code2); f2.wait_for_timeout(3000)
    print("countdown code -> link has v:", "v=" in f2.url, "| has k:", "&k=" in f2.url or "#k=" in f2.url)
    approve(t)
    print("peers:", t.evaluate("[...window.remoteControl.peers.values()].map(e=>e.role+':'+e.approved)"))
    t.evaluate("localStorage.setItem('remote_link_mode','control')")

    # QR instead: remembered, and code mode back again
    t.evaluate("window.remoteControl.open()"); t.wait_for_timeout(800)
    t.click("#phone-panel .pp-qrswitch"); t.wait_for_timeout(500)
    print("QR mode: QR shown:", vis("#phone-panel .pp-qr"), "| code box shown:", vis("#phone-panel .pp-code"), "| switch:", t.text_content("#phone-panel .pp-qrswitch"), "| intro:", t.text_content("#phone-panel .pp-intro"))
    t.evaluate("window.remoteControl.toggle()"); t.evaluate("window.remoteControl.open()"); t.wait_for_timeout(800)
    print("reopened in QR mode: QR shown:", vis("#phone-panel .pp-qr"), "| code box:", vis("#phone-panel .pp-code"))
    t.click("#phone-panel .pp-qrswitch"); t.wait_for_timeout(1000)
    print("back to a code:", t.text_content("#phone-panel .pp-digits"), "| QR shown:", vis("#phone-panel .pp-qr"))
    t.evaluate("window.remoteControl.toggle()"); t.wait_for_timeout(300)
    print("closed -> pairing stopped: code shown:", vis("#phone-panel .pp-digits"))
print("errors:", errs)
