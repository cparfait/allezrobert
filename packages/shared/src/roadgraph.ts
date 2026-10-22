/**
 * Graphe routier d'un monde ouvert (`worlds/<id>/graph.json`, produit par tools/terrain) et
 * chemin construit à la volée au fil des carrefours (mode ouvert).
 *
 * Repère monde habituel : x = est, z = sud, y = altitude. Chaque arête porte le profil 3D
 * exactement creusé dans le terrain (a → b) ; les nœuds partagés ont une altitude unique, donc
 * les profils se raccordent aux carrefours.
 */
import type { RouteData, RoutePoint, RouteSegment, WorldPlace } from './route.ts';

export interface RoadGraphEdge {
  /** Indices des nœuds d'extrémité. */
  a: number;
  b: number;
  /** Tag OSM `highway`. */
  kind: string;
  name?: string;
  ref?: string;
  /** Largeur de chaussée (m). */
  width: number;
  /** Tag OSM `surface` (asphalt, gravel…). */
  surface: string;
  /** 1 : seulement a → b, −1 : seulement b → a, 0 : les deux (vélo). */
  oneway: 0 | 1 | -1;
  /** Longueur en plan (m). */
  len: number;
  /** Profil [x, y, z, …] de a vers b, extrémités comprises. */
  pts: number[];
}

export interface RoadGraphData {
  formatVersion: 1;
  /** Positions des nœuds [x, y, z, …]. */
  nodes: number[];
  edges: RoadGraphEdge[];
  attribution: string[];
}

/** Parcours d'une arête dans un sens. */
export interface EdgeStep {
  edge: number;
  forward: boolean;
}

/** Possibilité à un carrefour, de la plus à gauche à la plus à droite. */
export interface TurnChoice {
  step: EdgeStep;
  /** Angle de virage en degrés : négatif à gauche, positif à droite. */
  turnDeg: number;
  dir: 'left' | 'straight' | 'right' | 'back';
  /** Nom de la route prise (ou numéro), et destination quand elle se déduit. */
  name: string;
  surface: string;
}

type V3 = [number, number, number];

/** Graphe navigable : adjacence, géométrie orientée, carrefours. */
export class RoadNet {
  readonly data: RoadGraphData;
  /** Arêtes incidentes à chaque nœud. */
  readonly incident: number[][];
  private readonly grid = new Map<string, number[]>();
  private static readonly CELL = 100;

  constructor(data: RoadGraphData) {
    this.data = data;
    const n = data.nodes.length / 3;
    this.incident = Array.from({ length: n }, () => []);
    data.edges.forEach((e, i) => {
      this.incident[e.a]?.push(i);
      if (e.b !== e.a) this.incident[e.b]?.push(i);
      // Index spatial grossier : cellules traversées par les points de l'arête.
      const seen = new Set<string>();
      for (let k = 0; k < e.pts.length; k += 3) {
        const key = this.cellKey(e.pts[k] as number, e.pts[k + 2] as number);
        if (seen.has(key)) continue;
        seen.add(key);
        let l = this.grid.get(key);
        if (!l) this.grid.set(key, (l = []));
        l.push(i);
      }
    });
  }

  private cellKey(x: number, z: number): string {
    return `${Math.floor(x / RoadNet.CELL)},${Math.floor(z / RoadNet.CELL)}`;
  }

  edge(i: number): RoadGraphEdge {
    return this.data.edges[i] as RoadGraphEdge;
  }

  node(i: number): V3 {
    const p = this.data.nodes;
    return [p[i * 3] as number, p[i * 3 + 1] as number, p[i * 3 + 2] as number];
  }

  startNode(s: EdgeStep): number {
    const e = this.edge(s.edge);
    return s.forward ? e.a : e.b;
  }

  endNode(s: EdgeStep): number {
    const e = this.edge(s.edge);
    return s.forward ? e.b : e.a;
  }

  /** Sens autorisé à vélo ? */
  allowed(s: EdgeStep): boolean {
    const o = this.edge(s.edge).oneway;
    return o === 0 || (o === 1) === s.forward;
  }

  /** Points de l'arête dans le sens de parcours. */
  points(s: EdgeStep): V3[] {
    const p = this.edge(s.edge).pts;
    const out: V3[] = [];
    for (let k = 0; k < p.length; k += 3) out.push([p[k] as number, p[k + 1] as number, p[k + 2] as number]);
    if (!s.forward) out.reverse();
    return out;
  }

  /** Cap (radians, atan2(dx, dz)) en partant (`atStart`) ou en arrivant, mesuré sur ~12 m. */
  heading(s: EdgeStep, atStart: boolean): number {
    const pts = this.points(s);
    if (atStart) return headingAlong(pts, 12);
    return headingAlong(pts.reverse(), 12) + Math.PI;
  }

  /** Possibilités en arrivant au bout de `arrive` (demi-tour seulement en cul-de-sac). */
  choices(arrive: EdgeStep): TurnChoice[] {
    const node = this.endNode(arrive);
    const hIn = this.heading(arrive, false);
    const out: TurnChoice[] = [];
    for (const ei of this.incident[node] ?? []) {
      const e = this.edge(ei);
      const steps: EdgeStep[] = [];
      if (e.a === node) steps.push({ edge: ei, forward: true });
      if (e.b === node) steps.push({ edge: ei, forward: false });
      for (const st of steps) {
        if (st.edge === arrive.edge && st.forward !== arrive.forward) continue;
        if (!this.allowed(st)) continue;
        out.push(this.describe(st, hIn));
      }
    }
    if (!out.length) out.push(this.describe({ edge: arrive.edge, forward: !arrive.forward }, hIn));
    return out.sort((a, b) => a.turnDeg - b.turnDeg);
  }

  private describe(step: EdgeStep, hIn: number): TurnChoice {
    const e = this.edge(step.edge);
    let d = this.heading(step, true) - hIn;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    // Cap = atan2(dx, dz) avec z vers le sud : un cap qui diminue tourne vers la droite.
    const turnDeg = (-d * 180) / Math.PI;
    const a = Math.abs(turnDeg);
    const dir = a > 150 ? 'back' : a < 30 ? 'straight' : turnDeg < 0 ? 'left' : 'right';
    return { step, turnDeg, dir, name: e.name || e.ref || '', surface: e.surface };
  }

  /**
   * Suite la plus naturelle : même nom ou numéro de route si possible, sinon le virage le plus
   * faible ; jamais de demi-tour s'il existe autre chose.
   */
  straightest(arrive: EdgeStep, list = this.choices(arrive)): TurnChoice {
    const cur = this.edge(arrive.edge);
    const same = list.filter((c) => c.dir !== 'back' && ((cur.ref && this.edge(c.step.edge).ref === cur.ref) || (cur.name && this.edge(c.step.edge).name === cur.name)));
    const pool = (same.length ? same : list.filter((c) => c.dir !== 'back')).sort((a, b) => Math.abs(a.turnDeg) - Math.abs(b.turnDeg));
    return pool[0] ?? (list[0] as TurnChoice);
  }

  /** Arête la plus proche du point (x, z), avec la position le long d'elle (m depuis a). */
  nearest(x: number, z: number, accept: (e: RoadGraphEdge) => boolean = () => true): { edge: number; along: number; dist: number } | null {
    let best: { edge: number; along: number; dist: number } | null = null;
    for (let r = 0; r <= 6 && !best; r++) {
      const cx = Math.floor(x / RoadNet.CELL);
      const cz = Math.floor(z / RoadNet.CELL);
      const cand = new Set<number>();
      for (let i = cx - r; i <= cx + r; i++) for (let j = cz - r; j <= cz + r; j++) for (const e of this.grid.get(`${i},${j}`) ?? []) cand.add(e);
      for (const ei of cand) {
        const e = this.edge(ei);
        if (!accept(e)) continue;
        const p = e.pts;
        let acc = 0;
        for (let k = 0; k + 5 < p.length; k += 3) {
          const ax = p[k] as number;
          const az = p[k + 2] as number;
          const bx = p[k + 3] as number;
          const bz = p[k + 5] as number;
          const dx = bx - ax;
          const dz = bz - az;
          const l2 = dx * dx + dz * dz;
          const t = l2 > 0 ? Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / l2, 0), 1) : 0;
          const d = Math.hypot(ax + t * dx - x, az + t * dz - z);
          if (!best || d < best.dist) best = { edge: ei, along: acc + t * Math.sqrt(l2), dist: d };
          acc += Math.sqrt(l2);
        }
      }
    }
    return best;
  }
}

function headingAlong(pts: V3[], distM: number): number {
  const p0 = pts[0] as V3;
  let acc = 0;
  let q = pts[pts.length - 1] as V3;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as V3;
    const b = pts[i] as V3;
    acc += Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (acc >= distM) {
      q = b;
      break;
    }
  }
  return Math.atan2(q[0] - p0[0], q[2] - p0[2]);
}

/** Arête du chemin, avec ses distances de début et de fin sur le chemin (m). */
export interface PathStep extends EdgeStep {
  startD: number;
  endD: number;
  /** Position de départ sur l'arête (m depuis son début dans le sens de parcours). */
  from: number;
  /** État de l'échantillonnage avant cette arête (pour revenir en arrière). */
  n0: number;
  rem0: number;
}

/**
 * Chemin construit arête par arête : profil rééchantillonné tous les mètres le long des arêtes
 * mises bout à bout, puis lissé en plan (gaussienne σ : coins de carrefour arrondis, altitude
 * conservée). La distance `d` d'un point est la distance le long des arêtes : elle ne change
 * jamais une fois écrite, ce qui permet d'allonger ou de replanifier la fin du chemin sans
 * toucher au passé.
 */
export class OpenPath {
  readonly steps: PathStep[] = [];
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];
  private readonly zs: number[] = [];
  /** Distance entre le dernier échantillon et la fin exacte de la dernière arête (< 1 m). */
  private rem = 0;

  constructor(
    readonly net: RoadNet,
    readonly sigmaM = 2.5,
    readonly stepM = 2,
  ) {}

  /** Longueur le long des arêtes (m). */
  get length(): number {
    return this.xs.length ? this.xs.length - 1 + this.rem : 0;
  }

  /** Dernière arête du chemin. */
  get last(): PathStep | undefined {
    return this.steps[this.steps.length - 1];
  }

  /**
   * Ajoute une arête, à partir de `fromAlong` m de son début (départ ou demi-tour au milieu
   * d'une arête) ; sinon elle part du bout du chemin (nœud partagé).
   */
  add(step: EdgeStep, fromAlong = 0): PathStep {
    let pts = this.net.points(step);
    if (fromAlong > 0) pts = sliceFrom(pts, fromAlong);
    const n0 = this.xs.length;
    const rem0 = this.rem;
    const startD = this.length;
    if (!this.xs.length) {
      const p = pts[0] as V3;
      this.xs.push(p[0]);
      this.ys.push(p[1]);
      this.zs.push(p[2]);
      this.rem = 0;
    }
    let next = 1 - this.rem; // distance jusqu'au prochain échantillon depuis pts[0]
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as V3;
      const b = pts[i] as V3;
      const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
      while (next <= acc + l + 1e-9) {
        const t = l > 0 ? (next - acc) / l : 0;
        this.xs.push(a[0] + (b[0] - a[0]) * t);
        this.ys.push(a[1] + (b[1] - a[1]) * t);
        this.zs.push(a[2] + (b[2] - a[2]) * t);
        next += 1;
      }
      acc += l;
    }
    this.rem = acc - (next - 1);
    const rec: PathStep = { ...step, startD, endD: startD + acc, from: fromAlong, n0, rem0 };
    this.steps.push(rec);
    return rec;
  }

  /** Ne garde que les `count` premières arêtes (replanification d'un carrefour). */
  truncateSteps(count: number): void {
    while (this.steps.length > count) {
      const s = this.steps.pop() as PathStep;
      this.xs.length = s.n0;
      this.ys.length = s.n0;
      this.zs.length = s.n0;
      this.rem = s.rem0;
    }
  }

  /**
   * Coupe le chemin à la distance `d` (demi-tour au milieu d'une arête). Renvoie l'arête en
   * cours et la position le long d'elle (m depuis son début dans son sens de parcours).
   */
  cutAt(d: number): { step: EdgeStep; along: number } | null {
    const i = this.steps.findIndex((s) => d >= s.startD && d <= s.endD + 1e-9);
    if (i < 0) return null;
    this.truncateSteps(i + 1);
    const s = this.steps[i] as PathStep;
    const keep = Math.min(this.xs.length, Math.floor(d) + 1);
    this.xs.length = keep;
    this.ys.length = keep;
    this.zs.length = keep;
    this.rem = d - (keep - 1);
    s.endD = d;
    return { step: { edge: s.edge, forward: s.forward }, along: s.from + (d - s.startD) };
  }

  /**
   * Points lissés à partir de la distance `fromD` (alignée sur le pas), jusqu'au bout. Les
   * derniers 3σ sont provisoires : ils bougent quand on ajoute l'arête suivante.
   */
  pointsFrom(fromD: number): RoutePoint[] {
    const n = this.xs.length;
    const out: RoutePoint[] = [];
    if (n < 2) return out;
    const sigma = this.sigmaM;
    const half = Math.ceil(3 * sigma);
    const w: number[] = [];
    for (let k = -half; k <= half; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
    const first = Math.max(0, Math.ceil(fromD / this.stepM - 1e-9) * this.stepM);
    for (let d = first; d <= n - 1 + 1e-9; d += this.stepM) {
      const i = Math.round(d);
      let sx = 0;
      let sz = 0;
      let sw = 0;
      for (let k = -half; k <= half; k++) {
        const j = i + k;
        if (j < 0 || j >= n) continue;
        const wk = w[k + half] as number;
        sx += (this.xs[j] as number) * wk;
        sz += (this.zs[j] as number) * wk;
        sw += wk;
      }
      // Aux deux bouts, lissage atténué : le chemin commence et finit sur l'axe de la route.
      const f = Math.min(1, Math.min(i, n - 1 - i) / half);
      const x = (this.xs[i] as number) * (1 - f) + (sx / sw) * f;
      const z = (this.zs[i] as number) * (1 - f) + (sz / sw) * f;
      out.push({ x: round2(x), y: round2(this.ys[i] as number), z: round2(z), d });
    }
    return out;
  }

  /** Arête parcourue à la distance `d`. */
  stepAt(d: number): PathStep | undefined {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      const s = this.steps[i] as PathStep;
      if (d >= s.startD) return s;
    }
    return this.steps[0];
  }
}

/** Polyligne à partir de `along` m de son début. */
function sliceFrom(pts: V3[], along: number): V3[] {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as V3;
    const b = pts[i] as V3;
    const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (acc + l > along) {
      const t = l > 0 ? (along - acc) / l : 0;
      return [[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], ...pts.slice(i)];
    }
    acc += l;
  }
  return [pts[pts.length - 1] as V3, pts[pts.length - 1] as V3];
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ————————————————————————————————————————————— Itinéraire départ → arrivée

/** Point de la carte rattaché au graphe : arête, position le long d'elle (m depuis a), position. */
export interface RoadSnap {
  edge: number;
  along: number;
  x: number;
  z: number;
}

/** Arête d'un itinéraire, parcourue de `from` à `to` (m depuis son début dans le sens de parcours). */
export interface ItineraryStep extends EdgeStep {
  from: number;
  to: number;
}

/** Itinéraire calculé : arêtes parcourues dans l'ordre (en entier sauf aux points de passage). */
export interface Itinerary {
  steps: ItineraryStep[];
}

const PAVED_SURFACE = /^(asphalt|paved|concrete|chipseal)/;

/** Route revêtue (les chemins agricoles ne le sont jamais vraiment). */
export function isPavedEdge(e: RoadGraphEdge): boolean {
  return PAVED_SURFACE.test(e.surface) && e.kind !== 'track';
}

/**
 * Coût d'une arête au mètre pour l'itinéraire : routes revêtues de préférence, chemins
 * seulement s'ils évitent un grand détour, grands axes un peu évités.
 */
export function itineraryCost(e: RoadGraphEdge): number {
  if (!isPavedEdge(e)) return 4;
  if (/^service/.test(e.kind)) return 1.8;
  if (/^primary/.test(e.kind)) return 1.4;
  return 1;
}

/** Longueur en plan de chaque arête mesurée sur son profil (même métrique qu'OpenPath). */
const polyLens = new WeakMap<RoadNet, Float64Array>();
export function edgeLengths(net: RoadNet): Float64Array {
  let l = polyLens.get(net);
  if (l) return l;
  const out = new Float64Array(net.data.edges.length);
  net.data.edges.forEach((e, i) => {
    let acc = 0;
    for (let k = 3; k < e.pts.length; k += 3) acc += Math.hypot((e.pts[k] as number) - (e.pts[k - 3] as number), (e.pts[k + 2] as number) - (e.pts[k - 1] as number));
    out[i] = acc;
  });
  l = out;
  polyLens.set(net, l);
  return l;
}

/** Position sur l'arête à `along` m de a. */
function pointOnEdge(e: RoadGraphEdge, along: number): { x: number; z: number } {
  const p = e.pts;
  let acc = 0;
  for (let k = 3; k < p.length; k += 3) {
    const ax = p[k - 3] as number;
    const az = p[k - 1] as number;
    const l = Math.hypot((p[k] as number) - ax, (p[k + 2] as number) - az);
    if (acc + l >= along) {
      const t = l > 0 ? (along - acc) / l : 0;
      return { x: ax + ((p[k] as number) - ax) * t, z: az + ((p[k + 2] as number) - az) * t };
    }
    acc += l;
  }
  return { x: p[p.length - 3] as number, z: p[p.length - 1] as number };
}

/**
 * Rattache un point (x, z) à la route roulable la plus proche ; à moins de `nodeSnapM` d'un
 * carrefour ou d'un bout de route, au nœud lui-même. `null` si rien à moins de `maxDistM`.
 */
export function snapToRoad(net: RoadNet, x: number, z: number, maxDistM = 400, nodeSnapM = 15): RoadSnap | null {
  const near = net.nearest(x, z);
  if (!near || near.dist > maxDistM) return null;
  const len = edgeLengths(net)[near.edge] as number;
  const along = near.along < nodeSnapM ? 0 : len - near.along < nodeSnapM ? len : near.along;
  return { edge: near.edge, along, ...pointOnEdge(net.edge(near.edge), along) };
}

/** Tas binaire minimal (Dijkstra). */
class MinHeap {
  private readonly ids: number[] = [];
  private readonly keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((keys[p] as number) <= key) break;
      ids[i] = ids[p] as number;
      keys[i] = keys[p] as number;
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): { id: number; key: number } {
    const ids = this.ids;
    const keys = this.keys;
    const top = { id: ids[0] as number, key: keys[0] as number };
    const id = ids.pop() as number;
    const key = keys.pop() as number;
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && (keys[r] as number) < (keys[l] as number) ? r : l;
        if ((keys[c] as number) >= key) break;
        ids[i] = ids[c] as number;
        keys[i] = keys[c] as number;
        i = c;
      }
      ids[i] = id;
      keys[i] = key;
    }
    return top;
  }
}

/**
 * Plus court chemin (au sens de `cost`, routes revêtues de préférence) d'un point rattaché à
 * un autre, dans les sens autorisés à vélo. `null` si l'arrivée est inaccessible.
 */
export function planItinerary(net: RoadNet, from: RoadSnap, to: RoadSnap, cost: (e: RoadGraphEdge) => number = itineraryCost): Itinerary | null {
  const lens = edgeLengths(net);
  const n = net.incident.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev: Array<EdgeStep | null> = new Array<EdgeStep | null>(n).fill(null);
  const seeded = new Uint8Array(n);
  const heap = new MinHeap();
  const ef = net.edge(from.edge);
  const lf = lens[from.edge] as number;
  const et = net.edge(to.edge);
  const lt = lens[to.edge] as number;
  const seed = (node: number, d: number, step: EdgeStep) => {
    if (!net.allowed(step) || d >= (dist[node] as number)) return;
    dist[node] = d;
    prev[node] = step;
    seeded[node] = 1;
    heap.push(node, d);
  };
  seed(ef.b, (lf - from.along) * cost(ef), { edge: from.edge, forward: true });
  seed(ef.a, from.along * cost(ef), { edge: from.edge, forward: false });
  // Départ et arrivée sur la même arête, dans le bon sens : sans passer par un carrefour.
  let best = Infinity;
  let end: { node: number; step: EdgeStep } | null = null;
  if (from.edge === to.edge && to.along !== from.along) {
    const step = { edge: from.edge, forward: to.along > from.along };
    if (net.allowed(step)) {
      best = Math.abs(to.along - from.along) * cost(ef);
      end = { node: -1, step };
    }
  }
  while (heap.size) {
    const { id: u, key: d } = heap.pop();
    if (d > (dist[u] as number)) continue;
    if (d >= best) break;
    // Arrivée : depuis un bout de l'arête d'arrivée jusqu'au point.
    if (u === et.a && net.allowed({ edge: to.edge, forward: true }) && d + to.along * cost(et) < best) {
      best = d + to.along * cost(et);
      end = { node: u, step: { edge: to.edge, forward: true } };
    }
    if (u === et.b && net.allowed({ edge: to.edge, forward: false }) && d + (lt - to.along) * cost(et) < best) {
      best = d + (lt - to.along) * cost(et);
      end = { node: u, step: { edge: to.edge, forward: false } };
    }
    for (const ei of net.incident[u] ?? []) {
      const e = net.edge(ei);
      const w = (lens[ei] as number) * cost(e);
      for (const forward of [true, false]) {
        if ((forward ? e.a : e.b) !== u) continue;
        const step = { edge: ei, forward };
        if (!net.allowed(step)) continue;
        const v = forward ? e.b : e.a;
        const nd = d + w;
        if (nd < (dist[v] as number)) {
          dist[v] = nd;
          prev[v] = step;
          seeded[v] = 0;
          heap.push(v, nd);
        }
      }
    }
  }
  if (!end) return null;
  const steps: EdgeStep[] = [end.step];
  if (end.node >= 0) {
    let node = end.node;
    for (let guard = 0; guard <= n; guard++) {
      const st = prev[node] as EdgeStep;
      steps.unshift(st);
      if (seeded[node]) break;
      node = net.startNode(st);
    }
  }
  const first = steps[0] as EdgeStep;
  const last = steps[steps.length - 1] as EdgeStep;
  let fromAlong = first.forward ? from.along : lf - from.along;
  let toAlong = last.forward ? to.along : lt - to.along;
  // Point posé sur un carrefour : pas d'arête parcourue sur 0 m au début ni à la fin.
  if (steps.length > 1 && lf - fromAlong < 1e-6) {
    steps.shift();
    fromAlong = 0;
  }
  if (steps.length > 1 && toAlong < 1e-6) {
    steps.pop();
    toAlong = lens[(steps[steps.length - 1] as EdgeStep).edge] as number;
  }
  return {
    steps: steps.map((st, i) => ({ ...st, from: i === 0 ? fromAlong : 0, to: i === steps.length - 1 ? toAlong : (lens[st.edge] as number) })),
  };
}

/**
 * Itinéraire par étapes (points de passage) : étapes mises bout à bout ; une arête continuée
 * dans le même sens au point de passage n'en fait qu'une, sinon c'est un demi-tour sur place.
 */
export function joinItineraries(legs: Itinerary[]): Itinerary {
  const out: ItineraryStep[] = [];
  for (const leg of legs)
    for (const st of leg.steps) {
      if (st.to - st.from < 1e-6 && (out.length || leg.steps.length > 1)) continue;
      const prev = out[out.length - 1];
      if (prev && prev.edge === st.edge && prev.forward === st.forward && Math.abs(prev.to - st.from) < 1e-6) prev.to = st.to;
      else out.push({ ...st });
    }
  return { steps: out };
}

/** « de » devant un nom de lieu : du Roussel, des Vigiers, de la Pireyre, d'Égliseneuve, de Glaine. */
export function frenchOf(name: string): string {
  if (/^Le /.test(name)) return `du ${name.slice(3)}`;
  if (/^Les /.test(name)) return `des ${name.slice(4)}`;
  if (/^La /.test(name)) return `de la ${name.slice(3)}`;
  if (/^L['’]/.test(name)) return `de l’${name.slice(2)}`;
  if (/^[AEIOUYÉÈÊÂÎÔaeiouyéèê]/.test(name)) return `d’${name}`;
  return `de ${name}`;
}

/** Extrema avec hystérésis (zig-zag) : indices alternés min/max. */
function zigzag(h: number[], hyst: number): Array<{ i: number; type: 'min' | 'max' }> {
  const out: Array<{ i: number; type: 'min' | 'max' }> = [];
  let minI = 0;
  let maxI = 0;
  let trend = 0; // 1 montée, −1 descente
  for (let i = 1; i < h.length; i++) {
    const v = h[i] as number;
    if (trend >= 0 && v > (h[maxI] as number)) maxI = i;
    if (trend <= 0 && v < (h[minI] as number)) minI = i;
    if (trend <= 0 && v - (h[minI] as number) >= hyst) {
      out.push({ i: minI, type: 'min' });
      trend = 1;
      maxI = i;
    } else if (trend >= 0 && (h[maxI] as number) - v >= hyst) {
      out.push({ i: maxI, type: 'max' });
      trend = -1;
      minI = i;
    }
  }
  if (trend === 1) out.push({ i: maxI, type: 'max' });
  else if (trend === -1) out.push({ i: minI, type: 'min' });
  return out;
}

/** Montées d'un profil (pas `step`) : ≥ `minLen` m à ≥ `minGrade` %, approches plates rognées (comme tools/terrain). */
export function detectProfileClimbs(h: number[], step: number, minLen = 500, minGrade = 3): Array<{ startIdx: number; endIdx: number; avgGrade: number }> {
  const ext = zigzag(h, 4);
  const look = Math.max(1, Math.round(50 / step));
  const out: Array<{ startIdx: number; endIdx: number; avgGrade: number }> = [];
  for (let k = 0; k + 1 < ext.length; k++) {
    const a = ext[k] as { i: number; type: string };
    const b = ext[k + 1] as { i: number; type: string };
    if (a.type !== 'min' || b.type !== 'max') continue;
    let s = a.i;
    let e = b.i;
    while (s + look < e && ((h[s + look] as number) - (h[s] as number)) / (look * step) < 0.015) s++;
    while (e - look > s && ((h[e] as number) - (h[e - look] as number)) / (look * step) < 0.015) e--;
    const len = (e - s) * step;
    const avg = (((h[e] as number) - (h[s] as number)) / Math.max(len, 1)) * 100;
    if (len >= minLen && avg >= minGrade) out.push({ startIdx: s, endIdx: e, avgGrade: avg });
  }
  return out;
}

/**
 * Itinéraire en `RouteData` (aller simple), construit comme les tours proposés de
 * tools/terrain : chemin lissé d'OpenPath (points tous les 2 m), revêtements et largeurs par
 * tronçon, montées détectées sur le profil. `null` si le tracé fait moins de 50 m.
 */
export function itineraryRoute(net: RoadNet, it: Itinerary, meta: { id: string; name: string; nameEn?: string; climbName?: (i: number) => string; places?: WorldPlace[] }): RouteData | null {
  const path = new OpenPath(net);
  for (const st of it.steps) {
    const rec = path.add({ edge: st.edge, forward: st.forward }, st.from);
    // Arête quittée avant son bout : point de passage ou arrivée.
    const d = rec.startD + Math.max(0, st.to - st.from);
    if (d < rec.endD - 1e-6) path.cutAt(d);
  }
  const points = path.pointsFrom(0);
  const lengthM = points[points.length - 1]?.d ?? 0;
  if (points.length < 2 || lengthM < 50) return null;
  const step = path.stepM;
  const hs = points.map((p) => p.y);
  const runs = <T extends string | number>(key: (e: RoadGraphEdge) => T) => {
    const out: Array<{ startM: number; endM: number; v: T }> = [];
    for (const s of path.steps) {
      const v = key(net.edge(s.edge));
      const prevRun = out[out.length - 1];
      const endM = round2(Math.min(s.endD, lengthM));
      if (prevRun && prevRun.v === v) prevRun.endM = endM;
      else out.push({ startM: round2(s.startD), endM, v });
    }
    return out;
  };
  const surfaces = runs((e) => e.surface || 'asphalt').map((r) => ({ startM: r.startM, endM: r.endM, surface: r.v }));
  const roadWidths = runs((e) => e.width).map((r) => ({ startM: r.startM, endM: r.endM, widthM: r.v }));
  const widths = path.steps.map((s) => net.edge(s.edge).width).sort((a, b) => a - b);
  const segments: RouteSegment[] = detectProfileClimbs(hs, step).map((c, i) => ({
    id: `${meta.id}-kom-${i + 1}`,
    kind: 'kom',
    name: meta.climbName ? meta.climbName(i) : `Côte ${i + 1}`,
    startM: round2(c.startIdx * step),
    endM: round2(c.endIdx * step),
    avgGrade: round2(c.avgGrade),
  }));
  // Villes et villages traversés (comme les tours de tools/terrain) ; les côtes prennent le nom
  // du lieu le plus proche de leur sommet.
  const landmarks: Array<{ name: string; d: number }> = [];
  for (const p of meta.places ?? []) {
    if (!/^(village|town|city|hamlet)$/.test(p.kind) || !p.name) continue;
    let bi = -1;
    let bd = /^(village|town|city)$/.test(p.kind) ? 400 : 200;
    for (let i = 0; i < points.length; i += 2) {
      const q = points[i] as RoutePoint;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    if (bi >= 0) landmarks.push({ name: p.name, d: round2((points[bi] as RoutePoint).d) });
  }
  landmarks.sort((a, b) => a.d - b.d);
  if (!meta.climbName)
    for (const sg of segments) {
      const near = landmarks.slice().sort((a, b) => Math.abs(a.d - sg.endM) - Math.abs(b.d - sg.endM))[0];
      if (near && Math.abs(near.d - sg.endM) < 1500) sg.name = `Côte ${frenchOf(near.name)}`;
    }
  let gain = 0;
  for (let i = 1; i < hs.length; i++) gain += Math.max(0, (hs[i] as number) - (hs[i - 1] as number));
  let maxGrade = 0;
  const w = Math.round(10 / step);
  for (let i = 0; i + w < hs.length; i++) maxGrade = Math.max(maxGrade, Math.abs(((hs[i + w] as number) - (hs[i] as number)) / (w * step)) * 100);
  return {
    id: meta.id,
    name: meta.name,
    ...(meta.nameEn ? { nameEn: meta.nameEn } : {}),
    loop: false,
    lengthM: round2(lengthM),
    elevationGainM: round2(gain),
    points,
    segments,
    roadWidthM: widths[widths.length >> 1] ?? 5,
    attribution: [...net.data.attribution],
    roadWidths,
    surfaces,
    ...(landmarks.length ? { landmarks } : {}),
    stepM: step,
    minElevationM: round2(Math.min(...hs)),
    maxElevationM: round2(Math.max(...hs)),
    maxGradePct: round2(maxGrade),
  };
}
