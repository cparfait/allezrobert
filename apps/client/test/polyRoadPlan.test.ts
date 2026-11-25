import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RoadGraphData } from '@allezrobert/shared';
import { planRoadsNow, type PlanPlace, type RoadCell } from '../src/world/polyRoadPlan.ts';

const dir = resolve(import.meta.dirname, '../public/worlds/ile-de-robert');
const graph = JSON.parse(readFileSync(resolve(dir, 'graph.json'), 'utf8')) as RoadGraphData;
const places = JSON.parse(readFileSync(resolve(dir, 'places.json'), 'utf8')) as PlanPlace[];
const plan = planRoadsNow(graph, places);
const all = <K extends keyof RoadCell>(k: K) => [...plan.cells.values()].flatMap((c) => c[k] as unknown[]) as RoadCell[K];

/** Tronçons rangés par case de 16 m : seules les chaussées proches d'un point sont mesurées. */
const CELL = 16;
const grid = new Map<string, number[]>();
for (const e of graph.edges)
  for (let i = 0; i + 5 < e.pts.length; i += 3) {
    const k = `${Math.floor(e.pts[i]! / CELL)}_${Math.floor(e.pts[i + 2]! / CELL)}`;
    const cell = grid.get(k) ?? [];
    cell.push(e.pts[i]!, e.pts[i + 2]!, e.pts[i + 3]!, e.pts[i + 5]!, e.width / 2);
    grid.set(k, cell);
  }

/** Distance au bord de la chaussée la plus proche (négative : dessus). */
function roadGap(x: number, z: number): number {
  let best = Infinity;
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  for (let gx = cx - 1; gx <= cx + 1; gx++)
    for (let gz = cz - 1; gz <= cz + 1; gz++) {
      const c = grid.get(`${gx}_${gz}`) ?? [];
      for (let o = 0; o < c.length; o += 5) {
        const [ax, az, bx, bz, half] = [c[o]!, c[o + 1]!, c[o + 2]!, c[o + 3]!, c[o + 4]!];
        const L = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
        const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L));
        best = Math.min(best, Math.hypot(ax + (bx - ax) * t - x, az + (bz - az) * t - z) - half);
      }
    }
  return best;
}

describe("signalisation de l'île", () => {
  it('pose toute la famille de panneaux', () => {
    const kinds = new Map<string, number>();
    for (const s of all('signs')) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
    for (const k of ['stop', 'yield', 'priority', 'crossing', 'curveLeft', 'curveRight', 'descent', 'climb', 'zone30', 'pedestrians', 'cycleway', 'chevronLeft', 'chevronRight']) expect(kinds.get(k) ?? 0, k).toBeGreaterThan(3);
    expect(all('panels').length).toBeGreaterThan(100);
    expect(all('towns').length).toBeGreaterThan(10);
  });

  it('ne met aucun pied de panneau sur une chaussée', () => {
    const spots = [...all('signs'), ...all('panels'), ...all('towns'), ...all('posts')];
    expect(spots.filter((s) => roadGap(s.x, s.z) < 0.25)).toEqual([]);
  });

  it('écrit des destinations utiles, la plus proche avant les autres dans chaque sens', () => {
    for (const p of all('panels')) {
      expect(p.lines.length).toBeGreaterThan(1);
      expect(new Set(p.lines.map((l) => l.place)).size).toBe(p.lines.length);
      for (const arrow of ['left', 'straight', 'right']) {
        const km = p.lines.filter((l) => l.arrow === arrow).map((l) => l.km);
        expect(km).toEqual([...km].sort((a, b) => a - b));
      }
    }
  });

  it('garde la peinture sur la chaussée', () => {
    const marks = all('marks');
    let off = 0;
    for (let i = 0; i < marks.length; i += 9 * 97) if (roadGap(marks[i]!, marks[i + 2]!) > 0.05) off++;
    expect(off).toBe(0);
  });
});
