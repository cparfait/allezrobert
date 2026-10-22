import { describe, expect, it } from 'vitest';
import { circumradius, detectHairpins, hairpinShortName, platformHeight, projectArc, relaxTightCorners, smoothOpenPath } from '../src/climb.ts';
import { resampleOpen, type Pt } from '../src/geom.ts';
import { carveGrid, carveGridPasses, gridSample, mergeChunks, tileStepM, type CarveLine, type Grid } from '../src/tiles.ts';

/** Route en lacets : branches droites de `leg` m reliées par des demi-cercles de rayon `r`. */
function switchbacks(count: number, leg: number, r: number, nodeStep: number): Pt[] {
  const pts: Pt[] = [];
  let x = 0;
  for (let k = 0; k < count; k++) {
    const z0 = k * 2 * r;
    const dir = k % 2 === 0 ? 1 : -1;
    const xEnd = dir > 0 ? leg : 0;
    for (let s = 0; s < leg; s += nodeStep) pts.push([x + dir * s, z0]);
    x = xEnd;
    // demi-cercle autour de (x, z0 + r)
    const n = Math.max(3, Math.ceil((Math.PI * r) / nodeStep));
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / n;
      pts.push([x + dir * r * Math.cos(a), z0 + r + r * Math.sin(a)]);
    }
  }
  pts.push([x, count * 2 * r]);
  return pts;
}

describe('montées : géométrie des lacets', () => {
  it('détecte chaque épingle et son rayon', () => {
    const raw = switchbacks(5, 150, 8, 0.5);
    const pts = resampleOpen(raw, 2);
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const found = detectHairpins(xs, zs, 2);
    expect(found.length).toBe(5);
    for (const h of found) {
      expect(h.turnDeg).toBeGreaterThan(170);
      expect(h.radiusM).toBeGreaterThan(7.5);
      expect(h.radiusM).toBeLessThan(8.5);
    }
  });

  it('le lissage en plan ne rogne pas les épingles (nœuds OSM espacés de 4 m)', () => {
    const raw = switchbacks(3, 120, 8, 4);
    const edgeOf = raw.slice(1).map(() => 0);
    const fin = smoothOpenPath(raw, edgeOf, 1.5, 2);
    let maxDev = 0;
    for (const p of fin.pts) maxDev = Math.max(maxDev, projectArc(raw, p).d);
    expect(maxDev).toBeLessThan(0.5);
    const xs = fin.pts.map((p) => p[0]);
    const zs = fin.pts.map((p) => p[1]);
    let minR = Infinity;
    for (let i = 2; i < xs.length - 2; i++) minR = Math.min(minR, circumradius(xs, zs, i, 2));
    expect(minR).toBeGreaterThan(6.5);
    expect(minR).toBeLessThan(8.5);
    // pas régulier
    expect(Math.abs(fin.step - 2)).toBeLessThan(0.05);
  });

  it("arrondit un angle de carrefour plus serré que la chaussée, pas un lacet", () => {
    const corner: Pt[] = [
      ...Array.from({ length: 60 }, (_, i) => [i, 0] as Pt),
      ...Array.from({ length: 60 }, (_, i) => [60, i] as Pt),
    ];
    const pts = resampleOpen(corner, 2);
    const out = relaxTightCorners(pts, 4.5, 2);
    expect(out.relaxed).toBeGreaterThan(0);
    const xs = out.pts.map((p) => p[0]);
    const zs = out.pts.map((p) => p[1]);
    let minR = Infinity;
    for (let i = 2; i < xs.length - 2; i++) minR = Math.min(minR, circumradius(xs, zs, i, 2));
    expect(minR).toBeGreaterThanOrEqual(4.5);
    const hp = resampleOpen(switchbacks(2, 100, 8, 0.5), 2);
    expect(relaxTightCorners(hp, 4.5, 2).relaxed).toBe(0);
  });

  it('altitude de la plate-forme malgré un axe OSM décalé sur le talus', () => {
    // plate-forme plate à 100 m sur 7 m de large (offset latéral −3,5…+3,5), talus à 60 % de part et d'autre
    const terrain = (_x: number, z: number) => (Math.abs(z) <= 3.5 ? 100 : 100 + (Math.abs(z) - 3.5) * 0.6 * Math.sign(z));
    const r = platformHeight(terrain, [0, 4.5], [1, 0]);
    expect(r.h).toBeCloseTo(100, 1);
    expect(Math.abs(r.offset)).toBeGreaterThanOrEqual(2);
    // sur l'axe : pas de décalage
    const c = platformHeight(terrain, [0, 0], [1, 0]);
    expect(c.offset).toBe(0);
    expect(c.h).toBeCloseTo(100, 6);
  });

  it('noms courts des panneaux de virage', () => {
    expect(hairpinShortName('Virage de la Savoyâte')).toBe('La Savoyâte');
    expect(hairpinShortName('Virage des Hollandais')).toBe('Les Hollandais');
    expect(hairpinShortName('Virage du Gué')).toBe('Le Gué');
    expect(hairpinShortName('Virage de Saint-Ferréol')).toBe('Saint-Ferréol');
    expect(hairpinShortName("Virage de l'Église")).toBe("L'Église");
  });
});

describe('montées : creusement et encodage', () => {
  it('deux branches de lacet proches : chaussées plates, raccord continu entre elles', () => {
    const N = 61;
    // pente naturelle entre les deux branches (2 m à mi-distance)
    const slope = () => {
      const h = new Float32Array(N * N);
      for (let j = 0; j < N; j++) h.fill(2 + ((j - 27) * 4) / 14, j * N, (j + 1) * N);
      return h;
    };
    const g: Grid = { n: 60, res: 1, x0: 0, z0: 0, h: slope() };
    // branche basse z = 20 à 0 m, branche haute z = 34 à 4 m (même polyligne, reliée par un lacet hors grille)
    const line: CarveLine = {
      pts: [
        [0, 0, 20],
        [60, 0, 20],
        [80, 2, 27],
        [60, 4, 34],
        [0, 4, 34],
      ],
      halfWidth: 3,
      priority: 2,
    };
    carveGridPasses(g, [line], (hw) => 4 + hw, 0);
    expect(gridSample(g, 30, 20)).toBeCloseTo(0, 2);
    expect(gridSample(g, 30, 23)).toBeCloseTo(0, 2);
    expect(gridSample(g, 30, 34)).toBeCloseTo(4, 2);
    expect(gridSample(g, 30, 31)).toBeCloseTo(4, 2);
    // entre les deux : monotone, talus continu (au plus ~1,4 m par mètre, pas de marche)
    let prev = gridSample(g, 30, 23.5);
    for (let z = 24; z <= 30.5; z += 0.5) {
      const v = gridSample(g, 30, z);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-3);
      expect(v - prev).toBeLessThan(0.75);
      prev = v;
    }
    // carveGrid (branche la plus proche) laisse une marche à mi-distance : c'est ce que corrige carveGridPasses
    const g2: Grid = { n: 60, res: 1, x0: 0, z0: 0, h: slope() };
    carveGrid(g2, [line], (hw) => 4 + hw, 0);
    expect(Math.abs(gridSample(g2, 30, 28) - gridSample(g2, 30, 26))).toBeGreaterThan(1.5);
    const maxStep = (gr: Grid) => {
      let m = 0;
      for (let z = 20; z < 34; z += 0.5) m = Math.max(m, Math.abs(gridSample(gr, 30, z + 0.5) - gridSample(gr, 30, z)));
      return m;
    };
    expect(maxStep(g)).toBeLessThan(maxStep(g2));
  });

  it('recolle les morceaux consécutifs d’un couloir', () => {
    const a: CarveLine = { pts: [[0, 0, 0], [10, 1, 0]], halfWidth: 3, priority: 2 };
    const b: CarveLine = { pts: [[10, 1, 0], [20, 2, 0]], halfWidth: 3, priority: 2 };
    const m = mergeChunks([a, b]);
    expect(m.length).toBe(1);
    expect(m[0]!.pts.length).toBe(3);
  });

  it('pas de quantification des tuiles de haute montagne', () => {
    expect(tileStepM(300)).toBe(0.01);
    expect(tileStepM(650)).toBe(0.01);
    expect(tileStepM(900)).toBe(0.02);
    expect(65535 * tileStepM(1300)).toBeGreaterThanOrEqual(1300);
  });
});
