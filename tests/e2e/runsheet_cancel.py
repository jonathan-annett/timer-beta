import os as _os  # paths: the repo's public/ folder
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
# Cancelled run sheet items (runsheet-core.js normalise, runsheet.js, the editor's ⊘ / ↺): a cancelled item
# takes no time (rows after it without a start move up; on a timed sheet a row's own start stays, a gap),
# keeps its own length (len) for the CSV and a reinstate, is dimmed in the editor, flagged in the phones'
# list (c: 1), skipped by Next and refused by ▶; items that have run or are running can't be cancelled.
# The CSV carries a Cancelled column, read back on import. Mismatches are added to errors.
import json, mimetypes, os
from playwright.sync_api import sync_playwright
ROOT = PUBLIC; BASE = "https://timer.sophtwhere.com/beta/"
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        fp = os.path.join(ROOT, u[len(BASE):].split("?")[0] or "timer.html")
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
SHEET = {"title": "Cancel", "perItem": 20, "items": [
    {"id": "a", "name": "Welcome", "start": None, "duration": 600},
    {"id": "b", "name": "Keynote", "start": None, "duration": 1800},
    {"id": "c", "name": "Panel", "start": None, "duration": 1200},
    {"id": "d", "name": "Close", "start": None, "duration": 300}]}
errs = []
def check(what, got, want):
    print(what + ":", got)
    if got != want: errs.append(f"{what}: got {got!r}, want {want!r}")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server"]); c = b.new_context(ignore_https_errors=True, accept_downloads=True)
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';"
                      "localStorage.runsheet=" + json.dumps(json.dumps(SHEET)) + ";localStorage.runsheet_state=JSON.stringify({active:true,index:-1,history:[],log:[]})}")
    c.route("**/*", h)
    t = c.new_page(); t.on("pageerror", lambda x: errs.append("timer: " + str(x)))
    t.goto(BASE + "timer.html"); t.wait_for_timeout(1500)
    t.evaluate("document.getElementById('whats-new')?.remove()")
    e = c.new_page(); e.on("pageerror", lambda x: errs.append("editor: " + str(x)))
    e.goto(BASE + "runsheet.html"); e.wait_for_timeout(1200)

    # The core: timing, own length, the CSV both ways
    core = t.evaluate("""() => {
      const C = RunsheetCore;
      const timed = C.normalise({perItem: 20, items: [{id:'a', name:'A', start: 32400, duration: 1800}, {id:'b', name:'B', start: null, duration: 1800, cancelled: true},
        {id:'c', name:'C', start: null, duration: 600}, {id:'d', name:'D', start: 39600, duration: 600, cancelled: true}, {id:'e', name:'E', start: null, duration: 600}]});
      const loose = C.normalise({perItem: 20, items: [{id:'a', name:'A'}, {id:'b', name:'B', cancelled: true}, {id:'c', name:'C'}]});
      const end = C.normalise({perItem: 20, items: [{id:'a', name:'A', start: 32400, duration: 600}, {id:'z', name:'End', start: 36000, duration: null, cancelled: true}]});
      const csv = C.toCSV({perItem: 20, items: [{id:'a', name:'A', start: null, duration: 600}, {id:'b', name:'B', start: null, duration: 900, cancelled: true}]});
      const back = C.parseText(csv).items.map(x => [x.id, !!x.cancelled, x.duration]);
      const plain = C.toCSV({perItem: 20, items: [{id:'a', name:'A', start: null, duration: 600}]}).split('\\r\\n')[0];
      return { timed: timed.items.map(x => [x.id, C.formatClock(x.planned), x.eff, x.len, x.cancelled]), loose: loose.items.map(x => [x.id, x.planned, x.eff]),
        endMarker: end.items[1].cancelled, csv: csv.split('\\r\\n')[0], back, plain,
        std: C.standardise({perItem: 20, items: [{id:'b', name:'B', start: null, duration: 900, cancelled: true}]}).items[0] };
    }""")
    check("timed sheet: a cancelled item takes no time, a row's own start stays (a gap)", core["timed"], [
        ["a", "09:00", 1800, 1800, False], ["b", "09:30", 0, 1800, True], ["c", "09:30", 600, 600, False], ["d", "11:00", 0, 600, True], ["e", "11:00", 600, 600, False]])
    check("sheet without times: the rows after it move up", core["loose"], [["a", 0, 1200], ["b", 1200, 0], ["c", 1200, 1200]])
    check("the finish marker can't be cancelled", core["endMarker"], False)
    check("CSV header with a cancelled item", core["csv"], "Start,Name,Duration,Id,Cancelled")
    check("CSV read back", core["back"], [["a", False, 600], ["b", True, 900]])
    check("CSV header without one", core["plain"], "Start,Name,Duration,Id")
    check("standardise keeps its own length", (core["std"]["duration"], core["std"].get("cancelled")), (900, True))

    sheet = lambda: e.evaluate("JSON.parse(localStorage.runsheet).items")
    row = lambda id: f'#rs-table tr[data-id="{id}"]'

    # Cancel Keynote in the editor: dimmed, flagged, skipped
    e.click(row("b") + " button[data-act=cancel]"); e.wait_for_timeout(600)
    check("cancel saved", [bool(x.get("cancelled")) for x in sheet()], [False, True, False, False])
    check("row dimmed", e.evaluate(f"document.querySelector('{row('b')}').classList.contains('cancelledrow')"), True)
    check("status", e.text_content(row("b") + " td.status").strip(), "✕ cancelled")
    check("▶ refused on it", e.evaluate(f"document.querySelector('{row('b')} button.go').disabled"), True)
    check("its own length still shown", e.input_value(row("b") + " [data-field=duration]"), "30 min")

    t.wait_for_timeout(600)
    check("timer: goTo a cancelled item refused", t.evaluate("runsheet.goTo('b')"), False)
    t.evaluate("runsheet.next()"); t.wait_for_timeout(800)
    check("Next starts Welcome", t.evaluate("JSON.parse(localStorage.runsheet_state).currentId"), "a")
    lst = t.evaluate("(() => { let v = null; const prev = window.timerAPI; window.timerAPI = { send(m) { if (prev && prev.send) prev.send(m); if (m.setVariableValues && 'rs_list' in m.setVariableValues) v = m.setVariableValues; } }; runsheet.announce(true); window.timerAPI = prev; return v; })()")
    check("next skips the cancelled item", lst["rs_next"], "Panel")
    rows = json.loads(lst["rs_list"])["rows"]
    check("the phones' list flags it", [(r["n"], r.get("c"), r.get("d")) for r in rows], [("Welcome", None, "10 min"), ("Keynote", 1, "30 min"), ("Panel", None, "20 min"), ("Close", None, "5 min")])
    e.wait_for_timeout(1200)
    check("editor: the live item can't be cancelled", e.evaluate(f"document.querySelector('{row('a')} button[data-act=cancel]').disabled"), True)
    check("editor: next is Panel", e.evaluate("document.querySelector('#rs-table tr.next')?.dataset.id"), "c")

    # Reinstate it (management got it wrong): Next goes to it again
    e.click(row("b") + " button[data-act=cancel]"); e.wait_for_timeout(1000)
    check("reinstated", [bool(x.get("cancelled")) for x in sheet()], [False, False, False, False])
    t.evaluate("runsheet.next()"); t.wait_for_timeout(800)
    check("Next starts Keynote", t.evaluate("JSON.parse(localStorage.runsheet_state).currentId"), "b")
    e.wait_for_timeout(1200)
    check("editor: an item that has run can't be cancelled", e.evaluate(f"document.querySelector('{row('a')} button[data-act=cancel]').disabled"), True)

    # Cancel the next item (Panel) while Keynote runs: Next goes to Close
    e.click(row("c") + " button[data-act=cancel]"); e.wait_for_timeout(1000)
    t.evaluate("runsheet.next()"); t.wait_for_timeout(800)
    check("Next skips the cancelled Panel", t.evaluate("JSON.parse(localStorage.runsheet_state).currentId"), "d")

    # Export CSV from the editor: the column is there
    with e.expect_download() as dl: e.evaluate("document.getElementById('csv-export').click()")
    csv = open(dl.value.path(), encoding="utf-8").read().splitlines()
    check("editor CSV", (csv[0], csv[3].split(",")[-1]), ("Start,Name,Duration,Id,Cancelled", "yes"))
    b.close()
print("errors:", errs)
