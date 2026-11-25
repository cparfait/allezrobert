import { finishPoints, markPoints, type StageResult } from './stageRace.ts';

/**
 * Bilan d'une course locale (étape du tour, contre-la-montre) pour l'écran de fin de sortie : classement complet avec les
 * écarts au vainqueur, mes passages notés (place, points, puissance), mes moments clés (attaque la plus forte, sprint,
 * dernier kilomètre) et mes tours. Calcul pur (testé) à partir du résultat de l'étape et des relevés seconde par seconde.
 */

export interface RaceSample {
  /** Epoch ms. */
  t: number;
  /** Distance depuis le départ de la course (m). */
  distanceM: number;
  watts?: number;
}

export interface RaceReportInput {
  result: StageResult;
  /** Nom et équipe de chaque coureur (identifiants du résultat ; 'me' = joueur). */
  riders: Record<string, { name: string; team?: string }>;
  /** Relevés du joueur, dans l'ordre. */
  samples: readonly RaceSample[];
  /** Longueur d'un passage notés (m) par nom, pour mesurer la puissance sur la côte ou le sprint. */
  marks: ReadonlyArray<{ kind: 'kom' | 'sprint'; name: string; atM: number; lengthM: number; cat?: number }>;
  raceLengthM: number;
  /** Longueur du tour (circuit en boucle), ou null. */
  lapM: number | null;
  massKg: number;
}

export interface RaceReport {
  kind: StageResult['kind'];
  rows: Array<{ rank: number; id: string; name: string; team: string; timeS: number; gapS: number; me: boolean }>;
  myRank: number;
  field: number;
  /** Points gagnés : arrivée et sprints (maillot vert), sommets (à pois). */
  points: { finish: number; sprint: number; kom: number };
  marks: Array<{ kind: 'kom' | 'sprint'; name: string; cat?: number; place: number | null; of: number; points: number; watts: number | null; durationS: number | null }>;
  efforts: Array<{ key: 'race' | 'attack' | 'sprint' | 'lastKm'; watts: number; wkg: number; durationS: number }>;
  laps: Array<{ lap: number; timeS: number; watts: number | null }>;
}

/** Puissance moyenne et durée entre deux distances (relevés du joueur), ou null sans relevé de puissance. */
function between(samples: readonly RaceSample[], fromM: number, toM: number): { watts: number | null; durationS: number } | null {
  let first: RaceSample | null = null;
  let last: RaceSample | null = null;
  let sum = 0;
  let n = 0;
  for (const s of samples) {
    if (s.distanceM < fromM || s.distanceM > toM) continue;
    first ??= s;
    last = s;
    if (s.watts !== undefined) {
      sum += s.watts;
      n++;
    }
  }
  if (!first || !last) return null;
  return { watts: n ? sum / n : null, durationS: (last.t - first.t) / 1000 };
}

/** Meilleure puissance moyenne sur `durS` secondes (fenêtre glissante, relevés à la seconde). */
function bestAvg(samples: readonly RaceSample[], durS: number): number {
  const w = samples.map((s) => s.watts ?? 0);
  if (w.length < durS) return 0;
  let sum = 0;
  for (let i = 0; i < durS; i++) sum += w[i] as number;
  let best = sum;
  for (let i = durS; i < w.length; i++) {
    sum += (w[i] as number) - (w[i - durS] as number);
    if (sum > best) best = sum;
  }
  return best / durS;
}

export function raceReport(i: RaceReportInput): RaceReport {
  const r = i.result;
  const t0 = r.times[r.order[0] ?? ''] ?? 0;
  const rows = r.order.map((id, k) => ({
    rank: k + 1,
    id,
    name: i.riders[id]?.name ?? id,
    team: i.riders[id]?.team ?? '',
    timeS: r.times[id] ?? 0,
    gapS: (r.times[id] ?? 0) - t0,
    me: id === 'me',
  }));
  const myPos = r.order.indexOf('me');
  const marks = r.marks.map((m, k) => {
    const place = m.order.indexOf('me');
    const geo = i.marks[k];
    const effort = geo ? between(i.samples, geo.atM - geo.lengthM, geo.atM) : null;
    return {
      kind: m.kind,
      name: m.name,
      ...(m.cat !== undefined ? { cat: m.cat } : {}),
      place: place >= 0 ? place + 1 : null,
      of: m.order.length,
      points: markPoints(m.kind, m.cat, place),
      watts: effort?.watts ?? null,
      durationS: effort?.durationS ?? null,
    };
  });
  const points = {
    finish: finishPoints(r.kind, myPos),
    sprint: marks.filter((m) => m.kind === 'sprint').reduce((a, m) => a + m.points, 0),
    kom: marks.filter((m) => m.kind === 'kom').reduce((a, m) => a + m.points, 0),
  };
  const race = i.samples.filter((s) => s.distanceM <= i.raceLengthM);
  const wkg = (w: number) => (i.massKg > 0 ? w / i.massKg : 0);
  const efforts: RaceReport['efforts'] = [];
  const whole = between(race, 0, i.raceLengthM);
  if (whole?.watts) efforts.push({ key: 'race', watts: whole.watts, wkg: wkg(whole.watts), durationS: whole.durationS });
  const attack = bestAvg(race, 60);
  if (attack > 0) efforts.push({ key: 'attack', watts: attack, wkg: wkg(attack), durationS: 60 });
  const sprint = bestAvg(race.filter((s) => s.distanceM >= i.raceLengthM - 500), 10);
  if (sprint > 0) efforts.push({ key: 'sprint', watts: sprint, wkg: wkg(sprint), durationS: 10 });
  const last = between(race, i.raceLengthM - 1000, i.raceLengthM);
  if (last?.watts && i.raceLengthM > 1500) efforts.push({ key: 'lastKm', watts: last.watts, wkg: wkg(last.watts), durationS: last.durationS });
  const laps: RaceReport['laps'] = [];
  if (i.lapM && i.lapM > 0 && i.raceLengthM >= i.lapM * 1.5) {
    const n = Math.ceil(i.raceLengthM / i.lapM - 1e-6);
    for (let k = 0; k < n; k++) {
      const seg = between(race, k * i.lapM, Math.min((k + 1) * i.lapM, i.raceLengthM));
      if (seg) laps.push({ lap: k + 1, timeS: seg.durationS, watts: seg.watts });
    }
  }
  return { kind: r.kind, rows, myRank: myPos + 1, field: rows.length, points, marks, efforts, laps };
}
