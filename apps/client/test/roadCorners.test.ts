import { describe, expect, it } from 'vitest';
import { junctionKeys, roundPolyline, roundRoads, simplifyPolyline } from '../src/world/roadCorners.ts';

/** Polyligne x,y,z depuis des points x,z (y = 100). */
const line = (pts: Array<[number, number]>) => pts.flatMap(([x, z]) => [x, 100, z]);
const xz = (p: number[]) => Array.from({ length: p.length / 3 }, (_, i) => [p[i * 3] as number, p[i * 3 + 2] as number] as const);

describe('coudes arrondis des voies', () => {
  it('remplace un angle droit par un arc tangent, extrémités inchangées', () => {
    const out = roundPolyline(line([[0, 0], [30, 0], [30, 30]]));
    const pts = xz(out);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([30, 30]);
    expect(pts.length).toBeGreaterThan(5);
    // Corde coupée au sommet : 2,5 m sur l'arc (échantillonné : un peu plus au point le plus proche).
    const cut = Math.min(...pts.map(([x, z]) => Math.hypot(x - 30, z)));
    expect(cut).toBeGreaterThan(1.5);
    expect(cut).toBeLessThanOrEqual(2.6);
    // Pas d'angle de plus de 0,16 rad entre deux pas.
    for (let i = 1; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i - 1] as readonly [number, number];
      const [vx, vz] = pts[i] as readonly [number, number];
      const [bx, bz] = pts[i + 1] as readonly [number, number];
      const t = Math.abs(Math.atan2((vx - ax) * (bz - vz) - (vz - az) * (bx - vx), (vx - ax) * (bx - vx) + (vz - az) * (bz - vz)));
      expect(t).toBeLessThan(0.16);
    }
  });

  it('un coude entre deux tronçons courts reste serré : l’arc ne prend pas plus de 45 % de chacun', () => {
    const pts = xz(roundPolyline(line([[0, 0], [4, 0], [4, 4], [8, 4]])));
    // Aucun point ne déborde des tronçons d'origine vers l'extérieur ; le premier arc finit avant x = 4, z = 1,8.
    for (const [x, z] of pts) {
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(x).toBeLessThanOrEqual(8 + 1e-6);
      expect(z).toBeGreaterThanOrEqual(-1e-6);
      expect(z).toBeLessThanOrEqual(4 + 1e-6);
    }
    expect(pts.some(([x, z]) => Math.abs(x - 4) < 1e-6 && Math.abs(z - 2) < 0.25)).toBe(true);
  });

  it('laisse vifs les sommets de carrefour, pas ceux qu’une copie d’itinéraire double', () => {
    const main = line([[0, 0], [20, 0], [40, 10]]);
    const branch = line([[20, 0], [20, -20]]);
    const twin = main.slice();
    const keep = junctionKeys([main, branch, twin]);
    expect(xz(roundPolyline(main, keep))).toEqual(xz(main));
    const keepNoBranch = junctionKeys([main, twin]);
    expect(roundPolyline(main, keepNoBranch).length).toBeGreaterThan(main.length);
  });

  it('suit l’altitude des tronçons dans l’arc', () => {
    const p = [0, 100, 0, 30, 103, 0, 30, 106, 30];
    const out = roundPolyline(p);
    for (let i = 1; i < out.length / 3; i++) expect(out[i * 3 + 1] as number).toBeGreaterThanOrEqual((out[i * 3 - 2] as number) - 1e-9);
  });

  it('arrondit le raccord de deux voies mises bout à bout ; les deux moitiés finissent sur le même point', () => {
    const a = line([[0, 0], [30, 0]]);
    const b = line([[30, 0], [30, 30]]);
    const twin = b.slice();
    const [ra, rb, rt] = roundRoads([a, b, twin]) as [number[], number[], number[]];
    const pa = xz(ra);
    const pb = xz(rb);
    // Bout de A = début de B (et de sa copie), loin de l'ancien coin.
    expect(pa[pa.length - 1]).toEqual(pb[0]);
    expect(xz(rt)).toEqual(pb);
    const [jx, jz] = pb[0] as readonly [number, number];
    expect(Math.hypot(jx - 30, jz)).toBeGreaterThan(0.5);
    expect(pa[0]).toEqual([0, 0]);
    expect(pb[pb.length - 1]).toEqual([30, 30]);
  });

  it('laisse un vrai carrefour de bouts de voie tel quel', () => {
    const a = line([[0, 0], [30, 0]]);
    const b = line([[30, 0], [30, 30]]);
    const c = line([[30, 0], [60, 0]]);
    const [ra, rb] = roundRoads([a, b, c]) as [number[], number[]];
    expect(ra).toEqual(a);
    expect(rb).toEqual(b);
  });

  it('un point serré avant un angle droit (OSM) ne réduit plus l’arc à 1,7 m de rayon', () => {
    const p = line([[-30, 0], [-4.5, 0.1], [0, 0], [0, 30]]);
    expect(xz(simplifyPolyline(p))).toEqual([[-30, 0], [0, 0], [0, 30]]);
    const [r] = roundRoads([p]) as [number[]];
    const pts = xz(r);
    // Premier point de l'arc : à plus de 4 m de l'angle (rayon ≈ 6 m), au lieu de 2 m.
    const first = pts.find(([x, z]) => z > 0.05) as readonly [number, number];
    expect(first).toBeDefined();
    const start = pts[pts.indexOf(first) - 1] as readonly [number, number];
    expect(Math.hypot(start[0], start[1])).toBeGreaterThan(4);
  });
});
