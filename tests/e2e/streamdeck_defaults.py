import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
# Default deck layouts reach browsers that never customised them: a stored layout that is exactly an
# earlier default (saveLayouts used to store every model's on any save) follows the current default,
# and the phone's virtual XL (StreamDeck.faces('xl')) with it; a customised layout is kept; saving
# stores only layouts that differ from the default.
import json, mimetypes, os, sys
from playwright.sync_api import sync_playwright
BASE = "https://timer.sophtwhere.com/beta/"
def h(route, req):
    u = req.url
    if u.startswith(BASE):
        fp = os.path.join(PUBLIC, u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp, "rb").read(), headers={"content-type": mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
errs = []
def check(name, ok, got=None):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  got: %r" % (got,)))
    if not ok: errs.append(name)

OLD_XL = ["preset_10","preset_20","preset_30","preset_45","preset_60","preset_90","preset_120","preset_180","message","message","message_clear","rs_prev","rs_next","rs_status","countdown_major","countdown_minor","start_restart","pause_resume","add_1min","sub_1min","add_15sec","sub_15sec","undo_pause","toggle_preset_arm","toggle_bar","toggle_time","toggle_messages","toggle_presenter","catch_up","brightness_cycle","video_stop","video_rewind"]
MINE_MK2 = ["start_restart"] + ["empty"] * 14
INIT = ("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.whatsnew_seen='2099-01-01';"
        "localStorage.streamdeck_layout_xl=%s;localStorage.streamdeck_layout_mk2=%s}") % (json.dumps(json.dumps(OLD_XL)), json.dumps(json.dumps(MINE_MK2)))
with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-proxy-server"])
    c = b.new_context(ignore_https_errors=True); c.add_init_script(INIT); c.route("**/*", h)
    t = c.new_page(); t.on("pageerror", lambda e: errs.append("timer: " + str(e)))
    t.goto(BASE + "timer.html"); t.wait_for_timeout(1000)
    xl = t.evaluate("StreamDeck.faces('xl').map(f => f.a)")
    check("an XL layout stored as an old default follows the new one (the phone's virtual XL too)", xl[7] == "keypad" and xl[31] == "start_restart" and xl != OLD_XL, xl[:8])
    check("… and isn't stored any more", t.evaluate("localStorage.streamdeck_layout_xl") is None)
    mk2 = t.evaluate("StreamDeck.faces('mk2').map(f => f.a)")
    check("a customised layout is kept", mk2 == MINE_MK2, mk2[:3])
    # Saving in the editor stores only what differs from the default
    t.keyboard.press("d"); t.wait_for_timeout(300); t.click("#deck-save-btn"); t.wait_for_timeout(300)
    check("saving stores the customised layout, not the default ones", t.evaluate("localStorage.streamdeck_layout_xl") is None and t.evaluate("localStorage.streamdeck_layout_mini") is None and json.loads(t.evaluate("localStorage.streamdeck_layout_mk2")) == MINE_MK2)
    b.close()

print("errors:", errs)
sys.exit(1 if errs else 0)
