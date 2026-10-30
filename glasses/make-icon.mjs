// Draws icon.png: the 24×24 icon Even Hub asks for (only #F4F4F4 or transparent, lit pixels in 2×2
// blocks), a stopwatch drawn on a 12×12 grid. Run: node make-icon.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const G = [
  '.....##.....',
  '....####....',
  '...######...',
  '..##....##..',
  '.##..#...##.',
  '.#...#....#.',
  '.#...###..#.',
  '.#........#.',
  '.##......##.',
  '..##....##..',
  '...######...',
  '............',
]
const S = 24, px = Buffer.alloc(S * (1 + S * 4))
for (let y = 0; y < S; y++) {
  px[y * (1 + S * 4)] = 0
  for (let x = 0; x < S; x++) {
    const on = G[y >> 1][x >> 1] === '#', o = y * (1 + S * 4) + 1 + x * 4
    px[o] = px[o + 1] = px[o + 2] = 0xf4; px[o + 3] = on ? 255 : 0
  }
}
const crc = b => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6
writeFileSync('icon.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(px)), chunk('IEND', Buffer.alloc(0))]))
console.log('icon.png written')
