#!/usr/bin/env node
/*!
 * remote-server.js  (EXPERIMENTAL)
 * Pairing server for phone remote control of the Presentation Timer.
 *
 * Runs on its own port (default 8443) with your TLS certificate, so the timer can stay on
 * a static host. It only:
 *   - pairs a timer ("host") with phones using a room code + secret key (from the QR code),
 *     or a second, view-only key, or a third, admin key, or a Companion key, or a PowerPoint key.
 *     Which key a phone used decides its role ('control', 'view', 'admin', 'companion' or
 *     'pptx'), which is reported to the timer; the timer enforces it (view: no commands; admin:
 *     may also set up other computers; pptx: only the PowerPoint machines' own messages),
 *   - forwards WebRTC signalling so phone and timer can try a direct LAN connection, and
 *   - relays the (small) control/state messages when a direct connection isn't possible, and
 *   - pairs a computer by a 6-digit code instead of a link (protocol 6): while the timer asks
 *     for it, the server shows it a code that changes every 30 s; a computer that types it gets
 *     a link from the timer, passed on once (any network: the timer's proximity check then
 *     guards the new device; 'kick' drops one that fails it), and
 *   - the other way round (protocol 7): a device with no keyboard of its own but a screen only its
 *     wearer can read (Even G2 glasses) asks for a code of its own and shows it; the timer types it
 *     and sends that device its link, sealed with a public key the device sent (so the server,
 *     which holds it until the device collects it, can't read it).
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
const PROTOCOL = 7;   // 2: view-only keys, 3: admin keys, 4: companion keys, 5: PowerPoint keys, 6: pairing codes, 7: device codes (offers)
const MAX_MESSAGE_BYTES = 16 * 1024;     // signalling + state messages are tiny
const MAX_MSGS_PER_SEC = 40;             // per socket; extra messages are dropped
const MAX_PHONES_PER_ROOM = 16;          // controllers + view-only displays
const HOST_GRACE_MS = 2 * 60 * 1000;     // keep a room while its timer reconnects
const PING_MS = 25 * 1000;
const CODE_MS = 30 * 1000;               // a pairing code changes this often...
const CODE_GRACE_MS = 10 * 1000;         // ...and the one before still works this much longer (typed as it changed)
const CLAIM_WAIT_MS = 20 * 1000;         // how long a claimed code waits for the timer's answer
const MAX_CODE_FAILS = 5;                // wrong codes per address per minute
const MAX_FRAG = 2048;                   // a granted link
const OFFER_MS = 10 * 60 * 1000;         // a device's own code (an offer) lasts this long, waiting to be typed and collected
const TAKE_MS = 60 * 1000;               // a timer that typed it has this long to send the link
const MAX_SEALED = 4096;                 // a sealed link
const MAX_OFFERS_PER_NET = 5;

if (!INSECURE && (!CERT || !KEY)) {
  console.error('Need --cert and --key (TLS certificate and private key), or --insecure for local testing.');
  process.exit(1);
}
if (!ORIGINS.length) console.warn('[remote] WARNING: no --origin given, so any website may connect. Set --origin https://your-timer-site');

// ─── Rooms ────────────────────────────────────────────────────────────────────

// room id -> { keyHash, viewHash, adminHash, compHash, pptxHash, host: ws|null, phones: Map<id, {ws, role}>, hostGoneAt }
// role: 'control' (joined with the room key), 'view' (view-only key), 'admin' (admin key) or
// 'companion' (companion key: Bitfocus Companion and other automation, full API on the timer) or
// 'pptx' (PowerPoint key: the receiver page and PowerShell player on a PowerPoint machine)
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
  stopCodes(room);
  for (const p of room.phones.values()) { send(p.ws, { type: 'error', reason: 'room-closed' }); p.ws.close(); }
  rooms.delete(id);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (!room.host && room.hostGoneAt && now - room.hostGoneAt > HOST_GRACE_MS) dropRoom(id);
  }
}, 30 * 1000);

// ─── Pairing codes (protocol 6) ───────────────────────────────────────────────
// The timer sends {type:'pair', on:true} and gets {type:'pair-code', code, ms} every 30 s until
// it sends on:false (or a code is used, or it goes away). Another computer opens a socket and sends
// {type:'claim', code}; if the code is live (from any network: the timer's proximity check then
// guards the new device), the timer gets {type:'claim', id} and answers {type:'grant', id, frag} (a
// link for that computer) or {type:'deny', id}; the computer gets {type:'granted', frag} or an
// error. A code works once. The server stores no keys: the link passes through, once.

const codes = new Map();          // code -> { roomId, until }
const claims = new Map();         // claim id -> { ws, roomId }
const codeFails = new Map();      // address -> { n, since }

// The address a socket came from, comparable: IPv4 as is, IPv6 by its /64 (the network part).
// Private and loopback addresses are all one 'local' network: they reach the server directly
// (a server on the venue LAN, or local testing), where a public server sees one router address.
function netOf(addr) {
  let a = String(addr || '').replace(/^::ffff:/, '');
  if (a === '::1' || /^(127|10)\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a) ||
      /^169\.254\./.test(a) || /^f[cd]/i.test(a) || /^fe80:/i.test(a)) return 'local';
  if (a.includes(':')) a = a.split(':').slice(0, 4).join(':') + '::/64';
  return a;
}

function newCode() {
  for (;;) {
    const c = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    if (!codes.has(c) && !offerCodes.has(c)) return c;
  }
}
function issueCode(roomId) {
  const room = rooms.get(roomId);
  if (!room || !room.host) return;
  const now = Date.now();
  for (const [c, v] of codes) if (v.until < now) codes.delete(c);
  if (room.code && codes.has(room.code)) codes.get(room.code).until = now + CODE_GRACE_MS;   // the old one: a little longer
  room.code = newCode();
  codes.set(room.code, { roomId, until: now + CODE_MS + CODE_GRACE_MS });
  send(room.host, { type: 'pair-code', code: room.code, ms: CODE_MS });
}
function stopCodes(room) {
  clearInterval(room.codeTimer);
  room.codeTimer = null; room.code = null;
  for (const [c, v] of codes) if (rooms.get(v.roomId) === room) codes.delete(c);
}
function codeFailed(net) {
  const now = Date.now(), f = codeFails.get(net);
  if (!f || now - f.since > 60000) codeFails.set(net, { n: 1, since: now });
  else f.n++;
}
const tooManyFails = net => { const f = codeFails.get(net); return !!f && Date.now() - f.since <= 60000 && f.n >= MAX_CODE_FAILS; };
const validCode = c => typeof c === 'string' && /^\d{6}$/.test(c);

// ─── Device codes (protocol 7) ────────────────────────────────────────────────
// The other way round from pairing codes, for a device whose screen only its wearer can read (Even
// G2 glasses), so typing the code it shows proves the timer's operator is the wearer (no proximity
// check: the link comes with a token). The device opens a socket and sends {type:'offer', secret,
// pub?, client, mode, name}; it gets {type:'offer-code', code, ms} (the same code again when it
// reconnects with the same secret, as a phone app in the background has to). The timer sends
// {type:'take', code} and gets {type:'took', code, pub, client, mode, name} (or take-error
// {code, reason}); the device is told {type:'offer-taken'}. Then the timer sends {type:'give', code,
// sealed} (its link encrypted for pub; or frag, a plain one, for a device without pub) and gets
// {type:'given', code, delivered}. The device gets {type:'granted', sealed|frag} now or when it next
// connects, within OFFER_MS; then the offer is gone (or when the device sends {type:'cancel'}).
// Wrong codes count against the timer's address.

const offers = new Map();         // hash of the secret -> { code, pub, client, mode, name, net, until, ws, takenBy, takenUntil, sealed, frag, timer }
const offerCodes = new Map();     // code -> hash of the secret
const clean = (v, re, max) => typeof v === 'string' && v.length <= max && re.test(v) ? v : '';

function dropOffer(id) {
  const o = offers.get(id);
  if (!o) return;
  clearTimeout(o.timer);
  if (offerCodes.get(o.code) === id) offerCodes.delete(o.code);
  offers.delete(id);
}
function deliver(id) {
  const o = offers.get(id);
  if (!o || !o.ws || !(o.sealed || o.frag)) return false;
  send(o.ws, o.sealed ? { type: 'granted', sealed: o.sealed } : { type: 'granted', frag: o.frag });
  const ws = o.ws;
  dropOffer(id);
  ws.close();
  return true;
}
function offerJoin(ws, m) {
  if (!clean(m.secret, /^[\w-]{22,64}$/, 64)) { send(ws, { type: 'error', reason: 'bad-request' }); ws.close(); return null; }
  const id = hash('offer:' + m.secret), now = Date.now();
  let o = offers.get(id);
  if (!o) {
    let n = 0;
    for (const x of offers.values()) if (x.net === ws.net) n++;
    // (not for 'local': this machine or a server on the venue's network)
    if (n >= MAX_OFFERS_PER_NET && ws.net !== 'local') { send(ws, { type: 'error', reason: 'too-many' }); ws.close(); return null; }
    o = { code: newCode(), pub: clean(m.pub, /^[\w-]+$/, 200), client: clean(m.client, /^[\w-]+$/, 16), mode: m.mode === 'operator' ? 'operator' : 'presenter',
      name: typeof m.name === 'string' ? m.name.replace(/[\u0000-\u001f]/g, '').slice(0, 40) : '', net: ws.net, until: now + OFFER_MS, ws: null };
    o.timer = setTimeout(() => { const x = offers.get(id); if (x && x.ws) { send(x.ws, { type: 'error', reason: 'expired' }); x.ws.close(); } dropOffer(id); }, OFFER_MS);
    offers.set(id, o);
    offerCodes.set(o.code, id);
  }
  if (o.ws && o.ws !== ws) o.ws.close();          // the same device again (a new socket): this one wins
  o.ws = ws;
  if (!deliver(id)) send(ws, o.takenBy && o.takenUntil >= now ? { type: 'offer-taken' } : { type: 'offer-code', code: o.code, ms: o.until - now });
  return id;
}
// The timer typed a device's code
function take(ws, roomId, m) {
  const now = Date.now(), code = validCode(m.code) ? m.code : '';
  if (tooManyFails(ws.net)) return send(ws, { type: 'take-error', code, reason: 'too-many' });
  const id = code ? offerCodes.get(code) : null, o = id ? offers.get(id) : null;
  if (!o || o.until < now || (o.takenBy && o.takenBy !== roomId && o.takenUntil >= now)) {
    codeFailed(ws.net);
    return send(ws, { type: 'take-error', code, reason: 'bad-code' });
  }
  o.takenBy = roomId; o.takenUntil = now + TAKE_MS;
  send(o.ws, { type: 'offer-taken' });
  send(ws, { type: 'took', code, pub: o.pub, client: o.client, mode: o.mode, name: o.name });
}
function give(ws, roomId, m) {
  const now = Date.now(), code = validCode(m.code) ? m.code : '';
  const id = code ? offerCodes.get(code) : null, o = id ? offers.get(id) : null;
  // Sealed for a device that sent a key; plain only for one that didn't
  const sealed = o && o.pub && typeof m.sealed === 'string' && m.sealed.length <= MAX_SEALED ? m.sealed : '';
  const frag = o && !o.pub && typeof m.frag === 'string' && m.frag.length <= MAX_FRAG ? m.frag : '';
  if (!o || o.takenBy !== roomId || o.takenUntil < now || !(sealed || frag)) return send(ws, { type: 'take-error', code, reason: 'gone' });
  o.sealed = sealed; o.frag = frag;
  offerCodes.delete(code);                        // used: nobody else can take it now
  send(ws, { type: 'given', code, delivered: deliver(id) });
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = INSECURE
  ? http.createServer()
  : https.createServer({ cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) });

server.on('request', (req, res) => {
  // Plain HTTPS requests: a health check, and a page so you can accept a self-signed cert
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`timer remote server ok, protocol ${PROTOCOL} (view-only, admin, companion and PowerPoint links, pairing codes, device codes) (${rooms.size} rooms)\n`);
});

const wss = new WebSocketServer({
  server,
  maxPayload: MAX_MESSAGE_BYTES,
  verifyClient: (info, done) => {
    const origin = info.origin || info.req.headers.origin;
    // Browsers always send Origin, so it stops other websites using the server. Programs that
    // aren't browsers (the PowerPoint player, Companion) may send none; they still need a key.
    if (ORIGINS.length && origin && !ORIGINS.includes(origin)) {
      console.warn('[remote] rejected origin', origin);
      return done(false, 403, 'Origin not allowed');
    }
    done(true);
  },
});

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.net = netOf(req.socket.remoteAddress);
  ws.on('pong', () => { ws.isAlive = true; });
  // Must be handled: an oversized or malformed frame emits 'error', and an unhandled
  // 'error' would crash the whole server. ws closes the socket itself afterwards.
  ws.on('error', err => console.warn('[remote] socket error:', err.code || err.message));
  let role = null, roomId = null, phoneId = null, claimId = null, offerId = null;
  let windowStart = Date.now(), count = 0;

  ws.on('message', raw => {
    // simple rate limit
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; count = 0; }
    if (++count > MAX_MSGS_PER_SEC) return;

    let m;
    try { m = JSON.parse(raw); } catch (_) { return; }
    if (!m || typeof m !== 'object') return;

    if (!role && m.type === 'claim') {                // a computer typed a pairing code
      if (tooManyFails(ws.net)) { send(ws, { type: 'error', reason: 'too-many' }); return ws.close(); }
      const c = typeof m.code === 'string' && /^\d{6}$/.test(m.code) ? codes.get(m.code) : null;
      const room = c && c.until >= Date.now() ? rooms.get(c.roomId) : null;
      if (!room || !room.host) { codeFailed(ws.net); send(ws, { type: 'error', reason: 'bad-code' }); return ws.close(); }
      stopCodes(room);                                // used: no more codes until the timer asks again
      claimId = crypto.randomBytes(6).toString('hex');
      claims.set(claimId, { ws, roomId: c.roomId });
      role = 'claim'; roomId = c.roomId;
      send(ws, { type: 'claim-wait' });
      send(room.host, { type: 'claim', id: claimId });
      setTimeout(() => { if (claims.has(claimId)) { send(ws, { type: 'error', reason: 'no-answer' }); ws.close(); } }, CLAIM_WAIT_MS);
      return;
    }

    if (!role && m.type === 'offer') {                // a device asks for a code of its own (protocol 7)
      offerId = offerJoin(ws, m);
      if (offerId) role = 'offer';
      return;
    }
    if (role === 'offer') {
      const o = offers.get(offerId);
      if (m.type === 'cancel' && o && o.ws === ws) { dropOffer(offerId); ws.close(); }
      return;
    }

    if (!role) {
      if (!validRoom(m.room) || !validKey(m.key)) { send(ws, { type: 'error', reason: 'bad-request' }); return ws.close(); }
      const keyHash = hash(m.key);

      if (m.type === 'host') {
        let room = rooms.get(m.room);
        if (room && !safeEqual(room.keyHash, keyHash)) { send(ws, { type: 'error', reason: 'room-taken' }); return ws.close(); }
        if (!room) { room = { keyHash, viewHash: null, adminHash: null, compHash: null, pptxHash: null, host: null, phones: new Map(), hostGoneAt: null }; rooms.set(m.room, room); }
        // The view-only and admin keys may change (the timer made new ones): phones using an old one are dropped
        const viewHash = validKey(m.viewKey) ? hash(m.viewKey) : null;
        const adminHash = validKey(m.adminKey) ? hash(m.adminKey) : null;
        const compHash = validKey(m.compKey) ? hash(m.compKey) : null;
        const pptxHash = validKey(m.pptxKey) ? hash(m.pptxKey) : null;
        const changed = { view: room.viewHash && room.viewHash !== viewHash, admin: room.adminHash && room.adminHash !== adminHash,
          companion: room.compHash && room.compHash !== compHash, pptx: room.pptxHash && room.pptxHash !== pptxHash };
        for (const [id, p] of room.phones) {
          if (changed[p.role]) { send(p.ws, { type: 'error', reason: 'room-closed' }); p.ws.close(); room.phones.delete(id); }
        }
        room.viewHash = viewHash;
        room.adminHash = adminHash;
        room.compHash = compHash;
        room.pptxHash = pptxHash;
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
                        : room.pptxHash && safeEqual(room.pptxHash, keyHash) ? 'pptx'
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
    } else if (role === 'host' && m.type === 'pair') {
      stopCodes(room);
      if (m.on) { issueCode(roomId); room.codeTimer = setInterval(() => issueCode(roomId), CODE_MS); }
    } else if (role === 'host' && (m.type === 'grant' || m.type === 'deny')) {
      const cl = claims.get(m.id);
      if (!cl || cl.roomId !== roomId) return;
      claims.delete(m.id);
      if (m.type === 'grant' && typeof m.frag === 'string' && m.frag.length <= MAX_FRAG) send(cl.ws, { type: 'granted', frag: m.frag });
      else send(cl.ws, { type: 'error', reason: 'refused' });
      cl.ws.close();
    } else if (role === 'host' && m.type === 'take') {
      take(ws, roomId, m);
    } else if (role === 'host' && m.type === 'give') {
      give(ws, roomId, m);
    } else if (role === 'host' && m.type === 'kick') {   // the timer drops a device (failed its proximity check)
      const p = room.phones.get(m.id);
      if (p) { room.phones.delete(m.id); send(p.ws, { type: 'error', reason: 'rejected' }); p.ws.close(); send(room.host, { type: 'peer-leave', id: m.id }); }
    } else if (role === 'phone' && m.type === 'up' && room.phones.get(phoneId)) {
      send(room.host, { type: 'from', id: phoneId, msg: m.msg });
    }
  });

  ws.on('close', () => {
    if (claimId) claims.delete(claimId);
    if (offerId) { const o = offers.get(offerId); if (o && o.ws === ws) o.ws = null; }   // kept for the device to come back to
    const room = rooms.get(roomId);
    if (!room) return;
    if (role === 'host' && room.host === ws) {
      stopCodes(room);
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
