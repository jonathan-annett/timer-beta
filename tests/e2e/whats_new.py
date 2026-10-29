import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# What's new toast (whats-new.js + changelog.html). The test serves a change log with two releases
# (the real file may only have "next", which is never shown): a new user sees nothing, a returning
# user from before the change log sees the latest, an update shows only what's newer, Got it
# remembers, the presenter window never shows it, and "next" stays out.
import os, mimetypes, re
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; OUT=OUTDIR; BASE="https://timer.sophtwhere.com/beta/"
LOG = open(os.path.join(ROOT, "changelog.html")).read()
LOG = re.sub(r'(<main>.*?</p>)', r'''\1
<section class="release" data-version="next"><h2>Next</h2><ul><li>NOT RELEASED</li></ul></section>
<section class="release" data-version="2026-11-05"><h2>5 November 2026</h2><ul><li>Feature B</li><li>Feature C</li></ul></section>
<section class="release" data-version="2026-10-30"><h2>30 October 2026</h2><ul><li>Feature A</li></ul></section>''', LOG, count=1, flags=re.S)
LOG = re.sub(r'<section class="release" data-version="next">\s*<h2>Next update</h2>.*?</section>', '', LOG, flags=re.S)
def h(route, req):
    u=req.url
    if u.startswith(BASE):
        name=u[len(BASE):].split("?")[0].split("#")[0]
        if name == "changelog.html": return route.fulfill(status=200, body=LOG, headers={"content-type":"text/html"})
        fp=os.path.join(ROOT,name)
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-proxy-server"])
    def page(init, touch=False):
        c=b.new_context(ignore_https_errors=True, viewport={"width":390,"height":844} if touch else {"width":1200,"height":800}, has_touch=touch, is_mobile=touch)
        c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';" + init + "}")
        c.route("**/*",h); t=c.new_page(); t.on("pageerror", lambda e: errs.append(str(e))); t.goto(BASE+"timer.html"); t.wait_for_timeout(2500)
        return t
    toast=lambda t: t.evaluate("(e => e ? [...e.querySelectorAll('h3,li')].map(x=>x.textContent).join(' | ') : null)(document.getElementById('whats-new'))")
    seen=lambda t: t.evaluate("localStorage.whatsnew_seen || null")
    t=page(""); print("new user: toast", toast(t), "| seen", seen(t))
    t=page("localStorage.startedAt=String(Date.now()-60000);"); print("returning, nothing recorded: toast", toast(t), "| seen", seen(t))
    t=page("localStorage.whatsnew_seen='2026-10-30';"); print("seen 30 Oct: toast", toast(t), "| seen", seen(t))
    t.screenshot(path=OUT+"/whats_new.png")
    t.click("#whats-new .wn-ok"); t.wait_for_timeout(500); print("Got it -> seen", seen(t), "| toast gone:", toast(t) is None)
    t.reload(); t.wait_for_timeout(2500); print("reloaded: toast", toast(t))
    t=page("localStorage.whatsnew_seen='2026-01-01';"); print("unknown old version: toast", toast(t))
    t=page("localStorage.whatsnew_seen='2026-10-30';", touch=True); print("phone, quick start up: toast", toast(t), end=" ")
    t.evaluate("document.getElementById('quick-start-overlay').remove()"); t.wait_for_timeout(2500)
    print("| after it: toast", toast(t) is not None, "| above the strip:", t.evaluate("document.getElementById('whats-new').getBoundingClientRect().bottom <= document.getElementById('touch-strip').getBoundingClientRect().top"))
    t.screenshot(path=OUT+"/whats_new_phone.png")
    c=b.new_context(ignore_https_errors=True); c.add_init_script("localStorage.whatsnew_seen='2026-10-30';localStorage.internetTimeError='0'"); c.route("**/*",h)
    pr=c.new_page(); pr.goto(BASE+"timer.html?presenter"); pr.wait_for_timeout(2500); print("presenter window: toast", toast(pr))
print("errors:", errs)
