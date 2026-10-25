import type { TileRoad } from './types.ts';

/** Voies non dessinées (sentiers, escaliers, pistes cyclables hors monde ouvert…) : même liste que `RoadNetwork`. */
const NOT_DRAWN = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'pedestrian', 'corridor', 'platform']);
/** Largeur minimale de chaussée dessinée (m) et bas-côté fondu, comme dans `RoadNetwork`. */
const MIN_WIDTH = 2.5;
const SHOULDER = 0.6;
/** Marge maximale prise en compte à l'indexation (m) : les appels demandent une marge ≤ à cette valeur. */
const MAX_MARGIN = 2;
const CELL = 16;

export interface AvoidRoad {
  /** Polyligne plate x,z. */
  pts: number[];
  /** Demi-largeur de chaussée, bas-côté compris (m). */
  half: number;
}

/** Routes d'une tuile qui sont dessinées (donc où un arbre n'a rien à faire), avec leur demi-largeur. */
export function drawnRoads(roads: readonly TileRoad[], drawCycleways = false): AvoidRoad[] {
  const out: AvoidRoad[] = [];
  for (const r of roads) {
    if (r.tunnel || r.pts.length < 4) continue;
    if (NOT_DRAWN.has(r.kind) && !(drawCycleways && r.kind === 'cycleway')) continue;
    out.push({ pts: r.pts, half: Math.max(r.width, MIN_WIDTH) / 2 + SHOULDER });
  }
  return out;
}

/**
 * Test « (x, z) est sur une route ou à moins de `margin` m de son bord » : distance aux segments des
 * polylignes, indexés dans une grille de hachage (pas la distance aux seuls sommets, qui laisse passer
 * un arbre entre deux sommets d'un long segment).
 */
export function roadAvoidance(roads: readonly AvoidRoad[]): (x: number, z: number, margin?: number) => boolean {
  const segs: number[] = [];
  const halves: number[] = [];
  const grid = new Map<string, number[]>();
  for (const r of roads) {
    const reach = r.half + MAX_MARGIN;
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const ax = r.pts[i] as number;
      const az = r.pts[i + 1] as number;
      const bx = r.pts[i + 2] as number;
      const bz = r.pts[i + 3] as number;
      const id = halves.length;
      segs.push(ax, az, bx, bz);
      halves.push(r.half);
      const x0 = Math.floor((Math.min(ax, bx) - reach) / CELL);
      const x1 = Math.floor((Math.max(ax, bx) + reach) / CELL);
      const z0 = Math.floor((Math.min(az, bz) - reach) / CELL);
      const z1 = Math.floor((Math.max(az, bz) + reach) / CELL);
      for (let cx = x0; cx <= x1; cx++)
        for (let cz = z0; cz <= z1; cz++) {
          const k = `${cx},${cz}`;
          let a = grid.get(k);
          if (!a) grid.set(k, (a = []));
          a.push(id);
        }
    }
  }
  return (x, z, margin = 0) => {
    const ids = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!ids) return false;
    for (const id of ids) {
      const ax = segs[id * 4] as number;
      const az = segs[id * 4 + 1] as number;
      const dx = (segs[id * 4 + 2] as number) - ax;
      const dz = (segs[id * 4 + 3] as number) - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / len2, 0), 1) : 0;
      const ex = x - (ax + t * dx);
      const ez = z - (az + t * dz);
      const lim = (halves[id] as number) + margin;
      if (ex * ex + ez * ez < lim * lim) return true;
    }
    return false;
  };
}

/** Portée maximale de `roadClearance` (m) : au-delà, aucune route n'est vue. */
const CLEARANCE_REACH = 12;

/**
 * Dégagement d'un point par rapport aux routes : distance au bord de chaussée le plus proche (négative
 * sur la chaussée) et direction unitaire qui s'en éloigne, ou null si aucune route à moins de
 * CLEARANCE_REACH m du bord. Sert à garder les houppiers hors de la chaussée.
 */
export function roadClearance(roads: readonly AvoidRoad[]): (x: number, z: number) => { d: number; nx: number; nz: number } | null {
  const segs: number[] = [];
  const halves: number[] = [];
  const grid = new Map<string, number[]>();
  for (const r of roads) {
    const reach = r.half + CLEARANCE_REACH;
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const ax = r.pts[i] as number;
      const az = r.pts[i + 1] as number;
      const bx = r.pts[i + 2] as number;
      const bz = r.pts[i + 3] as number;
      const id = halves.length;
      segs.push(ax, az, bx, bz);
      halves.push(r.half);
      const x0 = Math.floor((Math.min(ax, bx) - reach) / CELL);
      const x1 = Math.floor((Math.max(ax, bx) + reach) / CELL);
      const z0 = Math.floor((Math.min(az, bz) - reach) / CELL);
      const z1 = Math.floor((Math.max(az, bz) + reach) / CELL);
      for (let cx = x0; cx <= x1; cx++)
        for (let cz = z0; cz <= z1; cz++) {
          const k = `${cx},${cz}`;
          let a = grid.get(k);
          if (!a) grid.set(k, (a = []));
          a.push(id);
        }
    }
  }
  return (x, z) => {
    const ids = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!ids) return null;
    let best: { d: number; nx: number; nz: number } | null = null;
    for (const id of ids) {
      const ax = segs[id * 4] as number;
      const az = segs[id * 4 + 1] as number;
      const dx = (segs[id * 4 + 2] as number) - ax;
      const dz = (segs[id * 4 + 3] as number) - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / len2, 0), 1) : 0;
      const ex = x - (ax + t * dx);
      const ez = z - (az + t * dz);
      const dist = Math.hypot(ex, ez);
      const d = dist - (halves[id] as number);
      if (d > CLEARANCE_REACH || (best && d >= best.d)) continue;
      // sur l'axe même : direction quelconque perpendiculaire au segment
      const len = Math.sqrt(len2) || 1;
      best = dist > 1e-3 ? { d, nx: ex / dist, nz: ez / dist } : { d, nx: -dz / len, nz: dx / len };
    }
    return best;
  };
}
