import { describe, expect, it } from 'vitest';
import { detectClimbs, detectSprints, elevationGain, smoothRoadProfile, zigzag } from '../src/profile.ts';
import { clipPolylineToBox, clipRingToBox, resampleClosed, signedArea, type Pt } from '../src/geom.ts';
import { frenchDe } from '../src/route.ts';

describe('profils', () => {
  const step = 2;
  // plat 1 km, montée 1,2 km à 6 %, plat 1 km, descente 1,2 km
  const h: number[] = [];
  for (let i = 0; i < 500; i++) h.push(100);
  for (let i = 0; i < 600; i++) h.push(100 + i * step * 0.06);
  for (let i = 0; i < 500; i++) h.push(172);
  for (let i = 0; i < 600; i++) h.push(172 - i * step * 0.06);

  it('zigzag alterne min et max', () => {
    const z = zigzag(h, 4);
    expect(z.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < z.length; i++) expect(z[i]!.type).not.toBe(z[i - 1]!.type);
  });

  it('détecte une côte de 1,2 km à 6 %', () => {
    const c = detectClimbs(smoothRoadProfile(h, step, true).h, step);
    expect(c.length).toBe(1);
    expect(c[0]!.lengthM).toBeGreaterThan(1050);
    expect(c[0]!.lengthM).toBeLessThan(1350);
    expect(c[0]!.avgGrade).toBeGreaterThan(5.3);
    expect(c[0]!.avgGrade).toBeLessThan(6.6);
  });

  it('ignore une bosse trop courte', () => {
    const b = [...Array<number>(300).fill(100), ...Array.from({ length: 100 }, (_, i) => 100 + i * 0.12), ...Array<number>(300).fill(112)];
    expect(detectClimbs(b, step).length).toBe(0);
  });

  it('lisse sans casser la continuité de boucle et borne la variation de pente', () => {
    const noisy = h.map((v, i) => v + Math.sin(i * 1.7) * 0.4);
    const s = smoothRoadProfile(noisy, step, true);
    expect(s.maxGradeChangePer20m).toBeLessThan(0.04);
    expect(Math.abs(s.h[0]! - s.h[s.h.length - 1]!)).toBeLessThan(0.2);
    expect(elevationGain(s.h, true)).toBeGreaterThan(65);
    expect(elevationGain(s.h, true)).toBeLessThan(80);
  });

  it('trouve un sprint sur une ligne droite plate, pas dans un virage', () => {
    const n = 600;
    const xs = Array.from({ length: n }, (_, i) => i * 2);
    const zs = Array.from({ length: n }, () => 0);
    const hs = Array.from({ length: n }, () => 50);
    const s = detectSprints(xs, zs, hs, 2, false);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0]!.lengthM).toBe(500);
    const xc = Array.from({ length: n }, (_, i) => 80 * Math.cos(i / 40));
    const zc = Array.from({ length: n }, (_, i) => 80 * Math.sin(i / 40));
    expect(detectSprints(xc, zc, hs, 2, false).length).toBe(0);
  });
});

describe('géométrie', () => {
  it('rééchantillonne une boucle à pas exact', () => {
    const sq: Pt[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const r = resampleClosed(sq, 3);
    expect(r.pts.length * r.step).toBeCloseTo(400, 6);
  });

  it('découpe anneaux et polylignes par un rectangle', () => {
    const ring: Pt[] = [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
    ];
    const c = clipRingToBox(ring, { minX: 0, minZ: 0, maxX: 20, maxZ: 20 });
    expect(Math.abs(signedArea(c))).toBeCloseTo(100, 6);
    const pieces = clipPolylineToBox(
      [
        [-5, 0, 5],
        [5, 1, 5],
        [15, 2, 5],
      ],
      { minX: 0, minZ: 0, maxX: 10, maxZ: 10 },
    );
    expect(pieces.length).toBe(1);
    expect(pieces[0]![0]![0]).toBeCloseTo(0, 9);
    expect(pieces[0]![0]![1]).toBeCloseTo(0.5, 9); // y interpolé
    expect(pieces[0]![pieces[0]!.length - 1]![0]).toBeCloseTo(10, 9);
  });
});

describe('noms', () => {
  it('élision et articles', () => {
    expect(frenchDe('Chevreuse')).toBe('de Chevreuse');
    expect(frenchDe('Orsigny')).toBe("d'Orsigny");
    expect(frenchDe('Le Mesnil-Saint-Denis')).toBe('du Mesnil-Saint-Denis');
    expect(frenchDe('Les Molières')).toBe('des Molières');
    expect(frenchDe('La Madeleine')).toBe('de la Madeleine');
    expect(frenchDe('Carrefour de Misère')).toBe('du Carrefour de Misère');
    expect(frenchDe('Maison Forestière')).toBe('de la Maison Forestière');
  });
});
