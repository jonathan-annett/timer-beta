import os as _os  # paths: the repo's public/ folder
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
# Pauses survive a reload: start, pause, resume, reload must keep the paused time (resume didn't
# save seekEndsAt, so after a reload the countdown "sped up" to the end without the pause). Also a
# reload while paused, and Undo pauses (') then a reload.
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
    c=b.new_context(ignore_https_errors=True, viewport={"width":1200,"height":800})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0'}")
    c.route("**/*",h); t=c.new_page(); t.on("pageerror", lambda e: errs.append(str(e))); t.goto(BASE+"timer.html"); t.wait_for_timeout(1200)
    st=lambda: t.evaluate("({gap: +localStorage.endsAt - +localStorage.seekEndsAt, catching: document.documentElement.classList.contains('adjusting_time'), paused: document.documentElement.classList.contains('paused'), ends: document.getElementById('ends_disp').textContent, pauses: document.getElementById('extra_time_disp').textContent})")
    t.keyboard.press("Space"); t.wait_for_timeout(2000)
    t.keyboard.press("Shift+Quote"); t.wait_for_timeout(3000); t.keyboard.press("Shift+Quote"); t.wait_for_timeout(500)
    before=st(); print("resumed:", before)
    t.reload(); t.wait_for_timeout(2500); after=st()
    print("reloaded:", after, "| same end:", after["ends"] == before["ends"], "| catching up:", after["catching"])
    t.keyboard.press("Shift+Quote"); t.wait_for_timeout(2000); t.reload(); t.wait_for_timeout(1500)
    print("reloaded while paused:", st())
    t.keyboard.press("Shift+Quote"); t.wait_for_timeout(500); t.keyboard.press("Quote"); t.wait_for_timeout(500)
    undone=st(); t.reload(); t.wait_for_timeout(2000); r=st()
    print("undo pauses then reload:", r, "| same end:", r["ends"] == undone["ends"], "| catching up:", r["catching"])
print("errors:", errs)
