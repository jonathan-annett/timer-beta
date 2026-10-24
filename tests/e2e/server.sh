#!/bin/sh
# Local pairing server for the e2e tests: a self-signed certificate (made once) and remote-server.js on 8443.
# Run from anywhere; leave it running (in the background) while the tests run.
cd "$(dirname "$0")/../.."
C=tests/e2e/.cert
if [ ! -f "$C/cert.pem" ]; then
  mkdir -p "$C"
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj /CN=localhost -keyout "$C/key.pem" -out "$C/cert.pem" 2>/dev/null
fi
# Origins: the tests (pages intercepted at timer.sophtwhere.com) and the local preview (tools/serve-local.mjs)
exec node remote-server.js --cert "$C/cert.pem" --key "$C/key.pem" --origin https://timer.sophtwhere.com,https://localhost:8444
