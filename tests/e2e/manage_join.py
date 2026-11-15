import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
from _proximity import approve   # the proximity check: type each new device's number on the timer
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh)
# The management console, step 2 of docs/manage-plan.md: a console (manage.html) pairs an admin phone
# (manage-phone.html, its number typed on the console); the phone takes a room timer's link, passes the
# room's proximity check and asks; the room can't allow it without typing a name; the phone can change it;
# the console refuses a name it has already; the room shows the name it ends up with. Then the grid (what
# each room is doing), a reload of a room (the console comes back by its token), the room's Stop management,
# the console's Remove, and sessions (one tab per event; a new event keeps its own rooms). Mismatches → errors.
import json, mimetypes, os
from playwright.sync_api import sync_playwright
ROOT = PUBLIC; BASE = "https://timer.sophtwhere.com/beta/"
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        fp = os.path.join(ROOT, u[len(BASE):].split("?")[0].split("#")[0] or "timer.html")
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
ARGS = ["--no-proxy-server", "--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"]
FEATURES = "window.TimerFeatures = {manage: true, stings: true, playout: true, glasses: true, styles: true};"   # the trial on (features.js: alpha and localhost only)
SHEET = {"title": "Day 1", "perItem": 20, "items": [{"id": "a", "name": "Welcome", "start": None, "duration": 600},
    {"id": "b", "name": "Keynote", "start": None, "duration": 1800}, {"id": "c", "name": "Panel", "start": None, "duration": 1200}]}
errs = []
def check(what, got, want):
    print(what + ":", got)
    if got != want: errs.append(f"{what}: got {got!r}, want {want!r}")
def wait_for(pg, js, timeout=12000):
    try: pg.wait_for_function(js, timeout=timeout); return True
    except Exception: return False

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    def timer(label, sheet):
        c = b.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 800})
        init = "if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';"
        if sheet: init += "localStorage.runsheet=" + json.dumps(json.dumps(sheet)) + ";localStorage.runsheet_state=JSON.stringify({active:true,index:-1,history:[],log:[]});"
        c.add_init_script(FEATURES + init + "}"); c.route("**/*", h)
        t = c.new_page(); t.on("pageerror", lambda e: errs.append(label + ": " + str(e)))
        t.goto(BASE + "timer.html?remote=" + SERVER); t.wait_for_timeout(1500)
        t.evaluate("document.getElementById('quick-start-overlay')?.remove(); document.getElementById('whats-new')?.remove()")
        t.evaluate("window.remoteControl.open()"); t.wait_for_timeout(1200)
        return t
    ta = timer("room A", SHEET); tb = timer("room B", None)
    ta.evaluate("runsheet.next()"); ta.wait_for_timeout(500)

    cc = b.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 800})
    cc.add_init_script(FEATURES + "if(!localStorage.__s){localStorage.clear();localStorage.__s=1}"); cc.route("**/*", h)
    m = cc.new_page(); m.on("pageerror", lambda e: errs.append("console: " + str(e)))
    answers = []                                       # the console's prompt / confirm answers, in order
    m.on("dialog", lambda d: (d.accept(answers.pop(0)) if isinstance(answers[0], str) else (answers.pop(0), d.accept())) if answers else d.dismiss())
    m.goto(BASE + "manage.html?remote=" + SERVER); m.wait_for_timeout(1500)
    m.fill("#event", "Annual Conference")
    check("console: Add a room open with no rooms", m.is_visible("#add"), True)
    wait_for(m, "window.__manage.host.status === 'ok'")
    plink = m.text_content("#addlink")
    check("admin phone link", ("manage-phone.html#" in plink, "a=" in plink, "s=" in plink), (True, True, True))

    # The admin phone pairs with the console: its number typed there
    pc = b.new_context(ignore_https_errors=True, viewport={"width": 390, "height": 800}, has_touch=True, is_mobile=True)
    pc.add_init_script(FEATURES + "if(!localStorage.__s){localStorage.clear();localStorage.__s=1}"); pc.route("**/*", h)
    ph = pc.new_page(); ph.on("pageerror", lambda e: errs.append("phone: " + str(e)))
    ph.goto(plink);
    wait_for(ph, "!document.getElementById('pin').hidden && document.getElementById('pincode').textContent.length === 3")
    num = ph.text_content("#pincode")
    wait_for(m, "!!document.querySelector('#asks .ask input')")
    m.fill("#asks .ask input", num); m.press("#asks .ask input", "Enter")
    check("phone: ready after the console let it in", wait_for(ph, "!document.getElementById('ready').hidden"), True)
    check("phone: knows the event", ph.text_content("#sub"), "Adding rooms to “Annual Conference”")
    check("console: lists the admin phone", "Admin phones:" in (m.text_content("#phones") or ""), True)

    def add(t, typed, edit=None, expect_taken=False):
        ph.evaluate("document.querySelector('#ready details').open = true")
        ph.fill("#paste", t.evaluate("window.remoteControl.linkFor('control')")); ph.click("#pastego")
        wait_for(ph, "!document.getElementById('pin').hidden && document.getElementById('pincode').textContent.length === 3")
        approve(t)                                     # the room types the phone's number
        ok = wait_for(t, "!!document.querySelector('#phone-panel .pp-mgask')")
        check("room: the management request shows", ok, True)
        check("room: Allow waits for a name", t.evaluate("document.querySelector('#phone-panel .pp-mgask button[data-act=mg-ok]').disabled"), True)
        t.fill("#phone-panel .pp-mgname", typed)
        check("room: Allow once named", t.evaluate("document.querySelector('#phone-panel .pp-mgask button[data-act=mg-ok]').disabled"), False)
        check("room: the request names the event", "Annual Conference" in t.text_content("#phone-panel .pp-mgask"), True)
        if not expect_taken: t.screenshot(path=OUTDIR + "/manage_grant.png"); ph.screenshot(path=OUTDIR + "/manage_phone_pin.png")
        t.click("#phone-panel .pp-mgask button[data-act=mg-ok]")
        check("phone: naming shown with the room's name", (wait_for(ph, "!document.getElementById('naming').hidden"), ph.input_value("#rname")), (True, typed))
        if expect_taken:
            ph.click("#addroom"); ph.wait_for_timeout(1200)
            check("phone: a name the console has is refused", "already a room called" in ph.text_content("#namemsg"), True)
        if edit: ph.fill("#rname", edit)
        ph.click("#addroom")
        check("phone: back to scanning", wait_for(ph, "!document.getElementById('ready').hidden"), True)

    add(ta, "Room 104")
    add(tb, "Room 104", edit="Room 101", expect_taken=True)
    names = m.evaluate("window.__manage.rooms().map(r => r.name).sort()")
    check("console: both rooms", names, ["Room 101", "Room 104"])
    check("room A shows its name", wait_for(ta, "document.getElementById('manage-tag')?.textContent === 'Monitored as Room 104'"), True)
    check("room B shows the name the phone gave", wait_for(tb, "document.getElementById('manage-tag')?.textContent === 'Monitored as Room 101'"), True)
    ta.evaluate("window.remoteControl.open()"); ta.wait_for_timeout(300); ta.screenshot(path=OUTDIR + "/manage_tag.png")
    check("room: the admin phone isn't kept", ta.evaluate("JSON.parse(localStorage.remote_approved).filter(x => !x.manage).length"), 0)

    # The grid
    wait_for(m, "[...document.querySelectorAll('#rows tr')].length === 2 && !document.querySelector('#rows tr.offline') && document.querySelector('#rows').textContent.includes('Welcome') && !document.querySelector('#rows').textContent.includes('connecting')")
    rows = m.evaluate("[...document.querySelectorAll('#rows tr')].map(tr => [...tr.cells].map(c => c.textContent.trim()))")
    print("grid:", rows)
    check("grid: sorted by name", [r[0].split("connecting")[0] for r in rows], ["Room 101", "Room 104"])
    check("grid: room A's item and next", (rows[1][1].startswith("Welcome"), rows[1][3]), (True, "Keynote"))
    check("grid: room A's time left counts", rows[1][2][:1] in "98", True)
    check("grid: room A on time", rows[1][5], "on time")
    check("grid: room B, countdown only", (rows[0][1], rows[0][2][:1] in "123456789"), ("Countdown only (no run sheet)", True))
    m.screenshot(path=OUTDIR + "/manage_grid.png")
    m.click("#rows tr:nth-child(2)"); m.wait_for_timeout(600)
    check("room view: its run sheet", m.evaluate("[...document.querySelectorAll('#rv-list .rl .n')].map(e => e.textContent)"), ["Welcome", "Keynote", "Panel"])
    check("room view: now marked", m.evaluate("document.querySelector('#rv-list .rl.now .n')?.textContent"), "Welcome")
    m.screenshot(path=OUTDIR + "/manage_room.png")
    m.click("#rv-back")

    # Room A reloads: the console comes back by its token
    ta.reload(); ta.wait_for_timeout(2500)
    check("after a reload, room A is back on the grid", wait_for(m, "[...document.querySelectorAll('#rows tr')][1] && !document.querySelectorAll('#rows tr')[1].classList.contains('offline') && document.querySelectorAll('#rows tr')[1].textContent.includes('Welcome')", 20000), True)
    check("…and still shows its name", ta.evaluate("document.getElementById('manage-tag')?.textContent"), "Monitored as Room 104")

    # Rename on the console: the room follows
    m.click("#rows tr:nth-child(2)"); m.wait_for_timeout(300)
    answers[:] = ["Room 101", "Auditorium"]          # prompt answers, in order: a taken name, then a free one
    m.click("#rv-rename"); m.wait_for_timeout(800)
    check("rename: a taken name asked again, then kept", m.evaluate("window.__manage.rooms().map(r => r.name).sort()"), ["Auditorium", "Room 101"])
    check("rename: the room shows it", wait_for(ta, "document.getElementById('manage-tag')?.textContent === 'Monitored as Auditorium'"), True)
    m.click("#rv-back")

    # Room A: Stop management (two clicks): the console says so, the tag goes
    btn = ta.evaluate("[...document.querySelectorAll('#phone-panel .pp-peers button[data-dev=revoke]')].map(b => b.textContent)")
    check("room: Stop management in the device list", "Stop management" in btn, True)
    ta.evaluate("(() => { const b = [...document.querySelectorAll('#phone-panel .pp-peers button[data-dev=revoke]')].find(b => b.textContent === 'Stop management'); b.click(); })()"); ta.wait_for_timeout(200)
    ta.evaluate("(() => { const b = [...document.querySelectorAll('#phone-panel .pp-peers button[data-dev=revoke]')].find(b => b.textContent === 'Sure?'); b.click(); })()")
    check("console: room A revoked", wait_for(m, "document.querySelector('#rows').textContent.includes('stopped monitoring')"), True)
    check("room A: tag gone", wait_for(ta, "!document.documentElement.classList.contains('manage-on')"), True)

    # The console removes room B: it's told, and forgets the grant
    m.evaluate("(() => { const r = window.__manage.rooms().find(r => r.name === 'Room 101'); document.querySelector(`#rows tr[data-id=\"${r.id}\"]`).click(); })()"); m.wait_for_timeout(300)
    answers[:] = [True]                                # Remove: yes
    m.click("#rv-remove"); m.wait_for_timeout(1500)
    check("console: room B removed", m.evaluate("window.__manage.rooms().map(r => r.name)"), ["Auditorium"])
    check("room B: grant and tag gone", (tb.evaluate("JSON.parse(localStorage.remote_approved || '[]').some(x => x.manage)"), tb.evaluate("document.documentElement.classList.contains('manage-on')")), (False, False))

    # Sessions: the same event in a second tab is refused; a new event keeps its own (empty) rooms
    sid = m.evaluate("window.__manage.sid")
    m2 = cc.new_page(); m2.on("pageerror", lambda e: errs.append("console 2: " + str(e)))
    m2.goto(BASE + "manage.html?remote=" + SERVER + "#e=" + sid); m2.wait_for_timeout(1200)
    check("same event, second tab: refused", (m2.is_visible("#taken"), m2.is_visible("#app")), (True, False))
    m2.click("#taken-new"); m2.wait_for_timeout(1500)
    check("a new event in that window: its own session", (m2.is_visible("#app"), m2.evaluate("window.__manage.sid") != sid, m2.evaluate("window.__manage.rooms().length")), (True, True, 0))
    check("the first event keeps its rooms", m.evaluate("window.__manage.rooms().length"), 1)
    b.close()
print("errors:", errs)
