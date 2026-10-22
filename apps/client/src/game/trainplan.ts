import type { RouteTrack } from '@allezrobert/shared';

/** Voie ferrée continue (x, z à plat), longueur cumulée par point. */
export interface Rail {
  id: number;
  pts: number[];
  cum: number[];
  length: number;
}

/** Point de déclenchement : là où l'itinéraire passe au plus près d'une voie. */
export interface TrainTrigger {
  /** Distance sur l'itinéraire du point le plus proche (m). */
  d: number;
  rail: number;
  /** Abscisse sur la voie du point le plus proche (m). */
  railS: number;
  /** Distance entre la route et la voie à cet endroit (m). */
  gapM: number;
}

function cumulative(pts: number[]): number[] {
  const cum = [0];
  for (let i = 2; i < pts.length; i += 2) {
    cum.push((cum[cum.length - 1] as number) + Math.hypot((pts[i] as number) - (pts[i - 2] as number), (pts[i + 1] as number) - (pts[i - 1] as number)));
  }
  return cum;
}

/**
 * Raccorde les morceaux d'une même voie OSM découpés aux bords des tuiles (extrémités communes
 * à 1 cm près) en polylignes continues.
 */
export function mergeRailPieces(pieces: Array<{ id: number; pts: number[] }>): Rail[] {
  const byId = new Map<number, number[][]>();
  for (const p of pieces) {
    if (p.pts.length < 4) continue;
    let l = byId.get(p.id);
    if (!l) byId.set(p.id, (l = []));
    l.push(p.pts.slice());
  }
  const same = (a: number[], i: number, b: number[], j: number) => Math.abs((a[i] as number) - (b[j] as number)) < 0.02 && Math.abs((a[i + 1] as number) - (b[j + 1] as number)) < 0.02;
  const out: Rail[] = [];
  for (const [id, list] of byId) {
    const left = list.slice();
    while (left.length) {
      let cur = left.shift() as number[];
      let grown = true;
      while (grown) {
        grown = false;
        for (let k = 0; k < left.length; k++) {
          const o = left[k] as number[];
          const n = cur.length;
          const m = o.length;
          if (same(cur, n - 2, o, 0)) cur = [...cur, ...o.slice(2)];
          else if (same(cur, n - 2, o, m - 2)) cur = [...cur, ...reverse(o).slice(2)];
          else if (same(cur, 0, o, m - 2)) cur = [...o, ...cur.slice(2)];
          else if (same(cur, 0, o, 0)) cur = [...reverse(o), ...cur.slice(2)];
          else continue;
          left.splice(k, 1);
          grown = true;
          break;
        }
      }
      const cum = cumulative(cur);
      out.push({ id, pts: cur, cum, length: cum[cum.length - 1] as number });
    }
  }
  return out;
}

function reverse(pts: number[]): number[] {
  const r: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) r.push(pts[i] as number, pts[i + 1] as number);
  return r;
}

/** Position et direction à l'abscisse `s` d'une voie (bornée à ses extrémités). */
export function railAt(rail: Rail, s: number): { x: number; z: number; dx: number; dz: number } {
  const t = Math.min(Math.max(s, 0), rail.length);
  let i = 0;
  while (i + 1 < rail.cum.length - 1 && (rail.cum[i + 1] as number) < t) i++;
  const a = i * 2;
  const x0 = rail.pts[a] as number;
  const z0 = rail.pts[a + 1] as number;
  const x1 = (rail.pts[a + 2] ?? x0) as number;
  const z1 = (rail.pts[a + 3] ?? z0) as number;
  const seg = Math.max((rail.cum[i + 1] ?? 0) - (rail.cum[i] as number), 1e-6);
  const f = (t - (rail.cum[i] as number)) / seg;
  const len = Math.hypot(x1 - x0, z1 - z0) || 1;
  return { x: x0 + (x1 - x0) * f, z: z0 + (z1 - z0) * f, dx: (x1 - x0) / len, dz: (z1 - z0) / len };
}

/**
 * Points de déclenchement : pour chaque voie, les endroits où l'itinéraire passe à moins de
 * `maxGapM` (au plus un par kilomètre d'itinéraire et par voie, le plus proche).
 */
export function planTriggers(track: RouteTrack, rails: Rail[], maxGapM = 250): TrainTrigger[] {
  const out: TrainTrigger[] = [];
  const sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  rails.forEach((rail, ri) => {
    if (rail.length < 300) return;
    let best: TrainTrigger | null = null;
    for (let d = 0; d <= track.length; d += 10) {
      const p = track.sample(d, sample);
      let gap = Infinity;
      let railS = 0;
      for (let i = 0; i + 3 < rail.pts.length; i += 2) {
        const ax = rail.pts[i] as number;
        const az = rail.pts[i + 1] as number;
        const bx = rail.pts[i + 2] as number;
        const bz = rail.pts[i + 3] as number;
        const vx = bx - ax;
        const vz = bz - az;
        const l2 = vx * vx + vz * vz;
        const t = l2 > 0 ? Math.min(Math.max(((p.x - ax) * vx + (p.z - az) * vz) / l2, 0), 1) : 0;
        const g = Math.hypot(ax + t * vx - p.x, az + t * vz - p.z);
        if (g < gap) {
          gap = g;
          railS = (rail.cum[i / 2] as number) + t * Math.sqrt(l2);
        }
      }
      if (gap > maxGapM) {
        if (best) out.push(best);
        best = null;
        continue;
      }
      if (best && d - best.d > 1000) {
        out.push(best);
        best = null;
      }
      if (!best || gap < best.gapM) best = { d, rail: ri, railS, gapM: gap };
    }
    if (best) out.push(best);
  });
  return out.sort((a, b) => a.d - b.d);
}
