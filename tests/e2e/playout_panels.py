import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# The playout page's panels (panels.js; the owner, 14 Nov 2026: a long run sheet buried the Stream Deck keys and
# the output): the run sheet, Stream Deck, Output, Sound outputs and Options cards move (⠿, dragged or ↑ ↓) and
# fold (▾), kept over a reload; the run sheet's list scrolls in a box of its own (55 % of the window, or the height
# it was dragged to, kept) unless Show all items; the item started comes into the box's view.
import mimetypes, os
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
    return route.abort()   # (the demo: no pairing server)
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"])
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1100, "height": 600})
    # a cue on the last speaker, so it has ▶ Start item (its file isn't there: it needn't play)
    c.add_init_script("window.TimerFeatures = { playout: true };" +
      "if (!localStorage.__s) { localStorage.__s = 1; localStorage.playout_demo_cues = JSON.stringify({ 'demo-10': [{ id: 'z1', name: 'Walk-on', media: 'audio', src: 'file', trigger: 'start', at: 0 }] }); }")
    c.route("**/*", h)
    po = c.new_page(); po.on("pageerror", lambda e: errs.append("playout: " + str(e)))
    po.on("dialog", lambda d: d.dismiss())
    po.goto(BASE + "playout.html?demo"); po.wait_for_timeout(1200)
    order = lambda: po.evaluate("[...document.querySelectorAll('#paired > .panel')].map(p => p.dataset.panel)")
    folded = lambda n: po.evaluate("document.querySelector('.panel[data-panel=%s]').classList.contains('p-closed')" % n)
    box = lambda: po.evaluate("(() => { const e = document.getElementById('items'); return {h: e.clientHeight, sh: e.scrollHeight, top: e.scrollTop}; })()")

    check("five panels, in the page's order", order() == ["runsheet", "deck", "output", "sound", "options"], order())
    check("… each with a grip (⠿) and a fold button (▾)", po.locator(".panel > .phead > .p-grip").count() == 5 and po.locator(".panel > .phead > .p-fold").all_text_contents() == ["▾"] * 5)

    # the run sheet scrolls in its own box
    bx = box()
    check("the run sheet's list scrolls in a box of its own (55 % of the window)", bx["sh"] > bx["h"] and bx["h"] <= 600 * 0.55 + 1, bx)
    reach = po.evaluate("(() => { const i = document.getElementById('items'); return {deck: document.getElementById('deckcard').getBoundingClientRect().top, end: i.getBoundingClientRect().top + i.scrollHeight}; })()")
    check("… so the Stream Deck panel comes before the end of the list would", reach["deck"] < reach["end"], reach)

    # ▶ Start item on the last speaker: it scrolls into the box's view
    po.evaluate("document.getElementById('items').scrollTop = 0"); po.wait_for_timeout(100)
    po.evaluate("document.querySelector('#items li[data-id=\"demo-10\"] button[data-act=run]').click()"); po.wait_for_timeout(600)
    seen = po.evaluate("""(() => { const b = document.getElementById('items').getBoundingClientRect(), r = document.querySelector('#items li[data-id="demo-10"]').getBoundingClientRect();
      return {inside: r.top >= b.top - 1 && r.bottom <= b.bottom + 1, top: document.getElementById('items').scrollTop}; })()""")
    check("an item started: scrolled into the box's view", (po.evaluate("window.__playout.local()") or {}).get("item") == "demo-10" and seen["inside"] and seen["top"] > 0, [po.evaluate("window.__playout.local()"), seen])
    po.click("#stopall"); po.wait_for_timeout(300)

    # where the operator is: the item under the mouse, the last one clicked outlined (kept through redraws)
    po.hover('#items li[data-id="demo-3"] .ihead'); po.wait_for_timeout(150)
    bg = lambda id: po.evaluate("getComputedStyle(document.querySelector('#items li[data-id=\"%s\"]')).backgroundColor" % id)
    check("the item under the mouse: highlighted", bg("demo-3") != bg("demo-4"), [bg("demo-3"), bg("demo-4")])
    po.click('#items li[data-id="demo-3"] .ihead .idur'); po.wait_for_timeout(150)
    rec = lambda: po.evaluate("[...document.querySelectorAll('#items > li.recent')].map(li => li.dataset.id)")
    check("a click in an item: outlined as the last one worked on", rec() == ["demo-3"], rec())
    po.click('#items li[data-id="demo-5"] button[data-act=name]'); po.keyboard.press("Escape"); po.wait_for_timeout(300)
    check("… a button in another: the outline moves there", rec() == ["demo-5"], rec())
    po.evaluate("document.querySelector('#items li[data-id=\"demo-10\"] button[data-act=run]').click()"); po.wait_for_timeout(500)
    check("… kept when the list is drawn again", "demo-5" in rec(), rec())
    po.click("#stopall"); po.wait_for_timeout(300)

    # Show all items: the whole list, the page scrolls
    po.click("#rs-all"); po.wait_for_timeout(200)
    bx = box()
    check("Show all items: the whole list, no box", bx["sh"] <= bx["h"] + 1 and po.get_attribute("#rs-all", "aria-pressed") == "true", bx)
    po.click("#rs-all"); po.wait_for_timeout(200)
    check("… off again: the box", box()["sh"] > box()["h"])

    # sized by hand (the corner), kept
    po.evaluate("document.getElementById('items').style.height = '180px'"); po.wait_for_timeout(300)
    check("its height dragged: kept", po.evaluate("localStorage.playout_demo_items_h") == "180", po.evaluate("localStorage.playout_demo_items_h"))

    # fold the run sheet: its body hidden, the head stays
    po.evaluate("document.getElementById('items').scrollTop = 0")
    po.click(".panel[data-panel=runsheet] .p-fold"); po.wait_for_timeout(200)
    check("▾ folds a panel: its body hidden, its title row stays", folded("runsheet") and not po.is_visible("#items") and po.is_visible(".panel[data-panel=runsheet] .phead")
          and po.text_content(".panel[data-panel=runsheet] .p-fold") == "▸")
    # an item started while it's folded: scrolled to when it's unfolded (it couldn't be before)
    po.evaluate("document.querySelector('#items li[data-id=\"demo-10\"] button[data-act=run]').click()"); po.wait_for_timeout(500)
    po.click(".panel[data-panel=runsheet] .p-fold"); po.wait_for_timeout(300)
    seen = po.evaluate("""(() => { const b = document.getElementById('items').getBoundingClientRect(), r = document.querySelector('#items li[data-id="demo-10"]').getBoundingClientRect();
      return {inside: r.top >= b.top - 1 && r.bottom <= b.bottom + 1, top: document.getElementById('items').scrollTop}; })()""")
    check("an item started while the run sheet was folded: in view once it's unfolded", seen["inside"] and seen["top"] > 0, seen)
    po.click("#stopall"); po.wait_for_timeout(300)
    po.click(".panel[data-panel=runsheet] .p-fold"); po.wait_for_timeout(200)

    # drag the Output panel above the run sheet (a tall window: Playwright scrolling mid-drag loses it; a browser scrolls by itself near the edge)
    po.set_viewport_size({"width": 1100, "height": po.evaluate("document.documentElement.scrollHeight") + 40}); po.wait_for_timeout(300)
    g = po.locator(".panel[data-panel=output] .p-grip").bounding_box(); t = po.locator(".panel[data-panel=runsheet]").bounding_box()
    po.mouse.move(g["x"] + 5, g["y"] + 5); po.mouse.down(); po.mouse.move(g["x"] + 5, g["y"] - 40, steps=5); po.mouse.move(t["x"] + 40, t["y"] + 4, steps=10); po.mouse.up(); po.wait_for_timeout(300)
    check("⠿ dragged onto the top of the run sheet: Output moves above it", order()[:2] == ["output", "runsheet"], order())
    # dropped over the deck's keys (they take files of their own): still a move
    g = po.locator(".panel[data-panel=options] .p-grip").bounding_box()
    k = po.evaluate("(() => { const d = document.getElementById('deckcard').getBoundingClientRect(), c = [...document.querySelectorAll('#vdecks canvas')].map(x => x.getBoundingClientRect()).filter(r => r.top > d.top + d.height / 2)[0]; return {x: c.left + c.width / 2, y: c.top + c.height / 2}; })()")
    po.mouse.move(g["x"] + 5, g["y"] + 5); po.mouse.down(); po.mouse.move(g["x"] + 5, g["y"] - 40, steps=5); po.mouse.move(k["x"], k["y"], steps=10); po.mouse.up(); po.wait_for_timeout(300)
    check("⠿ dropped on a Stream Deck key (the deck's lower half): Options moves below the deck", order() == ["output", "runsheet", "deck", "options", "sound"], order())
    po.set_viewport_size({"width": 1100, "height": 600})

    # the keyboard: ↑ on the Stream Deck's grip
    po.focus(".panel[data-panel=deck] .p-grip"); po.keyboard.press("ArrowUp"); po.wait_for_timeout(150)
    check("⠿ focused, ↑: the Stream Deck moves up one", order() == ["output", "deck", "runsheet", "options", "sound"], order())
    check("… and the timer's keys aren't touched (still focused, nothing played)", po.evaluate("document.activeElement.classList.contains('p-grip')") and po.evaluate("window.__playout.playing()") == [])

    # a reload keeps it all
    po.reload(); po.wait_for_timeout(1200)
    check("a reload: the order kept", order() == ["output", "deck", "runsheet", "options", "sound"], order())
    check("… the run sheet still folded", folded("runsheet"))
    po.click(".panel[data-panel=runsheet] .ptitle"); po.wait_for_timeout(200)
    check("… a click on its title unfolds it, at the height it was given", not folded("runsheet") and box()["h"] == 180, box())
    keys = po.evaluate("[...document.querySelectorAll('#vdecks canvas')].map(c => c.getBoundingClientRect().width)")
    check("the Stream Deck's keys laid out (moved panels)", len(keys) > 0 and min(keys) > 20, keys[:3])

    # F with Output folded: unfolded first (a folded panel's video has no box: full screen would be black)
    po.click(".panel[data-panel=output] .p-fold"); po.wait_for_timeout(200)
    po.evaluate("document.activeElement && document.activeElement.blur()"); po.keyboard.press("f"); po.wait_for_timeout(500)
    fs = po.evaluate("({el: document.fullscreenElement && document.fullscreenElement.id, w: document.getElementById('stage').offsetWidth})")
    if fs["el"] == "stage":
        check("F with Output folded: it unfolds, and the video's full screen has a picture", not folded("output") and fs["w"] > 0, [folded("output"), fs])
        po.evaluate("document.exitFullscreen()"); po.wait_for_timeout(300)
    else: check("F with Output folded: it unfolds", not folded("output"), fs)

    # each mode keeps its own: the soundboard starts in the page's order
    po.goto(BASE + "playout.html?soundboard"); po.wait_for_timeout(1200)
    check("the soundboard keeps its own arrangement", order() == ["runsheet", "deck", "output", "sound", "options"], order())
    po.screenshot(path=os.path.join(OUTDIR, "playout_panels.png"))
    b.close()
print("errors:", errs)
