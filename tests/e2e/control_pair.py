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
    t.evaluate("document.getElementById('quick-start-overlay')?.remove()")
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
    foc=lambda: t.evaluate("(a => a && a.closest('#phone-panel .pp-pending') ? 'pin box: ' + JSON.stringify(a.value) : a ? a.tagName : null)(document.activeElement)")
    print("focus on touch with a request waiting:", foc())
    t.keyboard.type(f.text_content("#pincode")[:1]); t.evaluate("window.remoteControl.refresh()"); t.evaluate("window.remoteControl.refresh()")
    print("typed one digit, panel refreshed twice:", foc())
    approve(t)
    print("after the check -> panel hidden:", t.evaluate("document.getElementById('phone-panel').hidden"),
          "| peers:", t.evaluate("[...window.remoteControl.peers.values()].map(e=>e.role+':'+e.approved)"), "| number box:", f.is_visible("#pinwait"))
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 10*60000})"); t.wait_for_timeout(1500)
    print("timer", t.text_content("#remain_disp"), "-> friend", f.text_content("#remain"))
    f.screenshot(path=OUT+"/control_friend.png")
    # the timer's keyboard shortcuts typed on the friend's remote
    tcls=lambda: t.evaluate("document.documentElement.className.split(' ').filter(c=>/^(paused|controlling|shifting|overlay|editing|showbar)$/.test(c)).join(',')")
    f.keyboard.type("5"); f.keyboard.press("Enter"); f.keyboard.press("Space"); t.wait_for_timeout(1200)
    print("remote typed 5 Enter Space -> timer", t.text_content("#remain_disp"), "| default:", t.evaluate("localStorage.defaultDuration"), "| classes:", tcls())
    f.keyboard.press("Control+ArrowUp"); t.wait_for_timeout(600)
    print("remote Ctrl+Up -> timer seekEndsAt - now (min):", t.evaluate("Math.round((+localStorage.seekEndsAt - timeProvider.now())/60000)"), "| classes:", tcls())
    f.keyboard.press("Shift+Quote"); t.wait_for_timeout(800)
    print('remote " -> classes:', tcls())
    f.keyboard.press("Quote"); t.wait_for_timeout(800)
    print("remote ' -> classes:", tcls())
    f.keyboard.press("o"); f.keyboard.press("f"); f.keyboard.press("Control+s"); t.wait_for_timeout(800)
    print("remote o, f, Ctrl+S (not passed) -> classes:", tcls(), "| css editor:", t.evaluate("!!(window.stylesheet1_obj && stylesheet1_obj.editing)"))
    f.keyboard.press("b"); t.wait_for_timeout(500); print("remote b -> classes:", tcls()); f.keyboard.press("b"); t.wait_for_timeout(300)
    f.evaluate("localStorage.remote_view='countdown'"); f.reload(); f.wait_for_timeout(2500)
    print("remote in its countdown view:", f.evaluate("document.body.className"), end=" ")
    f.keyboard.press("Shift+Quote"); t.wait_for_timeout(800); print('| " -> timer classes:', tcls(), end=" ")
    f.keyboard.press("Quote"); t.wait_for_timeout(800); print("| ' ->", repr(tcls()))
    f.evaluate("localStorage.remote_view='simple'")
    # a laptop with the same control link, countdown view: the display iframe passes keys up
    dctx=b.new_context(ignore_https_errors=True, viewport={"width":1200,"height":800}); dctx.route("**/*",h)
    dctx.add_init_script("localStorage.remote_view='countdown'")
    d=dctx.new_page(); d.on("pageerror", lambda e: errs.append("laptop: "+str(e)))
    d.goto(BASE+"remote.html#"+f.evaluate("localStorage.remote_saved_link")); d.wait_for_timeout(2500)
    approve(t); d.wait_for_timeout(1500)
    print("laptop countdown view:", d.evaluate("document.body.className"), end=" ")
    d.click("#cdframe"); d.keyboard.press("Shift+Quote"); t.wait_for_timeout(800); print('| " typed in the display -> timer classes:', tcls(), end=" ")
    d.keyboard.press("Quote"); t.wait_for_timeout(800); print("| ' ->", repr(tcls()))
    dctx.close(); t.wait_for_timeout(500)

    # countdown display by code: a view-only link
    t.evaluate("window.remoteControl.open()"); t.wait_for_timeout(800)
    t.click("#phone-panel .pp-modes button[data-mode='countdown']"); t.wait_for_timeout(300)
    code2=(t.text_content("#phone-panel .pp-digits") or "").replace(" ","")
    print("reopened: fresh code:", code2 != code and len(code2) == 6, "| modehint:", t.text_content("#phone-panel .pp-modehint")[:40])
    f2=friend(b, "friend2")
    print("code page: box focused at load:", f2.evaluate("document.activeElement.id"), end=" ")
    f2.evaluate("document.activeElement.blur()"); f2.mouse.click(30, 700)
    print("| after blur + a tap elsewhere:", f2.evaluate("document.activeElement.id"))
    f2.fill("#code", code2); f2.wait_for_timeout(3000)
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
    # take back control: the ⋯ item drops every friend at once
    room1=t.evaluate("JSON.parse(localStorage.remote_pairing).room")
    t.click("#touch-more-btn"); t.wait_for_timeout(400)
    print("⋯ item with friends in:", t.text_content("#touch-remote-btn"))
    t.click("#touch-remote-btn"); t.wait_for_timeout(1500)
    print("after one tap:", t.text_content("#touch-remote-btn"), "| shared:", t.evaluate("window.remoteControl.shared"), "| approvals:", t.evaluate("localStorage.remote_approved"), "| new room:", t.evaluate("JSON.parse(localStorage.remote_pairing).room") != room1)
    print("friend (control) sees:", f.evaluate("(document.getElementById('pinmsg')||{}).textContent"), "| pin sheet:", f.is_visible("#pinwait"))
    print("friend2 (countdown) sees:", f2.evaluate("(document.getElementById('pinmsg')||{}).textContent"))
    f.wait_for_timeout(2000); print("friend still says after 2 s:", f.evaluate("(document.getElementById('pinmsg')||{}).textContent"))
    f.wait_for_timeout(1500); print("friend after 3.5 s ->", f.url.split("/")[-1], "|", f.text_content("#msg"), "| code box focused:", f.evaluate("document.activeElement.id"), "| saved link:", f.evaluate("localStorage.remote_saved_link"))
    t.click("#touch-remote-btn"); t.wait_for_timeout(1500)
    print("tap again -> panel open:", not t.evaluate("document.getElementById('phone-panel').hidden"), "| code:", t.text_content("#phone-panel .pp-digits"), "| status:", t.text_content("#phone-panel .pp-status"))
    f.fill("#code", t.text_content("#phone-panel .pp-digits").replace(" ","")); f.wait_for_timeout(3000)
    print("friend types the new code -> at:", f.url.split("/")[-1].split("#")[0], "| number asked:", f.is_visible("#pinwait"))
    approve(t)
    print("let in again -> peers:", t.evaluate("[...window.remoteControl.peers.values()].filter(e=>!e.rejected).map(e=>e.role+':'+e.approved)"))
print("errors:", errs)
