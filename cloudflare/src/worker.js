/*!
 * The timer on Cloudflare: public/ is served as static files (wrangler.jsonc "assets"), README.md
 * for the in-app help, and the pairing server at /ws, speaking exactly remote-server.js's
 * protocol (see that file and "Phone Remote Control" in CLAUDE.md) as Durable Objects:
 *
 *   Room   one per room code (idFromName(room)). Holds the timer's socket ("host"), the phones'
 *          and any computers claiming a pairing code, with hibernation: idle rooms cost nothing.
 *          Keeps the key hashes and the pairing state in storage; alarms do the 30 s code changes,
 *          the 20 s claim wait and dropping a room 2 minutes after its timer went away.
 *   Codes  one in all: pairing code -> room, and wrong guesses per network (5 a minute).
 *
 * Clients say where they're going in the URL: /ws?room=<room> (timer, phones, Companion, the
 * PowerPoint machines) or /ws?code=<6 digits> (a computer typing a pairing code), so the Worker
 * hands the socket straight to its Room. Clients from before that (no ?room=) still work: the
 * Worker reads their first message and relays (relay()).
 *
 * The same-network test for pairing codes compares CF-Connecting-IP (IPv4, or the IPv6 /64).
 * Nobody sends pings: clients send {type:'ping'} every 25 s, answered with {type:'pong'} by the
 * runtime without waking the Room (setWebSocketAutoResponse).
 * MIT Licensed
 */

import { DurableObject } from 'cloudflare:workers';
import README from '../../README.md';

const PROTOCOL = 6;                      // as remote-server.js
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_MSGS_PER_SEC = 40;             // per socket; extra messages are dropped
const MAX_PHONES_PER_ROOM = 16;
const HOST_GRACE_MS = 2 * 60 * 1000;     // keep a room while its timer reconnects
const CODE_MS = 30 * 1000;               // a pairing code changes this often...
const CODE_GRACE_MS = 10 * 1000;         // ...and the one before still works this much longer
const CLAIM_WAIT_MS = 20 * 1000;         // how long a claimed code waits for the timer's answer
const MAX_CODE_FAILS = 5;                // wrong codes per network per minute
const MAX_FRAG = 2048;                   // a granted link

const validRoom = r => typeof r === 'string' && /^[A-Za-z0-9]{6,32}$/.test(r);
const validKey = k => typeof k === 'string' && k.length >= 16 && k.length <= 128;
const validCode = c => typeof c === 'string' && /^\d{6}$/.test(c);

async function hash(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function same(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const e = new TextEncoder();
  return crypto.subtle.timingSafeEqual(e.encode(a), e.encode(b));
}
const randomHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, '0')).join('');
const randomCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');

// The network an address belongs to: IPv4 as is, IPv6 by its /64. Private and loopback addresses
// are one 'local' network (only seen in local testing here).
function netOf(addr) {
  let a = String(addr || '').replace(/^::ffff:/, '');
  if (!a || a === '::1' || /^(127|10)\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a) ||
      /^169\.254\./.test(a) || /^f[cd]/i.test(a) || /^fe80:/i.test(a)) return 'local';
  if (a.includes(':')) a = a.split(':').slice(0, 4).join(':') + '::/64';
  return a;
}

function send(ws, obj) {
  if (!ws) return;
  try { ws.send(JSON.stringify(obj)); } catch (_) { /* closing */ }
}
function close(ws) {
  try { ws.close(1000); } catch (_) { /* already closed */ }
}

// Features on trial (wrangler.jsonc vars FEATURES, comma separated; public/features.js is the page side).
// 'pptx': PowerPoint computers. Without it the PowerPoint pages aren't served and the PowerPoint key is refused.
const feature = (env, name) => String(env.FEATURES || '').split(',').map(s => s.trim()).includes(name);
const PPTX_FILES = ['/pptx.html', '/pptx-receiver.js', '/Pptx-WsController.ps1'];

const codesOf = env => env.CODES.get(env.CODES.idFromName('codes'));
const roomOf = (env, room) => env.ROOMS.get(env.ROOMS.idFromName(room));

// ─── Worker ───────────────────────────────────────────────────────────────────

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/README.md') {
      return new Response(README, { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' } });
    }
    if (url.pathname === '/ws') return socket(req, env, url);
    if (PPTX_FILES.includes(url.pathname) && !feature(env, 'pptx')) return new Response('Not found', { status: 404 });   // (run_worker_first)
    if (url.pathname === '/') return Response.redirect(new URL('/timer.html' + url.search, url).href, 302);
    if (url.pathname === '/o' || url.pathname === '/o/') return Response.redirect(new URL('/overlay.html' + url.search, url).href, 302);   // short, to type
    return env.ASSETS.fetch(req);      // anything that isn't a file: the 404
  },
};

async function socket(req, env, url) {
  if (req.headers.get('Upgrade') !== 'websocket') {
    return new Response(`timer remote server ok, protocol ${PROTOCOL} (Cloudflare)\n`, { headers: { 'content-type': 'text/plain' } });
  }
  // Browsers always send Origin: only this site's own pages (and any in ORIGINS) may connect.
  // Programs (the PowerPoint player, Companion) send none; they still need a key.
  const origin = req.headers.get('Origin');
  const allowed = [url.origin, ...String(env.ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)];
  if (origin && !allowed.includes(origin)) return new Response('Origin not allowed', { status: 403 });

  const net = netOf(req.headers.get('CF-Connecting-IP'));
  const code = url.searchParams.get('code'), room = url.searchParams.get('room');
  if (validCode(code)) {
    const r = await codesOf(env).lookup(code, net);
    return r.room ? toRoom(env, r.room, net, code) : refuse(r.reason);
  }
  if (validRoom(room)) return toRoom(env, room, net, '');
  return relay(env, net);
}

function toRoom(env, room, net, code) {
  return roomOf(env, room).fetch('https://room/ws', { headers: { Upgrade: 'websocket', 'x-net': net, 'x-room': room, 'x-code': code } });
}

// A socket that only says why it can't go anywhere (a bad pairing code, too many tries)
function refuse(reason) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  send(server, { type: 'error', reason });
  close(server);
  return new Response(null, { status: 101, webSocket: client });
}

// For clients that don't say ?room= or ?code=: take their first message, find the room from it,
// then pass everything through both ways.
function relay(env, net) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  let inner = null, queue = null;
  server.addEventListener('message', async ev => {
    if (inner) { try { inner.send(ev.data); } catch (_) { close(server); } return; }
    if (queue) { queue.push(ev.data); return; }
    queue = [ev.data];
    let m = null;
    try { m = JSON.parse(ev.data); } catch (_) { /* not JSON */ }
    let room = m && validRoom(m.room) ? m.room : null, code = '';
    if (m && m.type === 'claim' && validCode(m.code)) {
      const r = await codesOf(env).lookup(m.code, net);
      if (!r.room) { send(server, { type: 'error', reason: r.reason }); return close(server); }
      room = r.room; code = m.code;
    }
    if (!room) { send(server, { type: 'error', reason: 'bad-request' }); return close(server); }
    const res = await toRoom(env, room, net, code);
    const ws = res.webSocket;
    if (!ws) return close(server);
    ws.accept();
    ws.addEventListener('message', e => { try { server.send(e.data); } catch (_) { close(ws); } });
    ws.addEventListener('close', () => close(server));
    for (const d of queue) ws.send(d);
    inner = ws;
  });
  server.addEventListener('close', () => { if (inner) close(inner); });
  return new Response(null, { status: 101, webSocket: client });
}

// ─── Room ─────────────────────────────────────────────────────────────────────
// Each socket's attachment: { role: null|'host'|'phone'|'claim'|'gone', net, room, code, id, phoneRole }
// Storage 'room': { id, keyHash, viewHash, adminHash, compHash, pptxHash, hostGoneAt,
//                   pair: { code, until, prev, prevUntil, next } | null, claims: { id: deadline } }

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rate = new WeakMap();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
    ctx.blockConcurrencyWhile(async () => { this.s = (await ctx.storage.get('room')) || null; });
  }

  async fetch(req) {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: null, net: req.headers.get('x-net') || '', room: req.headers.get('x-room') || '', code: req.headers.get('x-code') || '' });
    return new Response(null, { status: 101, webSocket: client });
  }

  sockets(role) {
    return this.ctx.getWebSockets().filter(ws => { const a = ws.deserializeAttachment(); return a && a.role === role; });
  }
  host() { return this.sockets('host')[0] || null; }
  byId(role, id) {
    return this.ctx.getWebSockets().find(ws => { const a = ws.deserializeAttachment(); return a && a.role === role && a.id === id; }) || null;
  }
  // Takes a socket out of the room before closing it, so its close does nothing more
  retire(ws) {
    try { ws.serializeAttachment({ ...(ws.deserializeAttachment() || {}), role: 'gone' }); } catch (_) { /* closed */ }
  }
  save() { return this.s ? this.ctx.storage.put('room', this.s) : this.ctx.storage.delete('room'); }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string') return;
    if (raw.length > MAX_MESSAGE_BYTES) { try { ws.close(1009, 'too big'); } catch (_) { /* closed */ } return; }
    const now = Date.now();
    let r = this.rate.get(ws);
    if (!r || now - r.start > 1000) this.rate.set(ws, r = { start: now, n: 0 });
    if (++r.n > MAX_MSGS_PER_SEC) return;

    let m;
    try { m = JSON.parse(raw); } catch (_) { return; }
    if (!m || typeof m !== 'object') return;
    const a = ws.deserializeAttachment() || {};
    if (a.role === 'gone') return;

    if (!a.role && m.type === 'claim') return this.claim(ws, a, m);
    if (!a.role) {
      if (m.room !== a.room || !validKey(m.key)) { send(ws, { type: 'error', reason: 'bad-request' }); return close(ws); }
      const keyHash = await hash(m.key);
      if (m.type === 'host') return this.hostJoin(ws, a, m, keyHash);
      if (m.type === 'join') return this.phoneJoin(ws, a, keyHash);
      send(ws, { type: 'error', reason: 'bad-request' });
      return close(ws);
    }

    const s = this.s;
    if (!s) return;
    if (a.role === 'host' && m.type === 'to') {
      send(this.byId('phone', m.id), { type: 'down', msg: m.msg });
    } else if (a.role === 'host' && m.type === 'pair') {
      await this.stopCodes();
      if (m.on) await this.issueCode();
      await this.save(); this.schedule();
    } else if (a.role === 'host' && (m.type === 'grant' || m.type === 'deny')) {
      const cl = this.byId('claim', m.id);
      if (!cl) return;
      delete s.claims[m.id];
      this.retire(cl);
      if (m.type === 'grant' && typeof m.frag === 'string' && m.frag.length <= MAX_FRAG) send(cl, { type: 'granted', frag: m.frag });
      else send(cl, { type: 'error', reason: 'refused' });
      close(cl);
      await this.save(); this.schedule();
    } else if (a.role === 'phone' && m.type === 'up') {
      send(this.host(), { type: 'from', id: a.id, msg: m.msg });
    }
  }

  async hostJoin(ws, a, m, keyHash) {
    let s = this.s;
    if (s && !same(s.keyHash, keyHash)) { send(ws, { type: 'error', reason: 'room-taken' }); return close(ws); }
    if (!s) s = this.s = { id: a.room, keyHash, viewHash: null, adminHash: null, compHash: null, pptxHash: null, hostGoneAt: null, pair: null, claims: {} };
    // The view-only, admin, Companion and PowerPoint keys may change (the timer made new ones):
    // phones using an old one are dropped
    const h = {
      view: validKey(m.viewKey) ? await hash(m.viewKey) : null,
      admin: validKey(m.adminKey) ? await hash(m.adminKey) : null,
      companion: validKey(m.compKey) ? await hash(m.compKey) : null,
      pptx: validKey(m.pptxKey) && feature(this.env, 'pptx') ? await hash(m.pptxKey) : null,
    };
    const changed = { view: s.viewHash && s.viewHash !== h.view, admin: s.adminHash && s.adminHash !== h.admin,
      companion: s.compHash && s.compHash !== h.companion, pptx: s.pptxHash && s.pptxHash !== h.pptx };
    for (const p of this.sockets('phone')) {
      if (changed[p.deserializeAttachment().phoneRole]) { this.retire(p); send(p, { type: 'error', reason: 'room-closed' }); close(p); }
    }
    Object.assign(s, { viewHash: h.view, adminHash: h.admin, compHash: h.companion, pptxHash: h.pptx, hostGoneAt: null });
    for (const old of this.sockets('host')) { this.retire(old); close(old); }      // newest timer window wins
    ws.serializeAttachment({ ...a, role: 'host' });
    await this.save(); this.schedule();
    send(ws, { type: 'hosted', room: a.room, protocol: PROTOCOL });
    for (const p of this.sockets('phone')) {
      const pa = p.deserializeAttachment();
      send(ws, { type: 'peer-join', id: pa.id, role: pa.phoneRole });
      send(p, { type: 'host-online' });
    }
  }

  phoneJoin(ws, a, keyHash) {
    const s = this.s;
    // Which key decides the role. The timer is told, and enforces it.
    const role = !s ? null
               : same(s.adminHash, keyHash) ? 'admin'
               : same(s.compHash, keyHash) ? 'companion'
               : same(s.pptxHash, keyHash) ? 'pptx'
               : same(s.keyHash, keyHash) ? 'control'
               : same(s.viewHash, keyHash) ? 'view' : null;
    if (!role) { send(ws, { type: 'error', reason: 'not-found' }); return close(ws); }
    if (this.sockets('phone').length >= MAX_PHONES_PER_ROOM) { send(ws, { type: 'error', reason: 'room-full' }); return close(ws); }
    const id = randomHex(6), host = this.host();
    ws.serializeAttachment({ ...a, role: 'phone', id, phoneRole: role });
    send(ws, { type: 'joined', id, hostOnline: !!host, role });
    send(host, { type: 'peer-join', id, role });
  }

  // A computer typed a pairing code (the Worker found this room from it)
  async claim(ws, a, m) {
    const s = this.s, p = s && s.pair, now = Date.now(), host = this.host();
    const live = !!p && validCode(m.code) && m.code === a.code &&
      ((m.code === p.code && p.until >= now) || (m.code === p.prev && p.prevUntil >= now));
    if (!live || !host) { await codesOf(this.env).fail(a.net); send(ws, { type: 'error', reason: 'bad-code' }); return close(ws); }
    if (host.deserializeAttachment().net !== a.net) { await codesOf(this.env).fail(a.net); send(ws, { type: 'error', reason: 'other-network' }); return close(ws); }
    await this.stopCodes();                           // used: no more codes until the timer asks again
    const id = randomHex(6);
    ws.serializeAttachment({ ...a, role: 'claim', id });
    s.claims[id] = now + CLAIM_WAIT_MS;
    await this.save(); this.schedule();
    send(ws, { type: 'claim-wait' });
    send(host, { type: 'claim', id });
  }

  async issueCode() {
    const s = this.s, now = Date.now(), codes = codesOf(this.env), old = s.pair;
    let code = null;
    for (let i = 0; i < 10 && !code; i++) {
      const c = randomCode();
      if (await codes.register(c, s.id, now + CODE_MS + CODE_GRACE_MS)) code = c;
    }
    if (!code) return;
    if (old && old.code) await codes.register(old.code, s.id, now + CODE_GRACE_MS);   // the old one: a little longer
    s.pair = { code, until: now + CODE_MS + CODE_GRACE_MS, prev: old ? old.code : null, prevUntil: now + CODE_GRACE_MS, next: now + CODE_MS };
    send(this.host(), { type: 'pair-code', code, ms: CODE_MS });
  }

  async stopCodes() {
    if (!this.s || !this.s.pair) return;
    this.s.pair = null;
    await codesOf(this.env).release(this.s.id);
  }

  async webSocketClose(ws) { await this.gone(ws); close(ws); }
  async webSocketError(ws) { await this.gone(ws); }

  async gone(ws) {
    const a = ws.deserializeAttachment() || {};
    this.retire(ws);
    const s = this.s;
    if (!s || !a.role || a.role === 'gone') return;
    if (a.role === 'claim') {
      delete s.claims[a.id];
      await this.save(); this.schedule();
    } else if (a.role === 'host') {
      if (this.host()) return;
      await this.stopCodes();
      s.hostGoneAt = Date.now();
      await this.save(); this.schedule();
      for (const p of this.sockets('phone')) send(p, { type: 'host-offline' });
    } else if (a.role === 'phone') {
      send(this.host(), { type: 'peer-leave', id: a.id });
    }
  }

  async alarm() {
    const s = this.s;
    if (!s) return;
    const now = Date.now();
    for (const [id, until] of Object.entries(s.claims)) {
      if (until > now) continue;
      delete s.claims[id];
      const cl = this.byId('claim', id);
      if (cl) { this.retire(cl); send(cl, { type: 'error', reason: 'no-answer' }); close(cl); }
    }
    if (s.pair && s.pair.next <= now) {
      if (this.host()) await this.issueCode(); else await this.stopCodes();
    }
    if (!this.host() && s.hostGoneAt && now - s.hostGoneAt >= HOST_GRACE_MS) return this.dropRoom();
    await this.save(); this.schedule();
  }

  async dropRoom() {
    await this.stopCodes();
    for (const ws of this.ctx.getWebSockets()) { this.retire(ws); send(ws, { type: 'error', reason: 'room-closed' }); close(ws); }
    this.s = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // One alarm for everything due: claim timeouts, the next code, dropping the room
  schedule() {
    const s = this.s;
    if (!s) return;
    const due = [...Object.values(s.claims), s.pair ? s.pair.next : 0, s.hostGoneAt && !this.host() ? s.hostGoneAt + HOST_GRACE_MS : 0].filter(Boolean);
    if (due.length) this.ctx.storage.setAlarm(Math.min(...due));
    else this.ctx.storage.deleteAlarm();
  }
}

// ─── Codes ────────────────────────────────────────────────────────────────────
// Storage: 'c:<code>' -> { room, until }; 'f:<network>' -> { n, since } (wrong codes this minute)

export class Codes extends DurableObject {
  // Takes a code for a room until `until`; false if another room has it
  async register(code, room, until) {
    const now = Date.now(), k = 'c:' + code, v = await this.ctx.storage.get(k);
    if (v && v.room !== room && v.until >= now) return false;
    await this.ctx.storage.put(k, { room, until });
    await this.tidy(now);
    return true;
  }

  async release(room) {
    const del = [...(await this.ctx.storage.list({ prefix: 'c:' }))].filter(([, v]) => v.room === room).map(([k]) => k);
    if (del.length) await this.ctx.storage.delete(del);
  }

  async lookup(code, net) {
    const now = Date.now(), f = await this.ctx.storage.get('f:' + net);
    if (f && now - f.since <= 60000 && f.n >= MAX_CODE_FAILS) return { reason: 'too-many' };
    const v = await this.ctx.storage.get('c:' + code);
    if (!v || v.until < now) { await this.fail(net); return { reason: 'bad-code' }; }
    return { room: v.room };
  }

  async fail(net) {
    const now = Date.now(), k = 'f:' + net, f = await this.ctx.storage.get(k);
    await this.ctx.storage.put(k, !f || now - f.since > 60000 ? { n: 1, since: now } : { n: f.n + 1, since: f.since });
  }

  // Expired codes and old counts, at most once a minute
  async tidy(now) {
    if (now - (this.tidied || 0) < 60000) return;
    this.tidied = now;
    const del = [];
    for (const [k, v] of await this.ctx.storage.list()) {
      if ((k.startsWith('c:') && v.until < now) || (k.startsWith('f:') && now - v.since > 60000)) del.push(k);
    }
    for (let i = 0; i < del.length; i += 128) await this.ctx.storage.delete(del.slice(i, i + 128));
  }
}
