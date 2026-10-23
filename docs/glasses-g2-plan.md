# Even Realities G2 glasses: countdown + messages for the presenter (plan)

Status: **not started**. Written October 2026 before the glasses arrived, from public docs and
community write-ups; verify anything marked *(check)* against the official docs at
https://hub.evenrealities.com/docs before building. Everything here is a plan, not a description
of code that exists.

## Goal

A presenter wearing G2 glasses sees a small, dim countdown in the corner of their view, and any
message the operator puts on screen (*Please wrap up*, the run sheet item name) appears brighter
for as long as it's showing. Nothing to operate; it just follows the timer.

## How G2 apps work (as understood in Oct 2026)

- Even opened a public SDK and store, **Even Hub**, in April 2026. An app is a **web app**
  (HTML/CSS/TypeScript) that the Even phone app loads in a WebView. The glasses only draw what
  the app sends and report touch input, over BLE. The phone does all networking.
- Display: monochrome green, 16 shades, apps get a **576×288** canvas. Apps don't draw pixels;
  they declare **containers** (text, list, greyscale image), up to twelve per page, one of which
  takes input. One built-in font, fixed 27 px line height (≈10 lines). Per-container brightness
  is the only emphasis. Characters missing from the font don't render.
- Input: tap, double tap, swipe up/down, long press (temple touchpad or the R1 ring).
- Tooling: Node 20/22+, `@evenrealities/evenhub-cli`, `@evenrealities/evenhub-simulator`,
  official starter templates (`even-realities/evenhub-templates`: minimal, ASR, image,
  text-heavy), official kit `even-realities/everything-evenhub`. `evenhub qr` hot-reloads on real
  glasses from a dev server; `evenhub pack` makes an `.ehpk` to upload to the developer portal and
  push to a beta group (sideloading). Public release is manually reviewed: must work with the
  phone locked, every gesture must get a visible response, no black screen on first launch.
- `app.json` manifest holds a **domain whitelist** for network access *(check the exact field)*.
- Only one app shows on the glasses at a time: a presenter using a teleprompter app can't also
  see this. (A combined notes+countdown app would be a separate, bigger project.)
- Whether an Even Hub app can show a settings page on the **phone** screen *(check)*; it matters
  for pairing (below).

Sources: the review/tutorial at nervegna.substack.com ("Living With (and Building For) the Even
Realities G2"), github.com/pangoleen/awesome-even-realities-g2 (lists official repos, simulators,
timer/teleprompter/live-data examples incl. WebSocket demos such as `gpsnmeajp/g2_helloworld`),
github.com/fabioglimb/even-toolkit (bridge/layout/gesture helpers).

## Design: a third kind of view-only display

The app is architecturally the same as `public/remote.html` in countdown mode (see
*Phone Remote Control* in CLAUDE.md). It:

1. Opens a WebSocket to the pairing server (`wss://<timer host>:8443/`, `remote-server.js`) and
   sends `{type:'join', room, key: <view key>}`. The server answers `joined{id, hostOnline,
   role:'view'}`, and from then on the timer's messages arrive as `down{msg}` where `msg` is
   `{k:'data', d:{...}}` (server path) or `{k:'sig', ...}` (WebRTC signalling: ignore it, or
   answer `null`/nothing; the timer gives up on the LAN link after 7 s and uses the server).
   Don't rely on WebRTC inside the Even WebView; the server path is ~100 B/s and fine.
2. Sends `{t:'hello'}` once joined (and again on `host-online`) to get a full state.
3. Reads `{t:'state', full, s:{...}}` diffs. The fields that matter: `remain` (string, e.g.
   `9:58` / `1:02:03`), `over`, `impending`, `paused`, `msg` (the message, `''` when none),
   `msgs` (the timer's M switch: whether messages are meant to be shown). Everything the timer
   sends is listed in `MAP` in `remote-control.js`. A view-only peer may send only `hello`; the
   timer drops anything else before acting on it.
4. If the timer has **Require a PIN** on, the first `hello` is answered with `{t:'pin-required'}`:
   generate a 4-digit code, show it on the glasses, send `{t:'pin', code}`, wait for
   `{t:'pin-ok', token}` (store the token per room and send it in every later `hello`) or
   `{t:'pin-rejected'}`.
5. Renders: a text container with the countdown, dim, in one corner; a text container with the
   message, full brightness, only while `msg` is non-empty. Suggested: countdown goes full
   brightness when `impending` or `over` (prefix `+` in overtime, as the phone does), and shows
   `paused` somehow (e.g. `9:58 ⏸` if the font has it *(check)*, else the word). Update text only
   when it changes (once a second for the countdown).
6. Gestures (review needs a visible response to each): tap = toggle minimal / fuller view
   (fuller = countdown + "ends at" + message); double tap = hide the current message locally;
   long press = re-pair.
7. Keeps working with the phone locked (a review requirement) *(check what that implies for
   WebSocket keep-alive in the WebView)*; reconnect with backoff like `remote-phone.js`
   (`not-found`/`room-closed` → keep retrying every 15 s; the room comes back when the timer
   reopens).

Big digits aren't possible with the built-in font. If a text countdown is too subtle, the
fallback is a greyscale **image container** with digits rendered by the app (canvas → the SDK's
compressed image path), sent once a second; check BLE bandwidth on real hardware first.

## Pairing: getting the link into the glasses

The app runs inside Even's phone app, so it can't scan the timer's QR code the way a browser
does. Options, simplest first; decide before building:

- **Code on the glasses (preferred).** The app shows a short code (say 6 characters) and the timer
  operator types it into the timer's phone panel under a new *Glasses* mode. Needs a small,
  backwards-compatible addition to `remote-server.js` (protocol 4): the glasses app registers a
  claim code (`{type:'claim', code}` → the server keeps `code → socket` for a few minutes); the
  timer sends `{type:'give', code, link}` (the view-only fragment `r=…&v=…&m=glasses&s=…`); the
  server forwards it to that socket as `claimed{link}` and forgets the code. The glasses app then
  joins the room normally and stores the link. Rate-limit claims; codes expire. The timer's panel
  already has everything else (view key, `shareFragment()`).
- **Settings page on the phone.** If Even Hub apps can show phone-side UI *(check)*, the
  presenter pastes the view-only link there (the operator sends it with *Copy link*). No server
  change.
- **Room code typed on the glasses.** Worst: no keyboard; only gestures.

## Timer-side changes (small)

- `remote-control.js`: a `glasses` entry in `LINK_MODES` (view key, `m=glasses`) with a hint, plus
  the claim-code UI if that pairing route is chosen. `MIN_PROTOCOL.glasses` = whatever server
  version adds claims (or 2 if using the settings-page route).
- `remote-phone.js`: nothing required (the glasses are a separate app), but `m=glasses` should be
  tolerated if someone opens such a link in a browser (treat as `countdown`).
- `remote-server.js`: the claim/give messages (optional route). Bump `PROTOCOL`.
- README: a *Glasses* subsection under *Phone remote control*.

## Suggested repo layout

```
glasses/            the Even Hub app (its own package.json; Node project, NOT part of public/)
  app.json          manifest: name, 24×24 monochrome icon, domain whitelist (timer host:8443)
  src/main.ts       bridge setup, pairing, WebSocket, state → containers
  src/link.ts       the pairing-server client (port of the relevant bits of remote-phone.js:
                    join, hello, state diffs, PIN, reconnect/backoff)
  README.md         how to run the simulator, hot-reload on glasses, pack and sideload
```

Keep the glasses app out of `public/` (it's built with the Even CLI, unlike the rest of the
project which has no build step). Share the *protocol*, not code: the message formats above are
the contract, and `remote-peer.js`/`remote-phone.js` are the reference implementation.

## Testing

- The official simulator runs on a laptop and can be driven from Playwright like the other tests
  (`scratchpad` tests in this repo's history all follow the same pattern: route the timer's
  files, start `remote-server.js` with a self-signed cert, `--no-proxy-server`,
  `ignore_https_errors`).
- Test the server fallback path only (no WebRTC): `delete window.RTCPeerConnection` isn't needed
  since the app won't use it.
- Real hardware: hot-reload via `evenhub qr`; then pack and push to a beta group. Check the
  countdown really updates once a second over BLE, the dim/bright levels in a lit room, and
  behaviour with the phone locked.

## Open questions to settle with the glasses in hand

1. Does the Even WebView allow a plain `WebSocket` to the pairing server's domain once whitelisted?
   (Community WebSocket demos suggest yes.)
2. Phone-side settings UI: exists or not? (Decides the pairing route.)
3. Does the app keep its WebSocket alive with the phone locked, or does it need the SDK's
   background mechanism?
4. Font coverage: `⏸`, `+`, `…`; glyphs missing from the font vanish.
5. How subtle is "dim" on the lowest usable brightness level, and does a 1 Hz text update flicker?
