# Presentation Timer (Timed Show): handover for Claude (architect)

This is the **public** repo (open source, MIT). The full handover (hosting, deploys, secrets inventory,
current state and open items) is `HANDOVER.md` in the private repo `jonathan-annett/timer-beta-private`;
read that first. This file covers only what's safe in public.

## What it is
A keyboard-driven countdown timer for presentations and conferences: an operator's screen, a presenter
window, run sheets, Stream Deck (WebHID), phones/tablets/other computers as remotes and displays, a
Bitfocus Companion module and an Even Realities G2 glasses app. Vanilla JS static site, no build step.
In active development; used at real events.

## Where everything is
| Path | What |
|---|---|
| `CLAUDE.md` | **Read first.** Architecture, conventions, every subsystem in detail |
| `public/` | The static site (timer, presenter, phone remote, overlay, run sheet editor, assist station…) |
| `remote-server.js` | Standalone pairing server (wss, port 8443) for shared devices; `deploy/` has its systemd unit |
| `tests/e2e/` | Playwright (Python) end-to-end scripts, `run_all.sh`, `server.sh`; see its `README.md` |
| `tools/` | `stamp-versions.mjs` (cache-busting `?v=` stamps, run before each commit), `serve-local.mjs` (local HTTPS preview) |
| `companion/` | Bitfocus Companion module (TypeScript, own npm project, `npm test`) |
| `glasses/` | Even Realities G2 app (TypeScript + Vite, own npm project) |
| `docs/` | `powerpoint.md` (PowerPoint machines), `glasses-g2-plan.md` |
| `README.md` | User guide, also shown in the app's help overlay |

Branches: `alpha` = development, `main` = released.

## How to run it
- **Install** (fresh Linux): Node 24 (`.nvmrc`), Python 3.10+ with venv, openssl. Then
  `npm install` and `npm run test:setup` (a venv in `tests/e2e/.venv` with Playwright and its Chromium;
  on a bare server Chromium's system libraries may also be needed: `sudo .venv/bin/python -m playwright install-deps chromium`).
- **Run locally:** `node tools/serve-local.mjs` serves `public/` at https://localhost:8444/ (self-signed
  cert from `tests/e2e/server.sh`), and `tests/e2e/server.sh` runs the pairing server on wss://localhost:8443/.
  Open `https://localhost:8444/timer.html?remote=wss://localhost:8443/`.
- **Test:** `npm test` (= `tests/e2e/run_all.sh`; starts the local pairing server itself). Allow up to
  20 minutes (not timed precisely). Prints `ok` / `FAIL` per script, logs in `$E2E_OUT` (default `/tmp/timer-e2e`). Green = every
  line `ok`. The scripts print what they saw rather than asserting everything: read a test's log when its
  feature changed. Known flaky: `assist_audio` (timing-sensitive in a full run; passes alone).
  Companion module: `cd companion/companion-module-sophtwhere-presentationtimer && npm install && npm test`.
  `glasses_pair.py` needs `glasses/dist` (`cd glasses && npm install && npm run build`).

## How it deploys
`public/` (+ `README.md`) is a static site for any HTTPS host. The hosted copies are built and deployed
from the private repo; see its HANDOVER.md. Nothing in this repo deploys anything when tests run.

## Decisions and invariants
See `CLAUDE.md`, *Conventions to Follow*. The main ones: no build step in `public/`; visual state only
via classes on `<html>`; `timeProvider.now()`, never `Date.now()`, in timer logic; integrations chain
`timerAPI` and send commands only through `processTimerApiMessage`; phone commands only through the
`ALLOWED` map; run `node tools/stamp-versions.mjs` after changing any `.js`/`.css` in `public/`;
the pairing protocol is shared with the hosted Worker and must stay compatible. Never put hosting,
payment or operations material in this repo.

## Gotchas
- The e2e tests serve `public/` by intercepting `https://timer.sophtwhere.com/beta/`; no web server needed.
- Hardware no server can test: Stream Deck (WebHID), the G2 glasses, the PowerPoint player (Windows),
  real phones (iOS Safari). These are checked by the owner by hand.
- `tests/e2e/_*.py` are helpers, skipped by `run_all.sh`; `_move_to_new_site.py` is a one-off manual
  check that needs the `legacy-beta` branch checked out at `../timer-legacy`.
