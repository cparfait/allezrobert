import { describe, expect, it } from 'vitest';
import { mirroredPairMm } from '../src/bikeGeometry.ts';
import {
  bikePointToManufacturerMm, bikePointToRigM, inverseTransformDirection, inverseTransformPointM,
  isRigidTransformM, manufacturerPointToBikeM, mmToM, mToMm, rigPointToBikeM,
  transformDirection, transformPointM, validateMetricBike,
  type MetricBikeDraft, type MetricContact, type RigidTransformM,
} from '../src/bikeMetric.ts';
import type { BikePoint } from '../src/bikeReference.ts';

const upright = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as const;
const contact = (originM: BikePoint): MetricContact => ({ originM, basis: upright });
const transverse = (originM: BikePoint) => ({ originM, direction: upright.x });
const rigid: RigidTransformM = {
  originM: [0.05, 0.4, -0.2],
  basis: { x: [0, 0, -1], y: [0, 1, 0], z: [1, 0, 0] },
};

// Vélo synthétique pour vérifier le contrat. Aucune cote ne provient d'un GLB Roubaix.
const fixture = {
  id: { modelId: 'fixture-route', size: 'M' },
  brakes: 'disc',
  axes: {
    bottomBracket: transverse([0, 0.28, 0]),
    steering: { originM: [0, 0.86, 0.37], direction: [0, 0.8, -0.6] },
    frontWheel: transverse([0, 0.34, 0.6]),
    rearWheel: transverse([0, 0.35, -0.41]),
    pedalL: transverse([0.072, 0.11, 0]),
    pedalR: transverse([-0.072, 0.45, 0]),
  },
  dimensions: {
    frontWheelRadiusM: 0.34,
    rearWheelRadiusM: 0.35,
    crankLengthM: 0.17,
    handlebarWidthM: 0.42,
    stemLengthM: 0.1,
  },
  contacts: {
    saddle: contact([0, 0.97, -0.21]),
    handL: contact([0.2, 0.92, 0.54]),
    handR: contact([-0.2, 0.92, 0.54]),
    pedalL: contact([0.09, 0.12, 0.01]),
    pedalR: contact([-0.09, 0.46, 0.01]),
  },
  rotors: {
    front: { centerM: [0.05, 0.34, 0.6], diameterM: 0.16 },
    rear: { centerM: [0.055, 0.35, -0.41], diameterM: 0.14 },
  },
} satisfies MetricBikeDraft;

describe('conversions métriques du vélo', () => {
  it('convertit les distances et déplace seulement l’origine verticale du fabricant', () => {
    expect(mmToM(172.5)).toBe(0.1725);
    expect(mToMm(mmToM(-76))).toBe(-76);
    expect(manufacturerPointToBikeM([0, 0, 0], 0.28)).toEqual([0, 0.28, 0]);
    expect(manufacturerPointToBikeM([0, -280, 0], 0.28)).toEqual([0, 0, 0]);
    const source = [-72, -150, 420] as const;
    const inBike = manufacturerPointToBikeM(source, 0.28);
    expect(inBike).toEqual([expect.closeTo(-0.072, 12), expect.closeTo(0.13, 12), 0.42]);
    expect(bikePointToManufacturerMm(inBike, 0.28)).toEqual(source.map((v) => expect.closeTo(v, 10)));
    expect(() => mmToM(Number.NaN)).toThrow(RangeError);
    expect(() => mToMm(Infinity)).toThrow(RangeError);
    expect(() => manufacturerPointToBikeM(source, 0)).toThrow(RangeError);
  });

  it('préserve la symétrie gauche/droite autour du plan x = 0', () => {
    const pair = mirroredPairMm([0, 640, 540], 200);
    const left = manufacturerPointToBikeM(pair.L, 0.28);
    const right = manufacturerPointToBikeM(pair.R, 0.28);
    expect(left[0]).toBeGreaterThan(0);
    expect(right).toEqual([-left[0], left[1], left[2]]);
  });

  it('convertit les points et directions dans les deux sens avec translation et rotation', () => {
    const source = [0.3, 0.1, -0.2] as const;
    const inBike = transformPointM(rigid, source);
    expect(inBike).toEqual([expect.closeTo(-0.15, 12), 0.5, -0.5]);
    expect(inverseTransformPointM(rigid, inBike)).toEqual(source.map((v) => expect.closeTo(v, 12)));
    expect(transformDirection(rigid, [0, 0, 1])).toEqual([1, 0, 0]);
    expect(inverseTransformDirection(rigid, [1, 0, 0])).toEqual([0, 0, 1]);
    expect(() => transformDirection(rigid, [0, 0, 2])).toThrow(RangeError);
  });

  it('garde les cibles et les dimensions du vélo fixes quand le facteur du rig change', () => {
    const original = structuredClone(fixture);
    const small = { rigToBike: rigid, bodyScale: 160 / 175 };
    const tall = { rigToBike: rigid, bodyScale: 195 / 175 };
    for (const target of [fixture.contacts.handL.originM, fixture.axes.pedalR.originM, fixture.contacts.saddle.originM]) {
      const inSmall = bikePointToRigM(small, target);
      const inTall = bikePointToRigM(tall, target);
      expect(inSmall).not.toEqual(inTall);
      for (const [rig, point] of [[small, inSmall], [tall, inTall]] as const) {
        expect(rigPointToBikeM(rig, point)).toEqual(target.map((v) => expect.closeTo(v, 12)));
      }
    }
    expect(fixture).toEqual(original);
    expect(() => bikePointToRigM({ ...small, bodyScale: -1 }, [0, 0, 0])).toThrow(RangeError);
    expect(() => rigPointToBikeM({ ...tall, bodyScale: Infinity }, [0, 0, 0])).toThrow(RangeError);
  });
});

describe('validation du montage métrique', () => {
  it('accepte un montage cohérent et distingue les prises facultatives', () => {
    expect(validateMetricBike(fixture)).toEqual({
      missingRequired: [],
      missingOptional: ['contacts.topsL', 'contacts.topsR', 'contacts.dropsL', 'contacts.dropsR', 'contacts.padL', 'contacts.padR'],
      invalid: [],
    });
    expect(validateMetricBike({
      ...fixture, contacts: { ...fixture.contacts, handR: contact([-0.19, 0.921, 0.54]) },
    }).invalid).toEqual([]);
  });

  it('signale les champs absents sans fabriquer d’ancres', () => {
    const draft: MetricBikeDraft = { id: fixture.id, brakes: 'disc', axes: {}, dimensions: {}, contacts: {} };
    const result = validateMetricBike(draft);
    expect(result.invalid).toEqual([]);
    expect(result.missingRequired).toEqual([
      'dimensions.frontWheelRadiusM', 'dimensions.rearWheelRadiusM', 'dimensions.crankLengthM',
      'dimensions.handlebarWidthM', 'dimensions.stemLengthM',
      'axes.bottomBracket', 'axes.steering', 'axes.frontWheel', 'axes.rearWheel', 'axes.pedalL', 'axes.pedalR',
      'contacts.saddle', 'contacts.handL', 'contacts.handR', 'contacts.pedalL', 'contacts.pedalR',
      'rotors.front', 'rotors.rear',
    ]);
    expect(draft.contacts).toEqual({});
    for (const brakes of ['rim', 'none'] as const) {
      expect(validateMetricBike({ ...fixture, brakes, rotors: {} }).missingRequired).toEqual([]);
    }
  });

  it('rejette les dimensions non finies ou non positives et un diamètre de disque impossible', () => {
    const result = validateMetricBike({
      ...fixture,
      dimensions: { ...fixture.dimensions, frontWheelRadiusM: -1, crankLengthM: Infinity, stemLengthM: 0, handlebarWidthM: Number.NaN },
      rotors: { ...fixture.rotors, rear: { ...fixture.rotors.rear, diameterM: 0.8 } },
    });
    expect(result.missingRequired).toEqual([]);
    expect(result.invalid.map(({ path }) => path)).toEqual([
      'dimensions.frontWheelRadiusM', 'dimensions.crankLengthM', 'dimensions.handlebarWidthM',
      'dimensions.stemLengthM', 'rotors.rear',
    ]);
    expect(() => validateMetricBike(fixture, -0.001)).toThrow(RangeError);
  });

  it('vérifie les axes, le signe des côtés, le sol et la phase zéro', () => {
    const result = validateMetricBike({
      ...fixture,
      axes: {
        ...fixture.axes,
        steering: { ...fixture.axes.steering, direction: [0, -1, 0] },
        frontWheel: { originM: [0, 0.34, -0.6], direction: [2, 0, 0] },
        rearWheel: transverse([0, 0.36, -0.41]),
        pedalL: transverse([-0.072, 0.45, 0]),
      },
      contacts: { ...fixture.contacts, handL: fixture.contacts.handR },
    });
    expect(result.invalid.map(({ path }) => path)).toEqual(expect.arrayContaining([
      'axes.steering', 'axes.frontWheel', 'axes.rearWheel', 'axes.pedalL', 'contacts.handL', 'rotors.front', 'rotors.rear',
    ]));
    expect(result.invalid.filter(({ path }) => path === 'axes.pedalL')).toHaveLength(2);
  });

  it('rejette les bases avec échelle, cisaillement, réflexion ou origine non finie', () => {
    const invalidFrames: RigidTransformM[] = [
      { ...rigid, basis: { ...upright, x: [2, 0, 0] } },
      { ...rigid, basis: { ...upright, y: [0.6, 0.8, 0] } },
      { ...rigid, basis: { ...upright, z: [0, 0, -1] } },
      { ...rigid, originM: [0, Number.NaN, 0] },
    ];
    expect(isRigidTransformM(rigid)).toBe(true);
    for (const saddle of invalidFrames) {
      expect(isRigidTransformM(saddle)).toBe(false);
      expect(() => transformPointM(saddle, [0, 0, 0])).toThrow(RangeError);
      expect(validateMetricBike({ ...fixture, contacts: { ...fixture.contacts, saddle } }).invalid)
        .toEqual([expect.objectContaining({ path: 'contacts.saddle' })]);
    }
  });
});
