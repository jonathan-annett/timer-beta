import type ModuleInstance from './main.js'

/**
 * Variables mirror the timer's own bus (timerAPI setVariableValues), which was designed for
 * Companion in the first place. The ones below are declared with names; anything else the timer
 * sends is exposed too, under its bus name, so a newer timer adds variables without a module update.
 */
export const KNOWN_VARIABLES: Record<string, string> = {
	remain: 'Remaining time as shown (e.g. 9:58, 1:02:03; counts up after zero)',
	remain_sign: 'Remaining: "+" in overtime, else empty',
	remain_hours: 'Remaining: hours (no padding)',
	remain_minutes: 'Remaining: minutes, 00–59',
	remain_seconds: 'Remaining: seconds, 00–59',
	remain_total: 'Remaining: whole seconds (negative in overtime)',
	remain_major: 'Remaining, big part: minutes under an hour (01), hours from an hour up (1h)',
	remain_minor: 'Remaining, small part: seconds under an hour (30), minutes from an hour up (25m)',
	remain_actual: 'Remaining time without the catch-up easing',
	elapsed: 'Elapsed time',
	default: 'Default duration (what Start uses)',
	startedAt: 'Started at (clock time)',
	endsAt: 'Ends at (clock time)',
	paused: 'Length of the current pause',
	pauses: 'Total paused time this run',
	pausing: 'Paused (true/false)',
	expired: 'Time is up (true/false)',
	impending: 'Under a minute left (true/false)',
	adjusting_up: 'Running slow to reach a later end (true/false)',
	adjusting_down: 'Running fast to reach an earlier end (true/false)',
	adjusting_delta: 'Seconds still to catch up',
	custommsg: 'Message on screen (empty when none)',
	showbar: 'Progress bar shown (1/0)',
	showtimenow: 'Time of day shown (1/0)',
	showmessages: 'Messages shown (1/0)',
	showpresenter: 'Presenter mode in the timer window (1/0)',
	barpct: 'Progress bar percent',
	htmlclass: "The timer's state classes (e.g. 'paused over showbar')",
	rs_active: 'Run sheet mode on (1/0)',
	rs_current: 'Run sheet: current item',
	rs_next: 'Run sheet: next item',
	rs_can_back: 'Run sheet: Back is possible (1/0)',
	rs_status: 'Run sheet: ahead/behind text',
	rs_late: 'Run sheet: seconds behind (negative = ahead)',
	rs_title: 'Run sheet title',
	rs_text: 'Run sheet: status line',
	video_status: 'Video player: empty, cued or playing',
	pptx_machines: 'PowerPoint: computers connected (players)',
	pptx_current: 'PowerPoint: the deck on screen (or last shown)',
	pptx_showing: 'PowerPoint: a slide show is running (1/0)',
	pptx_slide: 'PowerPoint: current slide (0 when the player can’t tell)',
	pptx_slides: 'PowerPoint: slides in the deck (0 when the player can’t tell)',
	pptx_next_ready: 'PowerPoint: the next item’s deck is ready on every computer (1/0; empty when it has none)',
	video_name: 'Video player: the video',
	link_status: 'This connection: online, offline, waiting, pin, …',
}

export function UpdateVariableDefinitions(self: ModuleInstance, extra: string[]): void {
	const defs: Record<string, { name: string }> = {}
	for (const [id, name] of Object.entries(KNOWN_VARIABLES)) defs[id] = { name }
	for (const id of extra) if (!KNOWN_VARIABLES[id]) defs[id] = { name: `Timer: ${id}` }
	self.setVariableDefinitions(defs)
}

/**
 * Splits the timer's remaining-time text ("9:58", "1:02:03", "+0:12") into parts that fit on one
 * button each, so a big display can be built from several keys. Mirrors the Stream Deck
 * countdown_major/countdown_minor keys.
 */
export function splitRemain(text: string): Record<string, string | number> {
	const m = String(text ?? '').trim().match(/^(\+?)(?:(\d+):)?(\d{1,2}):(\d{2})$/)
	if (!m) return { remain_sign: '', remain_hours: '', remain_minutes: '', remain_seconds: '', remain_total: '', remain_major: '', remain_minor: '' }
	const sign = m[1], h = Number(m[2] ?? 0), mi = Number(m[3]), se = Number(m[4])
	const total = h * 3600 + mi * 60 + se
	const pad = (n: number) => String(n).padStart(2, '0')
	return {
		remain_sign: sign,
		remain_hours: String(h),
		remain_minutes: pad(mi),
		remain_seconds: pad(se),
		remain_total: sign ? -total : total,
		remain_major: h ? `${sign}${h}h` : `${sign}${pad(mi)}`,
		remain_minor: h ? `${pad(mi)}m` : pad(se),
	}
}
