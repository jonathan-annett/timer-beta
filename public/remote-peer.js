/*!
 * remote-peer.js  (EXPERIMENTAL)
 * One link between the timer and one phone, shared by remote-control.js (timer side) and
 * remote-phone.js (phone side).
 *
 * It tries a direct WebRTC data channel, with public STUN servers (no TURN), so it can connect
 * across networks too when their routers allow it. Once it's open, the route it took decides the
 * mode: 'lan' when both ends use local addresses (the same network: file transfers are allowed
 * only then), 'p2p' when it goes over the internet (route()). If it fails, or drops later,
 * messages go through the pairing server instead (mode 'server'). All three carry the same
 * small JSON messages; only the server mode costs the server anything.
 *
 *   const peer = RemotePeer.create({ initiator, relay, onMessage, onModeChange });
 *   relay(obj)      — sends obj to the other side through the server (signalling + fallback)
 *   peer.receive(m) — feed it messages that arrived through the server
 *   peer.send(obj)  — sends by the best available path
 *   onMessage(obj, via)  via: 'lan' (the data channel, in mode 'lan' or 'p2p') or 'server'
 *   peer.mode  'lan' | 'p2p' | 'server'
 *   peer.restart()  while on the server, tries a direct link again (the initiator makes a new
 *                   offer; the other side accepts any new offer with a fresh connection).
 *   RemotePeer.retryOnNetworkChange(fn)  calls fn when the device says its network changed
 *
 * Binary (video files from the run sheet editor): LAN only, never through the server.
 *   peer.sendBinary(buf) → false unless the data channel is open; onBinary(buf) receives.
 *   peer.drained(bytes) → a promise that resolves when less than `bytes` is waiting to go.
 *
 * Big JSON (a whole run sheet) is split to fit the server's 16 KB message limit:
 *   RemotePeer.sendBig(peer, obj) sends it (in paced parts when big); RemotePeer.parts(obj) just
 *   splits it; RemotePeer.joiner() → j(m) returns
 *   the whole object when the last part of it arrives (null until then, and for other messages).
 * MIT Licensed
 */

var RemotePeer = (function () {
  'use strict';

  // Free public STUN servers: they only tell each end its own public address
  const STUN = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  const publicV4 = a => typeof a === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(a) &&
    !/^(10|127)\./.test(a) && !/^192\.168\./.test(a) && !/^172\.(1[6-9]|2\d|3[01])\./.test(a) && !/^169\.254\./.test(a) && !/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a);

  function create(opts) {
    const { initiator, relay, onMessage, onModeChange, onBinary } = opts;
    const timeoutMs = opts.timeoutMs || 7000;
    let pc = null, dc = null, mode = 'server', timer = null, closed = false;
    let pendingIce = [];

    function setMode(m) {
      if (m === mode) return;
      mode = m;
      if (onModeChange) onModeChange(m);
    }

    function wire(ch) {
      dc = ch;
      ch.binaryType = 'arraybuffer';
      ch.bufferedAmountLowThreshold = 1 << 20;
      ch.onopen = () => { clearTimeout(timer); route().then(m => { if (dc === ch && ch.readyState === 'open') setMode(m); }); };
      ch.onclose = () => { dc = null; setMode('server'); };
      ch.onmessage = e => {
        if (typeof e.data !== 'string') { if (onBinary) onBinary(e.data); return; }
        let m; try { m = JSON.parse(e.data); } catch (_) { return; /* ignore junk */ }
        onMessage(m, 'lan');
      };
    }

    // Which way the open channel goes: 'lan' if neither end is a STUN (srflx) or relay address,
    // nor a public IPv4 one; otherwise 'p2p'. When it can't tell, 'p2p' (no file transfers).
    async function route() {
      try {
        const stats = await pc.getStats(), byId = {};
        let pair = null;
        stats.forEach(r => { byId[r.id] = r; });
        stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = byId[r.selectedCandidatePairId]; });
        if (!pair) stats.forEach(r => { if (!pair && r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) pair = r; });
        const l = pair && byId[pair.localCandidateId], r = pair && byId[pair.remoteCandidateId];
        if (!l || !r) return 'p2p';
        const far = c => c.candidateType === 'srflx' || c.candidateType === 'relay' || publicV4(c.address || c.ip);
        return far(l) || far(r) ? 'p2p' : 'lan';
      } catch (_) { return 'p2p'; }
    }

    function giveUp() {
      clearTimeout(timer);
      if (pc) { try { pc.close(); } catch (_) {} }
      pc = null; dc = null; pendingIce = [];
      setMode('server');
    }

    function start() {
      if (closed || typeof RTCPeerConnection === 'undefined') return false;
      pc = new RTCPeerConnection({ iceServers: STUN });        // no TURN: nothing ever goes through a server of ours
      pc.onicecandidate = e => { if (e.candidate) relay({ k: 'sig', ice: e.candidate.toJSON() }); };
      pc.onconnectionstatechange = () => {
        if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) giveUp();
      };
      if (initiator) {
        wire(pc.createDataChannel('timer', { ordered: true }));
        pc.createOffer()
          .then(o => pc.setLocalDescription(o))
          .then(() => relay({ k: 'sig', sdp: pc.localDescription.toJSON() }))
          .catch(giveUp);
      } else {
        pc.ondatachannel = e => wire(e.channel);
      }
      timer = setTimeout(() => { if (mode === 'server') giveUp(); }, timeoutMs);
      return true;
    }

    async function onSignal(m) {
      if (!initiator && m.sdp && m.sdp.type === 'offer' && pc) {      // a new attempt (restart() on the other side)
        if (mode !== 'server') return;
        giveUp();
      }
      if (!pc) {
        if (initiator || !m.sdp || m.sdp.type !== 'offer') return;   // stale signal after giving up
        if (!start()) return;
      }
      try {
        if (m.sdp) {
          await pc.setRemoteDescription(m.sdp);
          for (const c of pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
          if (m.sdp.type === 'offer') {
            await pc.setLocalDescription(await pc.createAnswer());
            relay({ k: 'sig', sdp: pc.localDescription.toJSON() });
          }
        } else if (m.ice) {
          if (pc.remoteDescription) await pc.addIceCandidate(m.ice);
          else pendingIce.push(m.ice);                                  // arrived before the offer/answer
        }
      } catch (_) { /* a bad candidate shouldn't break the link */ }
    }

    function send(obj) {
      if (dc && dc.readyState === 'open') {
        try { dc.send(JSON.stringify(obj)); return; } catch (_) { /* fall through to the server */ }
      }
      relay({ k: 'data', d: obj });
    }

    function receive(m) {
      if (!m || typeof m !== 'object') return;
      if (m.k === 'sig') onSignal(m);
      else if (m.k === 'data') onMessage(m.d, 'server');
    }

    function sendBinary(buf) {
      if (!dc || dc.readyState !== 'open') return false;
      try { dc.send(buf); return true; } catch (_) { return false; }
    }
    // Resolves once the data channel's send buffer is below `bytes` (or rejects if it closes)
    function drained(bytes) {
      return new Promise((resolve, reject) => {
        const ch = dc;
        if (!ch || ch.readyState !== 'open') return reject(new Error('closed'));
        if (ch.bufferedAmount < bytes) return resolve();
        const check = () => {
          if (ch.readyState !== 'open') { clearInterval(iv); return reject(new Error('closed')); }
          if (ch.bufferedAmount < bytes) { clearInterval(iv); resolve(); }
        };
        const iv = setInterval(check, 50);
        ch.addEventListener('bufferedamountlow', check, { once: true });
      });
    }

    function close() { closed = true; giveUp(); }
    function restart() {
      if (closed || mode !== 'server') return;
      giveUp();
      if (initiator) start();
    }

    if (initiator) start();
    return { send, receive, close, restart, sendBinary, drained, get mode() { return mode; } };
  }

  // ─── Big messages ──────────────────────────────────────────────────────────
  // Server messages are limited to 16 KB, and a part's text is escaped again inside the
  // envelope (and may be multi-byte UTF-8), so parts carry at most 3000 characters.
  const PART = 3000;
  let partSeq = 0;
  function parts(obj) {
    const text = JSON.stringify(obj);
    const pid = (++partSeq).toString(36) + Math.random().toString(36).slice(2, 6);
    const n = Math.max(1, Math.ceil(text.length / PART));
    const out = [];
    for (let i = 0; i < n; i++) out.push({ t: 'part', pid, i, n, s: text.slice(i * PART, (i + 1) * PART) });
    return out;
  }
  function joiner(maxChars) {
    const max = maxChars || 2000000;
    const open = new Map();
    return function join(m) {
      if (!m || m.t !== 'part' || typeof m.pid !== 'string' || typeof m.s !== 'string') return null;
      const n = m.n, i = m.i;
      if (!Number.isInteger(n) || !Number.isInteger(i) || n < 1 || n > Math.ceil(max / PART) || i < 0 || i >= n) return null;
      let p = open.get(m.pid);
      if (!p) {
        if (open.size > 8) open.delete(open.keys().next().value);      // abandoned messages
        p = { n, got: 0, s: new Array(n) };
        open.set(m.pid, p);
      }
      if (p.n !== n || p.s[i] != null) return null;
      p.s[i] = m.s; p.got++;
      if (p.got < n) return null;
      open.delete(m.pid);
      try { return JSON.parse(p.s.join('')); } catch (_) { return null; }
    };
  }

  // Sends obj, split if it's big. Through the server the parts are paced: it drops anything
  // over 40 messages a second per connection (and the timer's connection is shared by all phones).
  function sendBig(peer, obj) {
    const list = parts(obj);
    if (list.length === 1) { peer.send(obj); return Promise.resolve(); }
    return new Promise(resolve => {
      let i = 0;
      const step = () => {
        while (i < list.length) {
          peer.send(list[i++]);
          if (peer.mode !== 'lan' && i < list.length) { setTimeout(step, 80); return; }
        }
        resolve();
      };
      step();
    });
  }

  // The pairing server for pages from `host` (default: this page's). The VPS (sophtwhere.com, and
  // the local preview on port 8444) runs it on its own port, 8443; elsewhere (Cloudflare) it's on
  // the site itself, at /ws.
  function defaultServer(host) {
    host = host || location.host;
    const name = host.replace(/:\d+$/, '');
    if (/(^|\.)sophtwhere\.com$/.test(name) || host === 'localhost:8444') return `wss://${name}:8443/`;
    return `${location.protocol === 'http:' && !host.includes('.') ? 'ws' : 'wss'}://${host}/ws`;
  }
  // The address to open: the server plus ?room= (or ?code=), which the Cloudflare server routes by.
  // The VPS server ignores it.
  function socketUrl(server, params) {
    try {
      const u = new URL(server);
      for (const k in params) if (params[k]) u.searchParams.set(k, params[k]);
      return u.href;
    } catch (_) { return server; }
  }
  // Keeps an idle connection open (a hibernating Cloudflare server sends no pings of its own):
  // {type:'ping'} every 25 s, answered with {type:'pong'}, which every client ignores.
  function keepAlive(ws) {
    const t = setInterval(() => {
      if (ws.readyState === 1) { try { ws.send('{"type":"ping"}'); } catch (_) { /* closing */ } }
      else if (ws.readyState > 1) clearInterval(t);
    }, 25000);
  }

  // The device joined another network (Wi-Fi after mobile data, say): worth trying a direct link
  // again. Android Chrome reports it (navigator.connection); everyone reports coming back online.
  function retryOnNetworkChange(fn) {
    let t = null;
    const later = () => { clearTimeout(t); t = setTimeout(fn, 1500); };   // let the new network settle
    window.addEventListener('online', later);
    if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', later);
  }

  // Pairing by code (pairing server protocol 6): send the 6-digit code from a timer's share panel on
  // a fresh socket; the timer answers with this device's link (a URL fragment). Callbacks: onWait()
  // (the code is live, the timer is being asked), onGranted(frag), onError(reason): one of
  // CLAIM_ERRORS' keys, 'bad-server' or 'unreachable' (or a reason from a newer server).
  const CLAIM_ERRORS = {
    'bad-code': 'That code didn’t work. Codes change every 30 seconds: type the one showing now.',
    'too-many': 'Too many wrong codes. Wait a minute, then try again.',
    'no-answer': 'The timer didn’t answer. Is its share panel still open?',
    'refused': 'The timer didn’t accept this device. Try a new code.',
    'bad-server': 'That pairing server address isn’t right.',
    'unreachable': 'Couldn’t reach the pairing server.',
  };
  function claim(server, code, cb) {
    let ws, done = false;
    const fail = reason => { if (done) return; done = true; try { ws.close(); } catch (_) { /* gone */ } if (cb.onError) cb.onError(reason); };
    try { ws = new WebSocket(socketUrl(server, { code })); } catch (_) { fail('bad-server'); return; }
    ws.onopen = () => ws.send(JSON.stringify({ type: 'claim', code }));
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.type === 'claim-wait') { if (cb.onWait) cb.onWait(); }
      else if (m.type === 'granted' && typeof m.frag === 'string') { done = true; cb.onGranted(m.frag); }
      else if (m.type === 'error') fail(String(m.reason || 'failed'));
    };
    ws.onclose = () => fail('unreachable');
    ws.onerror = () => {};
  }

  // Keys a controlling device may pass to the timer (the timer's own shortcuts, typed on the remote's
  // keyboard; checked again on the timer). Durations (digits, :, ., Backspace, Enter), Space restart,
  // " pause, ' undo pause, arrows (Ctrl: a minute), Ctrl+Enter/Space catch up, B/M/T switches, X,
  // the default-duration nudges and Page Up/Down. Not O (overlay), F (full screen), R (remote
  // window), C (message editing: the remote has its own box), nor P/S/E/D/V/W/Q/L/I and the rest
  // that open windows or editors on the timer's screen.
  const REMOTE_KEYS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ':', '.', 'Backspace', 'Enter', ' ', '"', "'", '/', '*',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'b', 'B', 'm', 'M', 't', 'T', 'x', 'X', '(', ')', '[', ']', '{', '}', '_']);
  const REMOTE_CTRL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ']);   // the only ones with Ctrl
  const remoteKeyOk = (key, ctrl) => REMOTE_KEYS.has(key) && (!ctrl || REMOTE_CTRL_KEYS.has(key));

  // A name the timer can show for this device until someone gives it a better one ("iPhone · Safari")
  function deviceName() {
    const ua = navigator.userAgent;
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
      : /Mac OS X/.test(ua) ? (navigator.maxTouchPoints > 1 ? 'iPad' : 'Mac') : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Device';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    return browser ? os + ' · ' + browser : os;
  }

  return { create, parts, joiner, sendBig, defaultServer, socketUrl, keepAlive, retryOnNetworkChange, deviceName, claim, CLAIM_ERRORS, remoteKeyOk };
})();
