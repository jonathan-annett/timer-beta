# CLAUDE.md — Presentation Timer Project Context

This file brings an agent up to speed on the history, current architecture, and conventions of this project. Read it fully before making any changes.

---

## Origin

This project started as a static single-page app by Jonathan Annett (MIT licensed, copyright 2023). The original hosted at `timer.1mb.site` — a flat directory of vanilla JS and CSS files with no build step, no bundler, and no framework. It was designed to be dropped onto any static host.

The original companion app integration (for remote control via a Bitfocus product) used a file called `longPollPoster.js`. That file was experimental and the long-poll functionality was never implemented in the hosted build — it contained only `var timerAPI;`. It has since been removed and replaced with an inline declaration in `timer.html`.

---

## What It Does

A keyboard-driven countdown timer for presentations and conferences. Two operational modes:

- **Controller** (`timer.html`) — the operator's screen. Shows buttons, status info, and all controls.
- **Presenter** (`timer.html?presenter`) — a secondary window opened on the display screen. Shows only the countdown, colour-coded by state. No controls.
- **Audience** (`audience.html?room=WORD-N`) — a stripped read-only viewer that receives state over WebSocket/WebRTC from a remote controller.

Visual state is driven entirely by CSS classes on `<html>`. No JS touches colour or layout directly — it only adds/removes classes. This is a core architectural convention. Do not break it.

---

## Current Structure

```
timer_build/
├── relay-server.js        Express app — entry point for deployment
├── package.json           Dependencies: express, ws
└── public/                Served as static files
    ├── timer.html          Controller page
    ├── audience.html       Remote read-only viewer
    ├── timer.js            Core timer logic (large — ~1980 lines)
    ├── timer.css           All styles + state classes (large — ~1300 lines)
    ├── timerapi.js         Inbound command handler (processTimerApiMessage)
    ├── streamdeck.js       Stream Deck WebHID integration + in-app editor
    ├── relay.js            WebSocket-first remote display client + WebRTC upgrade
    ├── touchcontrols.js    Mobile gestures, touch strip, quick-start overlay
    ├── fsapi.js            Fullscreen API abstraction (cross-browser)
    ├── inettime.js         Internet time sync via worldtimeapi.org
    ├── timeroverlaypip.js  Picture-in-Picture overlay of countdown
    ├── tsview.js           Webcam/screen-capture timestamp viewer
    ├── dropPlayer.js       Drag-and-drop video file player
    ├── elementcolors.js    CSS custom property colour helpers
    ├── w3color.js          Colour parsing library (third-party)
    ├── FileSaver.js        File save helper (third-party)
    ├── currentdevice.js    Device detection library (third-party, NOT loaded)
    ├── manifest.json       PWA manifest (requires icon-192.png + icon-512.png)
    └── index.html          Redirects to timer.html
```

`currentdevice.js` is present but not referenced in any HTML file. It was removed from the script loading order during the v2 refactor. Keep the file but do not re-add it to timer.html without a specific reason.

---

## Deployment

```bash
cd timer_build
npm install
DOMAIN=https://timer.yourdomain.com PORT=3000 node relay-server.js
```

Or with arguments:
```bash
node relay-server.js --domain https://timer.yourdomain.com --port 3000
```

The server:
- Serves `public/` as static files
- Injects `window.TIMER_RELAY_URL` into HTML responses so `relay.js` knows where to connect
- Exposes `POST /api/room` to generate room codes
- Upgrades WebSocket connections on `/signal/:room` (WebRTC signalling) and `/relay/:room` (WS data relay)

There is no nginx or reverse proxy configured yet. Node handles port directly. If you add nginx later, proxy WebSocket upgrades with `proxy_http_version 1.1` and `Upgrade`/`Connection` headers.

The app requires HTTPS in production because:
- WebHID (Stream Deck) requires a secure context
- `navigator.clipboard` requires a secure context
- `screen.orientation.lock()` requires a secure context
- The original `timer.js` load guard rejects non-HTTPS unless opened as a named popup window

---

## The `timerAPI` Bus

This is the central integration point. **Do not bypass it.**

`var timerAPI = null` is declared inline in `timer.html` before any other scripts load. It is a plain global — not a module export.

`timer.js` and `timerapi.js` check `if (timerAPI)` before every call. When null, they run fine with no remote features.

`streamdeck.js` and `relay.js` each install themselves by wrapping the existing value:

```js
const prev = window.timerAPI;
window.timerAPI = {
  send(msg) {
    if (prev && prev.send) prev.send(msg);  // chain to previous handler
    // ... own handling
  }
};
```

This means loading order matters but both can coexist. `streamdeck.js` loads first (declared first in timer.html), so relay chains onto it. Both receive every `timerAPI.send()` call.

**Outbound** (timer → integrations): `timerAPI.send({ setVariableValues: { remain, expired, impending, pausing, showbar, showtimenow, showmessages, endsAt, startedAt, ... } })`

**Inbound** (integrations → timer): call `processTimerApiMessage({ cmd, ... })` directly. The full command set is documented in `timerapi.js`. Key commands: `start`, `pause`, `undopause`, `adjust`, `nudge`, `custommessage`, `settimercolors`, `keys`.

---

## HTML Class State Machine

Timer visual state lives entirely in CSS classes on `<html>`. JS uses `setHtmlClass()` / `clearHtmlClass()` / `toggleHtmlClass()` helpers — never `element.style` for state.

| Class | Meaning |
|---|---|
| `paused` | Timer is paused |
| `over` | Time has expired (countdown past zero) |
| `impending` | Under 60 seconds remaining |
| `future` | Timer set for a future start time |
| `reduced` | Presenter mode — buttons hidden |
| `showbuttons` | Control buttons visible |
| `showbar` | Progress bar visible |
| `showtimenow` | Current time-of-day visible |
| `showmessages` | Message overlays active |
| `show_custom_message` | Custom message text visible |
| `edit_custom_message` | Custom message text field being edited |
| `controlling` | Ctrl key held — changes arrow key behaviour |
| `shifting` | Shift key held |
| `editing` | User is typing a custom duration |
| `twoplus` | Two or more timer tabs open |
| `portrait` / `landscape` | Orientation (set by currentdevice.js or resize handler) |
| `overlay` | PiP overlay active |
| `nooverlay` | PiP not supported in this browser |
| `video-track` | Webcam/screen capture mode active |
| `video-auto` | Auto-zoom video mode active |

CSS rules throughout `timer.css` are written as `html.statename #element` selectors. Adding a new visual state means: add the class to this table, add CSS rules, and use `setHtmlClass`/`clearHtmlClass` in JS.

---

## localStorage Keys

All timer state persists in localStorage. These are the canonical keys:

| Key | Type | Meaning |
|---|---|---|
| `startedAt` | timestamp ms | When the current timer started |
| `endsAt` | timestamp ms | Computed end time (may lag seekEndsAt during adjustment) |
| `seekEndsAt` | timestamp ms | Target end time (source of truth for display) |
| `defaultDuration` | ms | The preset duration for the next restart |
| `pausedAt` | timestamp ms | When the current pause began (undefined if not paused) |
| `pauseAcum` | ms | Total accumulated pause time for this session |
| `showbar` | 0 or 1 | Progress bar toggle state |
| `showtimenow` | 0 or 1 | Clock display toggle state |
| `showmessages` | 0 or 1 | Messages toggle state |
| `custom_message` | string | Current custom message text |
| `custom_css` | string | User-edited CSS (from Ctrl+S editor) |
| `remainDisp` | string | Last rendered remaining time (read by presenter tab) |
| `remainDispClass` | string | Current html className (read by presenter tab) |
| `barpct` | string | Current progress bar percentage |
| `internetTimeError` | ms | Offset between local clock and worldtimeapi.org |
| `streamdeck_layout_mini` | JSON | Stream Deck Mini button layout |
| `streamdeck_layout_mk2` | JSON | Stream Deck MK.II button layout |
| `streamdeck_layout_xl` | JSON | Stream Deck XL button layout |
| `streamdeck_key_overrides` | JSON | Per-key label/colour customisations |
| `streamdeck_autoconnect` | `'0'` or absent | `'0'` after the user clicks Disconnect; suppresses auto-reconnect |
| `tab_<id>` | timestamp ms | Heartbeat for multi-tab detection |
| `controller_tab_<id>` | timestamp ms | Marks this tab as a controller |

The audience page (`audience.html`) does **not** use localStorage at all — it receives all state over the relay WebSocket.

---

## Time Provider

**Never use `Date.now()` directly in timer logic.** Always use `timeProvider.now()` and `timeProvider.date()`.

`inettime.js` creates a global `timeProvider` that applies a cached offset between the local clock and worldtimeapi.org. This ensures the timer stays accurate if the user's system clock is wrong, and keeps two browser instances in sync across machines.

On first load with no cached offset, it fetches the internet time and reloads the page — but only if the fetch **succeeded**, the page is under 3 seconds old, no timer state exists yet, and it hasn't already reloaded this session (`sessionStorage.inettime_reloaded`). `fetchInternetTime()` returns `true`/`false`; it swallows errors, so never chain a reload on its promise without checking the result. Before v2 a failed fetch (worldtimeapi.org is flaky and often blocked by ad blockers) caused an endless reload loop.

**Script-order gotcha:** `timer.js` runs top-to-bottom and calls functions such as `getTabCount()` during startup, before later lines execute. Module-level state used by those functions must be declared with `var` (hoisted) or placed above the first call. A `let lastHeartbeat` declared next to `getTabCount()` crashed the controller on load (temporal dead zone).

---

## Multi-Tab Architecture

The controller uses localStorage as a simple inter-tab bus. Each tab writes its own heartbeat timestamp to `tab_<id>` once per second. `getTabCount()` scans all `tab_` keys, prunes stale ones (>3 seconds old), and returns the count.

The presenter tab (`?presenter`) does not run the timer logic — it watches for `storage` events on `remainDisp`, `remainDispClass`, and `showbar` keys and mirrors them into its own DOM. This means the presenter view works even if they are on the same machine with no network.

The remote relay (`relay.js`) is an additional channel on top of this — it sends the same `setVariableValues` payloads that `timerAPI.send()` produces, so the audience page is architecturally identical to the presenter tab but receives data over WebSocket instead of localStorage events.

---

## WebRTC / WebSocket Relay

### Connection strategy
1. Controller clicks Share → POST `/api/room` → gets room code (e.g. `TIGER-7`)
2. Controller connects to relay WebSocket immediately: `/relay/TIGER-7?role=controller`
3. Controller also connects to signalling WebSocket: `/signal/TIGER-7?role=controller`
4. When a viewer joins signalling, WebRTC offer/answer/ICE exchange happens over the signalling WS
5. If WebRTC DataChannel opens successfully, traffic migrates from relay WS to DataChannel silently
6. If WebRTC fails (symmetric NAT, corporate firewall), relay WS remains as fallback — nothing breaks
7. Viewers also connect to relay WS immediately for the same WS-first behaviour

### Server rooms
Room codes are `WORD-N` format (e.g. `TIGER-7`). Rooms are garbage-collected after 4 hours of inactivity. Only one controller per room; multiple viewers allowed. Viewers are read-only — messages from viewer sockets are dropped by the server.

The latest `setVariableValues` snapshot is cached on the room object so new viewers receive current state immediately on join without waiting for the next timer tick.

---

## Stream Deck WebHID

`streamdeck.js` uses the browser WebHID API — no software installation required, but needs Chrome/Edge and a one-time USB permission prompt (requires user gesture).

Supported models: Mini (6 keys, 3×2), MK.II (15 keys, 5×3), XL (32 keys, 8×4).

Key images are rendered to an offscreen Canvas per key, then encoded per device generation: JPEG for gen2 (MK.2, original v2, XL), BMP for gen1 (Mini, original v1). They are sent as paged HID output reports. Only dirty keys are redrawn on each state change — not the full deck — to stay within USB bandwidth.

The in-app editor opens with the `D` key or the "deck" button. Layouts are stored in localStorage per model (`streamdeck_layout_mk2` etc.). Per-key overrides (label, fg colour, bg colour) are stored separately in `streamdeck_key_overrides`.

**Countdown keys:** the `countdown` (whole time), `countdown_major` and `countdown_minor` actions are display-only. Major/minor show `mm`/`ss` under an hour (`01` `30`), `h`/`m` from an hour up (`1h` `25m`), and a `+` prefix in overtime. They are driven by the timer's `remain` text, which is parsed into `remainSec` and deliberately kept out of `deckState`. Only countdown keys whose visible text changed are repainted (`countdownCache`), so under an hour that is one key per second. The XL default layout puts the major/minor pair at the end of row 2.

On page load, `streamdeck.js` calls `navigator.hid.getDevices()` to auto-reconnect to any previously-granted device without another permission prompt.

In the editor, **Disconnect** blanks the keys, closes the device and sets `localStorage.streamdeck_autoconnect = '0'`. That stops auto-attach on reload and replug until **Connect** is clicked, which clears the flag and re-opens the still-granted device without the picker. **Forget deck** disconnects, then calls `HIDDevice.forget()` to revoke the site's permission.

---

## Mobile / Touch

`touchcontrols.js` activates only when `'ontouchstart' in window` is true. It:
- Shows the `#touch-strip` (fixed bottom bar with 5 large buttons)
- Handles swipe gestures on `#clock_main` (swipe right/left = ±1 min, swipe up/down = ±15 sec)
- Handles long-press on `#clock_main` (600ms) = pause/resume
- Handles double-tap = start/restart
- Builds the preset bottom sheet on demand
- Shows the quick-start overlay on first load if no timer state exists

All gestures dispatch into the existing `onDocKeyDown`/`onDocKeyUp` keyboard handlers — `touchcontrols.js` has no timer logic of its own.

The `#touch-strip` is hidden via CSS on non-touch devices (`@media (pointer: coarse)` controls visibility). The `div.buttons` desktop bar is hidden on touch devices via the same media query.

The `audience.html` page supports tap-to-fullscreen (calls `requestFullscreen()` on any body tap).

---

## Files You Can Safely Ignore

- `w3color.js` — colour parsing, used by `timerapi.js` for colour name conversion. Do not modify.
- `FileSaver.js` — used by `dropPlayer.js` for saving files. Do not modify.
- `currentdevice.js` — not loaded. Can be deleted if desired.
- `robots.txt.html` — artefact from the original static host. Not served meaningfully.
- `tsview.js` — webcam/screen-capture timestamp viewer. Complex standalone module, largely independent of the rest. Touch only if specifically working on video features.

---

## Known Remaining TODOs

- **Stream Deck connection:** open the editor (`deck` button or `D`) and click **Connect deck**; WebHID needs a click for the permission prompt. Previously granted decks re-attach on page load and on USB plug-in (`navigator.hid` `connect`/`disconnect` events). The Elgato desktop app must be quit or it holds the device. Report framing has been verified against a mock device only, not real hardware. MK.2/XL (gen2) send JPEG rotated 180°; the Mini/original (gen1) send BMP and their orientation is a guess. If images look rotated or mirrored, adjust the `ORIENTATION` table at the top of `streamdeck.js`. The deck only repaints when a boolean flag in `deckState` changes; don't add per-tick values like `remain` to it.
- **Button bar convention:** `timer.js` binds key-macro clicks only to `div.buttons div.btn[data-keys]`. Buttons without `data-keys` (e.g. `deck`, `share`) must bind their own handlers.
- **Static hosting:** `share` and `audience.html` need `relay-server.js` running. On a plain static host (e.g. the `/beta` deployment) they fail; everything else works.
- `icon-192.png` and `icon-512.png` are referenced in `manifest.json` but not yet created. The PWA manifest will fail validation until they exist. Any solid black square PNG at the right dimensions will work.
- `currentdevice.js` is still in `public/` but unused. It can be deleted.
- No authentication on the relay server. The room code is the only access control. Sufficient for typical use; add a token if the server will be public-facing and high-value.

---

## Conventions to Follow

- **State via CSS classes** — visual state always via `setHtmlClass`/`clearHtmlClass`, never via `element.style`.
- **Time via `timeProvider`** — never `Date.now()` in timer logic.
- **Commands via `processTimerApiMessage`** — never call timer functions directly from integrations.
- **State out via `timerAPI.send`** — never read DOM or localStorage from integrations to get timer state; wait for it to be pushed.
- **No build step** — this is vanilla JS. No bundler, no transpiler, no TypeScript. Keep it that way unless explicitly decided otherwise.
- **localStorage as the inter-tab bus** — the presenter tab reads from storage events. If you add new display state that needs to reach the presenter tab, write it to localStorage and handle the `storage` event in the presenter tab's `onLocalStorage` handler in `timer.js`.
- **Chain `timerAPI`, never replace it** — any new integration module should wrap the existing `window.timerAPI` value, not overwrite it blindly.
