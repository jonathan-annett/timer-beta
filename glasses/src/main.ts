/*
 * Timed Show for Even Realities G2. The phone page (index.html, shown in the Even app) pairs with a
 * timer by its 6-digit code and shows the proximity-check number; the glasses show only the countdown
 * (or a short status line in words), small and dim in the corner chosen on the phone.
 *
 * First version: the countdown only. The mode (presenter / controller) is sent to the timer but not
 * used yet, and taps do nothing (they're kept for the presenter's and controller's cues; people close
 * the app with Even's menu (tap, then tap and hold) → close).
 *
 * Kept on the phone (localStorage, which the Even app keeps until the app is removed):
 *   ts_link    {server, room, key, view}: the paired timer
 *   ts_token   the proximity check's token for that room
 *   ts_corner  tl | tr | bl | br
 */
import { waitForEvenAppBridge, OsEventTypeList, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { claim, CLAIM_ERRORS, TimerLink, type Paired, type Status, type Mode } from './link'
import { Clock, secToStr } from './clock'
import { Glasses, CORNERS, MENU, type Corner, type View } from './glasses'

declare const __APP_VERSION__: string
const MODE: Mode = 'presenter'
const $ = (id: string) => document.getElementById(id) as HTMLElement

const store = {
  get(k: string): string { try { return localStorage.getItem(k) || '' } catch { return '' } },
  set(k: string, v: string): void { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k) } catch { /* no storage */ } },
}
function savedLink(): Paired | null {
  try { const p = JSON.parse(store.get('ts_link')); return p && p.room && p.key && p.server ? p : null } catch { return null }
}

let paired = savedLink()
let link: TimerLink | null = null
let status: Status | 'unpaired' = paired ? 'connecting' : 'unpaired'
let pin = ''
const clock = new Clock()
const state: Record<string, unknown> = {}
let glasses: Glasses | null = null
let corner = (CORNERS as string[]).includes(store.get('ts_corner')) ? store.get('ts_corner') as Corner : 'tl'
if (location.hash.startsWith('#demo=') && (CORNERS as string[]).includes(location.hash.slice(6))) corner = location.hash.slice(6) as Corner   // #demo=br

// ─── The glasses ─────────────────────────────────────────────────────────────

// Words only, so nothing here can be mistaken for the countdown
// #demo (the simulator, for checking the layout): a made-up countdown, as if paired and running
const DEMO = location.hash.startsWith('#demo')
const demoStart = Date.now()

function glassesView(): View {
  if (DEMO) {
    const sec = 75 - Math.floor((Date.now() - demoStart) / 1000)
    return { clock: sec < 0 ? '+' + secToStr(-sec) : secToStr(sec), bright: sec < 0 ? 4 : sec <= 60 ? 3 : 2, info: '' }
  }
  if (status === 'unpaired' || status === 'refused') return { clock: '', bright: 0, info: 'Timer not connected - open the Even app to pair' }
  if (status === 'pin') return { clock: '', bright: 0, info: 'Pairing - finish on your phone' }
  if (status !== 'online') return { clock: '', bright: 0, info: 'Timer offline - reconnecting...' }
  const v = clock.values()
  if (!v) return { clock: '', bright: 0, info: '' }
  const text = (v.over ? '+' : '') + v.remain + (v.paused ? ' paused' : '')
  return { clock: text, bright: v.over ? 4 : v.impending ? 3 : v.paused ? 1 : 2, info: '' }
}

// ─── The phone page ──────────────────────────────────────────────────────────

const STATUS_TEXT: Record<string, string> = {
  connecting: 'Connecting to the timer…',
  waiting: 'The timer isn’t open. These glasses will connect when it is.',
  offline: 'The timer is closed. These glasses will connect when it reopens.',
  online: 'Connected. The countdown is on your glasses.',
}

function render(): void {
  const isPaired = !!paired && status !== 'refused'
  $('pair').hidden = isPaired
  $('paired').hidden = !isPaired
  $('pinbox').hidden = status !== 'pin'
  $('pinnum').textContent = pin
  $('status').textContent = STATUS_TEXT[status] || ''
  $('status').className = status === 'online' ? 'ok' : ''
  document.querySelectorAll<HTMLButtonElement>('#corners button').forEach(b => b.classList.toggle('on', b.dataset.c === corner))
  glasses?.show(glassesView())
}

function say(text: string, kind = ''): void { $('msg').textContent = text; $('msg').className = kind }

function connect(p: Paired): void {
  link?.close()
  clock.clear()
  for (const k of Object.keys(state)) delete state[k]
  link = new TimerLink(p, store.get('ts_token'), MODE, {
    status: (s, detail) => {
      status = s
      if (s === 'refused') {
        // Wrong number or access taken away: forget this timer, pair again
        unpair(detail === 'revoked' ? 'The timer took these glasses’ access away. Pair again with a new code.' : 'The timer didn’t accept the number. Pair again with a new code.')
        return
      }
      if (s !== 'online') clock.clear()
      render()
    },
    state: (s, full) => {
      if (full) for (const k of Object.keys(state)) delete state[k]
      Object.assign(state, s)
      if (s.clk) clock.set(s.clk)
      render()
    },
    pin: code => { pin = code; render() },
    token: t => store.set('ts_token', t),
  })
  link.start()
}

function unpair(why = ''): void {
  link?.close(); link = null
  paired = null; pin = ''
  store.set('ts_link', ''); store.set('ts_token', '')
  status = 'unpaired'
  clock.clear()
  say(why, why ? 'bad' : '')
  render()
}

function onCode(): void {
  const input = $('code') as HTMLInputElement
  const code = input.value.replace(/\D/g, '').slice(0, 6)
  input.value = code
  if (code.length < 6) { say(''); return }
  input.disabled = true
  say('Checking the code…')
  claim(code, MODE, {
    wait: () => say('Waiting for the timer…'),
    done: p => {
      input.disabled = false; input.value = ''
      say('')
      paired = p
      store.set('ts_link', JSON.stringify(p)); store.set('ts_token', '')
      connect(p)
      render()
    },
    fail: reason => {
      input.disabled = false; input.value = ''
      say(CLAIM_ERRORS[reason] || 'Pairing failed (' + reason + ').', 'bad')
      input.focus()
    },
  })
}

// The corner: from the phone page, or Next corner in the glasses' menu
function setCorner(c: Corner): void { corner = c; store.set('ts_corner', c); glasses?.setCorner(c); render() }

function setup(): void {
  $('code').addEventListener('input', onCode)
  document.querySelectorAll<HTMLButtonElement>('#corners button').forEach(b => b.addEventListener('click', () => setCorner(b.dataset.c as Corner)))
  let armed = 0
  $('unpair').addEventListener('click', () => {
    // Two taps within 3 s, like the phone remote's Unpair
    if (Date.now() - armed > 3000) { armed = Date.now(); $('unpair').textContent = 'Tap again to unpair'; setTimeout(() => { $('unpair').textContent = 'Unpair'; }, 3000); return }
    armed = 0; $('unpair').textContent = 'Unpair'
    unpair('Unpaired. Type a new code to pair again.')
  })
  $('origin').textContent = 'version ' + __APP_VERSION__ + ' · origin ' + (location.origin || location.protocol)
  render()
  if (paired) connect(paired)
  // The countdown ticks here; the glasses get a change only when the text or brightness changes
  setInterval(() => glasses?.show(glassesView()), 250)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) link?.wake() })
}

// ─── The Even app ────────────────────────────────────────────────────────────

async function attach(): Promise<void> {
  // Opened in a plain browser (development), the bridge never comes: the phone page still works
  const bridge = await Promise.race([waitForEvenAppBridge(), new Promise<null>(r => setTimeout(() => r(null), 4000))]) as EvenAppBridge | null
  if (!bridge) { $('nobridge').hidden = false; return }
  glasses = new Glasses(bridge, corner)
  glasses.onSetup = problem => { if (problem) { $('nobridge').textContent = problem; $('nobridge').hidden = false } }
  glasses.show(glassesView(), true)
  bridge.onEvenHubEvent(ev => {
    if (ev.menuItemClickEvent) { if (Number(ev.menuItemClickEvent.itemID) === MENU.corner) setCorner(CORNERS[(CORNERS.indexOf(corner) + 1) % CORNERS.length]); return }
    const kind = (e: { eventType?: number } | undefined) => (e ? (e.eventType ?? OsEventTypeList.CLICK_EVENT) : null)
    const s = kind(ev.sysEvent as { eventType?: number } | undefined), t = kind(ev.textEvent as { eventType?: number } | undefined)
    void t   // taps: not used yet (presenter: a tap toggles the display; controller: 3+ taps = Next)
    if (s === OsEventTypeList.FOREGROUND_ENTER_EVENT) { link?.wake(); glasses?.show(glassesView(), true) }
  })
}

setup()
attach()
;(window as unknown as { __g2view: () => View }).__g2view = glassesView   // for tests: what the glasses would show
