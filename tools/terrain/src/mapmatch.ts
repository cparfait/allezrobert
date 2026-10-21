/**
 * Recalage des traces GPS sur le graphe routier : arête la plus proche avec cohérence de cap
 * et préférence de continuité, puis comblement des trous par plus court chemin.
 * Produit pour chaque sortie la liste des arêtes parcourues (usage interne uniquement).
 */
import { angleDiff, projectOnSegment, type Pt } from './geom.ts';
import { dijkstra, pathTo, type RoadGraph } from './graph.ts';
import type { GpxPoint } from './gpx.ts';

export interface MatchedPoint {
  idx: number; // indice du point GPS
  edge: number;
  t: number; // position relative le long de l'arête (0 = nœud a)
  d: number; // distance au tracé (m)
}

export interface RideMatch {
  matched: MatchedPoint[];
  /** Arêtes parcourues (au moins à moitié ou via un comblement). */
  edges: Set<number>;
  /** Taux de points recalés. */
  matchRate: number;
}

const MAX_DIST = 25;

function edgeCandidate(g: RoadGraph, eid: number, x: number, z: number, hd: number): { d: number; t: number; angle: number } {
  const e = g.edges[eid]!;
  let best = { d: Infinity, t: 0, angle: 0 };
  let acc = 0;
  for (let i = 1; i < e.pts.length; i++) {
    const a = e.pts[i - 1]!;
    const b = e.pts[i]!;
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const p = projectOnSegment(x, z, a[0], a[1], b[0], b[1]);
    if (p.d < best.d) {
      const segHd = Math.atan2(b[1] - a[1], b[0] - a[0]);
      best = { d: p.d, t: (acc + p.t * seg) / Math.max(e.len, 1e-6), angle: Math.min(angleDiff(hd, segHd), angleDiff(hd, segHd + Math.PI)) };
    }
    acc += seg;
  }
  return best;
}

export function matchRide(g: RoadGraph, pts: GpxPoint[]): RideMatch {
  // cap local : sur ±10 m
  const n = pts.length;
  const headings = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let a = i;
    let b = i;
    while (a > 0 && Math.hypot(pts[i]!.x - pts[a]!.x, pts[i]!.z - pts[a]!.z) < 10) a--;
    while (b < n - 1 && Math.hypot(pts[i]!.x - pts[b]!.x, pts[i]!.z - pts[b]!.z) < 10) b++;
    headings[i] = Math.atan2(pts[b]!.z - pts[a]!.z, pts[b]!.x - pts[a]!.x);
  }
  const matched: MatchedPoint[] = [];
  let prev = -1;
  let lastKept: Pt | null = null;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    if (lastKept && Math.hypot(p.x - lastKept[0], p.z - lastKept[1]) < 3) continue; // arrêts
    lastKept = [p.x, p.z];
    let best: MatchedPoint | null = null;
    let bestScore = Infinity;
    for (const eid of g.index.query(p.x, p.z, MAX_DIST)) {
      const c = edgeCandidate(g, eid, p.x, p.z, headings[i]!);
      if (c.d > MAX_DIST) continue;
      let score = c.d + (c.angle > Math.PI / 4 ? 20 : (c.angle / (Math.PI / 4)) * 6);
      if (prev >= 0) {
        const pe = g.edges[prev]!;
        const e = g.edges[eid]!;
        if (eid === prev) score -= 5;
        else if (e.a === pe.a || e.a === pe.b || e.b === pe.a || e.b === pe.b) score -= 2;
      }
      if (score < bestScore) {
        bestScore = score;
        best = { idx: i, edge: eid, t: c.t, d: c.d };
      }
    }
    if (best) {
      matched.push(best);
      prev = best.edge;
    }
  }
  // couverture par arête
  const covered = new Map<number, { tMin: number; tMax: number }>();
  for (const m of matched) {
    const c = covered.get(m.edge);
    if (!c) covered.set(m.edge, { tMin: m.t, tMax: m.t });
    else {
      c.tMin = Math.min(c.tMin, m.t);
      c.tMax = Math.max(c.tMax, m.t);
    }
  }
  const edges = new Set<number>();
  for (const [eid, c] of covered) {
    const e = g.edges[eid]!;
    if ((c.tMax - c.tMin) * e.len >= Math.min(0.5 * e.len, e.len - 30) || e.len < 25) edges.add(eid);
  }
  // comblement des trous entre arêtes successives non adjacentes
  for (let k = 1; k < matched.length; k++) {
    const a = matched[k - 1]!;
    const b = matched[k]!;
    if (a.edge === b.edge) continue;
    const ea = g.edges[a.edge]!;
    const eb = g.edges[b.edge]!;
    if (ea.a === eb.a || ea.a === eb.b || ea.b === eb.a || ea.b === eb.b) {
      edges.add(a.edge);
      edges.add(b.edge);
      continue;
    }
    const gap = Math.hypot(pts[b.idx]!.x - pts[a.idx]!.x, pts[b.idx]!.z - pts[a.idx]!.z);
    if (gap > 300) continue;
    let bestPath: number[] | null = null;
    let bestCost = Infinity;
    for (const s of [ea.a, ea.b]) {
      const r = dijkstra(g, s, { cost: (e) => e.len, respectOneway: false, maxCost: gap * 2 + 60 });
      for (const t of [eb.a, eb.b]) {
        const c = r.dist.get(t);
        if (c !== undefined && c < bestCost) {
          bestCost = c;
          bestPath = pathTo(g, r, s, t);
        }
      }
    }
    if (bestPath && bestCost < gap * 2 + 60) for (const eid of bestPath) edges.add(eid);
  }
  return { matched, edges, matchRate: matched.length / Math.max(1, n) };
}
