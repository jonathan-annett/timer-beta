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
    check("… the note says how many lines, and how long it took against real time", pg.text_content(".cw-note").startswith("3 lines") and "1:35 transcribed in" in pg.text_content(".cw-note") and "real time" in pg.text_content(".cw-note"), pg.text_content(".cw-note"))
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
    with pg.expect_download() as dl: pg.click(".cw-save")
    txt = open(dl.value.path()).read()
    check("Save as text: the transcript, a line each, its time then the words (named after the clip)", dl.value.suggested_filename == "Talk transcript.txt" and txt.splitlines() == ["0:01\tThis is part 1.", "0:28\tPlease welcome our keynote speaker.", "1:20\tThis is part 3."], [dl.value.suggested_filename, txt])
    pg.keyboard.press("Escape")

    # Reading a big file: a bar over the time this computer took before (clip_read_rate), the seconds counted
    m = pg.evaluate("""() => { localStorage.clip_read_rate = String(1e6);   // (1 MB a second: about a minute for this one)
      const n = 60e6, b = new ArrayBuffer(44 + n), v = new DataView(b), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n, true);
      window.__clip = StingClip.open({ src: new File([b], 'Long.wav', { type: 'audio/wav' }), name: 'Long', media: 'audio' });
      const c = document.querySelector('.sc-over'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let lit = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) lit++;
      return { msg: document.querySelector('.sc-msg').textContent, lit, h: c.height }; }""")
    pg.wait_for_timeout(2500)
    check("a big file: its size said; the bar in the waveform's place starts filling (over this computer's time for files before)", m["msg"].startswith("Reading the track (60 MB: a long file takes a while)") and m["lit"] <= 2 * m["h"], m)
    check("… then the waveform", pg.evaluate("document.querySelector('.sc-msg').textContent") == "")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)

    # A long source's waveform kept for next time: drawn at once, the edges workable while the sound is read
    BIG = """() => { const sr = 44100, n = sr * 600, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      const d = new Int16Array(b, 44); for (let i = 0; i < n; i++) d[i] = ((i % 200) - 100) * 100 * (1 + Math.floor(i / sr / 60) % 3);
      return new File([b], 'Ten minutes.wav', { type: 'audio/wav' }); }"""
    pg.evaluate("f => { window.__big = (" + BIG + ")(); window.__clip = StingClip.open({ src: window.__big, name: 'Ten minutes', media: 'audio' }); }", None)
    pg.wait_for_function("document.querySelector('.sc-msg').textContent === ''", timeout=30000); pg.wait_for_timeout(500)
    kept = pg.evaluate("videoStore.get('wave:Ten minutes.wav|' + window.__big.size).then(w => w && [w.v, w.rate, Math.round(w.dur), w.peaks.length])")
    check("a long source: its waveform kept, 100 points a second", kept == [1, 100, 600, 60000], kept)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    seen = pg.evaluate("""async () => { window.__clip = StingClip.open({ src: window.__big, name: 'Ten minutes', media: 'audio' });
      for (let i = 0; i < 100 && document.querySelector('.sc-play') && !document.querySelector('.sc-play').disabled; i++) await new Promise(r => setTimeout(r, 5));
      const c = document.querySelector('.sc-over'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let wave = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] && d[i + 2] > 200) wave++;   // (blue: the waveform drawn)
      return { playOff: document.querySelector('.sc-play').disabled, saveOff: document.querySelector('.sc-save').disabled, msg: document.querySelector('.sc-msg').textContent, wave }; }""")
    check("opened again: the waveform at once (from last time), play and Save waiting for the sound", seen["playOff"] and seen["saveOff"] and seen["wave"] > 500 and "from last time" in seen["msg"], seen)
    pg.wait_for_function("!document.querySelector('.sc-play').disabled", timeout=30000)
    check("… then the sound read: play and Save back", not pg.is_disabled(".sc-save") and pg.text_content(".sc-msg") == "")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)

    # A video's picture beside the close-up (a short video made here: MediaRecorder, a canvas and a tone)
    pg.evaluate("""async () => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d');
      const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start();
      const st = new MediaStream([...c.captureStream(30).getVideoTracks(), ...d.stream.getAudioTracks()]);
      const r = new MediaRecorder(st, { mimeType: 'video/webm' }), parts = []; r.ondataavailable = e => parts.push(e.data);
      const t0 = performance.now(), paint = () => { const s = (performance.now() - t0) / 1000; g.fillStyle = 'hsl(' + (s * 90) + ',80%,50%)'; g.fillRect(0, 0, 160, 90); if (r.state === 'recording') requestAnimationFrame(paint); };
      r.start(); paint(); await new Promise(res => setTimeout(res, 4000)); r.stop(); await new Promise(res => r.onstop = res); o.stop();
      window.__webm = new File(parts, 'Clip.webm', { type: 'video/webm' });
      window.__clip = StingClip.open({ src: window.__webm, name: 'Clip', media: 'video' }); }""")
    pg.wait_for_timeout(2500)
    vd = lambda: pg.evaluate("document.querySelector('.sc-wrap').__video()")
    check("a video: its picture beside the close-up, still on its first frame", pg.is_visible(".sc-vid") and vd()["src"] and vd()["paused"] and vd()["t"] < 0.05, vd())
    pg.click(".sc-play"); pg.wait_for_timeout(1200)
    v1 = vd(); pl = pg.evaluate("document.querySelector('.sc-wrap').__playing()")
    check("▶ Play the part: the picture plays in step with the sound", not v1["paused"] and 0.6 < v1["t"] < 2.0, [v1, pl])
    pg.click(".sc-stop"); pg.wait_for_timeout(500)
    check("■: still again, back on the start's frame", vd()["paused"] and vd()["t"] < 0.05, vd())
    pg.fill(".sc-t[data-k=end]", "0:02.50"); pg.press(".sc-t[data-k=end]", "Tab"); pg.click(".sc-t[data-k=end]"); pg.keyboard.press("ArrowUp"); pg.wait_for_timeout(800)
    check("working on the end: the picture shows the end's last frame", abs(vd()["t"] - 2.47) < 0.1, vd())
    pg.screenshot(path=OUTDIR + "/clip_video.png")
    pg.keyboard.press("Escape")
    off = page(False)
    off.evaluate(OPEN, WAV); off.wait_for_timeout(1500)
    check("without the trial: nothing", off.is_hidden(".sc-words") and off.locator(".cw-go").count() == 0)
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
