import { describe, expect, it } from 'vitest';
import type { VolumesVisualCorrection } from '@allezrobert/shared/building-visual';
import { volumesGeometry } from '../src/world/volumesRoof.ts';

const provenance = { dataset: 'fixture', reference: 'volumes', observedOn: '2000-01-01', method: 'profil synthétique' };
/** Emprise et volumes mesurés du repère 28 du Roussel (tuile Limagne -1_-1, LiDAR HD 2022, ZONES-BAT-3a). */
const pts28 = [-155.1, -689.6, -148.8, -689.1, -148.5, -680.4, -140.3, -680.5, -140.2, -689.9, -146.5, -690.2, -146.9, -697.0, -149.3, -697.3, -149.2, -703.0, -155.2, -703.4];
const c28: VolumesVisualCorrection = {
  buildingId: 'bdtopo:BATIMENT0000000310275556', kind: 'volumes', confidence: 'high', provenance,
  parts: [
    { pts: [6.3, 0.5, 6.6, 9.2, 14.8, 9.1, 14.9, -0.3, 8.6, -0.6], roof: { type: 'gable', ridgeM: 367.62, ridge: [6.16, 4.04, 14.99, 4.4], pitchLeftDeg: 13.76, pitchRightDeg: 18.21 } },
    { pts: [0, 0, 6.3, 0.5, 8.6, -0.6, 8.2, -7.4, 5.8, -7.7, -0.06, -7.7], roof: { type: 'gable', ridgeM: 368.22, ridge: [4.08, 0.46, 4.25, -7.73], pitchLeftDeg: 13.25, pitchRightDeg: 10.51 } },
    { pts: [-0.06, -7.7, 5.8, -7.7, 5.9, -13.4, -0.1, -13.8], roof: { type: 'gable', ridgeM: 369.68, ridge: [-0.1, -10.04, 5.9, -10.04], pitchLeftDeg: 21.69, pitchRightDeg: 21.99 } },
  ],
};
const area = (tris: number[]) => {
  let a = 0;
  for (let i = 0; i < tris.length; i += 9) a += Math.abs((tris[i + 3]! - tris[i]!) * (tris[i + 8]! - tris[i + 2]!) - (tris[i + 5]! - tris[i + 2]!) * (tris[i + 6]! - tris[i]!)) / 2;
  return a;
};

/** Emprise et volumes du repère 54, découpés sur les plans de toit LiDAR (ZONES-BAT-4a) : 1 deux-pans, 4 monopentes. */
const pts54 = [-54.9, -672.8, -49.8, -672.6, -49.7, -680.3, -44.9, -680.2, -45.5, -683.2, -49.8, -683.0, -50.2, -687.9, -54.8, -687.7, -55.4, -694.0, -56.5, -694.1, -56.8, -698.1, -65.6, -697.9, -65.4, -693.6, -62.3, -693.6, -62.2, -689.9, -61.9, -684.6, -59.9, -684.6, -59.8, -679.3, -54.9, -679.1];
const c54: VolumesVisualCorrection = {
  buildingId: 'bdtopo:BATIMENT0000000310275567', kind: 'volumes', confidence: 'medium', provenance,
  parts: [
    { pts: [-4.92, -6.58, -4.92, -11.77, 0.52, -12.27, 0.77, -10.83, 0.02, -10.77, 0.77, -10.52, 0.52, -7.83, 1.02, -7.58, 0.52, -7.52, 0.52, -6.33], roof: { type: 'gable', ridgeM: 368.75, ridge: [-5.03, -8.86, 0.94, -9.16], pitchLeftDeg: 19.62, pitchRightDeg: 27.58 } },
    { pts: [-6.92, -11.83, -7.42, -20.77, -10.42, -20.83, -10.67, -25.02, -1.98, -25.27, -1.73, -21.33, -0.48, -21.27, 0.02, -14.83, 0.52, -14.77, 0.02, -13.52, 0.52, -13.08, -0.23, -12.83, 0.52, -12.33], roof: { type: 'shed', topM: 365.81, through: [-6.92, -11.83], down: [0.0084, -1], pitchDeg: 13.47 } },
    { pts: [0.08, -0.08, 0.08, -6.27, 1.08, -7.58, 0.58, -7.83, 0.58, -10.02, 4.77, -10.52, 5.52, -10.02, 5.02, -9.52, 5.52, -8.27, 5.02, 0.17], roof: { type: 'shed', topM: 364.85, through: [4.77, -10.52], down: [0.1038, 0.9946], pitchDeg: 13.31 } },
    { pts: [5.02, -10.08, 4.77, -10.58, 0.08, -10.58, 0.83, -10.83, 0.58, -12.52, -0.17, -12.83, 0.58, -13.08, 0.08, -13.33, 0.58, -15.02, 4.77, -15.02], roof: { type: 'shed', topM: 365.38, through: [0.08, -10.58], down: [0.6652, -0.7467], pitchDeg: 26.32 } },
    { pts: [10.02, -7.33, 5.33, -7.58, 5.33, -10.27, 9.52, -10.27], roof: { type: 'shed', topM: 360.67, through: [10.02, -7.33], down: [-0.0285, -0.9996], pitchDeg: 15.3 } },
  ],
};

describe('volumes v3', () => {
  it('pose une monopente sur son plan mesuré, débord compris', () => {
    const square = [0, 0, 10, 0, 10, 6, 0, 6];
    const [v] = volumesGeometry(square, { ...c28, parts: [{ pts: square, roof: { type: 'shed', topM: 110, through: [0, 0], down: [0, 1], pitchDeg: 20 } }] }, 0.5)!;
    const tan = Math.tan((20 * Math.PI) / 180);
    expect(v!.topAt(5, 0)).toBeCloseTo(110, 9);
    expect(v!.topAt(5, 6)).toBeCloseTo(110 - 6 * tan, 9);
    expect(v!.eaveMin).toBeCloseTo(110 - 6 * tan, 9);
    expect(v!.gables.pos).toHaveLength(0);
    const ys = v!.roof.pos.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(110 + 0.5 * tan, 6);
    expect(area(v!.roof.pos)).toBeCloseTo(11 * 7, 6);
  });

  it('reconstruit les cinq volumes du 54, corps haut compris', () => {
    const v = volumesGeometry(pts54, c54, 0.4)!;
    expect(v).toHaveLength(5);
    expect(v[0]!.top).toBe(368.75);
    // Le corps haut domine l'aile ouest de près de 3 m, que la croupe historique ignorait.
    expect(v[0]!.top - v[1]!.top).toBeGreaterThan(2.9);
    expect(v[1]!.topAt(pts54[0]! - 6.92, pts54[1]! - 11.83)).toBeCloseTo(365.81, 9);
    expect(v.reduce((s, x) => s + area(x.roof.pos), 0)).toBeGreaterThan(214);
  });

  it('pose un toit par volume du 28, chacun à son faîtage mesuré', () => {
    const v = volumesGeometry(pts28, c28, 0.4)!;
    expect(v.map((x) => x.top)).toEqual([367.62, 368.22, 369.68]);
    for (const x of v) {
      const ys = x.roof.pos.filter((_, i) => i % 3 === 1);
      expect(Math.max(...ys)).toBeCloseTo(x.top, 6);
      expect(x.eaveMin).toBeLessThan(x.top);
      expect(x.ridgeDir).toBeDefined();
    }
    // Le volume nord est le plus haut (le toit historique y descendait).
    expect(v[2]!.topAt(-152, -700)).toBeGreaterThan(v[0]!.topAt(-144, -685));
  });

  it('couvre l’emprise sans débord quand le débord est nul', () => {
    const v = volumesGeometry(pts28, c28, 0)!;
    expect(v.reduce((s, x) => s + area(x.roof.pos), 0)).toBeCloseTo(180.91, 1);
  });

  it('suit une translation de l’emprise (monde composite)', () => {
    const shifted = pts28.map((p, i) => p + (i % 2 ? -250 : 1000));
    const a = volumesGeometry(pts28, c28, 0.4)!;
    const b = volumesGeometry(shifted, c28, 0.4)!;
    expect(b[1]!.topAt(-150 + 1000, -693 - 250)).toBeCloseTo(a[1]!.topAt(-150, -693), 9);
  });

  it('pose une dalle à topM pour un volume plat, emprise concave comprise', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    const v = volumesGeometry(square, {
      ...c28, parts: [{ pts: [0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10], roof: { type: 'flat', topM: 104 } }, { pts: [4, 4, 10, 4, 10, 10, 4, 10], roof: { type: 'flat', topM: 107 } }],
    }, 0.4)!;
    expect(v[0]!.roof.pos.filter((_, i) => i % 3 === 1).every((y) => y === 104)).toBe(true);
    expect(area(v[0]!.roof.pos)).toBeCloseTo(64, 6);
    expect(v[1]!.topAt(7, 7)).toBe(107);
    expect(v[1]!.gables.pos).toHaveLength(0);
  });

  it('renonce à toute la correction si un volume à deux pans est refusé', () => {
    const u = [0, 0, 10, 0, 10, 10, 7, 10, 7, 3, 3, 3, 3, 10, 0, 10];
    expect(volumesGeometry(u, {
      ...c28, parts: [{ pts: u, roof: { type: 'gable', ridgeM: 10, ridge: [0, 6, 10, 6], pitchLeftDeg: 20, pitchRightDeg: 20 } }],
    }, 0.4)).toBeNull();
  });
});
