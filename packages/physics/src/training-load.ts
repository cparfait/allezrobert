/**
 * Bilan d'entraînement d'une sortie et charge dans le temps, partagés par le jeu, l'appli de
 * bureau (base locale) et le serveur : les mêmes formules donnent les mêmes chiffres partout.
 *
 * Charge (forme / fatigue / fraîcheur) : moyennes exponentielles du TSS quotidien sur 42 et 7 jours,
 * comme dans Cyclotron (wizzlerr/cyclotron, `core/metrics/load.ts`) et TrainingPeaks.
 */
import { caloriesFromWork, intensityFactor, normalizedPower, powerCurve, trainingStressScore, workJoules, POWER_CURVE_DURATIONS, type PowerCurvePoint } from './training.ts';

/** Seuils des zones de puissance de Coggan (fraction de FTP) : Z1 < 55 % … Z7 > 150 %. */
export const POWER_ZONE_LIMITS = [0.55, 0.75, 0.9, 1.05, 1.2, 1.5] as const;

/** Zone de puissance (0 = Z1 … 6 = Z7) d'une puissance pour une FTP. */
export function powerZoneIndex(watts: number, ftpWatts: number): number {
  const r = watts / Math.max(ftpWatts, 1);
  const z = POWER_ZONE_LIMITS.findIndex((t) => r < t);
  return z === -1 ? POWER_ZONE_LIMITS.length : z;
}

/** Échantillon à 1 Hz (sous-ensemble d'`ActivityRecord`). */
export interface TrainingSample {
  watts?: number;
  hr?: number;
  cadence?: number;
}

export interface TrainingSummary {
  /** FTP utilisée pour IF, TSS et zones. */
  ftpWatts: number;
  avgWatts: number;
  maxWatts: number;
  np: number;
  intensity: number;
  tss: number;
  workKJ: number;
  kcal: number;
  avgCadence: number | null;
  avgHr: number | null;
  maxHr: number | null;
  /** Meilleures moyennes aux durées standard (`POWER_CURVE_DURATIONS`). */
  curve: PowerCurvePoint[];
  /** Secondes dans chaque zone Z1 à Z7. */
  zonesS: number[];
}

/** Bilan d'une sortie à partir de ses échantillons à 1 Hz (une seconde par échantillon). */
export function trainingSummary(samples: readonly TrainingSample[], ftpWatts: number): TrainingSummary {
  const watts = samples.map((s) => Math.max(0, s.watts ?? 0));
  const n = watts.length;
  const np = normalizedPower(watts);
  const work = workJoules(watts);
  const zonesS = new Array<number>(POWER_ZONE_LIMITS.length + 1).fill(0);
  for (const w of watts) zonesS[powerZoneIndex(w, ftpWatts)]! += 1;
  let hrSum = 0;
  let hrN = 0;
  let hrMax = 0;
  let cadSum = 0;
  let cadN = 0;
  let maxW = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i]!;
    if (s.hr !== undefined && s.hr > 0) {
      hrSum += s.hr;
      hrN++;
      if (s.hr > hrMax) hrMax = s.hr;
    }
    if (s.cadence !== undefined && s.cadence > 0) {
      cadSum += s.cadence;
      cadN++;
    }
    if (watts[i]! > maxW) maxW = watts[i]!;
  }
  return {
    ftpWatts,
    avgWatts: n ? work / n : 0,
    maxWatts: maxW,
    np,
    intensity: intensityFactor(np, ftpWatts),
    tss: trainingStressScore(n, np, ftpWatts),
    workKJ: work / 1000,
    kcal: caloriesFromWork(work),
    avgCadence: cadN ? cadSum / cadN : null,
    avgHr: hrN ? hrSum / hrN : null,
    maxHr: hrN ? hrMax : null,
    curve: powerCurve(watts, POWER_CURVE_DURATIONS.filter((d) => d <= n)),
    zonesS,
  };
}

/** Date locale AAAA-MM-JJ d'un instant (ms) pour un décalage UTC en minutes (heure d'été comprise). */
export function localDate(ms: number, utcOffsetMin: number): string {
  return new Date(ms + utcOffsetMin * 60_000).toISOString().slice(0, 10);
}

/** Ajoute `days` jours à une date AAAA-MM-JJ. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lundi (AAAA-MM-JJ) de la semaine d'une date. */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

export interface DailyLoad {
  date: string;
  /** TSS du jour. */
  tss: number;
  /** Forme (CTL, 42 j). */
  ctl: number;
  /** Fatigue (ATL, 7 j). */
  atl: number;
  /** Fraîcheur du jour (TSB) : forme − fatigue de la veille. */
  tsb: number;
}

export const CTL_DAYS = 42;
export const ATL_DAYS = 7;

/**
 * Charge jour par jour de `from` à `to` (inclus). Le calcul démarre au premier jour de TSS connu
 * (ou à `from`), pour que la forme d'aujourd'hui tienne compte de tout l'historique.
 */
export function dailyLoad(tssByDate: ReadonlyMap<string, number>, from: string, to: string): DailyLoad[] {
  let start = from;
  for (const d of tssByDate.keys()) if (d < start) start = d;
  const out: DailyLoad[] = [];
  let ctl = 0;
  let atl = 0;
  for (let d = start; d <= to; d = addDays(d, 1)) {
    const tss = tssByDate.get(d) ?? 0;
    const tsb = ctl - atl;
    ctl += (tss - ctl) / CTL_DAYS;
    atl += (tss - atl) / ATL_DAYS;
    if (d >= from) out.push({ date: d, tss, ctl, atl, tsb });
  }
  return out;
}

/** Somme du TSS par jour local. */
export function tssByDay(rides: Iterable<{ startedAt: number; utcOffsetMin: number; tss: number | null }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rides) {
    if (!r.tss) continue;
    const d = localDate(r.startedAt, r.utcOffsetMin);
    m.set(d, (m.get(d) ?? 0) + r.tss);
  }
  return m;
}

/** Meilleure puissance par durée sur plusieurs courbes (records de tous les temps). */
export function bestCurve(curves: Iterable<readonly PowerCurvePoint[]>): PowerCurvePoint[] {
  const best = new Map<number, number>();
  for (const c of curves) for (const p of c) if (p.watts > (best.get(p.durationS) ?? 0)) best.set(p.durationS, p.watts);
  return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([durationS, watts]) => ({ durationS, watts }));
}

/**
 * Type d'entraînement estimé d'une sortie sans séance, d'après le temps passé dans les zones
 * (Z1…Z7) et l'IF : la famille la plus dure qui a assez de temps à son intensité (seuils proches
 * de ceux de Cyclotron, `core/workout/meta.ts`). Null sans données de puissance.
 */
export function classifyRideType(zonesS: readonly number[], intensity: number | null): 'recovery' | 'endurance' | 'tempo' | 'sweetspot' | 'threshold' | 'vo2max' | 'anaerobic' | null {
  if (zonesS.length < 7 || zonesS.every((s) => s <= 0)) return null;
  const above = (z: number) => zonesS.slice(z).reduce((a, b) => a + b, 0);
  if (above(5) >= 120) return 'anaerobic';
  if (above(4) >= 360) return 'vo2max';
  if (above(3) >= 1200) return 'threshold';
  if (above(3) >= 600 || (intensity ?? 0) >= 0.85) return 'sweetspot';
  if (above(2) >= 1200 || (intensity ?? 0) >= 0.76) return 'tempo';
  if (above(1) >= 1200) return 'endurance';
  return 'recovery';
}
