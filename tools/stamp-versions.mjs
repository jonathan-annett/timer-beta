#!/usr/bin/env node
// Cache busting: stamps every local <script src> and <link href> (.js/.css) in public/*.html with a
// hash of that file's contents, e.g. src="timer.js?v=3f2a91c0". A changed file gets a new URL, so
// browsers fetch it instead of using a stale cached copy; unchanged files keep theirs and stay cached.
// Run it before each commit (the stamped HTML is committed, so copying public/ is still the deploy):
//
//   node tools/stamp-versions.mjs           # rewrite the stamps that are out of date
//   node tools/stamp-versions.mjs --check   # only report; exits 1 if any are out of date
//
// Leaves line endings and everything else in the HTML as they are. Built-ins only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const check = process.argv.includes('--check');
const hashes = new Map();
const hashOf = name => {
  if (!hashes.has(name)) {
    const file = path.join(PUBLIC, name);
    hashes.set(name, fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8) : null);
  }
  return hashes.get(name);
};

// src="x.js", href='sub/y.css?v=1234abcd': relative paths only (no scheme, no leading / or //)
const REF = /\b(src|href)=(["'])((?![a-z][\w+.-]*:|\/)[\w./-]+\.(?:js|css))(?:\?v=[0-9a-f]*)?\2/gi;

let stale = 0;
for (const page of fs.readdirSync(PUBLIC).filter(f => f.endsWith('.html')).sort()) {
  const file = path.join(PUBLIC, page);
  const before = fs.readFileSync(file, 'latin1');          // byte-for-byte round trip
  const changed = [];
  const after = before.replace(REF, (all, attr, q, name) => {
    const v = hashOf(path.posix.normalize(name));
    if (!v) return all;                                      // not one of ours (missing file): leave it
    const out = `${attr}=${q}${name}?v=${v}${q}`;
    if (out !== all) changed.push(name);
    return out;
  });
  if (!changed.length) continue;
  stale += changed.length;
  console.log(`${check ? 'out of date' : 'stamped'}  ${page}: ${changed.join(', ')}`);
  if (!check) fs.writeFileSync(file, after, 'latin1');
}
if (!stale) console.log('All version stamps are up to date.');
process.exit(check && stale ? 1 : 0);
