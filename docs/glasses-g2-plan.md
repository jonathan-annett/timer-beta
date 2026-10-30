# Even Realities G2 glasses: countdown + messages for the presenter (plan)

Status (30 Oct 2026): **version 0.1 built** in `glasses/` (see its README): countdown only, in a
corner chosen on the phone page, pairing by the share panel's 6-digit code against
beta.timed-show.com, released to testers through the Even Hub developer portal's beta group (not
the one-off QR/prototype mode). **Works on real glasses** (0.1.3, 30 Oct 2026: paired with a beta
timer, showed an expired countdown counting up). The Even app serves plugins from
`http://127.0.0.1:<port>` (a changing port), so the pairing server accepts loopback origins (the
Worker since 30 Oct; `remote-server.js` doesn't yet).

Decisions since this plan was written (they override the sections below):
- **Pairing = the friend-code route** (`RemotePeer.claim`'s protocol), not a new claim/give
  exchange: the app claims the timer's 6-digit code with extra fields `client:'g2', mode`
  (`presenter` | `controller`), which servers ignore for now. The proximity check's 3-digit number
  is shown **on the phone page only**, never on the glasses. Before pairing the glasses say
  *Timer not connected - open the Even app to pair*; with the timer gone, *Timer offline -
  reconnecting...* (words only, nothing that looks like a time).
- **Beta only** at first: alpha is behind Cloudflare Access, which the Even WebView can't pass.
  Network whitelist: `https://beta.timed-show.com`, `wss://beta.timed-show.com`.
- **No documentation in the web app** until the plugin reaches beta proper; the instructions live
  on the plugin's phone page.
- **The role is set on the timer, never by the glasses** (the owner's rule: a presenter mustn't be
  able to take over the timer). The glasses may say which mode they'd like (`mode` in the claim and
  hello), but the operator chooses Presenter or Controller when approving them in the share panel
  (and can change it later in the device list). Only Controller gets a link that can work the timer;
  a presenter's glasses only ever hold a view-only key. So the claim is granted a **view-only** link
  by default and control is granted by the timer separately (e.g. a new `{t:'role'}` message carrying
  a control link after the operator picks Controller), not chosen on the phone page.
- **Corner only** on the phone page and the glasses' menu (*Next corner*; works on the glasses from
  0.1.7, with the page and menu sent as plain objects like the g2-claude-starter's Mischief Mews;
  settings in the Even app's storage from 0.1.5, since the plugin's 127.0.0.1 port changes per launch); no size choice (the owner
  decided to keep it simple; bigger digits would need drawn images, 288×144 max per image box).
- **Roles built (0.1.8, 31 Oct 2026; needs the timer side, on alpha):** Presenter = corner countdown, a
  tap (gathered over 600 ms: one or several) hides/shows it. Operator = fixed layout (elapsed | total
  along the top, the message (2 lines max) and the countdown centred, started | ends at along the
  bottom; Next corner ignored), three or more taps in a burst fire Next (*Next...* flashes), fewer do
  nothing. The phone page asks for a role before pairing (*I'm the presenter / operator*); the
  timer's request row and device list decide (see CLAUDE.md, Phone Remote Control).
- **Operator menu (0.1.13):** Next item, Back (undo Next), Pause / resume, Reset show, Auto start
  on / off, Minimal view on / off (the four corner items hidden); Next fires on the 3rd tap (4th / 5th
  as set on the phone page) at once; standby shows on the glasses (presenter: in the corner; operator:
  after the countdown, the auto start's state bottom left). The menu is per role (`menuFor`).
  Rebuilding the page for text changes rebooted the glasses (fixed in 0.1.12: fixed slots, spaces).
- **Next, once Operator is proven on the glasses:** more operator commands, e.g. the phone remote's run
  sheet view and controls (Back / Pause / Next, nudges) on the plugin's phone page, so the operator
  needs only the Even app. (The owner finds typing the 6-digit code fine; the QR photo is a nice-to-have.)
- **Done in 0.1.10 (photo, not live):** scan the share panel's QR code on the phone page (the `camera` permission; the
  glasses have no camera) instead of typing the code: check the Even WebView allows getUserMedia.
- **Next versions:** two modes, the role chosen on the timer (above). *Controller* (the operator wears them,
  e.g. while vision switching): 3+ rapid taps fire Next, every other input ignored; needs the
  timer to grant a control link when the claim says `mode:'controller'` (forward `client`/`mode`
  in `remote-server.js` and the Worker's claim → the host's `{type:'claim', id, client, mode}`).
  *Presenter*: no control; a single tap toggles the display on/off (3+ taps do the same). Taps
  aren't used to close the app: people close plugins with Even's menu (tap, then tap and hold) → close
  (the double-tap-to-exit guidance isn't enforced in practice, per the owner). Any tap can act at once: the menu gesture (tap, then tap and
  hold) is the system's and always opens its menu (brightness, close), which apps can't block but can
  add items to (`menuObject` on the page: e.g. *Hide / show countdown*).
  Optionally the message (item name) too, configurable on the phone page.
- **Later: glasses per run sheet item.** Tag a run sheet entry with a specific pair of glasses (by
  the device's approval token / name in the share panel), so that presenter's glasses show the HUD
  only while their item is next up or live, and stay blank otherwise.

SDK facts verified Oct 2026 (from the npm packages' typings and Even's docs): `app.json` with
`package_id`/`edition 202601`/`permissions[{name:'network', whitelist}]`; `waitForEvenAppBridge()`;
`createStartUpPageContainer` once then `rebuildPageContainer`; `textContainerUpgrade` for in-place
text; text containers have no alignment or font size, `textColor` 0–4 is brightness; exactly one
`isEventCapture` container; taps arrive with `eventType` undefined (CLICK = 0 is dropped),
`DOUBLE_CLICK_EVENT` = 3; plain WebSockets allowed to whitelisted origins; `localStorage` persists;
the font lacks `⏸` and probably `…`; `@evenrealities/pretext` measures text.

The original plan follows.

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
