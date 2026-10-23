import { describe, expect, it } from 'vitest';
import type { RoadGraphData, WorldCatalogue } from '@allezrobert/shared';
import { compositeId, createCompositeWorld, neighbourZones } from '../src/world/composite.ts';
import { emptyFeatures, type LoadedTile, type WorldSource } from '../src/world/types.ts';

const zone = (id: string, minE: number, minN: number, maxE: number, maxN: number, open = true): WorldCatalogue['zones'][number] => ({
  id,
  name: id,
  routes: [],
  pack: null,
  l93: { minE, minN, maxE, maxN },
  ...(open ? { open: true as const } : {}),
});

describe('neighbourZones', () => {
  const cat: WorldCatalogue = {
    formatVersion: 1,
    zones: [
      zone('meudon', 639000, 6852000, 649000, 6859000),
      zone('longchamp', 641000, 6859000, 647000, 6865000), // bord commun de 6 km au nord
      zone('vincennes', 657000, 6855000, 663000, 6861000), // à 8 km : pas voisine
      zone('coin', 649000, 6859000, 652000, 6862000), // un seul point commun
      zone('chevreuse', 609000, 6835000, 642000, 6852000, false), // pas ouverte
      zone('dessus', 645000, 6850000, 655000, 6855000), // chevauchement
    ],
  };
  it('garde les zones ouvertes qui touchent ou chevauchent', () => {
    expect(neighbourZones(cat, 'meudon').sort()).toEqual(['dessus', 'longchamp']);
    expect(neighbourZones(cat, 'vincennes')).toEqual([]);
    expect(compositeId(['meudon', 'longchamp'])).toBe('meudon+longchamp');
  });
});

/** Zone de 2 × 1 tuiles d'1 km, une route est-ouest (nœuds OSM 1, 2, 3) dont l'arête est au bord. */
function source(id: string, origin: { x: number; y: number }, graph: RoadGraphData): WorldSource {
  return {
    id,
    name: id,
    tileSize: 1000,
    bounds: { minX: 0, minZ: 0, maxX: 2000, maxZ: 1000 },
    routes: [],
    attribution: [id],
    originL93: origin,
    open: { graph, fullGraph: graph, start: { x: 0, z: 0 }, places: [{ name: id, kind: 'town', x: 500, z: 500 }] },
    hasTile: (tx, tz) => tx >= 0 && tx < 2 && tz === 0,
    async loadTile(tx, tz): Promise<LoadedTile> {
      const f = emptyFeatures();
      f.pois.push({ kind: 'peak', name: id, x: tx * 1000 + 10, y: 0, z: 20 });
      return { id: `${tx}_${tz}`, tx, tz, x0: tx * 1000, z0: tz * 1000, size: 1000, n: 1, heights: new Float32Array(4), features: f };
    },
  };
}

const edge = (a: number, b: number, x0: number, x1: number, border = false) => ({
  a,
  b,
  kind: 'residential',
  width: 5,
  surface: 'asphalt',
  oneway: 0 as const,
  len: Math.abs(x1 - x0),
  pts: [x0, 100, 500, x1, 100, 500],
  ...(border ? { border: 1 as const } : {}),
});

describe('createCompositeWorld', () => {
  // zone A : E 0–2 km ; zone B juste à l'est : E 2–4 km (même N) ; route continue OSM 1 → 2 → 3
  const a = source('a', { x: 0, y: 1000 }, { formatVersion: 1, nodes: [100, 100, 500, 1900, 100, 500, 2100, 100, 500], osm: [1, 2, 3], edges: [edge(0, 1, 100, 1900), edge(1, 2, 1900, 2100, true)], attribution: [] });
  const b = source('b', { x: 2000, y: 1000 }, { formatVersion: 1, nodes: [-100, 100, 500, 100, 100, 500, 1900, 100, 500], osm: [2, 3, 4], edges: [edge(0, 1, -100, 100, true), edge(1, 2, 100, 1900)], attribution: [] });
  const w = createCompositeWorld([a, b]);

  it('réunit les emprises et décale les tuiles de la voisine', async () => {
    expect(w.id).toBe('a');
    expect(w.zones).toEqual(['a', 'b']);
    expect(w.bounds).toEqual({ minX: 0, minZ: 0, maxX: 4000, maxZ: 1000 });
    expect(w.hasTile(3, 0)).toBe(true);
    expect(w.hasTile(4, 0)).toBe(false);
    const t = await w.loadTile(3, 0);
    expect(t?.x0).toBe(3000);
    expect(t?.features.pois[0]?.x).toBe(3010);
    expect(w.open?.places?.map((p) => p.x)).toEqual([500, 2500]);
  });

  it('raccorde les graphes par les nœuds OSM, sans doublon ni cul-de-sac au bord', () => {
    const g = w.open!.graph;
    // 1 → 2 (A), 2 → 3 (arête au bord, une seule fois), 3 → 4 (B) ; nœuds 1, 2, 3, 4
    expect(g.nodes.length / 3).toBe(4);
    expect(g.edges.length).toBe(3);
    expect(g.edges.every((e) => !e.border)).toBe(true);
    const ends = g.edges.map((e) => [e.pts[0], e.pts[e.pts.length - 3]]);
    expect(ends).toEqual([
      [100, 1900],
      [1900, 2100],
      [2100, 3900],
    ]);
    // la route passe d'une zone à l'autre : le nœud 3 (x = 2100) est partagé
    const shared = g.edges.filter((e) => e.a === 2 || e.b === 2);
    expect(shared.length).toBe(2);
  });
});
