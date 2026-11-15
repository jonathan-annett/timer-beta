/*!
 * manage-host.js
 * The management console's own pairing room (manage.html): its admin phones (manage-phone.html, the admin
 * key) and, later, its dashboards (the view key) join it as devices join a timer's. The same pairing server
 * and protocol as the timer's share panel (remote-control.js), cut down to what a console needs: host the
 * room, one RemotePeer per device, the proximity check (a 3-digit number typed here) and approval tokens.
 * Not a copy of remote-control.js's host on purpose: that one is tied to the timer's keys, panel and bus,
 * and the console is a trial (docs/manage-plan.md: merge them later if it proves itself).
 *
 *   const host = ManageHost.create({ store, server, onHello(e), onMessage(e, m), onChange() })
 *   store       {get(k), set(k, v), del(k)}: the session's own storage (keys under its prefix)
 *   host.start() / host.stop()
 *   host.link(page, mode)   'admin' (a=) or 'view' (v=) link to page (manage-phone.html, …)
 *   host.devices            Map id → {id, role, peer, approved, pin, suggest, token, name}
 *   host.pending()          devices waiting for their number
 *   host.approve(id, code) / host.refuse(id) / host.revoke(token)
 *   host.status             'off' | 'connecting' | 'ok' | 'error' (and host.statusText)
 * MIT Licensed
 */

/* global RemotePeer */

var ManageHost = (function () {
  'use strict';

  const ROOMCHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const KEYCHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const TOKENCHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  function randomString(len, alphabet) {
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
  }
  const cleanName = s => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) : '');

  function create(opts) {
    const { store, onHello, onMessage, onChange } = opts;
    const server = opts.server || RemotePeer.defaultServer();
    const devices = new Map();
    let ws = null, retryTimer = null, retryDelay = 1000, on = false;
    const self = { devices, status: 'off', statusText: '' };
    const changed = () => { if (onChange) onChange(); };
    function setStatus(st, text) { self.status = st; self.statusText = text; changed(); }

    // The room and its keys, kept with the session (a reload keeps its phones)
    function pairing() {
      let p = store.get('pairing');
      if (!p || !p.room || !p.key || !p.view || !p.admin) {
        p = { room: randomString(10, ROOMCHARS), key: randomString(24, KEYCHARS), view: randomString(24, KEYCHARS), admin: randomString(24, KEYCHARS) };
        store.set('pairing', p);
        store.del('approved');
      }
      return p;
    }
    const approvedList = () => (Array.isArray(store.get('approved')) ? store.get('approved') : []);
    const saveApproved = list => store.set('approved', list.slice(-32));
    const approvedEntry = t => approvedList().find(x => x.t === t) || null;

    function link(page, mode) {
      const p = pairing(), u = new URL(page, location.href);
      u.search = ''; u.hash = '';
      const h = mode === 'view' ? { r: p.room, v: p.view } : { r: p.room, a: p.admin };
      if (server !== RemotePeer.defaultServer()) h.s = server;
      u.hash = new URLSearchParams(h).toString();
      return u.toString();
    }

    function sendServer(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
    function connect() {
      clearTimeout(retryTimer);
      if (!on) return;
      setStatus('connecting', 'Connecting…');
      const p = pairing();
      try { ws = new WebSocket(RemotePeer.socketUrl(server, { room: p.room })); } catch (err) { setStatus('error', 'Bad server address'); return; }
      const sock = ws;
      RemotePeer.keepAlive(sock);
      sock.onopen = () => { retryDelay = 1000; sock.send(JSON.stringify({ type: 'host', room: p.room, key: p.key, viewKey: p.view, adminKey: p.admin })); };
      sock.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
        if (m.type === 'hosted') setStatus('ok', 'Ready');
        else if (m.type === 'peer-join') addDevice(m.id, m.role);
        else if (m.type === 'peer-leave') removeDevice(m.id);
        else if (m.type === 'from') { const d = devices.get(m.id); if (d) d.peer.receive(m.msg); }
        else if (m.type === 'error') {
          if (m.reason === 'room-taken') { store.del('pairing'); sock.close(); }   // a clash: new keys, try again
          else setStatus('error', 'Server said: ' + m.reason);
        }
      };
      sock.onclose = () => {
        if (sock !== ws) return;
        for (const id of [...devices.keys()]) removeDevice(id);
        if (!on) { setStatus('off', ''); return; }
        setStatus('error', 'Can’t reach the pairing server: retrying…');
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15000);
      };
      sock.onerror = () => {};
    }

    function addDevice(id, role) {
      removeDevice(id);
      const d = { id, role: role === 'admin' ? 'admin' : 'view', peer: null, approved: false, pin: null, suggest: '', token: null, name: '', rejected: false };
      d.peer = RemotePeer.create({
        initiator: true,
        relay: msg => sendServer({ type: 'to', id, msg }),
        onMessage: m => fromDevice(d, m),
        onModeChange: changed,
      });
      devices.set(id, d);
      changed();
    }
    function removeDevice(id) {
      const d = devices.get(id);
      if (!d) return;
      d.peer.close();
      devices.delete(id);
      changed();
    }

    // The proximity check, as on the timer: nothing goes to a device, and nothing from it is acted on,
    // until someone types the number it shows (or it brings back the token it was given then)
    function fromDevice(d, m) {
      if (!m || typeof m !== 'object' || d.rejected) return;
      if (!d.approved) {
        const known = m.t === 'hello' && typeof m.token === 'string' ? approvedEntry(m.token) : null;
        if (known && known.role === d.role) {
          d.approved = true; d.token = m.token; d.name = known.name || '';
        } else if (m.t === 'hello') { d.peer.send({ t: 'pin-required' }); return; }
        else if (m.t === 'pin' && typeof m.code === 'string' && /^\d{3}$/.test(m.code)) { d.pin = m.code; d.suggest = cleanName(m.name); changed(); return; }
        else return;
      }
      if (m.t === 'relink') { if (d.peer.mode === 'server') d.peer.restart(); return; }
      if (m.t === 'hello') { if (onHello) onHello(d); changed(); return; }
      if (onMessage) onMessage(d, m);
    }
    function approve(id, code) {
      const d = devices.get(id);
      if (!d || d.approved || d.rejected) return;
      if (String(code || '').trim() !== d.pin) { refuse(id); return; }
      const token = randomString(24, TOKENCHARS), now = Date.now();
      saveApproved(approvedList().concat({ t: token, name: d.suggest, role: d.role, added: now }));
      d.approved = true; d.pin = null; d.token = token; d.name = d.suggest;
      d.peer.send({ t: 'pin-ok', token });    // it says hello again (onHello)
      changed();
    }
    function refuse(id) {
      const d = devices.get(id);
      if (!d) return;
      d.rejected = true; d.pin = null;
      try { d.peer.send({ t: 'pin-rejected' }); } catch (_) { /* gone */ }
      setTimeout(() => sendServer({ type: 'kick', id }), 400);
      changed();
    }
    function revoke(token) {
      saveApproved(approvedList().filter(x => x.t !== token));
      for (const d of devices.values()) if (d.token === token) {
        d.rejected = true; d.approved = false;
        try { d.peer.send({ t: 'revoked' }); } catch (_) { /* gone */ }
        setTimeout(() => sendServer({ type: 'kick', id: d.id }), 400);
      }
      changed();
    }

    return Object.assign(self, {
      start() { if (on) return; on = true; connect(); },
      stop() { on = false; clearTimeout(retryTimer); if (ws) { const s = ws; ws = null; s.close(); } for (const id of [...devices.keys()]) removeDevice(id); setStatus('off', ''); },
      link, approve, refuse, revoke, approvedList,
      pending: () => [...devices.values()].filter(d => !d.approved && d.pin && !d.rejected),
      send: (d, msg) => { if (d && d.approved) d.peer.send(msg); },
    });
  }

  return { create, randomString };
})();
