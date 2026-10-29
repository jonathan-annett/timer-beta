# Handover — 29 Oct 2026

For the next agent session. Read `CLAUDE.md` first (architecture, conventions, every subsystem
in detail); this file is the state of play: what was done recently, what the user decided,
what's being tested, and what's open. `docs/powerpoint.md` is the PowerPoint machines'
setup and protocol; `tests/e2e/README.md` is how to test.

## Where things are (29 Oct)

**Three sites, two branches:**

| Site | Serves | From | Who |
|---|---|---|---|
| https://alpha.timed-show.com/ | Cloudflare Worker `timed-show-alpha` (pages + Durable Objects) | local `alpha` branch, deployed from the Mac with `wrangler` | the user (and the agent's tests) only: Cloudflare Access |
| https://timer.sophtwhere.com/beta/ | VPS clone + `timer-remote` (`remote-server.js`) | `main`, deployed by the user's `./update-server.sh` | beta testers, live shows |
| https://timer.sophtwhere.com/ | VPS, static | not this repo's concern | public |

Planned: `beta.timed-show.com` (Worker `timed-show-beta`, from `main`) replaces the VPS beta, and
`timer.sophtwhere.com/beta/` redirects there. `timed.show` (bought) redirects to `timed-show.com`.
Not done yet (see *Open*).

- **`alpha` is not pushed to GitHub** and is many commits ahead of `main`. `main` = what the VPS beta
  runs (`f3ece87`, deployed 28 Oct; rollback tag `beta-rollback` = `ce10a90`). The user promotes
  alpha → main when they say; nothing goes to `main` or GitHub without their OK.
- **Deploy alpha** (no push needed): `cd cloudflare && set -a; . ~/.config/timed-show.env; set +a; npx wrangler deploy --env alpha`.
  Do it after each committed change the user should see; it takes ~15 s.
- **Credentials (outside the repo, never print them):** `~/.config/timed-show.env`
  (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`: Workers, Access, DNS/redirects on
  `timed-show.com` and `timed.show` only; the user's other zones are read-only to it) and
  `~/.config/timed-show-alpha-access.env` (`CF_ACCESS_CLIENT_ID/SECRET`: the Access service token
  for tests against alpha, sent as `CF-Access-Client-Id`/`-Secret` headers).
- **Access on alpha:** app "timed-show alpha" on `alpha.timed-show.com`, policies: the user's email
  (one-time PIN login, 30-day sessions) + the test service token. The user wants alpha limited to
  emails they name: add an email to the "timed-show alpha: owner" policy when asked. Creating an
  identity provider via the API was blocked by Claude Code's permission check; the user added the
  one-time PIN login in the dashboard (Zero Trust → Integrations → Identity providers).
- **Testing:** `tests/e2e/run_all.sh` (VPS-style server, started by itself) and
  `E2E_SERVER=wss://localhost:8787/ws tests/e2e/run_all.sh` against the Worker (`cd cloudflare &&
  npx wrangler dev --port 8787 --local-protocol https --var ORIGINS:https://timer.sophtwhere.com`
  running). Run both after server or client changes; each takes ~10 min (run in the background).
  New devices must pass the proximity check: tests call `_proximity.approve(t)`.

## Decisions the user made (29 Oct)

- **Hosting:** Cloudflare (Worker + Durable Objects) for alpha/beta, pages from the repo, for
  scaling and because venues block port 8443. `timed-show.com` canonical (venues that allow only
  .com/.net/.org); `timed.show` redirects.
- **Tiers (not built yet):** WebRTC (LAN or STUN) is free for everyone; relaying through the
  server (the websocket's `data`, what costs money) needs a signed-in user. Alpha and beta: any
  signed-in user (whitelist emails only if it gets out of hand, ~100 users). Main site later: an
  active Buy Me a Coffee membership of at least $5 (cancelled: lasts to the end of the period),
  or one-off donations at $5 per 31 days (a $10 donation = 62 days); Stripe subscriptions for
  institutions. Only the timer's operator signs in; the room's entitlement covers its devices. A
  BMC webhook brief exists (`~/Downloads/Buy Me a Coffee Webhooks Cloudflare Worker Integration Brief.md`:
  `POST /webhooks/bmc`, HMAC check, `BMC_WEBHOOK_SECRET`). Open questions asked: email sign-in
  provider, Companion/PowerPoint players (websocket-only) free or not, a free relay allowance.
- **STUN: yes** (done). **PowerPoint computers: alpha only** until the user decides whether to keep
  them (a PowerShell script may look like an attack vector); hidden and refused elsewhere (done).
- **Proximity check instead of same-network:** pairing codes work from any network; every new
  device shows a 3-digit number (moderate size) that someone types on the timer; one wrong try
  drops it (done). Being on the phone to the person is fine.
- Rebrand to "Timed Show" (or similar) is likely; keep the Companion module's internal id.

## On alpha, not on main (newest last)

Cloudflare Worker (`cloudflare/`); `/` → timer, `/o` → overlay page; share-panel pairing hint says
"type this code"; overlay follows the timer's B and M (shade, *Wrap up - last minute* / *Time is
Up* / *Paused* notices); STUN with modes `lan`/`p2p`/`server`; PowerPoint alpha-only
(`features.js`); retrying the direct link (tap the "via server" badge, or a network change);
proximity check (3 digits, one try, server `kick`); phone **Unpair this device**; device names,
**Rename** and per-device **Revoke** in the share panel, known devices list; the timer's own
overlay (O) is now the shared overlay (`overlay-view.js`, `local-overlay.js`). Note `remote-server.js`
changed too (no same-network check, `kick`): promoting to main means a `timer-remote` restart.

## Hotfix waiting for the user's OK to push (29 Oct)

- `main` has `f5365dd` (not pushed): the Stream Deck Pause/Resume key resumed with Clear Pause,
  throwing the paused time away (a user's report on the live site). Also on alpha (`a30f6fa`).
  Test `tests/e2e/streamdeck_pause.py`. Pushing it and `./update-server.sh` changes only
  `streamdeck.js` (no `timer-remote` restart). The original site (timer.sophtwhere.com, not this
  repo) has the same bug if it has the same code.

## Open (offered or asked, not started)

- Warn when a share link is opened in the same browser as the timer ("use the presenter window";
  Continue anyway): offered, user didn't object.
- Beta on Cloudflare: Worker `timed-show-beta` + `beta.timed-show.com`, GitHub → Cloudflare deploys
  (Workers Builds needs a one-time GitHub authorisation in the dashboard, or GitHub Actions with
  the token), `timed.show` redirect rules, the `/beta/` redirect on the VPS, and a "bring my
  settings across" page on the old origin first (localStorage/IndexedDB are per origin).
- The tiers (relay gating, sign-in, D1 supporters store, BMC webhook, Stripe later).
- Stream Deck "keys move around" fix (28 Oct): the user's tester found it went away after a
  replug; the user was going to ask them to retest.

## Working with this repo

- Repo: `github.com/jonathan-annett/timer-beta`. **Tell the user and wait for their OK before every
  push** (a push to `main` is one step from live). End commit messages with the attribution lines
  the session gives you.
- VPS deploy is by the user: `update-server.sh` (local, untracked, never commit it) runs
  `git pull --ff-only` on the VPS over SSH and restarts `timer-remote` only when `remote-server.js`
  or `package.json` changed (a restart drops every connection until it reconnects, so only
  between shows).
- After changing any `.js`/`.css` in `public/`, run `node tools/stamp-versions.mjs` and commit the
  HTML with it (cache busting). The README is also the in-app help (Worker imports it at deploy).
- User setup: a MacBook (this clone, Node 24, Python venv at `tests/e2e/.venv`), Companion 5.1 on
  the Mac (developer modules path → `timer-beta/companion`), a Windows test PC with PowerPoint.
- The user is in Melbourne (UTC+11). They test as they go and report back in short messages
  (often several while the agent works); answer with what changed and what to reload.
- Local preview without Cloudflare: `tests/e2e/server.sh &` + `node tools/serve-local.mjs`
  (https://localhost:8444/). With the Worker: `npx wrangler dev ... --local-protocol https` in
  `cloudflare/` (https://localhost:8787/timer.html; the timer page refuses plain http).

## What was built recently (newest first)

- **Countdown overlay + pairing by code** (28 Oct, built on a local `alpha` branch, promoted to
  main on the user's OK; deployed 28 Oct with the Stream Deck fix below; the beta site ran `ce10a90` before (tag `beta-rollback`)):
  `overlay.html` floats a countdown (message strip on top, progress as a background shade;
  16:9 / square / 9:16 / 9:16 stacked) over other windows via Document PiP, fed as a view-only device. Paired
  by a 6-digit code from the share panel's **Pair a computer** (rotates every 30 s, single use,
  same network only). Needs pairing server **protocol 6** (`remote-server.js` changed), so its
  deploy restarts `timer-remote`. Tested locally (`tests/e2e/overlay_pair.py`); the user is
  testing it on the beta site.

- **Stream Deck: one page drives it** (28 Oct): a user's MK.2 (default layout) had keys "moving
  around" after pressing Bar. Cause (inferred, not seen on hardware): the presenter window (the
  default layout's Remote key opens it) and any second timer tab also attached the deck, so
  both pages ran each press and redrew every key at once. Now presenter windows never attach and
  a Web Lock picks one timer tab. Tested with a fake deck (`tests/e2e/streamdeck_owner.py`);
  waiting on the user to confirm on their deck.

- **Run sheet: start ripple, provisional times, scaling** (24 Oct): any start edit now shifts the
  start times after it (not just the next item's); a sheet without start times shows times "as
  if it started now" before the first Next (editor, phones' list, *finish ≈ … if started now*);
  select 2+ upcoming items (click their numbers) and scale them with a slider (preview, Apply /
  Cancel, *Fit to hh:mm*): starts move within the selection, items after it keep theirs.
  Test: `tests/e2e/runsheet_scale.py`. Also: long Status notes wrap (they squeezed the Item column).

- **Restart guard is opt-in** (24 Oct): the editor's Restart now acts on one click; the
  two-clicks-within-2-s guard is the *Options* panel's **Restart needs a second click**
  (`runsheet_restart_confirm`, per computer, off by default; the remote editor keeps it in its
  own computer's localStorage).

- **Cache busting** (24 Oct): `tools/stamp-versions.mjs` stamps `?v=<content hash>` on every
  script/style link in `public/*.html`; committed, so the manual copy deploys it. Only changed
  files get new URLs. The host already sends `max-age=0` on everything, so the HTML is re-checked;
  remaining staleness comes from pages left open (e.g. the PowerPoint receiver page): those still
  need a reload after a deploy.

Run sheet (all in `runsheet.js`, `runsheet-editor.js`, `runsheet-core.js`, `runsheet.html`, plus
the remote path in `remote-control.js`/`remote-phone.js`):

- **Actual and estimated times** (`af4b0f1`): once an item has started, the editor's Start column
  shows its actual start to the second (Restart and ▶ count), finished rows show their actual
  end; later rows are estimates chained from the live item's real end (`RunsheetCore.project`),
  waiting for a typed start time when that's later. Planned times move to the Status column
  ("planned 17:12", red later / green earlier). Dashboard, phone list and *finish ≈* use the same.
- **End times, ripples** (`9b3526a`, `ce42f90`): the Ends column is editable for unfinished
  items (duration = end − start shown). Every duration/end change and any change to the next
  item's start shifts the start times after it to the end of the day. End times count from
  the start as displayed (works on sheets without start times once the show has started).
  Refused values get a dialog, not just a red cell. Time cells accept `930`/`1815`.
- **Live edits** (`0b7b75c`): completed items are read-only; ✕ on one hides it (`hidden: true`,
  kept for the log; *Show deleted*; Back onto it unhides; Reset drops them). The live item's
  start is locked; renaming it asks before the presenter's screen changes (Cancel reverts);
  its duration moves the countdown (refused if already past); time changed on the timer
  (Ctrl+arrows, ↑/↓, phones, Companion) flows back into the sheet; changing the next item's
  start asks whether the countdown ends then too, with a second three-way question if it
  would clash (clash saved knowingly = red).
- **Restart / pause semantics** (`9af8b59`): Restart = the presenter gets their full allotted
  time from now; the item's logged start moves and the show runs late. A pause makes every
  later time tick up (status line *Paused m:ss · …*).
- **Editor header** (`8e850e8`): countdown preview, Pause/Resume, Restart.

PowerPoint machines (`pptx-hub.js`, `pptx.html`/`pptx-receiver.js`, `Pptx-WsController.ps1`):

- **No changes on (re)connect** (`00bb21f`): decks and wallpapers only change on Next, Back or
  Close slides. Reconnects and timer reloads used to restart the last deck.
- Holding slides (image → Windows wallpaper when its item starts), Close slides, rehearsal mode
  (open for editing, F5; closing quits PowerPoint with Ctrl+Q and answers the save prompt with
  S), clean slate on every start, Presenter View by keys with a check first (it's a toggle).
- Earlier in the session: Companion module (base 2.0) with Big presets and styled feedbacks;
  share button = pairing panel (legacy relay removed); admin phone can share PowerPoint links;
  phone quick-tap fix; Stream Deck keeps updating in background tabs (worker tick).

## Decisions the user made (treat as requirements)

PowerPoint:
- **No PowerPoint COM** from PowerShell (it caused trouble closing files). `powerpnt /S`;
  Presenter View via the context-menu key then R; it's a toggle, so look before pressing.
  Presenter View is the default (`-NoPresenterView` to turn off); everyone runs shows in it.
- The timer only **loads, starts and closes** decks and sets the holding slide. Slides are
  advanced locally on each machine. No slide commands, ever.
- An item without a deck leaves the last deck up. Each start is a **clean slate** (close all
  shows, open the new one); seamless switching was tried and rejected.
- Files open or close **only in response to a user action** (Next, Back, Close slides), never on
  a connect/reconnect. (Consequence the user accepted implicitly: a backup machine switched on
  mid-show doesn't catch up until the next Next.)
- Rehearsal mode: open normally, F5 once focused; close with Ctrl+Q then S for the save prompt;
  big decks take a while to save (allow minutes).

Run sheet:
- Restart gives the full allotted time from now and moves the item's start; the show runs late.
- Pausing kicks the can down the road: all later times move while paused.
- Completed items: no edits; delete only hides (audit trail).
- Live item name: confirm before it reaches the screen (no typing visible on the confidence
  monitor); cancel undoes the edit. Upcoming items: no confirmation.
- Producers think in durations or hard outs: either can be typed; both ripple to the end.
- Editing the next item's start = changing the current item's end: validate it's in the future,
  ask about the countdown; "No" is valid (a gap); a clash gets a second warning with *do
  nothing / update the end anyway / save with the conflict (red)*.
- Once the show has started, the Start column is the source of truth: actual (past/current) or
  estimated (future), whether or not the sheet had start times.
- Checks use what the user sees (the start shown in the row), not hidden internals.

## Being tested by the user (as of 24–29 Oct)

- Alpha (29 Oct): the overlay, code pairing and sharing on https://alpha.timed-show.com/.
- The run sheet with a **names-and-durations-only** list (no start times): Next/Restart/▶
  updating Start, estimates, end-time edits.
- The PowerPoint player on Windows (now alpha-only): rehearsal mode's Ctrl+Q/S close "seems to work"; the player
  still logs PowerPoint's windows (`window:`/`focused:`/`inside:` lines) after each start and
  during closing, for diagnosis. Turn that logging down once the user is happy.

## Offers made but not taken up (ask before doing)

- Show early (ahead-of-plan) estimates for items with typed start times (currently they hold).
- Scaling: an option to move the items after the selection too (currently they keep their start
  times, which is what makes *Fit to* work against lunch or the finish).

## Backlog (from CLAUDE.md, still open)

- The timer computer as its own PowerPoint machine (no receiver page); title-card wallpaper.
- Touch strip has no run sheet Next/Back.
- Companion: local-only mode, key-face image feedbacks, module store submission.
- Even Realities G2 glasses display (`docs/glasses-g2-plan.md`, not started).
- Stream Deck verified against a mock device only (orientation table may need adjusting).

## Things that bit us (and how they're handled)

- `timer.css` has CRLF line endings; keep them (edit bytes, `newline=''` in Python).
  `runsheet.html` likewise may be CRLF; the JS files are LF.
- `timer.js` runs top to bottom: module state used during startup must be `var` or above the
  first call (TDZ crash before). Same care in `remote-phone.js` (`render()` uses `editorReady`).
- The editor sizes in `rem` from a `vw` root; no `px` except 1px borders.
- `renderStatus()` in the editor runs often (every live update, each second while paused); it
  must never rewrite the focused input or one marked invalid.
- `runsheet.js` now writes `runsheet` (the sheet) as well as the editor, for changes to the live
  item; commands that change the sheet and the timer together go through `runsheet_cmd`
  (`curdur`, `curend`, `livename`) so they're atomic. The remote editor's sheet saves are paced
  through the server and can arrive after a command, so commands carry their own values.
- Remote commands are validated in `remote-control.js` `rsCommand`; `remote-phone.js` relays only
  whitelisted fields. Never forward arbitrary API commands from phones.
- Background tabs: no `requestAnimationFrame`, throttled timers; the timer tick comes from a
  worker. Don't drive deck/phone/Companion updates from animation frames.
- The pairing server must answer every socket's `error` (an oversized frame once crashed it).
- On the Mac: Playwright lives in `tests/e2e/.venv`, the root needs `npm install` (the pairing
  server's `ws`), and Chromium 156 blocks the test pages (posing as timer.sophtwhere.com) from
  `wss://localhost:8443/` unless launched with `--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets`.

## Testing

`tests/e2e/` (moved out of the session scratchpad so it survives): Playwright scripts for the
run sheet editor, the remote editor, the PowerPoint machines (with `fake_player.mjs`) and the
Companion link, `server.sh` for a local pairing server and `run_all.sh` to run them. See its
README. `tools/serve-local.mjs` is the local HTTPS preview of `public/`. Unit-ish checks:
`runsheet-core.js` and `markdown-lite.js` load in node; the Companion module has `npm test`.
