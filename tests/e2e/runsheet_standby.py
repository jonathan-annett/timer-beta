import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
from _proximity import approve   # the proximity check: type each new device's number on the timer
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')
# Run sheet standby (Reset show) and auto start. The first item starts 40 s from now (start times are
# seconds since midnight): Reset show → the timer stands by (paused at the first item's time, its name
# as the message, "Standing by."); Auto start (dashboard and editor) → "Standing by to start in 0:2x…" on
# the timer, the presenter window, a phone and the overlay; at the time the show starts by itself.
# Back goes to standby again; Resume in standby starts the show; run sheet mode off ends standby.
import os, mimetypes, json, time, datetime
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; OUT=OUTDIR; BASE="https://timer.sophtwhere.com/beta/"
now=datetime.datetime.now(); sec=now.hour*3600+now.minute*60+now.second
SHEET={"title":"Day 1","perItem":20,"items":[{"id":"a","name":"Welcome","start":sec+40,"duration":300},{"id":"b","name":"Keynote","start":None,"duration":1800},{"id":"z","name":"Close","start":None,"duration":None}]}
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
    c=b.new_context(ignore_https_errors=True, viewport={"width":1440,"height":900})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.runsheet=%s}" % json.dumps(json.dumps(SHEET)))
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html?remote="+SERVER); t.wait_for_timeout(1500)
    e=c.new_page(); e.on("pageerror", lambda x: errs.append("editor: "+str(x)))
    e.goto(BASE+"runsheet.html"); e.wait_for_timeout(1500)
    e.check("#active"); e.wait_for_timeout(500)
    st=lambda: t.evaluate("({cls: ['paused','standby','over'].filter(c=>document.documentElement.classList.contains(c)).join(','), remain: document.getElementById('remain_disp').textContent, info: document.getElementById('remain_info_message').textContent, infoShown: getComputedStyle(document.getElementById('remain_info_message')).display !== 'none', msg: document.getElementById('custom_message').textContent, index: JSON.parse(localStorage.runsheet_state).index})")
    e.once("dialog", lambda d: d.accept()); e.click("#btn-reset"); t.wait_for_timeout(1500)
    print("after Reset show:", st())
    lbl=lambda: t.evaluate("['started_disp','ends_disp','extra_time_disp'].map(id=>{const e=document.getElementById(id); return getComputedStyle(e,'::before').content.replace(/\"/g,'')+e.textContent+(getComputedStyle(e).display==='none'?' [hidden]':'')+(getComputedStyle(e).animationName!=='none'?' [blinking]':'')})")
    print("operator screen: big notice shown:", st()["infoShown"], "| dashboard:", t.is_visible("#rs_standby"), repr(t.text_content("#rs_standby")), "| times:", lbl())
    print("dashboard auto start:", t.is_visible("#rs_auto"), t.text_content("#rs_auto").strip(), "| editor:", e.is_visible("#autostart"), e.text_content("#autostart").strip())
    # presenter window and a phone
    pw=c.new_page(); pw.on("pageerror", lambda x: errs.append("presenter: "+str(x))); pw.goto(BASE+"timer.html?presenter"); pw.wait_for_timeout(1500)
    t.click("#btnshare"); t.wait_for_timeout(1500); link=t.text_content("#phone-panel .pp-link")
    pc=b.new_context(ignore_https_errors=True, viewport={"width":400,"height":800}); pc.route("**/*",h)
    ph=pc.new_page(); ph.on("pageerror", lambda x: errs.append("phone: "+str(x))); ph.goto(link); ph.wait_for_timeout(2000); approve(t); ph.wait_for_timeout(1500)
    pinfo=lambda: (pw.text_content("#remain_info_message"), pw.is_visible("#remain_info_message"))
    print("presenter:", pinfo(), "| phone:", ph.text_content("#remain"), "/", ph.text_content("#substate"))
    t.click("#rs_auto input"); t.wait_for_timeout(1200)
    t.screenshot(path=OUT+"/standby_timer.png")
    print("  with a start time: times:", lbl(), "| dashboard:", repr(t.text_content("#rs_standby")))
    print("auto start ticked on the dashboard:", st()["info"], "| editor box checked:", e.is_checked("#autostart input"), "| focus left it:", t.evaluate("document.activeElement.tagName"))
    print("  presenter:", pinfo(), "| phone:", ph.text_content("#substate"))
    pw.screenshot(path=OUT+"/standby_presenter.png")
    left = sec + 40 - (lambda n: n.hour*3600+n.minute*60+n.second)(datetime.datetime.now())
    t.wait_for_timeout(max(0, left - 4) * 1000); print("4 s before:", st()["info"], "| phone:", ph.text_content("#substate"))
    t.wait_for_timeout(6000); s=st()
    print("after the start time:", s, "| dashboard box:", t.is_visible("#rs_auto"), "| phone:", ph.text_content("#remain"), "/", repr(ph.text_content("#substate")), "| presenter:", pinfo())
    print("history:", t.evaluate("JSON.parse(localStorage.runsheet_state).history.length"), "| editor Back enabled:", e.is_enabled("#btn-back"))
    t.wait_for_timeout(400); e.click("#btn-back"); t.wait_for_timeout(1500)
    print("Back:", st(), "| status:", t.text_content("#rs_status"))
    print("  standing by after the start time: times:", lbl())
    t.keyboard.press("Shift+Quote"); t.wait_for_timeout(1500)     # Resume while standing by
    print('Resume (") in standby:', st())
    t.wait_for_timeout(400); e.click("#btn-back"); t.wait_for_timeout(1000)
    e.uncheck("#active"); t.wait_for_timeout(1000)
    print("run sheet mode off in standby:", st())
    e.check("#active"); t.wait_for_timeout(500); e.once("dialog", lambda d: d.accept()); e.click("#btn-reset"); t.wait_for_timeout(1200)
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 120000})"); t.wait_for_timeout(1200)
    print("a preset while standing by (not via the run sheet):", st(), "| run sheet standby:", json.loads(t.evaluate("localStorage.runsheet_state")).get("standby"))
    ls=lambda pg: pg.evaluate("({start:+localStorage.startedAt, ends:+localStorage.endsAt, seek:+localStorage.seekEndsAt, paused: localStorage.pausedAt||null, standby: localStorage.standby||null})")
    print("  stored before reload:", ls(t))
    t.reload(); t.wait_for_timeout(1500); print("reload:", st(), "| stored:", ls(t))
print("errors:", errs)
