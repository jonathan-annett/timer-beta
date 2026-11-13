import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# An item's own text on the playout page (✎ on an item; on the demo, playout.html?demo): a box holding the
# item's name, one line; what's saved shows in its place, the first line as the name and the rest as notes,
# kept by item id on this computer (playout_demo_names here, apart from a real show's playout_names). The
# timer's name itself (or nothing) goes back to the timer's; a rename by the timer since is pointed out;
# an open box survives a re-render; Esc in it still fades what's playing.
import json, mimetypes, os, sys
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        name = u[len(BASE):].split("?")[0].split("#")[0]
        if name in ("changelog.html", "stock-stings.json"): return route.fulfill(status=404, body=b"")
        fp = os.path.join(PUBLIC, name)
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()   # (no pairing server: a demo needs none)
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1100, "height": 900})
    c.add_init_script("window.TimerFeatures = { playout: true };"
      "if (!localStorage.__s) { localStorage.__s = 1; localStorage.playout_demo_cues = JSON.stringify({ 'demo-9': [{ id: 'm1', name: 'Measured', media: 'audio', src: 'file', trigger: 'start', at: 0, duration: 5, lufs: -20 }] }); }")   # (a measured cue: Show has a level, so ▶ Tone)
    c.route("**/*", h)
    po = c.new_page(); po.on("pageerror", lambda e: errs.append("playout: " + str(e)))
    po.goto(BASE + "playout.html?demo"); po.wait_for_timeout(1200)
    names = [x["n"] for x in po.evaluate("window.__playout.show().items")]
    item = lambda i: '#items li[data-id="demo-%d"]' % i
    box = lambda i: item(i) + " form.iedit textarea"
    stored = lambda: json.loads(po.evaluate("localStorage.playout_demo_names || '{}'"))

    # ✎: a box with the item's name, one line
    po.click(item(2) + " button[data-act=name]"); po.wait_for_timeout(200)
    check("✎ opens a box holding the item's name, one line", po.input_value(box(2)) == names[1] and po.get_attribute(box(2), "rows") == "1", [po.input_value(box(2)), po.get_attribute(box(2), "rows")])
    check("… with the caret in it, at the end", po.evaluate("document.activeElement.matches('form.iedit textarea') && document.activeElement.selectionStart === document.activeElement.value.length"))
    po.keyboard.press("Enter"); po.keyboard.type("Bring the lapel mic"); po.keyboard.press("Enter"); po.keyboard.type("Walk-up: loud")
    check("Enter is a new line (the box grows)", po.input_value(box(2)) == names[1] + "\nBring the lapel mic\nWalk-up: loud" and po.get_attribute(box(2), "rows") == "3", [po.input_value(box(2)), po.get_attribute(box(2), "rows")])

    # Esc in the box fades what's playing (the tone here) and leaves the box as it is
    po.click('#levels .lv-row[data-out="show"] button[data-lv=tone]'); po.wait_for_timeout(300)
    check("(a line-up tone playing)", po.evaluate("window.__playout.tones()") == ["show"], po.evaluate("window.__playout.tones()"))
    po.focus(box(2)); po.keyboard.press("Escape"); po.wait_for_timeout(3600)
    check("Esc in the box: what's playing fades out", po.evaluate("window.__playout.tones()") == [], po.evaluate("window.__playout.tones()"))
    check("… and the box stays, its text kept", po.is_visible(box(2)) and po.input_value(box(2)).endswith("Walk-up: loud"))

    # the list rebuilt while the box isn't in use: the box comes back with what was typed
    po.click("h1"); po.click("#cuectl"); po.wait_for_timeout(200); po.click("#cuectl"); po.wait_for_timeout(200)
    check("a re-render keeps the open box and its text", po.is_visible(box(2)) and po.input_value(box(2)).endswith("Walk-up: loud"))

    # Ctrl+Enter saves: the first line as the name, the rest as notes
    po.focus(box(2)); po.keyboard.press("Control+Enter"); po.wait_for_timeout(200)
    check("Ctrl+Enter saves and closes the box", po.locator(item(2) + " form.iedit").count() == 0)
    check("… the first line shown as the name", po.text_content(item(2) + " .iname") == names[1], po.text_content(item(2) + " .iname"))
    check("… the rest as notes under it", po.text_content(item(2) + " .inotes") == "Bring the lapel mic\nWalk-up: loud" and po.evaluate("getComputedStyle(document.querySelector('%s .inotes')).whiteSpace" % item(2)) == "pre-wrap", po.text_content(item(2) + " .inotes"))
    s = stored()
    check("… kept by item id, with the timer's name then", s.get("demo-2", {}).get("text") == names[1] + "\nBring the lapel mic\nWalk-up: loud" and s["demo-2"].get("was") == names[1], s)
    check("… nothing said about a rename", po.locator(item(2) + " .irenamed").count() == 0)

    # replaced outright (as text: nothing in it is markup); the timer's name in the tooltip
    po.click(item(3) + " button[data-act=name]"); po.wait_for_timeout(200)
    po.fill(box(3), "Panel: Q&A <b>all</b>"); po.click(item(3) + " form.iedit button.primary"); po.wait_for_timeout(200)
    check("Save: a new name instead of the timer's, shown as typed", po.text_content(item(3) + " .iname") == "Panel: Q&A <b>all</b>" and po.locator(item(3) + " .iname b").count() == 0, po.inner_html(item(3) + " .iname"))
    check("… the timer's name in its tooltip", names[2] in (po.get_attribute(item(3) + " .iname", "title") or ""), po.get_attribute(item(3) + " .iname", "title"))

    # the timer's name unchanged, and Cancel: nothing kept
    po.click(item(4) + " button[data-act=name]"); po.wait_for_timeout(200)
    check("no Use the timer's name offered for an item without text of its own", po.locator(item(4) + " form.iedit button[data-name=reset]").count() == 0)
    po.click(item(4) + " form.iedit button.primary"); po.wait_for_timeout(200)
    check("Save with the timer's name as it was: nothing kept (it follows the timer)", "demo-4" not in stored(), stored())
    po.click(item(5) + " button[data-act=name]"); po.wait_for_timeout(200); po.fill(box(5), "Not this"); po.click(item(5) + " form.iedit button[data-name=cancel]"); po.wait_for_timeout(200)
    check("Cancel: the box closes, nothing kept", po.locator(item(5) + " form.iedit").count() == 0 and "demo-5" not in stored() and po.text_content(item(5) + " .iname") == names[4])
    check("a demo's text is kept apart from a real show's", po.evaluate("localStorage.playout_names ?? null") is None)

    # a reload: still there
    po.reload(); po.wait_for_timeout(1200)
    check("a reload: the texts are still shown", po.text_content(item(2) + " .iname") == names[1] and po.text_content(item(2) + " .inotes") == "Bring the lapel mic\nWalk-up: loud" and po.text_content(item(3) + " .iname") == "Panel: Q&A <b>all</b>")

    # the timer renames the items (New speakers): the text stays, the rename is pointed out
    po.click("#demonames"); po.wait_for_timeout(300)
    fresh = [x["n"] for x in po.evaluate("window.__playout.show().items")]
    check("renamed by the timer: the text stays", po.text_content(item(2) + " .iname") == names[1], po.text_content(item(2) + " .iname"))
    check("… and the new name is pointed out", po.locator(item(2) + " .irenamed").count() == 1 and fresh[1] in po.text_content(item(2) + " .irenamed"), po.locator(item(2) + " .irenamed").all_text_contents())
    check("… an item without text just takes the new name", po.text_content(item(5) + " .iname") == fresh[4])
    po.screenshot(path=OUTDIR + "/playout_names.png")
    po.click(item(2) + " button[data-act=name]"); po.wait_for_timeout(200)
    check("✎ again: the box holds the saved text", po.input_value(box(2)) == names[1] + "\nBring the lapel mic\nWalk-up: loud" and po.get_attribute(box(2), "rows") == "3")
    po.click(item(2) + " form.iedit button.primary"); po.wait_for_timeout(200)
    check("… Save: the rename noted, no longer pointed out", po.locator(item(2) + " .irenamed").count() == 0 and stored()["demo-2"]["was"] == fresh[1], stored().get("demo-2"))

    # back to the timer's name
    po.click(item(3) + " button[data-act=name]"); po.wait_for_timeout(200)
    po.click(item(3) + " form.iedit button[data-name=reset]"); po.wait_for_timeout(200)
    check("Use the timer's name: the text goes, the timer's name is back", "demo-3" not in stored() and po.text_content(item(3) + " .iname") == fresh[2] and po.locator(item(3) + " .inotes").count() == 0, stored())
    po.click(item(2) + " button[data-act=name]"); po.wait_for_timeout(200)
    po.fill(box(2), "  \n "); po.focus(box(2)); po.keyboard.press("Control+Enter"); po.wait_for_timeout(200)
    check("saving an empty box: the timer's name again", "demo-2" not in stored() and po.text_content(item(2) + " .iname") == fresh[1], stored())

    # two boxes: opening another leaves the first open with its text
    po.click(item(6) + " button[data-act=name]"); po.wait_for_timeout(200); po.keyboard.type(" (late)")
    po.click(item(7) + " button[data-act=name]"); po.wait_for_timeout(200)
    check("✎ on another item while one box is open: both open, the first keeps its text", po.input_value(box(6)) == fresh[5] + " (late)" and po.evaluate("document.activeElement === document.querySelector('%s')" % box(7).replace("'", "\\'")), [po.input_value(box(6))])
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
