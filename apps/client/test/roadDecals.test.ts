import { describe, expect, it } from 'vitest';
import { DECAL_CROSSWALK, DECAL_GRATE, DECAL_MANHOLE, GUTTER_W, placeDecals, pushDecal, type DecalSink } from '../src/world/roadDecals.ts';

/** Rue de 120 m (profils tous les 3 m), trottoirs partout sauf sur les 9 premiers mètres (carrefour). */
const street = (along: number[] = Array.from({ length: 41 }, (_, i) => i * 3)) => {
  const w = along.map((a) => (Math.abs(a - along[0]!) < 9 ? 0 : 2));
  return { along, half: 4, o: 4.6, city: true, wL: w, wR: w, seed: 1234 };
};

describe('placeDecals', () => {
  it('est déterministe', () => {
    expect(placeDecals(street())).toEqual(placeDecals(street()));
  });

  it('pose un passage piéton là où les trottoirs reprennent après le carrefour', () => {
    const cross = placeDecals(street()).filter((d) => d.kind === DECAL_CROSSWALK);
    expect(cross.length).toBe(1);
    expect(cross[0]!.a0).toBeGreaterThanOrEqual(9);
    expect(cross[0]!.a0).toBeLessThan(10);
    expect(cross[0]!.u1 - cross[0]!.u0).toBeCloseTo(8 - 0.5);
  });

  it('marche aussi dans une voie parcourue à rebours', () => {
    const along = Array.from({ length: 41 }, (_, i) => 120 - i * 3);
    const cross = placeDecals(street(along)).filter((d) => d.kind === DECAL_CROSSWALK);
    expect(cross.length).toBe(1);
    expect(cross[0]!.a1).toBeLessThanOrEqual(111);
  });

  it('pose les avaloirs dans le caniveau, contre la bordure', () => {
    const g = placeDecals(street()).filter((d) => d.kind === DECAL_GRATE);
    expect(g.length).toBeGreaterThan(0);
    for (const d of g) {
      expect(d.u1 - d.u0).toBeCloseTo(GUTTER_W);
      expect(Math.max(Math.abs(d.u0), Math.abs(d.u1))).toBeCloseTo(4.6);
      expect(d.a0).toBeGreaterThanOrEqual(9);
    }
  });

  it('ne superpose pas deux décalques', () => {
    const ds = placeDecals(street());
    for (let i = 0; i < ds.length; i++)
      for (let j = i + 1; j < ds.length; j++) {
        const a = ds[i]!;
        const b = ds[j]!;
        expect(a.u0 < b.u1 && a.u1 > b.u0 && a.a0 < b.a1 && a.a1 > b.a0).toBe(false);
      }
  });

  it('reste dans la chaussée et le tronçon', () => {
    for (const d of placeDecals(street())) {
      expect(d.a0).toBeGreaterThanOrEqual(0);
      expect(d.a1).toBeLessThanOrEqual(120);
      expect(d.u0).toBeGreaterThanOrEqual(-4.6 - 1e-9);
      expect(d.u1).toBeLessThanOrEqual(4.6 + 1e-9);
      if (d.kind === DECAL_GRATE) expect(Math.abs(d.u0) > 4 || Math.abs(d.u1) > 4).toBe(true);
    }
  });

  it('à la campagne : ni caniveau, ni passage piéton, ni plaque', () => {
    const ds = placeDecals({ ...street(), city: false, wL: [], wR: [] });
    expect(ds.some((d) => d.kind === DECAL_GRATE || d.kind === DECAL_CROSSWALK || d.kind === DECAL_MANHOLE)).toBe(false);
  });
});

describe('pushDecal', () => {
  const sink = (): DecalSink => ({ pos: [], uvs: [], info: [], lit: [], decal: [], dsize: [], side: [], index: [] });
  // Voie droite le long de z, de 0 à 9 m, bord gauche en x = −4,6, droit en x = +4,6, à 1 m d'altitude.
  const along = [0, 3, 6, 9];
  const left = along.flatMap((a) => [-4.6, 1, a]);
  const right = along.flatMap((a) => [4.6, 1, a]);

  it('suit les profils, se lève au-dessus de la chaussée et regarde vers le haut', () => {
    const s = sink();
    pushDecal(s, left, right, along, 4.6, 4, { kind: DECAL_MANHOLE, u0: -0.4, u1: 0.4, a0: 2, a1: 7, seed: 0.5 }, [0, 0, 0, 0]);
    // Bouts (2 et 7) et profils intérieurs (3 et 6) : 4 profils, 2 sommets chacun.
    expect(s.pos.length / 3).toBe(8);
    expect(s.pos[0]).toBeCloseTo(-0.4);
    expect(s.pos[1]).toBeGreaterThan(1);
    expect(s.pos[2]).toBeCloseTo(2);
    expect(s.decal.slice(0, 4)).toEqual([DECAL_MANHOLE, 0, 0, 0.5]);
    expect(s.dsize.slice(0, 2).map((v) => Math.round(v * 100) / 100)).toEqual([0.8, 5]);
    const [a, b, c] = s.index;
    const p = (i: number): [number, number] => [s.pos[i * 3]!, s.pos[i * 3 + 2]!];
    const [ax, az] = p(a!);
    const [bx, bz] = p(b!);
    const [cx, cz] = p(c!);
    expect((bz - az) * (cx - ax) - (bx - ax) * (cz - az)).toBeGreaterThan(0);
  });
});
