import { RoadNet, type RoadGraphData, type RoadGraphEdge, type WorldPlace } from '@allezrobert/shared';
import { describe, expect, it } from 'vitest';
import { buildCityRoute, cityRouteId, cityStages, parseCityRouteId, tourStops } from '../src/game/tourRoutes.ts';

/** Quadrillage de routes de 5 km (6 × 6 carrefours), une colline au nord-est, un chemin en travers. */
function zone(): { net: RoadNet; places: WorldPlace[] } {
  const N = 6;
  const S = 5000;
  const y = (x: number, z: number) => 20 + 500 * Math.exp(-((x - 25_000) ** 2 + z ** 2) / 4e7);
  const nodes: number[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) nodes.push(i * S, y(i * S, j * S), j * S);
  const edges: RoadGraphEdge[] = [];
  const road = (a: number, b: number, surface = 'asphalt') => {
    const pts: number[] = [];
    for (let k = 0; k <= 250; k++) {
      const t = k / 250;
      const x = (nodes[a * 3] as number) * (1 - t) + (nodes[b * 3] as number) * t;
      const z = (nodes[a * 3 + 2] as number) * (1 - t) + (nodes[b * 3 + 2] as number) * t;
      pts.push(x, y(x, z), z);
    }
    edges.push({ a, b, kind: surface === 'asphalt' ? 'tertiary' : 'track', width: 6, surface, oneway: 0, len: S, pts });
  };
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      if (i + 1 < N) road(j * N + i, j * N + i + 1);
      if (j + 1 < N) road(j * N + i, (j + 1) * N + i);
    }
  road(0, 14, 'gravel');
  const place = (name: string, i: number, j: number, kind = 'village'): WorldPlace => ({ name, kind, x: i * S, z: j * S });
  const places = [place('Bourg', 2, 3, 'town'), place('Aval', 0, 5), place('Bief', 1, 2), place('Cerisy', 4, 4), place('Dun', 5, 2), place('Estrée', 3, 1), place('Frênes', 0, 1), place('Phare du Nord', 5, 0, 'locality'), place('Résidence 4', 2, 2, 'hamlet')];
  return { net: new RoadNet({ formatVersion: 1, nodes, edges, attribution: [] } as RoadGraphData), places };
}

describe('étapes de ville en ville', () => {
  const { net, places } = zone();

  it('villes d’étape : la plus grande d’abord, un sommet, pas de résidence', () => {
    const s = tourStops(net, places);
    expect(s[0]?.name).toBe('Bourg');
    expect(s.find((x) => x.summit)?.name).toBe('Phare du Nord');
    expect(s.some((x) => x.name === 'Résidence 4')).toBe(false);
  });

  it('jamais de boucle, étapes qui s’enchaînent, arrivée finale dans la plus grande ville', () => {
    for (let seed = 0; seed < 12; seed++)
      for (let n = 2; n <= 7; n++) {
        const st = cityStages(net, places, { stages: n, tt: 'prologue', length: 'medium', seed }) ?? [];
        expect(st).toHaveLength(n);
        for (const [i, s] of st.entries()) {
          const p = parseCityRouteId(s.routeId) ?? [];
          const a = p[0];
          const b = p.at(-1);
          expect(Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.z ?? 0) - (b?.z ?? 0))).toBeGreaterThan(1000);
          expect(s.laps).toBe(1);
          // La veille finissait ici, sauf arrivée au sommet (transfert).
          const before = st[i - 1];
          if (before && !before.name.endsWith('Phare du Nord')) expect(parseCityRouteId(before.routeId)?.at(-1)).toEqual(a);
        }
      }
  });

  it('même tirage, mêmes étapes ; autre tirage, autre tour', () => {
    const o = { stages: 4, tt: 'prologue', length: 'medium', seed: 3 } as const;
    expect(cityStages(net, places, o)).toEqual(cityStages(net, places, o));
    const tours = new Set(Array.from({ length: 8 }, (_, seed) => JSON.stringify(cityStages(net, places, { ...o, seed })?.map((s) => s.routeId))));
    expect(tours.size).toBeGreaterThan(3);
  });

  it('une étape se reconstruit par son identifiant, sur route, sans demi-tour', () => {
    const st = cityStages(net, places, { stages: 5, tt: 'two', length: 'medium', seed: 1 }) ?? [];
    for (const s of st) {
      const r = buildCityRoute(new RoadNet(net.data), places, s.routeId);
      expect(r?.id).toBe(s.routeId);
      expect(r?.loop).toBe(false);
      expect(Math.round(r?.lengthM ?? 0)).toBe(s.lengthM);
      expect(r?.surfaces?.every((x) => x.surface === 'asphalt')).toBe(true);
    }
    expect(buildCityRoute(net, places, 'anneau')).toBeNull();
    expect(parseCityRouteId('itineraire-lx2k')).toBeNull();
    expect(cityRouteId([{ x: -12.4, z: 3 }, { x: 5, z: -7.6 }])).toBe('itineraire-tour--12_3.5_-8');
    expect(parseCityRouteId('itineraire-tour--12_3.5_-8')).toEqual([{ x: -12, z: 3 }, { x: 5, z: -8 }]);
  });

  it('zone avec moins de trois villes : pas d’étapes de ville en ville', () => {
    expect(cityStages(net, places.slice(0, 2), { stages: 3, tt: 'none', length: 'short', seed: 0 })).toBeNull();
    expect(cityStages(net, [], { stages: 3, tt: 'none', length: 'short', seed: 0 })).toBeNull();
  });
});
