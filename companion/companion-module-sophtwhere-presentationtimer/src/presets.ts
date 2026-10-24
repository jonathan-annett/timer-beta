import { combineRgb, type CompanionPresetDefinitions, type CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from './main.js'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const DARK = combineRgb(26, 26, 46)

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions = {}
	const groups = new Map<string, string[]>()
	const button = (
		id: string,
		category: string,
		name: string,
		text: string,
		actions: { actionId: string; options: Record<string, unknown> }[],
		feedbacks: { feedbackId: string; options?: Record<string, unknown>; style?: Record<string, unknown> }[] = [],
		size: 'auto' | '7' | '14' | '18' | '24' | '30' | '44' = 'auto',
	) => {
		presets[id] = {
			type: 'simple',
			name,
			style: { text, size, color: WHITE, bgcolor: DARK },
			steps: [{ down: actions as never, up: [] }],
			feedbacks: feedbacks.map((f) => ({ feedbackId: f.feedbackId, options: f.options ?? {}, style: f.style })) as never,
		}
		if (!groups.has(category)) groups.set(category, [])
		groups.get(category)!.push(id)
	}

	// Countdown display
	button('remain', 'Countdown', 'Remaining time', '$(presentationtimer:remain)', [{ actionId: 'pause', options: {} }], [
		{ feedbackId: 'paused' },
		{ feedbackId: 'impending' },
		{ feedbackId: 'expired' },
	], 'auto')
	button('remain_msg', 'Countdown', 'Remaining time + message', '$(presentationtimer:remain)\\n$(presentationtimer:custommsg)', [{ actionId: 'pause', options: {} }], [
		{ feedbackId: 'paused' },
		{ feedbackId: 'impending' },
		{ feedbackId: 'expired' },
	], 'auto')
	// Big displays built from several keys (one value per key, so nothing wraps)
	button('big_major', 'Countdown', 'Big: minutes (hours when over an hour)', '$(presentationtimer:remain_sign)$(presentationtimer:remain_major)', [{ actionId: 'pause', options: {} }], [
		{ feedbackId: 'paused' },
		{ feedbackId: 'impending' },
		{ feedbackId: 'expired' },
	], '44')
	button('big_minor', 'Countdown', 'Big: seconds (minutes when over an hour)', '$(presentationtimer:remain_minor)', [{ actionId: 'pause', options: {} }], [
		{ feedbackId: 'paused' },
		{ feedbackId: 'impending' },
		{ feedbackId: 'expired' },
	], '44')
	button('big_hours', 'Countdown', 'Big: hours', '$(presentationtimer:remain_sign)$(presentationtimer:remain_hours)', [], [{ feedbackId: 'expired' }], '44')
	button('big_minutes', 'Countdown', 'Big: minutes', '$(presentationtimer:remain_minutes)', [], [{ feedbackId: 'expired' }], '44')
	button('big_seconds', 'Countdown', 'Big: seconds', '$(presentationtimer:remain_seconds)', [], [{ feedbackId: 'expired' }], '44')
	button('elapsed', 'Countdown', 'Elapsed / ends at', 'elapsed\\n$(presentationtimer:elapsed)\\nends $(presentationtimer:endsAt)', [], [], '7')

	// Controls
	button('start', 'Controls', 'Start / restart', '▶ Start\\n$(presentationtimer:default)', [{ actionId: 'start', options: {} }])
	button('pause', 'Controls', 'Pause / resume', '⏸ Pause', [{ actionId: 'pause', options: {} }], [
		{ feedbackId: 'paused', style: { text: '▶ Resume', bgcolor: combineRgb(160, 110, 0) } },
	])
	button('plus1', 'Controls', '+1 minute', '+1 min', [{ actionId: 'adjust', options: { dir: 'add', duration: '1' } }])
	button('minus1', 'Controls', '−1 minute', '−1 min', [{ actionId: 'adjust', options: { dir: 'remove', duration: '1' } }])
	button('plus15', 'Controls', '+15 seconds', '+15 s', [{ actionId: 'adjust', options: { dir: 'add', duration: '15s' } }])
	button('minus15', 'Controls', '−15 seconds', '−15 s', [{ actionId: 'adjust', options: { dir: 'remove', duration: '15s' } }])
	button('catchup', 'Controls', 'Catch up', 'Catch up', [{ actionId: 'catchup', options: {} }], [{ feedbackId: 'adjusting' }])
	button('undopause', 'Controls', 'Undo pauses', 'Undo\\npauses', [{ actionId: 'undopause', options: {} }])

	// Presets (durations)
	for (const [label, d] of [['5 min', '5'], ['10 min', '10'], ['15 min', '15'], ['20 min', '20'], ['30 min', '30'], ['45 min', '45'], ['1 hour', '60'], ['90 min', '90']] as const) {
		button(`dur_${d}`, 'Durations', `Start ${label}`, label, [{ actionId: 'start_duration', options: { duration: d, message: '', setdefault: true } }])
	}

	// Messages
	for (const text of ['Please wrap up', 'Time for questions', '5 minutes left', 'Last slide please']) {
		const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '_')
		button(`msg_${id}`, 'Messages', `Message: ${text}`, text, [{ actionId: 'message_toggle', options: { text } }], [
			{ feedbackId: 'message_is', options: { text } },
		])
	}
	button('msg_clear', 'Messages', 'Clear message', 'Clear\\nmessage', [{ actionId: 'message_clear', options: {} }], [{ feedbackId: 'message_showing' }])

	// Switches
	button('sw_bar', 'Display', 'Progress bar', 'Bar', [{ actionId: 'toggle', options: { what: 'bar' } }], [{ feedbackId: 'switch_on', options: { what: 'showbar' } }])
	button('sw_time', 'Display', 'Time of day', 'Clock', [{ actionId: 'toggle', options: { what: 'time' } }], [{ feedbackId: 'switch_on', options: { what: 'showtimenow' } }])
	button('sw_msgs', 'Display', 'Messages on/off', 'Msgs', [{ actionId: 'toggle', options: { what: 'messages' } }], [{ feedbackId: 'switch_on', options: { what: 'showmessages' } }])

	// Run sheet
	button('rs_next', 'Run sheet', 'Next', 'Next ▶\\n$(presentationtimer:rs_next)', [{ actionId: 'runsheet_next', options: {} }], [{ feedbackId: 'runsheet_active' }], '7')
	button('rs_back', 'Run sheet', 'Back', '◀ Back', [{ actionId: 'runsheet_back', options: {} }])
	button('rs_status', 'Run sheet', 'Schedule status', '$(presentationtimer:rs_status)', [], [
		{ feedbackId: 'runsheet_behind' },
		{ feedbackId: 'runsheet_ahead' },
	], '7')
	button('rs_now', 'Run sheet', 'Now', 'NOW\\n$(presentationtimer:rs_current)', [], [], '7')

	// Video
	button('video_play', 'Video', 'Play video', '▶ Video\\n$(presentationtimer:video_name)', [{ actionId: 'video', options: { what: 'videoplay' } }], [{ feedbackId: 'video_cued' }], '7')
	button('video_stop', 'Video', 'Stop video', '■ Stop', [{ actionId: 'video', options: { what: 'videostop' } }], [{ feedbackId: 'video_playing' }])
	button('video_rewind', 'Video', 'Rewind video', '⟲ Rewind', [{ actionId: 'video', options: { what: 'videorewind' } }], [{ feedbackId: 'video_playing' }])

	button('link', 'Countdown', 'Connection status', 'Timer\\n$(presentationtimer:link_status)', [], [
		{ feedbackId: 'connected', style: { bgcolor: combineRgb(0, 80, 0), color: BLACK } },
	], '7')

	const structure: CompanionPresetSection[] = [...groups.entries()].map(([name, ids]) => ({
		id: name.toLowerCase().replace(/\W+/g, '_'),
		name,
		definitions: [{ id: name.toLowerCase().replace(/\W+/g, '_') + '_all', name, type: 'simple', presets: ids }],
	}))
	self.setPresetDefinitions(structure, presets)
}
