import { describe, expect, it } from 'vitest';
import { l93ToWgs84 } from '@allezrobert/shared';
import { FRANCE_OUTLINE } from '../src/world/franceOutline.ts';
import { ZONE_SPOTS } from '../src/world/zoneMap.ts';
import { WORLD_LIST } from '../src/world/worlds.ts';

/** Point dans un polygone (lon, lat), par parité des croisements. */
function inside(lon: number, lat: number, ring: Array<[number, number]>): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

describe('carte de France des zones', () => {
  it('chaque zone du menu a sa place sur la carte', () => {
    for (const w of WORLD_LIST) expect(ZONE_SPOTS.some((s) => s.id === w.id), w.id).toBe(true);
    expect(new Set(ZONE_SPOTS.map((s) => s.id)).size).toBe(ZONE_SPOTS.length);
  });

  it('chaque zone tombe dans le contour de la France (continent, Corse ou île)', () => {
    for (const s of ZONE_SPOTS) {
      const p = l93ToWgs84(s.x, s.y);
      // Continent, Corse ou île : un point en mer ou hors de France n'est dans aucun contour.
      expect(FRANCE_OUTLINE.some((ring) => inside(p.lon, p.lat, ring)), s.id).toBe(true);
    }
  });

  it('le contour est fermé et repère quelques villes', () => {
    for (const ring of FRANCE_OUTLINE) expect(ring[0]).toEqual(ring[ring.length - 1]);
    // Paris, Lyon, Toulouse, Brest dedans ; Londres, Genève, Barcelone, Ajaccio (Corse) hors du continent
    expect([[2.35, 48.86], [4.83, 45.76], [1.44, 43.6], [-4.48, 48.39]].every(([lon, lat]) => inside(lon!, lat!, FRANCE_OUTLINE[0]!))).toBe(true);
    expect([[-0.13, 51.5], [6.15, 46.2], [2.17, 41.39], [8.74, 41.93]].some(([lon, lat]) => inside(lon!, lat!, FRANCE_OUTLINE[0]!))).toBe(false);
    expect(inside(8.74, 41.93, FRANCE_OUTLINE[1]!)).toBe(true);
  });
});
