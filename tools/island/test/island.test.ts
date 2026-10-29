import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANNEAU, ISLAND, anneauLoop, coast, terrain } from '../src/design.ts';
import { clipPolyline, polylineLength, resample, type Vec3 } from '../src/geom.ts';
import { verifyWorld } from '../src/verify.ts';

describe("île de Robert : conception", () => {
  it("l'anneau mesure ≈ 3,6 km et son plateau est parfaitement plat", () => {
    const loop = anneauLoop(2);
    const len = polylineLength(loop, true);
    expect(len).toBeGreaterThan(3500);
    expect(len).toBeLessThan(3700);
    for (const [x, z] of loop) expect(terrain(x, z)).toBeCloseTo(ANNEAU.level, 6);
  });

  it('le sol est continu au bord de l’eau (pas de marche au trait de côte)', () => {
    // Le long d'un rayon vers une plage du sud : pas de saut de plus de 10 cm entre deux points espacés de 2 m.
    let prev = terrain(-3000, 8000);
    for (let z = 8002; z < 12500; z += 2) {
      const h = terrain(-3000, z);
      expect(Math.abs(h - prev), `z = ${z}`).toBeLessThan(0.1);
      prev = h;
    }
    expect(coast(0, 0)).toBeGreaterThan(0.5);
    expect(terrain(0, ISLAND.maxZ)).toBeLessThan(-5);
  });
});

describe('île de Robert : géométrie', () => {
  it('rééchantillonne une boucle sans doubler le premier point', () => {
    const square: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const pts = resample(square, 2, true);
    expect(pts.length).toBe(20);
    const last = pts[pts.length - 1]!;
    expect(Math.hypot(last[0] - pts[0]![0], last[1] - pts[0]![1])).toBeCloseTo(2, 6);
  });

  it('découpe une polyligne exactement aux bords de la tuile', () => {
    const line: Vec3[] = [[-5, 1, 5], [15, 3, 5]];
    const parts = clipPolyline(line, { minX: 0, minZ: 0, maxX: 10, maxZ: 10 });
    expect(parts).toHaveLength(1);
    expect(parts[0]![0]).toEqual([0, 1.5, 5]);
    expect(parts[0]![1]).toEqual([10, 2.5, 5]);
  });
});

// Les tuiles ne sont pas versionnées : contrôle complet seulement après `npx tsx tools/island/src/build.ts`.
const dir = resolve(import.meta.dirname, '../../../apps/client/public/worlds/ile-de-robert');
describe.skipIf(!existsSync(resolve(dir, 'tiles')))('île de Robert : monde généré', () => {
  it('passe tous les contrôles automatiques', () => {
    const report = verifyWorld(dir);
    expect(report.lines.filter((l) => l.startsWith('✘'))).toEqual([]);
    expect(report.ok).toBe(true);
  }, 120_000);
});
