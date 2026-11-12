import { describe, expect, it } from 'vitest';
import { BOLLARD_FROM_CURB, BOLLARD_SPACING, placeBollards } from '../src/world/streetProps.ts';

// Bord droit d'une voie le long de z, de 0 à 30 m, trottoir de 2 m.
const along = [0, 10, 20, 30];
const base = { edge: along.flatMap((a) => [4.6, 0, a]), along, widths: [2, 2, 2, 2], ux: [1, 1, 1, 1], uz: [0, 0, 0, 0], sign: 1, crossings: [], lamps: [], wholeStreet: true };

describe('placeBollards', () => {
  it('aligne les potelets sur le trottoir, à distance fixe de la bordure', () => {
    const b = placeBollards(base);
    expect(b.length).toBe(Math.floor((30 - 0.3 - BOLLARD_SPACING / 2) / BOLLARD_SPACING) + 1);
    for (const p of b) {
      expect(p.x).toBeCloseTo(4.6 + BOLLARD_FROM_CURB);
      expect(p.y).toBeCloseTo(0.12);
    }
  });

  it('seulement près des passages piétons hors des rues bordées', () => {
    const b = placeBollards({ ...base, wholeStreet: false, crossings: [{ a0: 20, a1: 23 }] });
    expect(b.length).toBeGreaterThan(0);
    for (const p of b) expect(p.z).toBeGreaterThanOrEqual(14);
  });

  it('pas de potelet sans trottoir ni au pied d un lampadaire', () => {
    expect(placeBollards({ ...base, widths: [0, 0, 0, 0] }).length).toBe(0);
    const lamp = { x: 4.95, y: 0.12, z: 15 };
    for (const p of placeBollards({ ...base, lamps: [lamp] })) expect(Math.hypot(p.x - lamp.x, p.z - lamp.z)).toBeGreaterThanOrEqual(1.1);
  });
});
