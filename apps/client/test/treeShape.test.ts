import { describe, expect, it } from 'vitest';
import { CONIF_TOP, DECID_FRAC, EDGE_PROBE_M, NEIGHBOUR_R, coniferRadius, coniferShare, crownFit, edgeAt, insideShare, neighbourCounts, openSkirt, openness, seedAt, skirtFrac } from '../src/world/treeShape.ts';

/** P2.3b-1 : arbres LiDAR plus crédibles (?trees=1), fonctions pures. */

describe('crownFit', () => {
  it('descend le houppier des arbres dégagés, garde celui des arbres de cœur de bois', () => {
    const inner = crownFit(15, 4, 0, 0.5);
    const open = crownFit(15, 4, 1, 0.5);
    expect(inner.frac).toBeCloseTo(0.56, 2);
    expect(open.frac).toBeCloseTo(0.8, 2);
    expect(open.radius).toBe(4);
  });
  it('transforme une galette (5 m de haut, 13,8 m de large) en couronne profonde, rayon réduit de 30 % au plus', () => {
    const g = crownFit(5, 6.9, 0.3, 0.5);
    expect(g.frac).toBeCloseTo(0.8, 2);
    expect(g.frac).toBeGreaterThan(DECID_FRAC);
    expect(g.radius).toBeLessThan(6.9);
    expect(g.radius).toBeGreaterThanOrEqual(6.9 * 0.7 - 1e-9);
    // 8 m × 13,8 m : couronne descendue à 85 % (6,8 m), rayon ramené à la profondeur (largeur = 2 × profondeur)
    const h8 = crownFit(8, 6.9, 0.3, 0.5);
    expect(h8.frac).toBeCloseTo(0.85, 2);
    expect(h8.radius).toBeCloseTo(6.8, 5);
    expect(crownFit(15, 4, 0, 0.5).radius).toBe(4);
  });
  it('laisse au moins 1 m de fût et reste dans [0,3 ; 0,85]', () => {
    for (const h of [2, 3, 6, 12, 30])
      for (const room of [0.8, 3, 8])
        for (const open of [0, 0.5, 1])
          for (const j of [0, 1]) {
            const { frac, radius } = crownFit(h, room, open, j);
            expect(frac).toBeGreaterThanOrEqual(0.3);
            expect(frac).toBeLessThanOrEqual(0.85 + 1e-9);
            if (h > 3) expect(h * (1 - frac)).toBeGreaterThanOrEqual(1 - 1e-9);
            expect(radius).toBeGreaterThan(0);
            expect(radius).toBeLessThanOrEqual(room);
          }
  });
});

describe('openness et insideShare', () => {
  it('vaut 1 pour un arbre isolé et 0 au cœur d’un bois de 147 arbres / ha', () => {
    expect(openness(0, 1)).toBe(1);
    const area = Math.PI * NEIGHBOUR_R * NEIGHBOUR_R;
    expect(openness(Math.round(0.0147 * area), 1)).toBe(0);
  });
  it('rapporte la densité à la part du disque vue dans la tuile (pas de fausse lisière au bord)', () => {
    const area = Math.PI * NEIGHBOUR_R * NEIGHBOUR_R;
    const full = Math.round(0.0147 * area);
    expect(insideShare(500, 500, 0, 0, 1000)).toBe(1);
    const edge = insideShare(0.5, 500, 0, 0, 1000);
    expect(edge).toBeCloseTo((NEIGHBOUR_R + 0.5) / (2 * NEIGHBOUR_R), 5);
    expect(openness(Math.round(full * edge), edge)).toBeLessThan(0.1);
  });
});

describe('coniferShare', () => {
  it('≈ 90 % en forêt de conifères, aucun en feuillus, mélange regroupé en forêt mixte', () => {
    expect(coniferShare(1, 0, 2)).toBe(0.9);
    expect(coniferShare(0, 1, 5)).toBe(0);
    expect(coniferShare(0.5, 0, 2)).toBeCloseTo(0.45, 5);
    expect(coniferShare(0.5, -1, 2)).toBeCloseTo(0.05, 5);
    expect(coniferShare(0.5, 1, 2)).toBeCloseTo(0.85, 5);
    expect(coniferShare(0.5, 0, 3)).toBeCloseTo(0.55, 5);
  });
  it('ne classe pas tous les arbres d’une forêt mixte en conifères (tirage par position)', () => {
    let n = 0;
    let c = 0;
    for (let x = 0; x < 300; x += 3.7)
      for (let z = 0; z < 300; z += 4.1) {
        n++;
        if (seedAt(z + 0.71, x - 0.13) < coniferShare(0.5, 0, 2)) c++;
      }
    expect(c / n).toBeGreaterThan(0.35);
    expect(c / n).toBeLessThan(0.55);
  });
  it('rayon d’un conifère borné à 22 % de sa hauteur, 1,2 m au moins', () => {
    expect(coniferRadius(12, 6)).toBeCloseTo(2.64, 5);
    expect(coniferRadius(4, 6)).toBe(1.2);
    expect(coniferRadius(20, 2)).toBe(2);
    expect(CONIF_TOP).toBe(12);
  });
});

describe('déterminisme', () => {
  it('même tirage et mêmes voisins quel que soit l’ordre des arbres', () => {
    const pts: number[] = [];
    for (let k = 0; k < 400; k++) pts.push(seedAt(k, 1) * 200, seedAt(1, k) * 200, 10, 4);
    const a = neighbourCounts(pts);
    const rev: number[] = [];
    for (let k = 399; k >= 0; k--) rev.push(...pts.slice(k * 4, k * 4 + 4));
    const b = neighbourCounts(rev);
    for (let k = 0; k < 400; k++) expect(a[k]).toBe(b[399 - k]);
    expect(seedAt(1234.5, -987.25)).toBe(seedAt(1234.5, -987.25));
  });
  it('compte les voisins à moins de 9 m (brute force)', () => {
    const pts: number[] = [];
    for (let k = 0; k < 300; k++) pts.push(seedAt(k, 7) * 120, seedAt(7, k) * 120, 10, 4);
    const c = neighbourCounts(pts);
    for (let k = 0; k < 300; k += 17) {
      let n = 0;
      for (let o = 0; o < 300; o++) if (o !== k && Math.hypot((pts[o * 4] as number) - (pts[k * 4] as number), (pts[o * 4 + 1] as number) - (pts[k * 4 + 1] as number)) < NEIGHBOUR_R) n++;
      expect(c[k]).toBe(n);
    }
  });
});

describe('lisières (P2.3b-2b)', () => {
  // forêt = demi-plan x < 0 ; route : bande |z − 100| < 3
  const forest = (x: number) => (x < 0 ? 1 : 0);
  const forestAt = (x: number, _z: number) => forest(x);
  const roadAt = (_x: number, z: number) => (Math.abs(z - 100) < 3 ? 1 : 0);
  it('reconnaît un arbre de bord de forêt', () => {
    expect(edgeAt(forestAt, roadAt, -2, 0)).toBe(1);
  });
  it('rien au cœur du bois ni loin de la forêt', () => {
    expect(edgeAt(forestAt, roadAt, -EDGE_PROBE_M * 2, 0)).toBe(0);
    expect(edgeAt(forestAt, roadAt, 8, 0)).toBe(0);
  });
  it('compte le premier rang hors du polygone (à moins de 6 m de la forêt)', () => {
    expect(edgeAt(forestAt, roadAt, 4, 0)).toBe(1);
  });
  it('reconnaît le bord d’un chemin qui traverse le bois', () => {
    expect(edgeAt(forestAt, roadAt, -50, 100 - EDGE_PROBE_M)).toBe(0.5);
  });
  it('jupe : profondeur portée vers 82 % (bas à 0,4 m au moins), sans jamais réduire le houppier', () => {
    expect(skirtFrac(0.6, 15, 0)).toBe(0.6);
    expect(skirtFrac(0.6, 15, 1)).toBeCloseTo(0.82, 5);
    expect(skirtFrac(0.6, 2, 1)).toBeCloseTo(0.8, 5);
    expect(skirtFrac(0.6, 15, 0.5)).toBeCloseTo(0.71, 5);
    expect(skirtFrac(0.85, 2, 1)).toBe(0.85);
    expect(skirtFrac(0.6, 15, 1)).toBeGreaterThan(DECID_FRAC);
  });
});

describe('openSkirt (P2.3b-2b)', () => {
  it('nulle au cœur du bois et pour un arbre isolé, au plus 0,6 pour un arbre à demi dégagé', () => {
    expect(openSkirt(0)).toBe(0);
    expect(openSkirt(0.3)).toBe(0);
    expect(openSkirt(1)).toBe(0);
    expect(openSkirt(0.75)).toBeCloseTo(0.6, 5);
    for (let o = 0; o <= 1; o += 0.05) expect(openSkirt(o)).toBeLessThanOrEqual(0.6 + 1e-9);
  });
});
