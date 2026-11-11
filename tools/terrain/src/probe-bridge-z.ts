/**
 * Sonde (lecture seule) : altitudes des ponts et tunnels d'un monde construit, comparées au Z par
 * sommet de l'IGN BD TOPO® (`BDTOPO_V3:troncon_de_route`, `position_par_rapport_au_sol` ≠ 0).
 * Rien n'est écrit dans le monde ; seul le cache BD TOPO peut se remplir.
 *
 * `npx tsx tools/terrain/src/probe-bridge-z.ts --world <id> [--top 15] [--json <fichier>]`
 *
 * Par ouvrage (morceau de route `bridge` / `tunnel` d'une tuile) :
 * - « brut » : BD TOPO − notre altitude, tel quel (inclut un éventuel décalage de référence) ;
 * - « forme » : le même écart après retrait de la droite passant par ses deux extrémités, c'est-à-dire
 *   ce que perd l'interpolation linéaire entre culées (dos d'âne, cuvette, tunnel en pente variable).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { WorldMeta } from '@allezrobert/shared';
import { OUT_DIR, TILE_SIZE_M } from './config.ts';
import { cachePath, fetchCached } from './net.ts';

const WFS = 'https://data.geopf.fr/wfs/ows';
const PAGE = 1000;
/** Distance maximale (m) entre notre axe et le tronçon BD TOPO, et écart de cap maximal (cos). */
const MAX_DIST_M = 8;
const MIN_COS = Math.cos((30 * Math.PI) / 180);
const STEP_M = 4;

interface Seg {
  ax: number;
  az: number;
  ay: number;
  bx: number;
  bz: number;
  by: number;
  pos: number;
}

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const top = Number(arg('--top') ?? 15);

const meta = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'world.json'), 'utf8')) as WorldMeta;
const origin = (meta as unknown as { originL93: { x: number; y: number } }).originL93;
const tilesDir = path.join(OUT_DIR, 'tiles');

/** Tronçons BD TOPO hors sol d'une tuile (même requête et même clé de cache que `enrich.ts`). */
async function structuresOfTile(tx: number, tz: number): Promise<Seg[]> {
  const eMin = origin.x + tx * TILE_SIZE_M - 50;
  const nMax = origin.y - tz * TILE_SIZE_M + 50;
  const eMax = eMin + TILE_SIZE_M + 100;
  const nMin = nMax - TILE_SIZE_M - 100;
  const out: Seg[] = [];
  for (let start = 0; ; start += PAGE) {
    const url =
      `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:troncon_de_route&SRSNAME=EPSG:2154` +
      `&BBOX=${eMin},${nMin},${eMax},${nMax},EPSG:2154&COUNT=${PAGE}&STARTINDEX=${start}&SORTBY=cleabs&OUTPUTFORMAT=application/json`;
    const buf = await fetchCached(url, cachePath('bdtopo-route', `${eMin}_${nMin}_${eMax}_${nMax}_${start}`, '.json'), {
      timeoutMs: 120000,
      retries: 4,
      validate: (b) => (b[0] === 0x7b ? null : `pas du JSON : ${b.subarray(0, 120).toString()}`),
    });
    const fc = JSON.parse(buf.toString('utf8')) as {
      features: Array<{ properties: Record<string, unknown>; geometry: { type: string; coordinates: number[][] | number[][][] } | null }>;
    };
    for (const f of fc.features) {
      const pos = Number(f.properties.position_par_rapport_au_sol ?? 0);
      if (f.properties.fictif === true || !f.geometry) continue;
      const g = f.geometry;
      const lines = g.type === 'MultiLineString' ? (g.coordinates as number[][][]) : [g.coordinates as number[][]];
      for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
          const a = line[i - 1]!;
          const b = line[i]!;
          // Z absent ou sentinelle (−1000 = non renseigné)
          if (!(a[2]! > -900) || !(b[2]! > -900)) continue;
          out.push({ ax: a[0]! - origin.x, az: origin.y - a[1]!, ay: a[2]!, bx: b[0]! - origin.x, bz: origin.y - b[1]!, by: b[2]!, pos });
        }
      }
    }
    if (fc.features.length < PAGE) break;
  }
  return out;
}

/** Altitude BD TOPO au droit d'un point de notre axe (cap `dx, dz` normé), ou null. */
function zAt(segs: Seg[], x: number, z: number, dx: number, dz: number, want: -1 | 0 | 1): number | null {
  let best = MAX_DIST_M;
  let y: number | null = null;
  for (const s of segs) {
    if (Math.sign(s.pos) !== want) continue;
    const ux = s.bx - s.ax;
    const uz = s.bz - s.az;
    const L2 = ux * ux + uz * uz;
    if (L2 < 1e-6) continue;
    const L = Math.sqrt(L2);
    if (Math.abs((ux * dx + uz * dz) / L) < MIN_COS) continue;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * ux + (z - s.az) * uz) / L2));
    const d = Math.hypot(s.ax + ux * t - x, s.az + uz * t - z);
    if (d < best) {
      best = d;
      y = s.ay + (s.by - s.ay) * t;
    }
  }
  return y;
}

interface Result {
  tile: string;
  id: string;
  kind: string;
  name: string;
  what: 'pont' | 'tunnel';
  lenM: number;
  matched: number;
  /** Écart brut médian (BD TOPO − nous), m. */
  rawMedian: number;
  /** Plus grand écart de forme (m), signé : + = BD TOPO au-dessus de notre droite. */
  shapeMax: number;
  x: number;
  z: number;
}

const median = (a: number[]): number => {
  const s = [...a].sort((p, q) => p - q);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};
const pct = (a: number[], p: number): number => {
  const s = [...a].sort((u, v) => u - v);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))]! : NaN;
};

const results: Result[] = [];
/** Contrôle : BD TOPO − nous sur les routes au sol (m). */
const ground: number[] = [];
let total = 0;
let unmatched = 0;
for (const t of meta.tiles) {
  const file = path.join(tilesDir, `${t.id}.json`);
  if (!fs.existsSync(file)) continue;
  const tile = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    roads: Array<{ id: string; kind: string; name?: string; bridge?: boolean; tunnel?: boolean; pts: number[] }>;
  };
  const mine = tile.roads.filter((r) => (r.bridge || r.tunnel) && r.pts.length >= 6);
  if (!mine.length) continue;
  const segs = await structuresOfTile(t.tx, t.tz);
  // contrôle : routes au sol de la même tuile contre les tronçons BD TOPO au sol
  for (const r of tile.roads) {
    if (r.bridge || r.tunnel || !/^(primary|secondary|tertiary|unclassified|residential)$/.test(r.kind)) continue;
    for (let i = 3; i < r.pts.length; i += 3) {
      const dx = r.pts[i]! - r.pts[i - 3]!;
      const dz = r.pts[i + 2]! - r.pts[i - 1]!;
      const L = Math.hypot(dx, dz);
      if (L < 0.5) continue;
      const zb = zAt(segs, r.pts[i]!, r.pts[i + 2]!, dx / L, dz / L, 0);
      if (zb !== null) ground.push(zb - r.pts[i + 1]!);
    }
  }
  for (const r of mine) {
    total++;
    // rééchantillonnage tous les STEP_M le long de notre axe
    const samples: Array<{ s: number; d: number }> = [];
    let acc = 0;
    for (let i = 3; i < r.pts.length; i += 3) {
      const ax = r.pts[i - 3]!;
      const ay = r.pts[i - 2]!;
      const az = r.pts[i - 1]!;
      const bx = r.pts[i]!;
      const by = r.pts[i + 1]!;
      const bz = r.pts[i + 2]!;
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const n = Math.max(1, Math.round(L / STEP_M));
      for (let k = i === 3 ? 0 : 1; k <= n; k++) {
        const u = k / n;
        const zb = zAt(segs, ax + (bx - ax) * u, az + (bz - az) * u, (bx - ax) / L, (bz - az) / L, r.bridge ? 1 : -1);
        if (zb !== null) samples.push({ s: acc + L * u, d: zb - (ay + (by - ay) * u) });
      }
      acc += L;
    }
    if (samples.length < 2 || acc < 2 * STEP_M) {
      unmatched++;
      continue;
    }
    const a = samples[0]!;
    const b = samples[samples.length - 1]!;
    let shapeMax = 0;
    for (const p of samples) {
      const lin = a.d + ((b.d - a.d) * (p.s - a.s)) / Math.max(1e-6, b.s - a.s);
      if (Math.abs(p.d - lin) > Math.abs(shapeMax)) shapeMax = p.d - lin;
    }
    results.push({
      tile: t.id,
      id: r.id,
      kind: r.kind,
      name: r.name ?? '',
      what: r.bridge ? 'pont' : 'tunnel',
      lenM: acc,
      matched: samples.length,
      rawMedian: median(samples.map((p) => p.d)),
      shapeMax,
      x: r.pts[0]!,
      z: r.pts[2]!,
    });
  }
}

console.log(`${meta.id} : ${total} morceaux pont/tunnel dans les tuiles, ${results.length} appariés à la BD TOPO, ${unmatched} sans correspondance`);
console.log(
  `  contrôle routes au sol (${ground.length} points) : BD TOPO − nous — médiane ${median(ground).toFixed(2)} m, p10 ${pct(ground, 0.1).toFixed(2)} m, p90 ${pct(ground, 0.9).toFixed(2)} m`,
);
for (const what of ['pont', 'tunnel'] as const) {
  const rs = results.filter((r) => r.what === what);
  if (!rs.length) continue;
  const raw = rs.map((r) => Math.abs(r.rawMedian));
  const shape = rs.map((r) => Math.abs(r.shapeMax));
  console.log(
    `  ${what}s (${rs.length}) : écart brut |médian| — médiane ${median(raw).toFixed(2)} m, p90 ${pct(raw, 0.9).toFixed(2)} m, max ${Math.max(...raw).toFixed(2)} m ; ` +
      `écart de forme — médiane ${median(shape).toFixed(2)} m, p90 ${pct(shape, 0.9).toFixed(2)} m, max ${Math.max(...shape).toFixed(2)} m ; ` +
      `> 0,5 m brut : ${raw.filter((v) => v > 0.5).length}, > 0,3 m de forme : ${shape.filter((v) => v > 0.3).length}`,
  );
}
const worst = [...results].sort((p, q) => Math.max(Math.abs(q.rawMedian), Math.abs(q.shapeMax)) - Math.max(Math.abs(p.rawMedian), Math.abs(p.shapeMax))).slice(0, top);
console.log(`\nLes ${worst.length} plus grands écarts :`);
for (const r of worst)
  console.log(
    `  ${r.what.padEnd(6)} ${r.id.padEnd(28)} ${r.kind.padEnd(13)} ${r.lenM.toFixed(0).padStart(4)} m  brut ${r.rawMedian >= 0 ? '+' : ''}${r.rawMedian.toFixed(2)} m  forme ${r.shapeMax >= 0 ? '+' : ''}${r.shapeMax.toFixed(2)} m  ` +
      `tuile ${r.tile} (x ${r.x.toFixed(0)}, z ${r.z.toFixed(0)}) ${r.name}`,
  );

const jsonOut = arg('--json');
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
  console.log(`\nDétail écrit dans ${jsonOut}`);
}
