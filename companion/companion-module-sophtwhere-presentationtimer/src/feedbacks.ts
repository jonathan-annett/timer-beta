import { combineRgb, type CompanionFeedbackDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'

const truthy = (v: unknown): boolean => v === true || v === 'true' || v === '1' || v === 1

export const FEEDBACK_IDS = ['connected', 'paused', 'impending', 'expired', 'adjusting', 'message_showing', 'runsheet_active', 'runsheet_behind',
	'runsheet_ahead', 'video_cued', 'video_playing', 'message_is', 'switch_on', 'remain_under'] as const

export function UpdateFeedbacks(self: ModuleInstance): void {
	const vars = () => self.link?.vars ?? {}
	const stateIs = (id: string, def: { bgcolor: number; color?: number }, test: () => boolean, name: string, description?: string) => ({
		[id]: {
			type: 'boolean' as const,
			name,
			description,
			defaultStyle: { bgcolor: def.bgcolor, color: def.color ?? combineRgb(255, 255, 255) },
			options: [],
			callback: () => test(),
		},
	})

	const defs: CompanionFeedbackDefinitions = {
		...stateIs('connected', { bgcolor: combineRgb(0, 80, 0) }, () => !!self.link?.online, 'Connected to the timer'),
		...stateIs('paused', { bgcolor: combineRgb(160, 110, 0) }, () => truthy(vars().pausing), 'Timer is paused'),
		...stateIs('impending', { bgcolor: combineRgb(220, 120, 0), color: combineRgb(0, 0, 0) }, () => truthy(vars().impending) && !truthy(vars().expired), 'Under a minute left'),
		...stateIs('expired', { bgcolor: combineRgb(200, 0, 0) }, () => truthy(vars().expired), 'Time is up (overtime)'),
		...stateIs('adjusting', { bgcolor: combineRgb(0, 90, 140) }, () => truthy(vars().adjusting_up) || truthy(vars().adjusting_down), 'Catch up possible (a nudge is in progress)'),
		...stateIs('message_showing', { bgcolor: combineRgb(90, 0, 140) }, () => String(vars().custommsg ?? '') !== '', 'A message is showing'),
		...stateIs('runsheet_active', { bgcolor: combineRgb(0, 80, 0) }, () => truthy(vars().rs_active), 'Run sheet mode is on'),
		...stateIs('runsheet_behind', { bgcolor: combineRgb(200, 0, 0) }, () => Number(vars().rs_late) >= 30, 'Run sheet: behind schedule (30 s or more)'),
		...stateIs('runsheet_ahead', { bgcolor: combineRgb(0, 120, 0) }, () => Number(vars().rs_late) <= -30 && vars().rs_late !== '' && vars().rs_late != null, 'Run sheet: ahead of schedule (30 s or more)'),
		...stateIs('video_cued', { bgcolor: combineRgb(0, 80, 0) }, () => vars().video_status === 'cued', 'A video is cued (ready to play)'),
		...stateIs('video_playing', { bgcolor: combineRgb(200, 0, 0) }, () => vars().video_status === 'playing', 'A video is playing'),
		message_is: {
			type: 'boolean',
			name: 'The message showing is…',
			defaultStyle: { bgcolor: combineRgb(90, 0, 140), color: combineRgb(255, 255, 255) },
			options: [{ id: 'text', type: 'textinput', label: 'Message', default: 'Please wrap up', useVariables: true }],
			callback: (fb) => String(vars().custommsg ?? '') === String(fb.options.text ?? '').trim(),
		},
		switch_on: {
			type: 'boolean',
			name: 'A display switch is on',
			defaultStyle: { bgcolor: combineRgb(0, 80, 0), color: combineRgb(255, 255, 255) },
			options: [
				{
					id: 'what',
					type: 'dropdown',
					label: 'Switch',
					default: 'showbar',
					choices: [
						{ id: 'showbar', label: 'Progress bar' },
						{ id: 'showtimenow', label: 'Time of day' },
						{ id: 'showmessages', label: 'Messages' },
						{ id: 'showpresenter', label: 'Presenter mode' },
					],
				},
			],
			callback: (fb) => truthy(vars()[String(fb.options.what)]),
		},
		remain_under: {
			type: 'boolean',
			name: 'Remaining time is under…',
			defaultStyle: { bgcolor: combineRgb(220, 120, 0), color: combineRgb(0, 0, 0) },
			options: [{ id: 'seconds', type: 'number', label: 'Seconds', default: 300, min: 0, max: 86400 }],
			callback: (fb) => {
				const s = remainSeconds(String(vars().remain ?? ''))
				return s !== null && !truthy(vars().expired) && s < Number(fb.options.seconds)
			},
		},
	}
	self.setFeedbackDefinitions(defs)
}

/** "9:58" → 598, "1:02:03" → 3723; null if unreadable. */
export function remainSeconds(text: string): number | null {
	const m = text.trim().replace(/^\+/, '').match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/)
	if (!m) return null
	return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])
}
