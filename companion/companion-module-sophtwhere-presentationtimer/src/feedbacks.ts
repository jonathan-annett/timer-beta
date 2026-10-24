import { combineRgb, type CompanionFeedbackDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'

const truthy = (v: unknown): boolean => v === true || v === 'true' || v === '1' || v === 1

export const FEEDBACK_IDS = ['connected', 'paused', 'impending', 'expired', 'adjusting', 'message_showing', 'runsheet_active', 'runsheet_behind',
	'runsheet_ahead', 'video_cued', 'video_playing', 'message_is', 'switch_on', 'remain_under'] as const

const W = combineRgb(255, 255, 255)
const K = combineRgb(0, 0, 0)
/**
 * The look each feedback gives a button when true. Used as the feedback's defaultStyle (for
 * feedbacks added by hand) and by presets.ts: a preset's feedback has no style unless the preset
 * spells one out, so without this the preset buttons never light up.
 */
export const DEFAULT_STYLES: Record<(typeof FEEDBACK_IDS)[number], { bgcolor: number; color: number }> = {
	connected: { bgcolor: combineRgb(0, 80, 0), color: W },
	paused: { bgcolor: combineRgb(160, 110, 0), color: W },
	impending: { bgcolor: combineRgb(220, 120, 0), color: K },
	expired: { bgcolor: combineRgb(200, 0, 0), color: W },
	adjusting: { bgcolor: combineRgb(0, 90, 140), color: W },
	message_showing: { bgcolor: combineRgb(90, 0, 140), color: W },
	runsheet_active: { bgcolor: combineRgb(0, 80, 0), color: W },
	runsheet_behind: { bgcolor: combineRgb(200, 0, 0), color: W },
	runsheet_ahead: { bgcolor: combineRgb(0, 120, 0), color: W },
	video_cued: { bgcolor: combineRgb(0, 80, 0), color: W },
	video_playing: { bgcolor: combineRgb(200, 0, 0), color: W },
	message_is: { bgcolor: combineRgb(90, 0, 140), color: W },
	switch_on: { bgcolor: combineRgb(0, 80, 0), color: W },
	remain_under: { bgcolor: combineRgb(220, 120, 0), color: K },
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	const vars = () => self.link?.vars ?? {}
	const stateIs = (id: keyof typeof DEFAULT_STYLES, test: () => boolean, name: string, description?: string) => ({
		[id]: {
			type: 'boolean' as const,
			name,
			description,
			defaultStyle: { ...DEFAULT_STYLES[id] },
			options: [],
			callback: () => test(),
		},
	})

	const defs: CompanionFeedbackDefinitions = {
		...stateIs('connected', () => !!self.link?.online, 'Connected to the timer'),
		...stateIs('paused', () => truthy(vars().pausing), 'Timer is paused'),
		...stateIs('impending', () => truthy(vars().impending) && !truthy(vars().expired), 'Under a minute left'),
		...stateIs('expired', () => truthy(vars().expired), 'Time is up (overtime)'),
		...stateIs('adjusting', () => truthy(vars().adjusting_up) || truthy(vars().adjusting_down), 'Catch up possible (a nudge is in progress)'),
		...stateIs('message_showing', () => String(vars().custommsg ?? '') !== '', 'A message is showing'),
		...stateIs('runsheet_active', () => truthy(vars().rs_active), 'Run sheet mode is on'),
		...stateIs('runsheet_behind', () => Number(vars().rs_late) >= 30, 'Run sheet: behind schedule (30 s or more)'),
		...stateIs('runsheet_ahead', () => Number(vars().rs_late) <= -30 && vars().rs_late !== '' && vars().rs_late != null, 'Run sheet: ahead of schedule (30 s or more)'),
		...stateIs('video_cued', () => vars().video_status === 'cued', 'A video is cued (ready to play)'),
		...stateIs('video_playing', () => vars().video_status === 'playing', 'A video is playing'),
		message_is: {
			type: 'boolean',
			name: 'The message showing is…',
			defaultStyle: { ...DEFAULT_STYLES.message_is },
			options: [{ id: 'text', type: 'textinput', label: 'Message', default: 'Please wrap up', useVariables: true }],
			callback: (fb) => String(vars().custommsg ?? '') === String(fb.options.text ?? '').trim(),
		},
		switch_on: {
			type: 'boolean',
			name: 'A display switch is on',
			defaultStyle: { ...DEFAULT_STYLES.switch_on },
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
			defaultStyle: { ...DEFAULT_STYLES.remain_under },
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
