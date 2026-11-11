import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Sound outputs (audio-out.js): the show output (the timer page: stings, the tone, the video player) and
# the preview output (the run sheet editor, the sting library, the clip editor), on Chromium's fake sound
# cards. A choice is found by its name when its id has changed; each page plays only on its own output,
# so a preview on the headphones and the show on the PA play at once; the editor's Options choose them
# (the timer follows); an output unplugged (devicechange, faked here) silences that page and says so:
# stings and the tone refused, videos muted, previews refused; back, and all is as it was.
import json, mimetypes, os, sys
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        if "changelog.html" in u: return route.fulfill(status=404, body=b"")
        fp = os.path.join(PUBLIC, u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)
ARGS = ["--no-proxy-server", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
OUT1, OUT2 = "Fake Audio Output 1", "Fake Audio Output 2"
INIT = ("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';"
        "localStorage.audio_out_show=%s;localStorage.audio_out_preview=%s}") % (json.dumps(json.dumps({"id": "stale-1", "label": OUT1})), json.dumps(json.dumps({"id": "stale-2", "label": OUT2})))
# Pretend a sound card was unplugged (or plugged back in): the list the page sees, and the event
UNPLUG = """name => { const real = navigator.mediaDevices.__real || (navigator.mediaDevices.__real = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices));
  navigator.mediaDevices.enumerateDevices = async () => (await real()).filter(d => !name || d.label !== name);
  navigator.mediaDevices.dispatchEvent(new Event('devicechange')); }"""

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 800}, permissions=["microphone"])
    c.add_init_script(INIT); c.route("**/*", h)
    t = c.new_page(); t.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    t.goto(BASE + "timer.html")
    t.wait_for_function("AudioOut.state() === 'ok'", timeout=10000)
    devs = {d["label"]: d["id"] for d in t.evaluate("AudioOut.devices()")}
    check("the fake sound cards are listed with their names", OUT1 in devs and OUT2 in devs, devs)
    sinks = lambda pg: pg.evaluate("AudioOut.sinks()")
    ctx = lambda pg: [s["label"] for s in sinks(pg) if s["kind"] == "context"]
    check("the timer page is a show page; the saved choice (a stale id) found by its name", t.evaluate("AudioOut.role") == "show" and t.evaluate("AudioOut.state()") == "ok")
    check("the line-up tone plays", t.evaluate("stingPlayer.tone(true)") is True)
    t.wait_for_timeout(300)
    check("… on the show output", ctx(t) == [OUT1], sinks(t))
    t.evaluate("window.videoPlayer.open()"); t.wait_for_timeout(800)
    vids = [s for s in sinks(t) if s["kind"] == "video"]
    check("the video player's two elements (another window: found there by name) play on the show output too", len(vids) == 2 and all(v["label"] == OUT1 and not v["muted"] for v in vids), vids)

    # The run sheet editor: a preview page, on the headphones, while the tone plays on the show's
    e = c.new_page(); e.on("pageerror", lambda x: errs.append("editor: " + str(x)))
    e.goto(BASE + "runsheet.html")
    e.wait_for_function("AudioOut.state() === 'ok'", timeout=10000)
    check("the editor is a preview page", e.evaluate("AudioOut.role") == "preview")
    e.evaluate("window.__pv = StingClip.play(StingClip.toneBuffer(-30), {loop: true})"); e.wait_for_timeout(300)
    check("a preview in the editor plays on the preview output…", ctx(e) == [OUT2] and not e.evaluate("!!window.__pv.refused"), sinks(e))
    check("… while the tone plays on in the timer, on the show output", ctx(t) == [OUT1] and t.evaluate("stingPlayer.state().audio && stingPlayer.state().audio.id") == "tone")
    e.evaluate("window.__pv.stop()")

    # The choice: the editor's Options
    e.evaluate("document.getElementById('opts').open = true"); e.wait_for_timeout(300)
    opts = e.evaluate("[...document.querySelectorAll('#ao-pick select[data-role=show] option')].map(o => o.textContent)")
    check("Options: Sound outputs, the show's choices: the default and each card", opts[0].startswith("This computer") and OUT1 in opts and OUT2 in opts, opts)
    edevs = {d["label"]: d["id"] for d in e.evaluate("AudioOut.devices()")}   # (this page's ids)
    check("… the chosen one selected, connected", e.input_value("#ao-pick select[data-role=show]") == edevs[OUT1] and "connected" in e.text_content("#ao-pick .ao-st"), e.text_content("#ao-pick .ao-st"))
    e.locator("#opts").screenshot(path=OUTDIR + "/audio_out_options.png")
    e.select_option("#ao-pick select[data-role=show]", edevs[OUT2]); t.wait_for_timeout(600)
    check("the show output changed in the editor: the timer follows at once (the video player too)", ctx(t) == [OUT2] and all(v["label"] == OUT2 for v in sinks(t) if v["kind"] == "video"), sinks(t))
    e.select_option("#ao-pick select[data-role=show]", edevs[OUT1]); t.wait_for_timeout(600)

    # The show's sound card unplugged: silenced, refused, said so; back: as it was
    t.evaluate(UNPLUG, OUT1); t.wait_for_timeout(500)
    check("show output unplugged: the timer's audio silenced (not moved to the default)", t.evaluate("AudioOut.state()") == "missing" and ctx(t) == ["none"], sinks(t))
    check("… the videos muted", all(v["muted"] for v in sinks(t) if v["kind"] == "video"))
    check("… a warning on the operator's screen", t.is_visible("#ao-warn") and OUT1 in t.text_content("#ao-warn") and "stings won’t play" in t.text_content("#ao-warn"), t.text_content("#ao-warn") if t.locator("#ao-warn").count() else None)
    t.screenshot(path=OUTDIR + "/audio_out_warning.png", clip={"x": 200, "y": 0, "width": 880, "height": 140})
    t.evaluate("stingPlayer.stop()")
    check("… the tone won't start", t.evaluate("stingPlayer.tone(true)") is False)
    check("… nor a sting", t.evaluate("stingPlayer.play({id: 'x', sting: {name: 'S', src: 'link', media: 'audio', url: 'https://example.com/s.mp3'}})") == "no-output")
    t.evaluate(UNPLUG, None); t.wait_for_timeout(500)
    check("plugged back in: routed again, the videos unmuted, the warning gone", t.evaluate("AudioOut.state()") == "ok" and ctx(t) == [OUT1]
          and not any(v["muted"] for v in sinks(t) if v["kind"] == "video") and not t.is_visible("#ao-warn"), sinks(t))

    # The headphones gone: previews refused (never onto the default, which may be the show's)
    e.evaluate(UNPLUG, OUT2); e.wait_for_timeout(500)
    check("preview output unplugged: the editor's audio silenced", e.evaluate("AudioOut.state()") == "missing" and ctx(e) == ["none"], sinks(e))
    check("… a preview is refused, and says why", e.evaluate("StingClip.preview(new Blob(['x']), {}).refused") is True and e.is_visible("#ao-toast") and "preview output" in e.text_content("#ao-toast"))
    check("… the clip editor's play too", e.evaluate("StingClip.play(StingClip.toneBuffer(-30)).refused") is True)
    check("… the timer's show output unaffected", t.evaluate("AudioOut.state()") == "ok")
    e.evaluate(UNPLUG, None); e.wait_for_timeout(500)
    check("headphones back: previews play again", e.evaluate("AudioOut.state()") == "ok" and not e.evaluate("(p => { p.stop(); return !!p.refused; })(StingClip.play(StingClip.toneBuffer(-30)))"))

    # No choice: the computer's default, as before
    e.select_option("#ao-pick select[data-role=show]", ""); t.wait_for_timeout(600)
    check("show output back to the default: the timer plays on the computer's default", t.evaluate("AudioOut.state()") == "default" and ctx(t) == ["default"], sinks(t))
    t.evaluate("stingPlayer.stop()")
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
