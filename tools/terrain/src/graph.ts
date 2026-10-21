/**
 * Graphe routier construit à partir des voies OSM : les voies sont coupées aux nœuds partagés
 * (carrefours) ; chaque arête porte la géométrie monde et la voie d'origine.
 */
import { GridIndex, bboxOf, polylineLength, type Pt } from './geom.ts';
import type { RoadWay } from './osm.ts';

export interface Edge {
  id: number;
  a: number; // nœud OSM de départ
  b: number; // nœud OSM d'arrivée
  road: RoadWay;
  pts: Pt[];
  len: number;
  /** 1 : seulement a→b, −1 : seulement b→a, 0 : les deux. */
  oneway: number;
  /** Nombre de sorties Garmin passées par cette arête (rempli par le recalage). */
  rides: number;
  /** Nombre total de passages. */
  passes: number;
}

export class RoadGraph {
  edges: Edge[] = [];
  adj = new Map<number, number[]>();
  nodePos = new Map<number, Pt>();
  index = new GridIndex<number>(60);

  constructor(roads: RoadWay[], filter: (r: RoadWay) => boolean) {
    const use = new Map<number, number>();
    const kept = roads.filter(filter);
    for (const r of kept) {
      r.nodes.forEach((n, i) => {
        use.set(n, (use.get(n) ?? 0) + (i === 0 || i === r.nodes.length - 1 ? 2 : 1));
      });
    }
    for (const r of kept) {
      let start = 0;
      for (let i = 1; i < r.nodes.length; i++) {
        const isCut = i === r.nodes.length - 1 || (use.get(r.nodes[i]!) ?? 0) >= 2;
        if (!isCut) continue;
        const pts = r.pts.slice(start, i + 1);
        const a = r.nodes[start]!;
        const b = r.nodes[i]!;
        if (pts.length >= 2 && a !== b) this.addEdge(a, b, r, pts);
        else if (a === b && pts.length >= 4) {
          // boucle fermée sur elle-même (rond-point isolé) : coupée en deux
          const mid = Math.floor(pts.length / 2);
          const mNode = r.nodes[start + mid]!;
          this.addEdge(a, mNode, r, pts.slice(0, mid + 1));
          this.addEdge(mNode, b, r, pts.slice(mid));
        }
        start = i;
      }
    }
  }

  private addEdge(a: number, b: number, road: RoadWay, pts: Pt[]): void {
    const id = this.edges.length;
    const e: Edge = { id, a, b, road, pts, len: polylineLength(pts), oneway: road.oneway, rides: 0, passes: 0 };
    this.edges.push(e);
    for (const n of [a, b]) {
      let l = this.adj.get(n);
      if (!l) this.adj.set(n, (l = []));
      l.push(id);
    }
    this.nodePos.set(a, pts[0]!);
    this.nodePos.set(b, pts[pts.length - 1]!);
    this.index.insertBox(bboxOf(pts), id);
  }

  other(e: Edge, n: number): number {
    return e.a === n ? e.b : e.a;
  }

  /** Peut-on parcourir l'arête depuis le nœud n ? */
  canTraverse(e: Edge, from: number, respectOneway = true): boolean {
    if (!respectOneway || e.oneway === 0) return true;
    return e.oneway === 1 ? e.a === from : e.b === from;
  }

  degree(n: number): number {
    return this.adj.get(n)?.length ?? 0;
  }

  /** Géométrie de l'arête orientée depuis le nœud `from`. */
  orientedPts(e: Edge, from: number): Pt[] {
    return e.a === from ? e.pts : e.pts.slice().reverse();
  }
}

export interface DijkstraOptions {
  cost: (e: Edge) => number;
  bannedEdges?: Set<number>;
  bannedNodes?: Set<number>;
  respectOneway?: boolean;
  target?: number;
  maxCost?: number;
}

export interface DijkstraResult {
  dist: Map<number, number>;
  prevEdge: Map<number, number>;
}

/** Tas binaire minimal. */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, val: number): void {
    const k = this.k;
    const v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= k[i]!) break;
      [k[p], k[i]] = [k[i]!, k[p]!];
      [v[p], v[i]] = [v[i]!, v[p]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const k = this.k;
    const v = this.v;
    const top: [number, number] = [k[0]!, v[0]!];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l]! < k[m]!) m = l;
        if (r < k.length && k[r]! < k[m]!) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i]!, k[m]!];
        [v[m], v[i]] = [v[i]!, v[m]!];
        i = m;
      }
    }
    return top;
  }
}

export function dijkstra(g: RoadGraph, source: number, o: DijkstraOptions): DijkstraResult {
  const dist = new Map<number, number>([[source, 0]]);
  const prevEdge = new Map<number, number>();
  const done = new Set<number>();
  const h = new Heap();
  h.push(0, source);
  const respect = o.respectOneway ?? true;
  while (h.size) {
    const [d, n] = h.pop();
    if (done.has(n)) continue;
    done.add(n);
    if (n === o.target) break;
    if (o.maxCost !== undefined && d > o.maxCost) break;
    for (const eid of g.adj.get(n) ?? []) {
      if (o.bannedEdges?.has(eid)) continue;
      const e = g.edges[eid]!;
      if (!g.canTraverse(e, n, respect)) continue;
      const m = g.other(e, n);
      if (o.bannedNodes?.has(m) && m !== o.target) continue;
      const c = o.cost(e);
      if (!Number.isFinite(c)) continue;
      const nd = d + c;
      if (nd < (dist.get(m) ?? Infinity)) {
        dist.set(m, nd);
        prevEdge.set(m, eid);
        h.push(nd, m);
      }
    }
  }
  return { dist, prevEdge };
}

/** Reconstitue le chemin (liste d'arêtes, de la source vers `target`). */
export function pathTo(g: RoadGraph, r: DijkstraResult, source: number, target: number): number[] | null {
  if (!r.dist.has(target)) return null;
  const out: number[] = [];
  let n = target;
  while (n !== source) {
    const eid = r.prevEdge.get(n);
    if (eid === undefined) return null;
    out.push(eid);
    n = g.other(g.edges[eid]!, n);
    if (out.length > 100000) return null;
  }
  return out.reverse();
}

/** Nœuds traversés par un chemin d'arêtes partant de `source`. */
export function pathNodes(g: RoadGraph, source: number, edges: number[]): number[] {
  const nodes = [source];
  let n = source;
  for (const eid of edges) {
    n = g.other(g.edges[eid]!, n);
    nodes.push(n);
  }
  return nodes;
}
