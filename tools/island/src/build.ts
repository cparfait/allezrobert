/**
 * Générateur de l'île de Robert (voir docs/ILE_DE_ROBERT.md) : écrit un monde au format des mondes réels
 * (world.json, tiles/*.json + .lo/.hi.u16, routes/*.json, graph.json, places.json) dans
 * apps/client/public/worlds/ile-de-robert, puis lance les contrôles automatiques (verify.ts).
 *
 *   npx tsx tools/island/src/build.ts
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deltaEncodeU16 } from '../../../packages/shared/src/heights.ts';
import type { RoadGraphData, RoadGraphEdge } from '../../../packages/shared/src/roadgraph.ts';
import type { RouteData, WorldMeta, WorldPlace, WorldTile } from '../../../packages/shared/src/route.ts';
import { ANNEAU, BOURG, EGLISE, ISLAND, PLACE, STADE, anneauLoop, bourgStreets, coast, terrain, type StreetSpec, type Vec2 } from './design.ts';
import { chaikin, clipPolygon, clipPolyline, ellipse, orientedRect, pointInPolygon, polygonArea, projectSeg, resample, type Vec3 } from './geom.ts';
import { verifyWorld } from './verify.ts';

const OUT = resolve(import.meta.dirname, '../../../apps/client/public/worlds', ISLAND.id);
const T = ISLAND.tileSizeM;
const STEP = 2;
const ATTRIBUTION = ["L'île de Robert — monde imaginaire d'Allez Robert ! (généré par tools/island)"];
const r2 = (v: number) => Math.round(v * 100) / 100;

// ── Routes : tracés, profils, raccords ──

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
}

/** Profil en long : moyenne glissante du terrain (± `win` m), pente plafonnée à `maxGrade`. */
function profile(xz: Vec2[], loop: boolean, win: number, maxGrade: number): number[] {
  const n = xz.length;
  const raw = xz.map(([x, z]) => terrain(x, z));
  const k = Math.max(1, Math.round(win / STEP));
  const y = raw.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let j = -k; j <= k; j++) {
      const idx = loop ? (i + j + n) % n : i + j;
      if (idx < 0 || idx >= n) continue;
      s += raw[idx]!;
      c++;
    }
    return s / c;
  });
  // Pente plafonnée dans les deux sens (aller puis retour), sans toucher aux extrémités.
  const lim = maxGrade * STEP;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < n; i++) y[i] = Math.min(y[i - 1]! + lim, Math.max(y[i - 1]! - lim, y[i]!));
    for (let i = n - 2; i >= 0; i--) y[i] = Math.min(y[i + 1]! + lim, Math.max(y[i + 1]! - lim, y[i]!));
  }
  return y;
}

function makeRoad(s: StreetSpec | { id: string; name: string; kind: string; width: number; pts: Vec2[]; loop?: boolean; surface?: string }, smooth = true): Road {
  const loop = 'loop' in s && !!s.loop;
  const xz = loop ? resample(s.pts, STEP, true) : resample(smooth ? chaikin(s.pts, 4) : s.pts, STEP);
  const y = profile(xz, loop, 40, 0.08);
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    width: s.width,
    surface: ('surface' in s && s.surface) || 'asphalt',
    loop,
    pts: xz.map(([x, z], i) => [x, y[i]!, z]),
    flat: s.width / 2 + 1.5,
    blend: 7,
  };
}

/** Point le plus proche d'une route : index du segment, paramètre, distance, altitude. */
function nearestOn(road: Road, x: number, z: number): { i: number; t: number; d: number; y: number } {
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

/**
 * Raccords : l'extrémité d'une route secondaire posée sur une route principale prend son altitude, et
 * l'écart est réparti sur les 40 m qui précèdent (les profils se rejoignent sans marche).
 */
function snapEnds(road: Road, onto: Road[]): void {
  for (const end of [0, road.pts.length - 1]) {
    const p = road.pts[end]!;
    let target: Vec3 | null = null;
    for (const o of onto) {
      if (o === road) continue;
      const q = nearestOn(o, p[0], p[2]);
      // Extrémité posée exactement sur le point de la route d'accueil qui portera le nœud du carrefour.
      if (q.d < 4) target = o.pts[q.t < 0.5 ? q.i : (q.i + 1) % o.pts.length]!;
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

export function buildRoads(): Road[] {
  const anneau = makeRoad({ id: 'anneau', name: "L'Anneau", kind: 'unclassified', width: ANNEAU.widthM, pts: anneauLoop(STEP), loop: true });
  const streets = bourgStreets().map((s) => makeRoad(s));
  const grandRueWest = (streets.find((s) => s.id === 'grand-rue') as Road).pts[0]!;
  const ecolesWest = (streets.find((s) => s.id === 'rue-ecoles') as Road).pts[0]!;
  const eastApex: Vec2 = [ANNEAU.cx + ANNEAU.half + ANNEAU.radius, ANNEAU.cz];
  const neEnd: Vec2 = [ANNEAU.cx + ANNEAU.half - 2, ANNEAU.cz - ANNEAU.radius];
  const liaison = makeRoad({
    id: 'route-anneau',
    name: "Route de l'Anneau",
    kind: 'tertiary',
    width: 6.5,
    pts: [[grandRueWest[0], grandRueWest[2]], [-1150, 330], [-1600, 290], [eastApex[0] + 140, eastApex[1] + 6], [eastApex[0], eastApex[1]]],
  });
  const voieVerte = makeRoad({
    id: 'voie-verte',
    name: 'La Piste verte',
    kind: 'cycleway',
    width: 3,
    pts: [[ecolesWest[0], ecolesWest[2]], [-760, 70], [-1250, 30], [-1750, 45], [neEnd[0] + 90, neEnd[1] - 20], [neEnd[0], neEnd[1]]],
  });
  for (const s of streets) snapEnds(s, [streets.find((x) => x.id === 'grand-rue')!, streets.find((x) => x.id === 'rue-eglise')!]);
  snapEnds(liaison, [anneau, ...streets]);
  snapEnds(voieVerte, [anneau, ...streets]);
  return [anneau, ...streets, liaison, voieVerte];
}

// ── Terrain arasé sous les routes ──

class RoadIndex {
  private cells = new Map<string, Array<{ r: Road; i: number }>>();
  private readonly cs = 25;
  constructor(readonly roads: Road[]) {
    for (const r of roads) {
      const n = r.pts.length;
      const segs = r.loop ? n : n - 1;
      const reach = r.flat + r.blend;
      for (let i = 0; i < segs; i++) {
        const a = r.pts[i]!;
        const b = r.pts[(i + 1) % n]!;
        const x0 = Math.floor((Math.min(a[0], b[0]) - reach) / this.cs);
        const x1 = Math.floor((Math.max(a[0], b[0]) + reach) / this.cs);
        const z0 = Math.floor((Math.min(a[2], b[2]) - reach) / this.cs);
        const z1 = Math.floor((Math.max(a[2], b[2]) + reach) / this.cs);
        for (let cx = x0; cx <= x1; cx++)
          for (let cz = z0; cz <= z1; cz++) {
            const k = `${cx},${cz}`;
            let l = this.cells.get(k);
            if (!l) this.cells.set(k, (l = []));
            l.push({ r, i });
          }
      }
    }
  }

  /** Route la plus « contraignante » au point : distance, altitude de chaussée, route. */
  query(x: number, z: number): { d: number; y: number; r: Road } | null {
    const l = this.cells.get(`${Math.floor(x / this.cs)},${Math.floor(z / this.cs)}`);
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
}

const smoothstep = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/** Altitude finale : terrain naturel, arasé 10 cm sous la chaussée et ses accotements, raccordé au-delà. */
export function finalHeight(idx: RoadIndex, x: number, z: number): number {
  const h0 = terrain(x, z);
  const q = idx.query(x, z);
  if (!q) return h0;
  const under = q.y - 0.1;
  if (q.d <= q.r.flat) return under;
  const t = smoothstep((q.d - q.r.flat) / q.r.blend);
  return under + (h0 - under) * t;
}

// ── Bâtiments, sols et végétation ──

interface Building {
  id: string;
  kind: string;
  height: number;
  levels: number;
  roof: { shape: string; height: number; material?: string; colour?: string };
  pts: Vec2[];
  y: number;
  name?: string;
  colour?: string;
}

function buildBuildings(roads: Road[]): Building[] {
  const out: Building[] = [];
  const occupied: Vec2[][] = [];
  const clearOfRoads = (poly: Vec2[], margin: number) =>
    poly.every(([x, z]) => roads.every((r) => nearestOn(r, x, z).d > r.flat + margin)) &&
    roads.every((r) => nearestOn(r, poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length).d > r.flat + margin);
  const overlaps = (poly: Vec2[]) => occupied.some((o) => poly.some(([x, z]) => pointInPolygon(x, z, o)) || o.some(([x, z]) => pointInPolygon(x, z, poly)));
  // Posé sur le sol final (arasé près des routes) : le jeu prolonge les murs vers le bas, jamais vers le haut.
  const idx = new RoadIndex(roads);
  const yUnder = (poly: Vec2[]) => Math.min(...poly.map(([x, z]) => finalHeight(idx, x, z)));
  // Église (nef + clocher) au coin de la place.
  const nef = orientedRect(EGLISE.x, EGLISE.z, EGLISE.d / 2, EGLISE.w / 2, Math.PI / 2);
  out.push({ id: 'eglise', kind: 'church', height: 15, levels: 1, roof: { shape: 'gabled', height: 6, material: 'slate' }, pts: nef, y: yUnder(nef), name: 'Église Saint-Robert' });
  const clocher = orientedRect(EGLISE.x, EGLISE.z + EGLISE.d / 2 + 2.5, 3, 3, 0);
  out.push({ id: 'clocher', kind: 'church', height: 26, levels: 4, roof: { shape: 'pyramidal', height: 7, material: 'slate' }, pts: clocher, y: yUnder(clocher) });
  occupied.push(nef, clocher);
  // Maisons le long des rues du bourg, des deux côtés, tous les ≈ 22 m (hors place, église, stade).
  let id = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stade = orientedRect(STADE.x, STADE.z, STADE.l / 2 + 12, STADE.w / 2 + 12, 0);
  for (const r of roads) {
    if (!['tertiary', 'residential'].includes(r.kind) || r.id === 'route-anneau') continue;
    for (let i = 6; i < r.pts.length - 6; i += 11) {
      const a = r.pts[i - 1]!;
      const b = r.pts[i + 1]!;
      const ang = Math.atan2(b[2] - a[2], b[0] - a[0]);
      for (const side of [1, -1]) {
        const depth = 9 + rnd() * 3;
        const len = 8 + rnd() * 5;
        const off = r.width / 2 + 7 + depth / 2 + rnd() * 3;
        const cx = r.pts[i]![0] - Math.sin(ang) * off * side;
        const cz = r.pts[i]![2] + Math.cos(ang) * off * side;
        if (Math.hypot(cx - PLACE.x, cz - PLACE.z) < PLACE.half + 20) continue;
        if (pointInPolygon(cx, cz, stade)) continue;
        if (Math.hypot(cx - BOURG.cx, cz - BOURG.cz) > 760) continue;
        const poly = orientedRect(cx, cz, len / 2, depth / 2, ang);
        if (!clearOfRoads(poly, 2.5) || overlaps(poly)) continue;
        occupied.push(poly);
        const levels = rnd() < 0.35 ? 1 : 2;
        out.push({ id: `maison-${id++}`, kind: 'house', height: 3 * levels + 2.6, levels, roof: { shape: rnd() < 0.7 ? 'gabled' : 'hipped', height: 2.6, material: 'tiles' }, pts: poly, y: yUnder(poly) });
      }
    }
  }
  // Tribunes de l'anneau, le long de la ligne droite sud (ligne d'arrivée au milieu).
  // Trois tribunes basses et claires (sans fenêtres : type « industrial » pour le jeu), toit en appentis.
  for (const k of [-1, 0, 1]) {
    const trib = orientedRect(ANNEAU.cx + k * 56, ANNEAU.cz + ANNEAU.radius + 24, 24, 6, 0);
    out.push({ id: `tribune-${k + 1}`, kind: 'industrial', height: 7, levels: 1, colour: '#e4ddcb', roof: { shape: 'skillion', height: 1.6, colour: '#c0392b' }, pts: trib, y: yUnder(trib), name: "Tribunes de l'Anneau" });
  }
  return out;
}

interface Area {
  id: string;
  kind: string;
  layer: 'forests' | 'fields' | 'landuse';
  ring: Vec2[];
  name?: string;
}

/** Côte à la distance normalisée `level` (0 = trait de côte), par dichotomie le long de rayons. */
function coastRing(level: number, n = 180): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let lo = 0;
    let hi = 9000;
    for (let it = 0; it < 30; it++) {
      const m = (lo + hi) / 2;
      if (coast(dx * m, dz * m) > level) lo = m;
      else hi = m;
    }
    out.push([dx * lo, dz * lo]);
  }
  return out;
}

function buildAreas(roads: Road[]): Area[] {
  const areas: Area[] = [];
  // Plage : bande entre le trait de côte et l'intérieur, en quadrilatères (pas de trous à découper).
  const outer = coastRing(-0.004);
  const inner = coastRing(0.022);
  for (let k = 0; k < outer.length; k++) {
    const k1 = (k + 1) % outer.length;
    areas.push({ id: `plage-${k}`, kind: 'sand', layer: 'fields', ring: [outer[k]!, outer[k1]!, inner[k1]!, inner[k]!] });
  }
  // Bourg, pelouse de l'anneau, stade.
  // Pas de grande zone « résidentielle » (le jeu la peint en gris uni) : les cours suivent les maisons ;
  // seule la place de l'église est pavée.
  areas.push({ id: 'place', kind: 'retail', layer: 'landuse', ring: orientedRect(PLACE.x, PLACE.z, PLACE.half, PLACE.half, 0), name: "Place de l'Église" });
  areas.push({ id: 'anneau-pelouse', kind: 'park', layer: 'landuse', ring: stadium(ANNEAU.cx, ANNEAU.cz, ANNEAU.half, ANNEAU.radius - 14), name: "Pelouse de l'Anneau" });
  areas.push({ id: 'stade', kind: 'pitch', layer: 'landuse', ring: orientedRect(STADE.x, STADE.z, STADE.l / 2, STADE.w / 2, 0), name: 'Stade municipal' });
  // Les Bois (nord-ouest) et bosquets autour de l'anneau, loin des routes.
  areas.push({ id: 'les-bois', kind: 'mixed', layer: 'forests', ring: ellipse(-4300, -1750, 1150, 800, 30, 0.3), name: 'Les Bois' });
  areas.push({ id: 'bois-du-col', kind: 'conifer', layer: 'forests', ring: ellipse(3900, -2300, 900, 600, 26, -0.4) });
  for (const [cx, cz, rx, rz] of [[-2700, -260, 420, 110], [-2650, 860, 460, 120], [-3700, 300, 140, 260]] as const)
    areas.push({ id: `bosquet-${cx}-${cz}`, kind: 'deciduous', layer: 'forests', ring: ellipse(cx, cz, rx, rz, 20) });
  // Parcelles agricoles : damier de prés et de champs, sauf près des routes, du bourg, de l'anneau et des bois.
  const busy = [...areas.filter((a) => a.layer !== 'fields').map((a) => a.ring), ellipse(BOURG.cx, BOURG.cz + 60, 760, 520, 28)];
  let n = 0;
  for (let x = -5600; x < 5600; x += 310)
    for (let z = -3600; z < 3600; z += 220) {
      const cx = x + 155;
      const cz = z + 110;
      if (coast(cx, cz) < 0.08) continue;
      if (busy.some((ring) => pointInPolygon(cx, cz, ring))) continue;
      const rect = orientedRect(cx, cz, 140, 95, ((cx * 7 + cz * 3) % 9) * 0.02);
      if (rect.some(([px, pz]) => roads.some((r) => nearestOn(r, px, pz).d < r.flat + 6)) || roads.some((r) => nearestOn(r, cx, cz).d < 160)) continue;
      const kind = (Math.floor(x / 310) + Math.floor(z / 220)) % 3 === 0 ? 'farmland' : 'meadow';
      areas.push({ id: `parcelle-${n++}`, kind, layer: 'fields', ring: rect });
    }
  return areas;
}

function stadium(cx: number, cz: number, half: number, radius: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= 12; i++) out.push([cx + half + radius * Math.cos(-Math.PI / 2 + (Math.PI * i) / 12), cz + radius * Math.sin(-Math.PI / 2 + (Math.PI * i) / 12)]);
  for (let i = 0; i <= 12; i++) out.push([cx - half + radius * Math.cos(Math.PI / 2 + (Math.PI * i) / 12), cz + radius * Math.sin(Math.PI / 2 + (Math.PI * i) / 12)]);
  return out;
}

// ── Graphe routier (mode ouvert) ──

function buildGraph(roads: Road[]): RoadGraphData {
  // Nœuds : extrémités des routes ouvertes et points où elles touchent une autre route.
  const cuts = new Map<Road, Set<number>>();
  const addCut = (r: Road, i: number) => (cuts.get(r) ?? cuts.set(r, new Set()).get(r)!).add(i);
  for (const r of roads) {
    if (!r.loop) {
      addCut(r, 0);
      addCut(r, r.pts.length - 1);
    }
  }
  for (const r of roads) {
    if (r.loop) continue;
    for (const end of [0, r.pts.length - 1]) {
      const p = r.pts[end]!;
      for (const o of roads) {
        if (o === r) continue;
        const q = nearestOn(o, p[0], p[2]);
        if (q.d < 4) addCut(o, q.t < 0.5 ? q.i : (q.i + 1) % o.pts.length);
      }
    }
  }
  // Croisements en X (rues du bourg en damier) : un nœud commun aux deux routes.
  for (let a = 0; a < roads.length; a++)
    for (let b = a + 1; b < roads.length; b++) {
      const ra = roads[a]!;
      const rb = roads[b]!;
      const na = ra.pts.length;
      const nb = rb.pts.length;
      for (let i = 0; i < (ra.loop ? na : na - 1); i++) {
        const p = ra.pts[i]!;
        const q = ra.pts[(i + 1) % na]!;
        for (let j = 0; j < (rb.loop ? nb : nb - 1); j++) {
          const u = rb.pts[j]!;
          const v = rb.pts[(j + 1) % nb]!;
          const c = segCross(p, q, u, v);
          if (!c) continue;
          addCut(ra, c[0] < 0.5 ? i : (i + 1) % na);
          addCut(rb, c[1] < 0.5 ? j : (j + 1) % nb);
        }
      }
    }
  const nodes: number[] = [];
  const nodeAt = (p: Vec3): number => {
    for (let k = 0; k < nodes.length; k += 3) if (Math.hypot(nodes[k]! - p[0], nodes[k + 2]! - p[2]) < 4.5) return k / 3;
    nodes.push(r2(p[0]), r2(p[1]), r2(p[2]));
    return nodes.length / 3 - 1;
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
      // Extrémités posées exactement sur les nœuds (altitude unique au carrefour).
      pts[0] = [nodes[a * 3]!, nodes[a * 3 + 1]!, nodes[a * 3 + 2]!];
      pts[pts.length - 1] = [nodes[b * 3]!, nodes[b * 3 + 1]!, nodes[b * 3 + 2]!];
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![2] - pts[i - 1]![2]);
      edges.push({ a, b, kind: r.kind, name: r.name, width: r.width, surface: r.surface, oneway: 0, len: r2(len), pts: pts.flatMap((p) => [r2(p[0]), r2(p[1]), r2(p[2])]) });
    }
  }
  return { formatVersion: 1, nodes, edges, attribution: ATTRIBUTION };
}

/** Paramètres (t, u) du croisement de deux segments en plan, extrémités comprises ; null s'ils ne se coupent pas. */
function segCross(p: Vec3, q: Vec3, u: Vec3, v: Vec3): [number, number] | null {
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

// ── Itinéraires ──

interface Leg {
  road: Road;
  from: number;
  to: number;
  /** Sens de parcours sur une boucle : +1 indices croissants. */
  dir: 1 | -1;
}

function walk(leg: Leg): Vec3[] {
  const n = leg.road.pts.length;
  const out: Vec3[] = [];
  for (let i = leg.from; ; i = (i + leg.dir + n) % n) {
    out.push(leg.road.pts[i]!);
    if (i === leg.to) break;
    if (out.length > n + 1) throw new Error(`itinéraire : ${leg.road.id} ${leg.from}→${leg.to} ne se referme pas`);
  }
  return out;
}

function route(id: string, name: string, nameEn: string, legs: Leg[], loop: boolean, landmarks: Array<{ name: string; x: number; z: number }>): RouteData {
  const raw: Vec3[] = [];
  const widths: Array<{ startM: number; endM: number; widthM: number }> = [];
  const surfaces: Array<{ startM: number; endM: number; surface: string }> = [];
  let d = 0;
  for (const leg of legs) {
    const pts = walk(leg);
    const start = d;
    for (const p of pts) {
      const last = raw[raw.length - 1];
      if (last) {
        const step = Math.hypot(p[0] - last[0], p[2] - last[2]);
        if (step < 0.5) continue;
        d += step;
      }
      raw.push(p);
    }
    widths.push({ startM: r2(start), endM: r2(d), widthM: leg.road.width });
    surfaces.push({ startM: r2(start), endM: r2(d), surface: leg.road.surface });
  }
  if (loop) {
    const a = raw[0]!;
    const b = raw[raw.length - 1]!;
    if (Math.hypot(a[0] - b[0], a[2] - b[2]) < 0.5) raw.pop();
  }
  let lengthM = 0;
  const points = raw.map((p, i) => {
    if (i > 0) lengthM += Math.hypot(p[0] - raw[i - 1]![0], p[2] - raw[i - 1]![2]);
    return { x: r2(p[0]), y: r2(p[1]), z: r2(p[2]), d: r2(lengthM) };
  });
  if (loop) lengthM += Math.hypot(raw[0]![0] - raw[raw.length - 1]![0], raw[0]![2] - raw[raw.length - 1]![2]);
  let gain = 0;
  let maxGrade = 0;
  for (let i = 1; i < points.length; i++) gain += Math.max(0, points[i]!.y - points[i - 1]!.y);
  for (let i = 5; i < points.length; i++) {
    const dd = points[i]!.d - points[i - 5]!.d;
    if (dd > 0) maxGrade = Math.max(maxGrade, (Math.abs(points[i]!.y - points[i - 5]!.y) / dd) * 100);
  }
  const ys = points.map((p) => p.y);
  return {
    id,
    name,
    nameEn,
    loop,
    lengthM: r2(lengthM),
    elevationGainM: r2(gain),
    points,
    segments: [],
    roadWidthM: legs[0]!.road.width,
    attribution: ATTRIBUTION,
    roadWidths: widths,
    surfaces,
    landmarks: landmarks.map((l) => ({ name: l.name, d: r2(points.reduce((best, p) => (Math.hypot(p.x - l.x, p.z - l.z) < Math.hypot(best.x - l.x, best.z - l.z) ? p : best)).d) })),
    stepM: STEP,
    minElevationM: r2(Math.min(...ys)),
    maxElevationM: r2(Math.max(...ys)),
    maxGradePct: r2(maxGrade),
    markings: 'full',
  };
}

function buildRoutes(roads: Road[]): RouteData[] {
  const R = (id: string) => roads.find((r) => r.id === id)!;
  const anneau = R('anneau');
  const n = anneau.pts.length;
  const near = (r: Road, x: number, z: number) => {
    const q = nearestOn(r, x, z);
    return q.t < 0.5 ? q.i : (q.i + 1) % r.pts.length;
  };
  // Anneau : départ au milieu de la ligne droite sud, devant les tribunes, sens des aiguilles d'une montre.
  const start = near(anneau, ANNEAU.cx, ANNEAU.cz + ANNEAU.radius);
  const ring = route('anneau', "L'Anneau", 'The Ring', [{ road: anneau, from: start, to: (start - 1 + n) % n, dir: 1 }], true, [{ name: 'Tribunes', x: ANNEAU.cx, z: ANNEAU.cz + ANNEAU.radius }]);
  // Boucle du Bourg : place → Grand-Rue → route de l'Anneau → trois quarts d'anneau → Piste verte → rue des
  // Écoles → rue de l'Église → place.
  const grandRue = R('grand-rue');
  const eglise = R('rue-eglise');
  const ecoles = R('rue-ecoles');
  const liaison = R('route-anneau');
  const verte = R('voie-verte');
  const gPlace = near(grandRue, PLACE.x, PLACE.z);
  const apex = near(anneau, liaison.pts[liaison.pts.length - 1]![0], liaison.pts[liaison.pts.length - 1]![2]);
  const ne = near(anneau, verte.pts[verte.pts.length - 1]![0], verte.pts[verte.pts.length - 1]![2]);
  const eEcoles = near(ecoles, eglise.pts[0]![0], ecoles.pts[0]![2]);
  const egEcoles = near(eglise, ecoles.pts[eEcoles]![0], ecoles.pts[eEcoles]![2]);
  const egPlace = near(eglise, PLACE.x, PLACE.z);
  const bourg = route(
    'boucle-du-bourg',
    'La boucle du Bourg',
    'The village loop',
    [
      { road: grandRue, from: gPlace, to: 0, dir: -1 },
      { road: liaison, from: 0, to: liaison.pts.length - 1, dir: 1 },
      { road: anneau, from: apex, to: ne, dir: 1 },
      { road: verte, from: verte.pts.length - 1, to: 0, dir: -1 },
      { road: ecoles, from: 0, to: eEcoles, dir: 1 },
      { road: eglise, from: egEcoles, to: egPlace, dir: 1 },
    ],
    true,
    [
      { name: 'Saint-Robert', x: PLACE.x, z: PLACE.z },
      { name: "L'Anneau", x: ANNEAU.cx, z: ANNEAU.cz + ANNEAU.radius },
      { name: 'La Piste verte', x: -1250, z: 30 },
    ],
  );
  return [ring, bourg];
}

// ── Écriture ──

function writeTiles(roads: Road[], buildings: Building[], areas: Area[]): WorldMeta['tiles'] {
  const idx = new RoadIndex(roads);
  const index: WorldMeta['tiles'] = [];
  const tx0 = Math.floor(ISLAND.minX / T);
  const tx1 = Math.ceil(ISLAND.maxX / T) - 1;
  const tz0 = Math.floor(ISLAND.minZ / T);
  const tz1 = Math.ceil(ISLAND.maxZ / T) - 1;
  for (let tx = tx0; tx <= tx1; tx++)
    for (let tz = tz0; tz <= tz1; tz++) {
      const id = `${tx}_${tz}`;
      const bounds = { minX: tx * T, minZ: tz * T, maxX: (tx + 1) * T, maxZ: (tz + 1) * T };
      const grid = (res: number) => {
        const n = T / res;
        const h = new Float32Array((n + 1) * (n + 1));
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) h[j * (n + 1) + i] = finalHeight(idx, bounds.minX + i * res, bounds.minZ + j * res);
        return { n, h };
      };
      const lo = grid(8);
      let lMin = Infinity;
      let lMax = -Infinity;
      for (const v of lo.h) {
        lMin = Math.min(lMin, v);
        lMax = Math.max(lMax, v);
      }
      // Pleine mer : grille grossière seule.
      const land = lMax > -0.3;
      const hi = land ? grid(2) : null;
      let min = lMin;
      let max = lMax;
      if (hi) for (const v of hi.h) {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      const baseM = Math.floor(min) - 1;
      const stepM = 0.01;
      const enc = (g: { n: number; h: Float32Array }) => {
        const N = g.n + 1;
        const q = new Uint16Array(N * N);
        for (let k = 0; k < N * N; k++) q[k] = Math.max(0, Math.min(65535, Math.round((g.h[k]! - baseM) / stepM)));
        deltaEncodeU16(q, g.n);
        return Buffer.from(q.buffer);
      };
      const loBuf = enc(lo);
      writeFileSync(join(OUT, 'tiles', `${id}.lo.u16`), loBuf);
      let bytes = loBuf.length;
      if (hi) {
        const hiBuf = enc(hi);
        writeFileSync(join(OUT, 'tiles', `${id}.hi.u16`), hiBuf);
        bytes += hiBuf.length;
      }
      const tile: WorldTile = {
        id,
        tx,
        tz,
        bounds,
        heights: { baseM, stepM, encoding: 'uint16le', delta: true, lo: { n: 125, resolutionM: 8, file: `${id}.lo.u16` }, ...(hi ? { hi: { n: 500, resolutionM: 2, file: `${id}.hi.u16` } } : {}) },
        roads: [],
        buildings: [],
        forests: [],
        fields: [],
        landuse: [],
        water: [],
        waterways: [],
        railways: [],
        pois: [],
      };
      for (const r of roads) {
        const pts = r.loop ? [...r.pts, r.pts[0]!] : r.pts;
        const parts = clipPolyline(pts, bounds);
        // Boucle dont le départ tombe dans la tuile : le dernier morceau rejoint le premier (pas de coupure).
        if (r.loop && parts.length > 1) {
          const first = parts[0]!;
          const last = parts[parts.length - 1]!;
          const a = last[last.length - 1]!;
          if (Math.hypot(a[0] - first[0]![0], a[2] - first[0]![2]) < 1e-6) parts.splice(0, 1, [...last, ...first.slice(1)]) && parts.pop();
        }
        parts.forEach((piece, k) =>
          tile.roads.push({ id: `${r.id}-${k}`, kind: r.kind, name: r.name, width: r.width, surface: r.surface, flatten: [r.flat, r.flat + r.blend], pts: piece.flatMap((p) => [r2(p[0]), r2(p[1]), r2(p[2])]) }),
        );
      }
      for (const b of buildings) {
        const cx = b.pts.reduce((s, p) => s + p[0], 0) / b.pts.length;
        const cz = b.pts.reduce((s, p) => s + p[1], 0) / b.pts.length;
        if (cx < bounds.minX || cx >= bounds.maxX || cz < bounds.minZ || cz >= bounds.maxZ) continue;
        tile.buildings.push({ id: b.id, kind: b.kind, height: b.height, levels: b.levels, roof: b.roof, y: r2(b.y), pts: b.pts.flatMap((p) => [r2(p[0]), r2(p[1])]), ...(b.name ? { name: b.name } : {}), ...(b.colour ? { colour: b.colour } : {}) });
      }
      for (const a of areas) {
        const c = clipPolygon(a.ring, bounds);
        if (c.length < 3 || Math.abs(polygonArea(c)) < 1) continue;
        const entry = { id: a.id, kind: a.kind, ...(a.name ? { name: a.name } : {}), rings: [c.flatMap((p) => [r2(p[0]), r2(p[1])])] };
        if (a.layer === 'forests') tile.forests.push(entry as WorldTile['forests'][number]);
        else tile[a.layer].push(entry);
      }
      writeFileSync(join(OUT, 'tiles', `${id}.json`), JSON.stringify(tile));
      bytes += Buffer.byteLength(JSON.stringify(tile));
      index.push({ id, tx, tz, baseM, minM: r2(min), maxM: r2(max), lods: hi ? ['lo', 'hi'] : ['lo'], bytes });
    }
  return index;
}

function main(): void {
  const t0 = Date.now();
  rmSync(join(OUT, 'tiles'), { recursive: true, force: true });
  mkdirSync(join(OUT, 'tiles'), { recursive: true });
  mkdirSync(join(OUT, 'routes'), { recursive: true });
  writeFileSync(join(OUT, '.gitignore'), 'tiles/\n');
  const roads = buildRoads();
  const buildings = buildBuildings(roads);
  const areas = buildAreas(roads);
  const routes = buildRoutes(roads);
  for (const r of routes) writeFileSync(join(OUT, 'routes', `${r.id}.json`), JSON.stringify(r));
  const graph = buildGraph(roads);
  writeFileSync(join(OUT, 'graph.json'), JSON.stringify(graph));
  const places: WorldPlace[] = [
    { name: 'Saint-Robert', kind: 'village', x: PLACE.x, z: PLACE.z },
    { name: "L'Anneau", kind: 'hamlet', x: ANNEAU.cx, z: ANNEAU.cz },
  ];
  writeFileSync(join(OUT, 'places.json'), JSON.stringify(places));
  const tiles = writeTiles(roads, buildings, areas);
  const meta: WorldMeta = {
    formatVersion: 1,
    id: ISLAND.id,
    name: ISLAND.name,
    crs: 'EPSG:2154',
    // Repère fictif, en pleine mer au large de la Bretagne : ne recouvre aucune zone réelle.
    originL93: { x: 60000, y: 6800000 },
    bounds: { minX: ISLAND.minX, minZ: ISLAND.minZ, maxX: ISLAND.maxX, maxZ: ISLAND.maxZ },
    tileSizeM: T,
    heightResolutionM: 2,
    heightEncoding: { type: 'uint16le', stepM: 0.01, rowOrder: 'north-to-south', colOrder: 'west-to-east' },
    lods: [
      { id: 'lo', resolutionM: 8, n: 125, suffix: '.lo.u16' },
      { id: 'hi', resolutionM: 2, n: 500, suffix: '.hi.u16' },
    ],
    tiles,
    routes: routes.map((r, i) => ({ id: r.id, file: `routes/${r.id}.json`, name: r.name, nameEn: r.nameEn, lengthM: r.lengthM, elevationGainM: r.elevationGainM, loop: r.loop, main: i === 0 })),
    mainRoute: routes[0]!.id,
    attribution: ATTRIBUTION,
    open: { graph: 'graph.json', start: { x: PLACE.x, z: PLACE.z + 20 }, places: 'places.json' },
    sea: { levelM: 0 },
  };
  writeFileSync(join(OUT, 'world.json'), JSON.stringify(meta, null, 1));
  console.log(`île écrite en ${((Date.now() - t0) / 1000).toFixed(1)} s : ${tiles.length} tuiles, ${roads.length} routes, ${buildings.length} bâtiments, ${areas.length} surfaces`);
  for (const r of routes) console.log(`  ${r.id} : ${(r.lengthM / 1000).toFixed(2)} km, D+ ${r.elevationGainM} m, pente max ${r.maxGradePct} %`);
  const report = verifyWorld(OUT);
  for (const line of report.lines) console.log(line);
  if (!report.ok) {
    console.error('contrôles en échec');
    process.exitCode = 1;
  }
}

main();
