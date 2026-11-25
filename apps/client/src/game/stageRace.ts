import { climbCategory } from '@allezrobert/shared';
import type { StageKind, TourStage } from './tourPlan.ts';

/**
 * Tour à étapes local (idée NCT Ride) : plusieurs étapes jouées un jour puis un autre (sauvegardé tant que le tour
 * n'est pas fini), contre-la-montre et courses en ligne, avec les classements d'un vrai tour :
 *  - général au temps (bonifications 10/6/4 s à l'arrivée des étapes en ligne) — maillot jaune ;
 *  - points (arrivées et sprints intermédiaires) — maillot vert ;
 *  - montagne (sommets, barème selon la catégorie de la côte) — maillot à pois ;
 *  - équipes (somme des trois meilleurs temps de chaque équipe à chaque étape).
 * Les étapes viennent de game/tourPlan.ts (grande boucle découpée ou parcours de la zone) ; un tour par zone.
 * Les IA gardent leur fatigue d'une étape à l'autre : celle qui s'est vidée part moins fraîche le lendemain.
 *
 * Module pur (sans DOM ni jeu), testé ; le jeu fournit les relevés de course (Peloton.raceLog) et l'affiche
 * (ui/tourPanel.ts).
 */

export type { StageKind, TourStage } from './tourPlan.ts';

export interface TourRider {
  id: string;
  name: string;
  team: string;
  me?: boolean;
}

export interface StageResult {
  kind: StageKind;
  /** Itinéraire roulé (affichage). */
  route: string;
  /** Temps de chacun (s). */
  times: Record<string, number>;
  /** Ordre d'arrivée (identifiants). */
  order: string[];
  /** Passages notés : sommets (avec catégorie) et sprints. */
  marks: Array<{ kind: 'kom' | 'sprint'; name: string; cat?: number; order: string[] }>;
}

export interface Tour {
  version: 2;
  name: string;
  /** Zone où il se court. */
  worldId: string;
  stages: TourStage[];
  /** Coureurs IA engagés et leur niveau (part de la FTP du joueur), les mêmes à chaque étape. */
  aiCount: number;
  aiLevel: number;
  /** Le joueur seul jusqu'au premier départ (`enrol`). */
  riders: TourRider[];
  results: StageResult[];
  /** Fatigue accumulée des IA (0–0,12) : leur FTP du jour est multipliée par 1 − fatigue. */
  fatigue: Record<string, number>;
  startedAt: string;
}

/** Équipes fictives (le joueur et un équipier sur quatre courent pour « Allez Robert »). */
export const TOUR_TEAMS = ['Allez Robert', 'Bocage Vélo', 'Falaises Cyclisme', 'Plaine Sport'] as const;

export function newTour(o: { name: string; worldId: string; stages: TourStage[]; aiCount: number; aiLevel: number }, myName: string): Tour {
  return {
    version: 2,
    name: o.name,
    worldId: o.worldId,
    stages: o.stages,
    aiCount: o.aiCount,
    aiLevel: o.aiLevel,
    riders: [{ id: 'me', name: myName, team: TOUR_TEAMS[0], me: true }],
    results: [],
    fatigue: {},
    startedAt: new Date().toISOString(),
  };
}

/** Engage les coureurs IA au premier départ (les mêmes jusqu'au bout). */
export function enrol(t: Tour, ais: ReadonlyArray<{ id: string; name: string }>): Tour {
  if (t.riders.length > 1) return t;
  return { ...t, riders: [...t.riders, ...ais.map((a, i) => ({ id: a.id, name: a.name, team: TOUR_TEAMS[i % TOUR_TEAMS.length] as string }))] };
}

export const currentStage = (t: Tour): number => t.results.length;
export const tourDone = (t: Tour): boolean => t.results.length >= t.stages.length;
/** Étape à courir ; aucune si le tour est fini. */
export const nextStage = (t: Tour): TourStage | undefined => t.stages[currentStage(t)];

const FINISH_POINTS = [25, 20, 16, 14, 12, 10, 8, 6, 4, 2];
const TT_POINTS = [10, 8, 6, 4, 2];
const SPRINT_POINTS = [10, 6, 4, 2, 1];
const KOM_POINTS: Record<number, number[]> = { 0: [20, 15, 12, 10, 8, 6, 4, 2], 1: [10, 8, 6, 4, 2, 1], 2: [5, 3, 2, 1], 3: [2, 1], 4: [1] };
const BONUS = [10, 6, 4];

/** Points d'un passage noté pour la place `pos` (0 = premier) : sprint (maillot vert) ou sommet de catégorie `cat`. */
export function markPoints(kind: 'kom' | 'sprint', cat: number | undefined, pos: number): number {
  const scale = kind === 'sprint' ? SPRINT_POINTS : (KOM_POINTS[cat ?? 4] ?? []);
  return pos >= 0 ? (scale[pos] ?? 0) : 0;
}

/** Points d'arrivée pour la place `pos` (0 = premier). */
export function finishPoints(kind: StageKind, pos: number): number {
  return pos >= 0 ? ((kind === 'tt' ? TT_POINTS : FINISH_POINTS)[pos] ?? 0) : 0;
}

/** Catégorie d'un sommet relevé (4 = la plus facile, 0 = hors catégorie). */
export function markCategory(avgGrade: number, lengthM: number): number {
  return climbCategory({ startM: 0, endM: lengthM, avgGrade });
}

export interface Standing {
  id: string;
  name: string;
  team: string;
  /** Temps (s), points ou temps d'équipe selon le classement. */
  value: number;
  me?: boolean;
}

export interface Standings {
  gc: Standing[];
  points: Standing[];
  kom: Standing[];
  teams: Array<{ team: string; value: number; mine: boolean }>;
}

/** Classements après les étapes jouées. */
export function standings(t: Tour): Standings {
  const time = new Map<string, number>();
  const pts = new Map<string, number>();
  const kom = new Map<string, number>();
  const team = new Map<string, number>();
  const add = (m: Map<string, number>, id: string, v: number) => m.set(id, (m.get(id) ?? 0) + v);
  for (const st of t.results) {
    for (const r of t.riders) add(time, r.id, st.times[r.id] ?? Math.max(...Object.values(st.times)) + 60);
    if (st.kind === 'road') st.order.slice(0, 3).forEach((id, i) => add(time, id, -(BONUS[i] as number)));
    st.order.forEach((id, i) => add(pts, id, (st.kind === 'tt' ? TT_POINTS : FINISH_POINTS)[i] ?? 0));
    for (const m of st.marks) {
      const scale = m.kind === 'sprint' ? SPRINT_POINTS : (KOM_POINTS[m.cat ?? 4] ?? []);
      m.order.forEach((id, i) => add(m.kind === 'sprint' ? pts : kom, id, scale[i] ?? 0));
    }
    // Équipes : les trois meilleurs temps de chaque équipe à cette étape.
    for (const name of TOUR_TEAMS) {
      const best = t.riders
        .filter((r) => r.team === name)
        .map((r) => st.times[r.id])
        .filter((x): x is number => x !== undefined)
        .sort((a, b) => a - b)
        .slice(0, 3);
      if (best.length) add(team, name, best.reduce((a, b) => a + b, 0) + (3 - best.length) * 600);
    }
  }
  const list = (m: Map<string, number>, asc: boolean) =>
    t.riders
      .map((r) => ({ id: r.id, name: r.name, team: r.team, value: m.get(r.id) ?? 0, ...(r.me ? { me: true } : {}) }))
      .sort((a, b) => (asc ? a.value - b.value : b.value - a.value));
  return {
    gc: list(time, true),
    points: list(pts, false),
    kom: list(kom, false),
    teams: [...team.entries()].map(([name, value]) => ({ team: name, value, mine: name === TOUR_TEAMS[0] })).sort((a, b) => a.value - b.value),
  };
}

/**
 * Résultat d'une étape à partir du relevé de course : arrivés à leur temps, les autres à leur temps estimé (distance
 * restante à leur vitesse), le joueur à son temps.
 */
export function stageResult(
  kind: StageKind,
  route: string,
  log: {
    segs: ReadonlyArray<{ kind: 'kom' | 'sprint'; name: string; avgGrade: number; lengthM: number; order: readonly string[] }>;
    finish: ReadonlyArray<{ id: string; t: number }>;
    pending: ReadonlyArray<{ id: string; remainingM: number; speedMs: number; t: number }>;
  },
  myTimeS: number,
): StageResult {
  const times: Record<string, number> = { me: myTimeS };
  for (const f of log.finish) if (f.id !== 'me') times[f.id] = f.t;
  for (const p of log.pending) if (times[p.id] === undefined) times[p.id] = p.t + p.remainingM / p.speedMs;
  const order = Object.keys(times).sort((a, b) => (times[a] as number) - (times[b] as number));
  return {
    kind,
    route,
    times,
    order,
    // Contre-la-montre : pas de sprint intermédiaire.
    marks: log.segs.filter((s) => kind === 'road' || s.kind === 'kom').map((s) => ({ kind: s.kind, name: s.name, ...(s.kind === 'kom' ? { cat: markCategory(s.avgGrade, s.lengthM) } : {}), order: [...s.order] })),
  };
}

/** Ajoute une étape et la fatigue des IA (réserve W′ restante à l'arrivée : vidée = plus fatiguée le lendemain). */
export function addStage(t: Tour, result: StageResult, fatigue: ReadonlyArray<{ id: string; wPrime: number }>): Tour {
  const f = { ...t.fatigue };
  for (const a of fatigue) f[a.id] = Math.min(0.12, Math.max(0, (f[a.id] ?? 0) - 0.01 + 0.02 + 0.04 * (1 - a.wPrime)));
  return { ...t, results: [...t.results, result], fatigue: f };
}

const KEY = 'ar.tour.v2.';

/** Tour de la zone, en cours ou terminé. */
export function loadTour(worldId: string, store: Pick<Storage, 'getItem'> = localStorage): Tour | null {
  try {
    const t = JSON.parse(store.getItem(KEY + worldId) ?? 'null') as Tour | null;
    return t && t.version === 2 && Array.isArray(t.stages) && t.stages.length > 0 && Array.isArray(t.results) ? t : null;
  } catch {
    return null;
  }
}

export function saveTour(t: Tour, store: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    store.setItem(KEY + t.worldId, JSON.stringify(t));
  } catch {
    // Stockage indisponible : le tour ne sera pas gardé.
  }
}

export function dropTour(worldId: string, store: Pick<Storage, 'removeItem'> = localStorage): void {
  try {
    store.removeItem(KEY + worldId);
  } catch {
    // Stockage indisponible : rien à effacer.
  }
}

/** « 1 h 02:13 », « 4:05 », « +0:12 » (écart), pour les classements. */
export function fmtTime(s: number, gap = false): string {
  const v = Math.round(Math.abs(s));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = String(v % 60).padStart(2, '0');
  const body = h ? `${h} h ${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  return gap ? `+${body}` : body;
}

/** Maillots distinctifs du tour : jaune (général), vert (points), à pois (montagne). */
export type LeaderJersey = 'gc' | 'points' | 'kom';

/**
 * Qui porte quel maillot à l'étape suivante (identifiant du coureur → maillot). Comme sur le Tour : un coureur qui
 * mène plusieurs classements porte le plus important (jaune, puis vert, puis à pois) ; l'autre maillot passe au
 * suivant de ce classement. Avant la première étape, personne. Montagne sans point marqué : pas de maillot à pois.
 */
export function tourLeaders(t: Tour): Record<string, LeaderJersey> {
  if (!t.results.length) return {};
  const st = standings(t);
  const out: Record<string, LeaderJersey> = {};
  const lists: Array<[LeaderJersey, Standing[]]> = [
    ['gc', st.gc],
    ['points', st.points.filter((r) => r.value > 0)],
    ['kom', st.kom.filter((r) => r.value > 0)],
  ];
  for (const [jersey, list] of lists) {
    const who = list.find((r) => !(r.id in out));
    if (who) out[who.id] = jersey;
  }
  return out;
}
