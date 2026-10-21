import { describe, expect, it } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import type { Activity, ActivityRecord } from '@allezrobert/shared';
import {
  ActivityBuilder,
  buildActivity,
  computeStats,
  decodeBalanceLeft,
  encodeActivity,
  encodeBalance,
  fitCrc,
  FIT_EPOCH_S,
  toFitTimestamp,
} from '../src/index.ts';

type Msg = Record<string, unknown>;
interface Decoded {
  messages: Record<string, Msg[] | undefined>;
  errors: unknown[];
}

function decode(bytes: Uint8Array, opts: Record<string, unknown> = {}): Decoded {
  const stream = Stream.fromByteArray(Array.from(bytes));
  const decoder = new Decoder(stream);
  expect(decoder.isFIT()).toBe(true);
  expect(decoder.checkIntegrity()).toBe(true);
  return decoder.read(opts) as unknown as Decoded;
}

const START = Date.UTC(2026, 9, 21, 8, 0, 0);

/** 20 min à 1 Hz, deux tours, lat/lon, pédales double face, une pause de 30 s. */
function sampleActivity(): Activity {
  const records: ActivityRecord[] = [];
  let dist = 0;
  let alt = 120;
  let t = START;
  for (let i = 0; i < 1200; i++) {
    t += i === 600 ? 31000 : 1000; // pause après le 600e point
    const watts = 200 + (i % 60 < 30 ? 50 : -50);
    const speed = 9 + (i % 10) * 0.1;
    dist += speed;
    const grade = i < 600 ? 2 : -1;
    alt += speed * grade * 0.01;
    records.push({
      t,
      distanceM: dist,
      speedMs: speed,
      altitudeM: alt,
      lat: 48.7 + i * 1e-5,
      lon: 2.05 + i * 2e-5,
      watts,
      cadence: i % 100 === 0 ? 0 : 90,
      hr: 130 + Math.floor(i / 60),
      balanceLeft: 48,
      teLeft: 75.5,
      teRight: 80,
      psLeft: 22,
      psRight: 24.5,
      gradePercent: grade,
      temperatureC: 19,
    });
  }
  return {
    id: 'sortie-test',
    name: 'Boucle de Chevreuse',
    sport: 'cycling',
    subSport: 'virtualActivity',
    startT: START,
    records,
    laps: [
      { startT: START, endT: records[599]!.t, startIndex: 0, endIndex: 599, trigger: 'manual' },
      { startT: records[599]!.t, endT: records[1199]!.t, startIndex: 600, endIndex: 1199, trigger: 'sessionEnd' },
    ],
    riderMassKg: 75,
    ftpWatts: 250,
    deviceName: 'Allez Robert !',
  };
}

describe('primitives FIT', () => {
  it('époque FIT et CRC', () => {
    expect(FIT_EPOCH_S).toBe(Date.UTC(1989, 11, 31) / 1000);
    expect(toFitTimestamp(Date.UTC(1989, 11, 31, 0, 0, 10))).toBe(10);
    // Vecteur connu : CRC-16/ARC("123456789") = 0xBB3D.
    expect(fitCrc(new TextEncoder().encode('123456789'))).toBe(0xbb3d);
  });
  it('balance : bit 0x80 = jambe droite', () => {
    expect(encodeBalance(48)).toBe(0x80 | 52);
    expect(decodeBalanceLeft(0x80 | 52)).toBe(48);
    expect(decodeBalanceLeft(52)).toBeUndefined();
  });
});

describe('encodeActivity, relu par le SDK Garmin officiel', () => {
  const activity = sampleActivity();
  const bytes = encodeActivity(activity, { product: 7, serialNumber: 1234, timezoneOffsetMinutes: 120 });

  it('en-tête de 14 octets, CRC valides', () => {
    expect(bytes[0]).toBe(14);
    expect(String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!)).toBe('.FIT');
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    expect(dv.getUint32(4, true)).toBe(bytes.length - 16);
    expect(dv.getUint16(12, true)).toBe(fitCrc(bytes, 0, 12));
    expect(fitCrc(bytes)).toBe(0); // CRC final inclus ⇒ 0
  });

  it('aucune erreur, nombre de messages attendu', () => {
    const { messages, errors } = decode(bytes);
    expect(errors).toEqual([]);
    expect(messages.fileIdMesgs).toHaveLength(1);
    expect(messages.fileCreatorMesgs).toHaveLength(1);
    expect(messages.deviceInfoMesgs).toHaveLength(1);
    expect(messages.recordMesgs).toHaveLength(1200);
    expect(messages.lapMesgs).toHaveLength(2);
    expect(messages.sessionMesgs).toHaveLength(1);
    expect(messages.activityMesgs).toHaveLength(1);
    // start, stop/start autour de la pause, stop final.
    expect(messages.eventMesgs!.map((e) => e.eventType)).toEqual(['start', 'stopAll', 'start', 'stopAll']);
  });

  it('file_id, device_info, activity', () => {
    const { messages } = decode(bytes);
    const fid = messages.fileIdMesgs![0]!;
    expect(fid).toMatchObject({ type: 'activity', manufacturer: 'development', product: 7, serialNumber: 1234, productName: 'Allez Robert !' });
    expect((fid.timeCreated as Date).getTime()).toBe(START);
    expect(messages.deviceInfoMesgs![0]).toMatchObject({ deviceIndex: 'creator', manufacturer: 'development', sourceType: 'local', productName: 'Allez Robert !' });
    const act = messages.activityMesgs![0]!;
    expect(act).toMatchObject({ numSessions: 1, type: 'manual', event: 'activity', eventType: 'stop' });
    expect(act.localTimestamp).toBe(toFitTimestamp(activity.records[1199]!.t) + 7200);
  });

  it('records : valeurs et unités', () => {
    const { messages } = decode(bytes);
    const recs = messages.recordMesgs!;
    const src = activity.records[10]!;
    const r = recs[10]!;
    expect((r.timestamp as Date).getTime()).toBe(src.t);
    expect(r.power).toBe(src.watts);
    expect(r.heartRate).toBe(src.hr);
    expect(r.cadence).toBe(src.cadence);
    expect(r.distance as number).toBeCloseTo(src.distanceM, 2);
    expect(r.enhancedSpeed as number).toBeCloseTo(src.speedMs, 3);
    expect(r.enhancedAltitude as number).toBeCloseTo(src.altitudeM, 0);
    expect(Math.abs((r.enhancedAltitude as number) - src.altitudeM)).toBeLessThanOrEqual(0.1);
    expect(r.grade).toBe(2);
    expect(r.temperature).toBe(19);
    expect(r.leftTorqueEffectiveness).toBe(75.5);
    expect(r.rightTorqueEffectiveness).toBe(80);
    expect(r.leftPedalSmoothness).toBe(22);
    expect(r.rightPedalSmoothness).toBe(24.5);
    expect(((r.positionLat as number) * 180) / 2 ** 31).toBeCloseTo(src.lat!, 6);
    expect(((r.positionLong as number) * 180) / 2 ** 31).toBeCloseTo(src.lon!, 6);
    // Balance brute : 52 % à droite avec le bit « right ».
    const raw = decode(bytes, { convertTypesToStrings: false }).messages.recordMesgs![10]!;
    expect(raw.leftRightBalance).toBe(0x80 | 52);
  });

  it('tours et session', () => {
    const { messages } = decode(bytes);
    const s = messages.sessionMesgs![0]!;
    expect(s).toMatchObject({ sport: 'cycling', subSport: 'virtualActivity', numLaps: 2, firstLapIndex: 0, event: 'session', eventType: 'stop', thresholdPower: 250 });
    const recs = activity.records;
    expect(s.totalDistance as number).toBeCloseTo(recs[1199]!.distanceM, 1);
    expect(s.totalElapsedTime as number).toBeCloseTo(1200 + 30, 3);
    expect(s.totalTimerTime as number).toBeCloseTo(1199, 3); // l’intervalle de pause (31 s) est exclu
    expect(s.avgPower).toBe(200);
    expect(s.maxPower).toBe(250);
    expect(s.maxHeartRate).toBe(149);
    expect(s.avgCadence).toBe(90); // zéros exclus
    expect(s.normalizedPower as number).toBeGreaterThan(200);
    expect(s.trainingStressScore as number).toBeGreaterThan(0);
    expect(s.intensityFactor as number).toBeCloseTo((s.normalizedPower as number) / 250, 2);
    expect(s.avgLeftTorqueEffectiveness).toBe(75.5);
    expect(s.avgRightPedalSmoothness).toBe(24.5);
    expect(s.totalAscent as number).toBeGreaterThan(100);
    const rawS = decode(bytes, { convertTypesToStrings: false }).messages.sessionMesgs![0]!;
    expect(rawS.leftRightBalance).toBe(0x8000 | 5200);

    const laps = messages.lapMesgs!;
    expect(laps[0]).toMatchObject({ lapTrigger: 'manual', sport: 'cycling', subSport: 'virtualActivity', messageIndex: 0 });
    expect(laps[1]).toMatchObject({ lapTrigger: 'sessionEnd', messageIndex: 1 });
    const d0 = laps[0]!.totalDistance as number;
    const d1 = laps[1]!.totalDistance as number;
    expect(d0 + d1).toBeCloseTo(s.totalDistance as number, 1);
    expect((laps[0]!.totalTimerTime as number) + (laps[1]!.totalTimerTime as number)).toBeCloseTo(s.totalTimerTime as number, 3);
    expect(laps[0]!.avgHeartRate).toBe(135); // 134,5 arrondi
  });

  it('indoor_cycling, champs absents, sortie sans tour', () => {
    const records: ActivityRecord[] = [0, 1, 2].map((i) => ({ t: START + i * 1000, distanceM: i * 5, speedMs: 5, altitudeM: 50, watts: 150 }));
    const bytes2 = encodeActivity({ ...sampleActivity(), subSport: 'indoorCycling', records, laps: [], ftpWatts: undefined });
    const { messages, errors } = decode(bytes2);
    expect(errors).toEqual([]);
    expect(messages.sessionMesgs![0]).toMatchObject({ subSport: 'indoorCycling', numLaps: 1 });
    expect(messages.lapMesgs).toHaveLength(1);
    const r = messages.recordMesgs![0]!;
    expect(r.heartRate).toBeUndefined();
    expect(r.positionLat).toBeUndefined();
    expect(r.power).toBe(150);
    expect(messages.sessionMesgs![0]!.trainingStressScore).toBeUndefined();
  });

  it('refuse une sortie vide', () => {
    expect(() => encodeActivity({ ...sampleActivity(), records: [] })).toThrow();
  });
});

describe('ActivityBuilder', () => {
  it('agrège à 1 Hz et découpe les tours', () => {
    const b = new ActivityBuilder({ id: 'b', name: 'Test', riderMassKg: 70, ftpWatts: 240 });
    // 60 Hz pendant 10 s : puissance 100 puis 300 alternées.
    for (let i = 0; i < 600; i++) {
      const t = START + Math.round((i * 1000) / 60);
      b.addSample({ t, distanceM: i * 0.15, speedMs: 9, altitudeM: 10, watts: i % 2 ? 300 : 100, cadence: 90, hr: 120.4 });
      if (i === 299) b.markLap('segment');
    }
    const a = b.finish();
    expect(a.records).toHaveLength(10);
    expect(a.records[0]!.watts).toBe(200);
    expect(a.records[0]!.hr).toBe(120);
    expect(a.records[0]!.t).toBe(START);
    expect(a.laps.map((l) => [l.startIndex, l.endIndex, l.trigger])).toEqual([
      [0, 4, 'segment'],
      [5, 9, 'sessionEnd'],
    ]);
    const { messages, errors } = decode(encodeActivity(a));
    expect(errors).toEqual([]);
    expect(messages.lapMesgs).toHaveLength(2);
    expect(messages.lapMesgs![0]!.lapTrigger).toBe('positionMarked');
  });
  it('buildActivity et statistiques', () => {
    const samples: ActivityRecord[] = Array.from({ length: 120 }, (_, i) => ({ t: START + i * 1000, distanceM: (i + 1) * 10, speedMs: 10, altitudeM: 100 + (i < 60 ? i : 120 - i), watts: 250 }));
    const a = buildActivity({ id: 'x', name: 'x', riderMassKg: 70 }, samples, [START + 59000]);
    expect(a.laps).toHaveLength(2);
    const s = computeStats(a.records, 0, a.records.length - 1);
    expect(s.distanceM).toBe(1200);
    expect(s.timerS).toBe(120);
    expect(s.workJ).toBe(250 * 120);
    expect(s.normalizedPower).toBeCloseTo(250, 9);
    expect(s.ascentM).toBe(60);
  });
});
