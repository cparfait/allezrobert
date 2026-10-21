/**
 * Recherche de boucles sur le graphe routier : énumération de cycles simples par paires de
 * carrefours (plus court chemin aller, puis retour disjoint), notation rapide sur MNT, puis
 * notation fine (côtes/sprints sur le profil lissé) des meilleurs candidats.
 */
import { worldToL93 } from './frame.ts';
import { cumulative, resampleClosed, signedArea, smooth1d, type Box, type Pt } from './geom.ts';
import { dijkstra, pathNodes, pathTo, type Edge, type RoadGraph } from './graph.ts';
import type { DemStack } from './dem.ts';
import { detectClimbs, detectSprints } from './profile.ts';
import type { Poi } from './osm.ts';

export interface DirectedCycle {
  start: number; // nœud de départ
  edges: number[]; // dans l'ordre de parcours
  nodes: number[]; // nœuds traversés (start répété à la fin)
}

export interface LoopSearchOptions {
  area: Box;
  minLen: number;
  maxLen: number;
  targetLen: number;
  /** Lieux à valoriser (noms de communes) */
  keyPlaces: string[];
  maxHubs?: number;
  pairsPerHub?: number;
  minPairDist?: number;
  maxPairDist?: number;
  seed?: number;
  /** Arêtes à éviter (déjà utilisées par une autre boucle), pénalisées. */
  avoidEdges?: Set<number>;
}

export interface CycleScore {
  cycle: DirectedCycle;
  lengthM: number;
  ridden: number;
  freq: number;
  busy: number;
  klimbs: number;
  bestClimbGain: number;
  sprints: number;
  villages: string[];
  compactness: number;
  /** Note hors segments (fréquentation, trafic, longueur, villages, forme). */
  base: number;
  score: number;
}

/** Bonus de segments : une vraie côte et un sprint sont attendus. */
export function segmentBonus(nClimbs: number, bestGain: number, nSprints: number): number {
  let s = nClimbs ? 2 + Math.min(2, bestGain / 40) + 0.3 * Math.min(2, nClimbs - 1) : -3;
  s += nSprints ? 1.5 : -1.5;
  return s;
}

/** Arête utilisable pour une boucle vélo ? */
export function bikeable(e: Edge): boolean {
  const k = e.road.kind;
  if (!e.road.paved) return false;
  if (/^(motorway|trunk)(_link)?$/.test(k)) return false;
  if (['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'primary_link', 'secondary_link', 'tertiary_link'].includes(k)) return true;
  if (k === 'cycleway') return true;
  if (k === 'service') return e.rides > 0;
  return false;
}

export function busyWeight(kind: string): number {
  if (kind.startsWith('primary')) return 1;
  if (kind.startsWith('secondary')) return 0.35;
  if (kind.startsWith('tertiary')) return 0.08;
  return 0;
}

export function edgeCost(e: Edge, avoid?: Set<number>): number {
  if (!bikeable(e)) return Infinity;
  let f = 1;
  if (e.rides > 0) f *= 0.55 - 0.06 * Math.min(e.rides - 1, 3);
  f *= 1 + 2.5 * busyWeight(e.road.kind);
  if (e.road.kind === 'cycleway') f *= 1.3;
  if (e.road.kind === 'service') f *= 1.5;
  if (avoid?.has(e.id)) f *= 3;
  return e.len * f;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inBox(p: Pt, b: Box): boolean {
  return p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minZ && p[1] <= b.maxZ;
}

/** Polyligne monde d'un cycle orienté (sans répétition du premier point). */
export function cyclePolyline(g: RoadGraph, c: DirectedCycle): { pts: Pt[]; edgeOf: number[] } {
  const pts: Pt[] = [];
  const edgeOf: number[] = [];
  let n = c.start;
  for (const eid of c.edges) {
    const e = g.edges[eid]!;
    const o = g.orientedPts(e, n);
    for (let i = 0; i < o.length - 1; i++) {
      pts.push(o[i]!);
      edgeOf.push(eid);
    }
    n = g.other(e, n);
  }
  return { pts, edgeOf };
}

export function enumerateCycles(g: RoadGraph, o: LoopSearchOptions): DirectedCycle[] {
  const rand = rng(o.seed ?? 42);
  const inArea = (n: number) => inBox(g.nodePos.get(n)!, o.area);
  // carrefours candidats : degré ≥ 3, une arête parcourue de préférence, un par maille de 250 m
  const cell = new Map<string, { n: number; s: number }>();
  for (const [n, list] of g.adj) {
    if (list.length < 3 || !inArea(n)) continue;
    const es = list.map((id) => g.edges[id]!).filter(bikeable);
    if (es.length < 3) continue;
    const ridden = es.filter((e) => e.rides > 0).length;
    const p = g.nodePos.get(n)!;
    const key = `${Math.floor(p[0] / 250)}_${Math.floor(p[1] / 250)}`;
    const s = ridden * 10 + rand();
    const cur = cell.get(key);
    if (!cur || s > cur.s) cell.set(key, { n, s });
  }
  let hubs = [...cell.values()].sort((a, b) => b.s - a.s).map((h) => h.n);
  hubs = hubs.slice(0, o.maxHubs ?? 220);
  const minD = o.minPairDist ?? o.minLen / 6;
  const maxD = o.maxPairDist ?? o.maxLen / 2.4;
  const seen = new Set<string>();
  const cycles: DirectedCycle[] = [];
  const variants: Array<(e: Edge) => number> = [
    (e) => edgeCost(e, o.avoidEdges),
    (() => {
      const jit = new Map<number, number>();
      return (e: Edge) => {
        let j = jit.get(e.id);
        if (j === undefined) jit.set(e.id, (j = 0.7 + rand() * 0.7));
        return edgeCost(e, o.avoidEdges) * j;
      };
    })(),
    (e) => (bikeable(e) ? e.len * (1 + 2.5 * busyWeight(e.road.kind)) * (o.avoidEdges?.has(e.id) ? 3 : 1) : Infinity),
  ];
  const areaEdge = (e: Edge) => inArea(e.a) && inArea(e.b);
  for (const cost0 of variants) {
    const cost = (e: Edge) => (areaEdge(e) ? cost0(e) : Infinity);
    for (const A of hubs) {
      const pa = g.nodePos.get(A)!;
      const tree = dijkstra(g, A, { cost });
      const partners = hubs.filter((B) => {
        if (B === A) return false;
        const pb = g.nodePos.get(B)!;
        const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
        return d >= minD && d <= maxD && tree.dist.has(B);
      });
      // échantillon aléatoire de partenaires
      for (let i = partners.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [partners[i], partners[j]] = [partners[j]!, partners[i]!];
      }
      for (const B of partners.slice(0, o.pairsPerHub ?? 18)) {
        const p1 = pathTo(g, tree, A, B);
        if (!p1 || !p1.length) continue;
        const n1 = pathNodes(g, A, p1);
        const bannedNodes = new Set(n1.slice(1, -1));
        const bannedEdges = new Set(p1);
        const r2 = dijkstra(g, B, { cost, bannedEdges, bannedNodes, target: A });
        const p2 = pathTo(g, r2, B, A);
        if (!p2 || !p2.length) continue;
        const edges = [...p1, ...p2];
        let len = 0;
        for (const e of edges) len += g.edges[e]!.len;
        if (len < o.minLen || len > o.maxLen) continue;
        const key = [...edges].sort((a, b) => a - b).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        const c: DirectedCycle = { start: A, edges, nodes: pathNodes(g, A, edges) };
        cycles.push(c);
        // sens inverse si les sens uniques le permettent
        const rev = reverseCycle(g, c);
        if (rev) cycles.push(rev);
      }
    }
  }
  return cycles;
}

export function reverseCycle(g: RoadGraph, c: DirectedCycle): DirectedCycle | null {
  const edges = c.edges.slice().reverse();
  const nodes = c.nodes.slice().reverse();
  for (let i = 0; i < edges.length; i++) if (!g.canTraverse(g.edges[edges[i]!]!, nodes[i]!)) return null;
  return { start: c.start, edges, nodes };
}

/** Profil rapide (pas ~10 m) d'un cycle sur le MNT. */
export function quickProfile(g: RoadGraph, c: DirectedCycle, dem: DemStack, step = 10): { xs: number[]; zs: number[]; hs: number[]; step: number; edgeOf: number[] } {
  const poly = cyclePolyline(g, c);
  const cum = cumulative([...poly.pts, poly.pts[0]!]);
  const r = resampleClosed(poly.pts, step);
  const xs = r.pts.map((p) => p[0]);
  const zs = r.pts.map((p) => p[1]);
  const raw = r.pts.map((p) => {
    const l = worldToL93(p[0], p[1]);
    return dem.sample(l.e, l.n);
  });
  // arête de chaque échantillon (par abscisse curviligne)
  const edgeOf: number[] = [];
  let k = 0;
  for (let i = 0; i < r.pts.length; i++) {
    const s = i * r.step;
    while (k < poly.pts.length - 1 && cum[k + 1]! <= s) k++;
    edgeOf.push(poly.edgeOf[k]!);
  }
  const hs = smooth1d(raw.map((v) => (Number.isFinite(v) ? v : 0)), 20 / r.step, true);
  return { xs, zs, hs, step: r.step, edgeOf };
}

/** Rotation d'un profil circulaire pour démarrer au point le plus bas (aucune côte coupée). */
function rotateToMin<T>(arrs: T[][], hs: number[]): { arrs: T[][]; hs: number[]; offset: number } {
  let m = 0;
  for (let i = 1; i < hs.length; i++) if (hs[i]! < hs[m]!) m = i;
  const rot = <U>(a: U[]) => [...a.slice(m), ...a.slice(0, m)];
  return { arrs: arrs.map(rot), hs: rot(hs), offset: m };
}

export function scoreCycle(g: RoadGraph, c: DirectedCycle, dem: DemStack, pois: Poi[], o: LoopSearchOptions): CycleScore {
  let len = 0;
  let ridden = 0;
  let freq = 0;
  let busy = 0;
  for (const eid of c.edges) {
    const e = g.edges[eid]!;
    len += e.len;
    if (e.rides > 0) ridden += e.len;
    freq += e.len * Math.min(e.rides, 3);
    busy += e.len * busyWeight(e.road.kind);
  }
  ridden /= len;
  freq /= 3 * len;
  busy /= len;
  const prof = quickProfile(g, c, dem);
  const rot = rotateToMin([prof.xs, prof.zs], prof.hs);
  const [xs, zs] = rot.arrs as [number[], number[]];
  const climbs = detectClimbs(rot.hs, prof.step);
  const sprints = detectSprints(xs, zs, rot.hs, prof.step, true, climbs.map((k) => [k.startIdx, k.endIdx]));
  const poly = xs.map((x, i) => [x, zs[i]!] as Pt);
  const area = Math.abs(signedArea(poly));
  const compactness = (4 * Math.PI * area) / (len * len);
  const villages: string[] = [];
  for (const name of o.keyPlaces) {
    const p = pois.find((q) => q.name === name && /^(village|town|hamlet|suburb)$/.test(q.kind));
    if (!p) continue;
    let dmin = Infinity;
    for (let i = 0; i < xs.length; i += 2) dmin = Math.min(dmin, Math.hypot(xs[i]! - p.x, zs[i]! - p.z));
    if (dmin < 400) villages.push(name);
  }
  const best = climbs.reduce((m, k) => Math.max(m, k.gainM), 0);
  let base = 4 * ridden + 2 * freq - 3 * busy;
  base -= (Math.abs(len - o.targetLen) / 1000) * (0.4 * 10000 / o.targetLen);
  base += 0.3 * Math.min(4, villages.length);
  base += compactness < 0.08 ? -2 : 0.5 * Math.min(compactness, 0.6);
  const score = base + segmentBonus(climbs.length, best, sprints.length);
  return { cycle: c, lengthM: len, ridden, freq, busy, klimbs: climbs.length, bestClimbGain: best, sprints: sprints.length, villages, compactness, base, score };
}
