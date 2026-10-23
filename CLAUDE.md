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
├── remote-server.js       EXPERIMENTAL phone-control pairing server (wss, port 8443; standalone)
├── deploy/                systemd unit + certbot hook for remote-server.js
├── package.json           Dependencies: express, ws
└── public/                Served as static files
    ├── timer.html          Controller page
    ├── audience.html       Remote read-only viewer
    ├── timer.js            Core timer logic (large — ~1980 lines)
    ├── timer.css           All styles + state classes (large — ~1300 lines)
    ├── timerapi.js         Inbound command handler (processTimerApiMessage)
    ├── streamdeck.js       Stream Deck WebHID integration + in-app editor
    ├── deck-face.js        Draws a deck key face onto a canvas (shared by streamdeck.js and the phone's virtual XL)
    ├── relay.js            WebSocket-first remote display client + WebRTC upgrade
    ├── touchcontrols.js    Mobile gestures, touch strip, quick-start overlay
    ├── runsheet-core.js    Run sheet logic: parsing, normalising, CSV (pure, no DOM; node-testable)
    ├── runsheet.js         Run sheet controller: next/back/log, Page Up/Down, dashboard (timer window only)
    ├── runsheet.html       Run sheet editor window (opened with E)
    ├── runsheet-editor.js  Editor logic for runsheet.html
    ├── markdown-lite.js    Tiny Markdown renderer for the README help overlay (node-testable)
    ├── help-overlay.js     README overlay (? / F1 / help link) for the timer main screen and the editor
    ├── help-overlay.css    Its styles (viewport/em-sized)
    ├── remote-control.js   EXPERIMENTAL phone control, timer side (phone button/panel, allow-list)
    ├── remote-peer.js      LAN-only WebRTC link with server fallback (shared by timer and phone)
    ├── remote.html         Phone control page (opened from the QR code)
    ├── remote-phone.js     Its logic
    ├── display.html        Presenter screen for a desktop countdown display (fed by remote.html; no localStorage)
    ├── jsQR.js             QR decoder for the phone's Admin scanner (third-party, Apache-2.0; jsQR-LICENSE.txt)
    ├── fsapi.js            Fullscreen API abstraction (cross-browser)
    ├── inettime.js         Internet time sync via worldtimeapi.org
    ├── timeroverlaypip.js  Picture-in-Picture overlay of countdown
    ├── tsview.js           Webcam/screen-capture timestamp viewer
    ├── dropPlayer.js       Drag-and-drop video file player
    ├── elementcolors.js    CSS custom property colour helpers
    ├── w3color.js          Colour parsing library (third-party)
    ├── FileSaver.js        File save helper (third-party)
    ├── currentdevice.js    Device detection library (third-party, NOT loaded)
    ├── manifest.json       Timer PWA manifest (icon-192/512.png)
    ├── remote.webmanifest  Phone remote PWA manifest (remote-icon-192/512.png)
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

**Outbound** (timer → integrations): `timerAPI.send({ setVariableValues: { remain, expired, impending, pausing, adjusting_up, adjusting_down, custommsg, showbar, showtimenow, showmessages, endsAt, startedAt, ... } })`

`custommsg` is the message currently on screen (`''` when none). Messages are set from several places (C key, `custommessage` command, `remote-json`, storage sync), so `timer.js` announces it from a single point: `announceCustomMessage()` runs each tick and sends only when the text changes. The `opened` command forces a resend. Don't add sends at the individual setters. On page load `timer.js` shows the stored `custom_message`, so a presenter window opened later (or a reloaded controller) shows the current message.

**Inbound** (integrations → timer): call `processTimerApiMessage({ cmd, ... })` directly. The full command set is documented in `timerapi.js`. Key commands: `start`, `pause`, `undopause`, `adjust`, `nudge`, `catchup`, `custommessage`, `settimercolors`, `keys`, `snapshot` (returns the timer state), `restore`, `runsheetnext`, `runsheetprev`.

`runsheet.js` also sends `rs_active`, `rs_current`, `rs_next`, `rs_can_back`, `rs_status` and `rs_late` (seconds; + = behind) on the bus when they change. The `opened` command makes it resend.

`htmlclass` (the controller's full class list, i.e. what the presenter window copies from `remainDispClass`) is sent by `announceHtmlClass()` each tick only when it changes, and by `opened`. `barpct` (whole percent of the progress bar) is sent by `setBarPct()` only when it changes, and by `opened`; the phone countdown display draws its bar from it. `showbar`/`showtimenow`/`showmessages` go out when toggled and on `opened`.

**Catch up:** ↑/↓ (and the `nudge` command) move `seekEndsAt`; each tick eases `endsAt` towards it by 25 ms, so the display runs fast or slow. `catchUpNow()` in `timer.js` snaps `endsAt = seekEndsAt`. It is shared by Ctrl+Enter, Ctrl+Space, the `catch up` button and the `catchup` command.

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
| `adjusting_time` | Timer is easing towards an adjusted end time (enables the catch up button) |
| `runsheet` | Run sheet mode is on (shows the dashboard on the controller) |
| `msg-long` / `msg-xlong` | Current message is long / very long; smaller message font (set in `announceCustomMessage`) |
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
| `custom_css` | string | The user's Ctrl+S style changes: only rules that differ from `timer.css`, applied in `#custom_css_sheet` after it (see `cssChanges()` in `timer.js`; older full-copy saves are migrated on load) |
| `remainDisp` | string | Last rendered remaining time (read by presenter tab) |
| `remainDispClass` | string | Current html className (read by presenter tab) |
| `barpct` | string | Current progress bar percentage |
| `internetTimeError` | ms | Offset between local clock and worldtimeapi.org |
| `streamdeck_layout_mini` | JSON | Stream Deck Mini button layout |
| `streamdeck_layout_mk2` | JSON | Stream Deck MK.II button layout |
| `streamdeck_layout_xl` | JSON | Stream Deck XL button layout |
| `streamdeck_key_overrides` | JSON | Per-key label/colour customisations |
| `streamdeck_autoconnect` | `'0'` or absent | `'0'` after the user clicks Disconnect; suppresses auto-reconnect |
| `streamdeck_brightness` | 1–100 | Stream Deck backlight %, applied on connect |
| `runsheet` | JSON | The run sheet `{title, perItem, items:[{id,name,start,duration}]}`; written by the editor |
| `runsheet_state` | JSON | Show state `{active, index, currentId, finished, history, log, dayBase}`; written only by `runsheet.js` |
| `runsheet_cmd` | JSON | Command from the editor (`next`, `back`, `goto`, `reset`, `active`); consumed and removed by `runsheet.js` |
| `runsheet_live` | JSON | Status text for the editor, written by `runsheet.js` when it changes |
| `runsheet_alive` | timestamp ms | Heartbeat from `runsheet.js` (every second, any mode incl. P); the editor's "timer isn't open" check |
| `remote_server` | wss URL | Pairing server for phone control (default `wss://<host>:8443/`; also `?remote=` in the URL) |
| `remote_pairing` | JSON | `{room, key, view, admin}` for phone control: room code, control, view-only and admin keys; "New code" replaces them all (revokes every phone and display) |
| `remote_link_mode` | string | Which link the phone panel's QR code shows: `control`, `countdown` / `runsheet` (view only) or `admin` |
| `remote_enabled` | `'1'` or absent | Phone control on; reconnects automatically after a reload |
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

**Message keys:** the `message` action stores its text per key in `keyOverrides['<model>:<index>'].message`. Pressing shows it via the `custommessage` command, or clears it if that message is already showing. The key is lit while `currentMessage` (from `custommsg`) matches its text. `message_clear` clears any message and is lit while one is showing. The XL defaults include two message keys (`DEFAULT_OVERRIDES`) plus a clear key in row 2. The editor stops keystroke propagation from its fields so typing doesn't trigger the page-wide timer shortcuts. `applyKeyOptions()` must not call `selectKey()`, which rewrites the inputs and swallows spaces as they're typed.

**Catch up and backlight keys:** `catch_up` is drawn dim unless `deckState.adjusting_up`/`adjusting_down` is set. `brightness_cycle` steps 100 → 50 → 25 → 10% and shows the level. Brightness is a feature report: gen2 `0x03 [0x08, pct]`, gen1 `0x05 [0x55, 0xaa, 0xd1, 0x01, pct]`. It is a device setting, so it is saved immediately rather than with the layout. The XL default layout puts both keys in the empty bottom-row slots.

**Key faces:** `faceFor(model, index, actionKey)` describes a key as data (`bg`, `fg`, `big`, `wrap`, `rs`, `label`, `bar`); `DeckFace.paint()` in `deck-face.js` draws it, scaling text with the key size. `renderKey()` is just the two together. Keep look-changes in `faceFor`/`paint` so the phone's virtual deck stays identical. `window.StreamDeck` exposes `faces(model)`, `press(index, model)` and `onChange(fn)` (called after a layout save or backlight change) for it.

On page load, `streamdeck.js` calls `navigator.hid.getDevices()` to auto-reconnect to any previously-granted device without another permission prompt.

In the editor, **Disconnect** blanks the keys, closes the device and sets `localStorage.streamdeck_autoconnect = '0'`. That stops auto-attach on reload and replug until **Connect** is clicked, which clears the flag and re-opens the still-granted device without the picker. **Forget deck** disconnects, then calls `HIDDevice.forget()` to revoke the site's permission.

---

## Run Sheet

Files: `runsheet-core.js` (pure logic, shared), `runsheet.js` (controller window), `runsheet.html` + `runsheet-editor.js` (editor window). The two windows only talk through localStorage: the editor writes `runsheet` and `runsheet_cmd`; the controller is the single writer of `runsheet_state` and `runsheet_live`. Don't let the editor write `runsheet_state`.

**Sheet model:** each item has `start` (seconds since midnight, or null) and `duration` (seconds, or null). `normalise()` derives everything else. An explicit duration wins; otherwise it's the gap to the next row's start, or `perItem` minutes. The last row is the finish marker if it has a start and no duration. The sheet is *anchored* if any row has a start (planned times are clock times); otherwise planned times are offsets pinned to when the first item actually started. Starts are unwrapped past midnight. Paste/CSV detection lives in `parseText()`. Durations: a plain number is minutes, `a:b` is h:mm (same as typing into the timer), `a:b:c` is h:mm:ss.

**Next/Back:** every Next or goto pushes `{timer: processTimerApiMessage({cmd:'snapshot'}), index, currentId, finished, logLen, dayBase}` onto `state.history`, logs the actual start, then sends `default`, `start` and `custommessage` (item name). Back pops and sends `restore`, which calls `restoreTimerState()` in `timer.js` and restores the message. Snapshots hold absolute timestamps, so the restored countdown carries on as if the Next never happened. Items keep their full planned duration even when the show is late (deliberate). The current item is tracked by id, so it survives row edits.

**Ahead/behind:** for the current item, projected end = max(now, timer's end incl. pause time) compared with its planned end. Before the start it's a late start against the first planned time; after the finish it's the actual finish against the planned finish. Within ±30 s counts as on time.

**Keys:** Page Down/Up are caught in the capture phase only in run sheet mode, so outside it they still reach `timer.js` (PowerPoint mode). The editor window handles them too, so a clicker focused on it still works. **E** opens the editor (not while typing).

**Help overlay:** `help-overlay.js` (+ `help-overlay.css`) shows the README rendered by `markdown-lite.js`. It's used by the editor (**?** button, opens at *Run sheet*) and the timer page (*help* link, opens at *Quick start*). Both also open it with **?** or **F1**. On the timer page it's installed by an inline script in `timer.html` with `canOpen` = not a `?presenter` window and not `html.reduced` (P and S modes), and it closes itself if the page becomes reduced while open. While open, a window-capture keydown listener stops the page's shortcuts (so Space scrolls the help instead of restarting the timer) but lets Page Up/Down through for the clicker. It loads `README.md` next to the page if deployed, otherwise the copy on GitHub (raw.githubusercontent.com allows CORS), otherwise a link. Responses not starting with `#` are rejected, so a host's HTML 404 page isn't shown. Anchors use GitHub's heading slugs, so README links like `#quick-start` work in both places. `timer.css` resets all padding, so the overlay CSS sets list padding explicitly.

**Editor sizing:** `runsheet.html` sizes everything in `rem` from `html { font-size: 1.27vw }` (width-based, so the table keeps its proportions), like the timer page's viewport units. Chrome zooms per site, and people zoom the timer window to size its buttons, so the editor must not use `px` (except 1px borders) or it would scale along with them.

**Layout:** on the controller in run sheet mode the dashboard takes the top-left half and the controller's copy of the message moves to the top right (`html.runsheet:not(.reduced) #custom_message`). The presenter view is unchanged.

**Tests:** `runsheet-core.js` exports via `module.exports` when loaded in node. The pure functions are easy to unit-test there.

## Phone Remote Control (experimental)

Separate from the relay/`share` audience display. Pieces: `remote-server.js` (standalone pairing server, wss on 8443, TLS from `--cert/--key` or systemd `$CREDENTIALS_DIRECTORY`), `remote-control.js` (timer), `remote.html` + `remote-phone.js` (phone), `remote-peer.js` (shared).

**Pairing:** the timer makes a room code and three 24-char keys: control, view-only and admin (`remote_pairing`). A control link is `remote.html#r=<room>&k=<key>[&s=<server>]`; a view-only link is `#r=<room>&v=<view key>&m=<countdown|runsheet>[&s=…]`; an admin link is `#r=<room>&a=<admin key>[&s=…]`. Each carries only its own key. The panel's mode selector (`remote_link_mode`) picks which the QR code shows. The link's fragment never reaches the web server. `s` is omitted when it's the default `wss://<host>:8443/` (the phone derives it), keeping the QR code small. Old `server/room/key` names are still accepted. The QR code is drawn by `qrCanvas()` from the qrcodejs model (`_oQRCode`) on whole device pixels with a 4-module quiet zone; clicking it shows a full-screen version. The panel's CSS is injected by `remote-control.js` (`PANEL_CSS`), not kept in `timer.css`, so a browser with a stale cached `timer.css` can't show it unstyled underneath the button bar. The panel sits below the bar (`--buttons-bottom`) and shrinks the QR on short windows. The server stores only a SHA-256 of the key, rejects joins with the wrong key, and won't let another key take over a room. It checks `Origin` against `--origin`. Limits: 16 KB per message, 40 messages/s per socket, 16 phones per room. Rooms survive a timer reconnect for 2 minutes. Every socket has an `error` handler; without it an oversized frame crashed the whole server.

**Server protocol** (the server never inspects payloads): host `{type:'host',room,key,viewKey,adminKey}` → `hosted{room,protocol}` (`PROTOCOL` 2 = view-only keys, 3 = admin keys; older servers send none. `MIN_PROTOCOL` in `remote-control.js` says what each link needs; the timer warns in the panel and refuses shares the server can't serve, since an old server rejects unknown keys as `not-found`); phone `{type:'join',room,key}` → `joined{id,hostOnline,role}`, and the host gets `peer-join{id,role}`. The role is `admin`, `control` or `view` by which key the phone used (the server stores only hashes). A host re-registering with a different view or admin key drops the phones using the old one. Then host `{type:'to',id,msg}` ↔ phone `down{msg}`, phone `{type:'up',msg}` ↔ host `from{id,msg}`. Also `peer-leave`, `host-offline` and `host-online`; on `host-online` the phone starts a fresh link.

**Link (`remote-peer.js`):** a WebRTC data channel with **no STUN/TURN** (`iceServers: []`), so it can only connect when the phone can reach the timer's machine on the LAN; success is the same-LAN test. The timer is the initiator. Payloads are `{k:'sig', sdp|ice}` for signalling and `{k:'data', d}` for fallback data, both via the server. It gives up after 7 s or when the connection fails/closes, and `send()` then uses the server. It works with browsers' default mDNS-hidden host candidates.

**Messages:** timer → phone `{t:'state', full, s:{remain, over, impending, paused, adjUp, adjDown, msg, def, rsOn, rsNow, rsNext, rsBack, rsStatus, rsLate}}`. These are diffs per phone, coalesced over 60 ms, and built from the `timerAPI` bus (`remote-control.js` chains `timerAPI` and calls `opened` when enabled to fill its state). Phone → timer: `{t:'hello'}` (requests a full state) and `{t:'cmd', cmd, …}`. **Commands go through the `ALLOWED` map in `remote-control.js` only** (restart, start, pause, undopause, adjust, catchup, custommessage ≤200 chars, runsheetnext/prev), with values range-checked. Never forward arbitrary API commands from phones: the API includes `redirect` and `keys`. **View-only peers** (`role: 'view'` from the server; a missing role from an older server means control) may only send `hello`; `onPhoneMessage` drops everything else before the `ALLOWED` map, the deck and the key handlers. `rs_title`, `rs_text` and `rs_list` (from `runsheet.js`: compact JSON of the schedule, at most 3 rows before the current item and 44 in all, with `before`/`after` counts) are also sent, for the run sheet display, and `bar`/`clock`/`msgs`/`pct` (from `showbar`/`showtimenow`/`showmessages`/`barpct`) for the countdown display, which shows the progress bar, time of day (the phone's clock) and the *Paused* notice only when the timer's B/T/M switches are on (body classes `cd-bar`, `cd-clock`).

**Virtual XL deck:** the phone's **▦ Deck** view sends `{t:'deck', on}`; the timer then also sends `{t:'deck', full, cols, rows, k:{index: face}}` with only the keys whose face changed (from `StreamDeck.faces('xl')`, worked out once per push; ~300 B/s via the server, mostly the two countdown keys). A press is `{t:'key', i}`: an integer 0–31, only while the deck view is on, run by `StreamDeck.press(i, 'xl')`, i.e. whatever the operator's XL layout has on that key. `toggle_presenter` (needs a click on the timer machine) and `custom_msg` (the phone opens its own box and sends `custommessage`) are never run from a phone (`PHONE_NO_PRESS`). Phone views: `simple`, `deck`, `countdown`, `runsheet` (body classes `v-*`); view-only devices get only the last two. The phone stores its view in `remote_view` (controller) or `remote_view_display`, and the first view of a new link comes from its `m`. It saves the last link's fragment in `remote_saved_link` and uses it when opened without one (bookmark, installed app). When the server says `not-found`/`room-closed` (timer closed for more than 2 minutes, or server restarted) the phone keeps retrying every 15 s rather than giving up, so displays survive overnight. `remote.webmanifest` (icons `remote-icon-*.png`, start URL `remote.html`, scope `remote.html`) makes it installable; it's added by script except on iOS, where Add to Home Screen would otherwise use the start URL and lose the link (iOS Home Screen apps don't share Safari's storage).

**Desktop countdown display:** on a device with a mouse (`(hover: hover) and (pointer: fine)`) the countdown view is an iframe of `display.html` (`body.cd-presenter`): the presenter markup (same ids and nesting) with `timer.css`, no `<!DOCTYPE>` (timer.html has none, so both render in quirks mode), fed by `postMessage` with `{cls, remain, msg, pct, full}`: the timer's `htmlclass` plus `reduced`, as the presenter window does. It is pixel-identical to `timer.html?presenter` in tests. It never touches localStorage (the desktop's own timer state). **F** toggles full screen (forwarded from the iframe); the remote page's controls appear while the mouse moves. Colours set with `settimercolors` aren't applied, because the presenter window doesn't get them either (they only change the controller window).

**Admin (set up another computer):** only phones paired with the admin code (role `admin`) get the `admin` view, and the timer answers `share` only from admin peers (others get `{t:'share-link', error:'not-admin'}`); otherwise admin = control. The `admin` view scans another computer's phone-panel QR code with the camera (`BarcodeDetector` where available, else the bundled `jsQR.js`, Apache-2.0, loaded on demand). It accepts only a different room with a control (`k`) or admin (`a`) key. The user picks a mode; the phone sends its own timer `{t:'share', mode, req}`, and the timer (admins only) answers `{t:'share-link', req, mode, frag}` built by `shareFragment()` (always includes `s`) and notes it in the panel. The phone then joins the other computer's room with the scanned key (a second WebSocket plus a `RemotePeer`) and sends `{t:'adopt', req, mode, frag}`. The other computer's `adopt()` (control peers only) validates every field (room, one key, mode, `wss://` server, not its own room), rebuilds the link itself, replies `adopt-ok` or `adopt-refused`, and shows `#adopt-notice`; after 8 s it navigates to `remote.html#…` unless cancelled (`adopt-cancelled` goes back to the phone).

**Phone layout:** the simple view is sized entirely in `em`; `fitSimple()` in `remote-phone.js` sets html's font-size to the largest that fits the screen without scrolling (binary search; widths are checked per element because on a phone overflowing content widens the page itself, so `innerWidth` can't be trusted). It refits when the content changes shape, but not while an input has focus (keyboard up). At aspect ≥ 4:5 it's two columns (`.colA`/`.colB`). The deck view is `position: fixed`; `layoutDeck()` sizes square keys to fit and spreads the leftover space into the gaps (`--key`, `--col-gap`, `--row-gap`). Wider than 1.15:1 adds `body.side`: the top bar becomes a 52 px icon strip on the left (`.long`/`.short` labels). Full screen uses the Fullscreen API; where there's none (iPhone) the button shows Add to Home Screen instructions (the page has the apple-mobile-web-app meta tags).

**Testing locally:** `node remote-server.js --cert cert.pem --key key.pem --origin https://…` with a self-signed cert, and the timer at `timer.html?remote=wss://localhost:8443/`. In headless Chromium, use `--no-proxy-server` and `ignore_https_errors`. Disabling `RTCPeerConnection` on the phone page forces the server fallback.

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

- `jsQR.js` — vendored, minified QR decoder (jsQR 1.4.0). Do not modify.
- `w3color.js` — colour parsing, used by `timerapi.js` for colour name conversion. Do not modify.
- `FileSaver.js` — used by `dropPlayer.js` for saving files. Do not modify.
- `currentdevice.js` — not loaded. Can be deleted if desired.
- `robots.txt.html` — artefact from the original static host. Not served meaningfully.
- `tsview.js` — webcam/screen-capture timestamp viewer. Complex standalone module, largely independent of the rest. Touch only if specifically working on video features.

---

## Known Remaining TODOs

- **Stream Deck connection:** open the editor (`deck` button or `D`) and click **Connect deck**; WebHID needs a click for the permission prompt. Previously granted decks re-attach on page load and on USB plug-in (`navigator.hid` `connect`/`disconnect` events). The Elgato desktop app must be quit or it holds the device. Report framing has been verified against a mock device only, not real hardware. MK.2/XL (gen2) send JPEG rotated 180°; the Mini/original (gen1) send BMP and their orientation is a guess. If images look rotated or mirrored, adjust the `ORIENTATION` table at the top of `streamdeck.js`. The deck only repaints when a boolean flag in `deckState` changes; don't add per-tick values like `remain` to it.
- **Button bar sizing:** the bar's buttons and labels are deliberately sized in `px` while everything else uses viewport units, so browser zoom resizes only the buttons (documented in the README). The bar is a wrapping flex row with no fixed height. `runsheet.js` publishes its bottom edge as `--buttons-bottom` (ResizeObserver), and the dashboard and run sheet message are positioned from it. Don't give the bar a fixed height again.
- **Button bar convention:** `timer.js` binds key-macro clicks only to `div.buttons div.btn[data-keys]`. Buttons without `data-keys` (e.g. `deck`, `share`) must bind their own handlers.
- **Static hosting:** `share` and `audience.html` need `relay-server.js` running. On a plain static host (e.g. the `/beta` deployment) they fail; everything else works.
- `currentdevice.js` is still in `public/` but unused. It can be deleted.
- Run sheet: the touch strip has no Next/Back yet; editing a running item's duration doesn't change its countdown until it's restarted.
- No authentication on the relay server. The room code is the only access control. Sufficient for typical use; add a token if the server will be public-facing and high-value.

---

## Conventions to Follow

- **State via CSS classes** — visual state always via `setHtmlClass`/`clearHtmlClass`, never via `element.style`.
- **Time via `timeProvider`** — never `Date.now()` in timer logic.
- **Commands via `processTimerApiMessage`** — never call timer functions directly from integrations.
- **State out via `timerAPI.send`** — never read DOM or localStorage from integrations to get timer state; wait for it to be pushed.
- **No build step** — this is vanilla JS. No bundler, no transpiler, no TypeScript. Keep it that way unless explicitly decided otherwise.
- **localStorage as the inter-tab bus** — the presenter tab reads from storage events. If you add new display state that needs to reach the presenter tab, write it to localStorage and handle the `storage` event in the presenter tab's `onLocalStorage` handler in `timer.js`.
- **Leave Cmd shortcuts to the browser** — `onDocKeyDown` returns early when `metaKey` is held, so Cmd+R/C/V/P/1–9 etc. work normally on a Mac. Any new keyboard shortcut handler must do the same (check `!e.metaKey`); the timer's own modifier is Ctrl.
- **Custom CSS is a layer, not a copy** — the Ctrl+S editor shows `timer.css` plus the user's rules but saves only rules that differ, so `timer.css` changes still reach users with custom styles. Removing a property from a built-in rule doesn't take effect (the built-in rule still applies); override it instead. `OLD_CSS_RULES` fingerprints past built-in rules for migrating old full-copy saves; it's frozen and needn't be updated.
- **Chain `timerAPI`, never replace it** — any new integration module should wrap the existing `window.timerAPI` value, not overwrite it blindly.
