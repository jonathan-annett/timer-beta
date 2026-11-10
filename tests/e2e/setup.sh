#!/bin/sh
# Everything the e2e suite needs, from a clean clone (run from anywhere; `npm run test:setup` calls it):
#   - tests/e2e/.venv with Playwright and its Chromium
#   - the Companion module built (companion_link.py drives its dist/)
#   - the glasses app built (glasses_pair.py loads glasses/dist)
# Uses `npm ci`, so the committed lockfiles are installed exactly and never rewritten.
# Run `npm ci` at the top of the repo first (ws, for the pairing server and the stand-ins).
set -e
cd "$(dirname "$0")"
E2E="$(pwd)"
ROOT="$(cd ../.. && pwd)"

echo "== Python venv + Playwright + Chromium"
[ -x "$E2E/.venv/bin/python" ] || python3 -m venv "$E2E/.venv"
"$E2E/.venv/bin/pip" install --quiet playwright
"$E2E/.venv/bin/python" -m playwright install chromium

echo "== Companion module (its own repository, beside this one)"
MOD="${COMPANION_MODULE:-$ROOT/../companion-module-sophtwhere-presentationtimer}"
[ -d "$MOD" ] || git clone https://github.com/jonathan-annett/companion-module-sophtwhere-presentationtimer.git "$MOD"
cd "$MOD"
corepack enable 2>/dev/null || true
yarn install
yarn build

echo "== Glasses app"
cd "$ROOT/glasses"
npm ci
npm run build

echo "== test setup done"
