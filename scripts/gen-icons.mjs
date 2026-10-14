// Generates simple PNG app icons (no dependencies): green square, ivory tile, red "中" bar motif.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const s = size / 512;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0x14, g = 0x32, b = 0x1f;
      const X = x / s, Y = y / s;
      if (X > 136 && X < 376 && Y > 72 && Y < 412) { r = 0xf8; g = 0xf4; b = 0xe8; }
      if (X > 136 && X < 376 && Y > 380 && Y < 440) { r = 0x2f; g = 0x8f; b = 0x5b; }
      // stylised 中: box + vertical stroke
      const inBox = X > 186 && X < 326 && Y > 170 && Y < 270 && !(X > 206 && X < 306 && Y > 190 && Y < 250);
      const stroke = X > 244 && X < 268 && Y > 120 && Y < 350;
      if (inBox || stroke) { r = 0xc6; g = 0x28; b = 0x28; }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
for (const n of [180, 192, 512]) writeFileSync(new URL(`../public/icon-${n}.png`, import.meta.url), png(n));
console.log('icons written');
