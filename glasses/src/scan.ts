/*
 * Scanning the timer's QR code on the phone page, instead of typing the 6-digit code. Only the
 * share panel's Countdown code (a view-only link) is accepted: the timer decides whether glasses may
 * work it (the operator role), so glasses never pick up the control key from a QR code. The camera is
 * the phone's (the glasses have none). In the Even app the page can't open it itself (getUserMedia is
 * refused), so the phone page asks the app to take a photo (main.ts startScan: bridge.captureImageFromCamera,
 * the app's camera permission) and codeFromPhoto() reads the code from it; scan() (a live view) is for a
 * plain browser.
 */
import jsQR from 'jsqr'
import { parseFrag, SITE, type Paired } from './link'

export type ScanResult = { ok: true; paired: Paired } | { ok: false; why: string }

/** What a scanned text means: a view-only link to a timer on our site, or why not */
export function readCode(text: string): ScanResult {
  let u: URL
  try { u = new URL(text.trim()) } catch { return { ok: false, why: 'That isn’t a timer’s QR code.' } }
  if (u.host !== SITE) return { ok: false, why: `That timer isn’t at ${SITE}: these glasses work with ${SITE} timers.` }
  const p = new URLSearchParams(u.hash.slice(1))
  if (p.get('k') || p.get('a') || p.get('c') || p.get('p')) {
    return { ok: false, why: 'That’s the timer’s control code. In the timer’s share panel choose Countdown, then scan again (the timer decides whether the glasses can control it).' }
  }
  const paired = parseFrag(u.hash)
  return paired ? { ok: true, paired } : { ok: false, why: 'That isn’t a timer’s QR code.' }
}

/** Reads a QR code from a photo (base64, as the Even app returns it): '' if there's none */
export async function codeFromPhoto(base64: string, mime = 'image/jpeg'): Promise<string> {
  const img = new Image()
  img.src = base64.startsWith('data:') ? base64 : `data:${mime};base64,${base64}`
  await img.decode()
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true })!
  // Phone photos are big: try a few sizes (a small QR code in a big photo needs more pixels)
  for (const max of [800, 1400, 2200]) {
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    cv.width = Math.round(img.naturalWidth * scale); cv.height = Math.round(img.naturalHeight * scale)
    ctx.drawImage(img, 0, 0, cv.width, cv.height)
    const d = ctx.getImageData(0, 0, cv.width, cv.height)
    const found = jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' })
    if (found?.data) return found.data
    if (scale === 1) break
  }
  return ''
}

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }

/** Shows the camera in `video` and resolves with the first QR code's text; stop() ends it early */
export function scan(video: HTMLVideoElement): { result: Promise<string>; stop: () => void } {
  let stream: MediaStream | null = null, timer = 0, stopped = false
  const stop = () => {
    stopped = true
    clearInterval(timer)
    stream?.getTracks().forEach(t => t.stop())
    video.srcObject = null
  }
  const result = new Promise<string>((resolve, reject) => {
    const md = navigator.mediaDevices
    if (!md || !md.getUserMedia) { reject(new Error('no-camera')); return }
    md.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(s => {
      if (stopped) { s.getTracks().forEach(t => t.stop()); return }
      stream = s
      video.srcObject = s
      video.setAttribute('playsinline', '')
      video.play().catch(() => { /* shown anyway on most */ })
      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
      const detector = BD ? new BD({ formats: ['qr_code'] }) : null
      const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true })!
      let busy = false
      timer = window.setInterval(async () => {
        if (busy || stopped || video.readyState < 2 || !video.videoWidth) return
        busy = true
        try {
          let text = ''
          if (detector) { const r = await detector.detect(video); text = r[0]?.rawValue || '' }
          else {
            const scale = Math.min(1, 640 / video.videoWidth)
            cv.width = Math.round(video.videoWidth * scale); cv.height = Math.round(video.videoHeight * scale)
            ctx.drawImage(video, 0, 0, cv.width, cv.height)
            const img = ctx.getImageData(0, 0, cv.width, cv.height)
            text = jsQR(img.data, img.width, img.height)?.data || ''
          }
          if (text) { stop(); resolve(text) }
        } catch { /* try the next frame */ } finally { busy = false }
      }, 250)
    }, err => reject(err))
  })
  return { result, stop }
}
