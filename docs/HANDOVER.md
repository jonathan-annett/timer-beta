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
  pages. Stale cached scripts have caused "it doesn't work" reports several times (most recently
  holding slides not syncing: an old `pptx-hub.js`/`pptx-receiver.js`). Adding version query
  strings to the script tags was offered and not yet taken up.
- User setup: Companion 5.1 on a Mac (Node 24, developer modules path → `timer-beta/companion`);
  a Windows test PC with PowerPoint running `Pptx-WsController.ps1` + `pptx.html`.
- The user is in Melbourne (UTC+11). They test as they go and report back in short messages;
  answer with what changed and what to deploy, not a recap.
- Don't run downloaded binaries in the sandbox (a PowerShell download was blocked by the
  classifier earlier; don't work around it). The `.ps1` is tested by the user only.

## What was built recently (newest first)

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

- Cache-busting version tags on script/style links.
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
Companion link, plus `server.sh` for a local pairing server. See its README. Unit-ish checks:
`runsheet-core.js` and `markdown-lite.js` load in node; the Companion module has `npm test`.
