import { describe, expect, it } from 'vitest';
import type { GableVisualCorrection } from '@allezrobert/shared/building-visual';
import { gableRoof, gableSurface, ridgeCrossings } from '../src/world/gableRoof.ts';

const provenance = { dataset: 'fixture', reference: 'pignon', observedOn: '2000-01-01', method: 'profil synthétique' };
/** Emprise et mesures du bâtiment 49 du Roussel (tuile Limagne -1_-1, LiDAR HD 2022). */
const pts49 = [-76.3, -659.8, -63.7, -663.4, -65.2, -669.2, -67.3, -670.2, -77.8, -667.8, -77.4, -665.9];
const c49: GableVisualCorrection = {
  buildingId: 'bdtopo:BATIMENT0000000310275523', kind: 'gable', ridgeM: 365.07, ridge: [-0.63, -2.42, 12.06, -5.7],
  pitchLeftDeg: 17.27, pitchRightDeg: 17.56, confidence: 'high', provenance,
};

describe('toit à faîtage libre (v2)', () => {
  it('place le faîtage à ridgeM et des pentes inégales de part et d’autre', () => {
    const square = [0, 0, 10, 0, 10, 6, 0, 6];
    const c: GableVisualCorrection = { ...c49, ridgeM: 10, ridge: [0, 2, 10, 2], pitchLeftDeg: 45, pitchRightDeg: 30 };
    const { at } = gableSurface(square, c);
    expect(at(5, 2)).toBeCloseTo(10, 9);
    // Gauche en allant vers l'est = nord (z plus petit).
    expect(at(5, 0)).toBeCloseTo(10 - 2, 9);
    expect(at(5, 6)).toBeCloseTo(10 - 4 * Math.tan(Math.PI / 6), 9);
  });

  it('suit une translation de l’emprise (monde composite)', () => {
    const shifted = pts49.map((v, i) => v + (i % 2 ? -250 : 1000));
    const a = gableSurface(pts49, c49).at(-70, -665);
    const b = gableSurface(shifted, c49).at(930, -915);
    expect(b).toBeCloseTo(a, 9);
  });

  it('reproduit les égouts mesurés du 49 et ne laisse aucun trou sous le faîtage', () => {
    const g = gableRoof(pts49, c49, 0.4)!;
    expect(g).not.toBeNull();
    // Égouts déduits sur les angles : nord ≈ 363,3, sud ≈ 364,3 à 364,4 (mesures ZONES-BAT-2b).
    expect(g.eaveMin).toBeGreaterThan(363.1);
    expect(g.eaveMin).toBeLessThan(363.5);
    const ys = g.roof.pos.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(365.07, 6);
    // Débord : le pan descend sous l'égout du mur.
    expect(Math.min(...ys)).toBeLessThan(g.eaveMin);
    // Normales vers le haut.
    for (let i = 0; i < g.roof.pos.length; i += 9) {
      const p = g.roof.pos;
      const ny = (p[i + 5]! - p[i + 2]!) * (p[i + 6]! - p[i]!) - (p[i + 3]! - p[i]!) * (p[i + 8]! - p[i + 2]!);
      expect(ny).toBeGreaterThan(0);
    }
    // Deux murs pignons coupés par le faîtage, chacun avec son triangle qui monte au faîtage.
    expect(g.gables.pos.length / 9).toBe(2);
    for (let i = 4; i < g.gables.pos.length; i += 9) expect(g.gables.pos[i]).toBeCloseTo(365.07, 6);
  });

  it('couvre l’emprise et la déborde du débord demandé', () => {
    const g = gableRoof([0, 0, 10, 0, 10, 6, 0, 6], { ...c49, ridgeM: 10, ridge: [0, 3, 10, 3], pitchLeftDeg: 20, pitchRightDeg: 20 }, 0.5)!;
    const xs = g.roof.pos.filter((_, i) => i % 3 === 0);
    const zs = g.roof.pos.filter((_, i) => i % 3 === 2);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([-0.5, 10.5, -0.5, 6.5]);
  });

  it('refuse un faîtage qui coupe le contour plus de deux fois (le toit historique est conservé)', () => {
    const u = [0, 0, 10, 0, 10, 10, 7, 10, 7, 3, 3, 3, 3, 10, 0, 10];
    const c = { ...c49, ridgeM: 10, ridge: [0, 6, 10, 6] as [number, number, number, number] };
    const { side } = gableSurface(u, c);
    expect(ridgeCrossings([[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10]], side)).toBe(4);
    expect(gableRoof(u, c, 0.4)).toBeNull();
  });

  it('accepte le léger rentrant de l’emprise du 49 et couvre toute sa surface', () => {
    const g = gableRoof(pts49, c49, 0)!;
    let a = 0;
    for (let i = 0; i < g.roof.pos.length; i += 9) {
      const p = g.roof.pos;
      a += Math.abs((p[i + 3]! - p[i]!) * (p[i + 8]! - p[i + 2]!) - (p[i + 5]! - p[i + 2]!) * (p[i + 6]! - p[i]!)) / 2;
    }
    expect(a).toBeCloseTo(98.285, 2);
  });
});
