/*
 * The link to the timer: a client of the timer's pairing server (remote-server.js), joining
 * the timer's room with its Companion key exactly as a phone does (see "Phone Remote Control"
 * in the project's CLAUDE.md). Plain WebSocket only: the timer offers a WebRTC data channel and
 * gives up after 7 s, after which everything goes through the server, which is all this needs
 * (a few hundred bytes a second at most).
 *
 *   server:  wss://host:8443/        join {room, key} -> joined {id, hostOnline, role}
 *   timer -> us (as down {msg} with msg {k:'data', d}):
 *            {t:'state', full, s}   the phone-level state (remain, over, msg, ...)
 *            {t:'vars', full, v}    every timerAPI bus variable, as diffs (Companion's own format)
 *            {t:'api-result', req, result|error}
 *            {t:'pin-required'} / {t:'pin-ok', token} / {t:'pin-rejected'}   (Require a PIN)
 *   us -> timer (as up {msg: {k:'data', d}}):
 *            {t:'hello', token?}    {t:'api', req, msg}   {t:'pin', code}
 */

import WebSocket from 'ws'
import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'

export interface LinkConfig {
	server: string
	room: string
	key: string
	/** Token from an earlier PIN approval, if any */
	token?: string
	/** Reject self-signed certificates (true in production) */
	rejectUnauthorized?: boolean
	/** Sent as the Origin header; the server checks it against --origin */
	origin?: string
}

export type LinkStatus = 'connecting' | 'waiting' | 'pin' | 'online' | 'offline' | 'rejected' | 'error'

export interface ParsedLink {
	server: string
	room: string
	key: string
	kind: 'companion' | 'admin' | 'control' | 'view'
}

/** Parses a link copied from the timer's share panel: a whole URL, or just the part after '#'. */
export function parseLink(text: string, defaultServer?: string): ParsedLink | null {
	let frag = text.trim()
	const hash = frag.indexOf('#')
	if (hash >= 0) frag = frag.slice(hash + 1)
	const p = new URLSearchParams(frag)
	const room = p.get('r') ?? p.get('room')
	const c = p.get('c'), a = p.get('a'), k = p.get('k') ?? p.get('key'), v = p.get('v')
	const key = c ?? a ?? k ?? v
	if (!room || !key) return null
	let server = p.get('s') ?? p.get('server') ?? ''
	if (!server && defaultServer) server = defaultServer
	if (!server && hash >= 0) {
		try {
			const u = new URL(text.trim())
			server = `wss://${u.hostname}:8443/`
		} catch {
			/* not a URL */
		}
	}
	if (!server) return null
	return { server, room, key, kind: c ? 'companion' : a ? 'admin' : k ? 'control' : 'view' }
}

export interface TimerLinkEvents {
	status: [status: LinkStatus, detail?: string]
	state: [state: Record<string, unknown>, full: boolean]
	vars: [vars: Record<string, string | number | boolean | null>, full: boolean]
	pin: [code: string]
	token: [token: string]
	role: [role: string]
}

export class TimerLink extends EventEmitter<TimerLinkEvents> {
	private ws: WebSocket | null = null
	private retryTimer: NodeJS.Timeout | null = null
	private retry = 1000
	private waiting = false
	private closed = false
	private hostOnline = false
	private pinCode: string | null = null
	private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
	private seq = 0
	public status: LinkStatus = 'connecting'
	public role = ''
	public readonly state: Record<string, unknown> = {}
	public readonly vars: Record<string, string | number | boolean | null> = {}

	constructor(private cfg: LinkConfig) {
		super()
	}

	start(): void {
		this.closed = false
		this.connect()
	}

	close(): void {
		this.closed = true
		if (this.retryTimer) clearTimeout(this.retryTimer)
		this.retryTimer = null
		for (const p of this.pending.values()) {
			clearTimeout(p.timer)
			p.reject(new Error('closed'))
		}
		this.pending.clear()
		const ws = this.ws
		this.ws = null
		if (ws) {
			try {
				ws.close()
			} catch {
				/* already gone */
			}
		}
	}

	get online(): boolean {
		return this.status === 'online'
	}

	/** Runs a timer API command: processTimerApiMessage(msg) on the timer. Resolves with its result. */
	api(msg: Record<string, unknown>, timeoutMs = 5000): Promise<unknown> {
		if (!this.online) return Promise.reject(new Error('not connected to the timer'))
		const req = (++this.seq).toString(36)
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(req)
				reject(new Error('the timer did not answer'))
			}, timeoutMs)
			this.pending.set(req, { resolve, reject, timer })
			this.up({ t: 'api', req, msg })
		})
	}

	private setStatus(status: LinkStatus, detail?: string): void {
		this.status = status
		this.emit('status', status, detail)
	}

	private up(d: unknown): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify({ type: 'up', msg: { k: 'data', d } }))
		}
	}

	private hello(): void {
		this.up({ t: 'hello', token: this.cfg.token || undefined })
	}

	private connect(): void {
		if (this.closed) return
		if (this.retryTimer) clearTimeout(this.retryTimer)
		this.retryTimer = null
		this.setStatus('connecting')
		let ws: WebSocket
		try {
			ws = new WebSocket(this.cfg.server, {
				rejectUnauthorized: this.cfg.rejectUnauthorized !== false,
				headers: this.cfg.origin ? { origin: this.cfg.origin } : undefined,
			})
		} catch (err) {
			this.setStatus('error', `bad server address: ${(err as Error).message}`)
			return
		}
		this.ws = ws
		ws.on('open', () => {
			ws.send(JSON.stringify({ type: 'join', room: this.cfg.room, key: this.cfg.key }))
		})
		ws.on('message', (data) => {
			let m: Record<string, unknown>
			try {
				m = JSON.parse(data.toString())
			} catch {
				return
			}
			this.onServer(m)
		})
		ws.on('close', () => {
			if (this.ws !== ws) return
			this.ws = null
			this.hostOnline = false
			if (this.status !== 'rejected' && this.status !== 'error') this.setStatus(this.closed ? 'offline' : 'connecting')
			this.schedule()
		})
		ws.on('error', (err) => {
			if (this.ws !== ws) return
			this.setStatus('connecting', err.message)
		})
	}

	private schedule(): void {
		if (this.closed || this.retryTimer) return
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null
			this.connect()
		}, this.retry)
		if (!this.waiting) this.retry = Math.min(this.retry * 2, 10000)
	}

	private onServer(m: Record<string, unknown>): void {
		switch (m.type) {
			case 'joined':
				this.waiting = false
				this.retry = 1000
				this.hostOnline = !!m.hostOnline
				if (typeof m.role === 'string') {
					this.role = m.role
					this.emit('role', m.role)
				}
				if (this.hostOnline) {
					this.hello()
					this.setStatus('online')
				} else this.setStatus('offline', 'the timer is not open')
				break
			case 'host-online':
				this.hostOnline = true
				this.hello()
				this.setStatus('online')
				break
			case 'host-offline':
				this.hostOnline = false
				this.setStatus('offline', 'the timer closed')
				break
			case 'down': {
				const msg = m.msg as { k?: string; d?: unknown } | undefined
				if (msg && msg.k === 'data' && msg.d && typeof msg.d === 'object') this.onTimer(msg.d as Record<string, unknown>)
				// {k:'sig'}: the timer offering a WebRTC link; we don't answer, it falls back to the server
				break
			}
			case 'error': {
				const reason = String(m.reason ?? '')
				if (reason === 'not-found' || reason === 'room-closed') {
					// The room comes back when the timer reopens (or the link is wrong). Keep trying, slowly.
					this.waiting = true
					this.retry = 15000
					this.setStatus('waiting', reason === 'not-found' ? 'no timer with this code (is the link right? is the timer open with phone control on?)' : 'the timer closed')
				} else if (reason === 'room-full') {
					this.setStatus('error', 'too many devices connected to that timer')
				} else this.setStatus('error', `server said: ${reason}`)
				break
			}
		}
	}

	private onTimer(d: Record<string, unknown>): void {
		switch (d.t) {
			case 'state': {
				const s = (d.s && typeof d.s === 'object' ? d.s : {}) as Record<string, unknown>
				if (d.full) for (const k of Object.keys(this.state)) delete this.state[k]
				Object.assign(this.state, s)
				this.emit('state', s, !!d.full)
				break
			}
			case 'vars': {
				const v = (d.v && typeof d.v === 'object' ? d.v : {}) as Record<string, string | number | boolean | null>
				if (d.full) for (const k of Object.keys(this.vars)) delete this.vars[k]
				Object.assign(this.vars, v)
				this.emit('vars', v, !!d.full)
				break
			}
			case 'api-result': {
				const p = typeof d.req === 'string' ? this.pending.get(d.req) : undefined
				if (!p) return
				this.pending.delete(d.req as string)
				clearTimeout(p.timer)
				if (d.error) p.reject(new Error(String(d.error) + (d.detail ? `: ${String(d.detail)}` : '')))
				else p.resolve(d.result)
				break
			}
			case 'pin-required': {
				// The timer wants the operator to let us in: show a PIN for them to type there
				if (!this.pinCode) this.pinCode = String(1000 + (randomBytes(4).readUInt32BE(0) % 9000))
				this.setStatus('pin', `enter PIN ${this.pinCode} in the timer's share panel`)
				this.emit('pin', this.pinCode)
				this.up({ t: 'pin', code: this.pinCode })
				break
			}
			case 'pin-ok': {
				this.pinCode = null
				if (typeof d.token === 'string') {
					this.cfg.token = d.token
					this.emit('token', d.token)
				}
				this.hello()
				this.setStatus('online')
				break
			}
			case 'pin-rejected':
				this.pinCode = null
				this.setStatus('rejected', 'the timer refused this connection (PIN)')
				break
		}
	}
}
