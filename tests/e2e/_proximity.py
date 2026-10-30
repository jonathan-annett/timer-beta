# The proximity check (remote-control.js): every new device shows a number that someone types into
# the timer's share panel. approve(t) does that for the devices waiting on timer page t, as the
# operator would, reading their numbers from the page (window.remoteControl.peers).
def approve(t, expect=1, timeout=10000):
    import time
    end, done = time.time() + timeout / 1000, set()
    while time.time() < end:
        rows = t.evaluate("""[...document.querySelectorAll('#phone-panel .pp-pending [data-id]')]
            .map(r => ({ id: r.dataset.id, pin: (window.remoteControl.peers.get(r.dataset.id) || {}).pin }))""")
        for r in rows:
            if not r["pin"] or r["id"] in done: continue
            sel = f"#phone-panel .pp-pending [data-id='{r['id']}'] input"
            t.fill(sel, r["pin"]); t.press(sel, "Enter"); done.add(r["id"])
        if len(done) >= expect: break
        t.wait_for_timeout(200)
    t.wait_for_timeout(500)
    return len(done)

# Run sheet editing (remote-control.js editRequest): a device asks, the share panel shows Allow / Refuse.
def allow_edit(t, yes=True, timeout=10000):
    sel = "#phone-panel .pp-pending button[data-act=%s]" % ("edit-ok" if yes else "edit-no")
    t.wait_for_selector(sel, timeout=timeout)
    t.click(sel)
    t.wait_for_timeout(500)
