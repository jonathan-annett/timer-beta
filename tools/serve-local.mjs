#!/usr/bin/env node
// Local HTTPS preview of public/ (plus README.md for the in-app help), for trying changes before
// deploying them. HTTPS because timer.js leaves plain http:// pages (and WebHID/clipboard need it).
//
//   tests/e2e/server.sh &          # pairing server on wss://localhost:8443/ (makes the certificate)
//   node tools/serve-local.mjs     # https://localhost:8444/timer.html
//
// Uses the same self-signed certificate as tests/e2e/server.sh (tests/e2e/.cert). The browser warns
// once per port: open https://localhost:8444/ and https://localhost:8443/ and accept both. The
// timer's share features then default to wss://localhost:8443/ by themselves. Built-ins only.
// Options: --port 8444, --host 0.0.0.0 (to open it from a phone on the LAN; the phone has to accept
// the certificate too, and the link in the QR code must then use the Mac's address).
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const CERT = path.join(ROOT, 'tests', 'e2e', '.cert');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const PORT = Number(arg('port', 8444)), HOST = arg('host', 'localhost');

if (!fs.existsSync(path.join(CERT, 'cert.pem'))) {
  console.error('No certificate yet: run tests/e2e/server.sh once (it makes tests/e2e/.cert).');
  process.exit(1);
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.ps1': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm' };

https.createServer({ cert: fs.readFileSync(path.join(CERT, 'cert.pem')), key: fs.readFileSync(path.join(CERT, 'key.pem')) }, (req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'https://x').pathname);
  if (rel === '/') rel = '/timer.html';
  const file = rel === '/README.md' ? path.join(ROOT, 'README.md') : path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC) && file !== path.join(ROOT, 'README.md')) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
    // no-store: a reload always gets what's on disk (no Ctrl+F5 dance while iterating)
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  });
}).listen(PORT, HOST, () => console.log(`Serving public/ at https://${HOST}:${PORT}/timer.html (no caching)`));
