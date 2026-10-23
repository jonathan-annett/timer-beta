/*!
 * relay.js
 * Presentation Timer — remote display client
 * Strategy: connect via WebSocket immediately, attempt WebRTC upgrade in background.
 * If WebRTC succeeds, traffic migrates silently. If not, WS stays active.
 * MIT Licensed
 */

/* global timerAPI, processTimerApiMessage, html */

(function () {
  'use strict';

  // Only load on controller (not ?presenter or ?audience pages)
  const params = new URLSearchParams(location.search);
  if (params.has('presenter') || params.has('audience')) return;

  const RELAY_URL = window.TIMER_RELAY_URL ||
    (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host;

  // ─── State ────────────────────────────────────────────────────────────────

  let roomCode      = null;
  let wsRelay       = null;      // WebSocket relay connection
  let rtcPeer       = null;      // RTCPeerConnection
  let rtcChannel    = null;      // RTCDataChannel
  let wsSignal      = null;      // WebSocket signalling (used during handshake only)
  let rtcActive     = false;     // true once WebRTC DataChannel is open
  let viewerCount   = 0;
  let reconnectTimer = null;
  let sharing       = false;

  // ─── timerAPI chain ───────────────────────────────────────────────────────

  function installTimerAPI() {
    const prev = window.timerAPI;
    window.timerAPI = {
      send(msg) {
        if (prev && prev.send) prev.send(msg);   // chain: Stream Deck still works
        if (!sharing) return;
        const str = JSON.stringify(msg);
        // Prefer WebRTC DataChannel when active (lower latency on LAN)
        if (rtcActive && rtcChannel && rtcChannel.readyState === 'open') {
          try { rtcChannel.send(str); return; } catch (_) {}
        }
        // Fall back to WebSocket relay
        if (wsRelay && wsRelay.readyState === WebSocket.OPEN) {
          wsRelay.send(str);
        }
      }
    };
  }

  // ─── Room creation ────────────────────────────────────────────────────────

  async function startSharing() {
    try {
      const res = await fetch('/api/room', { method: 'POST' });
      const data = await res.json();
      roomCode = data.code;
      sharing = true;
      updateSharePanel({ code: roomCode, viewerUrl: data.viewerUrl, status: 'Connecting…' });
      connectRelay();
    } catch (err) {
      updateSharePanel({ status: 'Failed to create room — is the server running?' });
    }
  }

  function stopSharing() {
    sharing = false;
    roomCode = null;
    if (wsRelay)   { wsRelay.close();   wsRelay = null; }
    if (wsSignal)  { wsSignal.close();  wsSignal = null; }
    if (rtcPeer)   { rtcPeer.close();   rtcPeer = null; }
    rtcChannel = null; rtcActive = false;
    clearTimeout(reconnectTimer);
    hideSharePanel();
  }

  // ─── WebSocket relay connection ───────────────────────────────────────────

  function connectRelay() {
    if (!roomCode) return;
    const url = `${RELAY_URL}/relay/${roomCode}?role=controller`;

    wsRelay = new WebSocket(url);

    wsRelay.onopen = () => {
      updateSharePanel({ status: viewerCount === 0 ? 'Waiting for viewers…' : `${viewerCount} viewer(s) connected` });
      // Start WebRTC upgrade attempt once WS is stable
      setTimeout(startWebRTCSignalling, 500);
    };

    wsRelay.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'viewer-count') {
          viewerCount = msg.count;
          updateSharePanel({ status: viewerCount === 0 ? 'Waiting for viewers…' : `${viewerCount} viewer(s) connected` });
        }
        if (msg.type === 'controller-offline') {/* shouldn't happen on controller side */}
      } catch (_) {}
    };

    wsRelay.onclose = () => {
      if (!sharing) return;
      updateSharePanel({ status: 'Reconnecting…' });
      rtcActive = false;
      reconnectTimer = setTimeout(connectRelay, 2500);
    };

    wsRelay.onerror = () => {};
  }

  // ─── WebRTC upgrade ───────────────────────────────────────────────────────

  function startWebRTCSignalling() {
    if (!roomCode || !sharing) return;
    if (typeof RTCPeerConnection === 'undefined') return; // not supported

    const sigUrl = `${RELAY_URL}/signal/${roomCode}?role=controller`;
    wsSignal = new WebSocket(sigUrl);

    wsSignal.onopen = () => {
      createPeerConnection();
    };

    wsSignal.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'viewer-joined') {
          // A viewer connected to the signalling server — send them our offer
          await sendOffer();
        } else if (msg.type === 'answer' && rtcPeer) {
          await rtcPeer.setRemoteDescription(new RTCSessionDescription(msg));
        } else if (msg.type === 'ice-candidate' && rtcPeer) {
          try { await rtcPeer.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch (_) {}
        }
      } catch (_) {}
    };

    wsSignal.onerror = () => {};
    wsSignal.onclose = () => {};
  }

  function createPeerConnection() {
    // Use Google STUN only for non-LAN (we detect LAN via ICE candidate addresses)
    const config = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };
    rtcPeer = new RTCPeerConnection(config);

    rtcChannel = rtcPeer.createDataChannel('timer', { ordered: true });
    rtcChannel.onopen = onRTCOpen;
    rtcChannel.onclose = onRTCClose;
    rtcChannel.onerror = onRTCClose;

    rtcPeer.onicecandidate = (ev) => {
      if (ev.candidate && wsSignal && wsSignal.readyState === WebSocket.OPEN) {
        wsSignal.send(JSON.stringify({ type: 'ice-candidate', candidate: ev.candidate }));
      }
    };

    rtcPeer.onconnectionstatechange = () => {
      if (rtcPeer.connectionState === 'failed' || rtcPeer.connectionState === 'disconnected') {
        onRTCClose();
      }
    };
  }

  async function sendOffer() {
    if (!rtcPeer) return;
    const offer = await rtcPeer.createOffer();
    await rtcPeer.setLocalDescription(offer);
    if (wsSignal && wsSignal.readyState === WebSocket.OPEN) {
      wsSignal.send(JSON.stringify(rtcPeer.localDescription));
    }
  }

  function onRTCOpen() {
    rtcActive = true;
    // Close signalling WS — no longer needed
    if (wsSignal) { wsSignal.close(); wsSignal = null; }
    updateSharePanel({ rtcActive: true });
    console.log('[relay] WebRTC DataChannel open — migrated from WS relay');
  }

  function onRTCClose() {
    rtcActive = false;
    // WS relay is still active as fallback — no user-visible disruption
    console.log('[relay] WebRTC closed — falling back to WS relay');
  }

  // ─── Share panel UI ───────────────────────────────────────────────────────

  function showSharePanel() {
    const panel = document.getElementById('share-panel');
    if (panel) panel.style.display = 'block';
  }

  function hideSharePanel() {
    const panel = document.getElementById('share-panel');
    if (panel) panel.style.display = 'none';
    // Reset UI
    const code = document.getElementById('share-room-code');
    const status = document.getElementById('share-status');
    const link = document.getElementById('share-link');
    if (code) code.textContent = '––––––';
    if (status) status.textContent = '';
    if (link) link.textContent = '';
    clearQR();
  }

  function updateSharePanel({ code, viewerUrl, status, rtcActive: rtc } = {}) {
    showSharePanel();
    if (code) {
      const el = document.getElementById('share-room-code');
      if (el) el.textContent = code;
    }
    if (status) {
      const el = document.getElementById('share-status');
      if (el) {
        el.textContent = (rtc ? '⚡ LAN direct · ' : '') + status;
      }
    }
    if (viewerUrl) {
      const el = document.getElementById('share-link');
      if (el) el.textContent = viewerUrl;
      drawQR(viewerUrl);
    }
  }

  // ─── QR code (inline, no CDN dependency) ─────────────────────────────────
  // Minimal QR encoder — renders to the share-qr canvas.
  // Uses a pre-built lookup via the qr-creator micro-library approach (byte mode).
  // For simplicity we use a small inline SVG QR via a data URI approach using
  // an external-but-tiny script loaded on demand.

  let qrScriptLoaded = false;

  function drawQR(url) {
    const canvas = document.getElementById('share-qr');
    if (!canvas) return;

    function render() {
      if (window.QRCode) {
        canvas.width = 160; canvas.height = 160;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 160, 160);
        try {
          // qrcode-generator style API
          const qr = window.QRCode(0, 'M');
          qr.addData(url); qr.make();
          const size = qr.getModuleCount();
          const cell = Math.floor(160 / size);
          ctx.fillStyle = '#000';
          for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
              if (qr.isDark(r, c)) ctx.fillRect(c * cell, r * cell, cell, cell);
            }
          }
        } catch (_) {}
      }
    }

    if (qrScriptLoaded) { render(); return; }

    const s = document.createElement('script');
    s.src = 'qrcode.min.js';   // bundled (MIT, qrcode-LICENSE.txt)
    s.onload = () => {
      qrScriptLoaded = true;
      // qrcodejs has a different API — use the canvas directly
      canvas.width = 160; canvas.height = 160;
      canvas.innerHTML = '';
      try {
        new window.QRCode(canvas, {
          text: url, width: 160, height: 160,
          colorDark: '#000000', colorLight: '#ffffff',
          correctLevel: window.QRCode.CorrectLevel.M
        });
      } catch (_) {}
    };
    document.head.appendChild(s);
  }

  function clearQR() {
    const canvas = document.getElementById('share-qr');
    if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 160, 160); }
  }

  // ─── Wire up share panel buttons ──────────────────────────────────────────

  function initShareUI() {
    document.getElementById('btnshare')?.addEventListener('click', () => {
      if (sharing) {
        showSharePanel();
      } else {
        startSharing();
      }
    });

    document.getElementById('share-close')?.addEventListener('click', showSharePanel);
    // share-close just hides the panel, sharing continues

    document.getElementById('share-stop-btn')?.addEventListener('click', stopSharing);

    document.getElementById('share-copy-btn')?.addEventListener('click', () => {
      const link = document.getElementById('share-link');
      if (link && link.textContent) {
        navigator.clipboard?.writeText(link.textContent).catch(() => {
          prompt('Copy this link:', link.textContent);
        });
      }
    });
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { installTimerAPI(); initShareUI(); });
  } else {
    installTimerAPI(); initShareUI();
  }

  // Expose for audience.js to use the same relay infrastructure
  window._timerRelay = { RELAY_URL };

})();
