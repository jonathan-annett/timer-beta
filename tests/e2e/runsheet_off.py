import os as _os  # paths: the repo's public/ folder
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
# Run sheet mode off (Shift+click run sheet): the item's name goes (an operator's message stays), the
# operator's own default (7:00 here) comes back in place of the last item's length, and the timer is
# paused at the start of it, ready for Space.
import os, mimetypes
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; BASE="https://timer.sophtwhere.com/beta/"
def h(route, req):
    u=req.url
    if u.startswith(BASE):
        fp=os.path.join(ROOT,u[len(BASE):].split("?")[0] or "timer.html")
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-proxy-server"]); c=b.new_context(ignore_https_errors=True)
    c.add_init_script("""if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';localStorage.defaultDuration=String(7*60000);
      localStorage.runsheet=JSON.stringify({title:'D',perItem:20,items:[{id:'a',name:'Welcome',start:null,duration:300},{id:'b',name:'Keynote',start:null,duration:1800}]});localStorage.runsheet_state=JSON.stringify({active:true,index:-1,history:[],log:[]})}""")
    c.route("**/*",h); t=c.new_page(); t.on("pageerror", lambda e: errs.append(str(e))); t.goto(BASE+"timer.html"); t.wait_for_timeout(1500)
    t.evaluate("document.getElementById('whats-new')?.remove()")
    msg=lambda: t.evaluate("document.documentElement.classList.contains('show_custom_message') ? document.getElementById('custom_message').textContent : ''")
    st=lambda: (msg(), t.text_content("#remain_disp"), t.evaluate("document.documentElement.classList.contains('paused')"), t.evaluate("document.documentElement.classList.contains('runsheet')"))
    t.keyboard.press(" "); t.wait_for_timeout(2500); print("item running:", st())
    t.evaluate("processTimerApiMessage({cmd:'custommessage', text:''})")
    t.click("#btnrunsheet", modifiers=["Shift"]); t.wait_for_timeout(1500); print("run sheet off:", st(), "| default:", t.text_content("#disp_next_mins"))
    t.keyboard.press(" "); t.wait_for_timeout(1500); print("Space:", st())
    t.click("#btnrunsheet", modifiers=["Shift"]); t.wait_for_timeout(500); print("on again:", st())
    # off while an operator message is up: it stays
    t.keyboard.press(" "); t.wait_for_timeout(800); t.evaluate("processTimerApiMessage({cmd:'custommessage', text:'Hello'})"); t.wait_for_timeout(300)
    t.click("#btnrunsheet", modifiers=["Shift"]); t.wait_for_timeout(1000); print("off with an operator message:", st(), "| item layer:", t.evaluate("localStorage.message_item"))
    b.close()
print("errors:", errs)
