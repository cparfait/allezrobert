import { describe, expect, it } from 'vitest';
import { RoadGraph } from '../src/graph.ts';
import { cyclePolyline } from '../src/loop.ts';
import type { RoadWay } from '../src/osm.ts';
import { closeWalk, matchWalk } from '../src/ridematch.ts';
import { harmonizeOverlaps } from '../src/route.ts';
import { polylineLength, type Pt } from '../src/geom.ts';

/** Quadrillage de rues : nœud (i, j) = id 100·i + j, à (i·S, j·S). */
function gridGraph(n: number, S: number): RoadGraph {
  const roads: RoadWay[] = [];
  let id = 1;
  const way = (nodes: number[], pts: Pt[]): RoadWay => ({
    id: id++,
    kind: 'tertiary',
    name: '',
    ref: '',
    width: 6,
    surface: 'asphalt',
    paved: true,
    lanes: 2,
    oneway: 0,
    bridge: false,
    tunnel: false,
    layer: 0,
    nodes,
    pts,
  });
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    const rp: Pt[] = [];
    const col: number[] = [];
    const cp: Pt[] = [];
    for (let j = 0; j < n; j++) {
      row.push(100 * j + i);
      rp.push([j * S, i * S]);
      col.push(100 * i + j);
      cp.push([i * S, j * S]);
    }
    roads.push(way(row, rp), way(col, cp));
  }
  return new RoadGraph(roads, () => true);
}

/** Trace GPS bruitée (pas de 4 m, bruit ±4 m déterministe) le long d'une polyligne. */
function noisyTrack(pts: Pt[]): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  let k = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1]!;
    const [bx, bz] = pts[i]!;
    const L = Math.hypot(bx - ax, bz - az);
    for (let s = 0; s < L; s += 4, k++) {
      const t = s / L;
      out.push({ x: ax + (bx - ax) * t + 4 * Math.sin(k * 1.3), z: az + (bz - az) * t + 4 * Math.cos(k * 0.7) });
    }
  }
  out.push({ x: pts[pts.length - 1]![0], z: pts[pts.length - 1]![1] });
  return out;
}

describe('itinéraire fidèle à une sortie', () => {
  const S = 200;
  const g = gridGraph(5, S);

  it('recale une trace bruitée en une marche ordonnée, sans perte de longueur', () => {
    // (0,0) → (600,0) → (600,400) → (200,400) : 1 400 m
    const path: Pt[] = [
      [0, 0],
      [600, 0],
      [600, 400],
      [200, 400],
    ];
    const w = matchWalk(g, noisyTrack(path));
    expect(w).not.toBeNull();
    expect(w!.lengthM).toBeCloseTo(1400, 0);
    expect(Math.abs(w!.matchedM - 1400)).toBeLessThan(14);
    expect(w!.spursM).toBe(0);
    // nœud (x, z) = 100·x/S + z/S
    expect(w!.nodes[0]).toBe(0);
    expect(w!.nodes[w!.nodes.length - 1]).toBe(102);
    // marche continue : chaque arête part du nœud où s'arrête la précédente
    for (let i = 0; i < w!.edges.length; i++) {
      const e = g.edges[w!.edges[i]!]!;
      expect([e.a, e.b]).toContain(w!.nodes[i]);
      expect([e.a, e.b]).toContain(w!.nodes[i + 1]);
    }
  });

  it('retire un aller-retour et referme la boucle par le plus court chemin', () => {
    // aller jusqu'à (800,0), demi-tour jusqu'à (600,0), puis (600,400) → (0,400)
    const path: Pt[] = [
      [0, 0],
      [800, 0],
      [600, 0],
      [600, 400],
      [0, 400],
    ];
    const w = matchWalk(g, noisyTrack(path));
    expect(w).not.toBeNull();
    expect(Math.abs(w!.spursM - 400)).toBeLessThan(20);
    expect(w!.lengthM).toBeCloseTo(1600, 0);
    const c = closeWalk(g, w!, (e) => e.len);
    expect(c).not.toBeNull();
    expect(c!.closureM).toBeCloseTo(400, 0);
    expect(c!.keptM).toBeCloseTo(1600, 0);
    const poly = cyclePolyline(g, c!.cycle);
    expect(polylineLength([...poly.pts, poly.pts[0]!])).toBeCloseTo(2000, 0);
    expect(c!.cycle.nodes[0]).toBe(c!.cycle.nodes[c!.cycle.nodes.length - 1]);
  });

  it('donne une seule altitude aux passages répétés sur la même arête', () => {
    // les indices 0–99 et 200–299 sont superposés (même arête 7), à 100 m puis 101,5 m ;
    // les liaisons 100–199 et 300–399 montent / descendent régulièrement
    const n = 400;
    const xs: number[] = [];
    const zs: number[] = [];
    const hs: number[] = [];
    const edgeOf: number[] = [];
    for (let i = 0; i < n; i++) {
      const over = i < 100 ? i : i >= 200 && i < 300 ? i - 200 : -1;
      xs.push(over >= 0 ? over * 2 : 1000 + i);
      zs.push(over >= 0 ? 0 : 500 + i);
      hs.push(i < 100 ? 100 : i < 200 ? 100 + (1.5 * (i - 100)) / 100 : i < 300 ? 101.5 : 101.5 - (1.5 * (i - 300)) / 100);
      edgeOf.push(over >= 0 ? 7 : i);
    }
    const h = harmonizeOverlaps(xs, zs, hs, edgeOf, 2);
    expect(Math.abs(h[50]! - h[250]!)).toBeLessThan(0.05);
    // pas de marche brusque au bord des tronçons communs
    for (let i = 0; i < n; i++) expect(Math.abs(h[(i + 1) % n]! - h[i]!)).toBeLessThan(0.1);
  });
});
