/*
 * Timed Show for Even Realities G2. The phone page (index.html, shown in the Even app) pairs with a
 * timer by its 6-digit code and shows the proximity-check number; the glasses show the timer.
 *
 * Roles (the timer's operator picks one when letting the glasses in, and can change it later; the
 * glasses only say which they'd like):
 *   presenter  the countdown, small and dim, in the corner chosen here or with Next corner in the
 *              glasses' menu; a tap (or a few) hides or shows it. Holds only the view-only link.
 *   operator   the operator's screen in miniature, a fixed layout: elapsed / total along the top, the
 *              message and the countdown in the middle, started / ends at along the bottom. Three or
 *              more quick taps fire Next on the run sheet. The timer sends the control link for this
 *              ({t:'role', frag}); a pair made presenter again goes back to the view-only link.
 * People close the app with Even's menu (tap, then tap and hold) → close.
 *
 * Kept by the Even app (bridge.setLocalStorage / getLocalStorage). Not the page's own localStorage:
 * the Even app serves the plugin from http://127.0.0.1:<port> with a new port each launch, and browser
 * storage belongs to the origin, port included, so it started empty every time. localStorage is still
 * written, for a plain browser (development, tests), and read when the bridge has nothing.
 *   ts_link    {server, room, key, view}: the paired timer (the view-only link the code gave)
 *   ts_ctl     the control link, while the timer has made these glasses its operator's
 *   ts_token   the proximity check's token for that room
 *   ts_role    presenter | operator: as the timer last said
 *   ts_wants   presenter | operator: the role asked for when pairing
 *   ts_corner  tl | tr | bl | br
 */
import { waitForEvenAppBridge, OsEventTypeList, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { claim, CLAIM_ERRORS, TimerLink, type Paired, type Status, type Mode } from './link'
import { Clock, secToStr, type ClockValues } from './clock'
import { Glasses, CORNERS, MENU, type Corner, type Layout } from './glasses'
import { scan, readCode, codeFromPhoto } from './scan'

declare const __APP_VERSION__: string
const $ = (id: string) => document.getElementById(id) as HTMLElement

// ─── Saved settings ──────────────────────────────────────────────────────────

const KEYS = ['ts_link', 'ts_ctl', 'ts_token', 'ts_role', 'ts_wants', 'ts_corner']
const cache: Record<string, string> = {}
let storeBridge: EvenAppBridge | null = null
const store = {
  get(k: string): string { return cache[k] || '' },
  set(k: string, v: string): void {
    cache[k] = v
    try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k) } catch { /* no storage */ }
    storeBridge?.setLocalStorage(k, v).catch(() => { /* kept for this session at least */ })
  },
}
// Reads the saved settings once at start (the bridge's storage is asynchronous)
async function loadStore(bridge: EvenAppBridge | null): Promise<void> {
  storeBridge = bridge
  for (const k of KEYS) {
    let v = ''
    if (bridge) { try { v = (await bridge.getLocalStorage(k)) || '' } catch { /* none */ } }
    if (!v) { try { v = localStorage.getItem(k) || '' } catch { /* none */ } }
    cache[k] = v
  }
}
function savedLink(k: string): Paired | null {
  try { const p = JSON.parse(store.get(k)); return p && p.room && p.key && p.server ? p : null } catch { return null }
}

let paired: Paired | null = null      // the view-only link; set by boot() once the saved settings are read
let control: Paired | null = null     // the control link, while the timer has made us its operator's
let link: TimerLink | null = null
let usingControl = false
let status: Status | 'unpaired' = 'unpaired'
let role: Mode = 'presenter'
let wants: Mode = 'presenter'
let pin = ''
const clock = new Clock()
const state: Record<string, unknown> = {}
let glasses: Glasses | null = null
let corner: Corner = 'tl'
let hidden = false                    // a presenter's tap hides the countdown
let flash = '', flashUntil = 0        // a moment of feedback on the glasses ("Next...")

// ─── The glasses ─────────────────────────────────────────────────────────────

// #demo[=tl|tr|bl|br|operator,…] (the simulator, for checking layouts): a made-up countdown, as if paired
const DEMO = location.hash.startsWith('#demo')
const demoStart = Date.now()
const demoValues = (): ClockValues => {
  const sec = 75 - Math.floor((Date.now() - demoStart) / 1000)
  return { remain: secToStr(Math.abs(sec)), over: sec < 0, impending: sec >= 0 && sec <= 60, paused: false, standby: false, elapsed: secToStr(Math.max(0, 600 - sec)), total: '10:00' }
}

function cornerPlace(): { h: 'l' | 'r'; v: 't' | 'b' } { return { h: corner[1] === 'l' ? 'l' : 'r', v: corner[0] === 't' ? 't' : 'b' } }

// What the glasses show now. Status lines are words only, so nothing can be mistaken for the countdown.
// Each role always declares the same boxes (empty when there's nothing to show), so a new message, a
// hidden countdown or "Next..." changes only text; the page is rebuilt only when the role or corner
// changes or the glasses connect or disconnect (see glasses.ts: rebuilds in a hurry rebooted them).
function glassesView(): Layout {
  const p = cornerPlace()
  const info = (text: string, bright = 2) => ({ text, bright, ...p, lines: 2, width: 300, bottom: p.v === 'b' })
  if (!DEMO) {
    if (status === 'unpaired' || status === 'refused') return { info: info('Timer not connected - open the Even app to pair') }
    if (status === 'pin') return { info: info('Pairing - finish on your phone') }
    if (status !== 'online') return { info: info('Timer offline - reconnecting...') }
  }
  const v = DEMO ? demoValues() : clock.values()
  const clk = v ? (v.over ? '+' : '') + v.remain + (v.paused ? ' paused' : '') : ''
  const bright = !v ? 0 : v.over ? 4 : v.impending ? 3 : v.paused ? 1 : 2
  const showFlash = flash && Date.now() < flashUntil ? flash : ''
  if (role === 'operator' || (DEMO && location.hash.includes('operator'))) {
    // The operator's screen: elapsed / total, the message, the countdown, started / ends at
    const msg = showFlash || String(state.msg || (DEMO ? 'Keynote: the future of timing' : ''))
    const started = String(state.started || (DEMO ? '17:23:18' : '')), ends = String(state.ends || (DEMO ? '17:33:18' : ''))
    return {
      elapsed: { text: v ? 'elapsed ' + v.elapsed : '', bright: 2, h: 'l', v: 't' },
      total: { text: v ? v.total + ' total' : '', bright: 2, h: 'r', v: 't' },
      msg: { text: msg, bright: 4, h: 'c', v: 84, lines: 2, bottom: true },
      clk: { text: clk, bright, h: 'c', v: 146 },
      started: { text: started ? 'started ' + started : '', bright: 2, h: 'l', v: 'b' },
      ends: { text: ends ? 'ends at ' + ends : '', bright: 2, h: 'r', v: 'b' },
    }
  }
  return {
    clk: { text: hidden || showFlash ? '' : clk, bright, ...p },
    info: info(showFlash),
  }
}

// ─── Taps ────────────────────────────────────────────────────────────────────
// Taps are gathered until none comes for 600 ms. A presenter's gathering (one tap or several) hides
// or shows the countdown; an operator's three or more fire Next, and anything less does nothing.
let taps = 0, tapTimer = 0
function onTap(n: number): void {
  taps += n
  clearTimeout(tapTimer)
  tapTimer = window.setTimeout(() => {
    const count = taps
    taps = 0
    if (status !== 'online') return
    if (role === 'operator') {
      if (count < 3) return
      link?.next()
      showFlash('Next...')
    } else {
      hidden = !hidden
      if (hidden) showFlash('Countdown hidden - tap to show')
    }
    render()
  }, 600)
}
function showFlash(text: string): void { flash = text; flashUntil = Date.now() + 1500 }

// ─── The phone page ──────────────────────────────────────────────────────────

function statusText(): string {
  if (status === 'online') return role === 'operator' ? 'Connected as the operator’s glasses: the message and times are on your glasses, and three quick taps fire Next.'
    : 'Connected. The countdown is on your glasses' + (hidden ? ' (hidden: tap to show).' : '.')
  return ({
    connecting: 'Connecting to the timer…',
    waiting: 'The timer isn’t open. These glasses will connect when it is.',
    offline: 'The timer is closed. These glasses will connect when it reopens.',
  } as Record<string, string>)[status] || ''
}

function render(): void {
  const isPaired = !!paired && status !== 'refused'
  $('pair').hidden = isPaired
  $('paired').hidden = !isPaired
  $('pinbox').hidden = status !== 'pin'
  $('pinnum').textContent = pin
  $('status').textContent = statusText()
  $('status').className = status === 'online' ? 'ok' : ''
  $('rolename').textContent = role === 'operator' ? 'Operator' : 'Presenter'
  $('cornerbox').hidden = role === 'operator'
  document.querySelectorAll<HTMLButtonElement>('#corners button').forEach(b => b.classList.toggle('on', b.dataset.c === corner))
  document.querySelectorAll<HTMLInputElement>('input[name=wants]').forEach(i => { i.checked = i.value === wants })
  const view = glassesView()
  glasses?.show(view)
  mirror(view)
}

// The same on the phone page: what the glasses show, at their proportions (green on black), so the
// phone can stand in for them and shows where the countdown sits. Brightness 0–4 as opacity.
let mirrorSig = ''
function mirror(view: Layout): void {
  const box = $('mirror')
  box.hidden = !paired || status === 'refused'
  const sig = JSON.stringify(view)
  if (sig === mirrorSig) return
  mirrorSig = sig
  box.replaceChildren(...Object.entries(view).filter(([, b]) => b && b.text).map(([name, b]) => {
    const el = document.createElement('div')
    el.className = 'm-' + name
    el.textContent = b!.text
    el.style.opacity = String([0.25, 0.45, 0.65, 0.85, 1][Math.max(0, Math.min(4, b!.bright))])
    const st = el.style
    if (b!.h === 'l') st.left = '2%'; else if (b!.h === 'r') st.right = '2%'; else { st.left = '0'; st.right = '0'; st.textAlign = 'center' }
    if (b!.v === 't') st.top = '4%'; else if (b!.v === 'b') st.bottom = '4%'; else st.top = (Number(b!.v) / 288 * 100) + '%'
    if (b!.width) st.maxWidth = (b!.width / 576 * 100) + '%'
    return el
  }))
}

function say(text: string, kind = ''): void { $('msg').textContent = text; $('msg').className = kind }

// Joins the timer's room with the control link while we're its operator's, else the view-only one
function connect(): void {
  const p = role === 'operator' && control ? control : paired
  if (!p) return
  link?.close()
  clock.clear()
  for (const k of Object.keys(state)) delete state[k]
  usingControl = p === control
  link = new TimerLink(p, store.get('ts_token'), wants, {
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
    role: (r, ctl) => {
      // The timer's word on our role; change links when it means holding (or dropping) the control key
      const was = role
      role = r
      store.set('ts_role', r)
      if (r === 'operator' && ctl) { control = ctl; store.set('ts_ctl', JSON.stringify(ctl)) }
      if (r === 'presenter' && control) { control = null; store.set('ts_ctl', '') }
      if (was !== r) hidden = false
      if ((r === 'operator' && control && !usingControl) || (r === 'presenter' && usingControl)) { setTimeout(connect, 0); return }
      render()
    },
  })
  link.start()
}

function unpair(why = ''): void {
  link?.close(); link = null
  paired = null; control = null; pin = ''; role = 'presenter'
  for (const k of ['ts_link', 'ts_ctl', 'ts_token', 'ts_role']) store.set(k, '')
  status = 'unpaired'
  clock.clear()
  say(why, why ? 'bad' : '')
  render()
}

// Paired by the code or the QR code: start from the view-only link (the timer gives control, if at all)
function pairedWith(p: Paired): void {
  paired = p; control = null; role = 'presenter'
  store.set('ts_link', JSON.stringify(p)); store.set('ts_ctl', ''); store.set('ts_token', ''); store.set('ts_role', '')
  connect()
  render()
}

// The QR code (the share panel's Countdown one), read with the phone's camera
function scanned(text: string): void {
  const r = readCode(text)
  if (r.ok) pairedWith(r.paired); else say(r.why, 'bad')
}
let scanning: { stop: () => void } | null = null
function stopScan(): void { scanning?.stop(); scanning = null; $('scanbox').hidden = true }
let appBridge: EvenAppBridge | null = null
async function startScan(): Promise<void> {
  if (scanning) return
  say('')
  if (appBridge) {
    // In the Even app: its own camera takes a photo of the code
    try {
      const photo = await appBridge.captureImageFromCamera()
      if (!photo || !photo.base64) { say('No photo taken.'); return }
      say('Reading the code…')
      const text = await codeFromPhoto(photo.base64, photo.mimeType || 'image/jpeg')
      if (text) { say(''); scanned(text) } else say('No QR code found in that photo. Try again, closer and square on, or type the 6-digit code.', 'bad')
    } catch {
      say('The camera isn’t available. Type the 6-digit code instead.', 'bad')
    }
    return
  }
  $('scanbox').hidden = false
  const s = scan($('video') as HTMLVideoElement)
  scanning = s
  s.result.then(text => { stopScan(); scanned(text) }, err => {
    stopScan()
    const name = (err && (err as Error).name) || ''
    say(name === 'NotAllowedError' ? 'The camera wasn’t allowed. Type the 6-digit code instead.' : 'The camera isn’t available here. Type the 6-digit code instead.', 'bad')
  })
}

function onCode(): void {
  const input = $('code') as HTMLInputElement
  const code = input.value.replace(/\D/g, '').slice(0, 6)
  input.value = code
  if (code.length < 6) { say(''); return }
  input.disabled = true
  say('Checking the code…')
  claim(code, wants, {
    wait: () => say('Waiting for the timer…'),
    done: p => {
      input.disabled = false; input.value = ''
      say('')
      pairedWith(p)
    },
    fail: reason => {
      input.disabled = false; input.value = ''
      say(CLAIM_ERRORS[reason] || 'Pairing failed (' + reason + ').', 'bad')
      input.focus()
    },
  })
}

// The corner (a presenter's): from the phone page, or Next corner in the glasses' menu
function setCorner(c: Corner): void { corner = c; store.set('ts_corner', c); render() }

function setup(): void {
  $('code').addEventListener('input', onCode)
  $('scan').addEventListener('click', startScan)
  $('scanstop').addEventListener('click', stopScan)
  document.querySelectorAll<HTMLButtonElement>('#corners button').forEach(b => b.addEventListener('click', () => setCorner(b.dataset.c as Corner)))
  document.querySelectorAll<HTMLInputElement>('input[name=wants]').forEach(i => i.addEventListener('change', () => { wants = i.value === 'operator' ? 'operator' : 'presenter'; store.set('ts_wants', wants) }))
  let armed = 0
  $('unpair').addEventListener('click', () => {
    // Two taps within 3 s, like the phone remote's Unpair
    if (Date.now() - armed > 3000) { armed = Date.now(); $('unpair').textContent = 'Tap again to unpair'; setTimeout(() => { $('unpair').textContent = 'Unpair'; }, 3000); return }
    armed = 0; $('unpair').textContent = 'Unpair'
    unpair('Unpaired. Type a new code to pair again.')
  })
  $('origin').textContent = 'version ' + __APP_VERSION__ + ' · origin ' + (location.origin || location.protocol)
  render()
  if (paired) connect()
  // The countdown ticks here; the glasses get a change only when some text or brightness changes
  setInterval(() => { const v = glassesView(); glasses?.show(v); mirror(v) }, 250)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) link?.wake() })
}

// ─── The Even app ────────────────────────────────────────────────────────────

function attach(bridge: EvenAppBridge): void {
  appBridge = bridge
  glasses = new Glasses(bridge)
  glasses.onSetup = problem => { if (problem) { $('nobridge').textContent = problem; $('nobridge').hidden = false } }
  glasses.show(glassesView(), true)
  bridge.onEvenHubEvent(ev => {
    if (ev.menuItemClickEvent) {
      if (Number(ev.menuItemClickEvent.itemID) === MENU.corner && role !== 'operator') setCorner(CORNERS[(CORNERS.indexOf(corner) + 1) % CORNERS.length])
      return
    }
    // A plain tap comes with no eventType (the SDK drops 0); a double tap is 3 (counted as two taps)
    const sys = ev.sysEvent as { eventType?: number; eventSource?: number } | undefined
    const txt = ev.textEvent as { eventType?: number } | undefined
    const type = sys ? sys.eventType : txt ? txt.eventType : null
    if (type === OsEventTypeList.FOREGROUND_ENTER_EVENT) { link?.wake(); glasses?.show(glassesView(), true); return }
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) onTap(2)
    else if ((type === undefined || type === OsEventTypeList.CLICK_EVENT) && (txt || sys?.eventSource !== undefined)) onTap(1)
  })
}

async function boot(): Promise<void> {
  // Opened in a plain browser (development, tests), the bridge never comes: the phone page still works
  const bridge = await Promise.race([waitForEvenAppBridge(), new Promise<null>(r => setTimeout(() => r(null), 4000))]) as EvenAppBridge | null
  await loadStore(bridge)
  paired = savedLink('ts_link')
  control = savedLink('ts_ctl')
  role = store.get('ts_role') === 'operator' ? 'operator' : 'presenter'
  wants = store.get('ts_wants') === 'operator' ? 'operator' : 'presenter'
  status = paired ? 'connecting' : 'unpaired'
  if ((CORNERS as string[]).includes(store.get('ts_corner'))) corner = store.get('ts_corner') as Corner
  for (const p of location.hash.startsWith('#demo=') ? location.hash.slice(6).split(',') : []) if ((CORNERS as string[]).includes(p)) corner = p as Corner
  setup()
  if (bridge) attach(bridge); else $('nobridge').hidden = false
}
boot()
// For tests: what the glasses would show (box name -> text, the countdown with @brightness), and taps
const w = window as unknown as { __g2view: () => Record<string, string>; __g2tap: (n: number) => void }
w.__g2view = () => Object.fromEntries(Object.entries(glassesView()).filter(([, b]) => b && b.text).map(([k, b]) => [k, b!.text + (k === 'clk' ? ' @' + b!.bright : '')]))
w.__g2tap = onTap
;(window as unknown as { __g2scanned: (t: string) => void }).__g2scanned = scanned   // a QR code's text, as the camera would read it
;(window as unknown as { __g2photo: (b: string) => Promise<string> }).__g2photo = b => codeFromPhoto(b)   // a photo's QR code
