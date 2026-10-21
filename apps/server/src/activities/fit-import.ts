/**
 * Lecture d'un fichier FIT téléversé par le jeu (SDK officiel Garmin) : reconstruction d'une
 * `Activity`, calcul du résumé (distance, dénivelé, durée, puissance, FC) et, si le coureur
 * n'a pas consenti au stockage de sa FC, ré-encodage sans fréquence cardiaque
 * (packages/fit, même encodeur que le jeu).
 */
import { Decoder, Stream } from '@garmin/fitsdk';
import type { Activity, ActivityLap, ActivityRecord } from '@allezrobert/shared';
import { computeStats, decodeBalanceLeft, encodeActivity } from '@allezrobert/fit';

type Msg = Record<string, unknown>;

export interface FitSummary {
  startedAt: number;
  durationS: number;
  movingS: number;
  distanceM: number;
  elevationM: number;
  avgWatts?: number;
  maxWatts?: number;
  avgHr?: number;
  maxHr?: number;
}

export interface ImportedFit {
  activity: Activity;
  summary: FitSummary;
  hasHr: boolean;
}

export class FitImportError extends Error {}

const SEMI_TO_DEG = 180 / 2 ** 31;

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function time(v: unknown): number | undefined {
  if (v instanceof Date) return v.getTime();
  return undefined;
}

export function decodeFit(bytes: Uint8Array, name = 'Sortie Allez Robert !'): ImportedFit {
  if (bytes.length < 14) throw new FitImportError('Fichier FIT trop court');
  const decoder = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  if (!decoder.isFIT()) throw new FitImportError("Ce fichier n'est pas un FIT");
  if (!decoder.checkIntegrity()) throw new FitImportError('Fichier FIT corrompu (CRC)');
  const { messages, errors } = decoder.read({ convertTypesToStrings: false }) as unknown as {
    messages: Record<string, Msg[] | undefined>;
    errors: unknown[];
  };
  if (errors.length) throw new FitImportError('Fichier FIT illisible');
  const recs = messages.recordMesgs ?? [];
  if (recs.length === 0) throw new FitImportError('Aucun enregistrement dans le FIT');

  const records: ActivityRecord[] = [];
  let hasHr = false;
  for (const m of recs) {
    const t = time(m.timestamp);
    if (t === undefined) continue;
    const r: ActivityRecord = {
      t,
      distanceM: num(m.distance) ?? (records.at(-1)?.distanceM ?? 0),
      speedMs: num(m.enhancedSpeed) ?? num(m.speed) ?? 0,
      altitudeM: num(m.enhancedAltitude) ?? num(m.altitude) ?? 0,
    };
    const lat = num(m.positionLat);
    const lon = num(m.positionLong);
    if (lat !== undefined && lon !== undefined) {
      r.lat = lat * SEMI_TO_DEG;
      r.lon = lon * SEMI_TO_DEG;
    }
    const set = (k: keyof ActivityRecord, v: number | undefined): void => {
      if (v !== undefined) (r as unknown as Record<string, number>)[k] = v;
    };
    set('watts', num(m.power));
    set('cadence', num(m.cadence));
    const hr = num(m.heartRate);
    if (hr !== undefined && hr > 0) {
      r.hr = hr;
      hasHr = true;
    }
    const bal = num(m.leftRightBalance);
    if (bal !== undefined) set('balanceLeft', decodeBalanceLeft(bal));
    set('teLeft', num(m.leftTorqueEffectiveness));
    set('teRight', num(m.rightTorqueEffectiveness));
    set('psLeft', num(m.leftPedalSmoothness));
    set('psRight', num(m.rightPedalSmoothness));
    set('gradePercent', num(m.grade));
    set('temperatureC', num(m.temperature));
    records.push(r);
  }
  if (records.length === 0) throw new FitImportError('Aucun point horodaté');
  records.sort((a, b) => a.t - b.t);

  // Tours : bornes temporelles des messages lap → indices.
  const laps: ActivityLap[] = [];
  let idx = 0;
  for (const lap of messages.lapMesgs ?? []) {
    const start = time(lap.startTime);
    const end = time(lap.timestamp);
    if (start === undefined || end === undefined) continue;
    const startIndex = idx;
    while (idx < records.length && records[idx]!.t <= end) idx++;
    if (idx - 1 < startIndex) continue;
    laps.push({ startT: start, endT: end, startIndex, endIndex: idx - 1, trigger: 'manual' });
  }
  if (laps.length === 0 || idx < records.length) {
    const startIndex = laps.length ? laps.at(-1)!.endIndex + 1 : 0;
    if (startIndex < records.length) {
      laps.push({
        startT: records[startIndex]!.t,
        endT: records.at(-1)!.t,
        startIndex,
        endIndex: records.length - 1,
        trigger: 'sessionEnd',
      });
    }
  }
  laps.at(-1)!.trigger = 'sessionEnd';

  const session = messages.sessionMesgs?.[0] ?? {};
  const subSportRaw = num(session.subSport);
  const startT = time(session.startTime) ?? records[0]!.t;
  const activity: Activity = {
    id: `upload-${startT}`,
    name,
    sport: 'cycling',
    subSport: subSportRaw === 6 ? 'indoorCycling' : 'virtualActivity',
    startT,
    records,
    laps,
    riderMassKg: 75,
    deviceName: 'Allez Robert !',
  };

  const st = computeStats(records, 0, records.length - 1, 10, startT);
  const summary: FitSummary = {
    startedAt: startT,
    durationS: Math.round(st.elapsedS),
    movingS: Math.round(st.timerS),
    distanceM: st.distanceM,
    elevationM: st.ascentM,
  };
  if (st.avgPower !== undefined) summary.avgWatts = Math.round(st.avgPower);
  if (st.maxPower !== undefined) summary.maxWatts = Math.round(st.maxPower);
  if (st.avgHr !== undefined) summary.avgHr = Math.round(st.avgHr);
  if (st.maxHr !== undefined) summary.maxHr = Math.round(st.maxHr);
  return { activity, summary, hasHr };
}

/** Ré-encode la sortie sans aucune donnée de fréquence cardiaque. */
export function stripHeartRate(imported: ImportedFit): Uint8Array {
  const records = imported.activity.records.map((r) => {
    const { hr: _hr, ...rest } = r;
    return rest;
  });
  return encodeActivity({ ...imported.activity, records });
}
