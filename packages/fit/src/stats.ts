/**
 * Statistiques d'un intervalle d'enregistrements (tour ou sortie complète), au format
 * attendu par les messages FIT lap / session.
 */
import type { ActivityRecord } from '@allezrobert/shared';

export interface RecordStats {
  startT: number;
  endT: number;
  /** Durée écoulée (s). */
  elapsedS: number;
  /** Durée chronométrée, pauses exclues (s). */
  timerS: number;
  distanceM: number;
  avgSpeedMs: number;
  maxSpeedMs: number;
  avgPower?: number;
  maxPower?: number;
  normalizedPower?: number;
  workJ: number;
  avgHr?: number;
  maxHr?: number;
  minHr?: number;
  /** Moyenne hors zéros (convention Garmin). */
  avgCadence?: number;
  maxCadence?: number;
  ascentM: number;
  descentM: number;
  /** Part gauche moyenne (%), pondérée par la puissance. */
  avgBalanceLeft?: number;
  avgTeLeft?: number;
  avgTeRight?: number;
  avgPsLeft?: number;
  avgPsRight?: number;
  avgTemperature?: number;
  maxTemperature?: number;
  minTemperature?: number;
  avgGrade?: number;
  startLat?: number;
  startLon?: number;
  endLat?: number;
  endLon?: number;
  /** Boîte englobante (nord-est / sud-ouest). */
  necLat?: number;
  necLon?: number;
  swcLat?: number;
  swcLon?: number;
}

class Mean {
  sum = 0;
  n = 0;
  max = -Infinity;
  min = Infinity;
  add(v: number | undefined, w = 1): void {
    if (v === undefined || !Number.isFinite(v)) return;
    this.sum += v * w;
    this.n += w;
    if (v > this.max) this.max = v;
    if (v < this.min) this.min = v;
  }
  get mean(): number | undefined {
    return this.n > 0 ? this.sum / this.n : undefined;
  }
}

/**
 * Statistiques sur records[from..to] (bornes incluses). `distanceM` des records est la
 * distance depuis le départ ; le point i couvre l'intervalle ]t(i−1), t(i)].
 * @param pauseGapS au-delà de cet écart entre deux points, l'intervalle est une pause.
 */
export function computeStats(records: readonly ActivityRecord[], from: number, to: number, pauseGapS = 10, startT?: number, endT?: number): RecordStats {
  const a = Math.max(0, from);
  const b = Math.min(records.length - 1, to);
  const first = records[a];
  const last = records[b];
  if (!first || !last || b < a) {
    const t = startT ?? 0;
    return { startT: t, endT: endT ?? t, elapsedS: 0, timerS: 0, distanceM: 0, avgSpeedMs: 0, maxSpeedMs: 0, workJ: 0, ascentM: 0, descentM: 0 };
  }
  const t0 = startT ?? (a > 0 ? records[a - 1]!.t : first.t - 1000);
  const t1 = endT ?? last.t;
  const power = new Mean();
  const hr = new Mean();
  const cad = new Mean();
  const te = [new Mean(), new Mean()] as const;
  const ps = [new Mean(), new Mean()] as const;
  const bal = new Mean();
  const temp = new Mean();
  const grade = new Mean();
  let maxSpeed = 0;
  let maxCad = -Infinity;
  let timerS = 0;
  let workJ = 0;
  let ascent = 0;
  let descent = 0;
  let nec: [number, number] | undefined;
  let swc: [number, number] | undefined;
  let startPos: [number, number] | undefined;
  let endPos: [number, number] | undefined;
  // Fenêtre glissante 30 s pour la NP (échantillons ~1 Hz).
  const win: number[] = [];
  let winSum = 0;
  let np4 = 0;
  let npN = 0;

  // Convention « vers l'arrière » : le point i couvre ]t(i−1), t(i)] ; le premier point
  // d'une sortie couvre 1 s. Ainsi les tours consécutifs se somment exactement.
  const base = a > 0 ? records[a - 1] : undefined;
  for (let i = a; i <= b; i++) {
    const r = records[i]!;
    const prev = i > 0 ? records[i - 1] : undefined;
    let dt = prev ? (r.t - prev.t) / 1000 : 1;
    if (dt > pauseGapS || dt <= 0) dt = 0; // pause
    timerS += dt;
    if (r.speedMs > maxSpeed) maxSpeed = r.speedMs;
    if (r.watts !== undefined) {
      power.add(r.watts);
      workJ += Math.max(0, r.watts) * dt;
      win.push(r.watts);
      winSum += r.watts;
      if (win.length > 30) winSum -= win.shift()!;
      const m = winSum / win.length;
      np4 += m * m * m * m;
      npN++;
      if (r.balanceLeft !== undefined) bal.add(r.balanceLeft, Math.max(r.watts, 1));
    } else if (r.balanceLeft !== undefined) bal.add(r.balanceLeft);
    hr.add(r.hr);
    if (r.cadence !== undefined) {
      if (r.cadence > 0) cad.add(r.cadence);
      if (r.cadence > maxCad) maxCad = r.cadence;
    }
    te[0].add(r.teLeft);
    te[1].add(r.teRight);
    ps[0].add(r.psLeft);
    ps[1].add(r.psRight);
    temp.add(r.temperatureC);
    grade.add(r.gradePercent);
    if (prev) {
      const dz = r.altitudeM - prev.altitudeM;
      if (dz > 0) ascent += dz;
      else descent -= dz;
    }
    if (r.lat !== undefined && r.lon !== undefined) {
      if (!startPos) startPos = [r.lat, r.lon];
      endPos = [r.lat, r.lon];
      nec = nec ? [Math.max(nec[0], r.lat), Math.max(nec[1], r.lon)] : [r.lat, r.lon];
      swc = swc ? [Math.min(swc[0], r.lat), Math.min(swc[1], r.lon)] : [r.lat, r.lon];
    }
  }

  const distanceM = Math.max(0, last.distanceM - (base ? base.distanceM : 0));
  const s: RecordStats = {
    startT: t0,
    endT: t1,
    elapsedS: Math.max(0, (t1 - t0) / 1000),
    timerS,
    distanceM,
    avgSpeedMs: timerS > 0 ? distanceM / timerS : 0,
    maxSpeedMs: maxSpeed,
    workJ,
    ascentM: ascent,
    descentM: descent,
  };
  const set = <K extends keyof RecordStats>(k: K, v: RecordStats[K] | undefined): void => {
    if (v !== undefined && (typeof v !== 'number' || Number.isFinite(v))) s[k] = v;
  };
  set('avgPower', power.mean);
  set('maxPower', power.n ? power.max : undefined);
  set('normalizedPower', npN ? Math.pow(np4 / npN, 0.25) : undefined);
  set('avgHr', hr.mean);
  set('maxHr', hr.n ? hr.max : undefined);
  set('minHr', hr.n ? hr.min : undefined);
  set('avgCadence', cad.mean);
  set('maxCadence', maxCad > -Infinity ? maxCad : undefined);
  set('avgBalanceLeft', bal.mean);
  set('avgTeLeft', te[0].mean);
  set('avgTeRight', te[1].mean);
  set('avgPsLeft', ps[0].mean);
  set('avgPsRight', ps[1].mean);
  set('avgTemperature', temp.mean);
  set('maxTemperature', temp.n ? temp.max : undefined);
  set('minTemperature', temp.n ? temp.min : undefined);
  set('avgGrade', grade.mean);
  if (startPos && endPos && nec && swc) {
    s.startLat = startPos[0];
    s.startLon = startPos[1];
    s.endLat = endPos[0];
    s.endLon = endPos[1];
    s.necLat = nec[0];
    s.necLon = nec[1];
    s.swcLat = swc[0];
    s.swcLon = swc[1];
  }
  return s;
}
