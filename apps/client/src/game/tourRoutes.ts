import { edgeLengths, frenchOf, isPavedEdge, itineraryCost, itineraryRoute, joinItineraries, planItinerary, snapToRoad, type Itinerary, type RoadGraphEdge, type RoadNet, type RoadSnap, type RouteData, type RouteSegment, type WorldPlace } from '@allezrobert/shared';
import { stagePlan, type StageKind, type TourLength, type TourStage, type TourTt } from './tourPlan.ts';

/**
 * Étapes de ville en ville, créées sur le graphe routier de la zone : des allers simples qui s'enchaînent (chaque étape
 * part de l'arrivée de la précédente), avec une étape de montagne qui finit au sommet quand la zone en a un, et la
 * dernière arrivée dans la plus grande ville. Aucun parcours à fabriquer zone par zone.
 *
 * L'identifiant d'une étape porte ses points (départ, passage, arrivée, en mètres) et suffit à la reconstruire.
 * Module pur (sans DOM), testé.
 */

const ID = /^itineraire-tour-((?:-?\d+_-?\d+)(?:\.-?\d+_-?\d+)+)$/;
const TARGET_M: Record<TourLength, number> = { short: 12_000, medium: 22_000, long: 40_000 };
const TT_TARGET_M = 7000;
const MAX_PLACES = 16;
/** Part d'une étape parcourue deux fois (aller-retour sur la même route) tolérée. */
const MAX_OVERLAP = 0.1;
const RANK: Record<string, number> = { city: 0, town: 1, village: 2, hamlet: 3 };
/** Lieux-dits où une étape finit au sommet. */
/** Lotissements et lieux numérotés : jamais ville d'étape. */
const NOT_A_TOWN = /^R[ée]sidence|^Cit[ée]|\d/i;
const SUMMIT = /^(Col|Phare|Mont|Puy|Pic|Sommet|Signal)\b/;

interface Stop {
  name: string;
  kind: string;
  x: number;
  z: number;
  snap: RoadSnap;
  summit: boolean;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Course sur route : chemins, pistes cyclables et voies de service évités autant que possible. */
export function raceCost(e: RoadGraphEdge): number {
  if (!isPavedEdge(e)) return 14;
  if (/^(cycleway|footway|path|pedestrian|steps|service)/.test(e.kind)) return 6;
  if (/^(residential|living_street)/.test(e.kind)) return 1.25;
  return itineraryCost(e);
}

export function cityRouteId(points: ReadonlyArray<{ x: number; z: number }>): string {
  return `itineraire-tour-${points.map((p) => `${Math.round(p.x)}_${Math.round(p.z)}`).join('.')}`;
}

export function parseCityRouteId(id: string): Array<{ x: number; z: number }> | null {
  const m = ID.exec(id);
  return m
    ? (m[1] as string).split('.').map((s) => {
        const [x, z] = s.split('_').map(Number);
        return { x: x as number, z: z as number };
      })
    : null;
}

/** Villes d'étape : les plus grandes d'abord, espacées, reliées au réseau ; plus un ou deux sommets. */
export function tourStops(net: RoadNet, places: readonly WorldPlace[]): Stop[] {
  const named = places.filter((p) => p.name);
  const xs = named.map((p) => p.x);
  const zs = named.map((p) => p.z);
  const extent = named.length ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) : 0;
  const gap = Math.max(700, extent / 14);
  const out: Stop[] = [];
  const take = (p: WorldPlace, summit: boolean, minGap: number) => {
    if (out.some((o) => o.name === p.name || Math.hypot(o.x - p.x, o.z - p.z) < minGap)) return;
    const snap = snapToRoad(net, p.x, p.z, 400);
    if (snap && isPavedEdge(net.edge(snap.edge))) out.push({ name: p.name, kind: p.kind, x: p.x, z: p.z, snap, summit });
  };
  // Parmi les plus grandes, celle du milieu de la zone passe d'abord : c'est elle qui accueille la dernière arrivée.
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cz = (Math.max(...zs) + Math.min(...zs)) / 2;
  const towns = named
    .filter((p) => p.kind in RANK && !NOT_A_TOWN.test(p.name))
    .sort((a, b) => (RANK[a.kind] as number) - (RANK[b.kind] as number) || Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz) || a.name.localeCompare(b.name, 'fr'));
  for (const p of towns) if (out.length < MAX_PLACES) take(p, SUMMIT.test(p.name), gap);
  let peaks = 0;
  for (const p of named)
    if (!(p.kind in RANK) && SUMMIT.test(p.name) && peaks < 2) {
      const before = out.length;
      take(p, true, 400);
      peaks += out.length - before;
    }
  return out;
}

/** Longueur et montée du meilleur chemin d'un départ vers chaque ville (Dijkstra, une fois par départ). */
function reach(net: RoadNet, from: RoadSnap, to: readonly RoadSnap[], up: Float64Array): Array<{ len: number; up: number } | null> {
  const lens = edgeLengths(net);
  const n = net.incident.length;
  const cost = new Float64Array(n).fill(Infinity);
  const len = new Float64Array(n);
  const climb = new Float64Array(n);
  const heap: Array<[number, number]> = [];
  const push = (k: number, id: number) => {
    heap.push([k, id]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((heap[p] as [number, number])[0] <= k) break;
      heap[i] = heap[p] as [number, number];
      i = p;
    }
    heap[i] = [k, id];
  };
  const pop = (): [number, number] => {
    const top = heap[0] as [number, number];
    const last = heap.pop() as [number, number];
    if (heap.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && (heap[c + 1] as [number, number])[0] < (heap[c] as [number, number])[0]) c++;
        if ((heap[c] as [number, number])[0] >= last[0]) break;
        heap[i] = heap[c] as [number, number];
        i = c;
      }
      heap[i] = last;
    }
    return top;
  };
  const relax = (node: number, k: number, l: number, u: number) => {
    if (k >= (cost[node] as number)) return;
    cost[node] = k;
    len[node] = l;
    climb[node] = u;
    push(k, node);
  };
  const ef = net.edge(from.edge);
  const lf = lens[from.edge] as number;
  const cf = raceCost(ef);
  if (net.allowed({ edge: from.edge, forward: true })) relax(ef.b, (lf - from.along) * cf, lf - from.along, 0);
  if (net.allowed({ edge: from.edge, forward: false })) relax(ef.a, from.along * cf, from.along, 0);
  while (heap.length) {
    const [k, u] = pop();
    if (k > (cost[u] as number)) continue;
    for (const ei of net.incident[u] ?? []) {
      const e = net.edge(ei);
      for (const forward of [true, false]) {
        if ((forward ? e.a : e.b) !== u || !net.allowed({ edge: ei, forward })) continue;
        relax(forward ? e.b : e.a, k + (lens[ei] as number) * raceCost(e), (len[u] as number) + (lens[ei] as number), (climb[u] as number) + (up[ei * 2 + (forward ? 0 : 1)] as number));
      }
    }
  }
  return to.map((t) => {
    if (t === from) return null;
    const e = net.edge(t.edge);
    const l = lens[t.edge] as number;
    const c = raceCost(e);
    const a = net.allowed({ edge: t.edge, forward: true }) ? (cost[e.a] as number) + t.along * c : Infinity;
    const b = net.allowed({ edge: t.edge, forward: false }) ? (cost[e.b] as number) + (l - t.along) * c : Infinity;
    if (!Number.isFinite(Math.min(a, b))) return null;
    return a <= b ? { len: (len[e.a] as number) + t.along, up: climb[e.a] as number } : { len: (len[e.b] as number) + l - t.along, up: climb[e.b] as number };
  });
}

/** Montée de chaque arête : aller (2 i) et retour (2 i + 1). */
function edgeClimbs(net: RoadNet): Float64Array {
  const out = new Float64Array(net.data.edges.length * 2);
  net.data.edges.forEach((e, i) => {
    for (let k = 4; k < e.pts.length; k += 3) {
      const dy = (e.pts[k] as number) - (e.pts[k - 3] as number);
      if (dy > 0) out[2 * i] = (out[2 * i] as number) + dy;
      else out[2 * i + 1] = (out[2 * i + 1] as number) - dy;
    }
  });
  return out;
}

/** Chemin complet par les points donnés, et part de ce chemin roulée deux fois. */
function pathThrough(net: RoadNet, snaps: readonly RoadSnap[]): { it: Itinerary; overlap: number } | null {
  const legs: Itinerary[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const leg = planItinerary(net, snaps[i - 1] as RoadSnap, snaps[i] as RoadSnap, raceCost);
    if (!leg) return null;
    legs.push(leg);
  }
  const it = joinItineraries(legs);
  const seen = new Set<number>();
  let total = 0;
  let twice = 0;
  for (const s of it.steps) {
    const l = s.to - s.from;
    total += l;
    if (seen.has(s.edge)) twice += l;
    seen.add(s.edge);
  }
  return { it, overlap: total > 0 ? twice / total : 1 };
}

/** Sprints intermédiaires : 300 m avant un village traversé, hors des côtes. */
function sprintsOf(r: RouteData, id: string): RouteSegment[] {
  const out: RouteSegment[] = [];
  const max = r.lengthM > 16_000 ? 2 : 1;
  for (const l of r.landmarks ?? []) {
    if (out.length >= max || l.d < 0.2 * r.lengthM || l.d > 0.85 * r.lengthM) continue;
    const startM = round2(l.d - 300);
    const endM = round2(l.d);
    if ([...r.segments, ...out].some((s) => startM < s.endM + 400 && endM > s.startM - 400)) continue;
    out.push({ id: `${id}-sprint-${out.length + 1}`, kind: 'sprint', name: `Sprint ${frenchOf(l.name)}`, startM, endM, avgGrade: 0 });
  }
  return out;
}

const built = new WeakMap<RoadNet, Map<string, RouteData | null>>();

/** Étape de ville en ville d'après son identifiant ; `null` si ce n'en est pas une ou si la route n'existe plus. */
export function buildCityRoute(net: RoadNet, places: readonly WorldPlace[], id: string): RouteData | null {
  let cache = built.get(net);
  if (!cache) built.set(net, (cache = new Map()));
  const have = cache.get(id);
  if (have !== undefined) return have;
  const pts = parseCityRouteId(id);
  let route: RouteData | null = null;
  if (pts) {
    const snaps = pts.map((p) => snapToRoad(net, p.x, p.z, 450));
    const path = snaps.every((s) => s !== null) ? pathThrough(net, snaps as RoadSnap[]) : null;
    const at = (p: { x: number; z: number }) => places.reduce<WorldPlace | null>((b, q) => (q.name && (!b || Math.hypot(q.x - p.x, q.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z)) ? q : b), null)?.name ?? '';
    const name = `${at(pts[0] as { x: number; z: number })} – ${at(pts.at(-1) as { x: number; z: number })}`;
    route = path ? itineraryRoute(net, path.it, { id, name, nameEn: name, places: [...places] }) : null;
    if (route) {
      // Côte sans village à son sommet : le lieu le plus proche, même un lieu-dit.
      for (const s of route.segments)
        if (/^Côte \d+$/.test(s.name)) {
          const top = route.points[Math.min(route.points.length - 1, Math.round(s.endM / (route.stepM ?? 2)))];
          const near = top && at(top);
          if (near) s.name = `Côte ${frenchOf(near)}`;
        }
      for (const s of route.segments) s.name = s.name.replace(/^Côte de (Phare|Col|Mont|Moulin|Château|Pont|Puy|Pic|Port|Plateau|Hameau)/, 'Côte du $1');
      for (const s of route.segments) {
        const same = route.segments.filter((o) => o.name === s.name);
        if (same.length > 1) same.forEach((o, k) => (o.name = `${o.name} ${k + 1}`));
      }
      route.segments = [...route.segments, ...sprintsOf(route, id)].sort((a, b) => a.startM - b.startM);
    }
  }
  cache.set(id, route);
  return route;
}

/** Tirage reproductible entre 0 et 1. */
function draw(seed: number, ...k: number[]): number {
  let h = 2166136261 ^ seed;
  for (const v of k) h = Math.imul(h ^ (v + 0x9e3779b9), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export interface CityTourOptions {
  stages: number;
  tt: TourTt;
  length: TourLength;
  /** Change le tracé (bouton « Autre tracé »). */
  seed: number;
}

/**
 * Étapes d'un tour de ville en ville ; `null` si la zone a trop peu de villes reliées entre elles.
 */
export function cityStages(net: RoadNet, places: readonly WorldPlace[], o: CityTourOptions): TourStage[] | null {
  const stops = tourStops(net, places);
  const up = edgeClimbs(net);
  const snaps = stops.map((s) => s.snap);
  const table = stops.map((s) => reach(net, s.snap, snaps, up));
  // Villes reliées à au moins deux autres.
  const ok = stops.map((_, i) => table[i]?.filter(Boolean).length ?? 0).map((c) => c >= 2);
  const towns = stops.map((_, i) => i).filter((i) => ok[i] && !stops[i]?.summit);
  if (towns.length < 3) return null;
  const kinds = stagePlan(o.stages, o.tt);
  const roads = kinds.map((k, i) => (k === 'road' ? i : -1)).filter((i) => i >= 0);
  // Étape reine : l'avant-dernière étape en ligne.
  const queen = roads.length >= 2 ? (roads.at(-2) as number) : -1;
  const main = towns[0] as number;
  const visited = new Set<number>();
  const pairs = new Set<string>();
  let at = towns.filter((i) => i !== main).sort((a, b) => draw(o.seed, a) - draw(o.seed, b))[0] as number;
  visited.add(at);
  const out: TourStage[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i] as StageKind;
    const last = i === kinds.length - 1;
    const target = kind === 'tt' ? (i === 0 ? TT_TARGET_M * 0.8 : TT_TARGET_M) : TARGET_M[o.length];
    const cands: Array<{ stops: number[]; score: number; len: number }> = [];
    const consider = (s: number, e: number, v: number) => {
      const a = table[s]?.[v >= 0 ? v : e];
      const b = v >= 0 ? table[v]?.[e] : { len: 0, up: 0 };
      if (!a || !b) return;
      const len = a.len + b.len;
      if (len < 1500) return;
      const steep = (1000 * (a.up + b.up)) / len;
      const hill = i === queen ? -Math.min(1.5, steep / 18) - (stops[e]?.summit ? 1.2 : 0) : last || kind === 'tt' ? Math.min(0.8, steep / 25) : 0;
      const score =
        (kind === 'tt' ? 4 : 3) * Math.abs(Math.log(len / target)) + hill + (visited.has(e) ? 0.7 : 0) + (pairs.has(`${s} ${e}`) || pairs.has(`${e} ${s}`) ? 1.2 : 0) + (s === at ? 0 : 1.5) + (v >= 0 ? 0.1 + (visited.has(v) ? 0.15 : 0) : 0) + (last ? (e === main ? -0.8 : 0) : e === main ? 0.8 : 0) + 0.45 * draw(o.seed, i, e, v + 1);
      cands.push({ stops: v >= 0 ? [s, v, e] : [s, e], score, len });
    };
    const search = (s: number) => {
      for (let e = 0; e < stops.length; e++) {
        if (!ok[e] || e === s || (stops[e]?.summit && i !== queen)) continue;
        consider(s, e, -1);
        for (const v of towns) if (v !== e && v !== s) consider(s, e, v);
      }
    };
    search(at);
    // Chrono : aucune ville à la bonne distance, transfert vers un autre départ.
    if (kind === 'tt' && !cands.some((c) => c.len < 1.7 * target && c.len > target / 2)) for (const s of towns) if (s !== at) search(s);
    cands.sort((a, b) => a.score - b.score);
    // La meilleure sans aller-retour sur la même route ; à défaut, celle qui en a le moins.
    let best: { stops: number[]; overlap: number } | null = null;
    for (const c of cands.slice(0, 24)) {
      const p = pathThrough(net, c.stops.map((k) => snaps[k] as RoadSnap));
      if (!p) continue;
      if (!best || p.overlap < best.overlap - 0.001) best = { stops: c.stops, overlap: p.overlap };
      if (best.overlap <= MAX_OVERLAP) break;
    }
    if (!best) return null;
    const id = cityRouteId(best.stops.map((k) => stops[k] as Stop));
    const r = buildCityRoute(net, places, id);
    if (!r) return null;
    out.push({ kind, routeId: id, name: r.name, nameEn: r.nameEn ?? r.name, lengthM: Math.round(r.lengthM), gainM: Math.round(r.elevationGainM), laps: 1 });
    const end = best.stops.at(-1) as number;
    visited.add(end);
    pairs.add(`${best.stops[0]} ${end}`);
    // Arrivée au sommet : transfert, la suivante part de la ville la plus proche.
    at = stops[end]?.summit ? (towns.slice().sort((a, b) => (table[end]?.[a]?.len ?? Infinity) - (table[end]?.[b]?.len ?? Infinity))[0] as number) : end;
  }
  return out;
}
