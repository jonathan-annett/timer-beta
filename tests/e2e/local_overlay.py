import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# The timer's own overlay (O, local-overlay.js on overlay-view.js): floats in a Document PiP window
# fed by the timer, a settings box that fades after 30 s, keeps updating with the page hidden.
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
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-proxy-server"])
    c=b.new_context(ignore_https_errors=True, viewport={"width":1280,"height":800}); c.route("**/*",h)
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0'}")
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html"); t.wait_for_timeout(1500)
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 5*60000})"); t.wait_for_timeout(1200)
    pipdoc=lambda: t.evaluate("""(() => { const w = window.documentPictureInPicture && documentPictureInPicture.window; const ov = w && w.document.getElementById('ov');
        return ov ? { remain: [...ov.querySelectorAll('.ov-remain span')].map(s => s.textContent).join(' '), cls: ov.className, msg: ov.querySelector('.ov-msg span').textContent } : null; })()""")
    print("supported:", t.evaluate("!!togglePIPMode"), "| no-overlay class:", t.evaluate("document.documentElement.classList.contains('nooverlay')"))
    t.keyboard.press("o"); t.wait_for_timeout(1500)
    print("after O: floating:", pipdoc(), "| html.overlay:", t.evaluate("document.documentElement.classList.contains('overlay')"), "| settings box shown:", t.is_visible("#lo-box"))
    print("timer shows:", t.text_content("#remain_disp"))
    warn=lambda: (t.is_visible(".kw-badge"), t.evaluate("(w => w ? w.document.getElementById('ov').classList.contains('warn') && (w.document.getElementById('ov').classList.contains('tip') ? 'tip: ' + w.document.querySelector('#ov .ov-tip span').textContent : 'badge only') : null)(documentPictureInPicture.window)"))
    print("keys warning (timer focused): timer badge, overlay:", warn(), "| badge tooltip:", t.get_attribute(".kw-badge", "title"))
    t.screenshot(path=OUTDIR+"/local_overlay_keys_page.png", clip={"x":290,"y":0,"width":700,"height":140})
    html=t.evaluate("documentPictureInPicture.window.document.documentElement.outerHTML")
    shot=c.new_page(); shot.set_viewport_size(t.evaluate("({width: documentPictureInPicture.window.innerWidth, height: documentPictureInPicture.window.innerHeight})")); shot.set_content(html); shot.wait_for_timeout(300); shot.screenshot(path=OUTDIR+"/local_overlay_keys_tip.png"); shot.close()
    t.wait_for_timeout(5500)
    print("5.5 s later: overlay:", warn()[1], "| page message faded:", t.evaluate("document.querySelector('.kw-badge .kw-tip').classList.contains('kw-gone')"))
    html=t.evaluate("documentPictureInPicture.window.document.documentElement.outerHTML")
    shot=c.new_page(); shot.set_viewport_size(t.evaluate("({width: documentPictureInPicture.window.innerWidth, height: documentPictureInPicture.window.innerHeight})")); shot.set_content(html); shot.wait_for_timeout(300); shot.screenshot(path=OUTDIR+"/local_overlay_keys_badge.png"); shot.close()
    t.evaluate("document.hasFocus = () => false; documentPictureInPicture.window.document.hasFocus = () => false"); t.wait_for_timeout(1300)
    print("nothing focused (PowerPoint has the keys):", warn())
    t.evaluate("delete document.hasFocus; documentPictureInPicture.window.document.hasFocus = () => true"); t.wait_for_timeout(1300)
    print("the overlay focused:", warn())
    t.evaluate("delete documentPictureInPicture.window.document.hasFocus")
    t.click("#lo-box .lo-seg button[data-l=stack]"); t.wait_for_timeout(500)
    print("9:16 stacked:", pipdoc(), "| window:", t.evaluate("[documentPictureInPicture.window.innerWidth, documentPictureInPicture.window.innerHeight]"),
          "| focus left the box:", t.evaluate("!document.getElementById('lo-box').contains(document.activeElement)"))
    t.evaluate("processTimerApiMessage({cmd:'custommessage', text:'Two minutes'})"); t.keyboard.press("b"); t.wait_for_timeout(1500)
    print("message + B:", pipdoc())
    # keys pressed in the floating window reach the timer: " pauses and resumes
    t.evaluate("documentPictureInPicture.window.focus()")
    before=t.evaluate("document.documentElement.classList.contains('paused')")
    t.evaluate("documentPictureInPicture.window.document.dispatchEvent(new KeyboardEvent('keydown', {key: String.fromCharCode(34), bubbles: true}))")
    t.wait_for_timeout(300)
    t.evaluate("documentPictureInPicture.window.document.dispatchEvent(new KeyboardEvent('keyup', {key: String.fromCharCode(34), bubbles: true}))")
    t.wait_for_timeout(500)
    print("key in the floating window: paused before", before, "after", t.evaluate("document.documentElement.classList.contains('paused')"))
    t.evaluate("documentPictureInPicture.window.document.dispatchEvent(new KeyboardEvent('keydown', {key: String.fromCharCode(34), bubbles: true}))"); t.wait_for_timeout(300)
    t.evaluate("documentPictureInPicture.window.document.dispatchEvent(new KeyboardEvent('keyup', {key: String.fromCharCode(34), bubbles: true}))"); t.wait_for_timeout(500)
    # the presenter window (opened by the timer) and the run sheet editor: the badge while the overlay is open; the presenter passes keys on
    with c.expect_page() as pw: t.evaluate("window.__pres = open('timer.html?presenter', 'remote_timer_window', 'location=0')")
    pr=pw.value; pr.on("pageerror", lambda e: errs.append("presenter: "+str(e))); pr.wait_for_timeout(1500)
    ed=c.new_page(); ed.on("pageerror", lambda e: errs.append("editor: "+str(e))); ed.goto(BASE+"runsheet.html"); ed.wait_for_timeout(1500)
    for name, pg in (("presenter", pr), ("editor", ed)):
        pg.bring_to_front(); pg.wait_for_timeout(1300)
        print(name, "hasFocus:", pg.evaluate("document.hasFocus()"), "| overlay_open:", pg.evaluate("localStorage.overlay_open || null"))
        print(name, "focused, overlay open: badge", pg.is_visible(".kw-badge"), "|", pg.get_attribute(".kw-badge", "title")[:40] if pg.locator(".kw-badge").count() else None)
    pr.bring_to_front(); was=t.evaluate("document.documentElement.classList.contains('paused')")
    pr.keyboard.press('"'); pr.wait_for_timeout(600)
    print("presenter window: \" pressed there -> timer paused:", was, "->", t.evaluate("document.documentElement.classList.contains('paused')"), "| presenter's own copy paused:", pr.evaluate("document.documentElement.classList.contains('paused')"))
    pr.keyboard.press('"'); pr.wait_for_timeout(600)
    t.bring_to_front(); t.wait_for_timeout(300)
    # hidden page: the bus still drives it (the timer's worker tick)
    t.evaluate("Object.defineProperty(document, 'visibilityState', {value: 'hidden', configurable: true}); document.dispatchEvent(new Event('visibilitychange'))")
    a=pipdoc()["remain"]; t.wait_for_timeout(3000); bb=pipdoc()["remain"]
    print("page hidden: overlay went from", a, "to", bb)
    print("waiting 32 s for the settings box to fade…"); t.wait_for_timeout(32000)
    print("settings box after 32 s:", t.is_visible("#lo-box"))
    t.keyboard.press("o"); t.wait_for_timeout(1000)
    print("after O again: floating:", pipdoc(), "| html.overlay:", t.evaluate("document.documentElement.classList.contains('overlay')"), "| keys warning:", t.is_visible(".kw-badge"))
    ed.bring_to_front(); ed.wait_for_timeout(1300); print("overlay closed: editor badge:", ed.is_visible(".kw-badge"), "| overlay_open:", ed.evaluate("localStorage.overlay_open || null")); t.bring_to_front()
    t.keyboard.press("o"); t.wait_for_timeout(1000)
    print("O a third time: settings box back:", t.is_visible("#lo-box"), "| shape kept:", (pipdoc() or {}).get("cls"))
print("errors:", errs)
