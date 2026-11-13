import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# The clip editor from the keys (the owner, 14 Nov 2026: cut clips with the deck while looking at the screen; a phone
# for those without a Stream Deck). While the clip editor is open on the playout page (✂ on a cue), every board shows
# its keys instead of the items (the page's keys here; real decks and phones the same): ▶ Part and the other plays,
# ■, Mark start / Mark end, the edges nudged by a step (0.01 / 0.1 / 1 s), Save, Cancel. MK.2, XL and Mini (two
# pages) by hand, other sizes in order. A phone set to Clip editor keys gets a grid that fits it and keeps the editor's
# keys, dim while no editor is open. On the demo, against the local pairing server (server.sh).
import mimetypes, os
from playwright.sync_api import sync_playwright
SERVER = os.environ.get('E2E_SERVER', 'wss://localhost:8443/')
BASE = "https://timer.sophtwhere.com/beta/"
SETUP = """async () => {                     // the first speaker: a 30 s tone at the start
  const wav = sec => { const sr = 8000, n = sr * sec, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / sr) * 8000, true);
    return new Blob([b], { type: 'audio/wav' }); };
  localStorage.playout_demo_cues = JSON.stringify({ 'demo-1': [{ id: 'c1', name: 'Tone', media: 'audio', src: 'file', trigger: 'start', at: 0, duration: 30 }] });
  await videoStore.put('pocue:c1', wav(30));
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
    c.add_init_script("window.TimerFeatures = { playout: true }; localStorage.playout_deck_model = 'mk2';")
    c.route("**/*", h)
    po = c.new_page(); po.on("pageerror", lambda e: errs.append("playout: " + str(e)))
    po.goto(BASE + "playout.html?demo&remote=" + SERVER); po.wait_for_timeout(800)
    po.evaluate(SETUP); po.reload(); po.wait_for_timeout(1500)
    faces = lambda m="mk2", pg=0: po.evaluate("window.__playoutDeck.faces(%r, %d)" % (m, pg))
    body = lambda m="mk2", pg=0: [x.split(" | ")[0] for x in faces(m, pg)]
    st = lambda: po.evaluate("StingClip.editing() && StingClip.editing().state()")
    press = lambda i: (po.evaluate("window.__playoutDeck.screen(%d, true)" % i), po.evaluate("window.__playoutDeck.screen(%d, false)" % i), po.wait_for_timeout(250))

    # a phone set to Clip editor keys, paired before any editor is open
    po.click("#phoneshow"); po.wait_for_timeout(1500)
    link = po.evaluate("window.__playoutDeck.phoneLink()")
    pc = b.new_context(ignore_https_errors=True, viewport={"width": 390, "height": 760}, is_mobile=True, has_touch=True)
    pc.route("**/*", h)
    ph = pc.new_page(); ph.on("pageerror", lambda e: errs.append("phone: " + str(e)))
    ph.goto(link); ph.wait_for_timeout(2500)
    po.fill("#ph-pending .ph-pin", ph.text_content("#pincode")); po.wait_for_timeout(1500)
    ph.select_option("#model", "edit"); ph.wait_for_timeout(1500)   # (its menu: Clip editor keys)
    pm = ph.evaluate("window.__pphone.model()")
    check("a phone set to Clip editor keys: the editor's 17 keys as big as they fit (3 × 6 on a 390 × 760 phone)", ph.evaluate("window.__pphone.ok()") and ph.evaluate("window.__pphone.editor()") and pm == "c3x6"
          and ph.input_value("#model") == "edit" and po.evaluate("window.__playoutDeck.phones()[0].model") == pm, [pm, ph.input_value("#model")])
    pf = ph.evaluate("window.__pphone.faces()")
    check("… no editor open: the editor's keys, dim", pf[0] == "▶ Part | play" and ph.evaluate("window.__pphone.bgs()[0]") == "#0d0d0d" and "Save | clip" in pf, pf[:4])

    check("before: the page's keys are the items", body()[0] == po.evaluate("window.__playout.show().items[0].n"), body()[:3])

    # ✂ on the cue: the editor, and every board shows its keys
    po.click('#items li[data-id="demo-1"] li[data-cue="c1"] button[data-act=edit]'); po.wait_for_timeout(2500)
    check("✂: the clip editor open, driven from here", st() is not None and st()["ready"], st())
    check("the MK.2 keys: plays, nudges, Mark, Cancel, Save", body() == ["▶ Part", "First 2 s", "Last 2 s", "Play on", "■ Stop", "−", "+", "0.1 s", "−", "+", "Start", "End", "2 s before", "Cancel", "Save"], body())
    xl = body("xl")
    check("the XL: the play row, the nudges with the times, Cancel and Save in the corner", xl[:8] == ["▶ Part", "First 2 s", "Last 2 s", "2 s before", "Play on", "■ Stop", "Start", "End"] and xl[10] == "0:00.00" and xl[30:] == ["Cancel", "Save"], xl)
    check("the Mini: ▶, Mark start / end, Cancel, Save, more ▶", body("mini") == ["▶ Part", "Start", "End", "Cancel", "Save", "more ▶"], body("mini"))
    check("a 3 × 3 grid: in order, with more ▶", body("c3x3")[:8] == ["▶ Part", "First 2 s", "Last 2 s", "2 s before", "Play on", "■ Stop", "Start", "End"] and body("c3x3")[8] == "more ▶", body("c3x3"))
    ph.wait_for_timeout(800)
    check("the phone: lit now, the same keys", ph.evaluate("window.__pphone.bgs()[0]") != "#0d0d0d" and ph.evaluate("window.__pphone.faces()")[0] == "▶ Part | play", ph.evaluate("window.__pphone.bgs().slice(0, 2)"))

    # nudges by the step; the step changes
    press(6); press(6)
    check("start + twice: 0.2 s", abs(st()["start"] - 0.2) < 0.001 and st()["active"] == "start", st())
    press(7); press(6)
    check("the step key: 1 s, then start + : 1.2 s", st()["step"] == 1 and abs(st()["start"] - 1.2) < 0.001, st())
    press(8)
    check("end −: a second off the end (29 s)", abs(st()["end"] - 29) < 0.001 and st()["active"] == "end", st())
    check("… the XL shows the times", body("xl")[10] == "0:01.20" and body("xl")[12] == "0:29.00", [body("xl")[10], body("xl")[12]])

    # Mark keys only while playing; ▶ Part plays, ■ stops
    check("Mark start / End dim until something plays", not po.evaluate("window.__playoutDeck.face('mk2', 0, 10).press"))
    press(0); po.wait_for_timeout(600)
    check("▶ Part: it plays", st()["playing"] and po.evaluate("window.__playoutDeck.face('mk2', 0, 10).press"), st())
    press(4)
    check("■ Stop", not st()["playing"], st())

    # from the phone: Play on, Mark start as it plays
    keys = ph.evaluate("window.__pphone.faces()")
    pkey = lambda name: [k.split(" | ")[0] for k in keys].index(name)
    tap = lambda i: (ph.evaluate("([i, t]) => document.querySelectorAll('#keys canvas')[i].dispatchEvent(new PointerEvent(t, { pointerId: 7, bubbles: true }))", [i, "pointerdown"]),
                     ph.evaluate("([i, t]) => document.querySelectorAll('#keys canvas')[i].dispatchEvent(new PointerEvent(t, { pointerId: 7, bubbles: true }))", [i, "pointerup"]))
    tap(pkey("Play on")); po.wait_for_timeout(3500)
    tap(pkey("Start")); po.wait_for_timeout(500)
    s = st()
    check("the phone: Play on, then Mark start as it plays (start moved to where it was, less half a second)", s["playing"] and 1.5 < s["start"] < 3.5, s)
    tap(pkey("■ Stop")); po.wait_for_timeout(300)

    # Save from the keys: the cue keeps the clip; the keys go back to the items
    start = st()["start"]
    press(14); po.wait_for_timeout(800)
    cue = po.evaluate("window.__playout.cues()['demo-1'][0]")
    check("Save: the editor closes, the cue has its clip", po.evaluate("StingClip.editing()") is None and abs((cue.get("start") or 0) - start) < 0.01 and abs((cue.get("end") or 0) - 29) < 0.01, [cue.get("start"), cue.get("end")])
    check("… the page's keys back to the items", body()[0] == po.evaluate("window.__playout.show().items[0].n"), body()[:3])
    ph.wait_for_timeout(800)
    check("… the phone back to dim", ph.evaluate("window.__pphone.bgs()[0]") == "#0d0d0d")

    # something playing, no editor open: the phone is the rehearsal transport
    po.evaluate("window.__playout.play('c1')"); po.wait_for_timeout(1500)
    tf = lambda: [k.split(" | ")[0] for k in ph.evaluate("window.__pphone.faces()")]
    check("a cue playing: the phone shows the rehearsal transport", tf()[:9] == ["Tone", "0:01", "⏸ Pause", "−10 s", "⟲ Restart", "+10 s", "⏭ Last 10 s", "✂ Edit", "■ Stop"], tf()[:9])
    tpo = lambda: po.evaluate("window.__playout.transport()")
    tap(2); po.wait_for_timeout(600)
    check("⏸ from the phone: paused there, its key says Resume", tpo()["paused"] and tf()[2] == "▶ Resume", [tpo(), tf()[2]])
    tap(5); po.wait_for_timeout(400)
    check("+10 s from the phone", 10.5 < tpo()["pos"] < 12.5, tpo())
    tap(3); po.wait_for_timeout(400)
    check("−10 s from the phone", tpo()["pos"] < 2.5, tpo())
    tap(6); po.wait_for_timeout(600)
    check("⏭ Last 10 s, its clock on the key", abs(tpo()["len"] - tpo()["pos"] - 10) < 0.6 and tf()[1] == "0:%02d" % int(tpo()["pos"]), [tpo(), tf()[1]])
    tap(2); po.wait_for_timeout(400)
    tap(7); po.wait_for_timeout(2500)
    check("✂ Edit from the phone: paused, the clip editor open, the phone has its keys", tpo()["paused"] and po.evaluate("StingClip.editing() !== null")
          and ph.evaluate("window.__pphone.faces()")[0] == "▶ Part | play", [tpo(), ph.evaluate("window.__pphone.faces()")[0]])
    check("… its item outlined on the page (the last one worked on)", po.evaluate("document.querySelector('#items li[data-id=\"demo-1\"]').classList.contains('recent')"))
    po.evaluate("StingClip.editing().act('cancel')"); po.wait_for_timeout(800)
    check("… closed: the transport again (still paused)", tf()[2] == "▶ Resume", tf()[:3])
    ph.evaluate("([i, t]) => document.querySelectorAll('#keys canvas')[i].dispatchEvent(new PointerEvent(t, { pointerId: 7, bubbles: true }))", [8, "pointerdown"]); po.wait_for_timeout(300)
    ph.evaluate("([i, t]) => document.querySelectorAll('#keys canvas')[i].dispatchEvent(new PointerEvent(t, { pointerId: 7, bubbles: true }))", [8, "pointerup"]); po.wait_for_timeout(120)
    check("… its key flashes white as it stops it", po.evaluate("window.__playoutDeck.phoneFace(0, 8)") == ["#fff", "#000"], po.evaluate("window.__playoutDeck.phoneFace(0, 8)"))
    po.wait_for_timeout(600)
    check("■ Stop from the phone: over, the phone dim again", po.evaluate("window.__playout.playing()") == [] and ph.evaluate("window.__pphone.bgs()[0]") == "#0d0d0d", po.evaluate("window.__playout.playing()"))

    # Cancel from the Mini's keys (and its second page)
    po.click('#items li[data-id="demo-1"] li[data-cue="c1"] button[data-act=edit]'); po.wait_for_timeout(2500)
    po.evaluate("localStorage.playout_deck_model = 'mini'")
    pressm = lambda i: (po.evaluate("window.__playoutDeck.screen(%d, true)" % i), po.evaluate("window.__playoutDeck.screen(%d, false)" % i), po.wait_for_timeout(250))
    po.select_option("#deckmodel", "mini"); po.wait_for_timeout(300)
    pressm(5)
    check("the Mini: more ▶, the nudges", body("mini") == ["−", "+", "0.1 s", "−", "+", "◀ back"], body("mini"))
    pressm(5); pressm(3)
    check("◀ back, then Cancel: closed, the cue as it was", po.evaluate("StingClip.editing()") is None and abs(po.evaluate("window.__playout.cues()['demo-1'][0].start") - start) < 0.01)
    ph.screenshot(path=os.path.join(OUTDIR, "playout_clipdeck_phone.png"))

    # the item keys: orange while their audio fades, whatever started it; a release that stops it flashes white
    po.select_option("#deckmodel", "mk2"); po.wait_for_timeout(300)
    bg0 = lambda: po.evaluate("window.__playoutDeck.face('mk2', 0, 0).bg")
    press(0); po.wait_for_timeout(1200)
    check("an item started from its key: green", bg0() == "#7a5c00" or bg0() == "#13602a", bg0())
    po.click("#fadeall"); po.wait_for_timeout(300)
    check("Fade out (no key held): its key orange while it fades", bg0() == "#9a5200", bg0())
    po.wait_for_timeout(3500)
    if po.evaluate("window.__playout.local()"): press(0)   # (faded out, still started here: a press ends that first)
    press(0); po.wait_for_timeout(1200)
    po.evaluate("window.__playoutDeck.screen(0, true)"); po.wait_for_timeout(400)
    check("held: orange", bg0() == "#9a5200", bg0())
    po.evaluate("window.__playoutDeck.screen(0, false)"); po.wait_for_timeout(100)
    f = po.evaluate("window.__playoutDeck.face('mk2', 0, 0)")
    check("let go: stopped, the key flashes black on white", po.evaluate("window.__playout.playing()") == [] and f["bg"] == "#fff" and f["fg"] == "#000", f)
    po.wait_for_timeout(500)
    check("… then its colour again", bg0() not in ("#fff", "#9a5200"), bg0())
    b.close()
print("errors:", errs)
