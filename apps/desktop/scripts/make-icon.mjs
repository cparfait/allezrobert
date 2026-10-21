// Génère une icône provisoire 1024×1024 (PNG RGBA) sans dépendance externe :
// fond arrondi orange, deux roues de vélo et un cadre stylisé en blanc.
// Usage : node scripts/make-icon.mjs  (puis `tauri icon src-tauri/icons/source.png`)
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../src-tauri/icons/source.png');

const px = new Uint8Array(SIZE * SIZE * 4);

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE || a <= 0) return;
  const i = (y * SIZE + x) * 4;
  const sa = Math.min(1, a);
  const da = px[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  const mix = (s, d) => (oa === 0 ? 0 : Math.round((s * sa + d * da * (1 - sa)) / oa));
  px[i] = mix(r, px[i]);
  px[i + 1] = mix(g, px[i + 1]);
  px[i + 2] = mix(b, px[i + 2]);
  px[i + 3] = Math.round(oa * 255);
}

// Distance signée vers un rectangle arrondi (fond).
function roundedRectAlpha(x, y, margin, radius) {
  const half = SIZE / 2 - margin;
  const qx = Math.abs(x - SIZE / 2) - (half - radius);
  const qy = Math.abs(y - SIZE / 2) - (half - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  return Math.max(0, Math.min(1, 0.5 - outside));
}

// Fond : dégradé orange → rouge.
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const a = roundedRectAlpha(x + 0.5, y + 0.5, 32, 200);
    const t = y / SIZE;
    blend(x, y, Math.round(255 - 30 * t), Math.round(140 - 90 * t), Math.round(30 + 10 * t), a);
  }
}

function ring(cx, cy, radius, width) {
  for (let y = Math.floor(cy - radius - width); y <= cy + radius + width; y++) {
    for (let x = Math.floor(cx - radius - width); x <= cx + radius + width; x++) {
      const d = Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - radius);
      blend(x, y, 255, 255, 255, Math.max(0, Math.min(1, width / 2 - d + 0.5)));
    }
  }
}

function segment(x0, y0, x1, y1, width) {
  const minX = Math.floor(Math.min(x0, x1) - width);
  const maxX = Math.ceil(Math.max(x0, x1) + width);
  const minY = Math.floor(Math.min(y0, y1) - width);
  const maxY = Math.ceil(Math.max(y0, y1) + width);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px0 = x + 0.5 - x0;
      const py0 = y + 0.5 - y0;
      const t = Math.max(0, Math.min(1, (px0 * dx + py0 * dy) / len2));
      const d = Math.hypot(px0 - t * dx, py0 - t * dy);
      blend(x, y, 255, 255, 255, Math.max(0, Math.min(1, width / 2 - d + 0.5)));
    }
  }
}

const rearX = 300;
const frontX = 724;
const wheelY = 640;
const wheelR = 170;
ring(rearX, wheelY, wheelR, 40);
ring(frontX, wheelY, wheelR, 40);
// Cadre : base arrière, tube de selle, tube supérieur, tube diagonal, fourche, guidon, selle.
const bb = [500, 640];
const seat = [440, 400];
const head = [680, 400];
segment(rearX, wheelY, bb[0], bb[1], 36);
segment(rearX, wheelY, seat[0], seat[1], 36);
segment(seat[0], seat[1], bb[0], bb[1], 36);
segment(seat[0], seat[1], head[0], head[1], 36);
segment(bb[0], bb[1], head[0], head[1], 36);
segment(head[0], head[1], frontX, wheelY, 36);
segment(head[0], head[1], 650, 320, 36);
segment(650, 320, 740, 320, 36);
segment(400, 360, 500, 360, 40);

// Encodage PNG.
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // profondeur
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`Icône source écrite : ${out}`);
