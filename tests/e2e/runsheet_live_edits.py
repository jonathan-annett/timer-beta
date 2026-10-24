import os as _os  # paths: the repo's public/ folder; screenshots go to $E2E_OUT (default /tmp/timer-e2e)
HERE = _os.path.dirname(_os.path.abspath(__file__))
PUBLIC = _os.path.normpath(_os.path.join(HERE, '..', '..', 'public'))
OUTDIR = _os.environ.get('E2E_OUT', '/tmp/timer-e2e'); _os.makedirs(OUTDIR, exist_ok=True)
import sys, os, mimetypes, json, time, datetime
from playwright.sync_api import sync_playwright
ROOT=PUBLIC; OUT=OUTDIR; BASE="https://timer.sophtwhere.com/beta/"
n=datetime.datetime.now(); base=n.hour*3600+n.minute*60   # this minute
SHEET={"title":"Day 1","perItem":20,"items":[
 {"id":"a","name":"Welcome","start":base,"duration":None},
 {"id":"b","name":"Keynote","start":base+300,"duration":None},
 {"id":"c","name":"Panel","start":base+900,"duration":None},
 {"id":"z","name":"Close","start":base+1500,"duration":None}]}
def h(route, req):
    u=req.url
    if u.startswith(BASE):
        fp=os.path.join(ROOT,u[len(BASE):].split("?")[0].split("#")[0])
        if os.path.isfile(fp): return route.fulfill(status=200, body=open(fp,"rb").read(), headers={"content-type":mimetypes.guess_type(fp)[0] or "text/plain"})
        return route.fulfill(status=404, body=b"")
    return route.abort()
def hm(sec): sec=int(sec)%86400; return "%d:%02d"%(sec//3600,(sec%3600)//60)
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(args=["--no-proxy-server","--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets"])
    c=b.new_context(ignore_https_errors=True, viewport={"width":1440,"height":900})
    c.add_init_script("if(!localStorage.__s){localStorage.clear();localStorage.__s=1;localStorage.internetTimeError='0';localStorage.runsheet=%s}" % json.dumps(json.dumps(SHEET)))
    c.route("**/*",h)
    t=c.new_page(); t.on("pageerror", lambda e: errs.append("timer: "+str(e)))
    t.goto(BASE+"timer.html"); t.wait_for_timeout(1500)
    e=c.new_page(); e.on("pageerror", lambda x: errs.append("editor: "+str(x)))
    e.goto(BASE+"runsheet.html"); e.wait_for_timeout(1200)
    sheet=lambda: {it["id"]:(it.get("start"),it.get("duration"),it["name"],it.get("hidden")) for it in json.loads(t.evaluate("localStorage.runsheet"))["items"]}
    snap=lambda: t.evaluate("processTimerApiMessage({cmd:'snapshot'})")
    remain=lambda: t.text_content("#remain_disp")
    ask=lambda: e.text_content(".ask .ask-text") if e.query_selector(".ask") else None
    def edit(rid, field, val):
        sel=f"#rs-table tr[data-id={rid}] [data-field={field}]"
        e.fill(sel, val); e.press(sel, "Tab"); e.wait_for_timeout(400)
    e.check("#active"); e.wait_for_timeout(300); e.click("#btn-next"); e.wait_for_timeout(1500)
    print("running a:", remain(), "| msg:", snap()["message"])
    # 1 live rename: cancel, then confirm
    edit("a","name","Welcome & housekeeping"); print("rename dialog:", ask())
    e.click(".ask button:has-text('Cancel')"); e.wait_for_timeout(500)
    print(" cancel -> field:", e.input_value("#rs-table tr[data-id=a] [data-field=name]"), "| msg:", snap()["message"], "| sheet:", sheet()["a"][2])
    edit("a","name","Welcome & housekeeping"); e.click(".ask button:has-text('Change it')"); e.wait_for_timeout(1200)
    print(" confirm -> msg:", snap()["message"], "| sheet:", sheet()["a"][2], "| log name:", json.loads(t.evaluate("localStorage.runsheet_state"))["log"][-1]["name"])
    # upcoming rename: no dialog
    edit("c","name","Panel discussion"); print("upcoming rename dialog:", ask(), "| sheet:", sheet()["c"][2])
    # 2 start of current is read-only
    print("current start readOnly:", e.evaluate("document.querySelector('#rs-table tr[data-id=a] [data-field=start]').readOnly"))
    # 3 duration: too short refused; longer accepted
    edit("a","duration","0:00:01"); print("too-short dialog:", ask()); e.click(".ask button:has-text('OK')"); e.wait_for_timeout(300)
    print(" sheet a:", sheet()["a"], "| field:", e.input_value("#rs-table tr[data-id=a] [data-field=duration]"))
    s0=sheet(); edit("a","duration","7"); e.wait_for_timeout(1500)
    s1=sheet(); print("dur 7 -> timer:", remain(), "| a dur:", s1["a"][1], "| b start moved:", (s1["b"][0]-s0["b"][0])/60, "min | c moved:", (s1["c"][0]-s0["c"][0])/60, "| z:", (s1["z"][0]-s0["z"][0])/60)
    # 4 timer-side +1 min -> sheet follows
    t.evaluate("processTimerApiMessage({cmd:'adjust', addtime:true, msecs:60000})"); t.wait_for_timeout(3500)
    s2=sheet(); print("timer +1 min -> a dur:", s2["a"][1]/60, "min | b moved:", (s2["b"][0]-s1["b"][0])/60, "| timer:", remain())
    # 5 pause/resume -> no sheet change
    t.evaluate("processTimerApiMessage({cmd:'pause'})"); t.wait_for_timeout(3500); t.evaluate("processTimerApiMessage({cmd:'pause'})"); t.wait_for_timeout(3000)
    print("pause 3.5s/resume -> a dur:", sheet()["a"][1]/60, "(unchanged = 8.0)")
    # 6 next start in the past
    edit("b","start", hm(base-120)); print("past start dialog:", ask()); e.click(".ask button:has-text('OK')"); e.wait_for_timeout(300); print(" b start unchanged:", sheet()["b"][0]==s2["b"][0])
    # 7 next start -> yes, end countdown then
    nowsec=datetime.datetime.now().hour*3600+datetime.datetime.now().minute*60
    T=nowsec+240
    edit("b","start", hm(T)); print("next start dialog:", ask()); e.click(".ask button:has-text('Yes')"); e.wait_for_timeout(1800)
    s3=sheet(); print(" yes -> b start:", hm(s3["b"][0]), "(typed", hm(T)+") | a dur:", round(s3["a"][1]/60,2), "| timer:", remain(), "| ends:", t.text_content("#ends_disp") if t.query_selector("#ends_disp") else '', "| c unchanged:", s3["c"][0]==s2["c"][0])
    # 8 next start earlier than current end, No -> second dialog -> save anyway
    T2=T-120
    edit("b","start", hm(T2)); e.click(".ask button:has-text('No, just')"); e.wait_for_timeout(400); print("clash dialog:", ask())
    e.screenshot(path=OUT+"/rslive_clash_dialog.png")
    e.click(".ask button:has-text('Save the start time anyway')"); e.wait_for_timeout(1500)
    print(" saved -> b start:", hm(sheet()["b"][0]), "| conflict class:", e.evaluate("document.querySelector('#rs-table tr[data-id=b] [data-field=start]').classList.contains('conflict')"), "| status:", e.text_content("#rs-table tr[data-id=b] .status"), "| timer unchanged:", remain())
    e.screenshot(path=OUT+"/rslive_clash.png")
    # 9 move on: a is completed
    e.click("#btn-next"); e.wait_for_timeout(1500)
    print("a locked:", e.evaluate("[...document.querySelectorAll('#rs-table tr[data-id=a] input')].every(i=>i.readOnly)"), "| row class:", e.get_attribute("#rs-table tr[data-id=a]","class"))
    e.click("#rs-table tr[data-id=a] button[data-act=del]"); e.wait_for_timeout(800)
    print("del a -> hidden in sheet:", sheet()["a"][3], "| row shown:", bool(e.query_selector("#rs-table tr[data-id=a]")), "| toggle:", e.text_content("#show-hidden"))
    e.click("#show-hidden"); e.wait_for_timeout(300); print(" show -> row:", e.get_attribute("#rs-table tr[data-id=a]","class"))
    e.screenshot(path=OUT+"/rslive_hidden.png")
    t.evaluate("(()=>{const prev=window.timerAPI; window.timerAPI={send(m){ if(prev&&prev.send) prev.send(m); if(m&&m.setVariableValues&&m.setVariableValues.rs_list) window.__rl=m.setVariableValues.rs_list; }}; processTimerApiMessage({cmd:'opened'});})()")
    print(" phone list:", [r['n'] for r in json.loads(t.evaluate("window.__rl"))['rows']])
    print(" log still has a:", [x["name"] for x in json.loads(t.evaluate("localStorage.runsheet_state"))["log"]])
    # 10 Back onto b then back onto a? Back -> a (hidden) unhides
    e.click("#btn-back"); e.wait_for_timeout(1500); print("Back onto a -> hidden:", sheet()["a"][3], "| current:", json.loads(t.evaluate("localStorage.runsheet_state"))["currentId"])
    e.click("#btn-next"); e.wait_for_timeout(1500); e.click("#show-hidden") if e.is_visible("#show-hidden") and 'Hide' in e.text_content("#show-hidden") else None
    e.click("#rs-table tr[data-id=a] button[data-act=del]"); e.wait_for_timeout(500)
    e.once("dialog", lambda d: d.accept()); e.click("#btn-reset"); e.wait_for_timeout(1500)
    print("reset -> a in sheet:", "a" in sheet())
print("errors:", errs)
