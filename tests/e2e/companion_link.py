import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
import sys, os, mimetypes, json, subprocess
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; S=os.path.dirname(os.path.abspath(__file__)); BASE="https://timer.sophtwhere.com/beta/"
def h(route, req):
    u=req.url
    if u.startswith(BASE):
        fp=os.path.join(ROOT,u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-proxy-server","--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"])
    c=b.new_context(ignore_https_errors=True, viewport={"width":1280,"height":800})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';}")
    c.route("**/*",h); pg=c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console "+m.type+": "+m.text) if m.type=="error" else None)
    pg.goto(BASE+"timer.html?remote="+SERVER); pg.wait_for_timeout(1000)
    pg.click("#btnshare"); pg.wait_for_timeout(1500)
    pg.click("#phone-panel .pp-modes button[data-mode=companion]"); pg.wait_for_timeout(300)
    print("button before:", pg.text_content("#btnshare").strip(), "| panel title:", pg.text_content("#phone-panel .pp-head b"), "| old share panel present:", pg.locator("#share-panel").count())
    print("hint:", pg.inner_text("#phone-panel .pp-modehint"))
    link=pg.text_content("#phone-panel .pp-link"); print("link:", link)
    pg.locator("#phone-panel").screenshot(path=f"{OUTDIR}/panel_companion.png")
    r=subprocess.run(["node",f"{S}/comp_link.mjs",link],capture_output=True,text=True,timeout=40); print(r.stdout, r.stderr)
    print("timer display:", pg.text_content("#clock_main"), "| msg:", pg.text_content("#custom_message"), "| paused:", pg.evaluate("document.documentElement.classList.contains('paused')"))
    print("button with companion:", pg.text_content("#btnshare").strip())
    print("peers:", pg.text_content("#phone-panel .pp-peers"))
    # PIN flow
    if not pg.is_visible("#phone-panel"): pg.click("#btnshare"); pg.wait_for_timeout(500)
    pg.check("#phone-panel input.pp-pin-box"); pg.wait_for_timeout(300)
    proc=subprocess.Popen(["node",f"{S}/comp_link.mjs",link,"pin"],stdout=subprocess.PIPE,text=True)
    pin=None
    for line in proc.stdout:
        print("  node:", line.rstrip())
        if line.startswith('["pin"'): pin=json.loads(line)[1]; break
    pg.wait_for_timeout(800)
    print("pending:", pg.text_content("#phone-panel .pp-pending"))
    pg.screenshot(path=f"{OUTDIR}/panel_pin.png")
    pg.fill("#phone-panel .pp-pending input", pin); pg.press("#phone-panel .pp-pending input", "Enter")
    pg.wait_for_timeout(500)
    print("panel open after approval:", pg.is_visible("#phone-panel"))
    out,_=proc.communicate(timeout=30); print(out)
    print("errors:", errs)
