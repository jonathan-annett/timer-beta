import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
# Editing the run sheet from a phone: the run sheet display's ✎ Edit asks the timer, the share panel
# shows Allow / Refuse; allowed, the phone opens the editor (laid out for a phone) until Done; Stop
# editing in the panel takes it back to the display. Refused: the phone says so.
import os, mimetypes, json, datetime
from _proximity import approve, allow_edit
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; OUT=OUTDIR; BASE="https://timer.sophtwhere.com/beta/"
n=datetime.datetime.now(); base=n.hour*3600+n.minute*60+3600
SHEET={"title":"Day 1","perItem":20,"items":[{"id":"a","name":"Welcome","start":base,"duration":600},{"id":"b","name":"Keynote","start":None,"duration":1800},{"id":"c","name":"Panel","start":None,"duration":1200}]}
def h(route, req):
    u=req.url
    if u.startswith(BASE):
        fp=os.path.join(ROOT,u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-proxy-server","--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"])
    c=b.new_context(ignore_https_errors=True, viewport={"width":1440,"height":900})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.runsheet=%s}" % json.dumps(json.dumps(SHEET)))
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html?remote="+SERVER); t.wait_for_timeout(1500)
    t.evaluate("window.runsheet.setActive(true)"); t.wait_for_timeout(500)
    t.click("#btnshare"); t.wait_for_timeout(1500); t.click("#phone-panel .pp-modes button[data-mode=control]"); t.wait_for_timeout(300)
    link=t.text_content("#phone-panel .pp-link"); t.click("#btnshare")
    m=b.new_context(ignore_https_errors=True, viewport={"width":390,"height":844}, is_mobile=True, has_touch=True, device_scale_factor=2); m.route("**/*",h)
    d=m.new_page(); d.on("pageerror", lambda x: errs.append("phone: "+str(x)))
    d.goto(link); approve(t); d.wait_for_timeout(3000)
    d.tap("#viewbtn"); d.tap("#viewlist button:has-text('Run sheet')"); d.wait_for_timeout(1500)
    sheet=lambda: {it["id"]:(it.get("start"),it.get("duration"),it["name"],bool(it.get("auto"))) for it in json.loads(t.evaluate("localStorage.runsheet"))["items"]}
    F=lambda: d.frame(url=lambda u: 'runsheet.html' in u)
    print("display: edit button", d.is_visible("#rcedit"), d.text_content("#rcedit"), "| editor shown:", d.evaluate("document.body.classList.contains('rs-editor')"))
    # Refused first
    d.tap("#rcedit"); d.wait_for_timeout(800); print("asked:", d.text_content("#rcedit"))
    allow_edit(t, yes=False); d.wait_for_timeout(1000)
    print("refused:", d.text_content("#rcednote"), "| editor shown:", d.evaluate("document.body.classList.contains('rs-editor')"))
    # Asked again, allowed
    d.tap("#rcedit"); allow_edit(t); d.wait_for_timeout(3000)
    print("allowed: editor shown:", d.evaluate("document.body.classList.contains('rs-editor')"), "| tag:", F().text_content("#remote-tag"), "| panel:", t.text_content("#phone-panel .pp-peers")[:90])
    d.screenshot(path=OUT+"/phone_rs_editor.png")
    sel="#rs-table tr[data-id=c] [data-field=name]"; F().fill(sel, "Panel Q&A"); F().press(sel, "Enter"); d.wait_for_timeout(2000)
    sel="#rs-table tr[data-id=b] [data-field=duration]"; F().fill(sel, "40"); F().press(sel, "Enter"); d.wait_for_timeout(2000)
    F().tap("#rs-table tr[data-id=c] input.hard"); d.wait_for_timeout(2000)
    s=sheet(); print("phone edits -> timer: c", s["c"][2], "| b dur", s["b"][1]/60, "| c start", s["c"][0]-base if s["c"][0] is not None else None, "hard", s["c"][3])
    F().tap("#btn-done"); d.wait_for_timeout(800); print("Done: editor shown:", d.evaluate("document.body.classList.contains('rs-editor')"))
    d.tap("#rcedit"); d.wait_for_timeout(1500); print("Edit again (already allowed): editor shown:", d.evaluate("document.body.classList.contains('rs-editor')"))
    if t.evaluate("document.getElementById('phone-panel').hidden"): t.click("#btnshare"); t.wait_for_timeout(500)
    t.click("#phone-panel .pp-peers button[data-dev=noedit]"); d.wait_for_timeout(1500)
    print("Stop editing: editor shown:", d.evaluate("document.body.classList.contains('rs-editor')"), "| note:", d.text_content("#rcednote"))
    d.screenshot(path=OUT+"/phone_rs_stopped.png")
print("errors:", errs)
