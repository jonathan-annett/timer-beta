#!/usr/bin/env node
// From jonathan-annett/g2-claude-starter (the owner's kit; works on real glasses, Oct 2026).
// Ship the current code to your glasses in one go:
//   bump version -> build -> pack -> upload -> promote to beta -> make sure you're a tester (-> invite email)
//
// usage:  npm run ship -- "what changed"            (changelog is optional)
//         EVEN_TESTER_EMAIL=you@example.com npm run ship
// First time only: npx evenhub login
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const argText = process.argv.slice(2).join(' ').trim();
const tester = process.env.EVEN_TESTER_EMAIL || readConfig('testerEmail');

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'], shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) { console.error(`\n${cmd} ${args.join(' ')} failed (exit ${r.status})`); process.exit(r.status || 1); }
  return r.stdout;
}
function evenhub(args, json = true) {
  const out = sh('npx', ['evenhub', ...args, ...(json ? ['--json'] : [])]);
  if (!json) return out;
  try { return JSON.parse(out.trim().split('\n').pop()); } catch { return { raw: out }; }
}
function readConfig(key) {
  // ship.config.json is yours and git-ignored; copy ship.config.example.json to create it
  try { const v = JSON.parse(readFileSync(root + 'ship.config.json', 'utf8'))[key]; return typeof v === 'string' && /PUT-THE|CHANGE-ME|under 50/.test(v) ? undefined : v; } catch { return undefined; }
}

// 1. who am I
const me = evenhub(['self-check']);
if (me.raw || me.error) { console.error('Not logged in. Run: npx evenhub login'); process.exit(1); }
console.log(`Signed in as ${me.email || me.account || JSON.stringify(me)}`);

// 2. bump patch version in app.json
const manifestPath = root + 'app.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const [a, b, c] = manifest.version.split('.').map(Number);
manifest.version = `${a}.${b}.${c + 1}`;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Version ${manifest.version} (${manifest.package_id})`);

// 2b. changelog: one source of truth in CHANGELOG.md. The text given on the command line becomes the
// new version's entry; with no text, the top entry must already be for this version.
const logPath = root + 'CHANGELOG.md';
let log = readFileSync(logPath, 'utf8');
let changelog;
if (argText) {
  const entry = `## ${manifest.version}\n- ${argText}\n\n`;
  log = log.replace(/^## /m, entry + '## ');
  writeFileSync(logPath, log);
  changelog = argText;
} else {
  const m = log.match(/^## ([^\n]+)\n([\s\S]*?)(?=\n## |\s*$)/m);
  if (!m || m[1].trim() !== manifest.version) { console.error(`CHANGELOG.md has no entry for ${manifest.version}. Pass the note: npm run ship -- "what changed"`); process.exit(1); }
  changelog = m[2].split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean).join('; ');
}
console.log(`Changelog: ${changelog}`);

// 3. build + pack
sh('npm', ['run', 'build'], { stdio: 'inherit' });
const slug = manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ehpk = `${slug}-${manifest.version}.ehpk`;
sh('npx', ['evenhub', 'pack', 'app.json', 'dist', '-o', ehpk], { stdio: 'inherit' });

// 4. upload (creates the app on first run)
const apps = evenhub(['ls']);
const known = JSON.stringify(apps).includes(manifest.package_id);
if (known) {
  console.log(evenhub(['upload', ehpk, '-m', changelog], false));
} else {
  console.log(evenhub(['create', ehpk, '--name', manifest.name, '--tagline', readConfig('tagline') || manifest.name], false));
}

// 5. promote to beta (the one beta slot; replaces the previous build)
console.log(evenhub(['promote', manifest.version, '--to', 'beta'], false));

// 6. make sure the phone's account is a tester
if (tester) {
  const list = evenhub(['testers']);
  const present = JSON.stringify(list).toLowerCase().includes(tester.toLowerCase());
  if (!present) { console.log(`Inviting ${tester}`); console.log(evenhub(['testers', 'add', tester], false)); }
  else console.log(`${tester} is already a tester`);
} else {
  console.log('No tester email set (EVEN_TESTER_EMAIL or ship.config.json), skipping invite.');
}

console.log(`\nDone. On the phone: Even app -> Me -> Beta tester -> Install (or tap the invite email link).`);
