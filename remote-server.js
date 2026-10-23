#!/usr/bin/env node
/*!
 * remote-server.js  (EXPERIMENTAL)
 * Pairing server for phone remote control of the Presentation Timer.
 *
 * Runs on its own port (default 8443) with your TLS certificate, so the timer can stay on
 * a static host. It only:
 *   - pairs a timer ("host") with phones using a room code + secret key (from the QR code),
 *     or a second, view-only key, or a third, admin key. Which key a phone used decides its
 *     role ('control', 'view' or 'admin'), which is reported to the timer; the timer enforces it
 *     (view: no commands; admin: may also set up other computers),
 *   - forwards WebRTC signalling so phone and timer can try a direct LAN connection, and
 *   - relays the (small) control/state messages when a direct connection isn't possible.
 * It never looks inside the messages it forwards.
 *
 * Usage:
 *   node remote-server.js --cert fullchain.pem --key privkey.pem \
 *        --origin https://timer.example.com [--port 8443]
 *   node remote-server.js --insecure --port 8080     # plain ws, for local testing only
 *
 * In production run it as a systemd service: deploy/timer-remote.service reads the
 * Let's Encrypt files as root and passes them in, so the server can run as a normal user.
 *
 * Environment variables work too: PORT, TLS_CERT, TLS_KEY, ALLOWED_ORIGINS (comma separated).
 * MIT Licensed
 */

'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

// ─── Config ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const flag = name => args.includes('--' + name);

const PORT = parseInt(arg('port') || process.env.PORT || '8443', 10);
// With systemd's LoadCredential= (see deploy/timer-remote.service) the certificate files are
// handed over in $CREDENTIALS_DIRECTORY, so the server never needs read access to /etc/letsencrypt.
const CRED_DIR = process.env.CREDENTIALS_DIRECTORY;
const CERT = arg('cert') || process.env.TLS_CERT || (CRED_DIR && `${CRED_DIR}/fullchain.pem`);
const KEY = arg('key') || process.env.TLS_KEY || (CRED_DIR && `${CRED_DIR}/privkey.pem`);
const INSECURE = flag('insecure');
const ORIGINS = (arg('origin') || process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

// Bumped when the protocol gains features; sent to timers in 'hosted' so they can tell an
// out-of-date server (1 = control only; 2 = adds view-only keys and roles; 3 = adds admin keys).
const PROTOCOL = 4;   // 2: view-only keys, 3: admin keys, 4: companion keys
const MAX_MESSAGE_BYTES = 16 * 1024;     // signalling + state messages are tiny
const MAX_MSGS_PER_SEC = 40;             // per socket; extra messages are dropped
const MAX_PHONES_PER_ROOM = 16;          // controllers + view-only displays
const HOST_GRACE_MS = 2 * 60 * 1000;     // keep a room while its timer reconnects
const PING_MS = 25 * 1000;

if (!INSECURE && (!CERT || !KEY)) {
  console.error('Need --cert and --key (TLS certificate and private key), or --insecure for local testing.');
  process.exit(1);
}
if (!ORIGINS.length) console.warn('[remote] WARNING: no --origin given, so any website may connect. Set --origin https://your-timer-site');

// ─── Rooms ────────────────────────────────────────────────────────────────────

// room id -> { keyHash, viewHash, adminHash, compHash, host: ws|null, phones: Map<id, {ws, role}>, hostGoneAt }
// role: 'control' (joined with the room key), 'view' (view-only key), 'admin' (admin key) or
// 'companion' (companion key: Bitfocus Companion and other automation, full API on the timer)
const rooms = new Map();
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const validRoom = r => typeof r === 'string' && /^[A-Za-z0-9]{6,32}$/.test(r);
const validKey = k => typeof k === 'string' && k.length >= 16 && k.length <= 128;

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function dropRoom(id) {
  const room = rooms.get(id);
  if (!room) return;
  for (const p of room.phones.values()) { send(p.ws, { type: 'error', reason: 'room-closed' }); p.ws.close(); }
  rooms.delete(id);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (!room.host && room.hostGoneAt && now - room.hostGoneAt > HOST_GRACE_MS) dropRoom(id);
  }
}, 30 * 1000);

// ─── Server ───────────────────────────────────────────────────────────────────

const server = INSECURE
  ? http.createServer()
  : https.createServer({ cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) });

server.on('request', (req, res) => {
  // Plain HTTPS requests: a health check, and a page so you can accept a self-signed cert
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`timer remote server ok, protocol ${PROTOCOL} (view-only, admin and companion links) (${rooms.size} rooms)\n`);
});

const wss = new WebSocketServer({
  server,
  maxPayload: MAX_MESSAGE_BYTES,
  verifyClient: (info, done) => {
    const origin = info.origin || info.req.headers.origin;
    if (ORIGINS.length && !ORIGINS.includes(origin)) {
      console.warn('[remote] rejected origin', origin);
      return done(false, 403, 'Origin not allowed');
    }
    done(true);
  },
});

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  // Must be handled: an oversized or malformed frame emits 'error', and an unhandled
  // 'error' would crash the whole server. ws closes the socket itself afterwards.
  ws.on('error', err => console.warn('[remote] socket error:', err.code || err.message));
  let role = null, roomId = null, phoneId = null;
  let windowStart = Date.now(), count = 0;

  ws.on('message', raw => {
    // simple rate limit
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; count = 0; }
    if (++count > MAX_MSGS_PER_SEC) return;

    let m;
    try { m = JSON.parse(raw); } catch (_) { return; }
    if (!m || typeof m !== 'object') return;

    if (!role) {
      if (!validRoom(m.room) || !validKey(m.key)) { send(ws, { type: 'error', reason: 'bad-request' }); return ws.close(); }
      const keyHash = hash(m.key);

      if (m.type === 'host') {
        let room = rooms.get(m.room);
        if (room && !safeEqual(room.keyHash, keyHash)) { send(ws, { type: 'error', reason: 'room-taken' }); return ws.close(); }
        if (!room) { room = { keyHash, viewHash: null, adminHash: null, compHash: null, host: null, phones: new Map(), hostGoneAt: null }; rooms.set(m.room, room); }
        // The view-only and admin keys may change (the timer made new ones): phones using an old one are dropped
        const viewHash = validKey(m.viewKey) ? hash(m.viewKey) : null;
        const adminHash = validKey(m.adminKey) ? hash(m.adminKey) : null;
        const compHash = validKey(m.compKey) ? hash(m.compKey) : null;
        const changed = { view: room.viewHash && room.viewHash !== viewHash, admin: room.adminHash && room.adminHash !== adminHash,
          companion: room.compHash && room.compHash !== compHash };
        for (const [id, p] of room.phones) {
          if (changed[p.role]) { send(p.ws, { type: 'error', reason: 'room-closed' }); p.ws.close(); room.phones.delete(id); }
        }
        room.viewHash = viewHash;
        room.adminHash = adminHash;
        room.compHash = compHash;
        if (room.host && room.host !== ws) room.host.close();          // newest timer window wins
        room.host = ws; room.hostGoneAt = null;
        role = 'host'; roomId = m.room;
        send(ws, { type: 'hosted', room: m.room, protocol: PROTOCOL });
        for (const [id, p] of room.phones) { send(ws, { type: 'peer-join', id, role: p.role }); send(p.ws, { type: 'host-online' }); }
        return;
      }

      if (m.type === 'join') {
        const room = rooms.get(m.room);
        // Which key decides the role. The timer is told, and enforces it.
        const phoneRole = !room ? null
                        : room.adminHash && safeEqual(room.adminHash, keyHash) ? 'admin'
                        : room.compHash && safeEqual(room.compHash, keyHash) ? 'companion'
                        : safeEqual(room.keyHash, keyHash) ? 'control'
                        : room.viewHash && safeEqual(room.viewHash, keyHash) ? 'view' : null;
        if (!phoneRole) { send(ws, { type: 'error', reason: 'not-found' }); return ws.close(); }
        if (room.phones.size >= MAX_PHONES_PER_ROOM) { send(ws, { type: 'error', reason: 'room-full' }); return ws.close(); }
        phoneId = crypto.randomBytes(6).toString('hex');
        room.phones.set(phoneId, { ws, role: phoneRole });
        role = 'phone'; roomId = m.room;
        send(ws, { type: 'joined', id: phoneId, hostOnline: !!room.host, role: phoneRole });
        send(room.host, { type: 'peer-join', id: phoneId, role: phoneRole });
        return;
      }
      send(ws, { type: 'error', reason: 'bad-request' });
      return ws.close();
    }

    const room = rooms.get(roomId);
    if (!room) return;
    if (role === 'host' && m.type === 'to') {
      const p = room.phones.get(m.id);
      if (p) send(p.ws, { type: 'down', msg: m.msg });
    } else if (role === 'phone' && m.type === 'up' && room.phones.get(phoneId)) {
      send(room.host, { type: 'from', id: phoneId, msg: m.msg });
    }
  });

  ws.on('close', () => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (role === 'host' && room.host === ws) {
      room.host = null; room.hostGoneAt = Date.now();
      for (const p of room.phones.values()) send(p.ws, { type: 'host-offline' });
    } else if (role === 'phone' && room.phones.has(phoneId)) {
      room.phones.delete(phoneId);
      send(room.host, { type: 'peer-leave', id: phoneId });
    }
  });
});

// Drop connections that stopped answering pings (phones going to sleep, lost Wi-Fi)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, PING_MS);

wss.on('error', err => console.error('[remote] server error:', err.message));

server.listen(PORT, () => {
  console.log(`[remote] ${INSECURE ? 'ws' : 'wss'} pairing server on port ${PORT}` +
              (ORIGINS.length ? `, origins: ${ORIGINS.join(', ')}` : ''));
});

// Shut down promptly (systemctl stop/restart, certificate renewal). server.close() alone waits for
// every open connection to end, and phones and timers keep theirs open, so the process never
// exited by itself: systemd waited its 90 s stop timeout and then killed it. Close the sockets
// ("going away"; phones and timers reconnect by themselves) and don't wait more than 2 s.
function shutdown(sig) {
  console.log(`[remote] ${sig}: closing ${wss.clients.size} connections`);
  for (const ws of wss.clients) { try { ws.close(1001, 'server restarting'); } catch (_) { /* already gone */ } }
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => {
    for (const ws of wss.clients) ws.terminate();
    process.exit(0);
  }, 2000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
