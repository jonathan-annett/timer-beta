// Stand-in for Pptx-WsController.ps1: same pairing-server protocol. argv: link, pairId, name
import WebSocket from '../../node_modules/ws/wrapper.mjs'
const [, , link, pair, name = 'Stage'] = process.argv
const frag = new URLSearchParams(link.slice(link.indexOf('#') + 1))
const room = frag.get('r'), key = frag.get('p'), server = frag.get('s') || 'wss://localhost:8443/'
const log = (...a) => console.log(JSON.stringify(a))
const show = new Set()
let current = '', showing = false
const ws = new WebSocket(server, { rejectUnauthorized: false })   // no Origin header, like PowerShell
const up = d => ws.send(JSON.stringify({ type: 'up', msg: { k: 'data', d } }))
const HELLO_PAIR = process.env.HELLO_PAIR ?? pair, CHECK_PAIR = process.env.CHECK_PAIR ?? pair, INBOX = process.env.INBOX || 'C:\\Users\\jo\\OneDrive\\Documents\\Presentation Timer\\Inbox'
const hello = () => up({ t: 'hello', kind: 'player', name, version: 'fake', pair: HELLO_PAIR, inbox: INBOX, current, showing, slide: 0, slides: 0 })
ws.on('open', () => ws.send(JSON.stringify({ type: 'join', room, key })))
ws.on('message', raw => {
  const m = JSON.parse(raw)
  if (m.type === 'joined') { log('joined', m.role, m.hostOnline); if (m.hostOnline) hello() }
  else if (m.type === 'host-online') hello()
  else if (m.type === 'error') log('error', m.reason)
  else if (m.type === 'down' && m.msg && m.msg.k === 'data') {
    const d = m.msg.d
    if (d.t === 'pin-required') { log('pin-required'); up({ t: 'pin', code: '1234' }) }
    else if (d.t === 'pin-ok') { log('pin-ok'); hello() }
    else if (d.t === 'pp') {
      log('cmd', d.verb, d.arg, d.keep)
      const ack = x => up(Object.assign({ t: 'pp-ack', req: d.req, verb: d.verb, ok: true }, x))
      if (d.verb === 'check') ack({ result: CHECK_PAIR })
      else if (d.verb === 'send') setTimeout(() => { show.add(d.arg); ack({ result: d.arg }) }, 300)   // a copy takes a moment
      else if (d.verb === 'start') {
        if (!show.has(d.arg)) return up({ t: 'pp-ack', req: d.req, verb: 'start', ok: false, error: 'not found: ' + d.arg })
        current = d.arg; showing = true; ack({ result: d.arg })
        up({ t: 'pp-state', current, showing, slide: 1, slides: 12 })
      } else if (d.verb === 'stop') { current = ''; showing = false; ack({}); up({ t: 'pp-state', current, showing, slide: 0, slides: 0 }) }
      else ack({})
    }
  }
})
ws.on('close', () => log('closed'))
ws.on('error', e => log('wserror', e.message))
setTimeout(() => process.exit(0), Number(process.env.LIFE || 120000))
