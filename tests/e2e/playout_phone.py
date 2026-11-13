import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# The playout computer's Stream Deck keys on a phone (playout-deck.js hosts a room; playout-phone.html):
# Show on a phone… shows a QR code (gone once a phone picks it up); the phone's number typed on the playout
# page lets it in (a token after, so a reload comes straight back); its keys are the deck's, with down and
# up (a press starts an item, a tap stops it, a hold fades it); it may change its size; Revoke and a wrong
# number put it out; Stop sharing ends it. On the demo, against the local pairing server (server.sh).
import mimetypes, os, sys
from playwright.sync_api import sync_playwright
SERVER = os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
BASE = "https://timer.sophtwhere.com/beta/"
SETUP = """async () => {                     // three speakers: a 6 s tone each at the start
  const wav = sec => { const sr = 16000, n = sr * sec, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / sr) * 8000, true);
    return new Blob([b], { type: 'audio/wav' }); };
  const cues = {};
  for (let k = 1; k <= 3; k++) { cues['demo-' + k] = [{ id: 'c' + k, name: 'Tone ' + k, media: 'audio', src: 'file', trigger: 'start', at: 0, duration: 6 }]; await videoStore.put('pocue:c' + k, wav(6)); }
  localStorage.playout_demo_cues = JSON.stringify(cues);
}"""
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        name = u[len(BASE):].split("?")[0].split("#")[0]
        if name in ("changelog.html", "stock-stings.json"): return route.fulfill(status=404, body=b"")
        fp = os.path.join(PUBLIC, name)
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

ARGS = ["--no-proxy-server", "--autoplay-policy=no-user-gesture-required", "--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"]
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1100, "height": 1000})
    c.add_init_script("window.TimerFeatures = { playout: true };")
    c.route("**/*", h)
    po = c.new_page(); po.on("pageerror", lambda e: errs.append("playout: " + str(e)))
    po.goto(BASE + "playout.html?demo&remote=" + SERVER); po.wait_for_timeout(800)
    po.evaluate(SETUP); po.reload(); po.wait_for_timeout(1200)
    names = [x["n"] for x in po.evaluate("window.__playout.show().items")]
    playing = lambda: sorted(po.evaluate("window.__playout.playing()"))
    local = lambda: po.evaluate("window.__playout.local()")

    po.click("#phoneshow"); po.wait_for_timeout(1500)
    link = po.evaluate("window.__playoutDeck.phoneLink()")
    check("Show on a phone…: a QR code of the phone's link", po.is_visible("#ph-qr") and po.locator("#ph-qr canvas, #ph-qr img").count() > 0 and "playout-phone.html#r=" in link and "&dm=mk2" in link, link)

    def phone_ctx():
        pc = b.new_context(ignore_https_errors=True, viewport={"width": 390, "height": 760}, is_mobile=True, has_touch=True)
        pc.route("**/*", h)
        ph = pc.new_page(); ph.on("pageerror", lambda e: errs.append("phone: " + str(e)))
        return pc, ph
    pc, ph = phone_ctx()
    ph.goto(link); ph.wait_for_timeout(2500)
    pin = ph.text_content("#pincode")
    check("the phone shows a number to tell the operator", len(pin) == 3 and pin.isdigit() and ph.is_visible("#cover"), pin)
    check("… the playout page asks for it, the QR code gone", po.locator("#ph-pending .ph-pin").count() == 1 and not po.is_visible("#ph-qr") and po.is_visible("#ph-again"))
    po.fill("#ph-pending .ph-pin", pin); po.wait_for_timeout(1500)
    f = ph.evaluate("window.__pphone.faces()")
    check("its number typed: the phone has the keys", ph.evaluate("window.__pphone.ok()") and not ph.is_visible("#cover") and [x.split(" | ")[0] for x in f[:3]] == names[:3] and f[14] == "■ All | tap: stop", f)
    check("… listed as connected", "Connected" in po.text_content("#ph-list"), po.text_content("#ph-list"))
    key = lambda i, t: ph.evaluate("([i, t]) => document.querySelectorAll('#keys canvas')[i].dispatchEvent(new PointerEvent(t, { pointerId: 7, bubbles: true }))", [i, t])

    key(0, "pointerdown"); key(0, "pointerup"); po.wait_for_timeout(700)
    check("a press on the phone starts the item", (local() or {}).get("item") == "demo-1" and playing() == ["c1"], [local(), playing()])
    ph.wait_for_timeout(500)
    check("… the phone's key says so (amber: started there)", ph.evaluate("window.__pphone.bgs()[0]") == "#7a5c00", ph.evaluate("window.__pphone.bgs()[0]"))
    key(0, "pointerdown"); po.wait_for_timeout(700)
    check("held on the phone: fading", playing() == ["c1"] and ph.evaluate("window.__pphone.bgs()[0]") == "#9a5200", [playing(), ph.evaluate("window.__pphone.bgs()[0]")])
    key(0, "pointerup"); po.wait_for_timeout(400)
    check("… let go: stopped", playing() == [] and local() is None)

    ph.select_option("#model", "xl"); ph.wait_for_timeout(1200)
    f = ph.evaluate("window.__pphone.faces()")
    check("the phone as an XL: 32 keys, its own size", len(f) == 32 and f[31] == "■ All | tap: stop" and po.evaluate("window.__playoutDeck.phones()[0].model") == "xl", [len(f), f[31]])
    ph.screenshot(path=OUTDIR + "/playout_phone.png")

    ph.reload(); ph.wait_for_timeout(3000)
    check("a reload: straight back (its token), no number asked", ph.evaluate("window.__pphone.ok()") and not ph.is_visible("#cover") and len(ph.evaluate("window.__pphone.faces()")) == 32)
    ph.evaluate("localStorage.playout_phone_model = 'c6x4'"); ph.reload(); ph.wait_for_timeout(3000)
    f = ph.evaluate("window.__pphone.faces()")
    check("a custom size on the phone (6 × 4, as a dm=c6x4 link sets): 24 keys, its own menu entry", len(f) == 24 and f[23].startswith("■ All") and po.evaluate("window.__playoutDeck.phones()[0].model") == "c6x4"
          and ph.evaluate("document.getElementById('model').selectedOptions[0].textContent") == "6 × 4", [len(f), ph.evaluate("document.getElementById('model').value")])
    ph.select_option("#model", "xl"); ph.wait_for_timeout(1200)

    # a second phone, the wrong number: out
    pc2, ph2 = phone_ctx()
    po.click("#ph-again"); po.wait_for_timeout(500)
    check("Show the code again", po.is_visible("#ph-qr"))
    ph2.goto(po.evaluate("window.__playoutDeck.phoneLink()")); ph2.wait_for_timeout(2500)
    pin2 = ph2.text_content("#pincode")
    po.fill("#ph-pending .ph-pin", "999" if pin2 != "999" else "998"); po.wait_for_timeout(1500)
    check("a wrong number: that phone is out", "didn’t let this phone in" in ph2.text_content("#covermsg") and ph2.evaluate("localStorage.playout_phone_link ?? null") is None, ph2.text_content("#covermsg"))
    check("… the first one still connected", ph.evaluate("window.__pphone.ok()") and len([x for x in po.evaluate("window.__playoutDeck.phones()") if x["ok"]]) == 1)

    # Revoke
    po.click('#ph-list button[data-ph-act="revoke"]'); po.wait_for_timeout(1500)
    check("Revoke: the phone loses the keys and forgets the link", "took these keys away" in ph.text_content("#covermsg") and ph.evaluate("localStorage.playout_phone_link ?? null") is None, ph.text_content("#covermsg"))

    po.click("#ph-stop"); po.wait_for_timeout(500)
    check("Stop sharing: the box goes, the button back to Show on a phone…", not po.is_visible("#phonebox") and po.text_content("#phoneshow") == "Show on a phone…")
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
