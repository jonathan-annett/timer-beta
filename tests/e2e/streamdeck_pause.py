import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# The Stream Deck's Pause/Resume key: pressed while paused it resumes (the paused time is kept as a
# pause), never Clear Pause (which threw the paused time away: a user's bug report, 29 Oct 2026).
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
    c=b.new_context(ignore_https_errors=True); c.route("**/*",h)
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0'}")
    t=c.new_page(); t.on("pageerror", lambda e: errs.append(str(e)))
    t.goto(BASE+"timer.html"); t.wait_for_timeout(1500)
    idx=t.evaluate("StreamDeck.faces('xl').findIndex(f => f && /Pause/.test(f.label || ''))")
    print("XL pause key index:", idx)
    t.evaluate("processTimerApiMessage({cmd:'start', msecs: 5*60000})"); t.wait_for_timeout(1200)
    print("running:", t.text_content("#remain_disp"))
    t.evaluate(f"StreamDeck.press({idx}, 'xl')"); t.wait_for_timeout(300)
    print("pressed: paused =", t.evaluate("document.documentElement.classList.contains('paused')"))
    t.wait_for_timeout(4000)
    t.evaluate(f"StreamDeck.press({idx}, 'xl')"); t.wait_for_timeout(1200)
    print("pressed again: paused =", t.evaluate("document.documentElement.classList.contains('paused')"),
          "| pause time kept (ms):", t.evaluate("Number(localStorage.pauseAcum)"), "| shows:", t.text_content("#remain_disp"))
print("errors:", errs)
