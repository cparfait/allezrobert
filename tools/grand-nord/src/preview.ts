/**
 * Aperçu rapide du relief (mise au point de design.ts, sans construire le monde) : relief ombré, mer, îlots, lacs,
 * glace, villages, vallées. `--px 60` (m par pixel), `--out fichier.png`, `--network net.json` (points du réseau).
 *
 *   npx tsx tools/grand-nord/src/preview.ts --px 60 --out apercu.png
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { ISLAND, LAKES, TOWNS, VALLEYS, inGlacier, inLake, inRiver, terrain } from './design.ts';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1]! : d;
};
const PX = Number(opt('px', '60'));
const OUT = resolve(opt('out', 'apercu-grand-nord.png'));
const W = Math.round((ISLAND.maxX - ISLAND.minX) / PX);
const H = Math.round((ISLAND.maxZ - ISLAND.minZ) / PX);
const h = new Float32Array(W * H);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) h[j * W + i] = terrain(ISLAND.minX + (i + 0.5) * PX, ISLAND.minZ + (j + 0.5) * PX);
const img = new Uint8Array(W * H * 3);
let maxH = 0;
for (let k = 0; k < W * H; k++) maxH = Math.max(maxH, h[k]!);
for (let j = 0; j < H; j++)
  for (let i = 0; i < W; i++) {
    const k = j * W + i;
    const x = ISLAND.minX + (i + 0.5) * PX;
    const z = ISLAND.minZ + (j + 0.5) * PX;
    const e = h[k]!;
    let c: number[];
    if (e <= 0) c = [30, 60, 90];
    else if (inLake(x, z, 1)) c = [50, 90, 130];
    else if (inGlacier(x, z)) c = [235, 242, 248];
    else if (inRiver(x, z, PX / 2)) c = [70, 120, 160];
    else {
      const t = Math.min(1, e / 1000);
      c = e < 120 ? [120, 150, 90] : e < 280 ? [150, 140, 95] : e < 600 ? [140, 125, 105] : [180 + 60 * t, 180 + 60 * t, 185 + 60 * t];
      const hx = h[k + (i + 1 < W ? 1 : 0)]! - h[k - (i > 0 ? 1 : 0)]!;
      const hz = h[k + (j + 1 < H ? W : 0)]! - h[k - (j > 0 ? W : 0)]!;
      const sh = Math.max(0.35, Math.min(1.25, 0.85 - (hx + hz) / (PX * 2.2)));
      c = c.map((v) => Math.min(255, v * sh));
    }
    img.set(c.map((v) => Math.round(v)), k * 3);
  }
const dot = (x: number, z: number, r: number, c: number[]) => {
  const ci = Math.round((x - ISLAND.minX) / PX);
  const cj = Math.round((z - ISLAND.minZ) / PX);
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (ci + di >= 0 && cj + dj >= 0 && ci + di < W && cj + dj < H && di * di + dj * dj <= r * r) img.set(c, ((cj + dj) * W + ci + di) * 3);
};
for (const v of VALLEYS) for (const p of v.pts) dot(p[0], p[1], 1, [255, 160, 0]);
for (const t of TOWNS) dot(t.x, t.z, 3, [220, 30, 30]);
for (const l of LAKES) if (l.name) dot(l.x, l.z, 1, [0, 0, 120]);
const net = opt('network', '');
if (net) {
  const { readFileSync } = await import('node:fs');
  const pts = JSON.parse(readFileSync(net, 'utf8')) as Array<[number, number]>;
  for (const p of pts) dot(p[0], p[1], 1, [255, 255, 0]);
}
console.log(`${W} × ${H}, sommet ${maxH.toFixed(0)} m, ${LAKES.length} lacs`);
for (const t of TOWNS) console.log(`  ${t.id} ${t.x.toFixed(0)},${t.z.toFixed(0)} niveau ${t.level.toFixed(1)}`);

// PNG
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let j = 0; j < H; j++) {
  raw[j * (W * 3 + 1)] = 0;
  Buffer.from(img.buffer, j * W * 3, W * 3).copy(raw, j * (W * 3 + 1) + 1);
}
const crcTab = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer) => {
  let c = 0xffffffff;
  for (const v of b) c = crcTab[(c ^ v) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
writeFileSync(OUT, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(OUT);
