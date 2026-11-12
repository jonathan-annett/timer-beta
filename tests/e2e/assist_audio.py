import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
from _proximity import approve   # the proximity check: type each new device's number on the timer
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
# server: the assist station's own transcription (assist-audio.js): the room recorded through the
# microphone (Chromium's fake one, playing media/speech.wav on a loop) into the rolling buffer, cut
# into phrases by the voice detector and sent to the transcriber worker; each line is timed by where
# its phrase is in the recording. The real worker (assist-asr.js: Whisper, fetched from the internet)
# is replaced by a stand-in that answers at once, so this runs offline; the real thing was checked by
# hand (Whisper tiny.en / base.en on WebGPU, Nov 2026). Then: ▶ plays a line back, ▶ Hear the start
# shows once the timer's start is in the recording, and a line clicked moves the timer's start.
# Pictures (assist-video.js) from Chromium's fake camera: taken 4 a second, kept one every 10 s and
# at both ends of every pause between words (the stand-in's lines are 0.8 s long, so each phrase
# follows a pause); the rest let go once transcribed; pause rows and strips beside the lines; a
# picture enlarged; kept across a reload.
import os, mimetypes, json
from playwright.sync_api import sync_playwright
WAV=os.path.join(HERE, "media", "speech.wav")
# The stand-in transcriber: "ready" at once, then for each phrase its length and one chunk at 0.2 s;
# every second phrase gets no words with timestamps (as real Whisper did on noisy or short audio),
# so the station asks again without them and gets one plain answer
STUB=b'''let n = 0, k = 0;
self.onmessage = ev => {
  const m = ev.data || {};
  if (m.t === 'load') { self.postMessage({ t: 'progress', p: { status: 'progress', file: 'x', loaded: 5, total: 10 } }); setTimeout(() => self.postMessage({ t: 'ready' }), 300); }
  else if (m.t === 'run' && m.ts !== false && ++k % 2 === 0) self.postMessage({ t: 'result', text: '', chunks: [] });
  else if (m.t === 'run') self.postMessage({ t: 'result', text: 'x', chunks: m.ts === false ? [] : [{ text: 'Phrase ' + (++n) + ' of ' + (m.audio.length / 16000).toFixed(1) + ' s', timestamp: [0.2, 1] }],
    ...(m.ts === false ? { text: 'Phrase ' + (++n) + ' of ' + (m.audio.length / 16000).toFixed(1) + ' s, asked again' } : {}) });
};'''
ROOT=PUBLIC; OUT=OUTDIR; BASE="https://timer.sophtwhere.com/beta/"
def h(route, req):
    u=req.url
    if u.startswith(BASE):
        fp=os.path.join(ROOT,u[len(BASE):].split("?")[0].split("#")[0])
        if fp.endswith("assist-asr.js"): return route.fulfill(status=200, body=STUB, headers={"content-type":"text/javascript"})
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs=[]
ARGS=["--no-proxy-server","--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets",
      "--use-fake-ui-for-media-stream","--use-fake-device-for-media-stream","--use-file-for-fake-audio-capture="+WAV,"--autoplay-policy=no-user-gesture-required"]
with sync_playwright() as p:
    b=p.chromium.launch(args=ARGS)
    c=b.new_context(ignore_https_errors=True, viewport={"width":1280,"height":800}); c.add_init_script("window.TimerFeatures = { assist: true }")   # the assist station: an alpha-only trial (features.js)
    c.add_init_script("""if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';
      localStorage.runsheet=JSON.stringify({title:'Demo',perItem:20,items:[{id:'a',name:'Welcome',start:null,duration:600},{id:'b',name:'Keynote',start:null,duration:1800}]});
      localStorage.runsheet_state=JSON.stringify({active:true,index:-1,history:[],log:[]})}""")
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html?remote="+SERVER); t.wait_for_timeout(1500)
    t.evaluate("document.getElementById('whats-new')?.remove()")
    t.click("#btnshare"); t.wait_for_timeout(1500)
    t.click("#phone-panel .pp-pair"); t.wait_for_timeout(800)
    code=t.text_content("#phone-panel .pp-digits").replace(" ","")
    a_ctx=b.new_context(ignore_https_errors=True, viewport={"width":1100,"height":900}, permissions=["microphone","camera"]); a_ctx.route("**/*",h); a_ctx.add_init_script("window.TimerFeatures = { assist: true }")   # the assist station: an alpha-only trial (features.js)
    a_ctx.add_init_script("localStorage.assist_cam=''")   # pictures from the default camera (Chromium's fake one)
    a=a_ctx.new_page(); a.on("pageerror", lambda e: errs.append("assist: "+str(e)))
    a.goto(BASE+"assist.html?remote="+SERVER); a.wait_for_timeout(800)
    a.fill("#code", code); a.wait_for_timeout(3000)
    approve(t); a.wait_for_timeout(1500)
    print("engine:", a.evaluate("document.getElementById('engine').value"), "| models:", a.evaluate("[...document.querySelectorAll('#model option')].map(o=>o.textContent)"), "| chosen:", a.evaluate("document.getElementById('model').value"))
    print("note:", a.text_content("#srnote")[:80])
    a.click("#ask"); a.wait_for_timeout(800); t.click("#phone-panel .pp-pending button[data-act=assist-ok]"); a.wait_for_timeout(800)

    a.click("#listen"); a.wait_for_timeout(1000)
    t.evaluate("window.runsheet.next()")
    a.wait_for_timeout(18000)
    print("listening:", a.text_content("#listenstate"), "| level:", a.evaluate("document.getElementById('level').style.width"), "| status:", a.text_content("#asrstate"))
    print("pictures:", a.text_content("#camstate")[:60], "| live preview:", a.evaluate("!!document.getElementById('camview').srcObject"))
    fr=a.evaluate("window.__assistFrames()")
    print("frames kept:", len(fr["kept"]), "(grid %d, gap ends %d) | still held undecided: %d (of ~%d taken)" % (fr["kept"].count("grid"), fr["kept"].count("gap"), fr["held"], 18*4))
    print("pause rows:", a.evaluate("[...document.querySelectorAll('#log .gap')].map(g=>g.querySelector('.gl').textContent+' ['+g.querySelectorAll('img.th').length+' pictures, '+g.querySelectorAll('img.th.edge').length+' at the ends]')"))
    print("pictures beside lines:", a.evaluate("document.querySelectorAll('#log .ln img.th').length"))
    a.click("#log img.th"); a.wait_for_timeout(200)
    print("picture enlarged:", a.is_visible("#big"), "|", a.text_content("#bigcap"), "| size:", a.evaluate("[document.getElementById('bigimg').naturalWidth, document.getElementById('bigimg').naturalHeight]"))
    a.keyboard.press("Escape"); print("Esc closes:", not a.is_visible("#big"))
    print("mics:", a.evaluate("[...document.querySelectorAll('#mic option')].map(o=>o.textContent)"))
    rows=a.evaluate("[...document.querySelectorAll('#log .ln[data-i]')].map(r=>r.querySelector('.t').textContent+' '+r.querySelector('.o').textContent+' '+r.querySelector('.x span').textContent+(r.querySelector('button.play')?' ▶':''))")
    print("lines:", len(rows)); [print("  ", r) for r in rows[:6]]
    # Lines are timed by the recording: a phrase starts 0.3 s before the voice, plus the chunk's 0.2 s.
    # The file loops every 13.96 s, so the same phrase a loop later is 13.96 s on
    print("hear the start shown:", a.is_visible("#hearstart"), "|", a.text_content("#started"))
    a.click("#hearstart"); a.wait_for_timeout(300)
    print("play a line:", a.evaluate("(()=>{const b=document.querySelector('#log button.play'); b.click(); return !!b})()"), "| status after:", a.text_content("#asrstate")[:60])
    s0=t.evaluate("processTimerApiMessage({cmd:'snapshot'}).startedAt")
    # A line is armed by a click on it, but not on its pictures (they enlarge), chips or ▶. A click at the
    # row's middle landed on a picture whenever one was kept while the line was spoken (12 Nov 2026: why
    # this failed since the pictures came), and the log re-renders under the pointer as pictures arrive,
    # so the clicks go to the elements themselves: the line's time, then Move it
    a.locator("#log .ln[data-i='1'] .t").dispatch_event("click")
    a.locator("#log .ln.armed button[data-act=move]").dispatch_event("click"); a.wait_for_timeout(1500)
    s1=t.evaluate("processTimerApiMessage({cmd:'snapshot'}).startedAt")
    print("moved to line 2: start +%.1f s | line now:" % ((s1-s0)/1000), a.text_content("#log .ln[data-i='1'] .o"))
    a.click("#listen"); a.wait_for_timeout(500)
    a.click("#ledger summary"); a.wait_for_timeout(1200)
    led=a.text_content("#ledgertxt")
    print("audio accounting:"); [print("   ", l) for l in led.split("\n")[3:16]]
    print("stopped:", a.text_content("#listenstate"), "| level:", a.evaluate("document.getElementById('level').style.width"), "| camera off:", not a.evaluate("!!document.getElementById('camview').srcObject"))
    a.wait_for_timeout(5500)   # the transcript goes to IndexedDB in bursts
    ats=a.evaluate("new Promise(r=>{const q=indexedDB.open('assist');q.onsuccess=()=>{const g=q.result.transaction('lines').objectStore('lines').getAll();g.onsuccess=()=>r(g.result.map(l=>l.at).sort((x,y)=>x-y))}})")
    loops=[round((ats[i+2]-ats[i])/1000,2) for i in range(len(ats)-2)]   # two phrases a loop: the first two sentences are joined (under 2 s apart)
    print("same phrase one loop later (s):", loops[:4], "| file length 13.96")
    n=len(a.evaluate("window.__assistFrames()")["kept"]); a.reload(); a.wait_for_timeout(2500)
    print("after a reload: pictures back:", a.evaluate("document.querySelectorAll('#log img.th').length"), "of", n)
    a.screenshot(path=OUT+"/assist_audio.png")
    b.close()
print("errors:", errs)
