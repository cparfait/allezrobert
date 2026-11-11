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

describe('volumes v3', () => {
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
