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
import os, mimetypes, json
from playwright.sync_api import sync_playwright
WAV=os.path.join(HERE, "media", "speech.wav")
# The stand-in transcriber: "ready" at once, then for each phrase its length and one chunk at 0.2 s
STUB=b'''let n = 0;
self.onmessage = ev => {
  const m = ev.data || {};
  if (m.t === 'load') { self.postMessage({ t: 'progress', p: { status: 'progress', file: 'x', loaded: 5, total: 10 } }); setTimeout(() => self.postMessage({ t: 'ready' }), 300); }
  else if (m.t === 'run') self.postMessage({ t: 'result', text: 'x', chunks: [{ text: 'Phrase ' + (++n) + ' of ' + (m.audio.length / 16000).toFixed(1) + ' s', timestamp: [0.2, 1] }] });
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
    c=b.new_context(ignore_https_errors=True, viewport={"width":1280,"height":800})
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
    a_ctx=b.new_context(ignore_https_errors=True, viewport={"width":1100,"height":900}, permissions=["microphone"]); a_ctx.route("**/*",h)
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
    print("mics:", a.evaluate("[...document.querySelectorAll('#mic option')].map(o=>o.textContent)"))
    rows=a.evaluate("[...document.querySelectorAll('#log .ln[data-i]')].map(r=>r.querySelector('.t').textContent+' '+r.querySelector('.o').textContent+' '+r.querySelector('.x span').textContent+(r.querySelector('button.play')?' ▶':''))")
    print("lines:", len(rows)); [print("  ", r) for r in rows[:6]]
    # Lines are timed by the recording: a phrase starts 0.3 s before the voice, plus the chunk's 0.2 s.
    # The file loops every 13.96 s, so the same phrase a loop later is 13.96 s on
    a.wait_for_timeout(5500)   # the transcript goes to IndexedDB in bursts
    ats=a.evaluate("new Promise(r=>{const q=indexedDB.open('assist');q.onsuccess=()=>{const g=q.result.transaction('lines').objectStore('lines').getAll();g.onsuccess=()=>r(g.result.map(l=>l.at).sort((x,y)=>x-y))}})")
    loops=[round((ats[i+3]-ats[i])/1000,2) for i in range(len(ats)-3)]
    print("same phrase one loop later (s):", loops[:4], "| file length 13.96")
    print("hear the start shown:", a.is_visible("#hearstart"), "|", a.text_content("#started"))
    a.click("#hearstart"); a.wait_for_timeout(300)
    print("play a line:", a.evaluate("(()=>{const b=document.querySelector('#log button.play'); b.click(); return !!b})()"), "| status after:", a.text_content("#asrstate")[:60])
    s0=t.evaluate("processTimerApiMessage({cmd:'snapshot'}).startedAt")
    a.click("#log .ln[data-i='1']"); a.click("#log .ln.armed button[data-act=move]"); a.wait_for_timeout(1500)
    s1=t.evaluate("processTimerApiMessage({cmd:'snapshot'}).startedAt")
    print("moved to line 2: start +%.1f s | line now:" % ((s1-s0)/1000), a.text_content("#log .ln[data-i='1'] .o"))
    a.click("#listen"); a.wait_for_timeout(500)
    print("stopped:", a.text_content("#listenstate"), "| level:", a.evaluate("document.getElementById('level').style.width"))
    a.screenshot(path=OUT+"/assist_audio.png")
    b.close()
print("errors:", errs)
