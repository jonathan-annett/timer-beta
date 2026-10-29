# Manual check for the move (needs the legacy-beta worktree at ../timer-legacy): python tests/e2e/_move_to_new_site.py
# The old beta's landing page and moved bar carry settings to the new site's import.html.
import os, mimetypes, json
from playwright.sync_api import sync_playwright
OLD_ROOT="/Users/jonathanannett/timer-tests/timer-legacy/public"; NEW_ROOT="/Users/jonathanannett/timer-tests/timer-beta/public"
OLD="https://timer.sophtwhere.com/beta/"; NEW="https://beta.timed-show.com/"
def h(route, req):
    u=req.url
    for base, root in ((OLD, OLD_ROOT), (NEW, NEW_ROOT)):
        if u.startswith(base):
            fp=os.path.join(root, u[len(base):].split("?")[0].split("#")[0] or "index.html")
            if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
            return route.fulfill(status=404, body=b"")
    return route.abort()
errs=[]
SHEET=json.dumps({"title":"Gala","items":[{"id":"a","name":"Welcome","duration":300,"video":{"key":"rsvideo:a:1","name":"intro.mp4"}},{"id":"b","name":"Keynote ✨","duration":1200}]})
SEED="""localStorage.custom_css = '#remain_disp { color: hotpink; }'; localStorage.defaultDuration = '1200000'; localStorage.showbar = '1';
localStorage.runsheet = %s; localStorage.remote_pairing = '{"room":"SECRET"}'; localStorage.startedAt = '123'; localStorage.internetTimeError='0';""" % json.dumps(SHEET)
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-proxy-server"])
    c=b.new_context(ignore_https_errors=True); c.route("**/*",h)
    pg=c.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(OLD+"deprecated-beta.html"); pg.wait_for_timeout(1500)
    print("deprecated-beta.html ->", pg.url)
    pg.evaluate(SEED)
    pg.goto(OLD+"timer.html"); pg.wait_for_timeout(1500)
    print("old timer bar:", pg.is_visible("#moved-bar"), "|", (pg.text_content("#moved-bar") or "").strip()[:80])
    pg.screenshot(path="/tmp/timer-e2e/moved_bar.png", clip={"x":200,"y":0,"width":880,"height":140})
    pg.goto(OLD); pg.wait_for_timeout(800)
    print("landing:", pg.text_content("h1"), "| bring ticked:", pg.is_checked("#bring"))
    pg.screenshot(path="/tmp/timer-e2e/landing.png")
    pg.click("#next"); pg.wait_for_timeout(2500)
    got=pg.evaluate("({url: location.href, css: localStorage.custom_css, dur: localStorage.defaultDuration, bar: localStorage.showbar, sheet: localStorage.runsheet, pairing: localStorage.remote_pairing || null, started: localStorage.startedAt || null})")
    sheet=json.loads(got.pop("sheet") or "{}")
    print("after Next:", got, "| sheet:", [(i["name"], "video" in i) for i in sheet.get("items",[])])
    print("history back goes to old site?", pg.evaluate("history.length"))
    # Again from the bar, with a different value already on the new site: it asks
    pg.evaluate("localStorage.custom_css = '#remain_disp { color: lime; }'")
    pg.goto(OLD+"timer.html"); pg.wait_for_timeout(1200)
    pg.click("#moved-bar a"); pg.wait_for_timeout(1500)
    print("bar link with different settings there: asks:", pg.is_visible("#go"), "| list:", pg.inner_text("#list").replace("\n"," / "), "| address:", pg.url)
    pg.click("#go"); pg.wait_for_timeout(1500)
    print("replaced:", pg.evaluate("localStorage.custom_css"), "| now at", pg.url)
    # Not ticked: no settings in the link
    pg.goto(OLD); pg.wait_for_timeout(600); pg.uncheck("#bring"); pg.click("#next"); pg.wait_for_timeout(1500)
    print("unticked -> ", pg.url)
    # dismissing the bar
    pg.goto(OLD+"timer.html"); pg.wait_for_timeout(1200); pg.click("#moved-bar button"); pg.reload(); pg.wait_for_timeout(1200)
    print("bar after ✕ and reload:", pg.is_visible("#moved-bar"))
print("errors:", errs)
