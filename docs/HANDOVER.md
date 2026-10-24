# Handover — 24 Oct 2026

For the next agent session. Read `CLAUDE.md` first (architecture, conventions, every subsystem
in detail); this file is the state of play: what was done recently, what the user decided,
what's being tested, and what's open. `docs/powerpoint.md` is the PowerPoint machines'
setup and protocol; `tests/e2e/README.md` is how to test.

## Working with this repo

- Repo: `github.com/jonathan-annett/timer-beta`. Commit straight to `main` and push (the user
  asked for this). End commit messages with the attribution lines the session gives you.
- Deploy is manual, by the user: copy `public/` + `README.md` to https://timer.sophtwhere.com/beta/.
  The pairing server (`remote-server.js`, protocol 5) runs as the systemd service `timer-remote`
  on the same VPS; it only needs redeploying when `remote-server.js` changes (it hasn't since
  protocol 5).
- At the end of each change, tell the user which files to copy and to **Ctrl+F5** the affected
  pages (or have them try it first in the local preview, see below). Stale cached scripts have caused "it doesn't work" reports several times (most recently
  holding slides not syncing: an old `pptx-hub.js`/`pptx-receiver.js`). Script/style links now
  carry `?v=` content-hash stamps (`tools/stamp-versions.mjs`), so a plain reload is enough;
  pages left open since before a deploy still need one.
- User setup: Companion 5.1 on a Mac (Node 24, developer modules path → `timer-beta/companion`);
  a Windows test PC with PowerPoint running `Pptx-WsController.ps1` + `pptx.html`.
- The user is in Melbourne (UTC+11). They test as they go and report back in short messages;
  answer with what changed and what to deploy, not a recap.
- In the cloud sandbox a downloaded PowerShell binary was blocked; don't work around such blocks.
  On the Mac, installing PowerShell with Homebrew is the user's call (suggest it, see below).

## Working from the Mac (Claude Code on the command line)

The next sessions run in Claude Code on the user's MacBook, in a local clone. That removes most
of the friction this session had (cloud container, background jobs killed after 2 h, everything
relayed through the user). Suggested setup and loop:

**Set up once**
- `git clone` the repo (or use the existing clone), `npm install` at the root (just `ws`).
- Python 3 + Playwright for the e2e scripts: `pip3 install playwright && python3 -m playwright install chromium`
  (the cloud's pre-installed Chromium doesn't exist on the Mac).
- Node 22 or newer for the Companion module (the user has Node 24; `nvm` if needed).
- Optional: `brew install powershell` (see *PowerPoint player* below) and `brew install coreutils`
  (gives `gtimeout`, which `run_all.sh` uses when present).
- In Claude Code, allow the routine commands (`git`, `npm`, `node`, `python3`, `tests/e2e/*.sh`)
  so each test run and push doesn't stop for a permission prompt.

**The loop for each change**
1. Make the change; keep `CLAUDE.md` (architecture) and this file (state of play) up to date in
   the same commit. If any `.js`/`.css` in `public/` changed, run `node tools/stamp-versions.mjs`
   (cache-busting `?v=` stamps in the HTML) and commit the HTML with it.
2. `tests/e2e/run_all.sh` (or just the relevant ones, e.g. `tests/e2e/run_all.sh runsheet_*`):
   one line per script, logs in `/tmp/timer-e2e/`. The scripts print what they saw rather than
   asserting, so also read the log of the test for the feature you changed. Add or extend a
   script for new behaviour (copy the closest one).
3. **Local preview before deploying:** `tests/e2e/server.sh &` then `node tools/serve-local.mjs`,
   and the user opens https://localhost:8444/ (accept the self-signed certificate once there and
   once at https://localhost:8443/). It serves `public/` with caching off, and the share panel
   connects to the local pairing server by itself, so phones-on-the-Mac, the remote editor,
   Companion (point a test connection at the local link) and PowerPoint (*Simulate*) can all be
   tried locally. This should replace most "deploy, Ctrl+F5, report back" round trips.
4. Commit and push to `main`; tell the user which files to copy to /beta (or the whole `public/`).

**Ideas to streamline further (ask the user first)**
- A deploy script (`tools/deploy.sh`: rsync `public/` + `README.md` to the VPS over the user's
  SSH key). Needs the host and path from the user. It could also stamp `?v=<commit>` on the
  script and style links in the deployed copy, which would end the stale-cache problem for good.
- Companion lives on the same Mac: if Companion's developer modules path points at this clone,
  `npm run build` in the module is all a change needs (restart the connection, or Companion, if
  it doesn't pick it up). `npm test` there checks the preset/action definitions.
- **PowerPoint player:** the agent still can't reach the Windows PC, but the real
  `Pptx-WsController.ps1` runs on macOS with `pwsh -File public/Pptx-WsController.ps1 -Link '<pptx link>' -Simulate -AllowSelfSignedCert`
  (its Windows-only parts are skipped off Windows; untried so far). With the local preview's
  PowerPoint link that tests the script's own protocol handling, not just `fake_player.mjs`.
  For real-PowerPoint problems, ask the user for the player's console output; a `-LogFile`
  option on the player would make that easier to send.
- Keep using small commits with a test run each; the user tests between them and reports in
  short messages.

## What was built recently (newest first)

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
- **Editor header** (`8e850e8`): countdown preview, Pause/Resume, Restart (two clicks).

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

## Being tested by the user right now

- The run sheet with a **names-and-durations-only** list (no start times): Next/Restart/▶
  updating Start, estimates, end-time edits.
- The PowerPoint player on Windows: rehearsal mode's Ctrl+Q/S close "seems to work"; the player
  still logs PowerPoint's windows (`window:`/`focused:`/`inside:` lines) after each start and
  during closing, for diagnosis. Turn that logging down once the user is happy.

## Offers made but not taken up (ask before doing)

- Restart with a single click (currently two within 2 s).
- Ripple when editing the start of items other than the next one (currently only the next).
- A provisional schedule counted from "now" before a start-time-less show begins (currently no
  times until the first Next).
- Show early (ahead-of-plan) estimates for items with typed start times (currently they hold).

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

## Testing

`tests/e2e/` (moved out of the session scratchpad so it survives): Playwright scripts for the
run sheet editor, the remote editor, the PowerPoint machines (with `fake_player.mjs`) and the
Companion link, `server.sh` for a local pairing server and `run_all.sh` to run them. See its
README. `tools/serve-local.mjs` is the local HTTPS preview of `public/`. Unit-ish checks:
`runsheet-core.js` and `markdown-lite.js` load in node; the Companion module has `npm test`.
