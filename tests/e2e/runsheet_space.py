import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Space in run sheet mode: on the timer a typed Space is Next (held: once), but a typed time then
# Space starts that time, and Space made up by a button or the API (touch Restart, the deck's Start)
# still restarts; outside run sheet mode Space restarts as ever. In the run sheet editor Space is
# Next unless typing in a box (a focused button, e.g. Back, isn't pressed by it). delete (Backspace) is
# Back in both the same way, except while a time is typed (it removes a digit) or in a box; the editor's
# surface turns navy (html.typing) while a box has the keyboard.
import os, mimetypes, json
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
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-proxy-server"])
    c=b.new_context(ignore_https_errors=True, viewport={"width":1280,"height":800})
    c.add_init_script("""if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';
      localStorage.runsheet=JSON.stringify({title:'Demo',perItem:20,items:[{id:'a',name:'Welcome',start:null,duration:600},{id:'b',name:'Keynote',start:null,duration:1800},{id:'c',name:'Panel',start:null,duration:1200},{id:'d',name:'Close',start:null,duration:300}]});
      localStorage.runsheet_state=JSON.stringify({active:true,index:-1,history:[],log:[]})}""")
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html"); t.wait_for_timeout(1500)
    t.evaluate("document.getElementById('whats-new')?.remove()")
    idx=lambda pg=t: pg.evaluate("JSON.parse(localStorage.runsheet_state).index")
    rem=lambda: t.text_content("#remain_disp")
    t.keyboard.press(" "); t.wait_for_timeout(600); print("Space -> item", idx(), "| countdown", rem())
    t.keyboard.down(" "); t.wait_for_timeout(700); t.keyboard.up(" ")   # held: auto-repeat in a real browser; here one keydown
    t.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:' ', repeat:true, bubbles:true}))"); t.wait_for_timeout(400)
    print("Space again, then a repeat -> item", idx())
    t.keyboard.press("5"); t.keyboard.press(" "); t.wait_for_timeout(600); print("typed 5 then Space -> item", idx(), "| countdown", rem())
    t.evaluate("processTimerApiMessage({cmd:'keys', keys:[' ']})"); t.wait_for_timeout(600); print("the API's Space (deck Start) -> item", idx(), "| countdown", rem())
    t.keyboard.press("*"); t.wait_for_timeout(600); print("keypad * -> item", idx())
    i0 = idx(); t.keyboard.press("Backspace"); t.wait_for_timeout(600)
    check("delete (Backspace) is Back", idx() == i0 - 1, (i0, idx()))
    i0 = idx(); t.keyboard.press("5"); t.keyboard.press("7"); t.keyboard.press("Backspace"); t.wait_for_timeout(400)
    check("… but while a time is typed it removes a digit", idx() == i0 and t.evaluate("document.documentElement.classList.contains('editing')"), idx())
    t.keyboard.press("Escape"); t.wait_for_timeout(200)
    # the editor
    e=c.new_page(); e.on("pageerror", lambda x: errs.append("editor: "+str(x)))
    e.goto(BASE+"runsheet.html"); e.wait_for_timeout(1500)
    e.focus("#btn-back"); e.keyboard.press(" "); e.wait_for_timeout(800)
    print("editor: Back focused, Space -> item", idx(e), "(Next, not Back)")
    e.click("#title"); e.keyboard.type("A B"); e.wait_for_timeout(400)
    print("editor: typing in the title: item", idx(e), "| title", repr(e.input_value("#title")))
    i0 = idx(e); e.keyboard.press("Backspace"); e.wait_for_timeout(400)
    check("editor: delete in a text box deletes, not Back", idx(e) == i0 and e.input_value("#title").endswith(" "), (idx(e), e.input_value("#title")))
    check("editor: the surface is navy while typing", e.evaluate("document.documentElement.classList.contains('typing')") and e.evaluate("getComputedStyle(document.body).backgroundColor") != "rgb(11, 11, 11)")
    e.screenshot(path=OUTDIR + "/runsheet_typing.png")
    e.focus("#btn-next"); e.wait_for_timeout(300)
    check("editor: … and back to black when it isn't", not e.evaluate("document.documentElement.classList.contains('typing')"))
    e.keyboard.press("Backspace"); e.wait_for_timeout(800)
    check("editor: delete is Back", idx(e) == i0 - 1, (i0, idx(e)))
    # outside run sheet mode
    t.bring_to_front(); t.evaluate("window.runsheet.setActive(false)"); t.wait_for_timeout(400)
    t.keyboard.press(" "); t.wait_for_timeout(600); print("run sheet mode off: Space -> item", idx(), "| countdown", rem())
    b.close()
print("errors:", errs)
