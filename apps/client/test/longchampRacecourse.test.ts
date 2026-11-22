import { describe, expect, it } from 'vitest';
import { Buildings } from '../src/world/buildings.ts';
import {
  buildLongchampRails, createLongchampBuildings, GRANDSTAND, GRANDSTAND_SITE, grandstandGeometry, hasLongchampRails,
  isLongchampSourceBuilding, millGeometry, ownsLongchampBuildings, TRACK_RINGS,
} from '../src/world/longchampRacecourse.ts';
import { emptyFeatures, type LoadedTile } from '../src/world/types.ts';

const tile = (tx: number, tz: number, worldId = 'longchamp'): LoadedTile => ({
  id: `${tx}_${tz}`, tx, tz, x0: tx * 1000, z0: tz * 1000, size: 1000,
  n: 1, heights: new Float32Array([30, 30, 30, 30]), features: emptyFeatures(),
  buildingSource: { worldId, tileId: `${tx}_${tz}` },
});

describe('Hippodrome de Longchamp', () => {
  it('donne à la tribune son gabarit publié : 23 m de haut, environ 160 m de long', () => {
    const g = grandstandGeometry();
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.y).toBeGreaterThan(GRANDSTAND.heightM - 0.1);
    expect(b.max.y).toBeLessThan(GRANDSTAND.heightM + 3);
    expect(b.max.x - b.min.x).toBeGreaterThan(158);
    expect(b.max.x - b.min.x).toBeLessThan(182);
    expect(g.getAttribute('position').count).toBe(g.getAttribute('color').count);
    g.dispose();
  });

  it('modélise un moulin de 13 m avec des ailes plus larges que la tour', () => {
    const g = millGeometry();
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.y).toBeGreaterThan(12.5);
    expect(b.max.x - b.min.x).toBeGreaterThan(10);
    g.dispose();
  });

  it('pose les volumes sur le sol de la tuile de la tribune, en un seul maillage léger', () => {
    expect(ownsLongchampBuildings(tile(-1, -1), 'longchamp')).toBe(true);
    expect(ownsLongchampBuildings(tile(-1, 0), 'longchamp')).toBe(false);
    expect(ownsLongchampBuildings(tile(-1, -1, 'idf-paris'), 'idf-paris')).toBe(false);
    const mesh = createLongchampBuildings(() => 30)!;
    expect(mesh.geometry.getAttribute('position').count / 3).toBeLessThan(3000);
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.min.y).toBeLessThanOrEqual(30);
    expect(mesh.geometry.boundingBox!.max.y).toBeGreaterThan(30 + GRANDSTAND.heightM);
    expect(createLongchampBuildings(() => Number.NaN)).toBeNull();
    mesh.geometry.dispose();
    mesh.material.dispose();
  });

  it('masque seulement les emprises remplacées', () => {
    expect(isLongchampSourceBuilding('bdtopo:BATIMENT0000000356853849')).toBe(true);
    expect(isLongchampSourceBuilding('bdtopo:BATIMENT0000002011657910')).toBe(false);
    expect(isLongchampSourceBuilding(undefined)).toBe(false);
  });

  it('répartit les lices entre les tuiles sans en perdre ni en doubler, sous 35 000 triangles', () => {
    let length = 0;
    for (const ring of TRACK_RINGS) {
      const n = ring.length / 2;
      for (let i = 0; i < n; i++) length += Math.hypot(ring[((i + 1) % n) * 2]! - ring[i * 2]!, ring[((i + 1) % n) * 2 + 1]! - ring[i * 2 + 1]!);
    }
    let triangles = 0;
    for (const [tx, tz] of [[-1, -1], [-1, 0], [0, -1], [0, 0]] as const) {
      expect(hasLongchampRails(tile(tx, tz), 'longchamp')).toBe(true);
      const g = buildLongchampRails(tile(tx, tz), () => 30)!;
      triangles += g.getAttribute('position').count / 3;
      expect(g.getAttribute('railOffset').count).toBe(g.getAttribute('position').count);
      g.dispose();
    }
    expect(hasLongchampRails(tile(2, 2), 'longchamp')).toBe(false);
    expect(buildLongchampRails(tile(2, 2), () => 30)).toBeNull();
    // 16 triangles par tronçon de 5 m environ (lisse + poteau).
    expect(triangles).toBeGreaterThan((length / 6) * 16);
    expect(triangles).toBeLessThan(35_000);
  });

  it('ajoute l’hippodrome à la tuile puis le libère au déchargement', () => {
    const buildings = new Buildings(() => 30);
    buildings.setWorld('longchamp');
    const t = tile(-1, -1);
    buildings.addTile(t);
    buildings.addTile(t);
    const names = buildings.group.children.map((c) => c.name);
    expect(names.filter((n) => n === 'hippodrome-longchamp')).toHaveLength(1);
    expect(names.filter((n) => n === 'lices-longchamp')).toHaveLength(1);
    const volumes = buildings.group.children.find((c) => c.name === 'hippodrome-longchamp')!;
    expect(volumes.position.x).toBe(0);
    expect(GRANDSTAND_SITE.x).toBeLessThan(0);
    buildings.removeTile(t);
    expect(buildings.group.children.filter((c) => /longchamp/.test(c.name))).toHaveLength(0);
  });
});
