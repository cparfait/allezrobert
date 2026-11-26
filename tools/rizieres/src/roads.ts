/**
 * Routes de l'île : polylignes tous les 2 m avec profil en long, index spatial, sol arasé sous la chaussée,
 * graphe routier (nœuds aux extrémités, aux raccords et aux croisements).
 */
import type { RoadGraphData, RoadGraphEdge } from '../../../packages/shared/src/roadgraph.ts';
import { terrain, type Vec2 } from './design.ts';
import { chaikin, projectSeg, resample, type Vec3 } from './geom.ts';

export const STEP = 2;
export const ATTRIBUTION = ["Les Rizières et la jungle — monde imaginaire d'Allez Robert ! (généré par tools/rizieres)"];
export const r2 = (v: number) => Math.round(v * 100) / 100;

export interface Road {
  id: string;
  name: string;
  kind: string;
  width: number;
  surface: string;
  loop: boolean;
  /** Points tous les 2 m [x, y, z] ; boucle : le dernier précède le premier. */
  pts: Vec3[];
  /** Demi-largeur arasée (chaussée + accotement) et largeur du raccord au terrain naturel. */
  flat: number;
  blend: number;
  /** Route dessinée (rues, anneau, front de mer) plutôt que tracée par la recherche de chemin. */
  designed?: boolean;
  /** Pente maximale visée (fraction). */
  gmax: number;
}

export interface RoadSpec {
  id: string;
  name: string;
  kind: string;
  width: number;
  pts: Vec2[];
  loop?: boolean;
  surface?: string;
  /** Lissage des angles (itérations de Chaikin), 0 pour un tracé déjà lisse. */
  smooth?: number;
  gmax?: number;
  designed?: boolean;
  /** Altitudes imposées aux extrémités (raccords). */
  y0?: number;
  y1?: number;
}

/** Altitude d'un carrefour : terrain moyen sur un disque de 14 m (même valeur pour toutes les routes). */
export function nodeHeight(x: number, z: number): number {
  let s = terrain(x, z) * 2;
  let c = 2;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    s += terrain(x + Math.cos(a) * 14, z + Math.sin(a) * 14);
    c++;
  }
  return s / c;
}

/** Profil en long : moyenne glissante du terrain (± `win` m), extrémités imposées, pente plafonnée. */
export function profile(xz: Vec2[], loop: boolean, win: number, maxGrade: number, y0?: number, y1?: number): number[] {
  // Extrémité sans altitude valide : laissée libre (sinon tout le profil devient NaN).
  if (y0 !== undefined && !Number.isFinite(y0)) y0 = undefined;
  if (y1 !== undefined && !Number.isFinite(y1)) y1 = undefined;
  const n = xz.length;
  const raw = xz.map(([x, z]) => terrain(x, z));
  const k = Math.max(1, Math.round(win / STEP));
  // Moyenne glissante par sommes cumulées.
  const y = new Array<number>(n);
  if (loop) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = -k; j <= k; j++) s += raw[(i + j + n) % n]!;
      y[i] = s / (2 * k + 1);
    }
  } else {
    const cum = [0];
    for (let i = 0; i < n; i++) cum.push(cum[i]! + raw[i]!);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - k);
      const b = Math.min(n - 1, i + k);
      y[i] = (cum[b + 1]! - cum[a]!) / (b - a + 1);
    }
  }
  if (!loop && n > 1) {
    // Extrémités imposées : écart réparti sur 80 m (ou la moitié de la route).
    const span = Math.max(1, Math.min(Math.round(80 / STEP), Math.floor((n - 1) / 2)));
    const d0 = y0 === undefined ? 0 : y0 - y[0]!;
    const d1 = y1 === undefined ? 0 : y1 - y[n - 1]!;
    for (let i = 0; i <= span; i++) {
      const t = 1 - i / span;
      y[i] = y[i]! + d0 * t * t * (3 - 2 * t);
      y[n - 1 - i] = y[n - 1 - i]! + d1 * t * t * (3 - 2 * t);
    }
  }
  // Pente plafonnée dans les deux sens ; extrémités imposées conservées. En montagne, deux extrémités imposées plus
  // écartées que la pente plafond ne le permet relèvent le plafond (sinon une marche au raccord).
  const need = y0 !== undefined && y1 !== undefined && n > 1 ? (Math.abs(y1 - y0) / ((n - 1) * STEP)) * 1.12 : 0;
  const lim = Math.max(maxGrade, need) * STEP;
  const pin0 = y0 !== undefined ? y[0]! : null;
  const pin1 = y1 !== undefined ? y[n - 1]! : null;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < n; i++) y[i] = Math.min(y[i - 1]! + lim, Math.max(y[i - 1]! - lim, y[i]!));
    if (pin1 !== null) y[n - 1] = pin1;
    for (let i = n - 2; i >= 0; i--) y[i] = Math.min(y[i + 1]! + lim, Math.max(y[i + 1]! - lim, y[i]!));
    if (pin0 !== null) y[0] = pin0;
  }
  // Raccords de pente arrondis (moyenne glissante sur ± 16 m, deux fois) : sans cassure du profil, le sol du jeu
  // (facettes de ≈ 8 m) ne passe jamais au-dessus de la chaussée dans un creux. La moyenne de pentes ≤ la
  // pente plafond reste sous le plafond ; extrémités inchangées.
  if (n > 5)
    for (let pass = 0; pass < 3; pass++) {
      const src = y.slice();
      const K = 8;
      for (let i = 0; i < n; i++) {
        // Fenêtre symétrique, rétrécie près des extrémités (qui restent en place).
        const k = loop ? K : Math.min(K, i, n - 1 - i);
        if (k === 0) continue;
        let s2 = 0;
        for (let j = i - k; j <= i + k; j++) s2 += src[loop ? (j + n) % n : j]!;
        y[i] = s2 / (2 * k + 1);
      }
    }
  return y;
}

export function makeRoad(s: RoadSpec): Road {
  const loop = !!s.loop;
  const sm = s.smooth ?? 4;
  const xz = loop ? resample(s.pts, STEP, true) : resample(sm ? chaikin(s.pts, sm) : s.pts, STEP);
  const gmax = s.gmax ?? 0.09;
  const y = profile(xz, loop, s.kind === 'track' ? 24 : 30, gmax, s.y0, s.y1);
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    width: s.width,
    surface: s.surface ?? 'asphalt',
    loop,
    pts: xz.map(([x, z], i) => [x, y[i]!, z]),
    flat: s.width / 2 + (s.kind === 'track' ? 0.8 : 1.5),
    blend: s.kind === 'track' ? 5 : 7,
    gmax,
    ...(s.designed ? { designed: true } : {}),
  };
}

// ── Index spatial des segments ──

export class SegGrid<T> {
  private cells = new Map<number, Array<{ ax: number; az: number; bx: number; bz: number; data: T; i: number }>>();
  constructor(private readonly cs: number) {}
  private key(i: number, j: number) {
    return i * 1000003 + j;
  }
  add(ax: number, az: number, bx: number, bz: number, data: T, i: number, reach = 0): void {
    const e = { ax, az, bx, bz, data, i };
    for (let ci = Math.floor((Math.min(ax, bx) - reach) / this.cs); ci <= Math.floor((Math.max(ax, bx) + reach) / this.cs); ci++)
      for (let cj = Math.floor((Math.min(az, bz) - reach) / this.cs); cj <= Math.floor((Math.max(az, bz) + reach) / this.cs); cj++) {
        const k = this.key(ci, cj);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(e);
      }
  }
  at(x: number, z: number) {
    return this.cells.get(this.key(Math.floor(x / this.cs), Math.floor(z / this.cs))) ?? [];
  }
  near(x: number, z: number, r: number) {
    const out = new Set<{ ax: number; az: number; bx: number; bz: number; data: T; i: number }>();
    for (let ci = Math.floor((x - r) / this.cs); ci <= Math.floor((x + r) / this.cs); ci++)
      for (let cj = Math.floor((z - r) / this.cs); cj <= Math.floor((z + r) / this.cs); cj++) for (const e of this.cells.get(this.key(ci, cj)) ?? []) out.add(e);
    return [...out];
  }
}

export function roadSegGrid(roads: Road[], cs = 32): SegGrid<Road> {
  const g = new SegGrid<Road>(cs);
  for (const r of roads) {
    const n = r.pts.length;
    for (let i = 0; i < (r.loop ? n : n - 1); i++) {
      const a = r.pts[i]!;
      const b = r.pts[(i + 1) % n]!;
      g.add(a[0], a[2], b[0], b[2], r, i);
    }
  }
  return g;
}

/** Point le plus proche d'une route : index du segment, paramètre, distance, altitude. */
export function nearestOn(road: Road, x: number, z: number): { i: number; t: number; d: number; y: number } {
  let best = { i: 0, t: 0, d: Infinity, y: 0 };
  const n = road.pts.length;
  const segs = road.loop ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = road.pts[i]!;
    const b = road.pts[(i + 1) % n]!;
    const p = projectSeg(x, z, a[0], a[2], b[0], b[2]);
    if (p.d < best.d) best = { i, t: p.t, d: p.d, y: a[1] + (b[1] - a[1]) * p.t };
  }
  return best;
}

/** Point le plus proche parmi les routes d'un index (null au-delà de `r`). */
export function nearestRoad(g: SegGrid<Road>, x: number, z: number, r: number, skip?: Road): { road: Road; i: number; t: number; d: number; y: number } | null {
  let best: { road: Road; i: number; t: number; d: number; y: number } | null = null;
  for (const e of g.near(x, z, r)) {
    if (e.data === skip) continue;
    const p = projectSeg(x, z, e.ax, e.az, e.bx, e.bz);
    if (p.d > r || (best && p.d >= best.d)) continue;
    const a = e.data.pts[e.i]!;
    const b = e.data.pts[(e.i + 1) % e.data.pts.length]!;
    best = { road: e.data, i: e.i, t: p.t, d: p.d, y: a[1] + (b[1] - a[1]) * p.t };
  }
  return best;
}

/**
 * Raccords : l'extrémité d'une route posée sur une autre prend la position et l'altitude du point qui
 * portera le nœud ; l'écart est réparti sur les 40 m qui précèdent.
 */
export function snapEnds(road: Road, onto: Road[], fallback: Road[] = [], reach = 4): void {
  for (const end of [0, road.pts.length - 1]) {
    const p = road.pts[end]!;
    let target: Vec3 | null = null;
    let bestD = reach;
    for (const o of onto.some((q) => q !== road && nearestOn(q, p[0], p[2]).d < reach) ? onto : fallback) {
      if (o === road) continue;
      const q = nearestOn(o, p[0], p[2]);
      if (q.d < bestD) {
        bestD = q.d;
        target = o.pts[q.t < 0.5 ? q.i : (q.i + 1) % o.pts.length]!;
      }
    }
    if (target === null) continue;
    p[0] = target[0];
    p[2] = target[2];
    const delta = target[1] - p[1];
    const span = Math.round(40 / STEP);
    for (let k = 0; k <= span && k < road.pts.length; k++) {
      const idx = end === 0 ? k : road.pts.length - 1 - k;
      road.pts[idx]![1] += delta * (1 - k / span);
    }
  }
}

// ── Terrain arasé sous les routes ──

/** Largeur maximale des talus (m). */
const MAX_BLEND = 30;

export class RoadIndex {
  private cells = new Map<number, Array<{ r: Road; i: number }>>();
  private readonly cs = 25;
  constructor(readonly roads: Road[]) {
    for (const r of roads) {
      const n = r.pts.length;
      const segs = r.loop ? n : n - 1;
      const reach = r.flat + 2.2 + MAX_BLEND;
      for (let i = 0; i < segs; i++) {
        const a = r.pts[i]!;
        const b = r.pts[(i + 1) % n]!;
        const x0 = Math.floor((Math.min(a[0], b[0]) - reach) / this.cs);
        const x1 = Math.floor((Math.max(a[0], b[0]) + reach) / this.cs);
        const z0 = Math.floor((Math.min(a[2], b[2]) - reach) / this.cs);
        const z1 = Math.floor((Math.max(a[2], b[2]) + reach) / this.cs);
        for (let cx = x0; cx <= x1; cx++)
          for (let cz = z0; cz <= z1; cz++) {
            const k = cx * 1000003 + cz;
            let l = this.cells.get(k);
            if (!l) this.cells.set(k, (l = []));
            l.push({ r, i });
          }
      }
    }
  }

  /** Route la plus « contraignante » au point : distance, altitude de chaussée, route. */
  query(x: number, z: number): { d: number; y: number; r: Road } | null {
    const l = this.cells.get(Math.floor(x / this.cs) * 1000003 + Math.floor(z / this.cs));
    if (!l) return null;
    let best: { d: number; y: number; r: Road; score: number } | null = null;
    for (const { r, i } of l) {
      const n = r.pts.length;
      const a = r.pts[i]!;
      const b = r.pts[(i + 1) % n]!;
      const p = projectSeg(x, z, a[0], a[2], b[0], b[2]);
      if (p.d > r.flat + r.blend) continue;
      // La chaussée la plus proche (relativement à sa largeur) l'emporte.
      const score = p.d - r.flat;
      if (!best || score < best.score) best = { d: p.d, y: a[1] + (b[1] - a[1]) * p.t, r, score };
    }
    return best;
  }

  /** Sol arasé : minimum, sur les routes proches, de leur chaussée (−10 cm) raccordée au terrain `h0`. */
  lowest(x: number, z: number, h0: number): number {
    const l = this.cells.get(Math.floor(x / this.cs) * 1000003 + Math.floor(z / this.cs));
    if (!l) return h0;
    let h = h0;
    let touched = false;
    for (const { r, i } of l) {
      const a = r.pts[i]!;
      const b = r.pts[(i + 1) % r.pts.length]!;
      const p = projectSeg(x, z, a[0], a[2], b[0], b[2]);
      // Plateforme arasée une case de grille (2 m) au-delà de l'accotement : entre deux sommets de la grille,
      // le sol interpolé ne remonte jamais au-dessus de la chaussée.
      const flat = r.flat + 2.2;
      if (p.d > flat + MAX_BLEND) continue;
      const under = a[1] + (b[1] - a[1]) * p.t - 0.1;
      // Talus : au moins 1,6 m de large par mètre de hauteur (tranchées et remblais en pente douce, jamais de
      // mur de terre au bord d'une route en tranchée).
      const blend = Math.min(MAX_BLEND, Math.max(r.blend, Math.abs(h0 - under) * 1.6));
      if (p.d > flat + blend) continue;
      const v = p.d <= flat ? under : under + (h0 - under) * smoothstep01((p.d - flat) / blend);
      if (!touched || v < h) h = v;
      touched = true;
    }
    return h;
  }

  /** Distance à la chaussée la plus proche (bord compris), Infinity au-delà de la zone indexée. */
  edgeDist(x: number, z: number): number {
    const l = this.cells.get(Math.floor(x / this.cs) * 1000003 + Math.floor(z / this.cs));
    if (!l) return Infinity;
    let best = Infinity;
    for (const { r, i } of l) {
      const a = r.pts[i]!;
      const b = r.pts[(i + 1) % r.pts.length]!;
      best = Math.min(best, projectSeg(x, z, a[0], a[2], b[0], b[2]).d - r.width / 2);
    }
    return best;
  }
}

const smoothstep01 = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/**
 * Altitude finale : terrain naturel, arasé 10 cm sous la chaussée et ses accotements, raccordé au-delà.
 * Plusieurs routes (carrefours) : le sol le plus bas l'emporte, jamais de terre au-dessus d'une chaussée.
 */
export function finalHeight(idx: RoadIndex, x: number, z: number): number {
  const h0 = terrain(x, z);
  return idx.lowest(x, z, h0);
}

// ── Graphe routier ──

/** Paramètres (t, u) du croisement de deux segments en plan, extrémités comprises ; null s'ils ne se coupent pas. */
export function segCross(p: Vec3, q: Vec3, u: Vec3, v: Vec3): [number, number] | null {
  const rx = q[0] - p[0];
  const rz = q[2] - p[2];
  const sx = v[0] - u[0];
  const sz = v[2] - u[2];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((u[0] - p[0]) * sz - (u[2] - p[2]) * sx) / den;
  const w = ((u[0] - p[0]) * rz - (u[2] - p[2]) * rx) / den;
  return t >= 0 && t <= 1 && w >= 0 && w <= 1 ? [t, w] : null;
}

export interface Crossing {
  ra: Road;
  i: number;
  ta: number;
  rb: Road;
  j: number;
  tb: number;
}

/** Croisements entre routes, hors des abords (8 m) d'une extrémité (raccords en T, gérés à part). */
export function findCrossings(roads: Road[]): Crossing[] {
  const grid = roadSegGrid(roads, 24);
  const out: Crossing[] = [];
  const ends = (r: Road): Vec3[] => (r.loop ? [] : [r.pts[0]!, r.pts[r.pts.length - 1]!]);
  for (const ra of roads) {
    const na = ra.pts.length;
    for (let i = 0; i < (ra.loop ? na : na - 1); i++) {
      const p = ra.pts[i]!;
      const q = ra.pts[(i + 1) % na]!;
      for (const e of grid.near((p[0] + q[0]) / 2, (p[2] + q[2]) / 2, 3)) {
        const rb = e.data;
        if (rb === ra || rb.id < ra.id) continue;
        const nb = rb.pts.length;
        const u = rb.pts[e.i]!;
        const v = rb.pts[(e.i + 1) % nb]!;
        const c = segCross(p, q, u, v);
        if (!c) continue;
        const x = p[0] + (q[0] - p[0]) * c[0];
        const z = p[2] + (q[2] - p[2]) * c[0];
        if ([...ends(ra), ...ends(rb)].some((w) => Math.hypot(w[0] - x, w[2] - z) < 8)) continue;
        if (out.some((o) => o.ra === ra && o.rb === rb && Math.abs(o.i - i) < 4)) continue;
        out.push({ ra, i, ta: c[0], rb, j: e.i, tb: c[1] });
      }
    }
  }
  return out;
}

/** Croisements : les deux routes passent à la même altitude (écart réparti sur ± 40 m de chacune). */
export function joinCrossings(roads: Road[]): number {
  const xs = findCrossings(roads);
  for (const c of xs) {
    const ya = c.ra.pts[c.i]![1] + (c.ra.pts[(c.i + 1) % c.ra.pts.length]![1] - c.ra.pts[c.i]![1]) * c.ta;
    const yb = c.rb.pts[c.j]![1] + (c.rb.pts[(c.j + 1) % c.rb.pts.length]![1] - c.rb.pts[c.j]![1]) * c.tb;
    // Route dessinée (col, station) ou route revêtue croisée par un chemin : elle garde son niveau, le chemin s'y
    // raccorde. Raccord d'autant plus long que l'écart est grand (pente ajoutée ≤ ≈ 8 %).
    const rankOf = (r: Road) => (r.designed ? 3 : r.kind === 'track' ? 1 : 2);
    const target = rankOf(c.ra) > rankOf(c.rb) ? ya : rankOf(c.rb) > rankOf(c.ra) ? yb : (ya + yb) / 2;
    for (const [r, k, y] of [[c.ra, c.i, ya], [c.rb, c.j, yb]] as const) {
      const delta = target - y;
      const span = Math.max(20, Math.ceil(Math.abs(delta) * 10));
      for (let o = -span; o <= span + 1; o++) {
        let idx = k + o;
        if (r.loop) idx = (idx + r.pts.length) % r.pts.length;
        else if (idx < 0 || idx >= r.pts.length) continue;
        const w = 1 - Math.min(1, Math.abs(o - 0.5) / (span + 0.5));
        r.pts[idx]![1] += delta * w * w * (3 - 2 * w);
      }
    }
  }
  // Point commun inséré au croisement exact dans les deux routes : le carrefour du graphe tombe dessus, sans marche
  // entre les deux chaussées (en pente, leurs points voisins sont à des altitudes différentes).
  const adds = new Map<Road, Array<{ i: number; p: Vec3 }>>();
  for (const c of xs) {
    const p = c.ra.pts[c.i]!;
    const q = c.ra.pts[(c.i + 1) % c.ra.pts.length]!;
    const x = p[0] + (q[0] - p[0]) * c.ta;
    const z = p[2] + (q[2] - p[2]) * c.ta;
    const y = p[1] + (q[1] - p[1]) * c.ta;
    for (const [r, i, t] of [[c.ra, c.i, c.ta], [c.rb, c.j, c.tb]] as const) {
      const a2 = r.pts[i]!;
      const b2 = r.pts[(i + 1) % r.pts.length]!;
      const seg = Math.hypot(b2[0] - a2[0], b2[2] - a2[2]);
      if (t * seg < 0.05 || (1 - t) * seg < 0.05) {
        // Déjà sur un point : il prend l'altitude commune.
        (t < 0.5 ? a2 : b2)[1] = y;
        continue;
      }
      (adds.get(r) ?? adds.set(r, []).get(r)!).push({ i, p: [x, y, z] });
    }
  }
  for (const [r, list] of adds) {
    list.sort((u, v) => v.i - u.i);
    for (const { i, p } of list) r.pts.splice(i + 1, 0, p);
  }
  return xs.length;
}

/**
 * Raccords sans marche : un bout de route posé sur une autre route (ou sur le bout d'une autre) prend l'altitude de
 * celle-ci (route dessinée, puis revêtue, d'abord), avec une rampe d'autant plus longue que l'écart est grand.
 */
/** Profils adoucis (moyenne glissante ± 16 m, deux fois), extrémités tenues : sans creux ni bosse au raccord. */
export function smoothProfiles(roads: Road[]): void {
  for (const r of roads) {
    if (r.designed || r.loop || r.pts.length < 9) continue;
    for (let pass = 0; pass < 2; pass++) {
      const src = r.pts.map((p) => p[1]);
      const n = src.length;
      for (let i = 1; i < n - 1; i++) {
        const k = Math.min(8, i, n - 1 - i);
        let s = 0;
        for (let j = i - k; j <= i + k; j++) s += src[j]!;
        r.pts[i]![1] = s / (2 * k + 1);
      }
    }
  }
}

/** Points sans coordonnées valides ou confondus avec le précédent (moins d'1 cm) retirés. */
export function cleanRoads(roads: Road[]): number {
  let removed = 0;
  for (const r of roads) {
    const before = r.pts.length;
    r.pts = r.pts.filter((p, i, all) => p.every(Number.isFinite) && (i === 0 || Math.hypot(p[0] - all[i - 1]![0], p[2] - all[i - 1]![2]) > 0.01));
    removed += before - r.pts.length;
  }
  return removed;
}

export function unifyEnds(roads: Road[]): number {
  const grid = roadSegGrid(roads, 24);
  const rank = (r: Road) => (r.designed ? 3 : r.kind === 'track' ? 1 : 2);
  // Bouts regroupés par carrefour (à moins d'un mètre).
  const ends: Array<{ r: Road; end: number; x: number; z: number; y: number }> = [];
  for (const r of roads) if (!r.loop) for (const end of [0, r.pts.length - 1]) ends.push({ r, end, x: r.pts[end]![0], z: r.pts[end]![2], y: r.pts[end]![1] });
  const cell = new Map<string, number[]>();
  ends.forEach((e, k) => {
    const key = `${Math.floor(e.x)},${Math.floor(e.z)}`;
    (cell.get(key) ?? cell.set(key, []).get(key)!).push(k);
  });
  const done = new Set<number>();
  let fixed = 0;
  for (let k = 0; k < ends.length; k++) {
    if (done.has(k)) continue;
    const e0 = ends[k]!;
    const group: number[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const m of cell.get(`${Math.floor(e0.x) + dx},${Math.floor(e0.z) + dz}`) ?? []) if (!done.has(m) && Math.hypot(ends[m]!.x - e0.x, ends[m]!.z - e0.z) < 1) group.push(m);
    for (const m of group) done.add(m);
    const own = new Set(group.map((m) => ends[m]!.r));
    // Bout posé au milieu d'une autre route : c'est elle qui donne le niveau.
    let target: number | null = null;
    let tr = -1;
    let host: { o: Road; i: number; t: number } | null = null;
    for (const e of grid.near(e0.x, e0.z, 4)) {
      const o = e.data;
      if (own.has(o)) continue;
      const q = nearestOn(o, e0.x, e0.z);
      if (!Number.isFinite(q.y) || !Number.isFinite(q.t)) continue;
      if (q.d < 4 && rank(o) > tr) {
        tr = rank(o);
        target = q.y;
        host = { o, i: q.i, t: q.t };
      }
    }
    // Raccord en T : point commun inséré sur la route du milieu, bouts posés dessus (même position, même altitude).
    if (host && target !== null) {
      const { o, i, t } = host;
      const a2 = o.pts[i]!;
      const b2 = o.pts[(i + 1) % o.pts.length]!;
      const seg = Math.hypot(b2[0] - a2[0], b2[2] - a2[2]);
      let at: Vec3;
      if (t * seg < 0.05) at = a2;
      else if ((1 - t) * seg < 0.05) at = b2;
      else {
        at = [a2[0] + (b2[0] - a2[0]) * t, target, a2[2] + (b2[2] - a2[2]) * t];
        o.pts.splice(i + 1, 0, at);
      }
      target = at[1];
      for (const m of group) {
        const { r, end } = ends[m]!;
        if (r.designed) continue;
        r.pts[end]![0] = at[0];
        r.pts[end]![2] = at[2];
      }
    }
    if (target === null) {
      const top = Math.max(...group.map((m) => rank(ends[m]!.r)));
      const best = group.filter((m) => rank(ends[m]!.r) === top);
      target = best.reduce((s2, m) => s2 + ends[m]!.y, 0) / best.length;
    }
    for (const m of group) {
      const { r, end, y } = ends[m]!;
      if (r.designed) continue;
      const delta = target - y;
      if (Math.abs(delta) < 0.03) continue;
      fixed++;
      const span = Math.min(Math.floor((r.pts.length - 1) / 2), Math.max(15, Math.ceil(Math.abs(delta) * 10)));
      for (let o = 0; o <= span; o++) {
        const idx = end === 0 ? o : r.pts.length - 1 - o;
        const w = 1 - o / span;
        r.pts[idx]![1] += delta * w * w * (3 - 2 * w);
      }
    }
  }
  return fixed;
}

export function buildGraph(roads: Road[]): RoadGraphData {
  const grid = roadSegGrid(roads, 24);
  const cuts = new Map<Road, Set<number>>();
  const addCut = (r: Road, i: number) => (cuts.get(r) ?? cuts.set(r, new Set()).get(r)!).add(i);
  for (const r of roads) {
    if (r.loop) continue;
    addCut(r, 0);
    addCut(r, r.pts.length - 1);
    // Extrémité posée sur une autre route : nœud sur celle-ci.
    for (const end of [0, r.pts.length - 1]) {
      const p = r.pts[end]!;
      const seen = new Set<Road>();
      for (const e of grid.near(p[0], p[2], 4)) {
        if (e.data === r || seen.has(e.data)) continue;
        const q = projectSeg(p[0], p[2], e.ax, e.az, e.bx, e.bz);
        if (q.d >= 4) continue;
        const o = e.data;
        const best = nearestOn(o, p[0], p[2]);
        if (best.d < 4) {
          seen.add(o);
          addCut(o, best.t < 0.5 ? best.i : (best.i + 1) % o.pts.length);
        }
      }
    }
  }
  // Croisements en X : un nœud commun aux deux routes.
  for (const c of findCrossings(roads)) {
    addCut(c.ra, c.ta < 0.5 ? c.i : (c.i + 1) % c.ra.pts.length);
    addCut(c.rb, c.tb < 0.5 ? c.j : (c.j + 1) % c.rb.pts.length);
  }
  const nodes: number[] = [];
  const nodeCells = new Map<number, number[]>();
  const nodeAt = (p: Vec3): number => {
    const ci = Math.floor(p[0] / 5);
    const cj = Math.floor(p[2] / 5);
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const k of nodeCells.get((ci + di) * 1000003 + cj + dj) ?? []) if (Math.hypot(nodes[k * 3]! - p[0], nodes[k * 3 + 2]! - p[2]) < 4.5) return k;
    nodes.push(r2(p[0]), r2(p[1]), r2(p[2]));
    const k = nodes.length / 3 - 1;
    const key = ci * 1000003 + cj;
    (nodeCells.get(key) ?? nodeCells.set(key, []).get(key)!).push(k);
    return k;
  };
  const edges: RoadGraphEdge[] = [];
  for (const r of roads) {
    const idx = [...(cuts.get(r) ?? [])].sort((a, b) => a - b);
    if (!idx.length) continue;
    const n = r.pts.length;
    const pieces: number[][] = [];
    if (r.loop) {
      for (let k = 0; k < idx.length; k++) {
        const a = idx[k]!;
        const b = idx[(k + 1) % idx.length]!;
        const seq: number[] = [];
        for (let i = a; ; i = (i + 1) % n) {
          seq.push(i);
          if (i === b && seq.length > 1) break;
        }
        pieces.push(seq);
      }
    } else for (let k = 0; k < idx.length - 1; k++) pieces.push(Array.from({ length: idx[k + 1]! - idx[k]! + 1 }, (_, j) => idx[k]! + j));
    for (const seq of pieces) {
      if (seq.length < 2) continue;
      const pts = seq.map((i) => r.pts[i]!);
      const a = nodeAt(pts[0]!);
      const b = nodeAt(pts[pts.length - 1]!);
      if (a === b && pts.length < 4) continue;
      // Extrémités posées exactement sur les nœuds (altitude unique au carrefour).
      pts[0] = [nodes[a * 3]!, nodes[a * 3 + 1]!, nodes[a * 3 + 2]!];
      pts[pts.length - 1] = [nodes[b * 3]!, nodes[b * 3 + 1]!, nodes[b * 3 + 2]!];
      // Point voisin d'un nœud à moins de 1,6 m : retiré (pas de pas minuscule au raccord ; en pente, son altitude
      // propre ferait une marche avec celle du carrefour).
      while (pts.length > 2 && Math.hypot(pts[1]![0] - pts[0]![0], pts[1]![2] - pts[0]![2]) < 1.6) pts.splice(1, 1);
      while (pts.length > 2 && Math.hypot(pts[pts.length - 2]![0] - pts[pts.length - 1]![0], pts[pts.length - 2]![2] - pts[pts.length - 1]![2]) < 1.6) pts.splice(pts.length - 2, 1);
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![2] - pts[i - 1]![2]);
      edges.push({ a, b, kind: r.kind, name: r.name, width: r.width, surface: r.surface, oneway: 0, len: r2(len), pts: pts.flatMap((p) => [r2(p[0]), r2(p[1]), r2(p[2])]) });
    }
  }
  return { formatVersion: 1, nodes, edges, attribution: ATTRIBUTION };
}

/** Clé d'un point (5 cm) : points partagés par plusieurs routes (carrefours, croisements), à ne pas déplacer. */
function sharedKeys(roads: Road[]): Set<string> {
  const seen = new Map<string, number>();
  for (const r of roads) {
    const mine = new Set<string>();
    for (const p of r.pts) mine.add(`${Math.round(p[0] * 20)},${Math.round(p[2] * 20)}`);
    for (const k of mine) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

function circR(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  const a = Math.hypot(bx - cx, bz - cz);
  const b = Math.hypot(ax - cx, az - cz);
  const c = Math.hypot(ax - bx, az - bz);
  const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
  return area2 < 1e-9 ? Infinity : (a * b * c) / (2 * area2);
}

/**
 * Virages trop serrés (rayon mesuré comme verify.ts, sur trois points espacés de 6 m) adoucis : lissage local du
 * tracé autour du virage, extrémités et points partagés tenus. Rend le nombre de virages encore trop serrés.
 */
export function easeKinks(roads: Road[]): number {
  const shared = sharedKeys(roads);
  let left = 0;
  for (const r of roads) {
    if (r.designed || r.loop || r.pts.length < 15 || r.kind === 'track') continue;
    const n = r.pts.length;
    const lim = r.kind === 'secondary' ? 8.5 : r.kind === 'track' ? 4.6 : 3;
    const fixed = r.pts.map((p, i) => i < 2 || i > n - 3 || shared.has(`${Math.round(p[0] * 20)},${Math.round(p[2] * 20)}`));
    // Déplacement borné (1,5 m) : le virage s'arrondit sans raccourcir la route ni changer sa pente.
    const home = r.pts.map((p) => [p[0], p[2]] as const);
    for (let it = 0; it < 80; it++) {
      let bad = 0;
      const P = r.pts;
      const next = P.map((p) => [p[0], p[2]] as [number, number]);
      for (let i = 0; i + 6 < n; i++) {
        if (circR(P[i]![0], P[i]![2], P[i + 3]![0], P[i + 3]![2], P[i + 6]![0], P[i + 6]![2]) >= lim) continue;
        bad++;
        for (let k = Math.max(1, i - 2); k <= Math.min(n - 2, i + 8); k++) {
          if (fixed[k]) continue;
          // Rampes raides tenues : raccourcir le tracé y raidirait la pente.
          if (Math.abs(P[Math.min(n - 1, k + 3)]![1] - P[Math.max(0, k - 3)]![1]) / 12 > 0.11) continue;
          // Déplacement en travers seulement (l'espacement des points, donc la pente, ne change pas).
          let nx = 0.5 * P[k]![0] + 0.25 * (P[k - 1]![0] + P[k + 1]![0]);
          let nz = 0.5 * P[k]![2] + 0.25 * (P[k - 1]![2] + P[k + 1]![2]);
          const tx = P[k + 1]![0] - P[k - 1]![0];
          const tz = P[k + 1]![2] - P[k - 1]![2];
          const tl = Math.hypot(tx, tz) || 1;
          const along = ((nx - P[k]![0]) * tx + (nz - P[k]![2]) * tz) / tl;
          nx -= (along * tx) / tl;
          nz -= (along * tz) / tl;
          const [hx, hz] = home[k]!;
          const d = Math.hypot(nx - hx, nz - hz);
          next[k] = d > 1.5 ? [hx + ((nx - hx) * 1.5) / d, hz + ((nz - hz) * 1.5) / d] : [nx, nz];
        }
      }
      if (!bad) break;
      for (let k = 0; k < n; k++) {
        r.pts[k]![0] = next[k]![0];
        r.pts[k]![2] = next[k]![1];
      }
      if (it === 79) left += bad;
    }
  }
  return left;
}

/** Creux du profil en long (corde de 16 m plus de 9 cm au-dessus de la chaussée) comblés, points partagés tenus. */
export function fillSags(roads: Road[]): number {
  const shared = sharedKeys(roads);
  let filled = 0;
  for (const r of roads) {
    if (r.designed || r.pts.length < 12) continue;
    const n = r.pts.length;
    const fixed = r.pts.map((p, i) => i < 1 || i > n - 2 || shared.has(`${Math.round(p[0] * 20)},${Math.round(p[2] * 20)}`));
    // Remblai borné (25 cm) : un fond de vallon reste un fond de vallon.
    const top = r.pts.map((p) => p[1] + 0.25);
    for (let it = 0; it < 30; it++) {
      let any = false;
      for (let i = 4; i + 4 < n; i++) {
        const want = Math.min(top[i]!, (r.pts[i - 4]![1] + r.pts[i + 4]![1]) / 2 - 0.09);
        if (r.pts[i]![1] >= want - 1e-3 || fixed[i]) continue;
        // Pas dans les rampes raides : la pente sur 10 m ne doit pas grimper.
        if (Math.abs(r.pts[i + 4]![1] - r.pts[i - 4]![1]) / 16 > 0.1) continue;
        any = true;
        filled++;
        // Le fond du creux et ses voisins remontent ensemble (profil arrondi).
        for (let k = i - 2; k <= i + 2; k++) if (!fixed[k]) r.pts[k]![1] = Math.min(top[k]!, Math.max(r.pts[k]![1], want - 0.02 * Math.abs(k - i)));
      }
      if (!any) break;
    }
  }
  return filled;
}
