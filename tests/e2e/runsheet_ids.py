import os as _os  # paths: the repo's public/ folder
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
# Run sheet item ids (runsheet-core.js matchRows/freshIds, the editor's Replace sheet and Append):
# Export CSV carries an Id column; Replace sheet with a revised version keeps the items it names (by id,
# else by name, in order) with their video or sting, times from the new rows; rows that have run are
# left out mid-show; Append never repeats an id. Mismatches are added to errors.
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
STING = {"src": "stock", "media": "audio", "name": "S1", "url": BASE + "media/s1.wav", "duration": 8}
VIDEO = {"key": "rsvideo:b:1", "name": "Clip", "size": 10, "duration": 600}
SHEET = {"title": "Ids", "perItem": 20, "items": [
    {"id": "a", "name": "Welcome", "start": 32400, "duration": 600, "sting": STING},
    {"id": "b", "name": "Keynote", "start": None, "duration": 1800, "video": VIDEO, "videoIdle": "hide"},
    {"id": "c", "name": "Panel", "start": None, "duration": 2700},
    {"id": "d", "name": "Panel", "start": None, "duration": 900},
    {"id": "e", "name": "Close", "start": None, "duration": 300}]}
errs = []
def check(what, got, want):
    print(what + ":", got)
    if got != want: errs.append(f"{what}: got {got!r}, want {want!r}")

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server"]); c = b.new_context(ignore_https_errors=True, accept_downloads=True)
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.runsheet=" + json.dumps(json.dumps(SHEET)) + "}")
    c.route("**/*", h); e = c.new_page(); e.on("pageerror", lambda x: errs.append(str(x)))
    answers = []                                       # confirm() answers, in order (default: yes)
    e.on("dialog", lambda d: d.accept() if not answers or answers.pop(0) else d.dismiss())
    e.goto(BASE + "runsheet.html"); e.wait_for_timeout(1200)
    sheet = lambda: e.evaluate("JSON.parse(localStorage.runsheet).items")
    def replace(text, mode="replace"):
        e.evaluate("t => { const x = document.getElementById('imp-text'); x.value = t; }", text)
        e.evaluate("m => document.getElementById(m).click()", "imp-" + mode); e.wait_for_timeout(400)
        print("  message:", e.text_content("#imp-msg"))

    # Export CSV: Start, Name, Duration, Id
    with e.expect_download() as dl: e.evaluate("document.getElementById('csv-export').click()")
    csv = open(dl.value.path(), encoding="utf-8").read()
    print(csv)
    check("CSV header", csv.splitlines()[0], "Start,Name,Duration,Id")
    check("CSV ids", [l.split(",")[-1] for l in csv.splitlines()[1:]], ["a", "b", "c", "d", "e"])

    # A revised version from a spreadsheet: reordered, renamed, a new row without an id, a repeated id
    revised = "Start,Name,Duration,Id\n09:00,Welcome all,0:05:00,a\n09:05,Panel,0:30:00,d\n09:35,Keynote (short),0:20:00,b\n09:55,New act,10,b\n10:05,Panel,15,\n10:20,Thanks,5,\n"
    replace(revised)
    items = sheet()
    check("ids after Replace", [x["id"] for x in items][:3] + [x["id"] for x in items][4:5], ["a", "d", "b", "c"])
    check("new rows get new ids", all(x["id"] not in "abcde" for x in (items[3], items[5])), True)
    check("names and times from the new rows", [(x["name"], x["duration"]) for x in items], [("Welcome all", 300), ("Panel", 1800), ("Keynote (short)", 1200), ("New act", 600), ("Panel", 900), ("Thanks", 300)])
    check("media kept", (items[0].get("sting", {}).get("name"), items[2].get("video", {}).get("key"), items[2].get("videoIdle"), "sting" in items[3] or "video" in items[3]), ("S1", "rsvideo:b:1", "hide", False))
    check("ids unique", len({x["id"] for x in items}), len(items))

    # A pasted list (no ids): matched by name, in order
    replace("9:00 Welcome all\nPanel - 30 mins\nPanel - 15 mins\nKeynote (short)\nSomething new")
    items2 = sheet()
    check("by name", [x["id"] for x in items2][:4], ["a", "d", items[4]["id"], "b"])
    check("by name: media", (items2[0].get("sting", {}).get("name"), items2[3].get("video", {}).get("key")), ("S1", "rsvideo:b:1"))

    # Append with the same CSV: no id repeated
    replace(revised, "append")
    items3 = sheet()
    check("append: ids unique", len({x["id"] for x in items3}), len(items3))
    check("append: count", len(items3), len(items2) + 6)

    # Mid-show: Welcome has run, Keynote is on. Replace with the exported CSV: Welcome is left out (kept
    # hidden for the record), Keynote stays the live item
    e.evaluate("s => { localStorage.runsheet = JSON.stringify(s); localStorage.runsheet_state = JSON.stringify({active: true, index: 1, currentId: 'b', finished: false, history: [{}, {}], log: [{id: 'a', name: 'Welcome', actual: Date.now() - 900000, planned: null}, {id: 'b', name: 'Keynote', actual: Date.now() - 300000, planned: null}]}); }", SHEET)
    e.reload(); e.wait_for_timeout(1200)
    answers[:] = [True, False]                         # Replace: yes; also reset the show: no
    replace(csv)
    items4 = sheet()
    check("mid-show ids", [(x["id"], bool(x.get("hidden"))) for x in items4], [("a", True), ("b", False), ("c", False), ("d", False), ("e", False)])
    check("mid-show: live item keeps its video", items4[1].get("video", {}).get("key"), "rsvideo:b:1")
    b.close()
print("errors:", errs)
