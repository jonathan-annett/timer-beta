/*
 * What the glasses show, as up to seven named text boxes over a blank one that catches the taps (the
 * glasses take 8 text boxes at most; all 8 are always declared, unused ones blank). Each box is placed
 * left / right / centred and at the top, the bottom or a given height of the 576×288 canvas. Never shows
 * digits that aren't the timer's (the pairing number is on the phone only).
 *
 * Text only, one font, left aligned: a right-aligned or centred box is placed for the widest text of its
 * current shape (every digit measured as the font's widest, pretext measuring the glasses' font), so it
 * moves only when the shape changes (9:59 → 10:00), never second to second. Text changes go out in
 * place (textContainerUpgrade); layout changes rebuild the page.
 *
 * The glasses' menu (tap, then tap and hold: Even's own, with brightness and close) gets Next corner.
 * Hardware rules from the owner's g2-claude-starter: no zOrderIndex (stacking is declaration order),
 * text boxes a whole number of lines high (30 / 56 / 84 px) or a scrollbar shows, the page and menu as
 * plain objects (as its Mischief Mews sends them; confirmed on the glasses).
 */
import { type EvenAppBridge, type CreateStartUpPageContainer, type RebuildPageContainer, StartUpPageCreateResult, TextContainerUpgrade } from '@evenrealities/even_hub_sdk'
import { getTextWidth, measureTextWrap } from '@evenrealities/pretext'

export type Corner = 'tl' | 'tr' | 'bl' | 'br'
export const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br']
export const MENU = { corner: 1 }
export const W = 576, H = 288, MARGIN = 12

// The boxes, by name (ids fixed; 1 is the tap catcher)
const NAMES = ['clk', 'info', 'msg', 'elapsed', 'total', 'started', 'ends'] as const
export type BoxName = typeof NAMES[number]
const ID: Record<string, number> = Object.fromEntries(NAMES.map((n, i) => [n, i + 2]))

export interface Box {
  text: string
  bright: number                 // 0–4
  h: 'l' | 'r' | 'c'             // left, right, centred
  v: 't' | 'b' | number          // top, bottom, or a y
  wrap?: number                  // wraps within this width (px), up to `lines` lines
  lines?: number
}
export type Layout = Partial<Record<BoxName, Box>>

const lines = (n: number) => (n <= 1 ? 30 : n * 28)   // a text box n lines high
const WIDEST = '0123456789'.split('').reduce((a, d) => (getTextWidth(d) > getTextWidth(a) ? d : a), '0')
const shape = (t: string) => t.replace(/\d/g, WIDEST)
const menuObject = () => ({ menuItems: [{ itemID: MENU.corner, itemName: 'Next corner' }] })

/** Shortens text to fit `n` lines of `width` px, ending in '...' (the font has no '…') */
export function fitLines(text: string, width: number, n: number): string {
  if (measureTextWrap(text, width - 8).lineCount <= n) return text
  let words = text.split(/\s+/)
  while (words.length > 1 && measureTextWrap(words.join(' ') + '...', width - 8).lineCount > n) words = words.slice(0, -1)
  return words.join(' ') + '...'
}

interface Placed { x: number; y: number; w: number; h: number }
function place(b: Box): Placed {
  const wrapped = b.wrap ? measureTextWrap(b.text, b.wrap - 8) : null
  const n = wrapped ? Math.max(1, Math.min(b.lines || 1, wrapped.lineCount)) : 1
  const tw = wrapped ? Math.max(0, ...wrapped.lineWidths) : getTextWidth(shape(b.text))
  const w = Math.min(W - 2 * MARGIN, Math.max(10, Math.ceil(tw) + 8)), h = lines(n)
  const x = b.h === 'l' ? MARGIN : b.h === 'r' ? W - MARGIN - w : Math.round((W - w) / 2)
  const y = b.v === 't' ? MARGIN : b.v === 'b' ? H - MARGIN - h : b.v
  return { x, y, w, h }
}

export class Glasses {
  private started = false
  private layoutKey = ''
  private shown: Record<string, { text: string; bright: number }> = {}
  private busy: Promise<unknown> = Promise.resolve()

  /** Told the outcome of the first page setup: '' when it worked */
  onSetup?: (problem: string) => void

  constructor(private bridge: EvenAppBridge) {}

  /** Shows the layout; queued so calls to the glasses never overlap. force: rebuild the page */
  show(layout: Layout, force = false): void {
    const want = JSON.parse(JSON.stringify(layout)) as Layout
    this.busy = this.busy.then(() => this.apply(want, force)).catch(() => { /* the next change tries again */ })
  }

  private async apply(layout: Layout, force: boolean): Promise<void> {
    const placed: Record<string, Placed> = {}
    for (const n of NAMES) { const b = layout[n]; if (b && b.text) placed[n] = place(b) }
    // The layout's shape: where each box is and how big (digits as the widest, so a ticking time keeps it)
    const key = JSON.stringify(NAMES.map(n => { const b = layout[n]; return b && b.text ? [n, b.h, b.v, b.wrap ? b.text : shape(b.text), placed[n].w] : 0 }))
    if (!this.started || key !== this.layoutKey || force) {
      const textObject = [
        // Takes the taps and swipes; blank (a capturing box's text would scroll)
        { xPosition: 0, yPosition: 0, width: W, height: H, containerID: 1, containerName: 'bg', content: ' ', isEventCapture: 1, textColor: 0 },
        ...NAMES.map(n => {
          const b = layout[n], p = placed[n]
          return p && b ? { xPosition: p.x, yPosition: p.y, width: p.w, height: p.h, containerID: ID[n], containerName: n, content: b.text, isEventCapture: 0, textColor: b.bright }
            : { xPosition: 0, yPosition: 0, width: 10, height: 30, containerID: ID[n], containerName: n, content: ' ', isEventCapture: 0, textColor: 0 }
        }),
      ]
      const page = { containerTotalNum: textObject.length, textObject, menuObject: menuObject() }
      if (!this.started) {
        const res = await this.bridge.createStartUpPageContainer(page as unknown as CreateStartUpPageContainer)
        this.onSetup?.(res === StartUpPageCreateResult.success ? '' : 'Glasses page setup failed (' + res + ')')
        this.started = true
      } else {
        await this.bridge.rebuildPageContainer(page as unknown as RebuildPageContainer)
      }
      this.layoutKey = key
      this.shown = {}
      for (const n of NAMES) { const b = layout[n]; this.shown[n] = { text: b?.text || '', bright: b?.text ? b.bright : 0 } }
      return
    }
    for (const n of NAMES) {
      const b = layout[n], text = b?.text || '', bright = text && b ? b.bright : 0, was = this.shown[n]
      if (was && was.text === text && was.bright === bright) continue
      await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: ID[n], containerName: n, content: text || ' ', textColor: bright }))
      this.shown[n] = { text, bright }
    }
  }
}
