import { describe, expect, it } from 'vitest';
import { climbAhead, climbElevation, detectClimbs, gradeColor, segmentLength } from '../src/climbs.ts';

/** Profil linéaire par morceaux : [longueur (m), pente (%)], depuis 100 m d'altitude. */
function profile(parts: Array<[number, number]>): (d: number) => number {
  return (d) => {
    let y = 100;
    let x = 0;
    for (const [len, g] of parts) {
      const k = Math.min(Math.max(d - x, 0), len);
      y += (k * g) / 100;
      x += len;
    }
    return y;
  };
}

describe('détection des montées', () => {
  it('trouve une côte entre deux plats, replats rognés', () => {
    const c = detectClimbs(profile([[1000, 0], [2000, 6], [1000, 0]]), 0, 4000);
    expect(c).toHaveLength(1);
    expect(c[0]!.start).toBeGreaterThan(900);
    expect(c[0]!.start).toBeLessThan(1100);
    expect(c[0]!.end).toBeGreaterThan(2900);
    expect(c[0]!.end).toBeLessThan(3100);
    expect(c[0]!.avgGrade).toBeCloseTo(6, 0);
    expect(c[0]!.gainM).toBeGreaterThan(110);
    expect(c[0]!.openEnd).toBe(false);
  });

  it('ignore les bosses trop courtes ou trop douces', () => {
    expect(detectClimbs(profile([[500, 0], [120, 8], [500, 0]]), 0, 1200)).toHaveLength(0);
    expect(detectClimbs(profile([[500, 0], [3000, 2], [500, 0]]), 0, 4000)).toHaveLength(0);
  });

  it('garde un replat au milieu, sépare deux côtes après une vraie descente', () => {
    expect(detectClimbs(profile([[500, 0], [1000, 7], [200, 0], [1000, 7], [500, 0]]), 0, 3200)).toHaveLength(1);
    const two = detectClimbs(profile([[500, 0], [1000, 7], [1000, -5], [1000, 7], [500, 0]]), 0, 4000);
    expect(two).toHaveLength(2);
    expect(two[1]!.start).toBeGreaterThan(two[0]!.end);
  });

  it('découpe en tronçons réguliers avec leur pente', () => {
    const [c] = detectClimbs(profile([[500, 0], [1000, 4], [1000, 10], [500, 0]]), 0, 3000);
    expect(c!.segments[0]!.from).toBe(0);
    expect(c!.segments.at(-1)!.to).toBe(c!.lengthM);
    expect(c!.segments.every((s) => s.to - s.from >= segmentLength(c!.lengthM) * 0.4)).toBe(true);
    expect(c!.segments[1]!.grade).toBeCloseTo(4, 0);
    expect(c!.maxGrade).toBeGreaterThan(9);
    expect(climbElevation(c!, c!.lengthM)).toBeCloseTo(c!.topM, 5);
  });

  it('signale une montée coupée au bout de la route connue (monde ouvert)', () => {
    const [c] = detectClimbs(profile([[300, 0], [1000, 6]]), 0, 1300, { openEnd: true });
    expect(c!.openEnd).toBe(true);
  });

  it('couleurs des pentes', () => {
    expect(gradeColor(1)).toBe('#4cd964');
    expect(gradeColor(7)).toBe('#f97316');
    expect(gradeColor(13)).toBe('#9f1239');
  });
});

describe('montée en cours ou à venir', () => {
  const climbs = detectClimbs(profile([[1000, 0], [1000, 6], [1000, 0], [1000, 8], [1000, 0]]), 0, 5000);

  it('donne la prochaine montée et la position depuis son pied', () => {
    expect(climbs).toHaveLength(2);
    const a = climbAhead(climbs, 500, { loop: false, lengthM: 5000 })!;
    expect(a.index).toBe(0);
    expect(a.pos).toBeLessThan(-400);
    expect(climbAhead(climbs, 1500, { loop: false, lengthM: 5000 })!.pos).toBeGreaterThan(0);
    expect(climbAhead(climbs, 2500, { loop: false, lengthM: 5000 })!.index).toBe(1);
    expect(climbAhead(climbs, 4500, { loop: false, lengthM: 5000 })).toBeNull();
  });

  it('boucle : la première montée revient au tour suivant', () => {
    const a = climbAhead(climbs, 4500, { loop: true, lengthM: 5000 })!;
    expect(a.index).toBe(0);
    expect(a.pos).toBeLessThan(-1000);
  });
});
