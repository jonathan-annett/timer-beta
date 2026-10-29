import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
# server: a phone that came up "via server" (WebRTC unavailable at first) taps its badge and the
# timer tries a direct link again (relink → RemotePeer.restart()); the overlay's status does the same.
import os, mimetypes
from _proximity import approve   # the proximity check: type each new device's number on the timer
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
NO_RTC="window.__RTC = window.RTCPeerConnection; window.RTCPeerConnection = undefined;"
ARGS=["--no-proxy-server","--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"]
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    c=b.new_context(ignore_https_errors=True); c.route("**/*",h)
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0'}")
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html?remote="+SERVER); t.wait_for_timeout(1500)
    t.click("#btnshare"); t.wait_for_timeout(1500)
    link=t.text_content("#phone-panel .pp-link")
    peers=lambda: t.evaluate("[...window.remoteControl.peers.values()].map(e=>e.role+':'+e.peer.mode)")
    pc=b.new_context(ignore_https_errors=True, viewport={"width":400,"height":800}); pc.route("**/*",h); pc.add_init_script(NO_RTC)
    ph=pc.new_page(); ph.on("pageerror", lambda e: errs.append("phone: "+str(e)))
    ph.goto(link); approve(t); ph.wait_for_timeout(9000)                      # the timer gives up on a direct link after 7 s
    badge=lambda: ph.evaluate("document.getElementById('link-badge').querySelector('.long').textContent")
    print("phone without WebRTC:", badge(), "| timer sees:", peers())
    ph.click("#link-badge"); ph.wait_for_timeout(300)
    print("tapped (still no WebRTC):", badge()); ph.wait_for_timeout(8500)
    print("8 s later:", badge(), "| timer sees:", peers())
    ph.evaluate("() => { window.RTCPeerConnection = window.__RTC; }"); ph.wait_for_timeout(5500)  # (and the 5 s spacing)
    ph.click("#link-badge"); ph.wait_for_timeout(4000)
    print("WebRTC back, tapped:", badge(), "| timer sees:", peers())
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 3*60000})"); t.wait_for_timeout(1500)
    print("phone shows:", ph.evaluate("document.body.innerText.match(/\\d+:\\d\\d/)?.[0]"))
    # Unpair this device (☰ View menu, two taps): forgets the link and leaves the timer
    ph.click("#viewbtn"); ph.wait_for_timeout(300)
    btn=ph.locator("#viewlist button", has_text="npair")
    btn.click(); print("first tap:", btn.inner_text().split("\n")[0]); btn.click(); ph.wait_for_timeout(1500)
    print("unpaired:", ph.text_content("#blocked"), "| saved link:", ph.evaluate("localStorage.remote_saved_link || null"), "| hash:", repr(ph.evaluate("location.hash")),
          "| timer peers:", peers())
    ph.reload(); ph.wait_for_timeout(1500); print("after reload:", ph.text_content("#blocked"))
print("errors:", errs)
