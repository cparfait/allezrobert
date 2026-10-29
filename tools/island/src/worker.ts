/**
 * Fil de calcul du générateur (voir pool.ts) : altitudes de la grille de tracé, et pour chaque tuile les
 * grilles d'altitude (.lo/.hi.u16) et les contours des bois, landes et rochers.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parentPort } from 'node:worker_threads';
import { deltaEncodeU16 } from '../../../packages/shared/src/heights.ts';
import { terrain, type Vec2 } from './design.ts';
import type { Vec3 } from './geom.ts';
import { contours, forestKind, forestMask, heathMask, rockMask, type LandCtx } from './land.ts';
import { RoadIndex, finalHeight, type Road } from './roads.ts';

let idx: RoadIndex | null = null;
let ctx: LandCtx = { farms: [] };

interface SerialRoad {
  pts: number[];
  loop: boolean;
  flat: number;
  blend: number;
  width: number;
  kind: string;
}

parentPort!.on('message', (job: Record<string, unknown>) => {
  switch (job.type) {
    case 'init': {
      const roads = (job.roads as SerialRoad[]).map((s) => {
        const pts: Vec3[] = [];
        for (let i = 0; i < s.pts.length; i += 3) pts.push([s.pts[i]!, s.pts[i + 1]!, s.pts[i + 2]!]);
        return { id: '', name: '', kind: s.kind, width: s.width, surface: '', loop: s.loop, pts, flat: s.flat, blend: s.blend, gmax: 0 } satisfies Road;
      });
      idx = new RoadIndex(roads);
      ctx = { farms: job.farms as Vec2[] };
      parentPort!.postMessage('ok');
      break;
    }
    case 'grid': {
      const { x0, z0, n, j0, j1, cell } = job as unknown as { x0: number; z0: number; n: number; j0: number; j1: number; cell: number };
      const out = new Float32Array((j1 - j0) * n);
      for (let j = j0; j < j1; j++) for (let i = 0; i < n; i++) out[(j - j0) * n + i] = terrain(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell);
      parentPort!.postMessage(out, [out.buffer]);
      break;
    }
    case 'tile':
      parentPort!.postMessage(tile(job as unknown as TileJob));
      break;
  }
});

interface TileJob {
  id: string;
  minX: number;
  minZ: number;
  size: number;
  dir: string;
}

function tile(j: TileJob) {
  const height = (x: number, z: number) => (idx ? finalHeight(idx, x, z) : terrain(x, z));
  const grid = (res: number) => {
    const n = j.size / res;
    const h = new Float32Array((n + 1) * (n + 1));
    for (let r = 0; r <= n; r++)
      for (let c = 0; c <= n; c++) {
        const x = j.minX + c * res;
        const z = j.minZ + r * res;
        let v = height(x, z);
        // Grille grossière (8 m, au loin) : sommets à moins d'une case du bord d'une route posés à son niveau.
        // Sinon le sol interpolé entre deux sommets passe au-dessus d'une route en tranchée, que le jeu prend
        // alors pour un tunnel (herbe sur la chaussée).
        if (res > 2 && idx) {
          const q = idx.query(x, z);
          if (q && q.d <= q.r.width / 2 + res) v = Math.min(v, q.y - 0.1);
        }
        h[r * (n + 1) + c] = v;
      }
    return { n, h };
  };
  const lo = grid(8);
  let lMin = Infinity;
  let lMax = -Infinity;
  for (const v of lo.h) {
    lMin = Math.min(lMin, v);
    lMax = Math.max(lMax, v);
  }
  // Pleine mer : grille grossière seule.
  const land = lMax > -0.5;
  const hi = land ? grid(2) : null;
  let min = lMin;
  let max = lMax;
  if (hi)
    for (const v of hi.h) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  const baseM = Math.floor(min) - 1;
  const stepM = 0.01;
  const enc = (g: { n: number; h: Float32Array }) => {
    const N = g.n + 1;
    const q = new Uint16Array(N * N);
    for (let k = 0; k < N * N; k++) q[k] = Math.max(0, Math.min(65535, Math.round((g.h[k]! - baseM) / stepM)));
    deltaEncodeU16(q, g.n);
    return Buffer.from(q.buffer);
  };
  const loBuf = enc(lo);
  writeFileSync(join(j.dir, `${j.id}.lo.u16`), loBuf);
  let bytes = loBuf.length;
  if (hi) {
    const hiBuf = enc(hi);
    writeFileSync(join(j.dir, `${j.id}.hi.u16`), hiBuf);
    bytes += hiBuf.length;
  }
  // Bois, landes, rochers : jamais sur la chaussée (couloir de 5 m de part et d'autre).
  const corridor = (x: number, z: number) => (idx ? (idx.edgeDist(x, z) - 7) / 2 : 1);
  const forests: Array<{ kind: string; rings: Vec2[][] }> = [];
  let heath: Vec2[][] = [];
  let rock: Vec2[][] = [];
  if (land) {
    const fr = contours((x, z) => Math.min(forestMask(x, z, ctx), corridor(x, z)), j.minX, j.minZ, j.size, 8);
    // Essence de la tuile (les trous d'une forêt restent avec leur contour, remplissage pair-impair).
    if (fr.length) forests.push({ kind: forestKind(j.minX + j.size / 2, j.minZ + j.size / 2), rings: fr });
    heath = contours((x, z) => Math.min(heathMask(x, z), corridor(x, z)), j.minX, j.minZ, j.size, 10);
    rock = contours((x, z) => Math.min(rockMask(x, z), corridor(x, z)), j.minX, j.minZ, j.size, 10);
  }
  return { min, max, baseM, hi: !!hi, bytes, forests, heath, rock };
}
