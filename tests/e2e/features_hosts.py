import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Which site gets which trial feature (features.js): the assist station on alpha only, stings and playout on alpha and beta;
# the share panel's Glasses box on alpha and on beta's two addresses (the glasses' server); none of
# them anywhere else (the VPS copy, other hosts).
import os, mimetypes, sys
from playwright.sync_api import sync_playwright
EXPECT = {
    "alpha.timed-show.com":      {"glasses": True,  "assist": True,  "stings": True,  "playout": True},
    "beta.timed-show.com":       {"glasses": True,  "assist": False, "stings": True, "playout": True},
    "timer-beta.sophtwhere.com": {"glasses": True,  "assist": False, "stings": True, "playout": True},
    "timer.sophtwhere.com":      {"glasses": False, "assist": False, "stings": False, "playout": False},
    "example.com":               {"glasses": False, "assist": False, "stings": False, "playout": False},
}
def h(route, req):
    path = req.url.split("://", 1)[1].split("/", 1)[1].split("?")[0].split("#")[0] if "/" in req.url.split("://", 1)[1] else ""
    fp = os.path.join(PUBLIC, path or "timer.html")
    if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
    return route.fulfill(status=404, body=b"")
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server"])
    c = b.new_context(ignore_https_errors=True)
    c.route("**/*", h)
    t = c.new_page()
    for host, want in EXPECT.items():
        t.goto("https://%s/runsheet.html" % host)   # a page that loads features.js and nothing that needs a server
        got = t.evaluate("({glasses: !!TimerFeatures.glasses, assist: !!TimerFeatures.assist, stings: !!TimerFeatures.stings, playout: !!TimerFeatures.playout})")
        ok = got == want
        print(("ok   " if ok else "FAIL ") + host + ": " + str(got))
        if not ok: errs.append(host)
    b.close()
print("errors:", errs)
sys.exit(1 if errs else 0)
