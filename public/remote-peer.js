/*!
 * remote-peer.js  (EXPERIMENTAL)
 * One link between the timer and one phone, shared by remote-control.js (timer side) and
 * remote-phone.js (phone side).
 *
 * It tries a direct WebRTC data channel with NO STUN/TURN servers. Without them a
 * connection can only succeed when the phone can reach the timer's computer on the local
 * network, so a successful connection is the "same LAN" test. If it fails, or drops later,
 * messages go through the pairing server instead (mode 'server'). Both modes carry the same
 * small JSON messages.
 *
 *   const peer = RemotePeer.create({ initiator, relay, onMessage, onModeChange });
 *   relay(obj)      — sends obj to the other side through the server (signalling + fallback)
 *   peer.receive(m) — feed it messages that arrived through the server
 *   peer.send(obj)  — sends by the best available path
 * MIT Licensed
 */

var RemotePeer = (function () {
  'use strict';

  function create(opts) {
    const { initiator, relay, onMessage, onModeChange } = opts;
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
      ch.onopen = () => { clearTimeout(timer); setMode('lan'); };
      ch.onclose = () => { dc = null; setMode('server'); };
      ch.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch (_) { /* ignore junk */ } };
    }

    function giveUp() {
      clearTimeout(timer);
      if (pc) { try { pc.close(); } catch (_) {} }
      pc = null; dc = null; pendingIce = [];
      setMode('server');
    }

    function start() {
      if (closed || typeof RTCPeerConnection === 'undefined') return false;
      pc = new RTCPeerConnection({ iceServers: [] });        // LAN only: no STUN, no TURN
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
      timer = setTimeout(() => { if (mode !== 'lan') giveUp(); }, timeoutMs);
      return true;
    }

    async function onSignal(m) {
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
      else if (m.k === 'data') onMessage(m.d);
    }

    function close() { closed = true; giveUp(); }

    if (initiator) start();
    return { send, receive, close, get mode() { return mode; } };
  }

  return { create };
})();
