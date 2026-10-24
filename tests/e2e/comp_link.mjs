// Drives TimerLink (dist/link.js) against a local timer page. argv: link, [pin]
import { TimerLink, parseLink } from '../../companion/companion-module-sophtwhere-presentationtimer/dist/link.js'
const [, , text, mode] = process.argv
const p = parseLink(text)
console.log('parsed:', JSON.stringify(p))
const link = new TimerLink({ server: p.server, room: p.room, key: p.key, rejectUnauthorized: false, origin: 'https://timer.sophtwhere.com' })
const out = (...a) => console.log(JSON.stringify(a))
link.on('status', (s, d) => out('status', s, d))
link.on('pin', (c) => out('pin', c))
link.on('token', (t) => out('token', t.length))
link.on('role', (r) => out('role', r))
let full = null, varsSeen = 0
link.on('vars', (v, f) => { varsSeen++; if (f) full = Object.keys(v).sort() })
link.start()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
	for (let i = 0; i < 100 && !full; i++) await wait(100)
	out('full-vars', full)
	if (mode === 'pin') { await wait(8000); out('after-pin status', link.status, 'vars', link.vars.remain); process.exit(0) }
	try { out('snapshot', typeof (await link.api({ cmd: 'snapshot' }))) } catch (e) { out('snapshot err', e.message) }
	await link.api({ cmd: 'default', msecs: 300000 })
	await link.api({ cmd: 'start', msecs: 300000 })
	await link.api({ cmd: 'custommessage', text: 'From Companion' })
	await wait(1200)
	out('remain', link.vars.remain, 'msg', link.vars.custommsg, 'default', link.vars.default, 'varsSeen', varsSeen)
	try { await link.api({ cmd: 'redirect', url: 'https://example.com' }); out('redirect ALLOWED?!') } catch (e) { out('redirect refused', e.message) }
	try { await link.api({ cmd: 'nonsense' }); out('nonsense ok') } catch (e) { out('nonsense err', e.message) }
	await link.api({ cmd: 'pause' }); await wait(300)
	out('pausing', link.vars.pausing)
	process.exit(0)
}
main()
