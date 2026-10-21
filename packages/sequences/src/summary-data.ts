/**
 * Données d'une sortie → variables de la composition « summary ».
 *
 * Accepte des champs déjà calculés (stats, trace, elevation) et/ou les enregistrements bruts
 * de la sortie (`records`, format ActivityRecord de @allezrobert/shared) pour compléter ce qui
 * manque. Module pur, utilisé par scripts/render-summary.ts côté serveur.
 */
import type { LeaderboardEntry, Season, SegmentHighlight, SummaryVariables } from './catalog.ts';
import type { Lang } from './strings.ts';

export interface RideRecordLike {
  /** Epoch ms. */
  t: number;
  distanceM?: number;
  altitudeM?: number;
  lat?: number;
  lon?: number;
  watts?: number;
}

export interface RideSummaryInput {
  lang?: Lang;
  title: string;
  /** ISO 8601 ou epoch ms ; formaté selon la langue (fuseau Europe/Paris). Ou texte libre. */
  date?: string | number;
  routeName: string;
  season?: Season;
  riderName?: string;
  accent?: string;
  trace?: [number, number][];
  traceProjection?: 'latlon' | 'xy';
  elevation?: number[];
  stats?: Partial<{
    distanceKm: number;
    durationS: number;
    avgPowerW: number;
    npW: number;
    elevationM: number;
    caloriesKcal: number;
  }>;
  records?: RideRecordLike[];
  leaderboard?: LeaderboardEntry[];
  segments?: SegmentHighlight[];
}

export function downsample<T>(arr: readonly T[], max: number): T[] {
  if (arr.length <= max) return [...arr];
  const out: T[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]!);
  return out;
}

function round(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/** Puissance normalisée : moyenne glissante 30 s, puissance 4, moyenne, racine 4e. */
export function normalizedPower(records: readonly RideRecordLike[]): number {
  const pts = records.filter((r) => typeof r.watts === 'number');
  if (pts.length < 2) return 0;
  // Rééchantillonnage à 1 Hz (dernier échantillon connu).
  const t0 = pts[0]!.t;
  const t1 = pts[pts.length - 1]!.t;
  const secs = Math.max(1, Math.floor((t1 - t0) / 1000));
  const w: number[] = new Array(secs);
  let j = 0;
  for (let s = 0; s < secs; s++) {
    const t = t0 + s * 1000;
    while (j + 1 < pts.length && pts[j + 1]!.t <= t) j++;
    w[s] = pts[j]!.watts ?? 0;
  }
  if (w.length < 30) return w.reduce((a, b) => a + b, 0) / w.length;
  let sum = 0;
  for (let i = 0; i < 30; i++) sum += w[i]!;
  let acc = 0;
  let n = 0;
  for (let i = 30; i <= w.length; i++) {
    const avg = sum / 30;
    acc += avg ** 4;
    n++;
    if (i < w.length) sum += w[i]! - w[i - 30]!;
  }
  return (acc / n) ** 0.25;
}

/** Dénivelé positif avec hystérésis (ignore le bruit d'altitude < seuil). */
export function elevationGain(alts: readonly number[], threshold = 1): number {
  if (!alts.length) return 0;
  let gain = 0;
  let ref = alts[0]!;
  for (const a of alts) {
    if (a - ref >= threshold) {
      gain += a - ref;
      ref = a;
    } else if (ref - a >= threshold) {
      ref = a;
    }
  }
  return gain;
}

function formatDate(date: string | number | undefined, lang: Lang): string {
  if (date === undefined || date === '') return '';
  const d = typeof date === 'number' ? new Date(date) : new Date(date);
  if (Number.isNaN(d.getTime())) return String(date);
  const s = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function seasonOf(date: string | number | undefined): Season {
  const d = date === undefined ? null : new Date(date);
  const m = d && !Number.isNaN(d.getTime()) ? d.getUTCMonth() + 1 : 10;
  if (m >= 3 && m <= 5) return 'printemps';
  if (m >= 6 && m <= 8) return 'ete';
  if (m >= 9 && m <= 11) return 'automne';
  return 'hiver';
}

/** Construit les variables de la composition « summary » (objets non sérialisés). */
export function summaryVariablesFromRide(input: RideSummaryInput): SummaryVariables {
  const lang: Lang = input.lang ?? 'fr';
  const recs = input.records ?? [];
  const s = input.stats ?? {};

  let trace = input.trace;
  let projection = input.traceProjection ?? 'latlon';
  if (!trace?.length) {
    const geo = recs.filter((r) => typeof r.lat === 'number' && typeof r.lon === 'number');
    trace = geo.map((r) => [round(r.lat!, 5), round(r.lon!, 5)] as [number, number]);
    projection = 'latlon';
  }
  trace = downsample(trace ?? [], 400);

  let elevation = input.elevation;
  const alts = recs.filter((r) => typeof r.altitudeM === 'number').map((r) => r.altitudeM!);
  if (!elevation?.length) elevation = alts.map((a) => round(a, 1));
  elevation = downsample(elevation ?? [], 240);

  const first = recs[0];
  const last = recs[recs.length - 1];
  const durationS = s.durationS ?? (first && last ? (last.t - first.t) / 1000 : 0);
  const distanceKm = s.distanceKm ?? (last?.distanceM !== undefined ? last.distanceM / 1000 : 0);
  const watts = recs.filter((r) => typeof r.watts === 'number').map((r) => r.watts!);
  const avgPowerW = s.avgPowerW ?? (watts.length ? watts.reduce((a, b) => a + b, 0) / watts.length : 0);
  const npW = s.npW ?? normalizedPower(recs);
  const elevationM = s.elevationM ?? elevationGain(alts);
  // Travail mécanique (kJ) ≈ dépense (kcal) avec un rendement humain d'environ 24 %.
  const caloriesKcal = s.caloriesKcal ?? (avgPowerW * durationS) / 1000;

  return {
    lang,
    ride_title: input.title,
    date_label: formatDate(input.date, lang),
    route_name: input.routeName,
    season: input.season ?? seasonOf(input.date),
    rider_name: input.riderName ?? '',
    trace,
    trace_projection: projection,
    elevation,
    distance_km: round(distanceKm, 1),
    duration_s: Math.round(durationS),
    avg_power_w: Math.round(avgPowerW),
    np_w: Math.round(npW),
    elevation_m: Math.round(elevationM),
    calories_kcal: Math.round(caloriesKcal),
    leaderboard: (input.leaderboard ?? []).slice(0, 8),
    segments: (input.segments ?? []).slice(0, 3),
    ...(input.accent ? { accent: input.accent } : {}),
  };
}
