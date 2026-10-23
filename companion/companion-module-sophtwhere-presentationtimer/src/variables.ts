import type ModuleInstance from './main.js'

/**
 * Variables mirror the timer's own bus (timerAPI setVariableValues), which was designed for
 * Companion in the first place. The ones below are declared with names; anything else the timer
 * sends is exposed too, under its bus name, so a newer timer adds variables without a module update.
 */
export const KNOWN_VARIABLES: Record<string, string> = {
	remain: 'Remaining time as shown (e.g. 9:58, 1:02:03; counts up after zero)',
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
	video_name: 'Video player: the video',
	link_status: 'This connection: online, offline, waiting, pin, …',
}

export function UpdateVariableDefinitions(self: ModuleInstance, extra: string[]): void {
	const defs: Record<string, { name: string }> = {}
	for (const [id, name] of Object.entries(KNOWN_VARIABLES)) defs[id] = { name }
	for (const id of extra) if (!KNOWN_VARIABLES[id]) defs[id] = { name: `Timer: ${id}` }
	self.setVariableDefinitions(defs)
}
