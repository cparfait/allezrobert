/**
 * Roubaix Sport 2020, tailles modélisées (roubaixMetric.ts, étape I-3 du fil T2c).
 *
 * 1. Contrat métrique de chaque taille : complet et cohérent selon validateMetricBike (0 champ requis absent, 0 invalide).
 * 2. Roues posées au sol : axes à la hauteur du rayon, boîtier à groundOffsetMm.
 * 3. Disques et réglage de selle cohérents avec le contrat (plans, axe unitaire montant).
 * 4. Choix de la taille d'après la taille du coureur (guide Specialized, trous et chevauchements).
 */
import { describe, expect, it } from 'vitest';
import { validateMetricBike } from '../src/bikeMetric.ts';
import { ROUBAIX_44, ROUBAIX_54, ROUBAIX_MODEL_ID, ROUBAIX_SIZE_GUIDE, ROUBAIX_SIZES, roubaixSizeFor } from '../src/roubaixMetric.ts';

describe('Roubaix : contrat de chaque taille', () => {
  for (const spec of ROUBAIX_SIZES) {
    it(`${spec.size} : contrat complet et valide`, () => {
      const v = validateMetricBike(spec.metric);
      expect(v.missingRequired).toEqual([]);
      expect(v.invalid).toEqual([]);
      expect(spec.metric.id).toEqual({ modelId: ROUBAIX_MODEL_ID, size: spec.size });
    });

    it(`${spec.size} : roues au sol, boîtier à groundOffsetMm`, () => {
      const { axes, dimensions } = spec.metric;
      expect(Math.abs((axes.frontWheel?.originM[1] ?? 0) - (dimensions.frontWheelRadiusM ?? 0))).toBeLessThan(0.0005);
      expect(Math.abs((axes.rearWheel?.originM[1] ?? 0) - (dimensions.rearWheelRadiusM ?? 0))).toBeLessThan(0.0005);
      expect(axes.bottomBracket?.originM[1]).toBeCloseTo(spec.groundOffsetMm / 1000, 4);
      expect(spec.liveryFrameOffsetM[1]).toBeCloseTo(0.27 - spec.groundOffsetMm / 1000, 5);
    });

    it(`${spec.size} : disques et tige cohérents`, () => {
      const { rotors, axes } = spec.metric;
      expect(rotors?.front?.centerM[0]).toBeCloseTo(spec.rotors.front.planeXMm / 1000, 6);
      expect(rotors?.rear?.centerM[0]).toBeCloseTo(spec.rotors.rear.planeXMm / 1000, 6);
      expect(rotors?.front?.centerM.slice(1)).toEqual(axes.frontWheel?.originM.slice(1));
      expect(rotors?.rear?.centerM.slice(1)).toEqual(axes.rearWheel?.originM.slice(1));
      const d = spec.seatpost.directionUp;
      expect(Math.hypot(...d)).toBeCloseTo(1, 5);
      expect(d[1]).toBeGreaterThan(0.9); // tige quasi verticale, montante
      expect(spec.seatpost.maxDropMm).toBeGreaterThan(0);
      expect(spec.lods).toHaveLength(3);
    });
  }

  it('44 : cotes officielles du cockpit (potence 70, cintre 360) et manivelle 165', () => {
    const d = ROUBAIX_44.metric.dimensions;
    expect(d.stemLengthM).toBeCloseTo(0.07, 2);
    expect(d.handlebarWidthM).toBeCloseTo(0.36, 2);
    expect(d.crankLengthM).toBe(0.165);
  });
  it('54 : cotes officielles du cockpit (potence 100, cintre 420) et manivelle 172,5', () => {
    const d = ROUBAIX_54.metric.dimensions;
    expect(d.stemLengthM).toBeCloseTo(0.1, 2);
    expect(d.handlebarWidthM).toBeCloseTo(0.42, 2);
    expect(d.crankLengthM).toBe(0.1725);
  });
});

describe('Roubaix : taille de cadre selon la taille du coureur', () => {
  const all = ROUBAIX_SIZE_GUIDE.map((b) => b.size);
  it('tranche contenant la taille', () => {
    expect(roubaixSizeFor(147, all)).toBe('44');
    expect(roubaixSizeFor(160, all)).toBe('49');
    expect(roubaixSizeFor(190, all)).toBe('61');
  });
  it('trou du guide (152–155) : tranche la plus proche', () => {
    expect(roubaixSizeFor(153, all)).toBe('44');
    expect(roubaixSizeFor(154.5, all)).toBe('49');
  });
  it('chevauchement (54 : 170–178, 56 : 175–180) : milieu de tranche le plus proche', () => {
    expect(roubaixSizeFor(175.5, all)).toBe('54'); // milieux 174 et 177,5

    expect(roubaixSizeFor(177, all)).toBe('56');
  });
  it('seulement parmi les tailles disponibles (aujourd’hui 44 et 54)', () => {
    expect(roubaixSizeFor(185)).toBe('54');
    expect(roubaixSizeFor(160)).toBe('44');
    expect(roubaixSizeFor(161)).toBe('54');
    expect(roubaixSizeFor(185, [])).toBeNull();
  });
});
