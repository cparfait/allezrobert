import type { RouteData, RoutePoint, RouteSegment } from '@allezrobert/shared';

/**
 * Étapes d'un tour (game/stageRace.ts) : étapes de ville en ville (game/tourRoutes.ts), ou grande boucle de la zone
 * découpée en étapes qui s'enchaînent (sur l'île, le Tour de l'Île : chaque étape part là où la précédente est arrivée).
 * Zone sans assez de villes : les parcours de la zone.
 *
 * Une étape découpée a un identifiant qui suffit à la reconstruire (`itineraire-etape-<de>-<à>-<boucle>`, en mètres) :
 * elle survit à un rechargement de la page et n'est pas classée, comme un parcours dessiné.
 *
 * Module pur (sans DOM), testé.
 */

export type StageKind = 'tt' | 'road';
/** Tracé : étapes de ville en ville, ou grande boucle découpée. */
export type TourTrack = 'cities' | 'loop';
/** Contre-la-montre : aucun, un prologue, ou un prologue et un second chrono. */
export type TourTt = 'none' | 'prologue' | 'two';
/** Longueur des étapes en ligne (une boucle découpée a la sienne). */
export type TourLength = 'short' | 'medium' | 'long';

export interface TourOptions {
  track: TourTrack;
  stages: number;
  tt: TourTt;
  length: TourLength;
}

export interface TourStage {
  kind: StageKind;
  /** Parcours roulé : itinéraire de la zone, ou étape découpée (voir `stageRouteId`). */
  routeId: string;
  name: string;
  nameEn: string;
  /** Longueur courue, tours compris (m). */
  lengthM: number;
  gainM: number;
  /** Tours de boucle (1 pour un aller simple). */
  laps: number;
}

export const TOUR_STAGES_MIN = 2;
export const TOUR_STAGES_MAX = 7;
/** Boucle assez longue pour être découpée en étapes (m). */
const LOOP_MIN_M = 25_000;
/** Part d'un chrono dans la boucle découpée, une étape en ligne valant 1. */
const TT_WEIGHT = 0.35;
const TARGET_M: Record<TourLength, number> = { short: 12_000, medium: 22_000, long: 40_000 };
const TT_TARGET_M = 6000;
/** Grande boucle attitrée de l'île de Robert. */
const ISLAND_LOOP = 'tour-de-l-ile';
/** Parcours des mondes Poly où un peloton n'a pas sa place (voies vertes, planches, promenade, circuit d'échauffement). */
const ISLAND_NOT_RACED = new Set(['piste-verte', 'voie-verte-de-la-robe', 'velomaritime', 'anneau-piste-verte', 'port-de-robertville', 'anneau', 'promenade-de-port-azur', 'piste-de-la-plaine', 'voie-verte-du-gave', 'voie-verte-du-lac', 'velo-du-golfe']);

const round2 = (v: number): number => Math.round(v * 100) / 100;
export const clampStages = (n: number): number => Math.max(TOUR_STAGES_MIN, Math.min(TOUR_STAGES_MAX, Math.round(n) || TOUR_STAGES_MIN));

/** Genre de chaque étape. Second chrono à l'avant-dernière étape ; sur trois étapes, à la dernière. */
export function stagePlan(n: number, tt: TourTt = 'prologue'): StageKind[] {
  const k = clampStages(n);
  const second = tt !== 'two' || k < 3 ? -1 : k === 3 ? 2 : k - 2;
  return Array.from({ length: k }, (_, i) => ((i === 0 && tt !== 'none') || i === second ? 'tt' : 'road'));
}

// ————————————————————————————————————————————— Étape découpée dans une boucle

const STAGE_ID = /^itineraire-etape-(\d+)-(\d+)-(.+)$/;

export function stageRouteId(baseId: string, fromM: number, toM: number): string {
  return `itineraire-etape-${Math.round(fromM)}-${Math.round(toM)}-${baseId}`;
}

export function parseStageRouteId(id: string): { baseId: string; fromM: number; toM: number } | null {
  const m = STAGE_ID.exec(id);
  if (!m) return null;
  const fromM = Number(m[1]);
  const toM = Number(m[2]);
  return toM > fromM ? { baseId: m[3] as string, fromM, toM } : null;
}

/** Points de la boucle entre deux abscisses (le dernier point referme la boucle si l'étape va jusqu'au bout). */
function cutPoints(r: RouteData, fromM: number, toM: number): RoutePoint[] {
  const pts = r.points.filter((p) => p.d >= fromM - 0.01 && p.d <= toM + 0.01);
  const first = r.points[0];
  const last = pts.at(-1);
  if (r.loop && first && last && toM >= r.lengthM - 1 && r.lengthM - last.d > 0.05) pts.push({ ...first, d: r.lengthM });
  return pts;
}

/** Montée cumulée des points, ramenée au dénivelé annoncé du parcours entier (même lissage que lui). */
function gainOf(r: RouteData, pts: readonly RoutePoint[]): number {
  const up = (xs: readonly RoutePoint[]) => xs.reduce((a, p, i) => (i ? a + Math.max(0, p.y - (xs[i - 1] as RoutePoint).y) : 0), 0);
  const raw = up(r.points);
  return raw > 0 ? (up(pts) * r.elevationGainM) / raw : 0;
}

/** Village d'une abscisse, s'il y en a un tout près. */
function placeAt(r: RouteData, d: number): string | undefined {
  const gap = (x: number) => (r.loop ? Math.min(Math.abs(x - d), r.lengthM - Math.abs(x - d)) : Math.abs(x - d));
  const near = r.landmarks?.slice().sort((a, b) => gap(a.d) - gap(b.d))[0];
  return near && gap(near.d) <= 3000 ? near.name : undefined;
}

/** Nom d'une étape : villages de départ et d'arrivée, sinon un village ou une côte traversés, sinon ses kilomètres. */
function stageName(r: RouteData, fromM: number, toM: number): string {
  const at = (d: number) => `km ${Math.round(d / 1000)}`;
  const a = placeAt(r, fromM);
  const b = placeAt(r, toM);
  if (a && b && a !== b) return `${a} – ${b}`;
  const mid = r.landmarks?.find((l) => l.d > fromM && l.d < toM && l.name !== a && l.name !== b)?.name ?? r.segments.find((s) => s.kind === 'kom' && s.startM >= fromM && s.endM <= toM)?.name;
  if (a) return `${a} – ${mid ?? at(toM)}`;
  if (b) return `${mid ?? at(fromM)} – ${b}`;
  return mid ? `${at(fromM)} – ${mid} – ${at(toM)}` : `${at(fromM)} – ${at(toM)}`;
}

/** Étape de `fromM` à `toM` d'un parcours : un aller simple avec ses côtes, sprints, revêtements et villages. */
export function sliceRoute(r: RouteData, fromM: number, toM: number): RouteData | undefined {
  const cut = cutPoints(r, fromM, toM);
  const first = cut[0];
  const last = cut.at(-1);
  if (!first || !last || cut.length < 3) return undefined;
  const d0 = first.d;
  const L = round2(last.d - d0);
  const points = cut.map((p) => ({ ...p, d: round2(p.d - d0) }));
  const runs = <T extends { startM: number; endM: number }>(xs: T[]): T[] =>
    xs.map((x) => ({ ...x, startM: round2(Math.max(0, x.startM - d0)), endM: round2(Math.min(L, x.endM - d0)) })).filter((x) => x.endM > x.startM);
  const inside = <T extends { d: number }>(xs: T[]): T[] => xs.filter((x) => x.d >= d0 && x.d <= last.d).map((x) => ({ ...x, d: round2(x.d - d0) }));
  const segments: RouteSegment[] = r.segments.filter((s) => s.startM >= d0 - 0.01 && s.endM <= last.d + 0.01).map((s) => ({ ...s, startM: round2(s.startM - d0), endM: round2(s.endM - d0) }));
  const name = stageName(r, fromM, toM);
  const ys = points.map((p) => p.y);
  return {
    ...r,
    id: stageRouteId(r.id, fromM, toM),
    name,
    nameEn: name,
    loop: false,
    lengthM: L,
    elevationGainM: round2(gainOf(r, cut)),
    points,
    segments,
    ...(r.roadWidths ? { roadWidths: runs(r.roadWidths) } : {}),
    ...(r.surfaces ? { surfaces: runs(r.surfaces) } : {}),
    ...(r.landmarks ? { landmarks: inside(r.landmarks) } : {}),
    ...(r.hairpins ? { hairpins: inside(r.hairpins) } : {}),
    minElevationM: round2(ys.reduce((a, b) => Math.min(a, b), Infinity)),
    maxElevationM: round2(ys.reduce((a, b) => Math.max(a, b), -Infinity)),
  };
}

/** Bornes des étapes le long de la boucle : `n + 1` abscisses, de 0 à la longueur. */
export function loopCuts(r: RouteData, kinds: readonly StageKind[]): number[] {
  const w = kinds.map((k) => (k === 'tt' ? TT_WEIGHT : 1));
  const total = w.reduce((a, b) => a + b, 0);
  const cuts = [0];
  let acc = 0;
  for (let i = 0; i < kinds.length - 1; i++) {
    acc += w[i] as number;
    let d = (acc / total) * r.lengthM;
    // Arrivée dans le village tout proche plutôt qu'au milieu de nulle part.
    const reach = Math.min(5000, ((0.25 * Math.min(w[i] as number, w[i + 1] as number)) / total) * r.lengthM);
    const near = r.landmarks?.slice().sort((a, b) => Math.abs(a.d - d) - Math.abs(b.d - d))[0];
    if (near && Math.abs(near.d - d) <= reach) d = near.d;
    // Jamais au milieu d'une côte ou d'un sprint : l'arrivée est jugée juste après (ou le départ donné avant).
    const seg = r.segments.find((s) => (s.kind === 'kom' || s.kind === 'sprint') && d > s.startM - 60 && d < s.endM + 60);
    if (seg) d = d - seg.startM < seg.endM - d && seg.startM - 80 > (cuts.at(-1) as number) + 500 ? seg.startM - 80 : seg.endM + 80;
    cuts.push(Math.round(d));
  }
  cuts.push(Math.round(r.lengthM));
  return cuts;
}

function loopStages(r: RouteData, kinds: readonly StageKind[]): TourStage[] {
  const cuts = loopCuts(r, kinds);
  return kinds.map((kind, i) => {
    const from = cuts[i] as number;
    const to = cuts[i + 1] as number;
    const name = stageName(r, from, to);
    return { kind, routeId: stageRouteId(r.id, from, to), name, nameEn: name, lengthM: to - from, gainM: Math.round(gainOf(r, cutPoints(r, from, to))), laps: 1 };
  });
}

// ————————————————————————————————————————————— Parcours variés de la zone

/** Ce qu'il faut savoir d'un itinéraire pour en faire une étape (index de la zone). */
export interface TourRouteRef {
  id: string;
  name: string;
  nameEn?: string;
  lengthM: number;
  elevationGainM: number;
  loop: boolean;
  bike?: string;
}

const roadRefs = (refs: readonly TourRouteRef[]): TourRouteRef[] => refs.filter((r) => (r.bike ?? 'road') === 'road' && !r.id.startsWith('itineraire-') && !ISLAND_NOT_RACED.has(r.id));

/** Boucle de la zone à découper : celle de l'île, sinon la plus longue. */
export function loopRef(refs: readonly TourRouteRef[]): TourRouteRef | undefined {
  const loops = roadRefs(refs).filter((r) => r.loop && r.lengthM >= LOOP_MIN_M);
  return loops.find((r) => r.id === ISLAND_LOOP) ?? loops.sort((a, b) => b.lengthM - a.lengthM)[0];
}

function mixedStages(refs: readonly TourRouteRef[], kinds: readonly StageKind[], length: TourLength): TourStage[] {
  const pool = roadRefs(refs).filter((r) => r.lengthM >= 1500 && r.lengthM <= 60_000);
  const usable = pool.length ? pool : roadRefs(refs);
  if (!usable.length) return [];
  const stage = (kind: StageKind, r: TourRouteRef, targetM: number): TourStage => {
    const laps = r.loop ? Math.max(1, Math.min(10, Math.round(targetM / r.lengthM))) : 1;
    return { kind, routeId: r.id, name: r.name, nameEn: r.nameEn ?? r.name, lengthM: Math.round(r.lengthM * laps), gainM: Math.round(r.elevationGainM * laps), laps };
  };
  const steep = (r: TourRouteRef) => r.elevationGainM / r.lengthM;
  const off = (r: TourRouteRef, targetM: number) => Math.abs(stage('road', r, targetM).lengthM - targetM);
  const nTt = kinds.filter((k) => k === 'tt').length;
  const nRoad = kinds.length - nTt;
  // Chronos : les parcours courts et plutôt plats.
  const ttCost = (r: TourRouteRef) => off(r, TT_TARGET_M) + 2e5 * steep(r);
  const ttPool = usable.slice().sort((a, b) => ttCost(a) - ttCost(b));
  const tts = Array.from({ length: nTt }, (_, i) => stage('tt', ttPool[i % ttPool.length] as TourRouteRef, TT_TARGET_M));
  // En ligne : les plus proches de la longueur voulue, avec l'étape la plus dure de la zone ; jamais deux fois le même
  // parcours tant qu'il en reste.
  const target = TARGET_M[length];
  const used = new Set(tts.map((t) => t.routeId));
  const free = usable.filter((r) => !used.has(r.id));
  const roadPool = free.length ? free : usable;
  const queen = nRoad >= 2 ? roadPool.filter((r) => r.lengthM >= 5000).sort((a, b) => steep(b) - steep(a))[0] : undefined;
  const others = roadPool.filter((r) => r !== queen).sort((a, b) => off(a, target) - off(b, target));
  const from = others.length ? others : roadPool;
  const picked = Array.from({ length: nRoad - (queen ? 1 : 0) }, (_, i) => from[i % from.length] as TourRouteRef);
  // De plus en plus dur, l'étape reine à l'avant-dernière, la plus plate en dernier (arrivée au sprint).
  picked.sort((a, b) => steep(a) - steep(b));
  const flat = queen ? picked.shift() : undefined;
  const roads = [...picked, ...(queen ? [queen] : []), ...(flat ? [flat] : [])].map((r) => stage('road', r, target));
  return kinds.map((k) => (k === 'tt' ? tts.shift() : roads.shift()) as TourStage);
}

/**
 * Étapes du tour. `loop` : tracé complet de la boucle de la zone (`loopRef`), nécessaire au découpage ; `null` tant
 * qu'il n'est pas chargé. Sinon, parcours variés de la zone (repli quand les étapes de ville en ville sont impossibles).
 */
export function planStages(o: TourOptions, refs: readonly TourRouteRef[], loop: RouteData | undefined): TourStage[] | null {
  const kinds = stagePlan(o.stages, o.tt);
  if (o.track === 'loop' && loopRef(refs)) return loop ? loopStages(loop, kinds) : null;
  return mixedStages(refs, kinds, o.length);
}
