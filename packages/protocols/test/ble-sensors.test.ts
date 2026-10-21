import { describe, expect, it } from 'vitest';
import {
  CrankCadenceCalculator,
  WheelSpeedCalculator,
  bytesToUuid,
  encodeCscMeasurement,
  encodeCyclingPowerMeasurement,
  encodeHeartRateMeasurement,
  fromHex,
  leftBalanceFromCps,
  normalizeUuid,
  parseBatteryLevel,
  parseCscFeature,
  parseCscMeasurement,
  parseCyclingPowerFeature,
  parseCyclingPowerMeasurement,
  parseCyclingPowerVector,
  parseDeviceInformationString,
  parseHeartRateMeasurement,
  shortUuid,
  toHex,
  uuidToBytes,
  deviceInformationFieldFor,
  CHAR,
} from '../src/index.ts';

const h = fromHex;

describe('UUID', () => {
  it('normalise les formes courtes et longues', () => {
    expect(normalizeUuid('2AD2')).toBe('00002ad2-0000-1000-8000-00805f9b34fb');
    expect(normalizeUuid(0x1826)).toBe('00001826-0000-1000-8000-00805f9b34fb');
    expect(normalizeUuid('A026EE0C-0A7D-4AB3-97FA-F1500F9FEB8B')).toBe('a026ee0c-0a7d-4ab3-97fa-f1500f9feb8b');
    expect(shortUuid('00002ad2-0000-1000-8000-00805f9b34fb')).toBe(0x2ad2);
    expect(shortUuid('a026ee0c-0a7d-4ab3-97fa-f1500f9feb8b')).toBeUndefined();
  });
  it('UUID ↔ 16 octets (ordre de la chaîne)', () => {
    expect(toHex(uuidToBytes(0x2ad2))).toBe('00 00 2a d2 00 00 10 00 80 00 00 80 5f 9b 34 fb');
    expect(bytesToUuid(uuidToBytes('a026e038-0a7d-4ab3-97fa-f1500f9feb8b'))).toBe('a026e038-0a7d-4ab3-97fa-f1500f9feb8b');
  });
});

describe('Cycling Power Measurement 0x2A63 (GSS §3.59)', () => {
  it('trame type Assioma : balance (réf. gauche) + manivelle', () => {
    const m = parseCyclingPowerMeasurement(h('23 00 C8 00 62 0A 00 00 10'));
    expect(m.instantaneousPowerW).toBe(200);
    expect(m.pedalPowerBalancePercent).toBe(49);
    expect(m.pedalPowerBalanceReference).toBe('left');
    expect(leftBalanceFromCps(m)).toBe(49);
    expect(m.cumulativeCrankRevolutions).toBe(10);
    expect(m.lastCrankEventTime).toBe(0x1000);
  });

  it('référence inconnue : pas de balance gauche affirmée', () => {
    const m = parseCyclingPowerMeasurement(h('21 00 C8 00 62 0A 00 00 10'));
    expect(m.pedalPowerBalanceReference).toBe('unknown');
    expect(leftBalanceFromCps(m)).toBeUndefined();
  });

  it('tous les champs (flags 0x1FFF)', () => {
    const bytes = h('FF 1F 2C 01 66 40 06 34 12 00 00 00 08 64 00 00 04 F4 01 9C FF 40 06 C0 FE B4 A0 05 0F 00 C3 00 2A 00');
    const m = parseCyclingPowerMeasurement(bytes);
    expect(m).toEqual({
      flags: 0x1fff,
      instantaneousPowerW: 300,
      balanceReferenceLeftFlag: true,
      offsetCompensationIndicator: true,
      pedalPowerBalancePercent: 51,
      pedalPowerBalanceReference: 'left',
      accumulatedTorqueNm: 50,
      accumulatedTorqueSource: 'crank',
      cumulativeWheelRevolutions: 0x1234,
      lastWheelEventTime: 2048,
      cumulativeCrankRevolutions: 100,
      lastCrankEventTime: 1024,
      maximumForceN: 500,
      minimumForceN: -100,
      maximumTorqueNm: 50,
      minimumTorqueNm: -10,
      maximumAngleDeg: 180,
      minimumAngleDeg: 90,
      topDeadSpotAngleDeg: 15,
      bottomDeadSpotAngleDeg: 195,
      accumulatedEnergyKj: 42,
    });
    const reencoded = encodeCyclingPowerMeasurement({
      instantaneousPowerW: 300,
      pedalPowerBalancePercent: 51,
      balanceReferenceLeft: true,
      accumulatedTorqueNm: 50,
      accumulatedTorqueSource: 'crank',
      cumulativeWheelRevolutions: 0x1234,
      lastWheelEventTime: 2048,
      cumulativeCrankRevolutions: 100,
      lastCrankEventTime: 1024,
      maximumForceN: 500,
      minimumForceN: -100,
      maximumTorqueNm: 50,
      minimumTorqueNm: -10,
      maximumAngleDeg: 180,
      minimumAngleDeg: 90,
      topDeadSpotAngleDeg: 15,
      bottomDeadSpotAngleDeg: 195,
      accumulatedEnergyKj: 42,
      offsetCompensationIndicator: true,
    });
    expect(toHex(reencoded)).toBe(toHex(bytes));
  });

  it('puissance négative (sint16)', () => {
    expect(parseCyclingPowerMeasurement(h('00 00 F6 FF')).instantaneousPowerW).toBe(-10);
  });
});

describe('Cycling Power Feature 0x2A65 et Vector 0x2A64', () => {
  it('feature : balance + manivelle + système distribué', () => {
    const f = parseCyclingPowerFeature(h('09 00 20 00'));
    expect(f.features.pedalPowerBalance).toBe(true);
    expect(f.features.crankRevolutionData).toBe(true);
    expect(f.features.wheelRevolutionData).toBe(false);
    expect(f.distributedSystemSupport).toBe('distributed');
  });
  it('vector : manivelle + angle + forces', () => {
    const v = parseCyclingPowerVector(h('17 0A 00 00 10 5A 00 64 00 C8 00 9C FF'));
    expect(v.cumulativeCrankRevolutions).toBe(10);
    expect(v.lastCrankEventTime).toBe(0x1000);
    expect(v.firstCrankMeasurementAngleDeg).toBe(90);
    expect(v.instantaneousForceMagnitudesN).toEqual([100, 200, -100]);
    expect(v.measurementDirection).toBe('tangential');
  });
});

describe('Calcul de cadence (1/1024 s, débordements)', () => {
  it('90 tr/min', () => {
    const c = new CrankCadenceCalculator();
    expect(c.update(10, 0, 0)).toBeUndefined();
    expect(c.update(11, 683, 667)).toBeCloseTo(89.96, 1);
  });
  it('débordement des compteurs uint16', () => {
    const c = new CrankCadenceCalculator();
    c.update(65535, 65000, 0);
    expect(c.update(1, (65000 + 1365) % 65536, 1333)).toBeCloseTo(90.02, 1);
  });
  it('retombe à 0 sans nouvel événement après 3 s', () => {
    const c = new CrankCadenceCalculator();
    c.update(10, 0, 0);
    c.update(11, 683, 700);
    expect(c.update(11, 683, 1500)).toBeCloseTo(89.96, 1);
    expect(c.update(11, 683, 4000)).toBe(0);
  });
  it('vitesse de roue CSC', () => {
    const s = new WheelSpeedCalculator(1024, 2.105);
    s.update(10, 0, 0);
    expect(s.update(14, 2048, 2000)).toBeCloseTo(15.156, 2);
    expect(s.distanceM).toBeCloseTo(8.42, 2);
  });
});

describe('Heart Rate Measurement 0x2A37', () => {
  it('uint8 + contact + RR', () => {
    expect(parseHeartRateMeasurement(h('16 48 00 04'))).toEqual({ flags: 0x16, bpm: 72, sensorContact: true, rrRaw: [1024], rrMs: [1000] });
  });
  it('uint16 + énergie', () => {
    const m = parseHeartRateMeasurement(h('09 B4 00 10 00'));
    expect(m.bpm).toBe(180);
    expect(m.energyExpendedKj).toBe(16);
    expect(m.sensorContact).toBeUndefined();
  });
  it('contact géré mais non détecté ; plusieurs RR', () => {
    expect(parseHeartRateMeasurement(h('04 50')).sensorContact).toBe(false);
    expect(parseHeartRateMeasurement(h('10 3C 00 04 33 03')).rrMs).toEqual([1000, 799.8]);
  });
  it('encodeur symétrique', () => {
    expect(toHex(encodeHeartRateMeasurement({ bpm: 72, sensorContact: true, rrMs: [1000] }))).toBe('16 48 00 04');
  });
});

describe('CSC Measurement 0x2A5B', () => {
  it('roue + manivelle', () => {
    const bytes = h('03 0A 00 00 00 00 04 05 00 00 08');
    expect(parseCscMeasurement(bytes)).toEqual({
      flags: 3,
      cumulativeWheelRevolutions: 10,
      lastWheelEventTime: 1024,
      cumulativeCrankRevolutions: 5,
      lastCrankEventTime: 2048,
    });
    expect(toHex(encodeCscMeasurement({ cumulativeWheelRevolutions: 10, lastWheelEventTime: 1024, cumulativeCrankRevolutions: 5, lastCrankEventTime: 2048 }))).toBe(toHex(bytes));
  });
  it('feature', () => {
    expect(parseCscFeature(h('03 00'))).toMatchObject({ wheelRevolutionData: true, crankRevolutionData: true, multipleSensorLocations: false });
  });
});

describe('Batterie et Device Information', () => {
  it('niveau de batterie', () => {
    expect(parseBatteryLevel(h('5F'))).toBe(95);
    expect(() => parseBatteryLevel(h('C8'))).toThrow();
  });
  it('chaînes DIS terminées par des zéros', () => {
    expect(parseDeviceInformationString(h('4B 49 43 4B 52 20 43 4F 52 45 00 00'))).toBe('KICKR CORE');
    expect(deviceInformationFieldFor(CHAR.firmwareRevision)).toBe('firmware');
    expect(deviceInformationFieldFor('2a29')).toBe('manufacturer');
  });
});
