# End-to-end tests

Browser tests (Playwright, Python) that drive the real pages from `public/`. They aren't a
pass/fail suite: each prints what it saw, line by line, and ends with `errors: [...]` (page
errors; it should be empty). Read the output against what the feature should do. Screenshots
go to `$E2E_OUT` (default `/tmp/timer-e2e`).

The pages are served by intercepting requests to `https://timer.sophtwhere.com/beta/` and
answering from `public/`, so no web server is needed. In the Claude cloud workspace Chromium
and Playwright are pre-installed (don't `playwright install`).

## Setup

```sh
npm install                       # ws, for the pairing server and the stand-ins
tests/e2e/server.sh &             # local pairing server on wss://localhost:8443/ (self-signed cert, made once)
# Companion test only:
(cd companion/companion-module-sophtwhere-presentationtimer && npm install && npm run build)
```

Tests marked *server* need `server.sh` running. In the cloud workspace a background command
is stopped after 2 hours at most; restart it if a test can't connect.

`./run_all.sh` runs them all (or `./run_all.sh runsheet_*` for some), starting the pairing
server for the run if none is listening, and prints `ok` / `FAIL` per script (FAIL = page errors
or a crash; logs in `$E2E_OUT`). On a Mac: `pip3 install playwright && python3 -m playwright install chromium` first.

The same certificate and pairing server also back the local preview, `node tools/serve-local.mjs`
(https://localhost:8444/, no caching).

## Tests

| Script | Server | What it checks |
|---|---|---|
| `editor_clock.py` | yes | Editor header: countdown preview, Pause/Resume, two-click Restart; same from the remote editor |
| `runsheet_pause_restart.py` | no | Pause and Restart make the show late; status line *Paused m:ss*; dashboard and phone list estimates (fake clock) |
| `runsheet_live_edits.py` | no | Live rename with confirm/cancel, locked start, live duration (refused when too late), timer +1 min → sheet, next-start Yes / No / clash, completed rows locked, delete = hide, Back unhides, Reset drops hidden |
| `runsheet_live_edits_remote.py` | yes | The same edits through the remote editor (`remote.html` → `runsheet.html?remote`) |
| `runsheet_ripple.py` | no | Next start (No / Yes), end edits (future and live), duration edits: later starts move |
| `runsheet_end_unanchored.py` | no | End times on a sheet with no start times (from the start shown), `1845`-style input, refusal messages |
| `runsheet_actual_times.py` | no | Names-only sheet: Start shows actual starts (Next, Restart, ▶, early Next) and estimates after |
| `pptx_holding.py` | yes | PowerPoint machines end to end: receiver page (origin-private file system as the folder) + `fake_player.mjs`; decks and holding slides synced, Next/Back/Close slides commands |
| `pptx_reconnect.py` | yes | Player reconnect, Next while away, timer reload: no start/stop/wallpaper sent |
| `companion_link.py` | yes | The Companion module's `TimerLink` (`comp_link.mjs`, built `dist/`) against a timer page, incl. the PIN flow |

`fake_player.mjs` is a stand-in for `public/Pptx-WsController.ps1` (same protocol, logs each
command as a JSON line). The real player has only been run by the user on Windows.

## Gotchas

- Tests with a fake clock (`context.clock.install()`) are good for minutes-long pauses but
  jumpy: a background tab's timers can lag, so the editor may briefly say the timer window
  isn't open. Check timing-sensitive things (to-the-second starts) with the real clock.
- Times are built from the machine's local clock; a test started just before a minute or
  midnight boundary can print a one-minute difference.
- Headless Chromium needs `--no-proxy-server`; WebRTC LAN tests add
  `--disable-features=WebRtcHideLocalIpsWithMdns`. Disabling `RTCPeerConnection` on a phone
  page forces the server fallback.
