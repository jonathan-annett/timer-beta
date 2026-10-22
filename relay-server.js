/*!
 * relay-server.js
 * Presentation Timer — Express server
 * Serves timer as static middleware, handles:
 *   WS /signal/:room  — WebRTC signalling
 *   WS /relay/:room   — WebSocket data relay (WS-first fallback)
 *
 * Usage:
 *   DOMAIN=https://timer.example.com PORT=3000 node relay-server.js
 *   node relay-server.js --domain https://timer.example.com --port 3000
 *
 * MIT Licensed
 */

'use strict';

const http    = require('http');
const path    = require('path');
const fs      = require('fs');
const { WebSocketServer, WebSocket } = require('ws');
const express = require('express');

// ─── Config ──────────────────────────────────────────────────────────────────

function getConfig() {
  const args = process.argv.slice(2);
  const arg  = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };

  const domain = arg('--domain') || process.env.DOMAIN || 'http://localhost:3000';
  const port   = parseInt(arg('--port') || process.env.PORT || '3000', 10);
  const staticDir = arg('--static') || process.env.STATIC_DIR ||
                    path.join(__dirname, 'public');

  return { domain, port, staticDir };
}

const config = getConfig();
console.log(`[timer-relay] domain=${config.domain} port=${config.port} static=${config.staticDir}`);

// ─── Room management ──────────────────────────────────────────────────────────

const ROOM_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

class Room {
  constructor(code) {
    this.code        = code;
    this.controller  = null;   // WebSocket | null
    this.viewers     = new Set();
    this.lastActivity = Date.now();
    this.latestState  = null;  // last full setVariableValues snapshot for fast viewer sync
  }

  touch() { this.lastActivity = Date.now(); }
  isExpired() { return Date.now() - this.lastActivity > ROOM_TTL_MS; }

  broadcast(msg, excludeSocket) {
    const str = typeof msg === 'string' ? msg : JSON.stringify(msg);
    this.viewers.forEach(ws => {
      if (ws !== excludeSocket && ws.readyState === WebSocket.OPEN) {
        ws.send(str);
      }
    });
  }

  sendToController(msg) {
    if (this.controller && this.controller.readyState === WebSocket.OPEN) {
      this.controller.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
  }
}

const rooms = new Map();

function getOrCreateRoom(code) {
  code = code.toUpperCase();
  if (!rooms.has(code)) rooms.set(code, new Room(code));
  return rooms.get(code);
}

// GC expired rooms every 15 minutes
setInterval(() => {
  for (const [code, room] of rooms.entries()) {
    if (room.isExpired()) {
      room.viewers.forEach(ws => ws.terminate());
      if (room.controller) room.controller.terminate();
      rooms.delete(code);
      console.log(`[timer-relay] GC room ${code}`);
    }
  }
}, 15 * 60 * 1000);

// ─── Room code generation ─────────────────────────────────────────────────────

const WORDS = [
  'AMBER','BASIN','CEDAR','DEPOT','EMBER','FLINT','GROVE','HAVEN',
  'IVORY','JADE','KARMA','LUNAR','MAPLE','NORTH','OCEAN','PRISM',
  'QUILL','RIVER','STONE','TIGER','ULTRA','VAPOR','WHALE','XENON',
  'YIELD','ZEBRA','ADOBE','BLAZE','CRANE','DELTA','EAGLE','FORGE',
  'GLIDE','HERON','INKWELL','JOULE','KNOLL','LANCE','MANOR','NOBLE',
  'ORBIT','PEARL','QUEST','RANCH','SHORE','TROVE','UMBRA','VIOLA',
];
const NUMS = ['2','3','4','5','6','7','8','9'];

function generateRoomCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const w = WORDS[Math.floor(Math.random() * WORDS.length)];
    const n = NUMS[Math.floor(Math.random() * NUMS.length)];
    const code = `${w}-${n}`;
    const existing = rooms.get(code);
    // Allow reuse if no live controller
    if (!existing || !existing.controller || existing.controller.readyState !== WebSocket.OPEN) {
      return code;
    }
  }
  // Fallback: timestamp-based
  return 'ROOM-' + (Date.now() % 10000);
}

// ─── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Inject RELAY_URL into served HTML so client knows where to connect
app.use((req, res, next) => {
  const filePath = path.join(config.staticDir, req.path === '/' ? 'index.html' : req.path);
  if ((req.path.endsWith('.html') || req.path === '/') && fs.existsSync(filePath)) {
    let html = fs.readFileSync(filePath, 'utf8');
    const wsProto  = config.domain.startsWith('https') ? 'wss' : 'ws';
    const relayUrl = config.domain.replace(/^https?/, wsProto);
    html = html.replace('</head>',
      `<script>window.TIMER_RELAY_URL="${relayUrl}";</script>\n</head>`);
    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  }
  next();
});

app.use(express.static(config.staticDir));

// REST: generate a room code
app.post('/api/room', (req, res) => {
  const code = generateRoomCode();
  getOrCreateRoom(code);
  const wsProto = config.domain.startsWith('https') ? 'wss' : 'ws';
  const relayUrl = config.domain.replace(/^https?/, wsProto);
  res.json({
    code,
    signalUrl:  `${relayUrl}/signal/${code}`,
    relayUrl:   `${relayUrl}/relay/${code}`,
    viewerUrl:  `${config.domain}/audience.html?room=${code}`,
  });
});

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));

// ─── HTTP server + WebSocket upgrade routing ──────────────────────────────────

const server = http.createServer(app);

const wssSignal = new WebSocketServer({ noServer: true });
const wssRelay  = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (url.startsWith('/signal/')) {
    wssSignal.handleUpgrade(req, socket, head, ws => {
      wssSignal.emit('connection', ws, req);
    });
  } else if (url.startsWith('/relay/')) {
    wssRelay.handleUpgrade(req, socket, head, ws => {
      wssRelay.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

// ─── Signal handler (WebRTC SDP + ICE exchange) ────────────────────────────────

wssSignal.on('connection', (ws, req) => {
  const parts = req.url.split('/');
  const code  = (parts[2] || '').toUpperCase().split('?')[0];
  const params = new URLSearchParams((req.url.split('?')[1] || ''));
  const role  = params.get('role') || 'viewer'; // 'controller' | 'viewer'

  const room  = getOrCreateRoom(code);
  room.touch();

  console.log(`[signal] ${role} joined ${code}`);

  ws.on('message', raw => {
    room.touch();
    try {
      const msg = JSON.parse(raw);
      // Forward SDP / ICE between peers
      if (role === 'controller') {
        room.broadcast({ ...msg, from: 'controller' }, ws);
      } else {
        room.sendToController({ ...msg, from: 'viewer' });
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    console.log(`[signal] ${role} left ${code}`);
  });

  // Notify peer that someone joined (triggers offer/answer)
  if (role === 'viewer') {
    room.sendToController({ type: 'viewer-joined' });
  } else {
    room.viewers.forEach(v => v.send(JSON.stringify({ type: 'controller-joined' })));
  }
});

// ─── Relay handler (WS data relay — controller → viewers) ─────────────────────

wssRelay.on('connection', (ws, req) => {
  const parts = req.url.split('/');
  const code  = (parts[2] || '').toUpperCase().split('?')[0];
  const params = new URLSearchParams((req.url.split('?')[1] || ''));
  const role  = params.get('role') || 'viewer';

  const room  = getOrCreateRoom(code);
  room.touch();

  if (role === 'controller') {
    // Only one controller at a time
    if (room.controller && room.controller.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'error', reason: 'room-has-controller' }));
      ws.close(); return;
    }
    room.controller = ws;
    console.log(`[relay] controller connected ${code}`);

    ws.on('message', raw => {
      room.touch();
      try {
        const msg = JSON.parse(raw);
        // Cache latest state snapshot for fast new-viewer sync
        if (msg.setVariableValues) room.latestState = msg;
        room.broadcast(raw); // forward to all viewers
      } catch (_) {}
    });

    ws.on('close', () => {
      room.controller = null;
      console.log(`[relay] controller disconnected ${code}`);
      room.broadcast({ type: 'controller-offline' });
    });

    ws.send(JSON.stringify({ type: 'connected', role: 'controller', code }));

  } else {
    room.viewers.add(ws);
    console.log(`[relay] viewer joined ${code} (${room.viewers.size} total)`);

    // Send latest state immediately so new viewer doesn't wait for next tick
    if (room.latestState) {
      ws.send(JSON.stringify(room.latestState));
    }

    // Notify controller of viewer count
    room.sendToController({ type: 'viewer-count', count: room.viewers.size });

    ws.on('close', () => {
      room.viewers.delete(ws);
      room.sendToController({ type: 'viewer-count', count: room.viewers.size });
      console.log(`[relay] viewer left ${code} (${room.viewers.size} total)`);
    });

    // Viewers cannot send commands (read-only)
    ws.on('message', () => {});

    ws.send(JSON.stringify({ type: 'connected', role: 'viewer', code }));
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(config.port, () => {
  console.log(`[timer-relay] listening on port ${config.port}`);
  console.log(`[timer-relay] timer UI: ${config.domain}/timer.html`);
  console.log(`[timer-relay] audience: ${config.domain}/audience.html?room=WORD-N`);
});

// Graceful shutdown
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT',  () => { server.close(() => process.exit(0)); });
