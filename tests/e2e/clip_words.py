import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Transcribe and find words in the clip editor (clip-words.js; a trial: TimerFeatures.transcribe). A stand-in for
# the speech worker (assist-asr.js) answers each piece it's sent ("This is part n"; the second: "Please welcome our
# keynote speaker"), so it runs offline. The track: tone with quiet gaps where the pieces should be cut, and a long
# silence that isn't sent at all. Lines with their times; Find words; ▶ plays from a line (the close-up there);
# Start / End set the clip's edges; Enter in the box doesn't save, Esc clears it first; the transcript is kept for
# the file and shown next time without the model; without the trial, nothing.
import io, math, mimetypes, os, struct, sys, wave, base64
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
FAKE_ASR = b"""let n = 0;
self.onmessage = e => {
  const m = e.data || {};
  if (m.t === 'load') { self.postMessage({ t: 'progress', p: { status: 'progress', file: 'model', loaded: 50, total: 100 } }); self.postMessage({ t: 'ready' }); }
  else if (m.t === 'run') {
    n++;
    const said = n === 2 ? ' Please welcome our keynote speaker.' : ' This is part ' + n + '.';
    self.postMessage({ t: 'result', text: said, chunks: [{ text: said, timestamp: [1, 4] }, { text: ' [BLANK_AUDIO]', timestamp: [4, 5] }] });
  }
};"""
def track():                                       # tone 0–27, quiet 27–28.5, tone –55, silence –84.5, tone –95 (8 kHz)
    sr, out = 8000, []
    for i in range(95 * sr):
        t = i / sr
        on = t < 27 or 28.5 <= t < 55 or t >= 84.5
        out.append(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 300 * t)) if on else 0))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(b"".join(out))
    return buf.getvalue()
WAV = base64.b64encode(track()).decode()
def h(route, req):
    u = req.url
    if not u.startswith(BASE): return route.abort()
    name = u[len(BASE):].split("?")[0].split("#")[0]
    if name == "assist-asr.js": return route.fulfill(status=200, body=FAKE_ASR, headers={"content-type": "text/javascript"})
    if name in ("changelog.html", "stock-stings.json"): return route.fulfill(status=404, body=b"")
    fp = os.path.join(PUBLIC, name)
    if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
    return route.fulfill(status=404, body=b"")
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)
OPEN = """b64 => { const f = new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'Talk.wav', { type: 'audio/wav' });
  window.__clip = StingClip.open({ src: f, name: 'Talk', media: 'audio' }); }"""
COUNT = "(() => { const W = window.Worker; window.__workers = 0; window.Worker = class extends W { constructor(...a) { super(...a); window.__workers++; } }; })();"

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"])
    def page(on):
        c = b.new_context(ignore_https_errors=True, viewport={"width": 1200, "height": 900})
        c.add_init_script("window.TimerFeatures = { playout: true, stings: true, transcribe: %s };" % ("true" if on else "false"))
        c.add_init_script(COUNT)
        c.route("**/*", h)
        pg = c.new_page(); pg.on("pageerror", lambda e: errs.append("page: " + str(e)))
        pg.goto(BASE + "stings.html"); pg.wait_for_timeout(800)
        return pg
    pg = page(True)
    pg.evaluate(OPEN, WAV); pg.wait_for_timeout(1500)
    check("the clip editor: Transcribe under the play buttons (the trial)", pg.is_visible(".sc-words .cw-go") and pg.is_hidden(".cw-find"))
    pg.click(".cw-go")
    pg.wait_for_function("document.querySelector('.cw-note').textContent.includes('lines')", timeout=20000)
    lines = pg.evaluate("[...document.querySelectorAll('.cw-line')].map(l => [l.querySelector('.cw-t').textContent, l.querySelector('.cw-text').textContent])")
    check("transcribed in pieces cut at the quiet gaps, the silence not sent, Whisper's [BLANK_AUDIO] dropped",
          lines == [["0:01", "This is part 1."], ["0:28", "Please welcome our keynote speaker."], ["1:20", "This is part 3."]], lines)
    check("… the note says how many lines", pg.text_content(".cw-note").startswith("3 lines"), pg.text_content(".cw-note"))
    pg.fill(".cw-find", "KEYNOTE welcome"); pg.wait_for_timeout(100)
    found = pg.evaluate("[...document.querySelectorAll('.cw-line')].map(l => l.querySelector('.cw-text').innerHTML)")
    check("Find words: every word, any case, any order; marked", found == ["Please <mark>welcome</mark> our <mark>keynote</mark> speaker."], found)
    pg.press(".cw-find", "Enter"); pg.wait_for_timeout(200)
    check("… Enter in the box doesn't save the clip", pg.is_visible(".sc-wrap"))
    at, to = pg.evaluate("[+document.querySelector('.cw-line').dataset.at, +document.querySelector('.cw-line').dataset.to]")
    check("… its time: 1 s into the piece cut in the quiet gap (27–28.5 s)", 28.0 <= at <= 29.5 and abs(to - at - 3) < 0.02, [at, to])
    pg.click(".cw-line button[data-cw=play]"); pg.wait_for_timeout(300)
    pl, zm = pg.evaluate("document.querySelector('.sc-wrap').__playing()"), pg.evaluate("document.querySelector('.sc-wrap').__zoom()")
    check("▶ on a line: plays from there, the close-up there", pl and abs(pl["from"] - at) < 0.02 and abs(zm[0] - (at - 1)) < 0.02, [pl, zm])
    pg.click(".sc-stop")
    pg.click(".cw-line button[data-cw=start]"); pg.wait_for_timeout(200)
    pg.click(".cw-line button[data-cw=end]"); pg.wait_for_timeout(200)
    t2 = lambda v: "0:%05.2f" % v
    check("Start / End: the clip's edges at the line", pg.input_value(".sc-t[data-k=start]") == t2(at) and pg.input_value(".sc-t[data-k=end]") == t2(to), [pg.input_value(".sc-t[data-k=start]"), pg.input_value(".sc-t[data-k=end]"), at, to])
    pg.screenshot(path=OUTDIR + "/clip_words.png")
    pg.focus(".cw-find"); pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    check("Esc in the box: clears it, the editor stays", pg.input_value(".cw-find") == "" and pg.is_visible(".sc-wrap") and pg.locator(".cw-line").count() == 3)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    check("… Esc again closes the editor", pg.locator(".sc-wrap").count() == 0)
    n0 = pg.evaluate("window.__workers")
    pg.evaluate(OPEN, WAV); pg.wait_for_timeout(1500)
    check("the same file again: its transcript at once, no model loaded", pg.locator(".cw-line").count() == 3 and pg.evaluate("window.__workers") == n0 and pg.text_content(".cw-go") == "Transcribe again", [pg.locator(".cw-line").count(), pg.evaluate("window.__workers"), n0])
    pg.keyboard.press("Escape")
    off = page(False)
    off.evaluate(OPEN, WAV); off.wait_for_timeout(1500)
    check("without the trial: nothing", off.is_hidden(".sc-words") and off.locator(".cw-go").count() == 0)
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
