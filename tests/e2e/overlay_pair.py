import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
from _proximity import approve   # the proximity check: type each new device's number on the timer
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
# server: pairing an overlay computer by the 6-digit code (protocol 6), then the overlay following
# the timer (countdown, message, progress shade, colours), reconnecting from the saved link, layouts,
# and the floating window where headless Chromium allows it.
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
    c=b.new_context(ignore_https_errors=True, viewport={"width":1280,"height":800})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0'}")
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html?remote="+SERVER); t.wait_for_timeout(1500)
    t.click("#btnshare"); t.wait_for_timeout(1500)
    print("pair button:", t.text_content("#phone-panel .pp-pair"), "| enabled:", t.is_enabled("#phone-panel .pp-pair"))
    t.click("#phone-panel .pp-pair"); t.wait_for_timeout(800)
    code=t.text_content("#phone-panel .pp-digits").replace(" ","")
    print("code shown:", code, "| status:", t.text_content("#phone-panel .pp-status"), "| QR hidden:", t.evaluate("getComputedStyle(document.querySelector('#phone-panel .pp-qr')).display"), "| hint:", t.text_content("#phone-panel .pp-codehint")[:90])
    t.screenshot(path=OUT+"/overlay_code.png")

    # the other computer: its own browser profile
    o_ctx=b.new_context(ignore_https_errors=True, viewport={"width":1100,"height":800}); o_ctx.route("**/*",h)
    o=o_ctx.new_page(); o.on("pageerror", lambda e: errs.append("overlay: "+str(e)))
    o.goto(BASE+"overlay.html?remote="+SERVER); o.wait_for_timeout(800)
    print("overlay first screen: enter shown:", o.is_visible("#enter"))
    o.fill("#code", "000000" if code != "000000" else "111111"); o.wait_for_timeout(800)
    print("wrong code ->", o.text_content("#codemsg"))
    o.fill("#code", code); o.wait_for_timeout(3000)
    print("right code -> paired shown:", o.is_visible("#paired"), "| status:", o.text_content("#status"), "| number asked:", o.is_visible("#pinwait"), o.text_content("#pincode"),
          o.evaluate("getComputedStyle(document.querySelector('#pincode')).fontSize"))
    approve(t)                                        # the proximity check: someone types it on the timer
    print("after the check -> number box:", o.is_visible("#pinwait"), "| status:", o.text_content("#status"))
    print("timer panel after pairing:", t.evaluate("document.getElementById('phone-panel').hidden"), "| note:", t.evaluate("(document.querySelector('#phone-panel .pp-code')||{}).textContent"),
          "| peers:", t.evaluate("[...window.remoteControl.peers.values()].map(e=>e.role+':'+e.peer.mode)"))
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 10*60000})"); t.wait_for_timeout(1500)
    ovt=lambda: o.evaluate("({remain: document.querySelector('#ov .ov-remain span').textContent, msg: document.querySelector('#ov .ov-msg span').textContent, cls: document.getElementById('ov').className, shade: document.querySelector('#ov .ov-shade').style.width, font: document.querySelector('#ov .ov-remain span').style.fontSize})")
    print("timer", t.text_content("#remain_disp"), "-> overlay", ovt())
    t.keyboard.press("b"); t.keyboard.press("m"); t.wait_for_timeout(1500)      # the timer's bar and messages switches
    print("after B and M on the timer:", ovt()["cls"], "| timer:", t.evaluate("document.documentElement.className.split(' ').filter(c=>/^show(bar|messages)$/.test(c))"))
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 50000})"); t.wait_for_timeout(1500)
    print("under a minute, no message ->", repr(ovt()["msg"]))
    t.evaluate("processTimerApiMessage({cmd:'custommessage', text:'Please wrap up now'})"); t.evaluate("processTimerApiMessage({cmd:'start', msecs: 50000})"); t.wait_for_timeout(1500)
    print("message + under a minute ->", ovt())
    o.screenshot(path=OUT+"/overlay_169.png")
    for l in ["1","916","stack"]:
        o.click(f"#layout button[data-l='{l}']"); o.wait_for_timeout(300); o.screenshot(path=OUT+f"/overlay_{l}.png"); print("layout", l, "->", ovt()["cls"], ovt()["font"], "| lines:", o.evaluate("[...document.querySelectorAll('#ov .ov-remain span')].map(s=>s.textContent+'@'+s.style.fontSize)"))
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 84*60000})"); t.wait_for_timeout(1500)   # over an hour, stacked
    print("stacked, 1 h 24 ->", o.evaluate("[...document.querySelectorAll('#ov .ov-remain span')].map(s=>s.textContent+'@'+s.style.fontSize)"))
    o.screenshot(path=OUT+"/overlay_stack_hour.png")
    o.click("#layout button[data-l='169']")
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 1500})"); t.wait_for_timeout(3500)
    print("over ->", ovt())
    t.evaluate("processTimerApiMessage({cmd:'custommessage', text:''})"); t.wait_for_timeout(1500)
    print("over, no message ->", repr(ovt()["msg"]))
    t.keyboard.press("m"); t.keyboard.press("b"); t.wait_for_timeout(1500)
    print("M and B off again ->", repr(ovt()["msg"]), ovt()["cls"])
    # reload: back from the saved link, no code
    o.reload(); o.wait_for_timeout(3000)
    print("after reload: paired:", o.is_visible("#paired"), "| enter:", o.is_visible("#enter"), "| status:", o.text_content("#status"), "| remain:", ovt()["remain"])
    # floating window (needs a click; headless may not support it)
    o.click("#start"); o.wait_for_timeout(1000)
    print("start overlay ->", o.evaluate("({docpip: 'documentPictureInPicture' in window, open: !!(window.documentPictureInPicture && documentPictureInPicture.window), inPip: !!(window.documentPictureInPicture && documentPictureInPicture.window && documentPictureInPicture.window.document.getElementById('ov'))})"),
          "| button:", o.text_content("#start"), "| status:", o.text_content("#status"))
    # the code is single use and goes away when the panel closes
    t.click("#btnshare"); t.wait_for_timeout(300)
    print("panel reopened: pairing on?", t.text_content("#phone-panel .pp-pair"), "| status:", t.text_content("#phone-panel .pp-status"))
print("errors:", errs)
