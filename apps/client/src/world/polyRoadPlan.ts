import type { RoadGraphData, RoadGraphEdge } from '@allezrobert/shared';

/**
 * Signalisation du mode Poly, déduite du seul graphe routier : marquages au sol (cédez-le-passage, stop, passages
 * piétons, axe continu, voies et pictogrammes vélo) et panneaux (carrefours, directions, virages, pentes, villages).
 * Rien n'est écrit dans les données des zones. Calcul pur, découpé en pas (voir polyRoads.ts pour le dessin).
 */

/** Panneaux à pictogramme : case de l'atlas (polyRoadAtlas.ts), dans cet ordre. */
export const SIGN_KINDS = [
  'stop', 'yield', 'priority', 'crossing', 'curveLeft', 'curveRight', 'sLeft', 'sRight',
  'descent', 'climb', 'zone30', 'pedestrians', 'cycleway', 'chevronRight', 'chevronLeft', 'cyclists',
] as const;
export type SignKind = (typeof SIGN_KINDS)[number];

export interface DirectionLine {
  place: number;
  km: number;
  arrow: 'left' | 'straight' | 'right';
}

interface Placed {
  x: number;
  y: number;
  z: number;
  /** Sens de marche du coureur qui lit le panneau. */
  dx: number;
  dz: number;
}

export interface PlannedSign extends Placed {
  kind: SignKind;
  /** Pente affichée (%), pour les panneaux de descente et de montée. */
  value?: number;
}

export interface PlannedPanel extends Placed {
  lines: DirectionLine[];
}

export interface PlannedTown extends Placed {
  place: number;
  exit: boolean;
}

/** Balise de virage (poteau blanc à bande sombre). */
export interface PlannedPost {
  x: number;
  y: number;
  z: number;
}

/**
 * Contenu d'une case de CELL_M : `marks` = triangles (x, y, z) peints sur la chaussée, `axis` = point de l'axe de la route
 * (x, z) en face de chaque sommet (la chaussée dessinée arrondit les coudes : la peinture s'y recale, polyRoads.ts).
 */
export interface RoadCell {
  marks: number[];
  axis: number[];
  signs: PlannedSign[];
  panels: PlannedPanel[];
  towns: PlannedTown[];
  posts: PlannedPost[];
}

export interface PlanPlace {
  name: string;
  kind: string;
  x: number;
  z: number;
}

export interface RoadPlan {
  cells: Map<string, RoadCell>;
  places: readonly PlanPlace[];
}

export const CELL_M = 160;
export const cellKeyOf = (x: number, z: number): string => `${Math.floor(x / CELL_M)}_${Math.floor(z / CELL_M)}`;

const RANK: Record<string, number> = { primary: 5, secondary: 4, tertiary: 3, residential: 2, unclassified: 1 };
/** Lieux écrits sur les panneaux de direction. */
const SIGNED = new Set(['town', 'village', 'hamlet']);
const SIGNED_LOCALITIES = new Set(['Phare de Robert', 'Col du Phare', "L'Anneau", 'La Plage']);
const URBAN_CELL = 40;
const URBAN_REACH = 3;
const GRID = 12;
const STEP = 2;

/** Arête échantillonnée : position et direction à une abscisse. */
class Line {
  readonly d: Float64Array;
  readonly n: number;
  readonly length: number;
  readonly half: number;
  readonly rank: number;
  readonly road: boolean;
  constructor(readonly e: RoadGraphEdge) {
    this.n = e.pts.length / 3;
    this.d = new Float64Array(this.n);
    for (let i = 1; i < this.n; i++) this.d[i] = (this.d[i - 1] as number) + Math.hypot((e.pts[i * 3] as number) - (e.pts[i * 3 - 3] as number), (e.pts[i * 3 + 2] as number) - (e.pts[i * 3 - 1] as number));
    this.length = this.d[this.n - 1] as number;
    this.half = Math.max(e.width, 2.5) / 2;
    this.rank = RANK[e.kind] ?? 0;
    this.road = this.rank > 0;
  }

  private seg = 0;

  /** Point à l'abscisse `d`, décalé de `lat` à droite du sens de marche ; `back` : parcouru en sens inverse. */
  at(d: number, lat: number, back: boolean): Placed {
    const s = Math.min(Math.max(back ? this.length - d : d, 0), this.length);
    let i = this.seg;
    while (i > 0 && (this.d[i] as number) > s) i--;
    while (i < this.n - 2 && (this.d[i + 1] as number) < s) i++;
    this.seg = i;
    const p = this.e.pts;
    const o = i * 3;
    const L = (this.d[i + 1] as number) - (this.d[i] as number) || 1;
    const t = (s - (this.d[i] as number)) / L;
    const k = back ? -1 : 1;
    const dx = (((p[o + 3] as number) - (p[o] as number)) / L) * k;
    const dz = (((p[o + 5] as number) - (p[o + 2] as number)) / L) * k;
    return {
      x: (p[o] as number) + ((p[o + 3] as number) - (p[o] as number)) * t - dz * lat,
      y: (p[o + 1] as number) + ((p[o + 4] as number) - (p[o + 1] as number)) * t,
      z: (p[o + 2] as number) + ((p[o + 5] as number) - (p[o + 2] as number)) * t + dx * lat,
      dx,
      dz,
    };
  }
}

/** Branche d'un carrefour : `back` = on arrive au carrefour en parcourant l'arête à rebours. */
interface Branch {
  i: number;
  line: Line;
  /** Vrai : le carrefour est au début de l'arête (on y arrive en sens inverse). */
  atStart: boolean;
  /** Direction de sortie du carrefour (mesurée à 12 m). */
  ox: number;
  oz: number;
}

const bikeWheel = (cx: number, cy: number, r: number): number[] => {
  const out: number[] = [];
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const b = ((i + 1) / N) * Math.PI * 2;
    const q = r * 0.72;
    const A = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    const B = [cx + Math.cos(b) * r, cy + Math.sin(b) * r];
    const C = [cx + Math.cos(b) * q, cy + Math.sin(b) * q];
    const D = [cx + Math.cos(a) * q, cy + Math.sin(a) * q];
    out.push(...A, ...B, ...C, ...A, ...C, ...D);
  }
  return out;
};
const stroke = (ax: number, ay: number, bx: number, by: number, w: number): number[] => {
  const L = Math.hypot(bx - ax, by - ay) || 1;
  const nx = (-(by - ay) / L) * (w / 2);
  const ny = ((bx - ax) / L) * (w / 2);
  return [ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax + nx, ay + ny, bx - nx, by - ny, ax - nx, ay - ny];
};
/** Vélo peint (x à droite, y vers l'avant), 1,1 m de large sur 1,5 m : étiré en long, comme sur une vraie chaussée. */
const BIKE: readonly number[] = [
  ...bikeWheel(-0.33, 0, 0.24), ...bikeWheel(0.33, 0, 0.24),
  ...stroke(-0.33, 0, -0.14, 0.4, 0.06), ...stroke(-0.14, 0.4, 0.2, 0.4, 0.06), ...stroke(0.2, 0.4, 0.33, 0, 0.06),
  ...stroke(-0.33, 0, 0.02, 0, 0.06), ...stroke(0.02, 0, 0.2, 0.4, 0.06), ...stroke(0.02, 0, -0.14, 0.4, 0.06),
  ...stroke(-0.22, 0.5, -0.04, 0.5, 0.07), ...stroke(0.2, 0.4, 0.17, 0.58, 0.06), ...stroke(0.17, 0.58, 0.34, 0.58, 0.07),
];
const ARROW: readonly number[] = [...stroke(0, 0, 0, 0.9, 0.14), -0.26, 0.85, 0.26, 0.85, 0, 1.4];

class Planner {
  readonly cells = new Map<string, RoadCell>();
  private readonly lines: Line[];
  private readonly nodes: Branch[][] = [];
  private readonly urban = new Set<number>();
  private readonly grid = new Map<number, number[]>();

  constructor(private readonly graph: RoadGraphData, private readonly places: readonly PlanPlace[]) {
    this.lines = graph.edges.map((e) => new Line(e));
  }

  /** Carrefours, villages et index des chaussées, puis chaque arête et chaque carrefour : un pas par élément. */
  *run(): Generator<void> {
    this.lines.forEach((line, i) => {
      const e = line.e;
      if (e.pts.length < 6) return;
      for (const atStart of [true, false]) {
        const a = line.at(0, 0, !atStart);
        const b = line.at(12, 0, !atStart);
        const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        (this.nodes[atStart ? e.a : e.b] ??= []).push({ i, line, atStart, ox: (b.x - a.x) / L, oz: (b.z - a.z) / L });
      }
    });
    yield;
    for (const line of this.lines) {
      if (line.e.kind !== 'residential') continue;
      for (let d = 0; d <= line.length; d += 20) {
        const p = line.at(d, 0, false);
        const cx = Math.floor(p.x / URBAN_CELL);
        const cz = Math.floor(p.z / URBAN_CELL);
        for (let x = cx - URBAN_REACH; x <= cx + URBAN_REACH; x++) for (let z = cz - URBAN_REACH; z <= cz + URBAN_REACH; z++) this.urban.add(x * 65536 + z);
      }
      yield;
    }
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i] as Line;
      for (let d = 0; d <= line.length; d += 4) {
        const p = line.at(d, 0, false);
        const k = Math.floor(p.x / GRID) * 65536 + Math.floor(p.z / GRID);
        const cell = this.grid.get(k);
        if (cell) cell.push(p.x, p.z, line.half, i);
        else this.grid.set(k, [p.x, p.z, line.half, i]);
      }
      if (i % 8 === 0) yield;
    }
    const routes = this.places.map((p) => (SIGNED.has(p.kind) || SIGNED_LOCALITIES.has(p.name) ? this.distances(p) : null));
    yield;
    for (const line of this.lines) {
      this.edge(line);
      yield;
    }
    for (let n = 0; n < this.nodes.length; n++) {
      if ((this.nodes[n]?.length ?? 0) >= 3) this.junction(this.nodes[n] as Branch[], routes);
      yield;
    }
  }

  private cell(x: number, z: number): RoadCell {
    const k = cellKeyOf(x, z);
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = { marks: [], axis: [], signs: [], panels: [], towns: [], posts: [] }));
    return c;
  }

  private isUrban(x: number, z: number): boolean {
    return this.urban.has(Math.floor(x / URBAN_CELL) * 65536 + Math.floor(z / URBAN_CELL));
  }

  /** Point à moins de `margin` m d'une chaussée (toutes voies). */
  onRoad(x: number, z: number, margin: number): boolean {
    const cx = Math.floor(x / GRID);
    const cz = Math.floor(z / GRID);
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        const c = this.grid.get(gx * 65536 + gz);
        if (!c) continue;
        for (let o = 0; o < c.length; o += 4) {
          // échantillons tous les 4 m : au plus 2 m d'écart le long de l'axe
          const r = Math.hypot((c[o + 2] as number) + margin, 2);
          if (Math.hypot((c[o] as number) - x, (c[o + 1] as number) - z) < r) return true;
        }
      }
    return false;
  }

  /** Place au bord droit, reculée jusqu'à un emplacement hors de toute chaussée ; null s'il n'y en a pas. */
  private roadside(line: Line, d: number, back: boolean, extra = 1.5, tries = 6): Placed | null {
    for (let k = 0; k < tries; k++) {
      const s = d - k * 3;
      if (s < 1) return null;
      const p = line.at(s, line.half + extra, back);
      if (!this.onRoad(p.x, p.z, 0.75)) return p;
    }
    return null;
  }

  private sign(kind: SignKind, line: Line, d: number, back: boolean, value?: number, extra?: number): void {
    const p = this.roadside(line, d, back, extra);
    if (!p) return;
    const c = this.cell(p.x, p.z);
    // jamais deux panneaux au même endroit : le premier posé reste
    if (c.signs.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 5) || c.panels.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 7) || c.towns.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 7)) return;
    c.signs.push(value === undefined ? { ...p, kind } : { ...p, kind, value });
  }

  /** Rectangle peint : abscisses d0–d1, décalages a–b (droite positive), d'un seul tenant dans les virages. */
  private paint(line: Line, d0: number, d1: number, a: number, b: number, back: boolean): void {
    const from = Math.max(0, Math.min(d0, d1));
    const to = Math.min(line.length, Math.max(d0, d1));
    for (let d = from; d < to - 0.01; d += STEP) {
      const e = Math.min(d + STEP, to);
      const p = line.at(d, a, back);
      const q = line.at(d, b, back);
      const r = line.at(e, b, back);
      const s = line.at(e, a, back);
      const c = this.cell(p.x, p.z);
      c.marks.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z, p.x, p.y, p.z, r.x, r.y, r.z, s.x, s.y, s.z);
      const ax = p.x + p.dz * a;
      const az = p.z - p.dx * a;
      const bx = s.x + s.dz * a;
      const bz = s.z - s.dx * a;
      c.axis.push(ax, az, ax, az, bx, bz, ax, az, bx, bz, bx, bz);
    }
  }

  private stamp(line: Line, d: number, lat: number, back: boolean, shape: readonly number[], sx: number, sy: number): void {
    const o = line.at(d, 0, back);
    const c = this.cell(o.x, o.z);
    for (let i = 0; i < shape.length; i += 2) {
      const l = lat + (shape[i] as number) * sx;
      const p = line.at(d + (shape[i + 1] as number) * sy, l, back);
      c.marks.push(p.x, p.y, p.z);
      c.axis.push(p.x + p.dz * l, p.z - p.dx * l);
    }
  }

  private bike(line: Line, d: number, lat: number, back: boolean): void {
    this.stamp(line, d, lat, back, BIKE, 1.15, 2);
    this.stamp(line, d + 2, lat, back, ARROW, 1, 1);
  }

  /** Distance de chaque nœud au lieu, par les routes (Dijkstra). */
  private distances(place: PlanPlace): Float64Array {
    const N = this.graph.nodes.length / 3;
    const dist = new Float64Array(N).fill(Infinity);
    let start = 0;
    let best = Infinity;
    for (let n = 0; n < N; n++) {
      if (!this.nodes[n]?.some((b) => b.line.road)) continue;
      const d = Math.hypot((this.graph.nodes[n * 3] as number) - place.x, (this.graph.nodes[n * 3 + 2] as number) - place.z);
      if (d < best) {
        best = d;
        start = n;
      }
    }
    dist[start] = best;
    const queue = [start];
    while (queue.length) {
      let k = 0;
      for (let j = 1; j < queue.length; j++) if ((dist[queue[j] as number] as number) < (dist[queue[k] as number] as number)) k = j;
      const n = queue.splice(k, 1)[0] as number;
      for (const b of this.nodes[n] ?? []) {
        if (!b.line.road) continue;
        const m = b.atStart ? b.line.e.b : b.line.e.a;
        const d = (dist[n] as number) + b.line.length;
        if (d < (dist[m] as number)) {
          dist[m] = d;
          if (!queue.includes(m)) queue.push(m);
        }
      }
    }
    return dist;
  }

  // ───────────────────────────── Le long d'une route

  private edge(line: Line): void {
    const { e } = line;
    if (e.pts.length < 6) return;
    if (e.kind === 'cycleway') {
      for (const back of [false, true]) {
        for (let d = 14; d < line.length - 10; d += 140) this.bike(line, d, line.half / 2, back);
        if (line.length > 60) this.sign('cycleway', line, 7, back, undefined, 1.1);
      }
      return;
    }
    if (!line.road) return;
    this.curves(line);
    this.slopes(line);
    this.townLimits(line);
    // Boulevards : bande cyclable des deux côtés (la boucle de l'Anneau, sans voitures, n'en a pas).
    if (line.half >= 4 && e.name !== "L'Anneau")
      for (const back of [false, true]) {
        const lat = line.half - 1.75;
        for (let d = 12; d < line.length - 14; d += 5) this.paint(line, d, d + 3, lat - 0.08, lat + 0.08, back);
        for (let d = 24; d < line.length - 20; d += 90) this.bike(line, d, line.half - 1.02, back);
      }
    // Départementales hors village : rappel du partage de la route.
    if (line.rank === 4 && line.length > 900)
      for (const back of [false, true]) {
        const p = line.at(420, 0, back);
        if (!this.isUrban(p.x, p.z)) this.sign('cyclists', line, 420, back);
      }
  }

  private curves(line: Line): void {
    const limit = line.rank >= 3 ? 75 : 42;
    const N = Math.floor(line.length / STEP);
    if (N < 30) return;
    const head = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const a = line.at(Math.max(0, i * STEP - 3), 0, false);
      const b = line.at(Math.min(line.length, i * STEP + 3), 0, false);
      head[i] = Math.atan2(b.z - a.z, b.x - a.x);
    }
    const turn = (i: number, j: number) => {
      let t = (head[j] as number) - (head[i] as number);
      while (t > Math.PI) t -= 2 * Math.PI;
      while (t < -Math.PI) t += 2 * Math.PI;
      return t;
    };
    interface Run { a: number; b: number; angle: number; radius: number }
    const runs: Run[] = [];
    for (let i = 4; i < N - 4; i++) {
      const t = turn(i - 4, i + 4);
      const R = 16 / Math.max(Math.abs(t), 1e-6);
      if (R > limit) continue;
      const last = runs.at(-1);
      const step = turn(i, i + 1);
      if (last && i * STEP - last.b < 6 && Math.sign(last.angle || t) === Math.sign(t)) {
        last.b = i * STEP;
        last.angle += step;
        last.radius = Math.min(last.radius, R);
      } else runs.push({ a: i * STEP, b: i * STEP, angle: step || t / 8, radius: R });
    }
    const sharp = runs.filter((r) => Math.abs(r.angle) > 0.38);
    for (let k = 0; k < sharp.length; k++) {
      const r = sharp[k] as Run;
      const mid = line.at((r.a + r.b) / 2, 0, false);
      const urban = this.isUrban(mid.x, mid.z);
      // Axe continu dans le virage et à ses abords (routes à deux voies).
      if (line.half >= 2.2) this.paint(line, r.a - 22, r.b + 22, -0.07, 0.07, false);
      if (urban) continue;
      for (const back of [false, true]) {
        const start = back ? line.length - r.b : r.a;
        const before = sharp[back ? k + 1 : k - 1];
        const gapBefore = before ? (back ? before.a - r.b : r.a - before.b) : Infinity;
        // Virage suivant d'une même suite : un seul panneau, au premier.
        if (gapBefore < 90) continue;
        const next = sharp[back ? k - 1 : k + 1];
        const gapAfter = next ? (back ? r.a - next.b : next.a - r.b) : Infinity;
        const left = (r.angle < 0) !== back;
        const s = gapAfter < 60 && next && Math.sign(next.angle) !== Math.sign(r.angle);
        const d = Math.max(start - (line.rank >= 3 ? 80 : 50), 18);
        if (start - d < 20) continue;
        this.sign(s ? (left ? 'sLeft' : 'sRight') : left ? 'curveLeft' : 'curveRight', line, d, back);
      }
      // Chevrons à l'extérieur des virages serrés, lisibles dans les deux sens ; balises dans les autres.
      const out = r.angle > 0 ? -1 : 1;
      const serre = r.radius < 48 && Math.abs(r.angle) > 0.75;
      const gap = serre ? 9 : 12;
      for (let d = r.a - (serre ? 0 : 8); d <= r.b + (serre ? 2 : 8); d += gap) {
        const p = line.at(d, out * (line.half + 1.5), false);
        if (this.onRoad(p.x, p.z, 0.75)) continue;
        if (!serre) {
          this.cell(p.x, p.z).posts.push({ x: p.x, y: p.y, z: p.z });
          continue;
        }
        const c = this.cell(p.x, p.z);
        for (const back of [false, true]) {
          const k2 = back ? -1 : 1;
          const right = (r.angle > 0) !== back;
          // tourné un peu vers la chaussée (pas plus : les deux faces, dos à dos, se croiseraient)
          const tx = p.dx * k2;
          const tz = p.dz * k2;
          const nx = -p.dz * out * 0.12;
          const nz = p.dx * out * 0.12;
          const L = Math.hypot(tx + nx, tz + nz) || 1;
          c.signs.push({ x: p.x, y: p.y, z: p.z, dx: (tx + nx) / L, dz: (tz + nz) / L, kind: right ? 'chevronRight' : 'chevronLeft' });
        }
      }
    }
  }

  private slopes(line: Line): void {
    if (line.length < 320) return;
    const W = 260;
    for (const back of [false, true]) {
      let until = -1;
      for (let d = 30; d + W < line.length; d += 20) {
        if (d < until) continue;
        const a = line.at(d, 0, back);
        const b = line.at(d + W, 0, back);
        const g = ((b.y - a.y) / W) * 100;
        if (Math.abs(g) < 5.5 || this.isUrban(a.x, a.z)) continue;
        this.sign(g < 0 ? 'descent' : 'climb', line, d, back, Math.round(Math.abs(g)));
        until = d + 1500;
      }
    }
  }

  /** Entrée et sortie d'agglomération : là où la route gagne ou quitte les rues habitées. */
  private townLimits(line: Line): void {
    if (line.e.kind === 'residential') return;
    for (const back of [false, true]) {
      let inside = 0;
      let first = -1;
      for (let d = 0; d <= line.length; d += 8) {
        const p = line.at(d, 0, back);
        if (this.isUrban(p.x, p.z)) {
          if (inside === 0) first = d;
          inside += 8;
          if (inside === 80 && first > 24) {
            const name = this.townAt(p.x, p.z);
            const spot = name < 0 ? null : this.roadside(line, first, back, 1.7);
            if (spot) {
              this.cell(spot.x, spot.z).towns.push({ ...spot, place: name, exit: false });
              // Dos à dos sur l'autre rive : sortie, lue en quittant le village.
              const other = this.roadside(line, line.length - first, !back, 1.7);
              if (other) this.cell(other.x, other.z).towns.push({ ...other, place: name, exit: true });
            }
          }
        } else inside = 0;
      }
    }
  }

  private townAt(x: number, z: number): number {
    let best = -1;
    let bd = 1900;
    this.places.forEach((p, i) => {
      if (!SIGNED.has(p.kind)) return;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  // ───────────────────────────── Carrefours

  private junction(all: Branch[], routes: ReadonlyArray<Float64Array | null>): void {
    const roads = all.filter((b) => b.line.road);
    if (roads.length < 2) return;
    // À rang égal, la rue qui garde son nom de part et d'autre du carrefour est prioritaire.
    const rankOf = (b: Branch) => b.line.rank + (b.line.e.name && roads.some((o) => o !== b && o.line.e.name === b.line.e.name) ? 0.5 : 0);
    const top = Math.max(...roads.map(rankOf));
    const low = Math.min(...roads.map(rankOf));
    const n0 = roads[0] as Branch;
    const node = n0.line.at(0, 0, !n0.atStart);
    const urban = this.isUrban(node.x, node.z);
    const seed = Math.abs(Math.round(node.x * 7 + node.z * 13));
    for (const b of all) {
      const { line } = b;
      // On arrive au carrefour : abscisse `len − d`, sens de marche vers le carrefour.
      const back = b.atStart;
      const at = (d: number) => line.length - d;
      // Recul jusqu'au bord de la voie la plus large qui croise.
      let clear = line.half + 1;
      for (const o of all) {
        if (o === b) continue;
        const cross = Math.abs(b.ox * o.oz - b.oz * o.ox);
        const cos = b.ox * o.ox + b.oz * o.oz;
        if (cross < 0.35 && cos < 0) continue;
        clear = Math.max(clear, Math.min((o.line.half + 0.9 + line.half * Math.abs(cos)) / Math.max(cross, 0.35), 11));
      }
      if (line.length < clear + 14) continue;
      if (!line.road) {
        // Piste cyclable qui débouche : cédez-le-passage des vélos.
        if (line.e.kind === 'cycleway' && line.e.surface !== 'wood') this.yieldLine(line, at(clear), back);
        continue;
      }
      const minor = rankOf(b) < top;
      const walk = urban && line.half >= 2.5 && (seed + b.i) % 3 !== 0 && line.length > clear + 30;
      if (minor) {
        const stop = top >= 4 && (seed + b.i) % 3 === 0;
        if (stop) this.paint(line, at(clear + 0.5), at(clear), 0.1, line.half - 0.12, back);
        else this.yieldLine(line, at(clear), back);
        this.sign(stop ? 'stop' : 'yield', line, at(clear + 0.4), back);
        if (line.half >= 2.2) this.paint(line, at(clear + 24), at(clear + (walk ? 5.5 : 0.6)), -0.07, 0.07, back);
      } else if (low < top && !urban && line.rank >= 3 && line.length > 190) this.sign('priority', line, at(110), back);
      else if (low === top && !urban && line.length > 130) this.sign('crossing', line, at(75), back);
      if (walk) {
        const d0 = at(clear + 4.2);
        for (let a = -line.half + 0.3; a + 0.5 <= line.half - 0.2; a += 1) this.paint(line, d0, d0 + 2.6, a, a + 0.5, back);
        if (!minor) this.sign('pedestrians', line, at(clear + 5), back);
      }
      // Rue habitée prise depuis une route plus importante : zone 30, lue en y entrant.
      if (minor && line.e.kind === 'residential' && (top >= 3 || line.rank < Math.floor(top))) this.sign('zone30', line, clear + 6, !back);
      this.directions(b, roads, routes, urban, back);
    }
  }

  private yieldLine(line: Line, d: number, back: boolean): void {
    for (let a = 0.12; a + 0.4 <= line.half - 0.05; a += 0.75) this.paint(line, d - 0.5, d, a, a + 0.45, back);
  }

  private directions(b: Branch, roads: Branch[], routes: ReadonlyArray<Float64Array | null>, urban: boolean, back: boolean): void {
    const { line } = b;
    if (roads.length < 3 || line.length < 70) return;
    // Petite route à l'écart : pas de panneau si rien d'important ne croise.
    if (line.rank < 2 && Math.max(...roads.map((r) => r.line.rank)) < 3) return;
    const lines: Array<DirectionLine & { rank: number }> = [];
    routes.forEach((dist, place) => {
      if (!dist) return;
      let best: Branch | null = null;
      let bd = Infinity;
      for (const o of roads) {
        const d = o.line.length + (dist[o.atStart ? o.line.e.b : o.line.e.a] as number);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (!best || best === b || bd < 350 || !Number.isFinite(bd)) return;
      // Virage : sens d'arrivée (−o) vers sens de sortie.
      const ax = -b.ox;
      const az = -b.oz;
      const deg = (Math.atan2(ax * best.oz - az * best.ox, ax * best.ox + az * best.oz) * 180) / Math.PI;
      lines.push({ place, km: Math.max(1, Math.round(bd / 1000)), arrow: deg > 35 ? 'right' : deg < -35 ? 'left' : 'straight', rank: bd });
    });
    if (lines.length < 2) return;
    const shown: DirectionLine[] = [];
    for (const arrow of ['straight', 'left', 'right'] as const) {
      const of = lines.filter((l) => l.arrow === arrow).sort((p, q) => p.rank - q.rank);
      for (const l of of.slice(0, 2)) shown.push({ place: l.place, km: l.km, arrow });
    }
    const p = this.roadside(line, line.length - Math.min(urban ? 34 : 62, line.length * 0.45), back, 2.1);
    if (!p) return;
    const c = this.cell(p.x, p.z);
    if (c.panels.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 25)) return;
    c.signs = c.signs.filter((s) => Math.hypot(s.x - p.x, s.z - p.z) > 7);
    c.panels.push({ ...p, lines: shown.slice(0, 5) });
  }
}

/** Plan complet, par pas (file d'attente du jeu). Le résultat est la valeur de retour du générateur. */
export function* planRoads(graph: RoadGraphData, places: readonly PlanPlace[]): Generator<void, RoadPlan> {
  const planner = new Planner(graph, places);
  yield* planner.run();
  return { cells: planner.cells, places };
}

/** Plan d'un seul tenant (tests, outils). */
export function planRoadsNow(graph: RoadGraphData, places: readonly PlanPlace[]): RoadPlan {
  const steps = planRoads(graph, places);
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}
