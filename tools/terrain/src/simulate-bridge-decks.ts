/**
 * Simulation (lecture seule) de la correction des extrémités de ponts sur un monde déjà construit :
 * applique `deckVerdict` aux ponts tels qu'ils sont dans les tuiles, sans rien réécrire.
 *
 * `npx tsx tools/terrain/src/simulate-bridge-decks.ts --world <id> [--all]`
 */
import fs from 'node:fs';
import path from 'node:path';
import type { WorldMeta } from '@allezrobert/shared';
import { approachOk, DECK_MIN_LIFT_M, deckStations, deckVerdict, fetchBdTopoSegs, type BdSeg } from './bridge-decks.ts';
import { OUT_DIR, TILE_SIZE_M } from './config.ts';
import { worldToL93 } from './frame.ts';
import type { Pt } from './geom.ts';
import { fetchRaster, LAYER_MNS, rasterAt } from './lidar.ts';

const meta = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'world.json'), 'utf8')) as WorldMeta;
const showAll = process.argv.includes('--all');
const DRIVABLE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$/;

const segCache = new Map<string, BdSeg[]>();
const counts = new Map<string, number>();
const lifted: string[] = [];
for (const t of meta.tiles) {
  const file = path.join(OUT_DIR, 'tiles', `${t.id}.json`);
  if (!fs.existsSync(file)) continue;
  const tile = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    roads: Array<{ id: string; kind: string; name?: string; width: number; bridge?: boolean; pts: number[] }>;
  };
  for (const r of tile.roads) {
    if (!r.bridge || !DRIVABLE.test(r.kind) || r.pts.length < 6) continue;
    const pts: Pt[] = [];
    for (let i = 0; i < r.pts.length; i += 3) pts.push([r.pts[i]!, r.pts[i + 2]!]);
    const ya = r.pts[1]!;
    const yb = r.pts[r.pts.length - 2]!;
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const m = r.width / 2 + 8;
    const lo = worldToL93(Math.min(...xs) - m, Math.max(...zs) + m);
    const hi = worldToL93(Math.max(...xs) + m, Math.min(...zs) - m);
    const mns = await fetchRaster(LAYER_MNS, lo.e, lo.n, hi.e, hi.n);
    const segs: BdSeg[] = [];
    for (let tx = Math.floor(Math.min(...xs) / TILE_SIZE_M); tx <= Math.floor(Math.max(...xs) / TILE_SIZE_M); tx++)
      for (let tz = Math.floor(Math.min(...zs) / TILE_SIZE_M); tz <= Math.floor(Math.max(...zs) / TILE_SIZE_M); tz++) {
        const k = `${tx}_${tz}`;
        if (!segCache.has(k)) segCache.set(k, (await fetchBdTopoSegs(tx, tz, (meta as unknown as { originL93: { x: number; y: number } }).originL93)).filter((q) => q.pos > 0));
        segs.push(...segCache.get(k)!);
      }
    const st = deckStations(pts, r.width / 2, (x, z) => {
      const l = worldToL93(x, z);
      return rasterAt(mns, l.e, l.n);
    }, segs);
    let v = deckVerdict(st, ya, yb);
    // voies d'accès : morceaux non-ponts de la tuile qui partagent une extrémité (longueur sous-estimée au bord de tuile : prudent)
    if (v.ok) {
      const lensAt = (x: number, z: number) =>
        tile.roads
          .filter((q) => !q.bridge && q.pts.length >= 6)
          .filter((q) => Math.hypot(q.pts[0]! - x, q.pts[2]! - z) < 0.5 || Math.hypot(q.pts[q.pts.length - 3]! - x, q.pts[q.pts.length - 1]! - z) < 0.5)
          .map((q) => {
            let L = 0;
            for (let i = 3; i < q.pts.length; i += 3) L += Math.hypot(q.pts[i]! - q.pts[i - 3]!, q.pts[i + 2]! - q.pts[i - 1]!);
            return L;
          });
      const okA = v.liftA <= DECK_MIN_LIFT_M || approachOk(v.liftA, lensAt(pts[0]![0], pts[0]![1]));
      const okB = v.liftB <= DECK_MIN_LIFT_M || approachOk(v.liftB, lensAt(pts[pts.length - 1]![0], pts[pts.length - 1]![1]));
      if (!okA || !okB) v = { ok: false, reason: 'accès trop raide' as never };
    }
    const key = v.ok ? 'relevé' : v.reason;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const len = st.length ? st[st.length - 1]!.s : 0;
    const line = `  ${r.id.padEnd(14)} ${r.kind.padEnd(12)} ${len.toFixed(0).padStart(4)} m  ${ya.toFixed(1)} → ${yb.toFixed(1)}  ${
      v.ok
        ? `relevé : ${(v.liftA > DECK_MIN_LIFT_M ? v.ha : ya).toFixed(1)} → ${(v.liftB > DECK_MIN_LIFT_M ? v.hb : yb).toFixed(1)} (+${Math.max(0, v.liftA).toFixed(1)} / +${Math.max(0, v.liftB).toFixed(1)} m)`
        : v.reason
    }  ${r.name ?? ''}`;
    if (v.ok) lifted.push(line);
    else if (showAll && v.reason !== 'déjà au niveau') lifted.push(line);
  }
}
console.log(`${meta.id} : ${[...counts.values()].reduce((a, b) => a + b, 0)} ponts carrossables — ${[...counts].map(([k, n]) => `${k} ${n}`).join(', ')}`);
for (const l of lifted) console.log(l);
