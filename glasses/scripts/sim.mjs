#!/usr/bin/env node
// From jonathan-annett/g2-claude-starter (the owner's kit; works on real glasses, Oct 2026).
// Drive the official Even Hub simulator from the command line, so a coding agent can "see" the glasses.
//
//   npm run sim:start          builds dist/, serves it, launches the simulator with the automation API on :9898
//   npm run sim:shot [name]    screenshot of the glasses framebuffer -> sim/<name>.png (composited on black)
//   npm run sim:do <actions>   send gestures: up down click double_click long_press long_press_release context_menu
//                              e.g. npm run sim:do -- down down click
//   npm run sim:log            print the webview console (JS errors, console.log)
//   npm run sim:stop
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import http from 'node:http';

const root = new URL('..', import.meta.url).pathname;
const PORT = 5173, API = 9898;
const [cmd, ...args] = process.argv.slice(2);
const pidFile = root + 'sim/.pids';

const get = (path, body) => new Promise((res, rej) => {
  const req = http.request({ host: '127.0.0.1', port: API, path, method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' } }, r => {
    const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => res(Buffer.concat(chunks)));
  });
  req.on('error', rej); if (body) req.write(JSON.stringify(body)); req.end();
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (cmd === 'start') {
  mkdirSync(root + 'sim', { recursive: true });
  spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true, shell: true });
  await sleep(1500);
  // headless Linux (CI, a cloud box): run it under a virtual display if there isn't one
  const headless = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
  const simBin = root + 'node_modules/@evenrealities/evenhub-simulator/bin/index.js';
  const simArgs = [simBin, `http://localhost:${PORT}/index.html${process.env.SIM_HASH || ''}`, '--automation-port', String(API)];   // SIM_HASH=#demo: a made-up countdown
  const sim = headless
    ? spawn('xvfb-run', ['-a', '-s', '-screen 0 1280x800x24', 'node', ...simArgs], { cwd: root, stdio: 'ignore', detached: true })
    : spawn('node', simArgs, { cwd: root, stdio: 'ignore', detached: true });
  writeFileSync(pidFile, `${server.pid}\n${sim.pid}\n`);
  server.unref(); sim.unref();
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { await sleep(1000); try { up = (await get('/api/ping')).toString() === 'pong'; } catch {} }
  if (!up) { console.error('Simulator did not answer on port ' + API + '. Is @evenrealities/evenhub-simulator installed (npm install)?'); process.exit(1); }
  await sleep(4000);
  console.log(`Simulator up. Screenshot with: npm run sim:shot`);
} else if (cmd === 'shot') {
  const name = args[0] || 'glasses';
  mkdirSync(root + 'sim', { recursive: true });
  const png = await get('/api/screenshot/glasses');
  // the framebuffer PNG stores brightness as alpha; composite it over black so it looks like the glasses
  const out = root + `sim/${name}.png`;
  writeFileSync(out + '.raw.png', png);
  const r = spawnSync('python3', ['-c', `
from PIL import Image
im=Image.open('${out}.raw.png').convert('RGBA'); bg=Image.new('RGBA', im.size, (0,0,0,255)); bg.alpha_composite(im); bg.convert('RGB').save('${out}')`]);
  if (r.status !== 0) { writeFileSync(out, png); console.log('(saved raw RGBA; install Pillow for a composited view)'); }
  console.log(out);
} else if (cmd === 'do') {
  for (const a of args) { await get('/api/input', { action: a }); await sleep(a.startsWith('long') ? 300 : 400); }
  console.log('sent', args.join(' '));
} else if (cmd === 'log') {
  const j = JSON.parse((await get('/api/console')).toString());
  for (const e of j.entries) if (!/Flutter Bridge/.test(e.message)) console.log(`[${e.level}] ${e.message}`);
} else if (cmd === 'stop') {
  if (existsSync(pidFile)) for (const pid of readFileSync(pidFile, 'utf8').split('\n').filter(Boolean)) { try { process.kill(-Number(pid)); } catch { try { process.kill(Number(pid)); } catch {} } }
  console.log('stopped');
} else {
  console.log('usage: sim.mjs start | shot [name] | do <actions...> | log | stop');
}
