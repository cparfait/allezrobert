import { describe, expect, it } from 'vitest';
import { EDGE_FIELD_RES, EDGE_MAX_M, EDGE_MIN_M, decodeEdge, edgeRoads, encodeEdge, exactEdgeDistance, roadEdgeField, sampleEdgeField, type EdgeRoad } from '../src/world/roadEdgeField.ts';
import type { TileRoad } from '../src/world/types.ts';

/** P2.2b : champ de distance au bord de chaussée dessinée (accotements, ?roadedge=1). */

const SIZE = 1000;

function arc(cx: number, cz: number, r: number, a0: number, a1: number, n: number): number[] {
  const p: number[] = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    p.push(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
  }
  return p;
}

/** Erreurs |lu − exact| (m) sur des points tirés dans la bande −0,5…3 m du bord. */
function errors(roads: EdgeRoad[], res = EDGE_FIELD_RES): number[] {
  const f = roadEdgeField(0, 0, SIZE, roads, res);
  let s = 99;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out: number[] = [];
  for (let k = 0; k < 200000 && out.length < 4000; k++) {
    const x = rnd() * SIZE;
    const z = rnd() * SIZE;
    const e = exactEdgeDistance(roads, x, z);
    if (e < -0.5 || e > 3) continue;
    out.push(Math.abs(sampleEdgeField(f, res, 0, 0, SIZE, x, z) - e));
  }
  return out.sort((a, b) => a - b);
}
const p95 = (a: number[]) => a[Math.floor(a.length * 0.95)] as number;

describe('roadEdgeField', () => {
  it('encode sur un octet à moins de 2 cm près, dans [EDGE_MIN_M, EDGE_MAX_M]', () => {
    for (let d = EDGE_MIN_M; d <= EDGE_MAX_M; d += 0.037) expect(Math.abs(decodeEdge(encodeEdge(d)) - d)).toBeLessThan(0.016);
    expect(encodeEdge(-50)).toBe(0);
    expect(encodeEdge(50)).toBe(255);
  });
  it('localise le bord d’une route droite oblique à quelques centimètres (512²)', () => {
    const e = errors([{ pts: [100, 100, 900, 703], half: 3.1 }]);
    expect(e.length).toBeGreaterThan(1000);
    expect(p95(e)).toBeLessThan(0.03);
  });
  it('suit un virage de 40 m et une route étroite', () => {
    expect(p95(errors([{ pts: arc(500, 500, 40, 0, Math.PI * 1.5, 60), half: 3.1 }]))).toBeLessThan(0.06);
    expect(p95(errors([{ pts: [50, 700.7, 950, 690.2], half: 1.85 }]))).toBeLessThan(0.03);
  });
  it('reste juste au carrefour, hors des angles rentrants (95 % des points)', () => {
    const e = errors([
      { pts: [0, 400, 1000, 400], half: 3.1 },
      { pts: [500.4, 400, 500.4, 900], half: 2.6 },
    ]);
    expect(p95(e)).toBeLessThan(0.03);
  });
  it('vaut EDGE_MAX_M loin des routes et est négatif sur la chaussée', () => {
    const roads = [{ pts: [0, 500, 1000, 500], half: 3.1 }];
    const f = roadEdgeField(0, 0, SIZE, roads, EDGE_FIELD_RES);
    expect(sampleEdgeField(f, EDGE_FIELD_RES, 0, 0, SIZE, 400, 100)).toBeCloseTo(EDGE_MAX_M, 1);
    // sur l'axe, la lecture bilinéaire arrondit la pointe du « V » (nœuds à 2 m) : ≈ −2,1 m au lieu de −3,1 m, sous l'enrobé
    expect(sampleEdgeField(f, EDGE_FIELD_RES, 0, 0, SIZE, 400, 500)).toBeLessThan(-1.5);
  });
  it('donne les mêmes valeurs sur le bord commun de deux tuiles voisines', () => {
    const road = { pts: [900, 200, 1100, 260], half: 3.1 };
    const a = roadEdgeField(0, 0, SIZE, [road], EDGE_FIELD_RES);
    const b = roadEdgeField(SIZE, 0, SIZE, [road], EDGE_FIELD_RES);
    for (let j = 0; j < EDGE_FIELD_RES; j++) expect(a[j * EDGE_FIELD_RES + EDGE_FIELD_RES - 1]).toBe(b[j * EDGE_FIELD_RES]);
  });
});

describe('edgeRoads', () => {
  const road = (o: Partial<TileRoad>): TileRoad => ({ kind: 'secondary', width: 5, pts: [0, 0, 10, 0], pts3: [0, 1, 0, 10, 1, 0], ...o });
  it('garde les routes dessinées par le réseau, bord à demi-largeur + 0,6 m', () => {
    const r = edgeRoads([road({}), road({ width: 1 })]);
    expect(r.map((x) => x.half)).toEqual([3.1, 1.85]);
  });
  it('écarte tunnels, ponts, voies non dessinées et routes sans profil', () => {
    expect(edgeRoads([road({ tunnel: true }), road({ bridge: true }), road({ kind: 'footway' }), road({ kind: 'path' }), road({ pts3: undefined })])).toEqual([]);
  });
  it('garde les pistes cyclables en monde ouvert seulement', () => {
    expect(edgeRoads([road({ kind: 'cycleway' })], true)).toHaveLength(1);
    expect(edgeRoads([road({ kind: 'cycleway' })], false)).toHaveLength(0);
  });
});
