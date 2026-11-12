'use strict';

// Draws the app mark and writes PNG + ICO without any image dependency.
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = size / 64;                       // design grid is 64x64
  const radius = 15 * S;
  const inset = 3 * S;
  const lo = inset, hi = size - inset;

  // two lyric bars, the lower one shorter — the mark reads as a lyric line
  const bars = [
    { x0: 15, x1: 49, y0: 22, y1: 28 },
    { x0: 15, x1: 38, y0: 36, y1: 42 }
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded-rect coverage with 1px analytic-ish antialiasing
      const cx = Math.max(lo + radius, Math.min(x, hi - radius));
      const cy = Math.max(lo + radius, Math.min(y, hi - radius));
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let a = x >= lo && x <= hi && y >= lo && y <= hi ? 1 : 0;
      if (dist > radius - 1) a = Math.max(0, Math.min(1, radius - dist));
      if (a <= 0) { px[i + 3] = 0; continue; }

      const t = (x + y) / (2 * size);
      let r = lerp(126, 92, t), g = lerp(158, 112, t), b = lerp(250, 226, t);

      // top-left specular lift
      const hl = Math.max(0, 1 - Math.hypot(x - size * 0.3, y - size * 0.22) / (size * 0.72));
      r = lerp(r, 205, hl * 0.30); g = lerp(g, 220, hl * 0.30); b = lerp(b, 255, hl * 0.30);

      for (const bar of bars) {
        const bx0 = bar.x0 * S, bx1 = bar.x1 * S, by0 = bar.y0 * S, by1 = bar.y1 * S;
        const br = (by1 - by0) / 2;
        const bcx = Math.max(bx0 + br, Math.min(x, bx1 - br));
        const bcy = Math.max(by0 + br, Math.min(y, by1 - br));
        const bd = Math.hypot(x - bcx, y - bcy);
        let ba = x >= bx0 && x <= bx1 && y >= by0 && y <= by1 ? 1 : 0;
        if (bd > br - 1) ba = Math.max(0, Math.min(1, br - bd));
        if (ba > 0) {
          r = lerp(r, 255, ba * 0.96); g = lerp(g, 255, ba * 0.96); b = lerp(b, 255, ba * 0.96);
        }
      }

      px[i] = Math.round(r); px[i + 1] = Math.round(g); px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

function ico(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, pngBuf]);
}

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
fs.mkdirSync(path.join(root, 'build'), { recursive: true });

fs.writeFileSync(path.join(root, 'assets', 'tray.png'), png(32, draw(32)));
fs.writeFileSync(path.join(root, 'assets', 'icon.png'), png(256, draw(256)));
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(png(256, draw(256)), 256));
console.log('icons written');