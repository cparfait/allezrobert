import { describe, expect, it } from 'vitest';
import { streamMesh, streamProfile, streamWidth, subdivideFlat } from '../src/world/watergeom.ts';

/** Composante y de la normale d'un triangle (repère Three.js : x est, z sud, y haut). */
function normalY(pos: number[], a: number, b: number, c: number): number {
  const ux = pos[b * 3]! - pos[a * 3]!;
  const uz = pos[b * 3 + 2]! - pos[a * 3 + 2]!;
  const vx = pos[c * 3]! - pos[a * 3]!;
  const vz = pos[c * 3 + 2]! - pos[a * 3 + 2]!;
  return uz * vx - ux * vz;
}

describe('subdivideFlat', () => {
  it('ramène toutes les arêtes sous le pas demandé sans changer l’aire', () => {
    const pts = [0, 0, 40, 0, 0, 30];
    const out = subdivideFlat(pts, [0, 1, 2], 5);
    let area = 0;
    for (let i = 0; i < out.tris.length; i += 3) {
      const [a, b, c] = [out.tris[i]!, out.tris[i + 1]!, out.tris[i + 2]!];
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const)
        expect(Math.hypot(out.pts[p * 2]! - out.pts[q * 2]!, out.pts[p * 2 + 1]! - out.pts[q * 2 + 1]!)).toBeLessThanOrEqual(5 + 1e-9);
      area += Math.abs((out.pts[b * 2]! - out.pts[a * 2]!) * (out.pts[c * 2 + 1]! - out.pts[a * 2 + 1]!) - (out.pts[c * 2]! - out.pts[a * 2]!) * (out.pts[b * 2 + 1]! - out.pts[a * 2 + 1]!)) / 2;
    }
    expect(area).toBeCloseTo(600, 6);
    // les sommets d'origine gardent leurs indices (rive = contour)
    expect(out.pts.slice(0, 6)).toEqual(pts);
  });

  it('élargit le pas si le nombre de triangles dépasse la limite', () => {
    const out = subdivideFlat([0, 0, 1000, 0, 0, 1000], [0, 1, 2], 1, 500);
    expect(out.tris.length / 3).toBeLessThanOrEqual(500);
    expect(out.tris.length / 3).toBeGreaterThan(50);
  });
});

describe('streamProfile', () => {
  it('ne remonte jamais vers l’aval et reste sous le sol des berges', () => {
    const pts = [0, 0, 10, 0, 20, 0, 30, 0];
    // sol qui remonte au milieu (bosse) : l'eau reste au niveau atteint en amont
    const ground = (x: number) => (x === 20 ? 105 : 100 - x * 0.01);
    const ys = streamProfile(pts, 2, ground, 0.05);
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeLessThanOrEqual(ys[i - 1]!);
    expect(ys[0]).toBeCloseTo(99.95, 6);
    expect(ys[2]).toBeCloseTo(ys[1]!, 6);
  });

  it('comble les points sans sol connu', () => {
    const ys = streamProfile([0, 0, 10, 0, 20, 0], 2, (x) => (x === 0 ? Number.NaN : 50));
    expect(ys.every(Number.isFinite)).toBe(true);
  });
});

describe('streamMesh', () => {
  it('produit des faces tournées vers le haut, profondes au milieu', () => {
    const pts = [0, 0, 10, 2, 20, -1, 30, 5];
    const m = streamMesh(pts, [10, 9.9, 9.8, 9.7], 4, 0.8, 0.5);
    expect(m.pos.length / 3).toBe(12);
    for (let i = 0; i < m.index.length; i += 3) expect(normalY(m.pos, m.index[i]!, m.index[i + 1]!, m.index[i + 2]!)).toBeGreaterThan(0);
    expect(m.depth.slice(0, 3)).toEqual([0, 0.8, 0]);
    // courant dans le sens du tracé, plus fort sur l'axe
    expect(m.flow[2]!).toBeGreaterThan(m.flow[0]!);
    expect(m.flow[2]!).toBeGreaterThan(0);
  });
});

describe('streamWidth', () => {
  it('ignore fossés et drains, borne les largeurs', () => {
    expect(streamWidth('ditch', 2)).toBe(0);
    expect(streamWidth('river', 0)).toBe(6);
    expect(streamWidth('stream', 0.3)).toBe(1.2);
    expect(streamWidth('river', 80)).toBe(30);
  });
});
