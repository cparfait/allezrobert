/**
 * LOOK 785 Huez RS dédié (look785Metric.ts) : contrat de chaque taille, cotes LOOK, choix de la taille selon le coureur.
 */
import { describe, expect, it } from 'vitest';
import { validateMetricBike } from '../src/bikeMetric.ts';
import { LOOK785_L, LOOK785_M, LOOK785_MODEL_ID, LOOK785_SIZE_GUIDE, LOOK785_SIZES, LOOK785_XS } from '../src/look785Metric.ts';
import { roubaixSizeFor, type RoubaixSizeSpec } from '../src/roubaixMetric.ts';

/** Cotes LOOK (génération disque 2019–2023) : stack, reach, angle de douille, manivelle, cintre, potence (cockpit du Roubaix). */
const COTES = { XS: [510, 365, 71.8, 0.17, 0.36, 0.07], M: [558, 385, 73, 0.1725, 0.42, 0.1], L: [582, 395, 73, 0.1725, 0.42, 0.1] } as const;

describe('LOOK 785 : contrat de chaque taille', () => {
  for (const spec of LOOK785_SIZES) {
    const [stack, reach, ha, crank, bar, stem] = COTES[spec.size as keyof typeof COTES];
    it(`${spec.size} : contrat complet et valide, modèle du catalogue`, () => {
      const v = validateMetricBike(spec.metric);
      expect(v.missingRequired).toEqual([]);
      expect(v.invalid).toEqual([]);
      expect(spec.metric.id).toEqual({ modelId: LOOK785_MODEL_ID, size: spec.size });
      expect(spec.dir).toBe('look785');
    });
    it(`${spec.size} : roues au sol, boîtier à groundOffsetMm, livrée recalée`, () => {
      const { axes, dimensions } = spec.metric;
      expect(Math.abs((axes.frontWheel?.originM[1] ?? 0) - (dimensions.frontWheelRadiusM ?? 0))).toBeLessThan(0.0005);
      expect(Math.abs((axes.rearWheel?.originM[1] ?? 0) - (dimensions.rearWheelRadiusM ?? 0))).toBeLessThan(0.0005);
      expect(axes.bottomBracket?.originM[1]).toBeCloseTo(spec.groundOffsetMm / 1000, 4);
      expect(spec.liveryFrameOffsetM[1]).toBeCloseTo(0.27 - spec.groundOffsetMm / 1000, 5);
    });
    it(`${spec.size} : stack ${stack}, reach ${reach}, douille ${ha}°, manivelle, cockpit`, () => {
      const { axes, dimensions } = spec.metric;
      const bb = axes.bottomBracket?.originM ?? [0, 0, 0];
      const st = axes.steering?.originM ?? [0, 0, 0];
      const d = axes.steering?.direction ?? [0, 0, 0];
      expect((st[1] - bb[1]) * 1000).toBeCloseTo(stack, 1);
      expect((st[2] - bb[2]) * 1000).toBeCloseTo(reach, 1);
      expect((Math.atan2(d[1], -d[2]) * 180) / Math.PI).toBeCloseTo(ha, 3);
      expect(dimensions.crankLengthM).toBe(crank);
      expect(dimensions.handlebarWidthM).toBeCloseTo(bar, 2);
      expect(dimensions.stemLengthM).toBeCloseTo(stem, 2);
    });
    it(`${spec.size} : disques et tige cohérents`, () => {
      const { rotors, axes } = spec.metric;
      expect(rotors?.front?.centerM[0]).toBeCloseTo(spec.rotors.front.planeXMm / 1000, 6);
      expect(rotors?.rear?.centerM[0]).toBeCloseTo(spec.rotors.rear.planeXMm / 1000, 6);
      expect(rotors?.front?.centerM.slice(1)).toEqual(axes.frontWheel?.originM.slice(1));
      expect(rotors?.rear?.centerM.slice(1)).toEqual(axes.rearWheel?.originM.slice(1));
      expect(Math.hypot(...spec.seatpost.directionUp)).toBeCloseTo(1, 5);
      expect(spec.seatpost.maxDropMm).toBeGreaterThan(0);
      expect(spec.seatpost.minDropMm ?? 0).toBeLessThan(0);
      expect(spec.lods).toHaveLength(3);
    });
  }
  it('tailles croissantes : empattement et selle par défaut', () => {
    const wb = (s: RoubaixSizeSpec) => (s.metric.axes.frontWheel?.originM[2] ?? 0) - (s.metric.axes.rearWheel?.originM[2] ?? 0);
    const seat = (s: RoubaixSizeSpec) => s.metric.contacts.saddle?.originM[1] ?? 0;
    expect(wb(LOOK785_XS)).toBeLessThan(wb(LOOK785_M));
    expect(wb(LOOK785_M)).toBeLessThan(wb(LOOK785_L));
    expect(seat(LOOK785_XS)).toBeLessThan(seat(LOOK785_M));
    expect(seat(LOOK785_M)).toBeLessThan(seat(LOOK785_L));
  });
});

describe('LOOK 785 : taille de cadre selon la taille du coureur', () => {
  const dispo = LOOK785_SIZES.map((s) => s.size);
  it('guide complet : tranches et chevauchements', () => {
    const all = LOOK785_SIZE_GUIDE.map((b) => b.size);
    expect(roubaixSizeFor(160, all, LOOK785_SIZE_GUIDE)).toBe('XS');
    expect(roubaixSizeFor(170, all, LOOK785_SIZE_GUIDE)).toBe('S');
    expect(roubaixSizeFor(176, all, LOOK785_SIZE_GUIDE)).toBe('M');
    expect(roubaixSizeFor(183, all, LOOK785_SIZE_GUIDE)).toBe('L');
    expect(roubaixSizeFor(192, all, LOOK785_SIZE_GUIDE)).toBe('XL');
  });
  it('tailles modélisées (XS, M, L)', () => {
    expect(roubaixSizeFor(142, dispo, LOOK785_SIZE_GUIDE)).toBe('XS');
    expect(roubaixSizeFor(168, dispo, LOOK785_SIZE_GUIDE)).toBe('XS');
    expect(roubaixSizeFor(169, dispo, LOOK785_SIZE_GUIDE)).toBe('M');
    expect(roubaixSizeFor(179, dispo, LOOK785_SIZE_GUIDE)).toBe('M');
    expect(roubaixSizeFor(181, dispo, LOOK785_SIZE_GUIDE)).toBe('L');
    expect(roubaixSizeFor(200, dispo, LOOK785_SIZE_GUIDE)).toBe('L');
  });
});
