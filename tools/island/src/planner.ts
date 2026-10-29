/**
 * Tracé automatique du réseau : recherche de chemin (A*) sur une grille de 20 m qui suit le relief (pente
 * bornée par catégorie de route), réutilise les routes déjà tracées, refuse les raccords en biseau et les
 * croisements sans carrefour ; puis découpe du réseau en tronçons entre carrefours.
 */
import type { Vec2 } from './design.ts';

export const CELL = 20;

export interface RoadClass {
  id: string;
  kind: string;
  width: number;
  surface: string;
  /** Pente maximale (fraction) et pénalité de pente. */
  gmax: number;
  gpen: number;
  /** Coût relatif sur une route déjà tracée de rang ≥ (fusion des tracés). */
  reuse: number;
  /** Rang : un tronçon commun prend la catégorie la plus forte. */
  rank: number;
}

export const CLASSES = {
  secondary: { id: 'secondary', kind: 'secondary', width: 7, surface: 'asphalt', gmax: 0.075, gpen: 3, reuse: 0.3, rank: 7 },
  tertiary: { id: 'tertiary', kind: 'tertiary', width: 6, surface: 'asphalt', gmax: 0.09, gpen: 2.5, reuse: 0.35, rank: 6 },
  lane: { id: 'lane', kind: 'unclassified', width: 4.5, surface: 'asphalt', gmax: 0.11, gpen: 2, reuse: 0.4, rank: 5 },
  cycleway: { id: 'cycleway', kind: 'cycleway', width: 4, surface: 'asphalt', gmax: 0.04, gpen: 4, reuse: 0.45, rank: 4 },
  track: { id: 'track', kind: 'track', width: 3.2, surface: 'gravel', gmax: 0.13, gpen: 1.5, reuse: 0.5, rank: 3 },
  mtb: { id: 'mtb', kind: 'track', width: 2.4, surface: 'dirt', gmax: 0.2, gpen: 0.8, reuse: 0.6, rank: 2 },
} satisfies Record<string, RoadClass>;

export const CLASS_BY_RANK: Record<number, RoadClass> = Object.fromEntries(Object.values(CLASSES).map((c) => [c.rank, c]));

/** 16 directions : voisins directs, diagonales et sauts de cavalier (tracés moins anguleux). */
const MOVES: Array<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2],
];
const COS_MERGE = Math.cos((50 * Math.PI) / 180);

export class Grid {
  readonly n: number;
  readonly m: number;
  readonly N: number;
  /** Altitude au centre des cases. */
  h: Float32Array;
  /** 1 : mer, lac, bassin (infranchissable) ; 2 : lit de rivière (franchissable, coûteux). */
  water: Uint8Array;
  /** Case réservée (route dessinée, bâtiment remarquable) : interdite sauf départ et arrivée. */
  block: Uint8Array;
  /** Rang de la route qui occupe la case (0 : libre). */
  occ: Uint8Array;
  /** Case voisine d'une route (on évite de longer une route à 20 m). */
  near: Uint8Array;
  dirX: Float32Array;
  dirZ: Float32Array;
  /** Variation de coût (bruit) : tracés moins rectilignes. */
  wob: Float32Array;
  /** Liens entre cases (clé a·N + b, a < b) → rang, et nom du tracé le plus fort. */
  links = new Map<number, number>();
  labels = new Map<number, string>();
  /** Coordonnées exactes de certaines cases (portes des routes dessinées). */
  exact = new Map<number, Vec2>();
  /** Cases imposées comme carrefours. */
  forced = new Set<number>();
  private g: Float64Array;
  private from: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private run = 0;

  constructor(
    readonly x0: number,
    readonly z0: number,
    width: number,
    height: number,
    /** Côté des cases (m). */
    readonly cs = CELL,
  ) {
    this.n = Math.ceil(width / cs);
    this.m = Math.ceil(height / cs);
    this.N = this.n * this.m;
    const N = this.N;
    this.h = new Float32Array(N);
    this.water = new Uint8Array(N);
    this.block = new Uint8Array(N);
    this.occ = new Uint8Array(N);
    this.near = new Uint8Array(N);
    this.dirX = new Float32Array(N);
    this.dirZ = new Float32Array(N);
    this.wob = new Float32Array(N);
    this.g = new Float64Array(N);
    this.from = new Int32Array(N);
    this.stamp = new Uint32Array(N);
    this.closed = new Uint32Array(N);
  }

  cellAt(x: number, z: number): number {
    const i = Math.max(0, Math.min(this.n - 1, Math.floor((x - this.x0) / this.cs)));
    const j = Math.max(0, Math.min(this.m - 1, Math.floor((z - this.z0) / this.cs)));
    return j * this.n + i;
  }

  center(c: number): Vec2 {
    const e = this.exact.get(c);
    if (e) return e;
    return [this.x0 + ((c % this.n) + 0.5) * this.cs, this.z0 + (Math.floor(c / this.n) + 0.5) * this.cs];
  }

  private key(a: number, b: number): number {
    return a < b ? a * this.N + b : b * this.N + a;
  }

  hasLink(a: number, b: number): boolean {
    return this.links.has(this.key(a, b));
  }

  /** Le segment a → b croise-t-il un lien existant (sans case commune) ? */
  private crosses(a: number, b: number): boolean {
    const ai = a % this.n;
    const aj = Math.floor(a / this.n);
    const bi = b % this.n;
    const bj = Math.floor(b / this.n);
    if (Math.abs(ai - bi) + Math.abs(aj - bj) < 2) return false;
    const i0 = Math.min(ai, bi);
    const i1 = Math.max(ai, bi);
    const j0 = Math.min(aj, bj);
    const j1 = Math.max(aj, bj);
    const cells: number[] = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (j * this.n + i !== a && j * this.n + i !== b) cells.push(j * this.n + i);
    for (let p = 0; p < cells.length; p++)
      for (let q = p + 1; q < cells.length; q++) {
        if (!this.hasLink(cells[p]!, cells[q]!)) continue;
        if (segCross(ai, aj, bi, bj, cells[p]! % this.n, Math.floor(cells[p]! / this.n), cells[q]! % this.n, Math.floor(cells[q]! / this.n))) return true;
      }
    // Liens qui sortent de la boîte mais la traversent (cavaliers voisins) : cases à un pas autour.
    for (let j = j0 - 1; j <= j1 + 1; j++)
      for (let i = i0 - 1; i <= i1 + 1; i++) {
        if (i >= i0 && i <= i1 && j >= j0 && j <= j1) continue;
        const c = j * this.n + i;
        if (i < 0 || j < 0 || i >= this.n || j >= this.m || !this.occ[c]) continue;
        for (const [di, dj] of MOVES) {
          const d = (j + dj) * this.n + (i + di);
          if (d === a || d === b || c === a || c === b) continue;
          if (i + di < 0 || j + dj < 0 || i + di >= this.n || j + dj >= this.m) continue;
          if (!this.hasLink(c, d)) continue;
          if (segCross(ai, aj, bi, bj, i, j, i + di, j + dj)) return true;
        }
      }
    return false;
  }

  /**
   * Chemin de moindre coût de `start` vers `goal` (case) ou vers la première case qui satisfait `goal`.
   * `box` : marge (cases) autour du départ et de l'arrivée.
   */
  search(start: number, goal: number | ((c: number) => boolean), cls: RoadClass, opts: { box?: number; maxExp?: number; loose?: boolean; nocross?: boolean; toward?: number } = {}): number[] | null {
    const n = this.n;
    const run = ++this.run;
    const single = typeof goal === 'number';
    // Cible connue (case d'arrivée, ou case visée par une arrivée « route la plus proche ») : emprise et estimation.
    const aim = single ? (goal as number) : opts.toward ?? -1;
    const gi = aim >= 0 ? aim % n : 0;
    const gj = aim >= 0 ? Math.floor(aim / n) : 0;
    const si = start % n;
    const sj = Math.floor(start / n);
    const margin = opts.box ?? 200;
    const i0 = Math.max(0, Math.min(si, aim >= 0 ? gi : si) - margin);
    const i1 = Math.min(n - 1, Math.max(si, aim >= 0 ? gi : si) + margin);
    const j0 = Math.max(0, Math.min(sj, aim >= 0 ? gj : sj) - margin);
    const j1 = Math.min(this.m - 1, Math.max(sj, aim >= 0 ? gj : sj) + margin);
    const heap = new Heap();
    const hOf = (c: number) => (aim >= 0 ? Math.max(0, Math.hypot((c % n) - gi, Math.floor(c / n) - gj) * this.cs - 500) * 0.7 : 0);
    this.g[start] = 0;
    this.stamp[start] = run;
    this.from[start] = -1;
    heap.push(start, hOf(start));
    let exp = 0;
    const maxExp = opts.maxExp ?? 6_000_000;
    while (heap.size) {
      const a = heap.pop();
      if (this.closed[a] === run) continue;
      this.closed[a] = run;
      const isGoal = single ? a === goal : a !== start && (goal as (c: number) => boolean)(a);
      if (isGoal) {
        const path: number[] = [];
        for (let c = a; c !== -1; c = this.from[c]!) path.push(c);
        return path.reverse();
      }
      if (++exp > maxExp) return null;
      const ai = a % n;
      const aj = Math.floor(a / n);
      for (const [di, dj] of MOVES) {
        const bi = ai + di;
        const bj = aj + dj;
        if (bi < i0 || bi > i1 || bj < j0 || bj > j1) continue;
        const b = bj * n + bi;
        if (this.closed[b] === run) continue;
        const target = single ? b === goal : false;
        if (this.water[b] === 1 && !target) continue;
        if (this.block[b] && !target && b !== start) continue;
        const L = Math.hypot(di, dj) * this.cs;
        const grade = Math.abs(this.h[b]! - this.h[a]!) / L;
        if (grade > cls.gmax && !target) continue;
        // Raccord franc : jamais d'arrivée ni de départ en biseau sur une route existante.
        if (!opts.loose && this.occ[b] && !this.occ[a] && Math.abs(di * this.dirX[b]! + dj * this.dirZ[b]!) / Math.hypot(di, dj) > COS_MERGE) continue;
        if (!opts.loose && this.occ[a] && !this.occ[b] && Math.abs(di * this.dirX[a]! + dj * this.dirZ[a]!) / Math.hypot(di, dj) > COS_MERGE) continue;
        if (!opts.nocross && ((di && dj) || Math.abs(di) + Math.abs(dj) > 1)) if (this.crosses(a, b)) continue;
        let cost = L * (1 + cls.gpen * (grade / cls.gmax) ** 2) * this.wob[b]!;
        const o = this.occ[b]!;
        if (o) cost *= cls.id === 'cycleway' && o > cls.rank ? 3 : o >= cls.rank ? cls.reuse : 0.75;
        else if (this.near[b]) cost *= 3;
        if (this.water[b] === 2) cost += cls.rank >= 5 ? 500 : 250;
        const g = this.g[a]! + cost;
        if (this.stamp[b] !== run || g < this.g[b]!) {
          this.stamp[b] = run;
          this.g[b] = g;
          this.from[b] = a;
          heap.push(b, g + hOf(b));
        }
      }
    }
    return null;
  }

  /** Inscrit un chemin dans le réseau. */
  commit(path: number[], cls: RoadClass, label: string): void {
    const n = this.n;
    for (let k = 0; k < path.length; k++) {
      const c = path[k]!;
      if (k > 0) {
        const key = this.key(path[k - 1]!, c);
        const old = this.links.get(key) ?? 0;
        if (cls.rank >= old) this.labels.set(key, label);
        this.links.set(key, Math.max(old, cls.rank));
      }
      const p = path[Math.max(0, k - 1)]!;
      const q = path[Math.min(path.length - 1, k + 1)]!;
      const dx = (q % n) - (p % n);
      const dz = Math.floor(q / n) - Math.floor(p / n);
      const l = Math.hypot(dx, dz) || 1;
      if (!this.occ[c]) {
        this.dirX[c] = dx / l;
        this.dirZ[c] = dz / l;
      }
      this.occ[c] = Math.max(this.occ[c]!, cls.rank);
      const i = c % n;
      const j = Math.floor(c / n);
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < n && jj < this.m) this.near[jj * n + ii] = 1;
        }
    }
  }

  /** Tronçons entre carrefours : suites de cases et rang. */
  edges(): Array<{ cells: number[]; rank: number; label: string }> {
    const adj = new Map<number, Array<[number, number]>>();
    for (const [key, rank] of this.links) {
      const a = Math.floor(key / this.N);
      const b = key % this.N;
      (adj.get(a) ?? adj.set(a, []).get(a)!).push([b, rank]);
      (adj.get(b) ?? adj.set(b, []).get(b)!).push([a, rank]);
    }
    const isNode = (c: number) => {
      const l = adj.get(c)!;
      return l.length !== 2 || l[0]![1] !== l[1]![1] || this.exact.has(c) || this.forced.has(c);
    };
    const seen = new Set<number>();
    const out: Array<{ cells: number[]; rank: number; label: string }> = [];
    const walk = (a: number, b: number, rank: number) => {
      const cells = [a, b];
      seen.add(this.key(a, b));
      let prev = a;
      let cur = b;
      while (!isNode(cur)) {
        const nxt = adj.get(cur)!.find(([c]) => c !== prev)!;
        const k = this.key(cur, nxt[0]);
        if (seen.has(k)) break;
        seen.add(k);
        prev = cur;
        cur = nxt[0];
        cells.push(cur);
      }
      out.push({ cells, rank, label: this.labels.get(this.key(a, b)) ?? '' });
    };
    for (const [a, l] of adj) if (isNode(a)) for (const [b, rank] of l) if (!seen.has(this.key(a, b))) walk(a, b, rank);
    // Boucles sans carrefour.
    for (const [a, l] of adj)
      for (const [b, rank] of l)
        if (!seen.has(this.key(a, b))) {
          this.forced.add(a);
          walk(a, b, rank);
        }
    return out;
  }
}

function segCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const rx = bx - ax;
  const rz = bz - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

/** Tas binaire (clé : priorité). */
class Heap {
  private ids: number[] = [];
  private pri: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, p: number): void {
    const ids = this.ids;
    const pri = this.pri;
    let i = ids.length;
    ids.push(id);
    pri.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pri[parent]! <= p) break;
      ids[i] = ids[parent]!;
      pri[i] = pri[parent]!;
      i = parent;
    }
    ids[i] = id;
    pri[i] = p;
  }
  pop(): number {
    const ids = this.ids;
    const pri = this.pri;
    const top = ids[0]!;
    const lastId = ids.pop()!;
    const lastP = pri.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && pri[r]! < pri[l]! ? r : l;
        if (pri[c]! >= lastP) break;
        ids[i] = ids[c]!;
        pri[i] = pri[c]!;
        i = c;
      }
      ids[i] = lastId;
      pri[i] = lastP;
    }
    return top;
  }
}
