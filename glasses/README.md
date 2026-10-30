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

```sh
npm install
npm run dev          # Vite on the LAN; the phone page also works in a browser (no glasses)
npm run sim          # Even's simulator against the dev server
npm run build        # type-check + dist/
```

`tests/e2e/glasses_pair.py` (in the main repo) pairs the built page with a local timer and
pairing server; tests set `window.TS_SERVER` to point it at the local server.

## Release to testers

```sh
# bump "version" in app.json first (an upload can't reuse a version)
npm run pack                                   # -> timed-show.ehpk
```

Then either upload `timed-show.ehpk` in the developer portal (it carries the id, name and version;
the first upload registers the app), or from the command line after `npx evenhub login`:
`npx evenhub create timed-show.ehpk --name "Timed Show" --tagline "The presentation timer on your glasses" --icon icon.png`
the first time, `npx evenhub upload timed-show.ehpk -m "what changed"` after that, and
`npx evenhub promote <version> --to beta` to make it the beta build. Testers: `npx evenhub testers add a@b.com`
(or the portal's Testing group); they accept the email, then install from the Even app → Me → Beta tester.

## Known unknowns (check on real glasses)

- The Origin the Even WebView sends: the timer site's pairing server only accepts pages from known
  origins. If pairing says *Couldn't reach the timer's server*, the phone page's footer shows the
  origin; add it to the beta Worker's `ORIGINS`.
- Whether text placement in the right-hand corners lines up (widths come from `@evenrealities/pretext`).
- Taps do nothing yet; closing is Even's press-and-hold menu. Next: presenter = a tap toggles the
  display, controller = 3+ taps fire Next.
