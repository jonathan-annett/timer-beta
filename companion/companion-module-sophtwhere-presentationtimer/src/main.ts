import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, splitRemain } from './variables.js'
import { UpdateActions } from './actions.js'
import { UpdateFeedbacks, FEEDBACK_IDS } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { TimerLink, parseLink, type LinkStatus } from './link.js'

/**
 * Presentation Timer connection. The timer (timer.sophtwhere.com, or your own copy) runs in a
 * browser; this module joins it through its pairing server with the Companion link from the
 * timer's phone panel, runs commands on it and mirrors its variables. See HELP.md.
 */
export default class ModuleInstance extends InstanceBase {
	config!: ModuleConfig
	link: TimerLink | null = null
	private extraVars = new Set<string>()
	private varTimer: NodeJS.Timeout | null = null
	private pendingVars: Record<string, string | number | boolean | null> = {}

	async init(config: unknown): Promise<void> {
		this.config = config as ModuleConfig
		UpdateActions(this)
		UpdateFeedbacks(this)
		UpdatePresets(this)
		UpdateVariableDefinitions(this, [])
		this.setVariableValues({ link_status: 'offline' })
		this.connect()
	}

	async destroy(): Promise<void> {
		this.disconnect()
	}

	async configUpdated(cfg: unknown): Promise<void> {
		const config = cfg as ModuleConfig
		const relink = config.link !== this.config.link || config.server !== this.config.server || config.insecure !== this.config.insecure
		this.config = config
		if (relink) {
			this.disconnect()
			this.connect()
		}
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	private disconnect(): void {
		if (this.link) this.link.close()
		this.link = null
		if (this.varTimer) clearTimeout(this.varTimer)
		this.varTimer = null
	}

	private connect(): void {
		const parsed = parseLink(this.config.link ?? '')
		if (!parsed) {
			this.updateStatus(InstanceStatus.BadConfig, 'Paste the Companion link from the timer’s phone panel')
			return
		}
		if (parsed.kind === 'view') {
			this.updateStatus(InstanceStatus.BadConfig, 'That is a view-only link; use the Companion link (or a control/admin one)')
			return
		}
		if (parsed.kind !== 'companion') this.log('warn', `This is a ${parsed.kind} link: it works for commands, but only a Companion link gets every command and all variables`)
		const server = (this.config.server || '').trim() || parsed.server
		let origin: string | undefined
		try {
			const u = new URL(server)
			origin = `https://${u.hostname}`
		} catch {
			this.updateStatus(InstanceStatus.BadConfig, `Bad server address: ${server}`)
			return
		}
		const link = new TimerLink({
			server,
			room: parsed.room,
			key: parsed.key,
			token: this.config.token || undefined,
			rejectUnauthorized: !this.config.insecure,
			origin,
		})
		this.link = link
		link.on('status', (status, detail) => this.onLinkStatus(status, detail))
		link.on('vars', (vars) => this.onVars(vars))
		link.on('state', () => this.checkFeedbacks(...FEEDBACK_IDS))
		link.on('token', (token) => {
			// Keep the PIN approval across restarts
			this.config.token = token
			this.saveConfig({ ...this.config, token }, undefined)
		})
		link.on('pin', (code) => this.log('info', `The timer wants a PIN: enter ${code} in its phone panel to let Companion in`))
		link.start()
	}

	private onLinkStatus(status: LinkStatus, detail?: string): void {
		const map: Record<LinkStatus, InstanceStatus> = {
			connecting: InstanceStatus.Connecting,
			waiting: InstanceStatus.Disconnected,
			pin: InstanceStatus.UnknownWarning,
			online: InstanceStatus.Ok,
			offline: InstanceStatus.Disconnected,
			rejected: InstanceStatus.ConnectionFailure,
			error: InstanceStatus.ConnectionFailure,
		}
		const text: Record<LinkStatus, string> = {
			connecting: 'Connecting to the pairing server…',
			waiting: 'Waiting for the timer',
			pin: 'PIN needed on the timer',
			online: 'Connected',
			offline: 'The timer is not open',
			rejected: 'Refused',
			error: 'Error',
		}
		this.updateStatus(map[status], detail ? `${text[status]}: ${detail}` : text[status])
		this.setVariableValues({ link_status: status })
		this.checkFeedbacks('connected')
	}

	// The timer's bus arrives as diffs, up to a few times a second; batch them into one update
	private onVars(vars: Record<string, string | number | boolean | null>): void {
		let newVars = false
		for (const [k, v] of Object.entries(vars)) {
			if (!/^[\w-]{1,64}$/.test(k)) continue
			this.pendingVars[k] = v
			if (!this.extraVars.has(k)) {
				this.extraVars.add(k)
				newVars = true
			}
		}
		if (newVars) UpdateVariableDefinitions(this, [...this.extraVars])
		if (this.varTimer) return
		this.varTimer = setTimeout(() => {
			this.varTimer = null
			const out: Record<string, string | number | boolean | undefined> = {}
			for (const [k, v] of Object.entries(this.pendingVars)) out[k] = v === null ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : v
			if ('remain' in this.pendingVars) Object.assign(out, splitRemain(String(this.pendingVars.remain ?? '')))
			this.pendingVars = {}
			this.setVariableValues(out)
			this.checkFeedbacks(...FEEDBACK_IDS)
		}, 40)
	}
}
