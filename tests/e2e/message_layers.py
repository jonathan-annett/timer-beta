import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Message layers and quiet mode: the run sheet item's name is the item layer, the operator's message
# (C, custommessage) sits on top of it and clearing it brings the name back; Back restores both; Q
# hides everything but the countdown on the presenter window (the operator's screen dims and badges)
# and the next item ends it; the bus says which kind of message is up.
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
errs=[]; fails=[]
def check(name, got, want):
    ok = got == want
    print(("ok  " if ok else "FAIL"), name, "->", repr(got), "" if ok else "(want %r)" % (want,))
    if not ok: fails.append(name)
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-proxy-server"])
    c=b.new_context(ignore_https_errors=True, viewport={"width":1280,"height":800})
    c.add_init_script("""if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';
      localStorage.runsheet=JSON.stringify({title:'Demo',perItem:20,items:[{id:'a',name:'Welcome',start:null,duration:600},{id:'b',name:'Keynote',start:null,duration:1800},{id:'c',name:'Close',start:null,duration:300}]});
      localStorage.runsheet_state=JSON.stringify({active:true,index:-1,history:[],log:[]})}""")
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html"); t.wait_for_timeout(1500)
    t.evaluate("document.getElementById('whats-new')?.remove()")
    # record the bus
    t.evaluate("""(()=>{const prev=window.timerAPI; window.bus={}; window.timerAPI={send(m){ if(prev&&prev.send) prev.send(m); if(m&&m.setVariableValues) Object.assign(window.bus,m.setVariableValues); }};
      processTimerApiMessage({cmd:'opened'});})()""")
    shown=lambda pg=t: pg.evaluate("document.documentElement.classList.contains('show_custom_message') ? document.getElementById('custom_message').textContent : ''")
    bus=lambda k: t.evaluate("window.bus[%r]" % k)
    api=lambda js: (t.evaluate("processTimerApiMessage(%s)" % js), t.wait_for_timeout(400))

    t.keyboard.press(" "); t.wait_for_timeout(700)
    check("Next shows the item's name", shown(), "Welcome")
    check("bus msg_kind", bus("msg_kind"), "item")
    api("{cmd:'custommessage', text:'Mention the sponsor'}")
    check("operator message on top", shown(), "Mention the sponsor")
    check("bus custommsg / operator_msg / item_msg", (bus("custommsg"), bus("operator_msg"), bus("item_msg"), bus("msg_kind")), ("Mention the sponsor", "Mention the sponsor", "Welcome", "operator"))
    t.keyboard.press("c"); t.wait_for_timeout(400)
    check("C clears it: the item's name is back", shown(), "Welcome")
    t.keyboard.press("c"); t.wait_for_timeout(200)
    check("C over an item name opens the editor", t.evaluate("document.documentElement.classList.contains('edit_custom_message')"), True)
    t.keyboard.type("Two minutes"); t.keyboard.press("Enter"); t.wait_for_timeout(400)
    check("typed message", shown(), "Two minutes")

    # presenter window
    pr=c.new_page(); pr.on("pageerror", lambda e: errs.append("presenter: "+str(e)))
    pr.goto(BASE+"timer.html?presenter"); pr.wait_for_timeout(1200)
    vis=lambda sel: pr.evaluate("getComputedStyle(document.querySelector(%r)).display !== 'none'" % sel)
    check("presenter shows the message", (shown(pr), vis("#custom_message")), ("Two minutes", True))
    t.bring_to_front(); t.keyboard.press("q"); t.wait_for_timeout(1200)
    check("Q: quiet on, bus", bus("quiet"), True)
    check("Q: operator screen badge", t.evaluate("getComputedStyle(document.getElementById('quiet_badge')).display"), "block")
    check("Q: presenter hides the message", vis("#custom_message"), False)
    check("Q: presenter still shows the countdown", vis("#remain_disp"), True)
    t.screenshot(path=os.path.join(OUTDIR,"quiet_operator.png")); pr.screenshot(path=os.path.join(OUTDIR,"quiet_presenter.png"))

    # Next: a new item drops the operator's message and quiet mode
    t.bring_to_front(); t.keyboard.press(" "); t.wait_for_timeout(1200)
    check("Next: item name, operator message gone", (shown(), bus("operator_msg")), ("Keynote", ""))
    check("Next: quiet ended", (bus("quiet"), vis("#custom_message")), (False, True))
    check("presenter follows", shown(pr), "Keynote")

    # Back restores both layers and quiet
    api("{cmd:'custommessage', text:'Hold on'}")
    api("{cmd:'runsheetprev'}"); t.wait_for_timeout(600)
    check("Back: item and operator message restored", (shown(), bus("item_msg"), bus("operator_msg")), ("Two minutes", "Welcome", "Two minutes"))
    check("Back: quiet restored", bus("quiet"), True)
    api("{cmd:'quiet', on:false}")
    check("quiet command off", bus("quiet"), False)

    # a renamed live item updates the item layer only
    api("{cmd:'custommessage', text:''}")
    t.evaluate("window.runsheet.liveName && window.runsheet.liveName('a','Hello all')"); t.wait_for_timeout(400)

    # reload keeps the layers
    api("{cmd:'custommessage', text:'After reload'}")
    t.reload(); t.wait_for_timeout(1500)
    t.evaluate("document.getElementById('whats-new')?.remove()")
    check("reload: operator message", shown(), "After reload")
    t.evaluate("processTimerApiMessage({cmd:'custommessage', text:''})"); t.wait_for_timeout(300)
    check("reload: item name underneath", shown() in ("Welcome", "Hello all"), True)
    b.close()
print("errors:", errs)
print("FAILED:" if fails else "all passed", fails if fails else "")
if errs or fails: raise SystemExit(1)
