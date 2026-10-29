import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
from _proximity import approve   # the proximity check: type each new device's number on the timer
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
SERVER = _os.environ.get('E2E_SERVER', 'wss://localhost:8443/')   # the pairing server (run_all.sh; wss://localhost:8787/ws = the Cloudflare Worker via wrangler dev)
import os, mimetypes, json, subprocess, threading, time, hashlib
from playwright.sync_api import sync_playwright
ROOT = PUBLIC; S = os.path.dirname(os.path.abspath(__file__)); BASE = "https://timer.sophtwhere.com/beta/"
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        fp = os.path.join(ROOT, u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
ARGS = ["--no-proxy-server", "--disable-features=WebRtcHideLocalIpsWithMdns,LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"]
errs = []
player_log = []
def run_player(link, pair, name="Stage"):
    p = subprocess.Popen(["node", f"{S}/fake_player.mjs", link, pair, name], stdout=subprocess.PIPE, text=True, env=dict(os.environ, LIFE="150000"))
    def rd():
        for line in p.stdout: player_log.append((name, json.loads(line)))
    threading.Thread(target=rd, daemon=True).start()
    return p
def cmds(name="Stage", verb=None):
    return [x[1] for x in player_log if x[0] == name and x[1][0] == 'cmd' and (verb is None or x[1][1] == verb)]
def wait(cond, secs=20, step=0.2):
    end = time.time() + secs
    while time.time() < end:
        if cond(): return True
        time.sleep(step)
    return False

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    # ── the timer ──
    c = b.new_context(ignore_https_errors=True, viewport={"width": 1280, "height": 800})
    c.add_init_script("window.TimerFeatures = { pptx: true }")   # PowerPoint: an alpha-only trial (features.js)
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';}")
    c.route("**/*", h); T = c.new_page(); T.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    T.goto(BASE + "timer.html?remote="+SERVER); T.wait_for_timeout(1200)
    sums = T.evaluate("""async () => {
      const mk = (n, seed) => { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = (i * seed + (i >> 9)) & 255; return a; };
      const d1 = mk(3500000, 7), d3 = mk(900000, 13);
      const k1 = 'rsdeck:it1:1761300000001', k3 = 'rsdeck:it3:1761300000003';
      await window.videoStore.put(k1, new Blob([d1])); await window.videoStore.put(k3, new Blob([d3]));
      const h0 = 'rsimg:it0:1761300000010', h2 = 'rsimg:it2:1761300000012';
      await window.videoStore.put(h0, new Blob([mk(200000, 3)])); await window.videoStore.put(h2, new Blob([mk(150000, 5)]));
      localStorage.runsheet = JSON.stringify({ title: 'Test', perItem: 10, items: [
        { id: 'it0', name: 'Doors open', start: null, duration: 300, holding: { key: h0, name: 'Event logo.png', size: 200000 } },
        { id: 'it1', name: 'Keynote', start: null, duration: 600, deck: { key: k1, name: 'Keynote.pptx', size: d1.length } },
        { id: 'it2', name: 'Panel', start: null, duration: 600, holding: { key: h2, name: 'break.png', size: 150000 } },
        { id: 'it3', name: 'Close', start: null, duration: 300, deck: { key: k3, name: 'slides.pptx', size: d3.length } } ] });
      window.runsheet.sheetChanged();
      const hex = async a => [...new Uint8Array(await crypto.subtle.digest('SHA-256', a))].map(x => x.toString(16).padStart(2, '0')).join('');
      return { f1: window.pptxHub.fileName({ key: k1, name: 'Keynote.pptx' }), f3: window.pptxHub.fileName({ key: k3, name: 'slides.pptx' }), h1: await hex(d1), h3: await hex(d3) };
    }""")
    print("inbox names:", sums["f1"], "|", sums["f3"])
    T.click("#btnshare"); T.wait_for_timeout(1200)
    T.click("#phone-panel .pp-modes button[data-mode=pptx]"); T.wait_for_timeout(300)
    print("hint:", T.inner_text("#phone-panel .pp-modehint")[:90], "… | QR hidden:", T.evaluate("document.querySelector('#phone-panel .pp-qr').hidden"))
    link = T.text_content("#phone-panel .pp-link"); print("link:", link)
    T.locator("#phone-panel").screenshot(path=f"{OUTDIR}/pptx_panel_link.png")

    # ── the PowerPoint computer: receiver page (its own browser profile) ──
    rc = b.new_context(ignore_https_errors=True, viewport={"width": 900, "height": 900})
    rc.add_init_script("window.TimerFeatures = { pptx: true }")   # PowerPoint: an alpha-only trial (features.js)
    rc.add_init_script("""localStorage.pptx_receiver_id = 'testpair123';
      window.showDirectoryPicker = async () => navigator.storage.getDirectory();   // stand-in folder: the origin's private file system""")
    rc.route("**/*", h); R = rc.new_page(); R.on("pageerror", lambda e: errs.append("receiver: " + str(e)))
    R.goto(link); approve(T); R.wait_for_timeout(1500)
    print("receiver before folder:", R.text_content("#badge"), "|", R.text_content("#folder"))
    T.wait_for_timeout(100)
    R.click("#pick"); R.wait_for_timeout(1500)
    print("receiver after folder:", R.text_content("#badge"), "|", R.text_content("#folder"), "| pair file:", R.evaluate("(async()=>{const d=await navigator.storage.getDirectory();return (await (await d.getFileHandle('.timer-pair')).getFile()).text()})()"))
    print("command shown:", R.text_content("#cmd")[:110], "…")

    # ── the player ──
    P = run_player(link, "testpair123")
    approve(T)
    ok = wait(lambda: len(cmds(verb="send")) >= 4, 40)
    T.wait_for_timeout(800)
    print("synced:", ok, "| player commands:", [c[1:3] for c in cmds()])
    print("hub:", json.dumps(T.evaluate("window.pptxHub.summary()")))
    print("receiver files:", R.evaluate("""(async()=>{const d=await navigator.storage.getDirectory();const out={};
      for await (const [n,hd] of d.entries()) if (hd.kind==='file') { const f=await hd.getFile(); const b=await f.arrayBuffer();
        out[n]=[f.size,[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,12)]; } return out;})()"""))
    print("expected hashes:", sums["h1"][:12], sums["h3"][:12])
    print("receiver summary:", R.text_content("#summary"), "|", R.text_content("#playerst"))
    R.screenshot(path=f"{OUTDIR}/pptx_receiver.png", full_page=True)
    T.click("#btnshare"); T.wait_for_timeout(400)
    print("panel lines:", T.inner_text("#phone-panel .pp-peers"))
    T.locator("#phone-panel").screenshot(path=f"{OUTDIR}/pptx_panel_machine.png")
    T.click("#btnshare")

    # ── the show ──
    def nxt(): T.evaluate("window.runsheet.next()"); T.wait_for_timeout(800)
    def acts(name="Stage", n0=0): return [c[1:3] for c in cmds(name) if c[1] in ('start', 'wallpaper', 'stop')][n0:]
    nxt(); nxt(); T.wait_for_timeout(500)
    print("Next, Next → Keynote:", acts())
    # player drops and comes back (same machine)
    P.terminate(); T.wait_for_timeout(2500)
    n0 = len(acts()); n_all = len(cmds())
    P = run_player(link, "testpair123")
    approve(T)
    wait(lambda: len(cmds()) > n_all + 1, 30); T.wait_for_timeout(4000)
    print("player reconnect → commands:", [c[1:3] for c in cmds()][n_all:], "| show actions:", acts(n0=n0))
    # Next while the player is away, then it comes back
    P.terminate(); T.wait_for_timeout(2500)
    nxt()   # Panel: holding break.png (player offline)
    n0 = len(acts()); n_all = len(cmds())
    P = run_player(link, "testpair123")
    approve(T)
    wait(lambda: len(cmds()) > n_all + 1, 30); T.wait_for_timeout(4000)
    print("Next while away, reconnect → show actions:", acts(n0=n0))
    # the timer page reloads (everyone reconnects to it)
    n0 = len(acts())
    T.reload(); T.wait_for_timeout(9000)
    print("timer reload → show actions:", acts(n0=n0), "| hub machines:", len(T.evaluate("window.pptxHub.summary()")))
    # and a real Next still works
    n0 = len(acts()); nxt(); T.wait_for_timeout(1500)
    print("Next → Close (deck):", acts(n0=n0))
    P.terminate()
    print("errors:", errs)
