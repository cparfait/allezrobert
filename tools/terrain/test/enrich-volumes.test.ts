import { describe, expect, it } from 'vitest';
import { ORIGIN_L93 } from '../src/config.ts';
import { measuredVolumes } from '../src/enrich.ts';
import type { Raster } from '../src/lidar.ts';

/** MNS synthétique 0,5 m sur 40 × 40 m à partir de l'origine du monde, sol à 90 m hors de l'emprise. */
function raster(pts: number[], roof: (x: number, z: number) => number): Raster {
  const W = 80, H = 80, res = 0.5;
  const data = new Float32Array(W * H);
  const inside = (x: number, z: number) => {
    let c = false;
    for (let i = 0, j = pts.length / 2 - 1; i < pts.length / 2; j = i++) {
      const xi = pts[i * 2]!, zi = pts[i * 2 + 1]!, xj = pts[j * 2]!, zj = pts[j * 2 + 1]!;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5) * res, z = (j + 0.5) * res; // e = origine.x + x, n = origine.y − z
      data[j * W + i] = inside(x, z) ? roof(x, z) : 90;
    }
  return { e0: ORIGIN_L93.x, n0: ORIGIN_L93.y, res, w: W, h: H, data, coverage: 1 };
}

const house = [10, 10, 22, 10, 22, 18, 10, 18]; // repère monde de la tuile, faîtage à z = 14

describe('volumes de toit mesurés pour un bâtiment BD TOPO (TERRAIN_BUILDING_VOLUMES)', () => {
  it('produit une correction v3 valide, alignée sur les pts de la tuile, datée de la récupération', () => {
    const tan30 = Math.tan(Math.PI / 6);
    const c = measuredVolumes('bdtopo:TEST', house, raster(house, (_x, z) => 102.31 - tan30 * Math.abs(z - 14)), '2026-11-12')!;
    expect(c).not.toBeNull();
    expect(c.buildingId).toBe('bdtopo:TEST');
    expect(c.provenance.observedOn).toBe('2026-11-12');
    expect(c.parts).toHaveLength(1);
    const r = c.parts[0]!.roof;
    expect(r.type).toBe('gable');
    if (r.type !== 'gable') return;
    expect(r.ridgeM).toBeCloseTo(102.31, 1);
    // Faîtage relatif au premier sommet (10, 10) : z = 4.
    expect(r.ridge[1]).toBeCloseTo(4, 1);
  });

  it('ne propose rien pour un toit que des plans n’expliquent pas', () => {
    let seed = 11;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 3;
    expect(measuredVolumes('bdtopo:TEST', house, raster(house, () => 100 + noise()), '2026-11-12')).toBeNull();
  });
});
