/**
 * Mise au point du relief : aperçu PNG du terrain (sans routes), un pixel tous les `--px` mètres.
 *
 *   npx tsx tools/desert-rouge/src/probe.ts --px 50 --out aperçu.png
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { ISLAND, terrain } from './design.ts';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const PX = Number(arg('px', '50'));
const W = Math.round((ISLAND.maxX - ISLAND.minX) / PX);
const H = Math.round((ISLAND.maxZ - ISLAND.minZ) / PX);
const hs = new Float32Array(W * H);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) hs[j * W + i] = terrain(ISLAND.minX + (i + 0.5) * PX, ISLAND.minZ + (j + 0.5) * PX);
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let j = 0; j < H; j++) {
  raw[j * (W * 3 + 1)] = 0;
  for (let i = 0; i < W; i++) {
    const h = hs[j * W + i]!;
    const hx = hs[j * W + Math.min(W - 1, i + 1)]! - h;
    const hz = hs[Math.min(H - 1, j + 1) * W + i]! - h;
    const shade = Math.max(0.45, Math.min(1.3, 1 - (hx + hz) / (PX * 0.6)));
    let c: [number, number, number];
    if (h < 0) c = [30, 80, 110];
    else {
      const k = Math.min(1, h / 600);
      c = [170 + 70 * k, 90 + 120 * k, 50 + 130 * k];
    }
    const o = j * (W * 3 + 1) + 1 + i * 3;
    raw[o] = Math.min(255, c[0] * shade);
    raw[o + 1] = Math.min(255, c[1] * shade);
    raw[o + 2] = Math.min(255, c[2] * shade);
  }
}
// --graph graph.json : réseau routier par-dessus (routes en blanc, chemins en jaune, sentiers en rouge).
const gpath = arg('graph', '');
if (gpath && existsSync(gpath)) {
  const g = JSON.parse(readFileSync(gpath, 'utf8')) as { edges: Array<{ kind: string; surface?: string; pts: number[] }> };
  for (const e of g.edges) {
    const col = e.kind === 'track' ? (['gravel', 'fine_gravel', 'pebblestone', 'cobblestone'].includes(e.surface ?? '') ? [255, 220, 60] : [230, 40, 40]) : e.kind === 'cycleway' ? [60, 200, 255] : [255, 255, 255];
    for (let k = 0; k < e.pts.length; k += 3) {
      const i = Math.floor((e.pts[k]! - ISLAND.minX) / PX);
      const j = Math.floor((e.pts[k + 2]! - ISLAND.minZ) / PX);
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const o = j * (W * 3 + 1) + 1 + i * 3;
      raw[o] = col[0]!;
      raw[o + 1] = col[1]!;
      raw[o + 2] = col[2]!;
    }
  }
}
const crc = (b: Buffer) => {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
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
writeFileSync(arg('out', 'apercu.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${W} × ${H}`);
