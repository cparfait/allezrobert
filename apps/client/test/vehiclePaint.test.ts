import { describe, expect, it } from 'vitest';
import { paintsOf, pickPaint } from '../src/world/vehiclePaint.ts';

const MODELS = ['citadine', 'berline', 'suv', 'porsche-911', 'nissan-silvia', 'bmw-733i', 'mercedes-c230', 'lamborghini-aventador', 'mclaren-720s', 'utilitaire'];

describe('peinture des véhicules', () => {
  it('plusieurs teintes par modèle, toutes distinctes', () => {
    for (const m of MODELS) {
      const p = paintsOf(m);
      expect(p.length).toBeGreaterThanOrEqual(4);
      expect(new Set(p).size).toBe(p.length);
    }
  });

  it('toutes les teintes sortent, et jamais une déjà prise tant qu’il en reste', () => {
    let k = 0;
    const rand = () => ((k += 0.017) % 1);
    for (const m of MODELS) {
      expect(new Set(Array.from({ length: 400 }, () => pickPaint(m, rand))).size).toBe(paintsOf(m).length);
      const all = paintsOf(m);
      const taken = new Set(all.slice(1));
      expect(pickPaint(m, rand, taken)).toBe(all[0]);
      expect(all).toContain(pickPaint(m, rand, new Set(all)));
    }
  });
});
