/**
 * Profils 3D des routes OSM (hors itinéraires) et couloirs de creusement.
 * Les nœuds partagés ont une altitude unique (celle de l'itinéraire s'il y passe), ce qui
 * garantit la continuité des profils aux carrefours.
 */
import type { RouteData } from '@allezrobert/shared';
import type { DemStack } from './dem.ts';
import { worldToL93 } from './frame.ts';
import { GridIndex, resampleOpen, simplify3, smooth1d, type Pt } from './geom.ts';
import type { Edge, RoadGraph } from './graph.ts';
import type { CarveLine, TileRoad } from './tiles.ts';

/** Types de voies creusées dans le terrain. */
const CARVED = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|cycleway|track)(_link)?$/;

export interface RouteOnGraph {
  route: RouteData;
  edgeOf: number[];
  priority: number;
}

function demAt(dem: DemStack, x: number, z: number): number {
  const l = worldToL93(x, z);
  return dem.sample(l.e, l.n);
}

export interface Roads3d {
  roads: TileRoad[];
  carve: CarveLine[];
  /** Profil dense de chaque arête hors itinéraire (a → b), celui qui est creusé dans le terrain ; aussi des
   * arêtes des itinéraires avec `routeEdgeProfiles` (calées sur l'itinéraire). */
  edgePts: Map<number, Array<[number, number, number]>>;
  /** Passages sous un pont abaissés (`lowerUnderpasses`). */
  underpasses: UnderpassStats;
  /** Itinéraires gardés abaissés sous un pont (points modifiés en place : fichier et statistiques à réécrire). */
  routesLowered: Set<string>;
}

export function buildRoads3d(
  g: RoadGraph,
  dem: DemStack,
  routes: RouteOnGraph[],
  opts: {
    routeEdgeProfiles?: boolean;
    /** Altitudes de tablier des nœuds d'extrémité de ponts (`bridge-decks.ts`), prioritaires sur le MNT hors itinéraires. */
    deckHeights?: Map<number, number>;
    /** Ponts ferroviaires OSM (axe en plan) : les routes qui passent dessous sont abaissées comme sous un pont routier. */
    railBridges?: ReadonlyArray<{ pts: Pt[]; width: number }>;
  } = {},
): Roads3d {
  const roads: TileRoad[] = [];
  const edgePts = new Map<number, Array<[number, number, number]>>();
  const carve: CarveLine[] = [];
  const routeEdges = new Set<number>();
  const nodeH = new Map<number, number>();
  // 0. itinéraires gardés qui passent sous un pont : abaissés avant tout (leurs nœuds donnent l'altitude des voisines)
  const routesLowered = new Set<string>();
  if (routes.length) {
    const onRoute = new Set(routes.flatMap((r) => r.edgeOf));
    const deckOf = (nd: number) => {
      const h = opts.deckHeights?.get(nd);
      if (h !== undefined) return h;
      const p = g.nodePos.get(nd)!;
      return demAt(dem, p[0], p[1]);
    };
    const bridgeProfiles = new Map<number, Array<[number, number, number]>>();
    for (const e of g.edges) if (e.road.bridge && !onRoute.has(e.id)) bridgeProfiles.set(e.id, edgeProfile(e, dem, deckOf(e.a), deckOf(e.b)));
    const ov = overpassesOf(g, bridgeProfiles, dem, opts.railBridges ?? []);
    for (const r of routes) {
      // nœuds de l'itinéraire (un pont qui part de l'un d'eux n'est pas au-dessus) et points tenus (sur un pont, en tunnel)
      const nodes = new Set<number>();
      for (const id of new Set(r.edgeOf)) nodes.add(g.edges[id]!.a).add(g.edges[id]!.b);
      const pinned = r.edgeOf.map((id) => g.edges[id]!.road.bridge || g.edges[id]!.road.tunnel);
      if (lowerRouteUnderpasses(r.route.points, r.route.loop, ov, undefined, { nodes, pinned })) routesLowered.add(r.route.id);
    }
  }
  // 1. itinéraires : couloirs prioritaires, morceaux par arête (attributs OSM)
  for (const r of routes) {
    const pts = r.route.points;
    const n = pts.length;
    for (const e of r.edgeOf) routeEdges.add(e);
    carve.push({
      pts: pts.map((p) => [p.x, p.y, p.z] as [number, number, number]),
      halfWidth: r.route.roadWidthM / 2,
      priority: r.priority,
      closed: r.route.loop,
    });
    // altitude des nœuds du graphe situés sur l'itinéraire
    const nodes = new Set<number>();
    for (const eid of new Set(r.edgeOf)) {
      const e = g.edges[eid]!;
      nodes.add(e.a);
      nodes.add(e.b);
    }
    for (const nd of nodes) {
      if (nodeH.has(nd)) continue;
      const p = g.nodePos.get(nd)!;
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(pts[i]!.x - p[0], pts[i]!.z - p[1]);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      if (bd < 15) nodeH.set(nd, pts[bi]!.y);
    }
    // morceaux de rendu : coupure à chaque changement d'arête
    let start = 0;
    for (let i = 1; i <= n; i++) {
      if (i < n && r.edgeOf[i] === r.edgeOf[start]) continue;
      const e = g.edges[r.edgeOf[start]!]!;
      const end = Math.min(i, n - 1);
      const seg = pts.slice(start, end + 1).map((p) => [p.x, p.y, p.z] as [number, number, number]);
      if (i === n && r.route.loop) seg.push([pts[0]!.x, pts[0]!.y, pts[0]!.z]);
      if (seg.length >= 2)
        roads.push({
          id: `route:${r.route.id}:${e.road.id}`,
          kind: e.road.kind,
          ...(e.road.name ? { name: e.road.name } : {}),
          ...(e.road.ref ? { ref: e.road.ref } : {}),
          width: e.road.width,
          surface: e.road.surface,
          ...(e.road.bridge ? { bridge: true } : {}),
          ...(e.road.tunnel ? { tunnel: true } : {}),
          route: r.route.id,
          flatten: [Math.round((r.route.roadWidthM / 2 + 0.5) * 100) / 100, Math.round((4 + r.route.roadWidthM / 2 + 0.5) * 100) / 100],
          pts: seg,
        });
      start = i;
    }
  }
  // 2. altitude des autres nœuds : médiane locale du MNT
  const nodeHeight = (nd: number): number => {
    let h = nodeH.get(nd);
    if (h !== undefined) return h;
    h = opts.deckHeights?.get(nd);
    if (h !== undefined) {
      nodeH.set(nd, h);
      return h;
    }
    const p = g.nodePos.get(nd)!;
    const vals = [demAt(dem, p[0], p[1]), demAt(dem, p[0] + 1.5, p[1]), demAt(dem, p[0] - 1.5, p[1]), demAt(dem, p[0], p[1] + 1.5), demAt(dem, p[0], p[1] - 1.5)]
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    h = vals[Math.floor(vals.length / 2)] ?? 0;
    nodeH.set(nd, h);
    return h;
  };
  // 3. arêtes OSM
  const addRoad = (e: Edge, pts3: Array<[number, number, number]>, id: string) => {
    const carved = CARVED.test(e.road.kind) && !e.road.bridge && !e.road.tunnel;
    const hw = e.road.width / 2;
    roads.push({
      id,
      kind: e.road.kind,
      ...(e.road.name ? { name: e.road.name } : {}),
      ...(e.road.ref ? { ref: e.road.ref } : {}),
      width: e.road.width,
      surface: e.road.surface,
      ...(e.road.bridge ? { bridge: true } : {}),
      ...(e.road.tunnel ? { tunnel: true } : {}),
      ...(carved ? { flatten: [Math.round((hw + 0.5) * 100) / 100, Math.round((4 + hw + 0.5) * 100) / 100] as [number, number] } : {}),
      // géométrie de rendu simplifiée (≤ 20 cm en plan, ≤ 3 cm en altitude) ; le creusement utilise le profil dense
      pts: simplify3(pts3, 0.2, 0.03),
    });
    if (carved) carve.push({ pts: pts3, halfWidth: hw, priority: 0 });
  };
  for (const e of g.edges) {
    if (routeEdges.has(e.id)) continue;
    edgePts.set(e.id, edgeProfile(e, dem, nodeHeight(e.a), nodeHeight(e.b)));
  }
  // Passages sous les ponts : le MNT interpolé sous un tablier garde une bosse à sa hauteur, que le profil suivait
  // (route qui montait dans le pont, 21/11/2026 à Angerville sous la N20 et sous la voie ferrée).
  const under = lowerUnderpasses(g, edgePts, routeEdges, dem, opts.railBridges ?? []);
  for (const e of g.edges) {
    if (routeEdges.has(e.id)) continue;
    addRoad(e, edgePts.get(e.id)!, `w${e.road.id}`);
  }
  // 4. arêtes suivies par un itinéraire (monde ouvert autour d'itinéraires gardés) : profil calé sur
  // l'itinéraire là où il le suit (fondu au-delà de 12 m), rendu et creusé seulement hors de lui
  if (opts.routeEdgeProfiles && routeEdges.size) {
    const near = new GridIndex<[number, number, number]>(25);
    for (const r of routes) for (const p of r.route.points) near.insertBox({ minX: p.x, minZ: p.z, maxX: p.x, maxZ: p.z }, [p.x, p.y, p.z]);
    for (const eid of routeEdges) {
      const e = g.edges[eid]!;
      const pts3 = edgeProfile(e, dem, nodeHeight(e.a), nodeHeight(e.b));
      const off = pts3.map((p) => {
        let bd = Infinity;
        let by = 0;
        for (const q of near.query(p[0], p[2], 25)) {
          const d = Math.hypot(q[0] - p[0], q[2] - p[2]);
          if (d < bd) {
            bd = d;
            by = q[1];
          }
        }
        const w = bd <= 12 ? 1 : bd >= 25 ? 0 : (25 - bd) / 13;
        p[1] += (by - p[1]) * w;
        return bd > 8;
      });
      edgePts.set(eid, pts3);
      // morceaux hors itinéraire (bouts d'arête avant le départ, après l'arrivée), d'un point de plus de chaque côté
      for (let i = 0; i < pts3.length; ) {
        if (!off[i]) {
          i++;
          continue;
        }
        let j = i;
        while (j + 1 < pts3.length && off[j + 1]) j++;
        const run = pts3.slice(Math.max(0, i - 1), Math.min(pts3.length, j + 2));
        if (run.length >= 2) addRoad(e, run, `w${e.road.id}:${i}`);
        i = j + 1;
      }
    }
  }
  return { roads, carve, edgePts, underpasses: under, routesLowered };
}

/**
 * Profil d'une arête : MNT tous les 4 m, lissage gaussien σ = 8 m, extrémités recalées sur
 * l'altitude des nœuds (correction linéaire). Ponts/tunnels : interpolation entre les nœuds.
 */
export function edgeProfile(e: Edge, dem: DemStack, ha: number, hb: number): Array<[number, number, number]> {
  const pts: Pt[] = e.len > 8 ? resampleOpen(e.pts, Math.min(8, Math.max(2, e.len / Math.ceil(e.len / 4)))) : e.pts.slice();
  const n = pts.length;
  if (e.road.bridge || e.road.tunnel || n < 3) {
    let acc = 0;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push((acc += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1])));
    const L = acc || 1;
    return pts.map((p, i) => [p[0], ha + ((hb - ha) * cum[i]!) / L, p[1]]);
  }
  const raw = pts.map((p) => demAt(dem, p[0], p[1]));
  for (let i = 0; i < n; i++) if (!Number.isFinite(raw[i]!)) raw[i] = ha + ((hb - ha) * i) / (n - 1);
  const step = e.len / (n - 1);
  const s = smooth1d(raw, 8 / step, false);
  const ca = ha - s[0]!;
  const cb = hb - s[n - 1]!;
  return pts.map((p, i) => [p[0], s[i]! + ca + ((cb - ca) * i) / (n - 1), p[1]]);
}

/** Hauteur libre sous un tablier (m) : cycliste, véhicules, avec de la marge. */
export const UNDERPASS_CLEARANCE_M = 4.2;
/** Épaisseur d'un tablier routier sous la chaussée (m). */
const ROAD_DECK_M = 0.9;
/** Rail au-dessus du sol (railways.ts, `railY`) et tablier ferroviaire sous le rail (m). */
const RAIL_ABOVE_GROUND_M = 0.55;
const RAIL_DECK_M = 1.2;
/** Pente des rampes d'accès au passage abaissé. */
const UNDERPASS_GRADE = 0.06;
/** Abaissement au-delà duquel on se méfie des données (pont mal placé, voie en viaduc) : rien n'est fait. */
const UNDERPASS_MAX_LOWER_M = 6;
/** Pente (en plus de celle du terrain) pour remonter à un nœud tenu : bout de pont, de tunnel, itinéraire gardé. */
const UNDERPASS_PIN_GRADE = 0.12;
/** Un croisement à moins de cette distance (m) du bout du pont, à un nœud commun, est le raccord de la route au pont. */
const BRIDGE_END_M = 5;
/** Hauteur libre (m) sous laquelle un passage abaissé est compté comme trop bas (`short`). */
const UNDERPASS_SHORT_M = 3;

export interface UnderpassStats {
  /** Croisements sous un pont où la route a été abaissée. */
  lowered: number;
  /** Plus grand abaissement (m). */
  maxLowerM: number;
  /** Croisements laissés tels quels (abaissement trop grand pour être crédible). */
  skipped: number;
  /** Passages restés sous 3 m libres : un nœud tenu (bout de pont, itinéraire) est trop près pour la rampe. */
  short?: number;
}

/** Abscisses (0…1) du croisement du segment ab avec le segment cd, en plan ; null sans croisement. */
function crossT(a: Pt, b: Pt, c: Pt, d: Pt): { t: number; u: number } | null {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

/** Point d'où part une rampe : altitude plafonnée `y` et abaissement permis `rel` (m). */
interface RampState {
  y: number;
  rel: number;
}

/**
 * Abaissement (m) à `d` mètres d'un point plafonné : le plafond remonte à `UNDERPASS_GRADE` (efface la bosse du MNT
 * sous le tablier) et l'abaissement lui-même s'efface à la même pente. Sans ce second terme, une route qui monte à
 * plus de 6 % ne rejoignait jamais son profil et restait abaissée jusqu'au col (Tourmalet, 25/11/2026).
 */
const rampLower = (base: number, st: RampState, d: number) => Math.max(0, Math.min(base - (st.y + UNDERPASS_GRADE * d), st.rel - UNDERPASS_GRADE * d));

/** Un croisement le long d'un profil [s0, s1] : abaissement voulu (palier ± flat, puis `rampLower`) et abaissement permis. */
function crossingRamp(c: UnderpassCrossing, s0: number, s1: number, yAt: (s: number) => number) {
  const lo = Math.max(s0, c.s - c.flat), hi = Math.min(s1, c.s + c.flat);
  const rel = (s: number) => Math.max(0, Math.min(UNDERPASS_MAX_LOWER_M, yAt(s) - c.target));
  const relLo = rel(lo), relHi = rel(hi);
  return {
    lower: (s: number, base: number) => {
      if (s >= lo && s <= hi) return Math.max(0, Math.min(UNDERPASS_MAX_LOWER_M, base - c.target));
      return s < lo ? rampLower(base, { y: c.target, rel: relLo }, lo - s) : rampLower(base, { y: c.target, rel: relHi }, s - hi);
    },
    rel: (s: number) => (s < lo ? relLo - UNDERPASS_GRADE * (lo - s) : s > hi ? relHi - UNDERPASS_GRADE * (s - hi) : rel(s)),
  };
}

/** Altitude d'un profil à l'abscisse `d` (abscisses cumulées `s`). */
function interpAt(s: readonly number[], prof: ReadonlyArray<readonly [number, number, number]>, d: number): number {
  let lo = 0;
  let hi = s.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (s[m]! <= d) lo = m;
    else hi = m;
  }
  const t = Math.max(0, Math.min(1, (d - s[lo]!) / (s[hi]! - s[lo]! || 1)));
  return prof[lo]![1] + (prof[hi]![1] - prof[lo]![1]) * t;
}

/**
 * Abaisse les routes qui passent sous un pont (routier ou ferroviaire) pour laisser `UNDERPASS_CLEARANCE_M` sous le
 * tablier : palier sous le pont, rampes à `UNDERPASS_GRADE` de part et d'autre, prolongées aux arêtes voisines par
 * les nœuds (profils continus aux carrefours). Le profil n'est jamais relevé, ni abaissé de plus de
 * `UNDERPASS_MAX_LOWER_M`. Les arêtes des itinéraires gardés (`frozen`), les ponts et les tunnels ne sont pas
 * touchés, leurs nœuds non plus : la route remonte avant eux (`UNDERPASS_PIN_GRADE`). Modifie `edgePts` en place.
 * Dessous du tablier : profil du pont routier au croisement, ou rail posé sur le MNT de part et d'autre du passage.
 */
export function lowerUnderpasses(
  g: RoadGraph,
  edgePts: Map<number, Array<[number, number, number]>>,
  frozen: ReadonlySet<number>,
  dem: DemStack,
  railBridges: ReadonlyArray<{ pts: Pt[]; width: number }>,
): UnderpassStats {
  const stats: UnderpassStats = { lowered: 0, maxLowerM: 0, skipped: 0, short: 0 };
  const movable = (e: Edge) => !e.road.bridge && !e.road.tunnel && !frozen.has(e.id) && edgePts.has(e.id);
  const ov = overpassesOf(g, edgePts, dem, railBridges);
  if (!ov.overs.length) return stats;
  const incident = new Map<number, number[]>();
  for (const e of g.edges) {
    if (!movable(e)) continue;
    for (const nd of [e.a, e.b]) {
      const l = incident.get(nd);
      if (l) l.push(e.id);
      else incident.set(nd, [e.id]);
    }
  }
  const cumOf = new Map<number, number[]>();
  const cum = (id: number) => {
    let s = cumOf.get(id);
    if (!s) {
      const prof = edgePts.get(id)!;
      s = [0];
      for (let i = 1; i < prof.length; i++) s.push(s[i - 1]! + Math.hypot(prof[i]![0] - prof[i - 1]![0], prof[i]![2] - prof[i - 1]![2]));
      cumOf.set(id, s);
    }
    return s;
  };
  const lenOf = (id: number) => {
    const s = cum(id);
    return s[s.length - 1]!;
  };
  // Abaissement voulu par point d'arête et rampe aux nœuds ; les profils ne bougent qu'à la fin.
  const low = new Map<number, Float64Array>();
  const nodeLow = new Map<number, RampState & { low: number }>();
  const queue: number[] = [];
  const lowerEdge = (e: Edge, want: (s: number, base: number) => number, rel: (s: number) => number) => {
    const prof = edgePts.get(e.id)!;
    const s = cum(e.id);
    let l = low.get(e.id);
    for (let i = 0; i < prof.length; i++) {
      const v = want(s[i]!, prof[i]![1]);
      if (v <= 0) continue;
      if (!l) low.set(e.id, (l = new Float64Array(prof.length)));
      if (v > l[i]!) l[i] = v;
      if (i > 0 && i < prof.length - 1) continue;
      const nd = i === 0 ? e.a : e.b;
      if (v > (nodeLow.get(nd)?.low ?? 0) + 1e-3) {
        nodeLow.set(nd, { low: v, y: prof[i]![1] - v, rel: Math.max(v, rel(s[i]!)) });
        queue.push(nd);
      }
    }
  };
  const crossings: Array<{ edge: number; c: UnderpassCrossing }> = [];
  for (const e of g.edges) {
    if (!movable(e)) continue;
    const prof = edgePts.get(e.id)!;
    for (const c of underpassCrossings(prof, ov, stats, new Set([e.a, e.b]))) {
      crossings.push({ edge: e.id, c });
      const ramp = crossingRamp(c, 0, lenOf(e.id), (d) => interpAt(cum(e.id), prof, d));
      lowerEdge(e, ramp.lower, ramp.rel);
    }
  }
  // Rampes prolongées par les nœuds : l'abaissement du nœud s'efface le long de chaque arête voisine.
  while (queue.length) {
    const nd = queue.pop()!;
    const st = nodeLow.get(nd)!;
    for (const eid of incident.get(nd) ?? []) {
      const e = g.edges[eid]!;
      const L = lenOf(eid);
      const dist = (s: number) => (e.a === nd ? s : L - s);
      lowerEdge(e, (s, base) => rampLower(base, st, dist(s)), (s) => st.rel - UNDERPASS_GRADE * dist(s));
    }
  }
  // Nœuds tenus (pont, tunnel, itinéraire gardé) : abaissement nul, qui grandit avec la distance par les arêtes.
  const allow = new Map<number, number>();
  const pins: number[] = [];
  for (const e of g.edges) {
    if (movable(e)) continue;
    for (const nd of [e.a, e.b])
      if (!allow.has(nd)) {
        allow.set(nd, 0);
        pins.push(nd);
      }
  }
  for (let q = 0; q < pins.length; q++) {
    const nd = pins[q]!;
    const v = allow.get(nd)!;
    for (const eid of incident.get(nd) ?? []) {
      const e = g.edges[eid]!;
      const o = e.a === nd ? e.b : e.a;
      const w = v + UNDERPASS_PIN_GRADE * lenOf(eid);
      if (w < UNDERPASS_MAX_LOWER_M && w < (allow.get(o) ?? Infinity) - 1e-9) {
        allow.set(o, w);
        pins.push(o);
      }
    }
  }
  for (const [id, l] of low) {
    const e = g.edges[id]!;
    const prof = edgePts.get(id)!;
    const s = cum(id);
    const L = lenOf(id);
    const aa = allow.get(e.a) ?? Infinity;
    const ab = allow.get(e.b) ?? Infinity;
    for (let i = 0; i < prof.length; i++) prof[i]![1] -= Math.max(0, Math.min(l[i]!, aa + UNDERPASS_PIN_GRADE * s[i]!, ab + UNDERPASS_PIN_GRADE * (L - s[i]!)));
  }
  for (const { edge, c } of crossings) if (c.target + UNDERPASS_CLEARANCE_M - interpAt(cum(edge), edgePts.get(edge)!, c.s) < UNDERPASS_SHORT_M) stats.short!++;
  return stats;
}

/** Ponts (routiers et ferroviaires) : axe en plan, demi-largeur, dessous du tablier au croisement (segment k, abscisse u, point `at`). */
export interface Overpasses {
  /** `ends` : nœuds des bouts d'un pont routier (rien pour un pont ferroviaire, hors graphe). */
  overs: Array<{ pts: Pt[]; hw: number; ends?: [number, number]; under: (k: number, u: number, at: Pt) => number }>;
  index: GridIndex<number>;
}

/** Ponts routiers du graphe (profil de tablier dans `profiles`) et ponts ferroviaires OSM (rail posé sur le MNT de la voie). */
export function overpassesOf(
  g: RoadGraph,
  profiles: ReadonlyMap<number, Array<[number, number, number]>>,
  dem: DemStack,
  railBridges: ReadonlyArray<{ pts: Pt[]; width: number }>,
): Overpasses {
  const overs: Overpasses['overs'] = [];
  for (const e of g.edges) {
    if (!e.road.bridge) continue;
    const prof = profiles.get(e.id);
    if (!prof || prof.length < 2) continue;
    overs.push({ ends: [e.a, e.b], pts: prof.map((p) => [p[0], p[2]] as Pt), hw: e.road.width / 2, under: (k, u) => prof[k]![1] + (prof[k + 1]![1] - prof[k]![1]) * u - ROAD_DECK_M });
  }
  for (const r of railBridges) {
    if (r.pts.length < 2) continue;
    overs.push({
      pts: r.pts,
      hw: r.width / 2,
      // Rail posé sur le MNT de la voie, de part et d'autre du passage (la bosse sous le tablier mise à part).
      under: (k, _u, at) => {
        const a = r.pts[k]!, b = r.pts[k + 1]!;
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l;
        const vals: number[] = [];
        for (const s of [-40, -30, -20, 20, 30, 40]) {
          const v = demAt(dem, at[0] + dx * s, at[1] + dz * s);
          if (Number.isFinite(v)) vals.push(v);
        }
        if (!vals.length) return Infinity;
        vals.sort((p, q) => p - q);
        return vals[vals.length >> 1]! + RAIL_ABOVE_GROUND_M - RAIL_DECK_M;
      },
    });
  }
  const index = new GridIndex<number>(50);
  overs.forEach((o, i) => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of o.pts) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]);
      maxZ = Math.max(maxZ, p[1]);
    }
    index.insertBox({ minX, minZ, maxX, maxZ }, i);
  });
  return { overs, index };
}

export interface UnderpassCrossing {
  s: number;
  target: number;
  flat: number;
}

/**
 * Passages sous un pont d'une polyligne 3D (x, y, z) : abscisse curviligne `s` du croisement, altitude visée
 * (dessous du tablier − hauteur libre) et demi-longueur du palier. Seuls ceux où il faut abaisser (de 5 cm à
 * UNDERPASS_MAX_LOWER_M) sont rendus ; `stats` est mis à jour. `nodes` : nœuds de la polyligne ; un pont qui part de
 * l'un d'eux la prolonge, il n'est pas au-dessus (la route était abaissée de 5,1 m au bout de chaque pont, 25/11/2026).
 */
export function underpassCrossings(prof: ReadonlyArray<readonly [number, number, number]>, ov: Overpasses, stats: UnderpassStats, nodes: ReadonlySet<number> = new Set()): UnderpassCrossing[] {
  const out: UnderpassCrossing[] = [];
  let s0 = 0;
  for (let i = 0; i + 1 < prof.length; i++) {
    const a: Pt = [prof[i]![0], prof[i]![2]];
    const b: Pt = [prof[i + 1]![0], prof[i + 1]![2]];
    const segL = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (const oi of new Set(ov.index.query((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, segL / 2 + 1))) {
      const o = ov.overs[oi]!;
      for (let k = 0; k + 1 < o.pts.length; k++) {
        const hit = crossT(a, b, o.pts[k]!, o.pts[k + 1]!);
        // croisement sur un point du profil : compté avec le segment suivant (ou au même point de l'ouvrage)
        if (!hit || (hit.t >= 1 && i + 2 < prof.length) || (hit.u >= 1 && k + 2 < o.pts.length)) continue;
        const at: Pt = [a[0] + (b[0] - a[0]) * hit.t, a[1] + (b[1] - a[1]) * hit.t];
        const atEnd = o.ends?.some((nd, j) => {
          const q = o.pts[j ? o.pts.length - 1 : 0]!;
          return nodes.has(nd) && Math.hypot(q[0] - at[0], q[1] - at[1]) < BRIDGE_END_M;
        });
        if (atEnd) continue;
        const yRoad = prof[i]![1] + (prof[i + 1]![1] - prof[i]![1]) * hit.t;
        const target = o.under(k, hit.u, at) - UNDERPASS_CLEARANCE_M;
        const lower = yRoad - target;
        if (!(lower > 0.05)) continue;
        if (lower > UNDERPASS_MAX_LOWER_M) {
          stats.skipped++;
          continue;
        }
        stats.lowered++;
        stats.maxLowerM = Math.max(stats.maxLowerM, lower);
        // palier sous le tablier (en biais : largeur du pont divisée par le sinus de l'angle, bornée), puis rampes
        const ox = o.pts[k + 1]![0] - o.pts[k]![0], oz = o.pts[k + 1]![1] - o.pts[k]![1];
        const sin = Math.abs((b[0] - a[0]) * oz - (b[1] - a[1]) * ox) / ((segL || 1) * (Math.hypot(ox, oz) || 1));
        out.push({ s: s0 + segL * hit.t, target, flat: Math.min(40, (o.hw + 2) / Math.max(sin, 0.25)) });
      }
    }
    s0 += segL;
  }
  return out;
}

/**
 * Itinéraire gardé qui passe sous un pont : ses points sont abaissés comme une route (palier et rampes, jamais
 * relevés ; boucle : rampes de part et d'autre de l'arrivée). `touch` : nœuds de l'itinéraire et points tenus (sur un
 * pont, en tunnel), jamais abaissés. Renvoie vrai si un point a changé.
 */
export function lowerRouteUnderpasses(
  points: Array<{ x: number; y: number; z: number; d: number }>,
  loop: boolean,
  ov: Overpasses,
  stats: UnderpassStats = { lowered: 0, maxLowerM: 0, skipped: 0 },
  touch: { nodes?: ReadonlySet<number>; pinned?: ReadonlyArray<boolean> } = {},
): boolean {
  const n = points.length;
  if (n < 2 || !ov.overs.length) return false;
  const prof = points.map((p) => [p.x, p.y, p.z] as [number, number, number]);
  if (loop) prof.push([points[0]!.x, points[0]!.y, points[0]!.z]);
  const cs = underpassCrossings(prof, ov, stats, touch.nodes);
  if (!cs.length) return false;
  // abscisses curvilignes en plan, comme `underpassCrossings`
  const sAt = [0];
  for (let i = 1; i < prof.length; i++) sAt.push(sAt[i - 1]! + Math.hypot(prof[i]![0] - prof[i - 1]![0], prof[i]![2] - prof[i - 1]![2]));
  const L = sAt[sAt.length - 1]!;
  const yAt = (s: number) => interpAt(sAt, prof, loop ? ((s % L) + L) % L : s);
  const ramps = cs.map((c) => ({ s: c.s, ...crossingRamp(c, loop ? -Infinity : 0, loop ? Infinity : L, yAt) }));
  // distance (m) au point tenu le plus proche le long de l'itinéraire (boucle : deux tours, l'arrivée se referme)
  const pin = new Float64Array(n).fill(Infinity);
  if (touch.pinned?.some(Boolean)) {
    for (let k = 0; k < n; k++) if (touch.pinned[k]) pin[k] = 0;
    const turns = loop ? 2 : 1;
    const gap = (i: number) => (i + 1 < n ? sAt[i + 1]! - sAt[i]! : L - sAt[i]!);
    for (let k = 1; k < n * turns; k++) pin[k % n] = Math.min(pin[k % n]!, pin[(k - 1) % n]! + gap((k - 1) % n));
    for (let k = n * turns - 2; k >= 0; k--) pin[k % n] = Math.min(pin[k % n]!, pin[(k + 1) % n]! + gap(k % n));
  }
  // Itinéraire validé : un passage dont la rampe bute sur un point tenu (sortie de pont, Alpe d'Huez 26/11/2026)
  // creuserait un creux à 12 % de plus que la pente ; il est laissé tel quel et compté dans `short`.
  const near = (s: number) => {
    const w = ((s % L) + L) % L;
    let k = sAt.findIndex((v) => v >= w);
    if (k < 0 || k >= n) k = loop ? 0 : n - 1;
    return k;
  };
  const kept = ramps.filter((r) => {
    const k = near(r.s);
    if (r.lower(sAt[k]!, points[k]!.y) <= UNDERPASS_PIN_GRADE * pin[k]! + 0.05) return true;
    stats.short = (stats.short ?? 0) + 1;
    return false;
  });
  let changed = false;
  for (let i = 0; i < n; i++) {
    const base = points[i]!.y;
    let l = 0;
    for (const r of kept) {
      let s = sAt[i]!;
      if (loop && s - r.s > L / 2) s -= L;
      else if (loop && r.s - s > L / 2) s += L;
      l = Math.max(l, r.lower(s, base));
    }
    l = Math.min(l, UNDERPASS_PIN_GRADE * pin[i]!);
    if (l > 1e-4) {
      points[i]!.y = Math.round((base - l) * 100) / 100;
      changed = true;
    }
  }
  return changed;
}
