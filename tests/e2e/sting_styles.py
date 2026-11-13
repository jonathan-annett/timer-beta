import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Music styles of a sting (sting-styles.js, sting-styles-worker.js): our spectrogram against Essentia's own
# (TensorflowInputMusiCNN) on the same samples, and the whole pipeline (decode at 16 kHz, the spectrogram,
# MTG's Discogs-EffNet in onnxruntime-web, the mean of the patches) against Essentia + the same model, on a
# made-up 16 kHz piece (_styles_signal.py: no resampling, so the samples are exactly Essentia's). The
# reference is media/sting_styles_ref.json (made once with Essentia). The model and onnxruntime-web are in
# .models/ (npm run test:setup); the CDN is served from there, so it runs offline.
import base64, json, mimetypes, os, sys
from playwright.sync_api import sync_playwright
from _styles_signal import wav_bytes
BASE = "https://timer.sophtwhere.com/beta/"
MODELS = os.path.join(HERE, ".models")
ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/"
REF = json.load(open(os.path.join(HERE, "media", "sting_styles_ref.json")))
if not os.path.isfile(os.path.join(MODELS, "discogs-effnet-bsdynamic-1.onnx")):
    print("FAIL the model isn't in tests/e2e/.models: run npm run test:setup"); sys.exit(1)
PAGE = b'<!doctype html><script src="sting-styles-worker.js"></script><script src="sting-styles.js"></script>'
def h(route, req):
    u = req.url
    if u.startswith(ORT):
        fp = os.path.join(MODELS, "ort", u[len(ORT):].split("?")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": "application/wasm" if fp.endswith(".wasm") else "text/javascript"})
        return route.fulfill(status=404, body=b"")
    if not u.startswith(BASE): return route.abort()
    name = u[len(BASE):].split("?")[0]
    if name == "styles.html": return route.fulfill(status=200, body=PAGE, headers={"content-type": "text/html"})
    if name.startswith("models/"): return route.fulfill(status=200, body=open(os.path.join(MODELS, name[7:]), "rb").read(), headers={"content-type": "application/octet-stream"})
    fp = os.path.join(PUBLIC, name)
    if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
    return route.fulfill(status=404, body=b"")
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server"])
    pg = b.new_context(ignore_https_errors=True).new_page(); pg.route("**/*", h)
    pg.on("pageerror", lambda e: errs.append("page: " + str(e)))
    pg.goto(BASE + "styles.html"); pg.wait_for_timeout(300)
    wav = base64.b64encode(wav_bytes()).decode()
    pg.evaluate("b64 => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); window.__wav = new Blob([a], { type: 'audio/wav' }); }", wav)

    # the spectrogram, on the samples Essentia read
    m = pg.evaluate("""async rows => {
      const ab = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await __wav.arrayBuffer());
      const { mel, frames } = melFrames(ab.getChannelData(0));
      let sum = 0; for (const v of mel) sum += v;
      return { samples: ab.length, frames, sum, rows: Object.fromEntries(rows.map(r => [r, Array.from(mel.subarray(r * 96, r * 96 + 96))])) };
    }""", [int(r) for r in REF["melRows"]])
    worst = max(abs(a - c) for r, row in REF["melRows"].items() for a, c in zip(m["rows"][r], row))
    check("the same samples as Essentia read (16 kHz, no resampling)", m["samples"] == REF["samples"], m["samples"])
    check("our spectrogram: Essentia's frames (zero-centred, one past the end)", m["frames"] == REF["frames"], [m["frames"], REF["frames"]])
    check("… the same values (first, middle and last frames within 0.0005)", worst < 5e-4, worst)
    check("… all of it (the sum within 0.001 %)", abs(m["sum"] - REF["melSum"]) / REF["melSum"] < 1e-5, [m["sum"], REF["melSum"]])

    # the whole pipeline
    r = pg.evaluate("async () => { const r = await StingStyles.analyse(__wav); return { scores: Array.from(r.scores), patches: r.patches, seconds: r.seconds }; }")
    diff = max(abs(a - c) for a, c in zip(r["scores"], REF["scores"]))
    top = lambda s: sorted(range(400), key=lambda i: -s[i])[:10]
    check("Discogs-EffNet in the browser: Essentia's patches (128 frames every 62)", r["patches"] == REF["patches"], [r["patches"], REF["patches"]])
    check("… its 400 scores within 0.002 of Essentia + the same model", diff < 0.002, diff)
    check("… the same top 10, in order", top(r["scores"]) == top(REF["scores"]), [top(r["scores"]), top(REF["scores"])])
    check("… 8 seconds", abs(r["seconds"] - 8) < 0.01, r["seconds"])

    # tags, search, storage
    t = pg.evaluate("""() => {
      const s = new Float32Array(400), i = StingStyles.LABELS.indexOf('Rock---Hard Rock'), j = StingStyles.LABELS.indexOf('Electronic---Disco'), k = StingStyles.LABELS.indexOf('Funk / Soul---Disco');
      s[i] = 0.42; s[j] = 0.12; s[k] = 0.31; s[5] = 0.05;
      const c = StingStyles.compact(s, 3), back = StingStyles.expand(c);
      return { hard: StingStyles.match(s, 'hard rock'), rock: StingStyles.match(s, 'Rock'), disco: StingStyles.match(s, 'disco'), none: StingStyles.match(s, 'polka'),
        tags: StingStyles.tags(s).map(x => x.style + ' ' + x.genre), c, back: [back[i], back[k], back[j], back[5]], i, k };
    }""")
    check("search: every word in 'genre style' ('hard rock')", t["hard"] == {"i": t["i"], "score": t["hard"]["score"]} and abs(t["hard"]["score"] - 0.42) < 1e-6, t["hard"])
    check("… a genre word finds its styles ('Rock'); the best of a name under two genres ('disco')", t["rock"]["i"] == t["i"] and t["disco"]["i"] == t["k"], [t["rock"], t["disco"]])
    check("… a style it doesn't have scores 0", t["none"]["score"] == 0, t["none"])
    check("tags: at or above 0.1, strongest first", t["tags"] == ["Hard Rock Rock", "Disco Funk / Soul", "Disco Electronic"], t["tags"])
    check("compact (kept with a sting) and back", [x[1] for x in t["c"]] == [0.42, 0.31, 0.12] and [round(x, 3) for x in t["back"]] == [0.42, 0.31, 0.12, 0.0], [t["c"], t["back"]])
    short = pg.evaluate("""async () => { const a = new OfflineAudioContext(1, 8000, 16000), buf = a.createBuffer(1, 8000, 16000);
      const n = 8000, d = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
      d.setUint32(24, 16000, true); d.setUint32(28, 32000, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, n * 2, true);
      try { await StingStyles.analyse(new Blob([d.buffer], { type: 'audio/wav' })); return 'no error'; } catch (e) { return e.message; } }""")
    check("under a second: says it's too short", "Too short" in short, short)
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
