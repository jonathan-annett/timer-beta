import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDuration, UpdateActions } from '../actions.js'
import { remainSeconds, UpdateFeedbacks, FEEDBACK_IDS } from '../feedbacks.js'
import { UpdatePresets } from '../presets.js'
import { UpdateVariableDefinitions } from '../variables.js'
import { parseLink } from '../link.js'
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

test('links', () => {
	const l = parseLink('https://timer.example.com/beta/remote.html#r=ABCD1234&c=keykeykey')
	assert.deepEqual(l, { server: 'wss://timer.example.com:8443/', room: 'ABCD1234', key: 'keykeykey', kind: 'companion' })
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
	const { s, p } = stub.p as { s: { definitions: { presets: string[] }[] }[]; p: Record<string, { steps: { down: { actionId: string; options: object }[] }[]; feedbacks: { feedbackId: string; options: object }[] }> }
	for (const id of FEEDBACK_IDS) assert.ok(f[id], `feedback ${id}`)
	for (const [id, preset] of Object.entries(p)) {
		for (const act of preset.steps[0].down) {
			assert.ok(a[act.actionId], `${id}: action ${act.actionId}`)
			for (const k of Object.keys(act.options)) assert.ok(a[act.actionId].options.some((o) => o.id === k), `${id}: option ${k}`)
		}
		for (const fb of preset.feedbacks) {
			assert.ok(f[fb.feedbackId], `${id}: feedback ${fb.feedbackId}`)
			for (const k of Object.keys(fb.options)) assert.ok(f[fb.feedbackId].options.some((o) => o.id === k), `${id}: option ${k}`)
		}
	}
	const listed = s.flatMap((sec) => sec.definitions.flatMap((d) => d.presets))
	assert.deepEqual(listed.sort(), Object.keys(p).sort())
	assert.ok((stub.v as Record<string, unknown>).extra_one)
})
