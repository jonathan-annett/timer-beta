/*
   jshint esversion: 8
*/

// Tried in order, after the pairing server, until one answers. worldtimeapi.org alone was a single
// point of failure: when it stopped answering the clock quietly stayed on local time.
const TIME_SOURCES = [
  { name: 'worldtimeapi.org', url: 'https://worldtimeapi.org/api/ip',
    read: async res => new Date((await res.json()).utc_datetime).getTime() },
  { name: 'timeapi.io', url: 'https://timeapi.io/api/time/current/zone?timeZone=UTC',
    read: async res => new Date((await res.json()).dateTime.slice(0, 23) + 'Z').getTime() },
  { name: 'cloudflare.com', url: 'https://www.cloudflare.com/cdn-cgi/trace',
    read: async res => Number(/^ts=([\d.]+)$/m.exec(await res.text())[1]) * 1000 },
];
const TIME_SOURCE_TIMEOUT = 4000;
const TIME_SOCKET_TIMEOUT = 2000, TIME_SOCKET_ROUNDS = 5;

// The clock's correction from this computer's: internetTimeError (ms), whichever mode set it.
//   mode  (clock_mode)  what the operator chose: 'internet', 'local' or 'manual'
//   state               what's in use now: the same, or 'checking' before the first answer, or
//                       'local' when internet was chosen but no time server answered
// Document events: 'clock-moved' (detail: ms the clock just moved, for what holds timestamps) and
// 'clock-state' (anything the badge shows changed).
class InternetTimeProvider {
  constructor() {
    const cached = localStorage.getItem('internetTimeError');
    this.error = cached ? (Number.parseInt(cached) || 0) : 0;
    console.log("reloaded internet time error at",this.error);
    let mode = localStorage.getItem('clock_mode');
    if (!['internet', 'local', 'manual'].includes(mode)) {
      mode = cached === '0' ? 'local' : 'internet';   // before the modes, a saved 0 only came from Shift+L
      localStorage.setItem('clock_mode', mode);
    }
    this.mode = mode;
    this.state = mode === 'internet' ? 'checking' : mode;
    this.reachable = null;      // did a time server answer last time we asked? null = not asked
    this.busy = false;
    this.source = null;
    this.syncedAt = null;
    this.turn = 0;              // a newer choice makes an answer still on its way irrelevant

    // The presenter window follows the controller's clock
    addEventListener('storage', ev => {
      if (ev.key === 'internetTimeError') this.error = Number.parseInt(ev.newValue) || 0;
    });
    // After the deferred scripts, so timer.js is listening for 'clock-moved'. Only the controller
    // syncs: it's the one holding the timestamps that have to move with the clock.
    if (mode === 'internet' && !new URLSearchParams(location.search).has('presenter')) {
      document.addEventListener('DOMContentLoaded', () => this.syncNow());
    }
  }

  // The pairing server's clock, over its websocket (`time` in remote-server.js): a few round trips,
  // keeping the quickest. Null if it can't be reached or doesn't know the message.
  measureSocket() {
    return new Promise(done => {
      let ws, best = null, rounds = TIME_SOCKET_ROUNDS, sent = 0, timeout = 0;
      const finish = () => {
        clearTimeout(timeout);
        if (ws) { ws.onclose = ws.onmessage = null; try { ws.close(); } catch (_) { /* already closed */ } }
        done(best);
      };
      const ask = () => { sent = Date.now(); ws.send(JSON.stringify({ type: 'time', c: sent })); };
      try {
        if (typeof RemotePeer === 'undefined') return done(null);
        const server = localStorage.getItem('remote_server') || RemotePeer.defaultServer();
        ws = new WebSocket(RemotePeer.socketUrl(server, { time: 1 }));
        const source = new URL(server).hostname;
        timeout = setTimeout(finish, TIME_SOCKET_TIMEOUT);
        ws.onopen = ask;
        ws.onerror = () => {};
        ws.onclose = finish;
        ws.onmessage = ev => {
          let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
          if (!m || m.type !== 'time' || m.c !== sent || !Number.isFinite(m.s)) return finish();
          const got = Date.now();
          if (!best || got - sent < best.rtt) best = { rtt: got - sent, offset: Math.round(m.s - (sent + got) / 2), source };
          if (--rounds > 0) ask(); else finish();
        };
      } catch (error) {
        console.warn('Clock sync: pairing server failed:', error);
        finish();
      }
    });
  }

  // Asks the pairing server, then the public time servers; the local clock is taken at the middle
  // of the round trip
  async measure() {
    const viaSocket = await this.measureSocket();
    if (viaSocket) return viaSocket;
    for (const src of TIME_SOURCES) {
      const stop = new AbortController(), timeout = setTimeout(() => stop.abort(), TIME_SOURCE_TIMEOUT);
      try {
        const sent = Date.now();
        const res = await fetch(src.url, { cache: 'no-store', signal: stop.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const server = await src.read(res);
        if (!Number.isFinite(server)) throw new Error('no time in the reply');
        return { offset: Math.round(server - (sent + Date.now()) / 2), source: src.name };
      } catch (error) {
        console.warn('Clock sync: ' + src.name + ' failed:', error);
      } finally {
        clearTimeout(timeout);
      }
    }
    return null;
  }

  // Sets the correction and what's in use. The event goes first and the saved offset last, so a
  // presenter window hears of the new clock only once the timestamps have moved.
  use(state, offset) {
    const delta = offset - this.error;
    this.state = state;
    this.error = offset;
    if (delta) document.dispatchEvent(new CustomEvent('clock-moved', { detail: delta }));
    localStorage.setItem('internetTimeError', String(offset));
    this.changed();
  }

  changed() { document.dispatchEvent(new CustomEvent('clock-state')); }

  saveMode(mode) {
    this.mode = mode;
    localStorage.setItem('clock_mode', mode);
  }

  // Only finds out whether internet can be offered; changes nothing
  async check() {
    const turn = ++this.turn;
    this.busy = true;
    this.changed();
    const got = await this.measure();
    if (turn !== this.turn) return;
    this.busy = false;
    this.reachable = !!got;
    this.changed();
  }

  // On success the clock is on internet time, whatever it was on. On failure internet falls back to
  // local (clock_mode stays 'internet', so the next load tries again); local and manual stay put.
  async syncNow() {
    const turn = ++this.turn;
    this.busy = true;
    this.changed();
    const got = await this.measure();
    if (turn !== this.turn) return false;
    this.busy = false;
    this.reachable = !!got;
    if (got) {
      console.log("calculated internet time error at",got.offset,"from",got.source);
      this.source = got.source;
      this.syncedAt = Date.now();
      localStorage.setItem('clock_manual', String(got.offset));   // so Manual starts from the known good time, to tweak
      this.saveMode('internet');
      this.use('internet', got.offset);
      return true;
    }
    if (this.state === 'checking' || this.state === 'internet') this.use('local', 0);
    else this.changed();
    return false;
  }

  setMode(mode) {
    if (mode === 'internet') return this.syncNow();
    this.turn++;
    this.busy = false;
    this.saveMode(mode);
    if (mode === 'manual') {
      const saved = localStorage.getItem('clock_manual');
      this.use('manual', saved === null ? this.error : Number.parseInt(saved) || 0);
    } else {
      this.use('local', 0);
    }
  }

  setManual(offset) {
    this.turn++;
    this.busy = false;
    this.saveMode('manual');
    localStorage.setItem('clock_manual', String(offset));
    this.use('manual', offset);
  }

  date(when) {
         if (this.error===undefined) {
          return new Date(when);
        }
        if (when === undefined) {
            return new Date(Date.now() + this.error);
        } else {
            return new Date(when);
        }

  }

  now() {
        if (this.error===undefined) {
          return Date.now();
        }

    return Date.now() + this.error;
  }

  resync () {
       return this.syncNow();
  }

  useLocal () {
       this.setMode('local');
  }

}

// Example usage:
const timeProvider = new InternetTimeProvider();

console.log(timeProvider.date());
