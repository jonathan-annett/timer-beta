/*
 * What the glasses show: the countdown, small and dim, in one corner of the 576×288 canvas, and a
 * status line in the same corner when there's no countdown to show (not paired, timer closed).
 * Text only, one font, left aligned: a right-hand corner places the box for the widest time of the
 * current format (pretext measures the glasses' font), so the box moves only when the format changes
 * (9:59 → 10:00), never second to second. Text changes go out as textContainerUpgrade (in place);
 * layout changes rebuild the page. Never shows digits that aren't the countdown (the pairing number
 * is on the phone only). Hardware rules from the owner's g2-claude-starter: no zOrderIndex (stacking is
 * declaration order), text boxes a whole number of lines high (30 / 56 / 84 px) or a scrollbar shows.
 * The glasses' menu (tap, then tap and hold: Even's own, with brightness and close) gets Next corner.
 */
import {
  type EvenAppBridge, type CreateStartUpPageContainer, type RebuildPageContainer, StartUpPageCreateResult, TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'
import { getTextWidth, measureTextWrap } from '@evenrealities/pretext'

export type Corner = 'tl' | 'tr' | 'bl' | 'br'
export const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br']
export const MENU = { corner: 1 }
// Rebuilding without a menu drops it, so every create and rebuild sends it. The page goes to the
// bridge as plain objects, as the g2-claude-starter's Mischief Mews (confirmed on the glasses) sends it
const menuObject = () => ({ menuItems: [{ itemID: MENU.corner, itemName: 'Next corner' }] })

const W = 576, H = 288, MARGIN = 14, INFO_W = 300
const lines = (n: number) => (n <= 1 ? 30 : n * 28)   // a box n lines high
const BG = { id: 1, name: 'bg' }, CLK = { id: 2, name: 'clk' }, INFO = { id: 3, name: 'info' }

export interface View {
  clock: string        // '' when there's no countdown
  bright: number       // 0–4
  info: string         // '' when there's nothing to say
}

// The widest digit in the glasses' font: times are measured with it in every digit place
const WIDEST = '0123456789'.split('').reduce((a, d) => (getTextWidth(d) > getTextWidth(a) ? d : a), '0')
const shape = (t: string) => t.replace(/\d/g, WIDEST)

export class Glasses {
  private started = false
  private layoutKey = ''
  private shown: View = { clock: '', bright: -1, info: '' }
  private busy: Promise<unknown> = Promise.resolve()

  /** Told the outcome of the first page setup: '' when it worked */
  onSetup?: (problem: string) => void

  constructor(private bridge: EvenAppBridge, public corner: Corner) {}

  setCorner(c: Corner): void { this.corner = c; this.layoutKey = ''; this.show(this.shown, true) }

  /** Shows v; queued so calls to the glasses never overlap */
  show(v: View, force = false): void {
    const want = { ...v }
    this.busy = this.busy.then(() => this.apply(want, force)).catch(() => { /* the next change tries again */ })
  }

  private boxes(v: View) {
    const left = this.corner === 'tl' || this.corner === 'bl', top = this.corner === 'tl' || this.corner === 'tr'
    const cw = v.clock ? Math.min(W - 2 * MARGIN, getTextWidth(shape(v.clock)) + 8) : 10
    const ch = lines(1)
    const iw = INFO_W, ih = lines(v.info ? measureTextWrap(v.info, INFO_W - 8).lineCount : 1)
    const x = (w: number) => (left ? MARGIN : W - MARGIN - w)
    const y = (h: number) => (top ? MARGIN : H - MARGIN - h)
    return [
      // Takes the taps and swipes; blank (a capturing box's text would scroll)
      ({ xPosition: 0, yPosition: 0, width: W, height: H, containerID: BG.id, containerName: BG.name,
        content: ' ', isEventCapture: 1, textColor: 0 }),
      ({ xPosition: x(cw), yPosition: y(ch), width: cw, height: ch,
        containerID: CLK.id, containerName: CLK.name, content: v.clock || ' ', isEventCapture: 0, textColor: v.bright }),
      ({ xPosition: x(iw), yPosition: y(ih), width: iw, height: ih,
        containerID: INFO.id, containerName: INFO.name, content: v.info || ' ', isEventCapture: 0, textColor: 2 }),
    ]
  }

  private async apply(v: View, force: boolean): Promise<void> {
    const key = [this.corner, shape(v.clock), v.info ? measureTextWrap(v.info, INFO_W - 8).lineCount : 0].join('|')
    if (!this.started || key !== this.layoutKey || force) {
      const textObject = this.boxes(v)
      if (!this.started) {
        const res = await this.bridge.createStartUpPageContainer({ containerTotalNum: 3, textObject, menuObject: menuObject() } as unknown as CreateStartUpPageContainer)
        this.onSetup?.(res === StartUpPageCreateResult.success ? '' : 'Glasses page setup failed (' + res + ')')
        this.started = true
      } else {
        await this.bridge.rebuildPageContainer({ containerTotalNum: 3, textObject, menuObject: menuObject() } as unknown as RebuildPageContainer)
      }
      this.layoutKey = key
      this.shown = { ...v }
      return
    }
    if (v.clock !== this.shown.clock || v.bright !== this.shown.bright) {
      await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: CLK.id, containerName: CLK.name,
        content: v.clock || ' ', textColor: v.bright }))
    }
    if (v.info !== this.shown.info) {
      await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: INFO.id, containerName: INFO.name, content: v.info || ' ' }))
    }
    this.shown = { ...v }
  }
}
