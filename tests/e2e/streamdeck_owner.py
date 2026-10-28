import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Only one page drives the Stream Deck: not a presenter window, and only one timer tab at a time
# (the next takes over when it closes). A fake WebHID deck (an MK.2) stands in for the hardware;
# each page gets its own fake, so "opened" says whether that page attached.
import os, mimetypes, json
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; BASE="https://timer.sophtwhere.com/beta/"
FAKE_HID = """(() => {
  const listeners = {};
  const dev = { vendorId: 0x0fd9, productId: 0x0080, productName: 'Fake MK.2', opened: false, reports: 0,
    async open() { this.opened = true; }, async close() { this.opened = false; },
    async sendReport() { this.reports++; }, async sendFeatureReport() {},
    addEventListener(t, fn) { listeners[t] = fn; }, removeEventListener(t) { delete listeners[t]; } };
  // Press key i (gen2 input report: key states from byte 3), then release it
  dev.press = i => { [1, 0].forEach(v => { const b = new Uint8Array(3 + 15); b[3 + i] = v;
    listeners.inputreport && listeners.inputreport({ reportId: 1, data: new DataView(b.buffer) }); }); };
  window.__deck = dev;
  Object.defineProperty(navigator, 'hid', { configurable: true, value: {
    getDevices: async () => [dev], requestDevice: async () => [dev], addEventListener() {}, removeEventListener() {} } });
})();"""
def h(route, req):
    u=req.url
    if u.startswith(BASE):
        fp=os.path.join(ROOT,u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-proxy-server","--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"])
    c=b.new_context(ignore_https_errors=True, viewport={"width":1280,"height":800})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0'}")
    c.add_init_script(FAKE_HID)
    c.route("**/*",h)
    def page(url, name):
        pg=c.new_page(); pg.on("pageerror", lambda e: errs.append(name+": "+str(e))); pg.goto(BASE+url); pg.wait_for_timeout(1500); return pg
    deck=lambda pg: pg.evaluate("({opened: __deck.opened, reports: __deck.reports, status: (document.getElementById('deck-status')||{}).textContent})")
    t1=page("timer.html", "timer1")
    print("timer 1:", deck(t1))
    t1.evaluate("__deck.press(10)"); t1.wait_for_timeout(800)   # MK.2 default layout: key 10 = Bar
    print("Bar pressed -> bar on:", t1.evaluate("document.documentElement.classList.contains('showbar')"), "| stored:", t1.evaluate("localStorage.showbar"), "| reports:", deck(t1)["reports"])
    pr=page("timer.html?presenter", "presenter")
    print("presenter window:", deck(pr))
    t2=page("timer.html", "timer2")
    print("timer 2 while 1 is open:", deck(t2))
    r0=deck(t1)["reports"]
    t1.evaluate("__deck.press(10)"); t1.wait_for_timeout(800)
    print("Bar again -> bar on:", t1.evaluate("document.documentElement.classList.contains('showbar')"), "| reports from 1:", deck(t1)["reports"]-r0, "| from 2:", deck(t2)["reports"], "| from presenter:", deck(pr)["reports"])
    t1.close(); t2.wait_for_timeout(1500)
    print("timer 1 closed -> timer 2:", deck(t2))
print("errors:", errs)
