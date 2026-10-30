/*
 * What the glasses show, as up to seven named text boxes over a blank one that catches the taps (the
 * glasses take 8 text boxes at most; all 8 are always declared, unused ones blank). Each box sits in a
 * fixed slot: left / right / centred, at the top, the bottom or a given height of the 576×288 canvas.
 * Never shows digits that aren't the timer's (the pairing number is on the phone only).
 *
 * A box's place depends only on where it goes, never on its text: text changes are in-place updates
 * (textContainerUpgrade), and the page is rebuilt only when the layout itself changes (the role, the
 * corner, connecting). Rebuilding for every new message or "Next..." rebooted the glasses (31 Oct
 * 2026). The glasses' text is always left aligned, so right and centred text is pushed over with
 * spaces (digits measured as the font's widest, so a ticking time stays put; pretext measures the
 * glasses' font). Only the latest layout is sent: one overtaken while a call was out is dropped.
 *
 * The glasses' menu (tap, then tap and hold: Even's own, with brightness and close) gets our items too
 * (setMenu: Next corner for a presenter; the show's controls for an operator).
 * Hardware rules from the owner's g2-claude-starter: no zOrderIndex (stacking is declaration order),
 * text boxes a whole number of lines high (30 / 56 / 84 px) or a scrollbar shows, the page and menu as
 * plain objects (as its Mischief Mews sends them; confirmed on the glasses), centring with spaces.
 */
import { type EvenAppBridge, type CreateStartUpPageContainer, type RebuildPageContainer, StartUpPageCreateResult, TextContainerUpgrade } from '@evenrealities/even_hub_sdk'
import { getTextWidth } from '@evenrealities/pretext'

export type Corner = 'tl' | 'tr' | 'bl' | 'br'
export const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br']
// The glasses' menu items, by role (menuFor in main.ts); the menu changes only with a page rebuild
export const MENU = { corner: 1, next: 2, back: 3, pause: 4, reset: 5, auto: 6, minimal: 7 }
export interface MenuItem { itemID: number; itemName: string }   // itemName ≤ 32 bytes
export const W = 576, H = 288, MARGIN = 12

// The boxes, by name (ids fixed; 1 is the tap catcher)
const NAMES = ['clk', 'info', 'msg', 'elapsed', 'total', 'started', 'ends'] as const
export type BoxName = typeof NAMES[number]
const ID: Record<string, number> = Object.fromEntries(NAMES.map((n, i) => [n, i + 2]))

export interface Box {
  text: string                   // '' for an empty box (it keeps its place)
  bright: number                 // 0–4
  h: 'l' | 'r' | 'c'             // left, right, centred
  v: 't' | 'b' | number          // top, bottom, or a y
  lines?: number                 // the box's height in lines (text wraps within it; more is cut, ending '...')
  bottom?: boolean               // fewer lines than the box: sit on its last line
  width?: number                 // px; default: the whole width when centred, else about half
}
export type Layout = Partial<Record<BoxName, Box>>

const lineH = (n: number) => (n <= 1 ? 30 : n * 28)   // a text box n lines high
const WIDEST = '0123456789'.split('').reduce((a, d) => (getTextWidth(d) > getTextWidth(a) ? d : a), '0')
const shape = (t: string) => t.replace(/\d/g, WIDEST)
const SPACE = getTextWidth(' ') || 5

interface Placed { x: number; y: number; w: number; h: number }
function place(b: Box): Placed {
  const w = b.width ?? (b.h === 'c' ? W - 2 * MARGIN : 272), h = lineH(b.lines || 1)
  const x = b.h === 'l' ? MARGIN : b.h === 'r' ? W - MARGIN - w : Math.round((W - w) / 2)
  const y = b.v === 't' ? MARGIN : b.v === 'b' ? H - MARGIN - h : b.v
  return { x, y, w, h }
}

function cut(text: string, inner: number): string {
  if (getTextWidth(text) <= inner) return text
  let t = text
  while (t.length > 1 && getTextWidth(t + '...') > inner) t = t.slice(0, -1)
  return t.trimEnd() + '...'   // the font has no '…'
}

// The text as it goes in its box: wrapped to the box's lines (the last one cut with '...'), each line
// pushed right or to the middle with spaces
function fill(b: Box, w: number): string {
  if (!b.text) return ' '
  const inner = w - 12, max = b.lines || 1
  const words = b.text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let line = ''
  for (let i = 0; i < words.length; i++) {
    const next = line ? line + ' ' + words[i] : words[i]
    if (getTextWidth(next) <= inner || !line) { line = next; continue }
    out.push(line)
    if (out.length === max) { out[max - 1] = cut(out[max - 1] + ' ' + words.slice(i).join(' '), inner); line = ''; break }
    line = words[i]
  }
  if (line) out.push(line)
  const lines = out.slice(0, max).map(l => cut(l, inner)).map(l => {
    const room = inner - getTextWidth(shape(l))
    const n = b.h === 'l' ? 0 : Math.floor((b.h === 'r' ? room : room / 2) / SPACE)
    return ' '.repeat(Math.max(0, n)) + l
  })
  while (b.bottom && lines.length < max) lines.unshift('')
  return lines.join('\n')
}

export class Glasses {
  private started = false
  private layoutKey = ''
  private shown: Record<string, { text: string; bright: number }> = {}
  private pending: { layout: Layout; force: boolean } | null = null
  private running = false
  private menu: MenuItem[] = [{ itemID: MENU.corner, itemName: 'Next corner' }]

  /** Told the outcome of the first page setup: '' when it worked */
  onSetup?: (problem: string) => void

  constructor(private bridge: EvenAppBridge) {}

  /** The menu's items (rebuilds the page when they change: only on a role change) */
  setMenu(items: MenuItem[]): void { this.menu = items }

  /** Shows the layout (one call to the glasses at a time, the latest layout only). force: rebuild the page */
  show(layout: Layout, force = false): void {
    this.pending = { layout: JSON.parse(JSON.stringify(layout)) as Layout, force: force || !!this.pending?.force }
    if (!this.running) this.run()
  }
  private async run(): Promise<void> {
    this.running = true
    while (this.pending) {
      const p = this.pending
      this.pending = null
      try { await this.apply(p.layout, p.force) } catch { /* the next change tries again */ }
    }
    this.running = false
  }

  private async apply(layout: Layout, force: boolean): Promise<void> {
    const placed: Record<string, Placed> = {}, text: Record<string, string> = {}
    for (const n of NAMES) { const b = layout[n]; if (b) { placed[n] = place(b); text[n] = fill(b, placed[n].w) } }
    const key = JSON.stringify([NAMES.map(n => (placed[n] ? [n, placed[n]] : 0)), this.menu])
    if (!this.started || key !== this.layoutKey || force) {
      const textObject = [
        // Takes the taps and swipes; blank (a capturing box's text would scroll)
        { xPosition: 0, yPosition: 0, width: W, height: H, containerID: 1, containerName: 'bg', content: ' ', isEventCapture: 1, textColor: 0 },
        ...NAMES.map(n => {
          const b = layout[n], p = placed[n]
          return p && b ? { xPosition: p.x, yPosition: p.y, width: p.w, height: p.h, containerID: ID[n], containerName: n, content: text[n], isEventCapture: 0, textColor: b.bright }
            : { xPosition: 0, yPosition: 0, width: 10, height: 30, containerID: ID[n], containerName: n, content: ' ', isEventCapture: 0, textColor: 0 }
        }),
      ]
      const page = { containerTotalNum: textObject.length, textObject, menuObject: { menuItems: this.menu } }
      if (!this.started) {
        const res = await this.bridge.createStartUpPageContainer(page as unknown as CreateStartUpPageContainer)
        this.onSetup?.(res === StartUpPageCreateResult.success ? '' : 'Glasses page setup failed (' + res + ')')
        this.started = true
      } else {
        await this.bridge.rebuildPageContainer(page as unknown as RebuildPageContainer)
      }
      this.layoutKey = key
      this.shown = {}
      for (const n of NAMES) this.shown[n] = { text: text[n] || ' ', bright: layout[n]?.bright ?? 0 }
      await new Promise(r => setTimeout(r, 300))   // let the page settle before the next change
      return
    }
    for (const n of NAMES) {
      const b = layout[n], t = text[n] || ' ', bright = b ? b.bright : 0, was = this.shown[n]
      if (was && was.text === t && was.bright === bright) continue
      await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: ID[n], containerName: n, content: t, textColor: bright }))
      this.shown[n] = { text: t, bright }
    }
  }
}
