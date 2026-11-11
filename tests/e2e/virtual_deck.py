import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh)
# Virtual Stream Decks (virtual-deck.js): the deck editor's Use as virtual deck… opens deck.html, the
# model being edited, drawn from the timer window's StreamDeck; while the editor is open it shows and
# runs the unsaved changes; its size menu switches model. Its ⋯ → Show on a phone shows a QR code of a
# control link to the deck view at that size (dm=), the phone's number is typed into the pop-up, and the
# phone opens as that deck (the phone's View menu offers Mini, MK.2 and XL).
import mimetypes, os, sys
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        fp = os.path.join(PUBLIC, u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)
ARGS = ["--no-proxy-server", "--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"]
INIT = "if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01'}"

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1400, "height": 900})
    c.add_init_script(INIT); c.route("**/*", h)
    t = c.new_page(); t.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    t.goto(BASE + "timer.html?remote=" + SERVER); t.wait_for_timeout(1200)
    remain = lambda: t.text_content("#remain_disp").strip()

    t.keyboard.press("d"); t.wait_for_timeout(300)
    t.select_option("#deck-model-select", "mk2"); t.wait_for_timeout(200)
    with c.expect_page() as pp: t.click("#deck-virtual-btn")
    d = pp.value; d.on("pageerror", lambda e: errs.append("deck: " + str(e))); d.wait_for_load_state(); d.wait_for_timeout(800)
    n = lambda: d.evaluate("document.querySelectorAll('#keys canvas').length")
    check("Use as virtual deck…: a pop-up deck, the model being edited (MK.2: 15 keys)", n() == 15 and d.input_value("#model") == "mk2", n())
    ink = d.evaluate("(() => { const c = document.querySelector('#keys canvas'); const x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 0; i < x.length; i += 4) if (x[i] + x[i+1] + x[i+2] > 200) k++; return k; })()")
    check("… its keys drawn as on the deck", ink > 50, ink)
    check("… saying it shows the editor's unsaved changes", "unsaved" in d.text_content("#note"), d.text_content("#note"))
    # an unsaved change in the editor: the pop-up shows it and runs it
    t.click('#deck-grid .deck-editor-key[data-index="0"]'); t.fill("#deck-key-duration", "7"); t.wait_for_timeout(500)
    face0 = lambda: d.evaluate("JSON.parse(JSON.stringify(window.opener.StreamDeck.faces('mk2', {editing: true})[0])).label")
    check("an unsaved 7-minute preset shows on the pop-up", face0() == "7 min", face0())
    d.locator("#keys canvas").nth(0).click(); t.wait_for_timeout(1200)
    check("… and pressing it there starts 7 minutes", remain() in ("6:59", "6:58", "7:00"), remain())
    t.click("#deck-editor-close"); t.wait_for_timeout(500)
    check("editor closed without saving: the pop-up is back to the saved layout", face0() == "10 min" and d.text_content("#note") == "", (face0(), d.text_content("#note")))
    d.select_option("#model", "mini"); d.wait_for_timeout(400)
    check("the size menu: a Mini (6 keys)", n() == 6, n())
    d.select_option("#model", "mk2"); d.wait_for_timeout(400)
    d.screenshot(path=OUTDIR + "/virtual_deck_popup.png")

    # ⋯ → Show on a phone: QR code, the phone's number typed in the pop-up, the phone opens as an MK.2
    d.click("#more"); d.click("#m-share"); d.wait_for_timeout(1500)
    link = d.get_attribute("#qr", "title")
    check("Show on a phone: a QR code of a control link to the deck view at this size", link and "k=" in link and "m=deck" in link and "dm=mk2" in link and d.evaluate("!!document.querySelector('#qr canvas, #qr img')"), link)
    pc = b.new_context(ignore_https_errors=True, viewport={"width": 740, "height": 390}, has_touch=True, is_mobile=True); pc.route("**/*", h)
    ph = pc.new_page(); ph.on("pageerror", lambda e: errs.append("phone: " + str(e)))
    ph.goto(link.replace("remote.html", "remote.html?remote=" + SERVER) if "s=" not in link else link); ph.wait_for_timeout(3000)
    pin = ph.text_content("#pincode")
    d.wait_for_timeout(800)
    check("… the phone picked the code up: it's off the screen", not d.is_visible("#s-qr") and d.evaluate("!document.querySelector('#qr canvas, #qr img')"))
    check("… the pop-up asks for the phone's number", d.is_visible("#askpin") and "connecting" in d.text_content("#waitwho"), d.text_content("#waitwho"))
    d.fill("#askpin", pin); d.wait_for_timeout(2500)
    check("… typed there, the phone is let in, with Revoke", "Connected" in d.text_content("#donemsg") and d.is_visible("#revoke") and not ph.is_visible("#pinwait"), d.text_content("#donemsg"))
    pn = lambda: ph.evaluate("document.querySelectorAll('#keys canvas').length")
    check("the phone opens as a Stream Deck MK.2 (15 keys)", ph.evaluate("document.body.classList.contains('deckview')") and pn() == 15, pn())
    ph.locator("#keys canvas").nth(1).tap(); t.wait_for_timeout(1500)
    check("… and its keys work (20 min)", remain() in ("19:59", "19:58", "20:00"), remain())
    ph.screenshot(path=OUTDIR + "/virtual_deck_phone_mk2.png")
    ph.click("#viewbtn") if ph.locator("#viewbtn").count() else None
    ph.wait_for_timeout(300)
    menu = ph.evaluate("[...document.querySelectorAll('#viewlist button')].map(b => b.firstChild.textContent)")
    check("the phone's View menu offers each deck size", all(x in menu for x in ["Stream Deck XL", "Stream Deck MK.2", "Stream Deck Mini"]), menu)
    ph.evaluate("[...document.querySelectorAll('#viewlist button')].find(b => b.firstChild.textContent === 'Stream Deck Mini').click()"); ph.wait_for_timeout(1500)
    check("… a Mini: 6 keys, from the timer's Mini layout", pn() == 6 and ph.evaluate("localStorage.remote_deck_model") == "mini", pn())
    ph.screenshot(path=OUTDIR + "/virtual_deck_phone_mini.png")
    d.screenshot(path=OUTDIR + "/virtual_deck_share_connected.png")
    # Revoke: thrown out at once
    d.click("#revoke"); d.wait_for_timeout(500)
    check("Revoke: the phone is forgotten", "Revoked" in d.text_content("#donemsg") and t.evaluate("JSON.parse(localStorage.remote_approved || '[]').length") == 0, (d.text_content("#donemsg"), t.evaluate("localStorage.remote_approved")))
    ph.wait_for_timeout(4000)   # (the phone shows why for 2.5 s, then goes to the code screen)
    check("… and disconnected: back on the code screen", "control.html" in ph.url, ph.url)
    # Show the code again, a second phone, Refuse
    d.click("#again"); d.wait_for_timeout(1200)
    link2 = d.get_attribute("#qr", "title")
    ph2 = pc.new_page(); ph2.goto(link2.replace("remote.html", "remote.html?remote=" + SERVER) if "s=" not in link2 else link2); ph2.wait_for_timeout(3000)
    check("Show the code again: a second phone, the code off the screen again", d.is_visible("#s-wait") and not d.is_visible("#s-qr"))
    d.click("#refuse"); d.wait_for_timeout(1500)
    check("Refuse: that phone is disconnected", "Refused" in d.text_content("#donemsg"), d.text_content("#donemsg"))
    # New code: the old code stops working
    d.on("dialog", lambda dl: dl.accept())
    d.click("#again"); d.wait_for_timeout(800)
    d.click("#newcode"); d.wait_for_timeout(1500)
    link3 = d.get_attribute("#qr", "title")
    check("New code: a fresh code shown, different from before", link3 and link3 != link2, (link2, link3))
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
