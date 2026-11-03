/*
 * The link to the timer: a client of the timer's pairing server, as a phone is (see "Phone Remote
 * Control" in the project's CLAUDE.md; the Companion module's src/link.ts is the same thing for Node).
 * Plain WebSocket only: the timer offers a WebRTC link and falls back to the server after 7 s.
 *
 *   pairing:  ?code=  {type:'claim', code, client:'g2', mode}  -> claim-wait, then granted {frag} | error {reason}
 *             (client and mode tell the timer what's asking; servers that don't know them ignore them)
 *   our code: ?offer=<secret>  {type:'offer', secret, pub, client:'g2', mode, name}  -> offer-code {code, ms},
 *             offer-taken, then granted {sealed} | error {reason}; {type:'cancel'} gives up (protocol 7, the other way round: the glasses
 *             show a code, typed on the timer, which sends our link sealed for pub, with an approval token t=)
 *   room:     ?room=  join {room, key} -> joined {id, hostOnline, role}; host-online / host-offline
 *   timer -> us (down {msg: {k:'data', d}}):  {t:'state', full, s}, {t:'pin-required'}, {t:'pin-ok', token},
 *             {t:'pin-rejected'}, {t:'revoked'}
 *             {t:'role', role:'presenter'|'operator', frag?}: the role the timer gave us (frag: the control
 *             link, sent only to an operator still on the view-only one)
 *   us -> timer (up {msg: {k:'data', d}}):    {t:'hello', clock:1, token?, client, mode}, {t:'pin', code, name},
 *             {t:'cmd', cmd} (an operator's: three taps = runsheetnext; the menu's runsheetprev, pause, reset,
 *             autostart {on}; the timer ignores them from a presenter)
 */

// The timer site's pairing server (the app's network whitelist allows only it). Tests set
// window.TS_SERVER to use a local one.
export const SERVER: string = (globalThis as { TS_SERVER?: string }).TS_SERVER || 'wss://beta.timed-show.com/ws'
/** The timer site whose QR codes we accept (tests set window.TS_SITE) */
export const SITE: string = (globalThis as { TS_SITE?: string }).TS_SITE || 'beta.timed-show.com'
export const CLIENT = 'g2'
export type Mode = 'presenter' | 'operator'   // the role the glasses ask for; the timer decides

export interface Paired { server: string; room: string; key: string; view: boolean }

const withQuery = (server: string, k: string, v: string): string => {
  try { const u = new URL(server); u.searchParams.set(k, v); return u.href } catch { return server }
}

/** The approval token a link brings with it (t=: the timer let us in when it sent it) */
export function fragToken(frag: string): string {
  const t = new URLSearchParams(frag.replace(/^#/, '')).get('t') || ''
  return /^[\w-]{1,64}$/.test(t) ? t : ''
}

/** The link the timer granted (the part of a remote.html link after '#'): its room and key */
export function parseFrag(frag: string): Paired | null {
  const p = new URLSearchParams(frag.replace(/^#/, ''))
  const room = p.get('r'), k = p.get('k'), v = p.get('v')
  const key = k ?? v
  if (!room || !key || !/^[\w-]{1,64}$/.test(room) || !/^[\w-]{1,64}$/.test(key)) return null
  // Only the server we were built for (the app's network whitelist allows no other)
  return { server: SERVER, room, key, view: !k }
}

export const CLAIM_ERRORS: Record<string, string> = {
  'bad-code': 'That code didn’t work. Codes change every 30 seconds: type the one showing now.',
  'too-many': 'Too many wrong codes. Wait a minute, then try again.',
  'no-answer': 'The timer didn’t answer. Is its share panel still open?',
  'refused': 'The timer didn’t accept these glasses. Try a new code.',
  'unreachable': 'Couldn’t reach the timer’s server.',
  'bad-link': 'The timer sent a link these glasses can’t use.',
}

/** Claims a pairing code. Calls back once with the link, or an error reason (a CLAIM_ERRORS key). */
export function claim(code: string, mode: Mode, cb: { wait?: () => void; done: (p: Paired) => void; fail: (reason: string) => void }): void {
  let finished = false
  const fail = (reason: string) => { if (finished) return; finished = true; try { ws.close() } catch { /* gone */ } cb.fail(reason) }
  let ws: WebSocket
  try { ws = new WebSocket(withQuery(SERVER, 'code', code)) } catch { cb.fail('unreachable'); return }
  ws.onopen = () => ws.send(JSON.stringify({ type: 'claim', code, client: CLIENT, mode }))
  ws.onmessage = ev => {
    let m: { type?: string; frag?: unknown; reason?: unknown }
    try { m = JSON.parse(String(ev.data)) } catch { return }
    if (m.type === 'claim-wait') cb.wait?.()
    else if (m.type === 'granted' && typeof m.frag === 'string') {
      const p = parseFrag(m.frag)
      if (!p) return fail('bad-link')
      finished = true
      try { ws.close() } catch { /* gone */ }
      cb.done(p)
    } else if (m.type === 'error') fail(String(m.reason || 'failed'))
  }
  ws.onclose = () => fail('unreachable')
}

// ─── Our own code (protocol 7) ───────────────────────────────────────────────
// For one person with only a phone: the timer's browser and the Even app can't both be in front, so
// typing the timer's code here, then its number there, kept failing. Instead the glasses show a code
// (only the wearer can read it) and the timer's share panel takes it. The secret and our key are
// kept (ts_offer) so the same code survives the Even app going to the background and coming back.

export interface OfferKeep { secret: string; priv: JsonWebKey; pub: string; until: number }

const b64u = (buf: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0))
const CURVE = { name: 'ECDH', namedCurve: 'P-256' }

/** A new secret and key pair for an offer (valid for 10 minutes, as the server keeps it) */
export async function newOffer(): Promise<OfferKeep> {
  const S = crypto.subtle
  const pair = await S.generateKey(CURVE, true, ['deriveKey']) as CryptoKeyPair
  return {
    secret: b64u(crypto.getRandomValues(new Uint8Array(24)).buffer),
    priv: await S.exportKey('jwk', pair.privateKey),
    pub: b64u(await S.exportKey('raw', pair.publicKey)),
    until: Date.now() + 10 * 60 * 1000,
  }
}

/** Opens the timer's sealed link: "<its public key>.<iv>.<ciphertext>" (ECDH P-256, AES-GCM) */
async function unseal(keep: OfferKeep, sealed: string): Promise<string> {
  const [e, iv, ct] = sealed.split('.')
  const S = crypto.subtle
  const priv = await S.importKey('jwk', keep.priv, CURVE, false, ['deriveKey'])
  const theirs = await S.importKey('raw', unb64u(e), CURVE, false, [])
  const key = await S.deriveKey({ name: 'ECDH', public: theirs }, priv, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  return new TextDecoder().decode(await S.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, key, unb64u(ct)))
}

export const OFFER_ERRORS: Record<string, string> = {
  'expired': 'The code ran out (10 minutes). Start again for a new one.',
  'too-many': 'Too many codes asked for from this network. Wait a few minutes.',
  'bad-link': 'The timer sent a link these glasses can’t use.',
  'old-server': 'The timer’s server can’t do this yet.',
}

export interface OfferEvents {
  code: (code: string) => void
  taken: () => void
  done: (p: Paired, token: string) => void
  fail: (reason: string) => void      // an OFFER_ERRORS key
}

/** Waits for the timer to take our code; reconnects (same secret, same code) until done, failed or stopped */
export class OfferLink {
  private ws: WebSocket | null = null
  private stopped = false
  private retryTimer = 0
  private keepAlive = 0
  private got = false

  constructor(private keep: OfferKeep, private mode: Mode, private on: OfferEvents) {}

  start(): void { this.stopped = false; this.connect() }
  /** Stops waiting; cancel: the server forgets the code too (else it lasts its 10 minutes) */
  stop(cancel = false): void {
    if (cancel && this.ws?.readyState === WebSocket.OPEN) this.ws.send('{"type":"cancel"}')
    this.stopped = true
    clearTimeout(this.retryTimer); clearInterval(this.keepAlive)
    const ws = this.ws; this.ws = null
    try { ws?.close() } catch { /* gone */ }
  }
  /** Back in the foreground: reconnect now if the socket went */
  wake(): void { if (!this.stopped && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) { clearTimeout(this.retryTimer); this.connect() } }

  private finish(fn: () => void): void { this.stop(); fn() }

  private connect(): void {
    if (this.stopped) return
    if (Date.now() > this.keep.until) { this.finish(() => this.on.fail('expired')); return }
    let ws: WebSocket
    try { ws = new WebSocket(withQuery(SERVER, 'offer', this.keep.secret)) } catch { this.retry(); return }
    this.ws = ws
    this.got = false
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'offer', secret: this.keep.secret, pub: this.keep.pub, client: CLIENT, mode: this.mode, name: 'Even G2 glasses' }))
      clearInterval(this.keepAlive)
      this.keepAlive = window.setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}') }, 25000)
    }
    ws.onmessage = ev => {
      let m: { type?: string; code?: unknown; sealed?: unknown; reason?: unknown }
      try { m = JSON.parse(String(ev.data)) } catch { return }
      if (m.type === 'offer-code' && typeof m.code === 'string') { this.got = true; this.on.code(m.code) }
      else if (m.type === 'offer-taken') { this.got = true; this.on.taken() }
      else if (m.type === 'granted' && typeof m.sealed === 'string') {
        const sealed = m.sealed
        this.stopped = true
        unseal(this.keep, sealed).then(frag => {
          const p = parseFrag(frag)
          this.finish(() => p ? this.on.done(p, fragToken(frag)) : this.on.fail('bad-link'))
        }, () => this.finish(() => this.on.fail('bad-link')))
      } else if (m.type === 'error') {
        const reason = String(m.reason || '')
        if (reason === 'expired' || reason === 'too-many') this.finish(() => this.on.fail(reason))
        else if (reason === 'bad-request' && !this.got) this.finish(() => this.on.fail('old-server'))   // a server before protocol 7
      }
    }
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; clearInterval(this.keepAlive); this.retry() } }
  }
  private retry(): void {
    if (this.stopped) return
    clearTimeout(this.retryTimer)
    this.retryTimer = window.setTimeout(() => this.connect(), 3000)
  }
}

export type Status =
  | 'connecting'   // reaching the server
  | 'waiting'      // the timer isn't open (its room is gone for now): retrying every 15 s
  | 'offline'      // in the room, but the timer is closed
  | 'pin'          // the timer wants its operator to type our number
  | 'online'
  | 'refused'      // wrong number, or the timer took our access away: pair again

export interface LinkEvents {
  status: (s: Status, detail?: string) => void
  state: (s: Record<string, unknown>, full: boolean) => void
  pin: (code: string) => void
  token: (token: string) => void
  role: (role: Mode, control: Paired | null) => void
}

export class TimerLink {
  private ws: WebSocket | null = null
  private retryTimer = 0
  private keepAlive = 0
  private retry = 1000
  private closed = false
  private pinCode = ''
  status: Status = 'connecting'

  constructor(private p: Paired, private token: string, private mode: Mode, private on: LinkEvents) {}

  start(): void { this.closed = false; this.connect() }

  close(): void {
    this.closed = true
    clearTimeout(this.retryTimer)
    const ws = this.ws
    this.ws = null
    try { ws?.close() } catch { /* gone */ }
  }

  /** Reconnect now (the app came back to the foreground; Android drops sockets in the background) */
  wake(): void {
    if (this.closed || this.status === 'refused') return
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { clearTimeout(this.retryTimer); this.retryTimer = 0; this.connect() }
  }

  private set(s: Status, detail?: string): void { this.status = s; this.on.status(s, detail) }

  /** A command for the timer (an operator's: runsheetnext, runsheetprev, pause, reset, autostart {on});
   * the timer acts on them only from glasses it has made its operator's */
  command(cmd: string, extra: Record<string, unknown> = {}): void { this.up({ t: 'cmd', cmd, ...extra }) }

  private up(d: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'up', msg: { k: 'data', d } }))
  }
  private hello(): void { this.up({ t: 'hello', clock: 1, token: this.token || undefined, client: CLIENT, mode: this.mode }) }

  private connect(): void {
    if (this.closed) return
    this.set('connecting')
    let ws: WebSocket
    try { ws = new WebSocket(withQuery(this.p.server, 'room', this.p.room)) } catch { this.set('refused', 'bad server'); return }
    this.ws = ws
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', room: this.p.room, key: this.p.key }))
      // The server sends no pings of its own (rooms hibernate); this keeps the connection open
      clearInterval(this.keepAlive)
      this.keepAlive = window.setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}') }, 25000)
    }
    ws.onmessage = ev => {
      let m: Record<string, unknown>
      try { m = JSON.parse(String(ev.data)) } catch { return }
      this.onServer(m)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      clearInterval(this.keepAlive)
      if (this.closed || this.status === 'refused') return
      if (this.status !== 'waiting') this.set('connecting')
      this.retryTimer = window.setTimeout(() => this.connect(), this.retry)
      if (this.status !== 'waiting') this.retry = Math.min(this.retry * 2, 10000)
    }
  }

  private onServer(m: Record<string, unknown>): void {
    switch (m.type) {
      case 'joined':
        this.retry = 1000
        if (m.hostOnline) { this.hello(); this.set('online') } else this.set('offline')
        break
      case 'host-online': this.hello(); this.set('online'); break
      case 'host-offline': this.set('offline'); break
      case 'down': {
        const msg = m.msg as { k?: string; d?: unknown } | undefined
        if (msg?.k === 'data' && msg.d && typeof msg.d === 'object') this.onTimer(msg.d as Record<string, unknown>)
        break   // {k:'sig'}: the timer offering a WebRTC link; unanswered, it uses the server
      }
      case 'error': {
        const reason = String(m.reason ?? '')
        if (reason === 'not-found' || reason === 'room-closed') { this.retry = 15000; this.set('waiting') }
        else if (reason === 'rejected') this.set('refused', 'rejected')
        else this.set('connecting', reason)
        break
      }
    }
  }

  private onTimer(d: Record<string, unknown>): void {
    switch (d.t) {
      case 'state': this.on.state((d.s && typeof d.s === 'object' ? d.s : {}) as Record<string, unknown>, !!d.full); break
      case 'pin-required': {
        // The proximity check: the operator types this number on the timer. Shown on the phone only
        if (!this.pinCode) this.pinCode = String(100 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900))
        this.set('pin')
        this.on.pin(this.pinCode)
        this.up({ t: 'pin', code: this.pinCode, name: 'Even G2 glasses' })
        break
      }
      case 'pin-ok':
        this.pinCode = ''
        if (typeof d.token === 'string') { this.token = d.token; this.on.token(d.token) }
        this.hello()
        this.set('online')
        break
      case 'role': {
        const role: Mode = d.role === 'operator' ? 'operator' : 'presenter'
        this.on.role(role, role === 'operator' && typeof d.frag === 'string' ? parseFrag(d.frag) : null)
        break
      }
      case 'pin-rejected': this.pinCode = ''; this.set('refused', 'rejected'); this.close(); break
      case 'revoked': this.set('refused', 'revoked'); this.close(); break
    }
  }
}
