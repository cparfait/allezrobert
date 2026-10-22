/**
 * Graphe routier d'un monde ouvert (`worlds/<id>/graph.json`, produit par tools/terrain) et
 * chemin construit à la volée au fil des carrefours (mode ouvert).
 *
 * Repère monde habituel : x = est, z = sud, y = altitude. Chaque arête porte le profil 3D
 * exactement creusé dans le terrain (a → b) ; les nœuds partagés ont une altitude unique, donc
 * les profils se raccordent aux carrefours.
 */
import type { RoutePoint } from './route.ts';

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
