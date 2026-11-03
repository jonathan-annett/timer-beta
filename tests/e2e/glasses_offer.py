import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
GLASSES = _os.path.normpath(_os.path.join(HERE, '..', '..', 'glasses', 'dist'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
# server: the glasses' own code (pairing server protocol 7), for one person with only a phone: the
# glasses show a code (read here from window.__g2view(), what the glasses would show; never on the
# phone page), the timer's share panel takes it in its Glasses box, and the glasses get their link
# sealed for their key, with an approval token: no proximity number. The glasses' page is closed
# while the timer takes the code (the Even app in the background) and collects the link when it's
# back. A wrong code is refused on the timer; Operator chosen there makes them the operator's.
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
    c.add_init_script("""window.TimerFeatures = { pptx: false, glasses: true };
      if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01'}""")
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html?remote="+SERVER); t.wait_for_timeout(1500)
    t.evaluate("document.getElementById('whats-new')?.remove()")
    t.click("#btnshare"); t.wait_for_timeout(1500)
    print("timer: glasses box shown:", t.is_visible("#phone-panel .pp-gl"))

    gc=b.new_context(ignore_https_errors=True, viewport={"width":390,"height":800}, has_touch=True, is_mobile=True)
    gc.add_init_script("window.TS_SERVER=%r; window.TS_SITE='timer.sophtwhere.com'" % SERVER); gc.route("**/*",h)
    def glasses_page():
        g=gc.new_page(); g.on("pageerror", lambda e: errs.append("g2: "+str(e)))
        g.goto(G2+"index.html"); g.wait_for_timeout(4500)   # no Even bridge here: the page waits 4 s for it
        return g
    g=glasses_page()
    print("before: glasses", g.evaluate("window.__g2view()"))
    g.click("#offer")
    def hud_code():
        for _ in range(50):
            code="".join(ch for ch in g.evaluate("window.__g2view()").get("info","") if ch.isdigit())
            if len(code)==6: return code
            g.wait_for_timeout(100)
        return ''
    hud_code(); hud=g.evaluate("window.__g2view()").get("info","")
    code="".join(ch for ch in hud if ch.isdigit())
    page_text=g.text_content("#offerbox")
    print("glasses:", hud, "| code on the phone page:", code in page_text.replace(" ",""), "| phone page:", g.text_content("#offertext")[:60])
    g.screenshot(path=OUT+"/g2_offer_phone.png")

    # the Even app goes to the background (its page closed), the same code when it's back
    g.close(); g=glasses_page()
    print("reopened: same code:", hud_code() == code)
    g.close()

    # the timer: a wrong code, then the right one, as the operator's
    t.fill("#phone-panel .pp-glcode", "000000" if code != "000000" else "111111"); t.click("#phone-panel .pp-glgo"); t.wait_for_timeout(1200)
    print("timer, wrong code:", t.text_content("#phone-panel .pp-glnote"))
    t.check("#phone-panel input[name=pp-glrole][value=operator]")
    t.fill("#phone-panel .pp-glcode", code); t.press("#phone-panel .pp-glcode", "Enter"); t.wait_for_timeout(1500)
    print("timer, right code:", t.text_content("#phone-panel .pp-glnote"))
    print("approved entry:", t.evaluate("JSON.parse(localStorage.remote_approved).map(x=>x.name+':'+x.role+':'+x.g2)"))
    t.screenshot(path=OUT+"/g2_offer_timer.png")
    t.fill("#phone-panel .pp-glcode", code); t.click("#phone-panel .pp-glgo"); t.wait_for_timeout(1200)
    print("the same code again:", t.text_content("#phone-panel .pp-glnote"))

    # back in the Even app: the glasses collect the link and connect, no number to type
    g=glasses_page(); g.wait_for_timeout(3500)
    print("glasses back: paired:", g.is_visible("#paired"), "| number box:", g.is_visible("#pinbox"), "| status:", g.text_content("#status")[:60], "| role:", g.text_content("#rolename"))
    print("  kept:", {k: bool(g.evaluate("localStorage.%s" % k)) for k in ("ts_link","ts_token","ts_ctl","ts_offer")})
    print("timer devices:", t.evaluate("[...window.remoteControl.peers.values()].map(e=>e.role+':'+e.approved+':'+(e.name||'')+':'+(e.g2||''))"), "| pending:", t.evaluate("document.querySelectorAll('#phone-panel .pp-pending [data-id]').length"))
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 5*60000})"); t.wait_for_timeout(2000)
    print("timer", t.text_content("#remain_disp"), "-> glasses", g.evaluate("window.__g2view()"))
    g.screenshot(path=OUT+"/g2_offer_paired.png")

    # pairing while the glasses' page stays open (delivered at once), cancelled first
    g.click("#unpair"); g.click("#unpair"); g.wait_for_timeout(300)
    g.click("#offer"); g.wait_for_timeout(1200); g.click("#offercancel"); g.wait_for_timeout(300)
    print("cancelled: glasses", g.evaluate("window.__g2view()"), "| offer kept:", bool(g.evaluate("localStorage.ts_offer")))
    g.click("#offer"); code=hud_code()
    if t.evaluate("document.getElementById('phone-panel').hidden"): t.click("#btnshare"); t.wait_for_timeout(300)   # (it closed when the glasses connected)
    t.check("#phone-panel input[name=pp-glrole][value=presenter]")
    t.fill("#phone-panel .pp-glcode", code[:3]+" "+code[3:]); t.click("#phone-panel .pp-glgo"); t.wait_for_timeout(3000)
    print("open glasses: timer:", t.text_content("#phone-panel .pp-glnote"), "| glasses:", g.text_content("#status")[:50], "| role:", g.text_content("#rolename"), "| number box:", g.is_visible("#pinbox"))
    b.close()
print("errors:", errs)
