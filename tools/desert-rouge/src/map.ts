/**
 * Carte du Désert rouge vue du ciel (PNG), relue depuis les fichiers du monde : relief ombré, mer, bois, champs,
 * routes par catégorie, bâtiments, et en option un itinéraire en surimpression.
 *
 *   npx tsx tools/desert-rouge/src/map.ts [--route <id>] [--out docs/screenshots/ile-carte.png] [--px 20]
 *
 * L'atlas est utilisé pour la carte en jeu et la vignette. `--style flat` masque les voies secondaires
 * et `--style relief` conserve la vue de diagnostic avec les catégories de routes et de parcelles.
 */
import { GRAVELLY } from './routes.ts';
import { decodeRoute } from '../../../packages/shared/src/routeCodec.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { deltaDecodeU16 } from '../../../packages/shared/src/heights.ts';
import type { RouteData, WorldMeta, WorldTile } from '../../../packages/shared/src/route.ts';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1]! : d;
};
// --dir : monde ailleurs (essai dans ISLAND_OUT).
const DIR = resolve(opt('dir', resolve(import.meta.dirname, '../../../apps/client/public/worlds/desert-rouge')));
const PX = Number(opt('px', '20'));
const OUTF = resolve(opt('out', 'docs/screenshots/desert-rouge-carte.png'));
const ROUTE = opt('route', '');
const STYLE = opt('style', 'atlas');
const ATLAS = STYLE !== 'relief';
const FLAT = STYLE === 'flat';

const meta = JSON.parse(readFileSync(join(DIR, 'world.json'), 'utf8')) as WorldMeta;
// --center x,z --span m : zoom sur une zone (sinon toute l'île).
const C = opt('center', '');
const SPAN = Number(opt('span', '1000'));
const b = C ? (() => {
  const [cx, cz] = C.split(',').map(Number) as [number, number];
  return { minX: cx - SPAN / 2, maxX: cx + SPAN / 2, minZ: cz - SPAN / 2, maxZ: cz + SPAN / 2 };
})() : meta.bounds;
const W = Math.round((b.maxX - b.minX) / PX);
const H = Math.round((b.maxZ - b.minZ) / PX);
const elev = new Float32Array(W * H).fill(NaN);
const img = new Uint8Array(W * H * 3);
const T = meta.tileSizeM;

// Altitudes : grille 8 m des tuiles.
const inView = (t: { tx: number; tz: number }) => (t.tx + 1) * T > b.minX && t.tx * T < b.maxX && (t.tz + 1) * T > b.minZ && t.tz * T < b.maxZ;
for (const t of meta.tiles) {
  if (!inView(t)) continue;
  const buf = readFileSync(join(DIR, 'tiles', `${t.id}.lo.u16`));
  const n = 125;
  const N = n + 1;
  const q = new Uint16Array(N * N);
  for (let k = 0; k < N * N; k++) q[k] = buf.readUInt16LE(k * 2);
  deltaDecodeU16(q, n);
  for (let j = 0; j < T / PX; j++)
    for (let i = 0; i < T / PX; i++) {
      const gx = Math.min(n, Math.floor(((i + 0.5) * PX) / 8));
      const gz = Math.min(n, Math.floor(((j + 0.5) * PX) / 8));
      const X = Math.floor((t.tx * T - b.minX) / PX) + i;
      const Z = Math.floor((t.tz * T - b.minZ) / PX) + j;
      if (X < 0 || Z < 0 || X >= W || Z >= H) continue;
      elev[Z * W + X] = t.baseM + q[gz * N + gx]! * (t.stepM ?? 0.01);
    }
}

const mix = (a: number[], c: number[], t: number) => a.map((v, k) => v + (c[k]! - v) * t);
const SEA = [13, 33, 41];
const SHALLOWS = [23, 60, 67];
// Désert : terres ocre et rouille, roche plus claire, sommets presque roses.
const LOWLAND = [118, 82, 58];
const UPLAND = [138, 94, 64];
const ROCK = [164, 118, 88];
const COAST = [196, 160, 120];
const CONTOUR = [186, 146, 108];
const shadeBy = (slope: number) => Math.min(1.1, Math.max(0.85, 1 + slope * 0.58));
for (let Z = 0; Z < H; Z++)
  for (let X = 0; X < W; X++) {
    const at = Z * W + X;
    const h = elev[at]!;
    let col: number[];
    if (ATLAS) {
      const previous = elev[Z * W + Math.max(0, X - 1)]!;
      const above = elev[Math.max(0, Z - 1) * W + X]!;
      if (!(h > 0.05)) {
        // Isobathes et grille très discrètes au large. Les fonds sont teintés par bandes, sans halo côtier.
        const depth = h > -5 ? 0.75 : h > -11 ? 0.42 : h > -22 ? 0.22 : 0;
        const grid = (X % Math.max(1, Math.round(2000 / PX)) === 0 || Z % Math.max(1, Math.round(2000 / PX)) === 0) && !FLAT;
        col = mix(SEA, SHALLOWS, depth + (grid ? 0.1 : 0));
      } else if (previous <= 0.05 || above <= 0.05) {
        col = COAST;
      } else {
        const level = Math.floor(h / 50);
        col = h <= 350 ? mix(LOWLAND, UPLAND, h / 350) : h <= 800 ? mix(UPLAND, ROCK, (h - 350) / 450) : mix(ROCK, [206, 170, 140], Math.min(1, (h - 800) / 700));
        const grade = (previous + above - 2 * h) / PX;
        col = col.map((v) => v * shadeBy(grade));
        if (!FLAT && level > 0 && (Math.floor(previous / 50) !== level || Math.floor(above / 50) !== level)) {
          col = mix(col, CONTOUR, level % 4 === 0 ? 0.37 : 0.19);
        }
      }
      img.set(col, at * 3);
      continue;
    }
    if (!(h > 0.05)) col = mix([150, 200, 225], [40, 90, 150], Math.min(1, Math.max(0, -h / 25)));
    else if (h < 3) col = [228, 214, 170];
    else if (h < 120) col = mix([170, 205, 130], [200, 200, 140], h / 120);
    else if (h < 400) col = mix([200, 200, 140], [170, 150, 120], (h - 120) / 280);
    else col = mix([170, 150, 120], [235, 235, 235], Math.min(1, (h - 400) / 300));
    // Ombrage (lumière du nord-ouest).
    const hx = (elev[Z * W + Math.min(W - 1, X + 1)]! - elev[Z * W + Math.max(0, X - 1)]!) / (2 * PX);
    const hz = (elev[Math.min(H - 1, Z + 1) * W + X]! - elev[Math.max(0, Z - 1) * W + X]!) / (2 * PX);
    const shade = h > 0.05 ? Math.max(0.55, Math.min(1.25, 1 + (-hx - hz) * 2.2)) : 1;
    img.set(col.map((v) => Math.max(0, Math.min(255, v * shade))), (Z * W + X) * 3);
  }

const put = (x: number, z: number, c: number[], a = 1) => {
  const X = Math.floor((x - b.minX) / PX);
  const Z = Math.floor((z - b.minZ) / PX);
  if (X < 0 || Z < 0 || X >= W || Z >= H) return;
  const o = (Z * W + X) * 3;
  for (let k = 0; k < 3; k++) img[o + k] = img[o + k]! + (c[k]! - img[o + k]!) * a;
};
function fill(rings: number[][], c: number[], a: number): void {
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const r of rings) for (let k = 1; k < r.length; k += 2) (z0 = Math.min(z0, r[k]!)), (z1 = Math.max(z1, r[k]!));
  for (let Z = Math.floor((z0 - b.minZ) / PX); Z <= Math.floor((z1 - b.minZ) / PX); Z++) {
    const z = b.minZ + (Z + 0.5) * PX;
    const xs: number[] = [];
    for (const r of rings) {
      const m = r.length / 2;
      for (let i = 0, j = m - 1; i < m; j = i++) {
        const az = r[i * 2 + 1]!;
        const bz = r[j * 2 + 1]!;
        if (az > z !== bz > z) xs.push(r[i * 2]! + ((z - az) / (bz - az)) * (r[j * 2]! - r[i * 2]!));
      }
    }
    xs.sort((p, q) => p - q);
    for (let t = 0; t + 1 < xs.length; t += 2) for (let x = xs[t]!; x < xs[t + 1]!; x += PX) put(x, z, c, a);
  }
}
function line(pts: number[], stride: number, c: number[], w = 1, widthM = 0, alpha = 1): void {
  if (widthM && PX < 4) w = Math.max(1, Math.round(widthM / PX));
  for (let k = 0; k + stride < pts.length; k += stride) {
    const ax = pts[k]!;
    const az = pts[k + stride - 1]!;
    const bx = pts[k + stride]!;
    const bz = pts[k + 2 * stride - 1]!;
    const L = Math.hypot(bx - ax, bz - az);
    for (let s = 0; s <= L; s += PX / 2) {
      const x = ax + ((bx - ax) * s) / Math.max(L, 1e-6);
      const z = az + ((bz - az) * s) / Math.max(L, 1e-6);
      for (let dx = -(w - 1); dx <= w - 1; dx++) for (let dz = -(w - 1); dz <= w - 1; dz++) put(x + dx * PX * 0.5, z + dz * PX * 0.5, c, alpha);
    }
  }
}

const FIELD: Record<string, number[]> = { farmland: [222, 196, 110], meadow: [150, 196, 95], orchard: [120, 170, 80], vineyard: [150, 120, 160], sand: [240, 225, 170], heath: [175, 150, 110], bare: [170, 165, 160], wetland: [120, 170, 160] };
const LAND: Record<string, number[]> = { retail: [200, 190, 180], pitch: [90, 170, 90], cemetery: [140, 160, 130], farmyard: [190, 170, 140], golf: [110, 200, 110], park: [120, 190, 110] };
const ROAD: Record<string, [number[], number]> = { secondary: [[200, 60, 40], 2], tertiary: [[240, 170, 40], 2], residential: [[90, 90, 90], 1], unclassified: [[255, 255, 255], 1], cycleway: [[30, 140, 60], 1], track: [[140, 90, 40], 1] };
const tiles: WorldTile[] = meta.tiles.filter(inView).map((t) => JSON.parse(readFileSync(join(DIR, 'tiles', `${t.id}.json`), 'utf8')) as WorldTile);
if (ATLAS) {
  // Sable de l'erg, sel du chott, palmeraies.
  for (const t of tiles) for (const f of t.fields) if (f.kind === 'sand') fill(f.rings, [176, 112, 70], 0.42);
  for (const t of tiles) for (const f of t.fields) if (f.kind === 'orchard' || f.kind === 'farmland') fill(f.rings, [62, 92, 56], 0.55);
  for (const t of tiles) for (const f of t.landuse) if (f.kind === 'quarry') fill(f.rings, [226, 220, 204], 0.85);
  for (const t of tiles) for (const f of t.forests) fill(f.rings, f.kind === 'conifer' ? [38, 72, 64] : [70, 92, 58], 0.46);
  for (const t of tiles) for (const w of t.water) fill(w.rings, [29, 65, 75], 1);
  if (!FLAT) {
    for (const t of tiles) for (const w of t.waterways) line(w.pts, 2, [104, 163, 168], 1, 0, 0.36);
    for (const t of tiles) for (const r of t.roads) {
      if (r.kind === 'cycleway' || r.kind === 'track') line(r.pts, 3, [102, 167, 146], 1, 0, 0.44);
      else if (r.kind === 'residential' || r.kind === 'unclassified') line(r.pts, 3, [165, 183, 160], 1, 0, 0.28);
    }
  }
  // Le réseau principal reste visible sous le trajet sélectionné, dessiné par l'interface.
  const major = (kind: string) => kind === 'secondary' || kind === 'tertiary';
  for (const t of tiles) for (const r of t.roads) if (major(r.kind)) line(r.pts, 3, [27, 62, 57], 2);
  for (const t of tiles) for (const r of t.roads) if (major(r.kind)) line(r.pts, 3, [203, 208, 171], 1, 0, r.kind === 'secondary' ? 0.8 : 0.59);
} else {
for (const t of tiles) for (const f of t.fields) fill(f.rings, FIELD[f.kind] ?? [180, 180, 120], 0.45);
for (const t of tiles) for (const f of t.forests) fill(f.rings, f.kind === 'conifer' ? [40, 90, 60] : [60, 120, 55], 0.75);
for (const t of tiles) for (const f of t.landuse) fill(f.rings, LAND[f.kind] ?? [200, 200, 200], 0.6);
for (const t of tiles) for (const w of t.water) fill(w.rings, [70, 130, 200], 1);
for (const t of tiles) for (const w of t.waterways) line(w.pts, 2, [60, 120, 210], 1);
for (const t of tiles) for (const r of t.roads) if (r.kind === 'track' && !GRAVELLY.has(r.surface ?? '')) line(r.pts, 3, [170, 60, 160], 1);
for (const kind of ['track', 'cycleway', 'unclassified', 'residential', 'tertiary', 'secondary'])
  for (const t of tiles) for (const r of t.roads) if (r.kind === kind && !(kind === 'track' && !GRAVELLY.has(r.surface ?? ''))) line(r.pts, 3, ROAD[kind]![0], ROAD[kind]![1], r.width);
for (const t of tiles) for (const bd of t.buildings) put(bd.pts[0]!, bd.pts[1]!, [110, 60, 60]);
}
if (ROUTE && existsSync(join(DIR, 'routes', `${ROUTE}.json`))) {
  const r = decodeRoute<RouteData>(JSON.parse(readFileSync(join(DIR, 'routes', `${ROUTE}.json`), 'utf8')));
  line(r.points.flatMap((p) => [p.x, p.z]), 2, ATLAS ? [255, 211, 99] : [20, 60, 230], 3);
}

// PNG.
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let Z = 0; Z < H; Z++) {
  raw[Z * (W * 3 + 1)] = 0;
  Buffer.from(img.buffer, Z * W * 3, W * 3).copy(raw, Z * (W * 3 + 1) + 1);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const v of buf) c = crcTable[(c ^ v) & 0xff]! ^ (c >>> 8);
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
writeFileSync(OUTF, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`carte ${W} × ${H} → ${OUTF}`);
