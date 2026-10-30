#!/usr/bin/env node
// From jonathan-annett/g2-claude-starter (the owner's kit; works on real glasses, Oct 2026).
// Ship the current code to your glasses in one go:
//   bump version -> build -> pack -> upload -> promote to beta -> make sure you're a tester (-> invite email)
//
// usage:  npm run ship -- "what changed"            (changelog is optional)
//         npm run ship -- --dev "what changed"      the dev copy: a separate app (package id + '.dev',
//                                                   name + ' dev'), so test builds don't go to the real
//                                                   app's beta testers. Same version numbers and CHANGELOG.
//         EVEN_TESTER_EMAIL=you@example.com npm run ship
// First time only: npx evenhub login
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const dev = args[0] === '--dev';
const argText = (dev ? args.slice(1) : args).join(' ').trim();
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
// The dev copy: the same manifest under its own id and name, written beside it (git-ignored) for pack
const pkg = dev ? { ...manifest, package_id: manifest.package_id + '.dev', name: (manifest.name + ' dev').slice(0, 20) } : manifest;
const manifestFile = dev ? 'app.dev.json' : 'app.json';
if (dev) writeFileSync(root + manifestFile, JSON.stringify(pkg, null, 2) + '\n');
const id = ['--package-id', pkg.package_id];
console.log(`Version ${pkg.version} (${pkg.package_id})`);

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
sh('npm', ['run', 'build'], { stdio: 'inherit', env: { ...process.env, TS_DEV: dev ? '1' : '' } });   // the dev copy keeps its own settings (vite.config.ts)
const slug = pkg.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ehpk = `${slug}-${pkg.version}.ehpk`;
sh('npx', ['evenhub', 'pack', manifestFile, 'dist', '-o', ehpk], { stdio: 'inherit' });

// 4. upload (creates the app on first run)
const apps = evenhub(['ls']);
const known = JSON.stringify(apps).includes(JSON.stringify(pkg.package_id));   // exact: the dev id contains the real one
if (known) {
  console.log(evenhub(['upload', ehpk, ...id, '-m', changelog], false));
} else {
  const icon = existsSync(root + 'icon.png') ? ['--icon', 'icon.png'] : [];   // the 24×24 icon (make-icon.mjs)
  const tagline = dev ? 'Test builds of Timed Show' : readConfig('tagline') || pkg.name;
  console.log(evenhub(['create', ehpk, ...id, '--name', pkg.name, '--tagline', tagline, ...icon], false));
}

// 5. promote to beta (the one beta slot; replaces the previous build)
console.log(evenhub(['promote', pkg.version, ...id, '--to', 'beta'], false));

// 6. make sure the phone's account is a tester
if (tester) {
  const list = evenhub(['testers', ...id]);
  const present = JSON.stringify(list).toLowerCase().includes(tester.toLowerCase());
  if (!present) { console.log(`Inviting ${tester}`); console.log(evenhub(['testers', 'add', tester, ...id], false)); }
  else console.log(`${tester} is already a tester`);
} else {
  console.log('No tester email set (EVEN_TESTER_EMAIL or ship.config.json), skipping invite.');
}

console.log(`\nDone. On the phone: Even app -> Me -> Beta tester -> Install (or tap the invite email link).`);
