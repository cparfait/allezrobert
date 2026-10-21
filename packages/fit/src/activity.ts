/**
 * Encodage d'une sortie (`Activity` partagée) en fichier FIT ACTIVITY.
 *
 * Messages écrits, dans l'ordre : file_id, file_creator, device_info (créateur),
 * event timer start, record × n (avec event timer stop/start autour des pauses et un lap
 * après le dernier point de chaque tour), event timer stop_all, session, activity.
 *
 * Balance gauche/droite : nos records stockent la part GAUCHE (`balanceLeft`, %). Le FIT
 * (`left_right_balance`, uint8) code une contribution en % sur 7 bits ; le bit 0x80 « right »
 * indique que la valeur est celle de la jambe DROITE (sinon jambe inconnue). Nous écrivons
 * donc (100 − balanceLeft) | 0x80, comme les compteurs Garmin avec pédales double face.
 * Session / tour : `left_right_balance_100` (uint16, 0,01 %, bit 0x8000 « right »).
 * TE / PS : uint8 à 0,5 % de résolution (échelle 2).
 */
import type { Activity } from '@allezrobert/shared';
import { FitWriter, toFitTimestamp, toSemicircles, type FieldDef, type FieldValue, type MessageDef } from './encoder.ts';
import { computeStats, type RecordStats } from './stats.ts';

export interface FitEncodeOptions {
  /** Identifiant produit (fabricant « development » 255). Défaut 1. */
  product?: number;
  /** Numéro de série (≠ 0). Défaut : hachage de l'id de la sortie. */
  serialNumber?: number;
  /** Version logicielle du jeu, ex. 1.02. Défaut 1.0. */
  softwareVersion?: number;
  /** Nom du produit affiché (défaut `activity.deviceName`). */
  productName?: string;
  /** Décalage du fuseau (min) pour `activity.local_timestamp`. Défaut : fuseau de la machine. */
  timezoneOffsetMinutes?: number;
  /** Écart entre deux points au-delà duquel on considère une pause (s). Défaut 10. */
  pauseGapS?: number;
}

/** Numéros de messages globaux FIT utilisés. */
export const FitMesg = {
  fileId: 0,
  session: 18,
  lap: 19,
  record: 20,
  event: 21,
  deviceInfo: 23,
  activity: 34,
  fileCreator: 49,
} as const;

const SPORT_CYCLING = 2;
const SUB_SPORT = { virtualActivity: 58, indoorCycling: 6 } as const;
const MANUFACTURER_DEVELOPMENT = 255;
const EVENT_TIMER = 0;
const EVENT_SESSION = 8;
const EVENT_LAP = 9;
const EVENT_ACTIVITY = 26;
const EVENT_TYPE_START = 0;
const EVENT_TYPE_STOP = 1;
const EVENT_TYPE_STOP_ALL = 4;
const LAP_TRIGGER = { manual: 0, workoutStep: 1, distance: 2, segment: 6, sessionEnd: 7 } as const;

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0 || 1;
}

/** Valeur FIT left_right_balance (uint8) depuis la part gauche en %. */
export function encodeBalance(balanceLeft: number): number {
  const right = Math.min(Math.max(Math.round(100 - balanceLeft), 0), 100);
  return right | 0x80;
}

/** Valeur FIT left_right_balance_100 (uint16) depuis la part gauche en %. */
export function encodeBalance100(balanceLeft: number): number {
  const right = Math.min(Math.max(Math.round((100 - balanceLeft) * 100), 0), 10000);
  return right | 0x8000;
}

/** Part gauche (%) depuis une valeur FIT left_right_balance (bit 0x80 = droite). */
export function decodeBalanceLeft(raw: number): number | undefined {
  if (raw === 0xff) return undefined;
  const v = raw & 0x7f;
  return raw & 0x80 ? 100 - v : undefined;
}

const KCAL_PER_J = 1 / (4184 * 0.24);

type Def = readonly FieldDef[];

const FILE_ID: Def = [
  { num: 0, type: 'enum' },
  { num: 1, type: 'uint16' },
  { num: 2, type: 'uint16' },
  { num: 3, type: 'uint32z' },
  { num: 4, type: 'uint32' },
  { num: 8, type: 'string', size: 32 },
];
const FILE_CREATOR: Def = [{ num: 0, type: 'uint16' }];
const DEVICE_INFO: Def = [
  { num: 253, type: 'uint32' },
  { num: 0, type: 'uint8' },
  { num: 2, type: 'uint16' },
  { num: 3, type: 'uint32z' },
  { num: 4, type: 'uint16' },
  { num: 5, type: 'uint16', scale: 100 },
  { num: 25, type: 'enum' },
  { num: 27, type: 'string', size: 32 },
];
const EVENT: Def = [
  { num: 253, type: 'uint32' },
  { num: 0, type: 'enum' },
  { num: 1, type: 'enum' },
  { num: 4, type: 'uint8' },
];
const ACTIVITY: Def = [
  { num: 253, type: 'uint32' },
  { num: 0, type: 'uint32', scale: 1000 },
  { num: 1, type: 'uint16' },
  { num: 2, type: 'enum' },
  { num: 3, type: 'enum' },
  { num: 4, type: 'enum' },
  { num: 5, type: 'uint32' },
];

/** Champs record possibles, avec l'extracteur depuis un ActivityRecord. */
interface RecordField {
  def: FieldDef;
  key: keyof Activity['records'][number] | 'pos';
  get: (r: Activity['records'][number]) => FieldValue;
}

const RECORD_FIELDS: readonly RecordField[] = [
  { def: { num: 0, type: 'sint32' }, key: 'lat', get: (r) => (r.lat !== undefined && r.lon !== undefined ? toSemicircles(r.lat) : undefined) },
  { def: { num: 1, type: 'sint32' }, key: 'lon', get: (r) => (r.lat !== undefined && r.lon !== undefined ? toSemicircles(r.lon) : undefined) },
  { def: { num: 5, type: 'uint32', scale: 100 }, key: 'distanceM', get: (r) => r.distanceM },
  { def: { num: 73, type: 'uint32', scale: 1000 }, key: 'speedMs', get: (r) => r.speedMs },
  { def: { num: 78, type: 'uint32', scale: 5, offset: 500 }, key: 'altitudeM', get: (r) => r.altitudeM },
  { def: { num: 7, type: 'uint16' }, key: 'watts', get: (r) => r.watts },
  { def: { num: 4, type: 'uint8' }, key: 'cadence', get: (r) => r.cadence },
  { def: { num: 3, type: 'uint8' }, key: 'hr', get: (r) => r.hr },
  { def: { num: 9, type: 'sint16', scale: 100 }, key: 'gradePercent', get: (r) => r.gradePercent },
  { def: { num: 13, type: 'sint8' }, key: 'temperatureC', get: (r) => r.temperatureC },
  { def: { num: 30, type: 'uint8' }, key: 'balanceLeft', get: (r) => (r.balanceLeft !== undefined ? encodeBalance(r.balanceLeft) : undefined) },
  { def: { num: 43, type: 'uint8', scale: 2 }, key: 'teLeft', get: (r) => r.teLeft },
  { def: { num: 44, type: 'uint8', scale: 2 }, key: 'teRight', get: (r) => r.teRight },
  { def: { num: 45, type: 'uint8', scale: 2 }, key: 'psLeft', get: (r) => r.psLeft },
  { def: { num: 46, type: 'uint8', scale: 2 }, key: 'psRight', get: (r) => r.psRight },
];

/** Champs communs lap / session : [numéro lap, numéro session, type, échelle, extracteur]. */
type SummaryField = [lapNum: number | null, sessionNum: number | null, def: Omit<FieldDef, 'num'>, get: (s: RecordStats) => FieldValue];

const SUMMARY_FIELDS: readonly SummaryField[] = [
  [253, 253, { type: 'uint32' }, (s) => toFitTimestamp(s.endT)],
  [2, 2, { type: 'uint32' }, (s) => toFitTimestamp(s.startT)],
  [7, 7, { type: 'uint32', scale: 1000 }, (s) => s.elapsedS],
  [8, 8, { type: 'uint32', scale: 1000 }, (s) => s.timerS],
  [9, 9, { type: 'uint32', scale: 100 }, (s) => s.distanceM],
  [11, 11, { type: 'uint16' }, (s) => Math.round(s.workJ * KCAL_PER_J)],
  [13, 14, { type: 'uint16', scale: 1000 }, (s) => s.avgSpeedMs],
  [14, 15, { type: 'uint16', scale: 1000 }, (s) => s.maxSpeedMs],
  [110, 124, { type: 'uint32', scale: 1000 }, (s) => s.avgSpeedMs],
  [111, 125, { type: 'uint32', scale: 1000 }, (s) => s.maxSpeedMs],
  [15, 16, { type: 'uint8' }, (s) => s.avgHr],
  [16, 17, { type: 'uint8' }, (s) => s.maxHr],
  [63, 64, { type: 'uint8' }, (s) => s.minHr],
  [17, 18, { type: 'uint8' }, (s) => s.avgCadence],
  [18, 19, { type: 'uint8' }, (s) => s.maxCadence],
  [19, 20, { type: 'uint16' }, (s) => s.avgPower],
  [20, 21, { type: 'uint16' }, (s) => s.maxPower],
  [21, 22, { type: 'uint16' }, (s) => s.ascentM],
  [22, 23, { type: 'uint16' }, (s) => s.descentM],
  [33, 34, { type: 'uint16' }, (s) => s.normalizedPower],
  [34, 37, { type: 'uint16' }, (s) => (s.avgBalanceLeft !== undefined ? encodeBalance100(s.avgBalanceLeft) : undefined)],
  [41, 48, { type: 'uint32' }, (s) => s.workJ],
  [91, 101, { type: 'uint8', scale: 2 }, (s) => s.avgTeLeft],
  [92, 102, { type: 'uint8', scale: 2 }, (s) => s.avgTeRight],
  [93, 103, { type: 'uint8', scale: 2 }, (s) => s.avgPsLeft],
  [94, 104, { type: 'uint8', scale: 2 }, (s) => s.avgPsRight],
  [50, 57, { type: 'sint8' }, (s) => s.avgTemperature],
  [51, 58, { type: 'sint8' }, (s) => s.maxTemperature],
  [45, 52, { type: 'sint16', scale: 100 }, (s) => s.avgGrade],
  [3, 3, { type: 'sint32' }, (s) => (s.startLat !== undefined ? toSemicircles(s.startLat) : undefined)],
  [4, 4, { type: 'sint32' }, (s) => (s.startLon !== undefined ? toSemicircles(s.startLon) : undefined)],
  [5, 38, { type: 'sint32' }, (s) => (s.endLat !== undefined ? toSemicircles(s.endLat) : undefined)],
  [6, 39, { type: 'sint32' }, (s) => (s.endLon !== undefined ? toSemicircles(s.endLon) : undefined)],
  [27, 29, { type: 'sint32' }, (s) => (s.necLat !== undefined ? toSemicircles(s.necLat) : undefined)],
  [28, 30, { type: 'sint32' }, (s) => (s.necLon !== undefined ? toSemicircles(s.necLon) : undefined)],
  [29, 31, { type: 'sint32' }, (s) => (s.swcLat !== undefined ? toSemicircles(s.swcLat) : undefined)],
  [30, 32, { type: 'sint32' }, (s) => (s.swcLon !== undefined ? toSemicircles(s.swcLon) : undefined)],
];

function summaryDef(which: 0 | 1, extra: FieldDef[]): { def: MessageDef; getters: Array<(s: RecordStats) => FieldValue> } {
  const fields: FieldDef[] = [];
  const getters: Array<(s: RecordStats) => FieldValue> = [];
  for (const f of SUMMARY_FIELDS) {
    const num = f[which];
    if (num === null) continue;
    fields.push({ ...f[2], num });
    getters.push(f[3]);
  }
  return { def: { globalNum: which === 0 ? FitMesg.lap : FitMesg.session, fields: [...fields, ...extra] }, getters };
}

const LAP_EXTRA: FieldDef[] = [
  { num: 254, type: 'uint16' }, // message_index
  { num: 0, type: 'enum' }, // event
  { num: 1, type: 'enum' }, // event_type
  { num: 24, type: 'enum' }, // lap_trigger
  { num: 25, type: 'enum' }, // sport
  { num: 39, type: 'enum' }, // sub_sport
];
const SESSION_EXTRA: FieldDef[] = [
  { num: 254, type: 'uint16' }, // message_index
  { num: 0, type: 'enum' }, // event
  { num: 1, type: 'enum' }, // event_type
  { num: 28, type: 'enum' }, // trigger
  { num: 5, type: 'enum' }, // sport
  { num: 6, type: 'enum' }, // sub_sport
  { num: 25, type: 'uint16' }, // first_lap_index
  { num: 26, type: 'uint16' }, // num_laps
  { num: 35, type: 'uint16', scale: 10 }, // training_stress_score
  { num: 36, type: 'uint16', scale: 1000 }, // intensity_factor
  { num: 45, type: 'uint16' }, // threshold_power
];

const LOCAL = { fileId: 0, fileCreator: 1, deviceInfo: 2, event: 3, record: 4, lap: 5, session: 6, activity: 7 } as const;

/** Encode une sortie en fichier FIT ACTIVITY (Uint8Array prêt à écrire / envoyer). */
export function encodeActivity(activity: Activity, opts: FitEncodeOptions = {}): Uint8Array {
  const records = activity.records;
  if (records.length === 0) throw new Error('FIT : la sortie ne contient aucun enregistrement');
  const pauseGapS = opts.pauseGapS ?? 10;
  const product = opts.product ?? 1;
  const serial = opts.serialNumber ?? hash32(activity.id);
  const productName = opts.productName ?? activity.deviceName;
  const subSport = SUB_SPORT[activity.subSport];
  const first = records[0]!;
  const last = records[records.length - 1]!;
  const startT = Math.min(activity.startT, first.t);
  const endT = last.t;
  const w = new FitWriter();

  // En-têtes.
  w.define(LOCAL.fileId, { globalNum: FitMesg.fileId, fields: [...FILE_ID] });
  w.write(LOCAL.fileId, [4, MANUFACTURER_DEVELOPMENT, product, serial, toFitTimestamp(startT), productName]);
  w.define(LOCAL.fileCreator, { globalNum: FitMesg.fileCreator, fields: [...FILE_CREATOR] });
  w.write(LOCAL.fileCreator, [Math.round((opts.softwareVersion ?? 1) * 100)]);
  w.define(LOCAL.deviceInfo, { globalNum: FitMesg.deviceInfo, fields: [...DEVICE_INFO] });
  w.write(LOCAL.deviceInfo, [toFitTimestamp(startT), 0, MANUFACTURER_DEVELOPMENT, serial, product, opts.softwareVersion ?? 1, 5 /* local */, productName]);
  w.define(LOCAL.event, { globalNum: FitMesg.event, fields: [...EVENT] });
  w.write(LOCAL.event, [toFitTimestamp(startT), EVENT_TIMER, EVENT_TYPE_START, 0]);

  // Champs record présents dans au moins un point.
  const recFields = RECORD_FIELDS.filter((f) => {
    if (f.key === 'distanceM' || f.key === 'speedMs' || f.key === 'altitudeM') return true;
    if (f.key === 'lat' || f.key === 'lon') return records.some((r) => r.lat !== undefined && r.lon !== undefined);
    return records.some((r) => r[f.key as keyof typeof r] !== undefined);
  });
  w.define(LOCAL.record, { globalNum: FitMesg.record, fields: [{ num: 253, type: 'uint32' }, ...recFields.map((f) => f.def)] });

  // Tours : ceux de la sortie, sinon un tour unique.
  const laps = activity.laps.length
    ? [...activity.laps].sort((a, b) => a.startIndex - b.startIndex)
    : [{ startT, endT, startIndex: 0, endIndex: records.length - 1, trigger: 'sessionEnd' as const }];
  const lapEnds = new Map<number, number[]>();
  laps.forEach((l, i) => {
    const e = Math.min(Math.max(l.endIndex, 0), records.length - 1);
    const list = lapEnds.get(e);
    if (list) list.push(i);
    else lapEnds.set(e, [i]);
  });
  const lapDef = summaryDef(0, LAP_EXTRA);
  let lapDefined = false;

  const values: FieldValue[] = new Array<FieldValue>(recFields.length + 1);
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    const prev = records[i - 1];
    if (prev && (r.t - prev.t) / 1000 > pauseGapS) {
      w.write(LOCAL.event, [toFitTimestamp(prev.t), EVENT_TIMER, EVENT_TYPE_STOP_ALL, 0]);
      w.write(LOCAL.event, [toFitTimestamp(r.t), EVENT_TIMER, EVENT_TYPE_START, 0]);
    }
    values[0] = toFitTimestamp(r.t);
    for (let k = 0; k < recFields.length; k++) values[k + 1] = recFields[k]!.get(r);
    w.write(LOCAL.record, values);

    const ending = lapEnds.get(i);
    if (ending) {
      for (const li of ending) {
        const l = laps[li]!;
        const s = computeStats(records, l.startIndex, l.endIndex, pauseGapS, li === 0 ? startT : l.startT, l.endT);
        if (!lapDefined) {
          w.define(LOCAL.lap, lapDef.def);
          lapDefined = true;
        }
        w.write(LOCAL.lap, [
          ...lapDef.getters.map((g) => g(s)),
          li,
          EVENT_LAP,
          EVENT_TYPE_STOP,
          LAP_TRIGGER[l.trigger],
          SPORT_CYCLING,
          subSport,
        ]);
      }
    }
  }

  // Fin : timer, session, activité.
  const endTs = toFitTimestamp(endT);
  w.write(LOCAL.event, [endTs, EVENT_TIMER, EVENT_TYPE_STOP_ALL, 0]);
  const total = computeStats(records, 0, records.length - 1, pauseGapS, startT, endT);
  const ftp = activity.ftpWatts;
  const np = total.normalizedPower;
  const ifactor = ftp && np ? np / ftp : undefined;
  const tss = ftp && np && ifactor !== undefined ? ((total.timerS * np * ifactor) / (ftp * 3600)) * 100 : undefined;
  const sessionDef = summaryDef(1, SESSION_EXTRA);
  w.define(LOCAL.session, sessionDef.def);
  w.write(LOCAL.session, [
    ...sessionDef.getters.map((g) => g(total)),
    0,
    EVENT_SESSION,
    EVENT_TYPE_STOP,
    0, // activity_end
    SPORT_CYCLING,
    subSport,
    0,
    laps.length,
    tss,
    ifactor,
    ftp,
  ]);
  const tz = opts.timezoneOffsetMinutes ?? -new Date(endT).getTimezoneOffset();
  w.define(LOCAL.activity, { globalNum: FitMesg.activity, fields: [...ACTIVITY] });
  w.write(LOCAL.activity, [endTs, total.timerS, 1, 0 /* manual */, EVENT_ACTIVITY, EVENT_TYPE_STOP, endTs + tz * 60]);

  return w.finish();
}

/** Alias explicite. */
export const activityToFit = encodeActivity;
