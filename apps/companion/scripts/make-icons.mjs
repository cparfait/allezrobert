// Génère les icônes PNG de la PWA (192, 512, apple-touch 180) sans dépendance :
// fond sombre arrondi, deux roues jaunes, cadre bleu. `node scripts/make-icons.mjs`
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function icon(size, rounded = true) {
  const s = size / 512;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const frame = [
    [156, 330, 226, 196], [226, 196, 316, 196], [316, 196, 356, 330], [226, 196, 262, 330], [262, 330, 316, 196], [206, 160, 262, 160],
  ];
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const X = (x + 0.5) / s;
      const Y = (y + 0.5) / s;
      let col = [0x10, 0x15, 0x1c, 255];
      // Coins arrondis (r = 96).
      if (rounded) {
        const cx = Math.min(Math.max(X, 96), 416);
        const cy = Math.min(Math.max(Y, 96), 416);
        if (Math.hypot(X - cx, Y - cy) > 96) col = [0, 0, 0, 0];
      }
      if (col[3]) {
        for (const wx of [156, 356]) if (Math.abs(Math.hypot(X - wx, Y - 330) - 86) < 14) col = [0xff, 0xd2, 0x3f, 255];
        for (const [ax, ay, bx, by] of frame) if (segDist(X, Y, ax, ay, bx, by) < 13) col = [0x1f, 0x6f, 0xeb, 255];
      }
      raw.set(col, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync(path.join(out, 'icon-192.png'), icon(192));
writeFileSync(path.join(out, 'icon-512.png'), icon(512));
writeFileSync(path.join(out, 'apple-touch-icon.png'), icon(180, false));
console.log('icônes écrites dans', out);
