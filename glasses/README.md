# Timed Show for Even Realities G2

An Even Hub app: the presentation timer's countdown, small and dim, in a corner of the G2 glasses.
It pairs with a timer at **beta.timed-show.com** by the share panel's 6-digit code (*Pair a
computer*, or on a touch timer *Let a friend control this timer*), like a friend's phone does. The
proximity check's 3-digit number appears on the **phone page only**, never on the glasses (a number
in the wearer's view could be mistaken for the countdown). The user-facing instructions live on the
phone page (`index.html`); the timer's own help doesn't mention the glasses yet (it will once this
reaches beta).

Not part of `public/`: it's an npm project built with Vite and Even's CLI.

## Layout

```
app.json          Even Hub manifest (package com.timedshow.glasses; network whitelist: beta.timed-show.com)
index.html        the phone page: code entry, the proximity number, corner, Unpair, instructions
src/main.ts       wiring: pairing, the link, the glasses view, taps
src/link.ts       the pairing-server client (claim a code, join, hello, state, the proximity check)
src/clock.ts      the countdown from the timer's anchor (a port of public/remote-clock.js; keep in step)
src/glasses.ts    the glasses page: a blank tap-catching box, the countdown, a status line
make-icon.mjs     writes icon.png (24×24, #F4F4F4 in 2×2 blocks, as Even asks)
```

## Protocol (what the timer sees)

- Claim: `{type:'claim', code, client:'g2', mode:'presenter'}` on `wss://beta.timed-show.com/ws?code=…`.
  `client`/`mode` are ignored by today's servers; they're there for the next version (controller
  mode needs the timer to grant a control link).
- Hello: `{t:'hello', clock:1, token?, client:'g2', mode}`; the proximity number goes out as
  `{t:'pin', code, name:'Even G2 glasses'}`, which is the name the timer lists.
- Then `state` diffs with `clk` anchors, worked out locally (`clock.ts`).

## Develop

Built on the owner's kit, [g2-claude-starter](https://github.com/jonathan-annett/g2-claude-starter):
its hardware rules (no `zOrderIndex`, text boxes 30 / 56 / 84 px high, a single-file build, how taps
arrive) and its `scripts/ship.mjs` and `scripts/sim.mjs` are used here. Read its `CLAUDE.md`
before changing the glasses page.

```sh
npm install
npm run dev                        # Vite on the LAN; the phone page also works in a browser (no glasses)
npm run build                      # type-check + dist/index.html (one self-contained file)
SIM_HASH='#demo=br' npm run sim:start   # Even's simulator; #demo[=tl|tr|bl|br] fakes a running countdown
npm run sim:shot [name]            # the glasses' framebuffer -> sim/<name>.png (needs Pillow, else .raw.png)
npm run sim:log; npm run sim:stop
```

`tests/e2e/glasses_pair.py` (in the main repo) pairs the built page with a local timer and
pairing server; tests set `window.TS_SERVER` to point it at the local server.

## Release to testers

One-time: `npx evenhub login` (the portal account), and copy `ship.config.example.json` to
`ship.config.json` (git-ignored) with the email the Even app uses as `testerEmail`. Then:

```sh
npm run ship -- "one line of what changed"
```

That bumps the version in `app.json`, adds the line to `CHANGELOG.md`, builds, packs, uploads (the
first time it creates the app), promotes the build to beta and invites the tester. Install from
the Even app → Me → Beta tester (or the invite email). Other testers: `npx evenhub testers add a@b.com`
or the portal's Testing group.

## Known unknowns (check on real glasses)

- Solved: the Even app serves the plugin from `http://127.0.0.1:<port>`; the Worker accepts loopback
  origins (the VPS `remote-server.js` doesn't yet). The phone page's footer shows the origin.
- Whether text placement in the right-hand corners lines up (widths come from `@evenrealities/pretext`).
- Taps do nothing yet; closing is Even's menu (tap, then tap and hold). Next: presenter = a tap toggles the
  display, controller = 3+ taps fire Next.
