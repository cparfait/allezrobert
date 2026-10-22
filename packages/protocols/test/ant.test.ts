import { describe, expect, it } from 'vitest';
import {
  ANT_MSG,
  AntHeartRateRrCalculator,
  AntMessageReader,
  PwrCrankTorqueCalculator,
  PwrPowerOnlyCalculator,
  antAcknowledgedData,
  antAssignChannel,
  antBroadcastData,
  antOpenChannel,
  antResetSystem,
  antSetChannelId,
  antSetChannelPeriod,
  antSetChannelRfFrequency,
  antSetNetworkKey,
  decodeAntHeartRatePage,
  decodeAntMessage,
  decodeCommonPage,
  decodeFecCommand,
  decodeFecPage,
  decodePwrPage,
  encodeAntMessage,
  encodeFecBasicResistance,
  encodeFecCalibrationInProgress,
  encodeFecCalibrationRequest,
  encodeFecCalibrationResponse,
  encodeFecGeneralFeData,
  encodeFecSpecificTrainerData,
  encodeFecTargetPower,
  encodeFecTrackResistance,
  encodeFecUserConfiguration,
  encodeFecWindResistance,
  encodePwrStandardPowerOnly,
  encodePwrTePs,
  encodeRequestDataPage,
  fromHex,
  leftBalanceFromPwr,
  parseAntDataMessage,
  parseAntNetworkKey,
  parseChannelEvent,
  toHex,
  ProtocolError,
  type PwrCrankTorque,
  type PwrStandardPowerOnly,
} from '../src/index.ts';

const h = fromHex;

describe('Trames ANT (Message Protocol §7.1, XOR)', () => {
  it('messages de configuration', () => {
    expect(toHex(antResetSystem())).toBe('a4 01 4a 00 ef');
    expect(toHex(antOpenChannel(0))).toBe('a4 01 4b 00 ee');
    expect(toHex(antAssignChannel(0))).toBe('a4 03 42 00 00 00 e5');
    expect(toHex(antSetChannelId(0, 0, 120, 0))).toBe('a4 05 51 00 00 00 78 00 88');
    expect(toHex(antSetChannelPeriod(0, 8070))).toBe('a4 03 43 00 86 1f 7d');
    expect(toHex(antSetChannelRfFrequency(0))).toBe('a4 02 45 00 39 da');
  });

  it('clé réseau : jamais codée en dur, lue depuis la configuration (valeur fictive ici)', () => {
    const key = parseAntNetworkKey('00 11 22 33 44 55 66 77');
    expect(key).toBeDefined();
    expect(toHex(antSetNetworkKey(0, key!))).toBe('a4 09 46 00 00 11 22 33 44 55 66 77 eb');
    expect(parseAntNetworkKey(undefined)).toBeUndefined();
    expect(parseAntNetworkKey('')).toBeUndefined();
    expect(() => parseAntNetworkKey('0011')).toThrow(ProtocolError);
  });

  it('données diffusées / acquittées', () => {
    const page = encodeFecTargetPower(250);
    const msg = antAcknowledgedData(5, page);
    expect(toHex(msg)).toBe('a4 09 4f 05 31 ff ff ff ff ff e8 03 ' + toHex([msg[msg.length - 1]!]));
    const decoded = parseAntDataMessage(decodeAntMessage(msg));
    expect(decoded).toMatchObject({ channel: 5, acknowledged: true });
    expect(toHex(decoded.data)).toBe(toHex(page));
    expect(() => antBroadcastData(0, [1, 2, 3])).toThrow(ProtocolError);
  });

  it('message étendu avec ID de canal (flag 0x80)', () => {
    const ext = encodeAntMessage(ANT_MSG.broadcastData, [0, ...h('00 FF FF FF 00 04 05 48'), 0x80, 0x39, 0x30, 0x78, 0x01]);
    const d = parseAntDataMessage(decodeAntMessage(ext));
    expect(d.channelId).toEqual({ deviceNumber: 12345, deviceType: 120, pairing: false, transmissionType: 1 });
  });

  it('événement de canal', () => {
    expect(parseChannelEvent(decodeAntMessage(h('a4 03 40 00 01 01 e7')))).toEqual({
      channel: 0,
      messageId: 1,
      code: 1,
      codeName: 'eventRxSearchTimeout',
      isEvent: true,
    });
  });

  it('somme de contrôle invalide rejetée', () => {
    expect(() => decodeAntMessage(h('a4 01 4a 00 ee'))).toThrow(ProtocolError);
  });

  it('réassembleur USB : morceaux, déchets, trames collées', () => {
    const r = new AntMessageReader();
    const a = antResetSystem();
    const b = antOpenChannel(1);
    expect(r.push([0x00, 0x13, ...a.slice(0, 2)])).toEqual([]);
    const out = r.push([...a.slice(2), ...b, 0xa4]);
    expect(out.map((m) => m.id)).toEqual([0x4a, 0x4b]);
    expect(r.dropped).toBe(2);
    // fausse synchro 0xA4 suivie d'une vraie trame
    const out2 = r.push(antOpenChannel(2));
    expect(out2.map((m) => toHex(m.payload))).toEqual(['02']);
  });
});

describe('ANT+ FE-C', () => {
  it('page 16 General FE Data', () => {
    expect(decodeFecPage(h('10 19 28 64 B8 0B FF 34'))).toEqual({
      page: 0x10,
      equipmentType: 'trainer',
      elapsedTimeRaw: 40,
      distanceRaw: 100,
      speedKmh: 10.8,
      heartRateSource: 'invalid',
      distanceEnabled: true,
      virtualSpeed: false,
      state: 'inUse',
      lapToggle: false,
    });
    expect(toHex(encodeFecGeneralFeData({ speedKmh: 10.8, elapsedTimeS: 10, distanceM: 100 }))).toBe('10 19 28 64 b8 0b ff 34');
  });

  it('page 25 Specific Trainer Data (puissance 12 bits, bits de statut)', () => {
    expect(decodeFecPage(h('19 05 5A 10 27 FA 00 30'))).toMatchObject({
      page: 0x19,
      updateEventCount: 5,
      cadenceRpm: 90,
      accumulatedPowerW: 10000,
      instantaneousPowerW: 250,
      resistanceCalibrationRequired: false,
      targetPowerLimits: 'atTarget',
      state: 'inUse',
    });
    expect(decodeFecPage(h('19 06 5A 10 27 2C 21 31'))).toMatchObject({
      instantaneousPowerW: 300,
      resistanceCalibrationRequired: true,
      targetPowerLimits: 'speedTooLow',
    });
    expect(decodeFecPage(h('19 06 FF 10 27 FF 0F 30'))).not.toHaveProperty('instantaneousPowerW');
    expect(toHex(encodeFecSpecificTrainerData({ eventCount: 5, cadenceRpm: 90, accumulatedPowerW: 10000, powerW: 250 }))).toBe('19 05 5a 10 27 fa 00 30');
  });

  it('commandes 48/49/50/51/55 et calibration', () => {
    expect(toHex(encodeFecBasicResistance(50))).toBe('30 ff ff ff ff ff ff 64');
    expect(toHex(encodeFecTargetPower(250))).toBe('31 ff ff ff ff ff e8 03');
    expect(toHex(encodeFecTrackResistance({ gradePercent: 5 }))).toBe('33 ff ff ff ff 14 50 ff');
    expect(toHex(encodeFecTrackResistance({ gradePercent: -3, crr: 0.004 }))).toBe('33 ff ff ff ff f4 4c 50');
    expect(toHex(encodeFecWindResistance({ windResistanceCoefficient: 0.51, windSpeedKmh: 10, draftingFactor: 1 }))).toBe('32 ff ff ff ff 33 89 64');
    expect(toHex(encodeFecWindResistance())).toBe('32 ff ff ff ff ff ff ff');
    expect(toHex(encodeFecUserConfiguration({ userWeightKg: 75, bikeWeightKg: 8.5, wheelDiameterM: 0.7 }))).toBe('37 4c 1d ff a0 0a 46 00');
    expect(toHex(encodeFecCalibrationRequest({ spinDown: true }))).toBe('01 80 00 00 00 00 00 00');
  });

  it('pages 1 et 2 côté trainer : réponse et calibration en cours (spin-down)', () => {
    // Réponse : spin-down réussi, 21,5 °C → (21,5 + 25) × 2 = 93 = 0x5D, zéro invalide, 3500 ms = 0x0DAC.
    expect(decodeFecPage(h('01 80 00 5D FF FF AC 0D'))).toEqual({
      page: 0x01,
      kind: 'calibrationResponse',
      zeroOffsetSuccess: false,
      spinDownSuccess: true,
      temperatureC: 21.5,
      spinDownTimeMs: 3500,
    });
    expect(decodeFecPage(h('01 00 00 FF FF FF FF FF'))).toEqual({ page: 0x01, kind: 'calibrationResponse', zeroOffsetSuccess: false, spinDownSuccess: false });
    expect(toHex(encodeFecCalibrationResponse({ spinDownSuccess: true, temperatureC: 21.5, spinDownTimeMs: 3500 }))).toBe('01 80 00 5d ff ff ac 0d');
    // En cours : spin-down en attente, température bonne (2 << 4), vitesse trop basse (1 << 6) → 0x60,
    // 20 °C → 0x5A, vitesse cible 30 km/h = 8333 mm/s = 0x208D, durée visée invalide.
    const p = decodeFecPage(h('02 80 60 5A 8D 20 FF FF'));
    expect(p).toMatchObject({ page: 0x02, kind: 'calibrationInProgress', spinDownPending: true, zeroOffsetPending: false, temperatureCondition: 'ok', speedCondition: 'tooLow', temperatureC: 20 });
    expect((p as { targetSpeedKmh: number }).targetSpeedKmh).toBeCloseTo(30, 2);
    expect(p).not.toHaveProperty('targetSpinDownTimeMs');
    expect(decodeFecPage(h('02 80 A0 5A 8D 20 B8 0B'))).toMatchObject({ speedCondition: 'ok', targetSpinDownTimeMs: 3000 });
    expect(toHex(encodeFecCalibrationInProgress({ spinDownPending: true, temperatureCondition: 'ok', speedCondition: 'tooLow', temperatureC: 20, targetSpeedKmh: 30 }))).toBe('02 80 60 5a 8d 20 ff ff');
  });

  it('décodage des commandes (simulateur)', () => {
    expect(decodeFecCommand(h('33 ff ff ff ff f4 4c 50'))).toEqual({ page: 0x33, kind: 'trackResistance', gradePercent: -3, crr: 0.004 });
    expect(decodeFecCommand(h('31 ff ff ff ff ff e8 03'))).toEqual({ page: 0x31, kind: 'targetPower', watts: 250 });
  });

  it('page 71 Command Status, pages communes 80/81/82', () => {
    expect(decodeFecPage(h('47 31 07 00 FF FF E8 03'))).toMatchObject({ page: 0x47, lastReceivedCommandId: 0x31, sequenceNumber: 7, status: 'pass' });
    expect(decodeCommonPage(h('50 FF FF 05 20 00 39 30'))).toEqual({ page: 0x50, hardwareRevision: 5, manufacturerId: 32, modelNumber: 12345 });
    expect(decodeCommonPage(h('51 FF FF 1E 78 56 34 12'))).toEqual({ page: 0x51, softwareRevision: '3', serialNumber: 0x12345678 });
    expect(decodeCommonPage(h('52 FF 00 00 00 00 80 23'))).toEqual({ page: 0x52, batteryIdentifier: 0, voltage: 3.5, status: 'good' });
    expect(toHex(encodeRequestDataPage(0x50))).toBe('46 ff ff ff ff 04 50 01');
  });
});

describe('ANT+ PWR', () => {
  it('page 0x10 : balance référencée à droite', () => {
    const p = decodePwrPage(h('10 0C B2 5A 34 12 C8 00')) as PwrStandardPowerOnly;
    expect(p).toEqual({ page: 0x10, updateEventCount: 12, pedalPowerPercent: 50, pedalPowerRightReference: true, cadenceRpm: 90, accumulatedPowerW: 0x1234, instantaneousPowerW: 200 });
    expect(leftBalanceFromPwr(decodePwrPage(h('10 0C B0 5A 34 12 C8 00')) as PwrStandardPowerOnly)).toBe(52);
    expect(leftBalanceFromPwr(decodePwrPage(h('10 0C 30 5A 34 12 C8 00')) as PwrStandardPowerOnly)).toBeUndefined();
    expect(toHex(encodePwrStandardPowerOnly({ eventCount: 12, rightPercent: 50, cadenceRpm: 90, accumulatedPowerW: 0x1234, powerW: 200 }))).toBe('10 0c b2 5a 34 12 c8 00');
  });

  it('puissance moyenne par puissance cumulée (débordement 16 bits)', () => {
    const c = new PwrPowerOnlyCalculator();
    const mk = (ev: number, acc: number): PwrStandardPowerOnly => ({ page: 0x10, updateEventCount: ev, pedalPowerRightReference: false, accumulatedPowerW: acc, instantaneousPowerW: 0 });
    c.update(mk(255, 65400));
    expect(c.update(mk(1, 264))).toBe(200); // 2 événements, 400 W cumulés
    expect(c.update(mk(1, 264))).toBeUndefined();
  });

  it('page 0x12 couple de manivelle → puissance et cadence', () => {
    const p = decodePwrPage(h('12 03 02 5A 00 0A 40 06')) as PwrCrankTorque;
    expect(p).toEqual({ page: 0x12, updateEventCount: 3, crankTicks: 2, cadenceRpm: 90, accumulatedPeriod: 2560, accumulatedTorque: 1600 });
    const c = new PwrCrankTorqueCalculator();
    const mk = (ev: number, per: number, tq: number): PwrCrankTorque => ({ page: 0x12, updateEventCount: ev, crankTicks: ev, accumulatedPeriod: per, accumulatedTorque: tq });
    c.update(mk(1, 65000, 65000));
    const r = c.update(mk(2, (65000 + 1365) % 65536, (65000 + 960) % 65536))!;
    expect(r.cadenceRpm).toBeCloseTo(90.02, 1);
    expect(r.powerW).toBeCloseTo(282.8, 1);
  });

  it('page 0x13 TE/PS (Assioma) : séparé, combiné, invalide', () => {
    expect(decodePwrPage(h('13 08 B4 B0 3C 40 FF FF'))).toEqual({ page: 0x13, updateEventCount: 8, teLeft: 90, teRight: 88, psLeft: 30, psRight: 32, psCombined: false });
    expect(decodePwrPage(h('13 08 B4 B0 3C FE FF FF'))).toEqual({ page: 0x13, updateEventCount: 8, teLeft: 90, teRight: 88, psLeft: 30, psCombined: true });
    expect(decodePwrPage(h('13 08 FF FF FF FF FF FF'))).toEqual({ page: 0x13, updateEventCount: 8, psCombined: false });
    expect(toHex(encodePwrTePs({ eventCount: 8, teLeft: 90, teRight: 88, psLeft: 30, psCombined: true }))).toBe('13 08 b4 b0 3c fe ff ff');
  });
});

describe('ANT+ HR', () => {
  it('page 0 et page 4 avec toggle → RR', () => {
    const p0 = decodeAntHeartRatePage(h('00 FF FF FF 00 04 05 48'));
    expect(p0).toEqual({ page: 0, toggle: false, heartBeatEventTime: 1024, heartBeatCount: 5, computedHeartRate: 72 });
    const p4 = decodeAntHeartRatePage(h('84 FF 00 08 00 0C 06 48'));
    expect(p4).toMatchObject({ page: 4, toggle: true, previousHeartBeatEventTime: 2048, heartBeatEventTime: 3072, heartBeatCount: 6 });
    const rr = new AntHeartRateRrCalculator();
    expect(rr.update(p0)).toEqual([]);
    expect(rr.update(p4)).toEqual([1000]);
  });
  it('pages 2, 3, 7', () => {
    expect(decodeAntHeartRatePage(h('02 01 34 12 00 04 05 48'))).toMatchObject({ manufacturerId: 1, serialNumberHigh: 0x1234 });
    expect(decodeAntHeartRatePage(h('03 02 05 07 00 04 05 48'))).toMatchObject({ hardwareVersion: 2, softwareVersion: 5, modelNumber: 7 });
    expect(decodeAntHeartRatePage(h('07 55 00 00 00 04 05 48'))).toMatchObject({ batteryPercent: 85 });
  });
});
