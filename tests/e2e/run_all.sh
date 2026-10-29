#!/bin/sh
# Runs every e2e script and prints one line each: ok (no page errors) or FAIL, with the full output
# in $E2E_OUT/<name>.log. Starts the local pairing server for the run if one isn't listening.
# The scripts print what they saw rather than asserting: read a test's log when its feature changed.
#   tests/e2e/run_all.sh                 # all
#   tests/e2e/run_all.sh runsheet_*      # some (names without .py; shell globs work)
cd "$(dirname "$0")"
OUT="${E2E_OUT:-/tmp/timer-e2e}"; mkdir -p "$OUT"
started=""
# E2E_SERVER=wss://localhost:8787/ws runs them against the Cloudflare Worker instead (cd cloudflare && npx wrangler dev --local-protocol https
# --var ORIGINS:https://timer.sophtwhere.com); otherwise remote-server.js on 8443, started here if it isn't running.
if [ -z "$E2E_SERVER" ] && ! (echo > /dev/tcp/127.0.0.1/8443) 2>/dev/null && ! nc -z 127.0.0.1 8443 2>/dev/null; then
  ./server.sh > "$OUT/server.log" 2>&1 & started=$!
  sleep 1.5
fi
if [ $# -gt 0 ]; then set -- $(for p in "$@"; do ls $p.py 2>/dev/null; done); else set -- *.py; fi
PY=python3; [ -x .venv/bin/python ] && PY=.venv/bin/python   # tests/e2e/.venv: Playwright installed there (see README)
TO="$(command -v timeout || command -v gtimeout || true)"   # macOS has neither unless coreutils is installed
fails=0
for t in "$@"; do
  name="${t%.py}"
  if ${TO:+$TO 600} $PY "$t" > "$OUT/$name.log" 2>&1 && grep -q '^errors: \[\]' "$OUT/$name.log"; then
    echo "ok    $name"
  else
    echo "FAIL  $name   (see $OUT/$name.log)"; fails=$((fails + 1))
  fi
done
[ -n "$started" ] && kill "$started" 2>/dev/null
node ../../tools/stamp-versions.mjs --check > /dev/null || echo "NOTE  version stamps out of date: run node tools/stamp-versions.mjs before committing"
exit $fails
