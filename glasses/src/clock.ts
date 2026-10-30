/*
 * The countdown, worked out here from the timer's anchor (state.clk) as the timer's own devices do
 * (public/remote-clock.js; keep the two in step): the timer sends a new anchor only when something
 * changes, so a running countdown sends nothing.
 *   clk = {r, e, d, rr, er, f, p, s, sa, a}: remaining / elapsed ms and their rates, the total,
 *   before-the-start and paused flags, standing by and ms to its auto start, a = its age when sent.
 */

export interface Anchor { r: number; e: number; d: number; rr: number; er: number; f?: number; p?: number; s?: number; sa?: number; a?: number }
export interface ClockValues { remain: string; over: boolean; impending: boolean; paused: boolean; standby: boolean }

// timer.js secToStr, exactly (the texts must match the timer's)
export function secToStr(sec: number): string {
  const prefix = sec < 0 ? '-' : ''
  if (sec < 0) sec = -sec
  const min = Math.trunc(sec / 60) % 60, hr = Math.trunc(sec / 3600), sx = Math.trunc(sec % 60)
  const sx_ = (sx < 10 ? '0' : '') + sx
  if (hr < 1) return prefix + min + ':' + sx_
  return prefix + hr + ':' + (min < 10 ? '0' : '') + min + ':' + sx_
}

const valid = (c: unknown): c is Anchor => {
  const a = c as Anchor
  return !!a && typeof a === 'object' && [a.r, a.e, a.d, a.rr, a.er].every(Number.isFinite) && a.d > 0
}

export class Clock {
  private anchor: Anchor | null = null
  private at = 0

  set(c: unknown): void {
    if (!valid(c)) return
    this.anchor = c
    this.at = performance.now() - Math.max(0, Math.min(5000, Number(c.a) || 0))
  }
  clear(): void { this.anchor = null }
  get active(): boolean { return !!this.anchor }

  values(): ClockValues | null {
    const c = this.anchor
    if (!c) return null
    const dt = performance.now() - this.at
    const r = c.r + c.rr * dt, e = c.e + c.er * dt
    const paused = !!c.p, standby = !!c.s
    if (c.f) return { remain: secToStr(c.d / 1000), over: false, impending: e > -60000, paused, standby }   // before the start
    const s = r / 1000, over = s < 0
    return { remain: over ? secToStr(-s) : secToStr(s + 1), over, impending: !over && e >= 0 && s <= 60, paused, standby }
  }
}
