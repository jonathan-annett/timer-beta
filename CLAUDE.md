# CLAUDE.md — Presentation Timer

Read this fully before making changes. It holds the rules and a map; **the detail is in
[`docs/architecture.md`](docs/architecture.md)**: read the section for the part you're about to change, and
update it (not this file) when you change how something works. This file changes only when a rule, a file,
a test or a section is added or removed.

The latest session's state of play (recent work, the owner's decisions, what's being tested, open offers) is
in the private hosting repo (GitHub `jonathan-annett/timer-beta-private`, cloned beside this one as
`../timed-show-cloud`): read its `CLAUDE.md` and `docs/HANDOVER.md` if it's there.

**This repo is public (open source).** The hosted service (timed-show.com, alpha and beta: the Cloudflare
Worker, supporters/payments, sign-in, operations notes) lives in that private repo. Never add any of that here.

---

## What it is

A keyboard-driven countdown timer for presentations and conferences (MIT, Jonathan Annett, from 2023): a
static site in `public/`, vanilla JS, no build step.

- **Controller** (`timer.html`): the operator's screen, with all the controls.
- **Presenter** (`timer.html?presenter`): a second window on the display screen, the countdown only.
- **Shared devices** (the **share** panel): phones and tablets as remotes or displays (`remote.html`), a
  floating countdown on another computer (`overlay.html`), the run sheet editor remotely, Bitfocus Companion,
  Even G2 glasses, playout computers (`playout.html`) and the assist station (`assist.html`).
- Also: a run sheet (`runsheet*.js`), Stream Decks over WebHID (`streamdeck.js`, `deck-*.js`), a video
  player window (`dropPlayer.js`), walk-up stings (`sting-*.js`), touch controls (`touchcontrols.js`).

Trial features are switched per site by `public/features.js` (`TimerFeatures`: which run on alpha, beta and
localhost); the hosted Worker also refuses a trial's files unless its `FEATURES` has it.

## Map

Each row: the main files, the tests (`tests/e2e/`), and the section of `docs/architecture.md`.

| Part | Files (`public/`) | Tests | Section |
|---|---|---|---|
| Timer core, keys, presets | `timer.js`, `timer.css`, `timerapi.js`, `tab-owner.js` | `pause_reload`, `preset_arm`, `message_layers`, `tab_owner` | *The `timerAPI` Bus*, *HTML Class State Machine*, *localStorage Keys*, *Multi-Tab Architecture* |
| Clock | `inettime.js`, `clock-panel.js` | `clock_badge`, `clock_online` | *Time Provider* |
| Operator screen, notices | `timer.css`, `notices.js`, `notice-panel.js`, `whats-new.js`, `changelog.html` | `whats_new` | *Operator screen*, *What's new* |
| Help | `help-overlay.js`, `markdown-lite.js` (renders `README.md`) | | *Help overlay* |
| Stream Deck | `streamdeck.js`, `deck-hid.js`, `deck-face.js`, `virtual-deck.js`, `deck.html`, `webhid-client.js` (the webhid frame: its site is the `../webhid` repo) | `streamdeck_*`, `virtual_deck`, `webhid_frame` | *Stream Deck WebHID* |
| Run sheet | `runsheet-core.js`, `runsheet.js`, `runsheet.html`, `runsheet-editor.js`, `runsheet-dock.js` | `runsheet_*`, `editor_clock` | *Run Sheet* |
| Sharing: pairing, phones, displays | `remote-control.js`, `remote-peer.js`, `remote-clock.js`, `remote.html`, `remote-phone.js`, `display.html`, `control.html`, `back-guard.js`; server `remote-server.js` | `control_pair`, `devices`, `relink`, `clock_sync`, `phone_runsheet_edit` | *Phone Remote Control* |
| Overlay | `overlay.html`, `overlay.js`, `overlay-view.js`, `local-overlay.js`, `key-focus.js` | `overlay_pair`, `local_overlay` | *Phone Remote Control* (overlay paragraphs) |
| Glasses | `glasses/` (TypeScript + Vite), plan `docs/glasses-g2-plan.md` | `glasses_pair`, `glasses_offer` | *Phone Remote Control* (glasses, device codes) |
| Companion | its own repo (`../companion-module-sophtwhere-presentationtimer`) | `companion_link` | *Bitfocus Companion* |
| Assist station (alpha) | `assist.html`, `assist*.js`; guide `docs/assist.md` | `assist_*`, `features_assist` | *Phone Remote Control* (assist) |
| Playout, soundboard | `playout.html`, `playout.js`, `playout-deck.js`, `playout-phone.*`, `panels.js`; guide `docs/playout.md` | `playout*` | *Phone Remote Control* (playout) |
| Video player | `dropPlayer.js`, `video-library.js`, `video-store.js` | | *Video player* |
| Stings, clips, levels, styles | `sting-*.js`, `stings.html`, `audio-out.js`, `clip-words.js`; guide `docs/stings.md` | `sting_*`, `runsheet_sting`, `runsheet_roll`, `playout_roll`, `audio_out`, `clip_words` | *Video player* (stings paragraphs) |
| Touch | `touchcontrols.js` | | *Mobile / Touch* |
| Hosting, trials | `features.js`, `tools/stamp-versions.mjs`, `deploy/` | `features_hosts` | *Deployment* |

`docs/architecture.md` also has *Current Structure* (every file, one line each), *Known Remaining TODOs* and
*Origin*.

## Rules

**Architecture**
- **State via CSS classes on `<html>`.** Visual state is always `setHtmlClass` / `clearHtmlClass` /
  `toggleHtmlClass`, never `element.style`. A new state = a row in the class table, CSS rules
  (`html.state #element`), and the helpers in JS.
- **The `timerAPI` bus.** `var timerAPI = null` is declared inline in `timer.html`. Integrations **chain**
  onto it (keep the previous value and call its `send` first), never replace it. State goes out only through
  `timerAPI.send({setVariableValues: …})`: integrations wait for it to be pushed, never read the DOM or
  localStorage for timer state. Commands come in only through `processTimerApiMessage({cmd, …})`, never by
  calling timer functions directly. Don't add sends at individual setters where one announce point exists
  (`announceCustomMessage()`, `announceHtmlClass()`…).
- **Devices are untrusted.** Phone and device commands go through the `ALLOWED` map in `remote-control.js`
  only, range-checked; never forward arbitrary API commands (the API has `redirect` and `keys`). View-only
  peers may only send `hello`; every peer passes the proximity check first.
- **Time via `timeProvider`.** Never `Date.now()` in timer logic: `timeProvider.now()` / `.date()`. Every
  change of offset fires the `clock-moved` event; anything new that holds timestamps from `timeProvider`
  must listen and move them.
- **localStorage is the inter-tab bus.** Display state the presenter window needs goes into localStorage
  and is handled in its `onLocalStorage`. The run sheet: the editor writes `runsheet` and `runsheet_cmd`;
  `runsheet.js` is the only writer of `runsheet_state` and `runsheet_live`.
- **Nothing the deck, phones or Companion rely on runs on animation frames.** A background tab gets none;
  ticks come from a Blob worker (`startTicker()`), deck repaints fall back to microtasks when hidden. The
  owner runs the timer page minimized behind PowerPoint with only a deck.
- **Script order.** `timer.js` calls functions during startup before later lines run: module-level state
  they use must be `var` or declared above the first call (a `let` crashed the controller once).

**Code**
- **No build step** in `public/`: vanilla JS, no bundler, transpiler or TypeScript. (`glasses/` is its own
  TypeScript + Vite project; nothing in `public/` depends on it.)
- **Cache busting:** after changing any `.js` / `.css` in `public/`, run `node tools/stamp-versions.mjs`
  before committing (`--check` only reports).
- **Keys:** leave Cmd to the browser (handlers return early on `metaKey`); the timer's modifier is Ctrl.
  Nothing reads `keyCode` or `isTrusted` (keys are re-dispatched from other windows).
- **Sizing:** the button bar is in `px` on purpose (browser zoom sizes only the buttons), with no fixed
  height (`--buttons-bottom` is published for what sits below it); the run sheet editor is in `rem` from the
  viewport width, never `px` but 1px borders. New operator UI uses the `--ui-*` tokens.
- **Custom CSS (Ctrl+S) is a layer:** it saves only rules that differ from `timer.css`.
- **Window titles** start with `location.hostname + ' - '`.
- Match the surrounding code: its comment density, naming and idiom. Comments say why, with the owner's
  decisions dated.

**Releases and docs**
- **Change log:** user-facing changes go in `changelog.html`'s `data-version="next"` section as you go;
  promoting alpha to beta dates it, merges into `main`, then starts a fresh empty `next` on alpha.
- **README.md** is the in-app help (rendered by `help-overlay.js`); the user guides of the trials are in
  `docs/` (`stings.md`, `playout.md`, `assist.md`).
- Update `docs/architecture.md` with each change in behaviour; keep it one statement per fact (no second copy
  of a paragraph elsewhere).

**Testing**
- `npm test` (`tests/e2e/run_all.sh [names]`) runs the Playwright scripts against a local pairing server
  (started if none is on 8443); `npm run test:setup` makes the venv. Logs in `/tmp/timer-e2e/`. Each script
  prints `ok` / `FAIL` lines and ends `errors: []` when it passed. `E2E_SERVER=wss://localhost:8787/ws` runs
  them against the private repo's `wrangler dev`.
- Audio-timed tests need a working audio clock: if every audio test fails at once, check that an
  `AudioContext`'s `currentTime` advances in headless Chromium; `sudo killall coreaudiod` fixes a stuck one
  (Nov 2026).

## Deploying

`public/` (plus `README.md`) is a static site for any HTTPS host (WebHID, the clipboard and orientation lock
need a secure context). The share features need the pairing server: `remote-server.js` on `wss://<host>:8443/`
(`deploy/` has its systemd unit), or on the hosted site the Worker at `wss://<site>/ws`. timed-show.com
(alpha from the `alpha` branch, beta from `main`) is deployed from the private repo (`./deploy.sh alpha|beta`).
Details: *Deployment* in `docs/architecture.md`.

## Files you can safely ignore

- `jsQR.js`, `qrcode.min.js`, `w3color.js`, `FileSaver.js`: vendored third-party code. Don't modify.
- `currentdevice.js`: a device detection library, not loaded (it was the only thing setting the `portrait` /
  `landscape` classes). Can be deleted; don't re-add it without a reason.
- `robots.txt.html`: an artefact from the original static host.
