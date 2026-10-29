import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
import os, mimetypes
from _proximity import approve   # the proximity check: type each new device's number on the timer
# server: the share panel's device list: names (suggested by the device, Rename), Revoke one device
# (two clicks: it's told, disconnected and has to pass the check again), and known devices not connected.
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
    rows=lambda: t.evaluate("[...document.querySelectorAll('#phone-panel .pp-peers .pp-dev')].map(r => r.innerText.replace(/\\s+/g,' ').trim())")
    phones=[]
    for i in range(2):
        pc=b.new_context(ignore_https_errors=True, viewport={"width":400,"height":800}); pc.route("**/*",h)
        ph=pc.new_page(); ph.on("pageerror", lambda e, i=i: errs.append(f"phone{i}: "+str(e)))
        ph.goto(link); ph.wait_for_timeout(1500)
        if i == 0: print("pending row:", t.text_content("#phone-panel .pp-pending")[:70])
        approve(t); phones.append((pc, ph))
    if not t.is_visible("#phone-panel"): t.click("#btnshare"); t.wait_for_timeout(500)
    print("rows:", rows())
    t.once("dialog", lambda d: d.accept("Sam's phone"))
    t.locator("#phone-panel .pp-dev").nth(0).locator("button[data-dev=rename]").click(); t.wait_for_timeout(300)
    print("renamed:", rows())
    rv=t.locator("#phone-panel .pp-dev").nth(1).locator("button[data-dev=revoke]")
    rv.click(); t.wait_for_timeout(200); print("first click:", rv.inner_text())
    rv.click(); t.wait_for_timeout(1500)
    ph2=phones[1][1]
    print("revoked phone:", ph2.text_content("#pinmsg"), "| rows:", rows(), "| approved:", t.evaluate("JSON.parse(localStorage.remote_approved).length"))
    ph1=phones[0][1]; ph1.reload(); ph1.wait_for_timeout(2500)
    print("phone 1 reloaded, asked again:", ph1.is_visible("#pinwait"), "| rows:", rows())
    phones[0][0].close(); t.wait_for_timeout(1500)
    if not t.is_visible("#phone-panel"): t.click("#btnshare"); t.wait_for_timeout(500)
    t.click("#phone-panel .pp-known summary"); t.wait_for_timeout(200)
    print("phone 1 gone, known:", rows())
    ph2.reload(); ph2.wait_for_timeout(2500)
    print("revoked phone reloaded, asked for a number:", ph2.is_visible("#pinwait"), ph2.text_content("#pincode"))
print("errors:", errs)
