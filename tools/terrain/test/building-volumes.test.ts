import { describe, expect, it } from 'vitest';
import { parseBuildingVisualTile, type VolumePart } from '@allezrobert/shared/building-visual';
import { segmentRoofVolumes } from '../src/building-volumes.ts';
import type { Raster } from '../src/lidar.ts';

/** Repère synthétique : tuile d'origine (1000, 2100) en Lambert-93, bâtiment autour de (1020, 2080). */
const origin = { x: 1000, y: 2100 };
const RES = 0.5;
const E0 = 1000, N0 = 2100, W = 80, H = 80;

/** MNS 0,5 m : sol à 90 m hors de l'emprise, toit donné par `roof(e, n)` dedans (NaN = pixel absent). */
function raster(ring: Array<[number, number]>, roof: (e: number, n: number) => number): Raster {
  const data = new Float32Array(W * H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const e = E0 + (i + 0.5) * RES, n = N0 - (j + 0.5) * RES;
      data[j * W + i] = inside(e, n, ring) ? roof(e, n) : 90;
    }
  return { e0: E0, n0: N0, res: RES, w: W, h: H, data, coverage: 1 };
}

function inside(x: number, y: number, ring: Array<[number, number]>): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const rect = (e: number, n: number, w: number, h: number): Array<[number, number]> => [[e, n], [e + w, n], [e + w, n - h], [e, n - h]];
const tan = (d: number) => Math.tan((d * Math.PI) / 180);

/** Les parties passent-elles le contrat v3 pour ce bâtiment ? */
function accepted(ring: Array<[number, number]>, parts: VolumePart[]): boolean {
  const pts = ring.flatMap(([e, n]) => [e - origin.x, origin.y - n]);
  const doc = {
    schemaVersion: 3, worldId: 'z', tileId: '0_0', sourceTileSha256: 'a'.repeat(64),
    corrections: [{ buildingId: 'b', kind: 'volumes', parts, confidence: 'medium', provenance: { dataset: 'synthétique', reference: 'test', observedOn: '2000-01-01', method: 'segmentRoofVolumes' } }],
  };
  return !!parseBuildingVisualTile(doc, { worldId: 'z', tileId: '0_0' }, 'a'.repeat(64), [{ id: 'b', pts }]);
}

describe('volumes de toit depuis le MNS', () => {
  it('retrouve une maison à deux pans : faîtage, pentes et cotes', () => {
    const ring = rect(1014, 2086, 12, 8); // faîtage est-ouest au milieu (n = 2082)
    const res = segmentRoofVolumes(raster(ring, (_e, n) => 102.31 - tan(30) * Math.abs(n - 2082)), ring, origin)!;
    expect(res.parts).toHaveLength(1);
    const r = res.parts[0]!.roof;
    expect(r.type).toBe('gable');
    if (r.type !== 'gable') return;
    expect(r.ridgeM).toBeCloseTo(102.31, 1);
    expect(r.pitchLeftDeg).toBeCloseTo(30, 0);
    expect(r.pitchRightDeg).toBeCloseTo(30, 0);
    // Faîtage à z = origine.y − 2082 = 18 dans le repère de tuile, relatif au premier sommet (z = 14).
    expect(r.ridge[1]).toBeCloseTo(4, 1);
    expect(r.ridge[3]).toBeCloseTo(4, 1);
    expect(accepted(ring, res.parts)).toBe(true);
  });

  it('place un faîtage décentré là où les deux plans se coupent', () => {
    const ring = rect(1014, 2086, 12, 8); // faîtage à n = 2083,5 (1,5 m au nord du milieu)
    const res = segmentRoofVolumes(raster(ring, (_e, n) => 104 - tan(20) * Math.abs(n - 2083.5)), ring, origin)!;
    const r = res.parts[0]!.roof;
    expect(r.type).toBe('gable');
    if (r.type !== 'gable') return;
    expect(r.ridge[1]).toBeCloseTo(2.5, 1);
    expect(r.ridgeM).toBeCloseTo(104, 1);
    expect(accepted(ring, res.parts)).toBe(true);
  });

  it('reconnaît une monopente et le sens de sa descente', () => {
    const ring = rect(1014, 2086, 10, 6); // descend vers le sud (n décroissant)
    const res = segmentRoofVolumes(raster(ring, (_e, n) => 100 + tan(15) * (n - 2080)), ring, origin)!;
    expect(res.parts).toHaveLength(1);
    const r = res.parts[0]!.roof;
    expect(r.type).toBe('shed');
    if (r.type !== 'shed') return;
    expect(r.pitchDeg).toBeCloseTo(15, 0);
    // Vers le sud = z croissant dans le repère de tuile.
    expect(r.down[0]).toBeCloseTo(0, 2);
    expect(r.down[1]).toBeCloseTo(1, 2);
    expect(accepted(ring, res.parts)).toBe(true);
  });

  it('sépare deux volumes plats de hauteurs différentes', () => {
    const ring: Array<[number, number]> = [[1010, 2090], [1030, 2090], [1030, 2080], [1020, 2080], [1020, 2070], [1010, 2070]];
    const res = segmentRoofVolumes(raster(ring, (e) => (e < 1020 ? 100 : 103)), ring, origin)!;
    expect(res.parts.map((p) => p.roof.type)).toEqual(['flat', 'flat']);
    expect(res.parts.map((p) => (p.roof.type === 'flat' ? p.roof.topM : 0)).sort()).toEqual([100, 103]);
    expect(accepted(ring, res.parts)).toBe(true);
  });

  it('ne propose rien pour un toit que des plans n’expliquent pas', () => {
    const ring = rect(1014, 2086, 12, 8);
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 3;
    expect(segmentRoofVolumes(raster(ring, () => 100 + noise()), ring, origin)).toBeNull();
  });

  it('ne propose rien quand le MNS couvre mal l’emprise ou qu’elle sort du raster', () => {
    const ring = rect(1014, 2086, 12, 8);
    const holes = raster(ring, (e) => (e < 1022 ? NaN : 100));
    expect(segmentRoofVolumes(holes, ring, origin)).toBeNull();
    const outside = rect(1036, 2086, 12, 8);
    expect(segmentRoofVolumes(raster(ring, () => 100), outside, origin)).toBeNull();
  });
});
