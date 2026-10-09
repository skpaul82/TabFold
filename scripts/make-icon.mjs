// Draws media/icon.png (256×256): a dark tile with three tab groups, each a colored chip followed by
// tinted tabs, the way they look in the tab bar. Node built-ins only, so the icon can be rebuilt anywhere.
//   node scripts/make-icon.mjs
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const SIZE = 256;
const SS = 4; // supersampling per axis, for smooth edges

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BG = hex('#202124');
const blue = hex('#8ab4f8');
const green = hex('#81c995');
const orange = hex('#fcad70');

/** Shapes drawn in order: [x0, y0, x1, y1, radius, rgb, alpha]. */
const shapes = [[0, 0, 256, 256, 56, BG, 1]];
const row = (y, color, tabs) => {
  const h = 40;
  shapes.push([30, y, 30 + 54, y + h, h / 2, color, 1]); // chip
  let x = 94;
  for (const w of tabs) {
    shapes.push([x, y, x + w, y + h, 9, color, 0.28]); // tinted tab
    shapes.push([x, y + h - 6, x + w, y + h, 3, color, 1]); // colored underline
    x += w + 8;
  }
};
row(54, blue, [62, 62]);
row(108, green, [80]);
row(162, orange, []);

const inside = (px, py, [x0, y0, x1, y1, r]) => {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
};

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // PNG filter: none
  for (let x = 0; x < SIZE; x++) {
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS;
        const py = y + (sy + 0.5) / SS;
        let c = [0, 0, 0];
        let a = 0;
        for (const s of shapes) {
          if (!inside(px, py, s)) continue;
          const [, , , , , rgb, alpha] = s;
          c = c.map((v, i) => v * (1 - alpha) + rgb[i] * alpha);
          a = a * (1 - alpha) + alpha;
        }
        for (let i = 0; i < 3; i++) acc[i] += c[i] * a;
        acc[3] += a;
      }
    }
    const o = y * (SIZE * 4 + 1) + 1 + x * 4;
    const n = SS * SS;
    const alpha = acc[3] / n;
    for (let i = 0; i < 3; i++) raw[o + i] = alpha ? Math.round(acc[i] / n / alpha) : 0;
    raw[o + 3] = Math.round(alpha * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA

const out = join(resolve(import.meta.dirname, '..'), 'media', 'icon.png');
writeFileSync(
  out,
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]),
);
console.log(`Wrote ${out}`);
