/**
 * Analyses de l'historique local (mêmes formules que le serveur, @allezrobert/physics) : charge
 * jour par jour, temps par zone par semaine, records de puissance, totaux.
 */
import { addDays, bestCurve, dailyLoad, localDate, tssByDay, weekStart, type DailyLoad } from '@allezrobert/physics';
import type { HistoryRide } from '@allezrobert/shared';

export interface HistoryTotals {
  rides: number;
  distanceM: number;
  movingS: number;
  elevationM: number;
  tss: number;
  /** Plus longue sortie et plus gros dénivelé d'une seule sortie (trophées « d'un coup »). */
  bestDistanceM: number;
  bestElevationM: number;
}

export function totals(rides: readonly HistoryRide[]): HistoryTotals {
  const t: HistoryTotals = { rides: 0, distanceM: 0, movingS: 0, elevationM: 0, tss: 0, bestDistanceM: 0, bestElevationM: 0 };
  for (const r of rides) {
    t.rides++;
    t.distanceM += r.distanceM;
    t.movingS += r.movingS;
    t.elevationM += r.elevationM;
    t.tss += r.tss ?? 0;
    t.bestDistanceM = Math.max(t.bestDistanceM, r.distanceM);
    t.bestElevationM = Math.max(t.bestElevationM, r.elevationM);
  }
  return t;
}

/** Charge des `days` derniers jours jusqu'à aujourd'hui (fuseau de l'appareil). */
export function loadSeries(rides: readonly HistoryRide[], days: number, now = Date.now()): DailyLoad[] {
  const today = localDate(now, -new Date(now).getTimezoneOffset());
  return dailyLoad(tssByDay(rides), addDays(today, -(days - 1)), today);
}

/** Secondes par zone (Z1 à Z7), semaine par semaine, des `weeks` dernières semaines. */
export function weeklyZones(rides: readonly HistoryRide[], weeks: number, now = Date.now()): Array<{ week: string; zonesS: number[] }> {
  const today = localDate(now, -new Date(now).getTimezoneOffset());
  const first = addDays(weekStart(today), -7 * (weeks - 1));
  const out = new Map<string, number[]>();
  for (let w = first; w <= today; w = addDays(w, 7)) out.set(w, new Array<number>(7).fill(0));
  for (const r of rides) {
    const w = weekStart(localDate(r.startedAt, r.utcOffsetMin));
    const z = out.get(w);
    if (!z) continue;
    r.zonesS.forEach((s, i) => (z[i] = (z[i] ?? 0) + s));
  }
  return [...out.entries()].map(([week, zonesS]) => ({ week, zonesS }));
}

/** TSS et durée par semaine (graphique de volume). */
export function weeklyVolume(rides: readonly HistoryRide[], weeks: number, now = Date.now()): Array<{ week: string; tss: number; movingS: number; rides: number }> {
  const today = localDate(now, -new Date(now).getTimezoneOffset());
  const first = addDays(weekStart(today), -7 * (weeks - 1));
  const out = new Map<string, { tss: number; movingS: number; rides: number }>();
  for (let w = first; w <= today; w = addDays(w, 7)) out.set(w, { tss: 0, movingS: 0, rides: 0 });
  for (const r of rides) {
    const v = out.get(weekStart(localDate(r.startedAt, r.utcOffsetMin)));
    if (!v) continue;
    v.tss += r.tss ?? 0;
    v.movingS += r.movingS;
    v.rides++;
  }
  return [...out.entries()].map(([week, v]) => ({ week, ...v }));
}

/** Meilleures moyennes des sorties données (période) : [durée, watts]. */
export function periodCurve(rides: readonly HistoryRide[]): Array<[number, number]> {
  return bestCurve(rides.map((r) => r.curve.map(([durationS, watts]) => ({ durationS, watts })))).map((p) => [p.durationS, p.watts]);
}
