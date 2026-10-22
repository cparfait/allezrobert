import { describe, expect, it } from 'vitest';
import { assembleLines, headwayAt, pointAt, RER, runDistance, trainsAt, type RailPiece } from '../src/world/railgeom.ts';

const piece = (...xz: number[]): RailPiece => {
  const pts: number[] = [];
  for (let i = 0; i < xz.length; i += 2) pts.push(xz[i]!, 100, xz[i + 1]!);
  return { pts };
};

describe('assembleLines', () => {
  it('raboute les tronçons coupés aux bords de tuile et suit la voie la plus droite à l’aiguillage', () => {
    const pieces = [
      piece(500, 0, 1000, 0), // tuile 0
      piece(1000, 0, 1600, 10), // tuile 1 (sens inverse ci-dessous)
      piece(2100, 10, 1600, 10),
      piece(1600, 10, 1700, 80), // embranchement à 35°+ : ignoré par la ligne principale
    ];
    const onBoundary = (x: number) => Math.abs(x - Math.round(x / 1000) * 1000) < 0.5 && x !== 500;
    const lines = assembleLines(pieces, onBoundary, 300);
    expect(lines.length).toBe(1);
    const l = lines[0]!;
    expect(l.length).toBeGreaterThan(1599);
    expect(l.length).toBeLessThan(1602);
    // extrémités : (500, 0) en cul-de-sac (terminus), (2100, 10) aussi
    expect(l.deadStart && l.deadEnd).toBe(true);
    const p = pointAt(l, l.length / 2, { x: 0, y: 0, z: 0, dx: 0, dz: 0 });
    expect(Math.abs(p.dx)).toBeGreaterThan(0.99);
  });

  it('ne prend pas une extrémité coupée par une tuile absente pour un terminus', () => {
    const lines = assembleLines([piece(0, 0, 1000, 0)], (x) => x === 1000, 300);
    expect(lines[0]!.deadEnd).toBe(false);
    expect(lines[0]!.deadStart).toBe(true);
  });
});

describe('horaires', () => {
  it('cadence RER : 10 min en pointe, 15 min sinon, rien la nuit', () => {
    expect(headwayAt(8)).toBe(600);
    expect(headwayAt(11)).toBe(900);
    expect(headwayAt(3)).toBe(0);
  });

  it('distance parcourue : accélération puis vitesse maximale', () => {
    expect(runDistance(10, RER)).toBeCloseTo(45, 6);
    const tA = RER.vmax / RER.accel;
    expect(runDistance(tA + 10, RER) - runDistance(tA, RER)).toBeCloseTo(RER.vmax * 10, 6);
  });

  it('terminus : la rame arrive, reste à quai puis repart dans l’autre sens', () => {
    const line = assembleLines([piece(0, 0, 3000, 0)], (x) => x === 3000, 300)[0]!;
    const t0 = 11 * 3600; // départ à t0 (phase 0, intervalle 900 s)
    const atDock = trainsAt(line, t0 - 60, RER, 0, 1, 0);
    expect(atDock.some((tr) => tr.dir === 0 && tr.s0 === 25)).toBe(true);
    const leaving = trainsAt(line, t0 + 60, RER, 0, 1, 0).find((tr) => tr.dir === 1)!;
    expect(leaving.s0).toBeCloseTo(25 + runDistance(60, RER), 6);
    const arriving = trainsAt(line, t0 - RER.dwell - 30, RER, 0, 1, 0).find((tr) => tr.dir === -1)!;
    expect(arriving.s0).toBeCloseTo(25 + runDistance(30, RER), 6);
  });

  it('ligne traversante : les rames gardent leur horaire quand la ligne s’allonge', () => {
    const short = assembleLines([piece(0, 0, 2000, 0)], () => true, 300)[0]!;
    const long = assembleLines([piece(-1000, 0, 2000, 0)], () => true, 300)[0]!;
    const t = 12 * 3600 + 30;
    const a = trainsAt(short, t, RER, 0, 1, 500)[0]!;
    const b = trainsAt(long, t, RER, 0, 1, 1500)[0]!;
    // même point du monde : abscisse décalée de 1000 m
    expect(b.s0 - a.s0).toBeCloseTo(1000, 6);
  });
});
