import { caloriesFromWork, intensityFactor, normalizedPower, powerCurve, trainingStressScore, workJoules, type PowerCurvePoint } from '@allezrobert/physics';
import type { ActivityRecord } from '@allezrobert/shared';

/** Seuils des zones de puissance de Coggan (fraction de FTP) : Z1 < 55 % … Z7 > 150 %. */
export const POWER_ZONES = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5] as const;

/** Durées de la courbe de puissance affichée (s). */
export const CURVE_DURATIONS = [1, 5, 10, 30, 60, 120, 300, 600, 1200, 1800, 3600] as const;

export interface GroupStats {
  /** Temps passé dans les roues (aspiration > 5 %), s. */
  draftS: number;
  /** Énergie économisée grâce à l'aspiration (J). */
  savedJ: number;
  /** Relais pris : passages en tête avec quelqu'un dans la roue pendant au moins 10 s. */
  pulls: number;
}

export interface RideStats {
  distanceM: number;
  movingS: number;
  elevationGainM: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  avgWatts: number;
  maxWatts: number;
  np: number;
  ifactor: number;
  tss: number;
  kcal: number;
  workKJ: number;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  curve: PowerCurvePoint[];
  /** Secondes passées dans chaque zone Z1 à Z7. */
  zonesS: number[];
}

/** Statistiques d'une sortie à partir des enregistrements à 1 Hz. */
export function rideStats(records: readonly ActivityRecord[], opts: { ftp: number; elevationGainM: number; elapsedS?: number }): RideStats {
  const watts = records.map((r) => r.watts ?? 0);
  const n = records.length;
  const distanceM = n ? (records[n - 1] as ActivityRecord).distanceM ?? 0 : 0;
  const movingS = opts.elapsedS ?? n;
  const hrs = records.map((r) => r.hr).filter((h): h is number => h !== undefined && h > 0);
  const cads = records.map((r) => r.cadence).filter((c): c is number => c !== undefined && c > 0);
  const np = normalizedPower(watts);
  const work = workJoules(watts);
  const zonesS = new Array(POWER_ZONES.length + 1).fill(0) as number[];
  for (const w of watts) {
    const r = w / Math.max(opts.ftp, 1);
    const z = POWER_ZONES.findIndex((t) => r < t);
    zonesS[z === -1 ? POWER_ZONES.length : z]! += 1;
  }
  return {
    distanceM,
    movingS,
    elevationGainM: opts.elevationGainM,
    avgSpeedKmh: movingS > 0 ? (distanceM / movingS) * 3.6 : 0,
    maxSpeedKmh: Math.max(0, ...records.map((r) => (r.speedMs ?? 0) * 3.6)),
    avgWatts: n ? work / n : 0,
    maxWatts: Math.max(0, ...watts),
    np,
    ifactor: intensityFactor(np, opts.ftp),
    tss: trainingStressScore(n, np, opts.ftp),
    kcal: caloriesFromWork(work),
    workKJ: work / 1000,
    avgHr: hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    avgCadence: cads.length ? cads.reduce((a, b) => a + b, 0) / cads.length : null,
    curve: powerCurve(watts, CURVE_DURATIONS.filter((d) => d <= n)),
    zonesS,
  };
}

/** Sortie résumée, gardée pour la comparaison « vs la dernière fois ». */
export interface RideHistoryEntry {
  routeId: string;
  date: number;
  distanceM: number;
  movingS: number;
  avgSpeedKmh: number;
  avgWatts: number;
  np: number;
}

const HISTORY_KEY = 'ar.history';
const RECORDS_KEY = 'ar.powerRecords';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // Stockage indisponible (navigation privée) : la comparaison sera simplement absente.
  }
}

/**
 * Dernière sortie comparable (même itinéraire, distance à ±30 %), puis enregistrement de celle-ci
 * dans l'historique (20 dernières). `date` identifie la sortie : la terminer à nouveau après
 * l'avoir reprise remplace l'entrée au lieu d'en ajouter une.
 */
export function compareAndStore(entry: RideHistoryEntry): RideHistoryEntry | null {
  const list = readJson<RideHistoryEntry[]>(HISTORY_KEY, []).filter((h) => h.date !== entry.date);
  const prev = [...list].reverse().find((h) => h.routeId === entry.routeId && h.distanceM >= entry.distanceM * 0.7 && h.distanceM <= entry.distanceM / 0.7) ?? null;
  list.push(entry);
  writeJson(HISTORY_KEY, list.slice(-20));
  return prev;
}

/**
 * Records de puissance par durée : renvoie les records d'avant la sortie et les durées battues.
 * `before` : records lus au départ de la sortie (une sortie reprise ne se bat pas elle-même).
 */
export function updatePowerRecords(curve: readonly PowerCurvePoint[], before?: Record<number, number>): { previous: Record<number, number>; beaten: number[] } {
  const stored = readJson<Record<number, number>>(RECORDS_KEY, {});
  const previous = before ?? stored;
  const next: Record<number, number> = { ...stored };
  const beaten: number[] = [];
  for (const p of curve) {
    if (p.watts <= 0) continue;
    const best = previous[p.durationS];
    if (best === undefined || p.watts > best) {
      next[p.durationS] = Math.max(next[p.durationS] ?? 0, Math.round(p.watts));
      if (best !== undefined) beaten.push(p.durationS);
    }
  }
  writeJson(RECORDS_KEY, next);
  return { previous, beaten };
}

/** Durée lisible pour l'axe de la courbe de puissance : 5 s, 1 min, 20 min, 1 h. */
export function durationLabel(s: number): string {
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

/** Records de puissance enregistrés (durée en s → W). */
export function readPowerRecords(): Record<number, number> {
  return readJson<Record<number, number>>(RECORDS_KEY, {});
}
