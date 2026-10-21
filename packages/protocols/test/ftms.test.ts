import { describe, expect, it } from 'vitest';
import {
  FTMS_OPCODE,
  encodeControlPointResponse,
  encodeIndoorBikeData,
  encodeRequestControl,
  encodeReset,
  encodeSetIndoorBikeSimulation,
  encodeSetTargetPower,
  encodeSetTargetResistanceLevel,
  encodeSetWheelCircumference,
  encodeSpinDownControl,
  encodeStartOrResume,
  encodeStopOrPause,
  fromHex,
  parseControlPointRequest,
  parseControlPointResponse,
  parseFitnessMachineFeature,
  parseFitnessMachineStatus,
  parseIndoorBikeData,
  parseSupportedPowerRange,
  parseSupportedResistanceLevelRange,
  parseTrainingStatus,
  toHex,
  ProtocolError,
} from '../src/index.ts';

const h = fromHex;

describe('FTMS Indoor Bike Data 0x2AD2 (§4.9)', () => {
  it('décode vitesse + cadence + puissance (flags 0x0044)', () => {
    const d = parseIndoorBikeData(h('44 00 8C 0A B4 00 FA 00'));
    expect(d.moreData).toBe(false);
    expect(d.instantaneousSpeedKmh).toBe(27);
    expect(d.instantaneousCadenceRpm).toBe(90);
    expect(d.instantaneousPowerW).toBe(250);
    expect(d.averageSpeedKmh).toBeUndefined();
  });

  it('décode tous les champs (flags 0x1FFE)', () => {
    const bytes = h('FE 1F B8 0B C4 09 AA 00 A0 00 39 30 00 FB FF 2C 01 C8 00 96 00 58 02 0A 8C 55 10 0E 3C 00');
    const d = parseIndoorBikeData(bytes);
    expect(d).toEqual({
      flags: 0x1ffe,
      moreData: false,
      instantaneousSpeedKmh: 30,
      averageSpeedKmh: 25,
      instantaneousCadenceRpm: 85,
      averageCadenceRpm: 80,
      totalDistanceM: 12345,
      resistanceLevel: -5,
      instantaneousPowerW: 300,
      averagePowerW: 200,
      totalEnergyKcal: 150,
      energyPerHourKcal: 600,
      energyPerMinuteKcal: 10,
      heartRateBpm: 140,
      metabolicEquivalent: 8.5,
      elapsedTimeS: 3600,
      remainingTimeS: 60,
    });
    // l'encodeur symétrique redonne exactement les mêmes octets
    const { flags: _f, moreData: _m, ...fields } = d;
    expect(toHex(encodeIndoorBikeData(fields))).toBe(toHex(bytes));
  });

  it('bit 0 « More Data » : vitesse absente', () => {
    const d = parseIndoorBikeData(h('41 00 FA 00'));
    expect(d.moreData).toBe(true);
    expect(d.instantaneousSpeedKmh).toBeUndefined();
    expect(d.instantaneousPowerW).toBe(250);
  });

  it('énergie « non disponible » (0xFFFF/0xFF) ignorée', () => {
    const d = parseIndoorBikeData(h('00 01 00 00 FF FF FF FF FF'));
    expect(d.totalEnergyKcal).toBeUndefined();
    expect(d.energyPerMinuteKcal).toBeUndefined();
  });

  it('lève ProtocolError sur une trame tronquée', () => {
    expect(() => parseIndoorBikeData(h('44 00 8C 0A B4'))).toThrow(ProtocolError);
  });
});

describe('FTMS Feature 0x2ACC et plages 0x2AD6 / 0x2AD8', () => {
  it('décode les deux champs de bits', () => {
    const f = parseFitnessMachineFeature(h('02 44 00 00 0C E0 00 00'));
    expect(f.featuresRaw).toBe(0x4402);
    expect(f.features.cadence).toBe(true);
    expect(f.features.heartRateMeasurement).toBe(true);
    expect(f.features.powerMeasurement).toBe(true);
    expect(f.features.inclination).toBe(false);
    expect(f.targetSettings.resistanceTarget).toBe(true);
    expect(f.targetSettings.powerTarget).toBe(true);
    expect(f.targetSettings.indoorBikeSimulation).toBe(true);
    expect(f.targetSettings.wheelCircumference).toBe(true);
    expect(f.targetSettings.spinDownControl).toBe(true);
    expect(f.targetSettings.speedTarget).toBe(false);
  });

  it('plage de puissance 0–2000 W par pas de 1', () => {
    expect(parseSupportedPowerRange(h('00 00 D0 07 01 00'))).toEqual({ min: 0, max: 2000, increment: 1 });
  });

  it('plage de résistance (résolution 0,1)', () => {
    expect(parseSupportedResistanceLevelRange(h('00 00 E8 03 0A 00'))).toEqual({ min: 0, max: 100, increment: 1 });
  });
});

describe('FTMS Training Status 0x2AD3 (§4.10)', () => {
  it('statut seul', () => {
    expect(parseTrainingStatus(h('00 01'))).toEqual({ status: 1, statusName: 'idle', extendedString: false });
  });
  it('statut + chaîne', () => {
    const s = parseTrainingStatus(h('01 0D 51 75 69 63 6B'));
    expect(s.statusName).toBe('manualMode');
    expect(s.statusString).toBe('Quick');
  });
});

describe('FTMS Fitness Machine Status 0x2ADA (§4.17)', () => {
  it('puissance cible modifiée', () => {
    expect(parseFitnessMachineStatus(h('08 C8 00'))).toEqual({ opCode: 8, kind: 'targetPowerChanged', watts: 200 });
  });
  it('paramètres de simulation modifiés', () => {
    expect(parseFitnessMachineStatus(h('12 E8 03 F4 01 28 33'))).toEqual({
      opCode: 0x12,
      kind: 'indoorBikeSimulationParametersChanged',
      windSpeedMs: 1,
      gradePercent: 5,
      crr: 0.004,
      cw: 0.51,
    });
  });
  it('perte de contrôle, spin down, pause', () => {
    expect(parseFitnessMachineStatus(h('FF')).kind).toBe('controlPermissionLost');
    expect(parseFitnessMachineStatus(h('14 02'))).toMatchObject({ kind: 'spinDownStatus', status: 'success' });
    expect(parseFitnessMachineStatus(h('02 02'))).toMatchObject({ kind: 'stoppedOrPausedByUser', stopped: false });
    expect(parseFitnessMachineStatus(h('07 32'))).toMatchObject({ kind: 'targetResistanceLevelChanged', level: 5 });
  });
});

describe('FTMS Control Point 0x2AD9 (§4.16)', () => {
  it('encode les op codes', () => {
    expect(toHex(encodeRequestControl())).toBe('00');
    expect(toHex(encodeReset())).toBe('01');
    expect(toHex(encodeSetTargetResistanceLevel(5))).toBe('04 32');
    expect(toHex(encodeSetTargetPower(250))).toBe('05 fa 00');
    expect(toHex(encodeStartOrResume())).toBe('07');
    expect(toHex(encodeStopOrPause('stop'))).toBe('08 01');
    expect(toHex(encodeStopOrPause('pause'))).toBe('08 02');
    expect(toHex(encodeSetWheelCircumference(2105))).toBe('12 3a 52');
    expect(toHex(encodeSpinDownControl('start'))).toBe('13 01');
    expect(toHex(encodeSpinDownControl('ignore'))).toBe('13 02');
  });

  it('Set Indoor Bike Simulation : vent ×0,001, pente ×0,01, crr ×0,0001, cw ×0,01', () => {
    expect(toHex(encodeSetIndoorBikeSimulation({ gradePercent: 5.5 }))).toBe('11 00 00 26 02 28 33');
    expect(toHex(encodeSetIndoorBikeSimulation({ gradePercent: -3.25, windSpeedMs: -2.5, crr: 0.005, cw: 0.4 }))).toBe('11 3c f6 bb fe 32 28');
  });

  it('borne les valeurs aux types (sint16)', () => {
    expect(toHex(encodeSetIndoorBikeSimulation({ gradePercent: 400 }))).toBe('11 00 00 ff 7f 28 33');
    expect(toHex(encodeSetTargetPower(-10))).toBe('05 f6 ff');
  });

  it('décode les réponses 0x80', () => {
    expect(parseControlPointResponse(h('80 05 01'))).toMatchObject({ requestOpCode: 5, result: 1, resultName: 'success' });
    expect(parseControlPointResponse(h('80 00 05'))).toMatchObject({ requestOpCode: 0, resultName: 'controlNotPermitted' });
    const sd = parseControlPointResponse(h('80 13 01 D0 07 B8 0B'));
    expect(sd.spinDown).toEqual({ targetSpeedLowKmh: 20, targetSpeedHighKmh: 30 });
    expect(() => parseControlPointResponse(h('05 01'))).toThrow(ProtocolError);
    expect(toHex(encodeControlPointResponse(FTMS_OPCODE.setTargetPower, 1))).toBe('80 05 01');
  });

  it('décode les requêtes (côté simulateur)', () => {
    expect(parseControlPointRequest(h('11 3c f6 bb fe 32 28'))).toEqual({
      opCode: 0x11,
      kind: 'setIndoorBikeSimulation',
      windSpeedMs: -2.5,
      gradePercent: -3.25,
      crr: 0.005,
      cw: 0.4,
    });
    expect(parseControlPointRequest(h('05 fa 00'))).toEqual({ opCode: 5, kind: 'setTargetPower', watts: 250 });
    expect(parseControlPointRequest(h('42 01')).kind).toBe('unknown');
  });
});
