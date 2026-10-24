import type { CompanionActionDefinitions, CompanionActionEvent } from '@companion-module/base'
import type ModuleInstance from './main.js'

/**
 * Durations: "12" = 12 minutes, "1:30" = 1 h 30 min, "0:20:00" = 20 minutes exactly (h:mm:ss),
 * "90s" = 90 seconds, "20m", "1h". Returns milliseconds, or null.
 */
export function parseDuration(text: string): number | null {
	const t = String(text ?? '')
		.trim()
		.toLowerCase()
	if (!t) return null
	let m = t.match(/^(\d+):(\d{1,2}):(\d{1,2})$/)
	if (m) return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000
	m = t.match(/^(\d+):(\d{1,2})$/)
	if (m) return (Number(m[1]) * 3600 + Number(m[2]) * 60) * 1000
	m = t.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?)$/)
	if (m) return Math.round(Number(m[1]) * 1000)
	m = t.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?)$/)
	if (m) return Math.round(Number(m[1]) * 3600000)
	m = t.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?)?$/)
	if (m) return Math.round(Number(m[1]) * 60000)
	return null
}

export function UpdateActions(self: ModuleInstance): void {
	// Companion resolves variables and expressions in the options before the callback runs
	const parse = (ev: CompanionActionEvent, id: string): string => String(ev.options[id] ?? '')
	const dur = (ev: CompanionActionEvent, id: string): number | null => {
		const text = parse(ev, id)
		const ms = parseDuration(text)
		if (ms === null) self.log('warn', `Couldn't read the duration "${text}" (try 12, 1:30, 90s or 20 min)`)
		return ms
	}
	const api = (msg: Record<string, unknown>) =>
		self.link?.api(msg).catch((err: Error) => self.log('warn', `${String(msg.cmd)}: ${err.message}`))

	const durationOption = (label: string, def: string) => ({
		id: 'duration',
		type: 'textinput' as const,
		label,
		default: def,
		useVariables: true,
		tooltip: 'Minutes (12), h:mm (1:30), h:mm:ss (0:20:00), or 90s / 20 min / 1 h. Variables and expressions allowed.',
	})

	const defs: CompanionActionDefinitions = {
		start_duration: {
			name: 'Start a countdown',
			description: 'Sets the default duration, starts the countdown and (optionally) shows a message',
			options: [
				durationOption('Duration', '10'),
				{ id: 'message', type: 'textinput', label: 'Message to show (empty: leave as is)', default: '', useVariables: true },
				{ id: 'setdefault', type: 'checkbox', label: 'Also make it the default duration', default: true },
			],
			callback: async (ev) => {
				const ms = dur(ev, 'duration')
				if (ms === null) return
				if (ev.options.setdefault) await api({ cmd: 'default', msecs: ms })
				await api({ cmd: 'start', msecs: ms })
				const msg = parse(ev, 'message')
				if (msg.trim()) await api({ cmd: 'custommessage', text: msg.trim() })
			},
		},
		start: {
			name: 'Start / restart with the default duration',
			options: [],
			callback: async () => {
				await api({ cmd: 'start' })
			},
		},
		set_default: {
			name: 'Set the default duration',
			options: [durationOption('Duration', '10')],
			callback: async (ev) => {
				const ms = dur(ev, 'duration')
				if (ms !== null) await api({ cmd: 'default', msecs: ms })
			},
		},
		pause: {
			name: 'Pause / resume',
			options: [],
			callback: async () => {
				await api({ cmd: 'pause' })
			},
		},
		pause_set: {
			name: 'Pause or resume (specific)',
			options: [{ id: 'state', type: 'dropdown', label: 'Make it', default: 'pause', choices: [{ id: 'pause', label: 'Paused' }, { id: 'resume', label: 'Running' }] }],
			callback: async (ev) => {
				const paused = self.link?.vars.pausing === true || self.link?.vars.pausing === 'true'
				if ((ev.options.state === 'pause') !== paused) await api({ cmd: 'pause' })
			},
		},
		undopause: {
			name: 'Undo pauses (restore the original end time)',
			options: [],
			callback: async () => {
				await api({ cmd: 'undopause' })
			},
		},
		adjust: {
			name: 'Add or remove time (applied at once)',
			options: [
				{ id: 'dir', type: 'dropdown', label: 'Direction', default: 'add', choices: [{ id: 'add', label: 'Add' }, { id: 'remove', label: 'Remove' }] },
				durationOption('Amount', '1'),
			],
			callback: async (ev) => {
				const ms = dur(ev, 'duration')
				if (ms !== null) await api({ cmd: 'adjust', addtime: ev.options.dir === 'add', msecs: ms })
			},
		},
		nudge: {
			name: 'Nudge the end time (countdown eases to it)',
			description: 'Like the timer’s ↑/↓ keys: the display runs fast or slow until it reaches the new end. Catch up jumps there.',
			options: [
				{ id: 'dir', type: 'dropdown', label: 'Direction', default: 'add', choices: [{ id: 'add', label: 'Later' }, { id: 'remove', label: 'Earlier' }] },
				durationOption('Amount', '10s'),
			],
			callback: async (ev) => {
				const ms = dur(ev, 'duration')
				if (ms !== null) await api({ cmd: 'nudge', addtime: ev.options.dir === 'add', msecs: ms })
			},
		},
		catchup: {
			name: 'Catch up (jump to the nudged end time)',
			options: [],
			callback: async () => {
				await api({ cmd: 'catchup' })
			},
		},
		message: {
			name: 'Show a message',
			options: [{ id: 'text', type: 'textinput', label: 'Message', default: 'Please wrap up', useVariables: true }],
			callback: async (ev) => {
				await api({ cmd: 'custommessage', text: (parse(ev, 'text')).trim() })
			},
		},
		message_clear: {
			name: 'Clear the message',
			options: [],
			callback: async () => {
				await api({ cmd: 'custommessage', text: '' })
			},
		},
		message_toggle: {
			name: 'Show a message, or clear it if it is already showing',
			options: [{ id: 'text', type: 'textinput', label: 'Message', default: 'Please wrap up', useVariables: true }],
			callback: async (ev) => {
				const text = (parse(ev, 'text')).trim()
				const now = String(self.link?.vars.custommsg ?? '')
				await api({ cmd: 'custommessage', text: now === text ? '' : text })
			},
		},
		toggle: {
			name: 'Toggle a display switch',
			options: [
				{
					id: 'what',
					type: 'dropdown',
					label: 'Switch',
					default: 'bar',
					choices: [
						{ id: 'bar', label: 'Progress bar (B)' },
						{ id: 'time', label: 'Time of day (T)' },
						{ id: 'messages', label: 'Messages (M)' },
						{ id: 'presenter', label: 'Presenter mode in the timer window (P)' },
					],
				},
			],
			callback: async (ev) => {
				await api({ cmd: String(ev.options.what) })
			},
		},
		switch_set: {
			name: 'Set a display switch on or off',
			options: [
				{
					id: 'what',
					type: 'dropdown',
					label: 'Switch',
					default: 'bar',
					choices: [
						{ id: 'showbar', label: 'Progress bar' },
						{ id: 'showtimenow', label: 'Time of day' },
						{ id: 'showmessages', label: 'Messages' },
					],
				},
				{ id: 'on', type: 'checkbox', label: 'On', default: true },
			],
			callback: async (ev) => {
				const v = self.link?.vars[String(ev.options.what)]
				const isOn = v === '1' || v === 1 || v === true
				const cmd = { showbar: 'bar', showtimenow: 'time', showmessages: 'messages' }[String(ev.options.what)]
				if (cmd && isOn !== !!ev.options.on) await api({ cmd })
			},
		},
		runsheet_next: {
			name: 'Run sheet: Next',
			options: [],
			callback: async () => {
				await api({ cmd: 'runsheetnext' })
			},
		},
		runsheet_back: {
			name: 'Run sheet: Back',
			options: [],
			callback: async () => {
				await api({ cmd: 'runsheetprev' })
			},
		},
		video: {
			name: 'Video player',
			options: [
				{
					id: 'what',
					type: 'dropdown',
					label: 'Do',
					default: 'videoplay',
					choices: [
						{ id: 'videoplay', label: 'Play the cued video' },
						{ id: 'videostop', label: 'Stop' },
						{ id: 'videorewind', label: 'Rewind (cued again)' },
					],
				},
			],
			callback: async (ev) => {
				await api({ cmd: String(ev.options.what) })
			},
		},
		keys: {
			name: 'Send keystrokes to the timer',
			description: 'Keys as the timer’s keyboard reference lists them, separated by commas, e.g. "1,0,Enter" or "Control,ArrowUp,~Control" (~ = key up). Careful: this does whatever the keys do.',
			options: [{ id: 'keys', type: 'textinput', label: 'Keys', default: ' ', useVariables: true }],
			callback: async (ev) => {
				const keys = (parse(ev, 'keys')).split(',').map((k) => (k === '' ? ' ' : k))
				await api({ cmd: 'keys', keys })
			},
		},
		raw: {
			name: 'Send a raw timer API command (JSON)',
			description: 'Advanced: the object passed to processTimerApiMessage, e.g. {"cmd":"start","msecs":300000}. See timerapi.js.',
			options: [{ id: 'json', type: 'textinput', label: 'JSON', default: '{"cmd":"start"}', useVariables: true }],
			callback: async (ev) => {
				const text = parse(ev, 'json')
				let msg: unknown
				try {
					msg = JSON.parse(text)
				} catch {
					self.log('warn', `Raw command isn't valid JSON: ${text}`)
					return
				}
				if (!msg || typeof msg !== 'object' || typeof (msg as { cmd?: unknown }).cmd !== 'string') {
					self.log('warn', 'Raw command needs a "cmd" field')
					return
				}
				await api(msg as Record<string, unknown>)
			},
		},
	}
	self.setActionDefinitions(defs)
}
