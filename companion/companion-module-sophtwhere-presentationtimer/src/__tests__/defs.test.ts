import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDuration, UpdateActions } from '../actions.js'
import { remainSeconds, UpdateFeedbacks, FEEDBACK_IDS } from '../feedbacks.js'
import { UpdatePresets } from '../presets.js'
import { UpdateVariableDefinitions, splitRemain } from '../variables.js'
import { socketUrl, parseLink } from '../link.js'
import type ModuleInstance from '../main.js'

test('durations', () => {
	assert.equal(parseDuration('12'), 720000)
	assert.equal(parseDuration('1:30'), 5400000)
	assert.equal(parseDuration('0:20:00'), 1200000)
	assert.equal(parseDuration('90s'), 90000)
	assert.equal(parseDuration('20 min'), 1200000)
	assert.equal(parseDuration('1 h'), 3600000)
	assert.equal(parseDuration(''), null)
	assert.equal(parseDuration('soon'), null)
})

test('remaining time text', () => {
	assert.equal(remainSeconds('9:58'), 598)
	assert.equal(remainSeconds('+1:02:03'), 3723)
	assert.equal(remainSeconds(''), null)
})

test('split remaining time', () => {
	assert.deepEqual(splitRemain('9:58'), { remain_sign: '', remain_hours: '0', remain_minutes: '09', remain_seconds: '58', remain_total: 598, remain_major: '09', remain_minor: '58' })
	assert.deepEqual(splitRemain('1:02:03'), { remain_sign: '', remain_hours: '1', remain_minutes: '02', remain_seconds: '03', remain_total: 3723, remain_major: '1h', remain_minor: '02m' })
	assert.deepEqual(splitRemain('+0:12'), { remain_sign: '+', remain_hours: '0', remain_minutes: '00', remain_seconds: '12', remain_total: -12, remain_major: '+00', remain_minor: '12' })
	assert.equal(splitRemain('').remain_total, '')
})

test('links', () => {
	const l = parseLink('https://timer.example.com/beta/remote.html#r=ABCD1234&c=keykeykey')
	assert.deepEqual(l, { server: 'wss://timer.example.com/ws', room: 'ABCD1234', key: 'keykeykey', kind: 'companion' })
	assert.equal(parseLink('https://timer.sophtwhere.com/beta/remote.html#r=A&c=B')?.server, 'wss://timer.sophtwhere.com:8443/')
	assert.equal(socketUrl('wss://beta.timed-show.com/ws', 'ABCD1234'), 'wss://beta.timed-show.com/ws?room=ABCD1234')
	assert.equal(socketUrl('wss://timer.sophtwhere.com:8443/', 'X1'), 'wss://timer.sophtwhere.com:8443/?room=X1')
	assert.equal(parseLink('#r=X&a=Y&s=wss%3A%2F%2Flocalhost%3A8443%2F')?.server, 'wss://localhost:8443/')
	assert.equal(parseLink('#r=X&v=Y&s=wss://h/')?.kind, 'view')
	assert.equal(parseLink('r=X&k=Y'), null) // no server to be found
	assert.equal(parseLink('nonsense'), null)
})

test('presets only use defined actions, feedbacks and options', () => {
	const stub: Record<string, unknown> = { link: null, log() {} }
	stub.setActionDefinitions = (d: unknown) => (stub.a = d)
	stub.setFeedbackDefinitions = (d: unknown) => (stub.f = d)
	stub.setPresetDefinitions = (s: unknown, p: unknown) => (stub.p = { s, p })
	stub.setVariableDefinitions = (d: unknown) => (stub.v = d)
	const self = stub as unknown as ModuleInstance
	UpdateActions(self)
	UpdateFeedbacks(self)
	UpdatePresets(self)
	UpdateVariableDefinitions(self, ['extra_one'])
	const a = stub.a as Record<string, { options: { id: string }[] }>
	const f = stub.f as Record<string, { options: { id: string }[] }>
	const { s, p } = stub.p as { s: { definitions: { presets: string[] }[] }[]; p: Record<string, { steps: { down: { actionId: string; options: object }[] }[]; feedbacks: { feedbackId: string; options: object; style?: { bgcolor?: number } }[] }> }
	for (const id of FEEDBACK_IDS) assert.ok(f[id], `feedback ${id}`)
	for (const [id, preset] of Object.entries(p)) {
		for (const act of preset.steps[0].down) {
			assert.ok(a[act.actionId], `${id}: action ${act.actionId}`)
			for (const k of Object.keys(act.options)) assert.ok(a[act.actionId].options.some((o) => o.id === k), `${id}: option ${k}`)
		}
		for (const fb of preset.feedbacks) {
			assert.ok(f[fb.feedbackId], `${id}: feedback ${fb.feedbackId}`)
			// a preset feedback without a style never changes the button
			assert.ok(fb.style && typeof fb.style.bgcolor === 'number', `${id}: ${fb.feedbackId} has no style`)
			for (const k of Object.keys(fb.options)) assert.ok(f[fb.feedbackId].options.some((o) => o.id === k), `${id}: option ${k}`)
		}
	}
	const listed = s.flatMap((sec) => sec.definitions.flatMap((d) => d.presets))
	assert.deepEqual(listed.sort(), Object.keys(p).sort())
	assert.ok((stub.v as Record<string, unknown>).extra_one)
})
