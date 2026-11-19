import { describe, expect, it, vi } from 'vitest';
import { Raycaster, Vector3 } from 'three/webgpu';
import { Buildings } from '../src/world/buildings.ts';
import { createEiffelTower, EIFFEL_SITE, isEiffelSourceBuilding } from '../src/world/parisEiffel.ts';
import { emptyFeatures, type LoadedTile } from '../src/world/types.ts';

vi.mock('../src/engine/style.ts', () => ({ LOW_POLY: true }));

const owner: LoadedTile = {
  id: '0_5', tx: 0, tz: 5, x0: 0, z0: 5000, size: 1000,
  n: 1, heights: new Float32Array([34, 34, 34, 34]), features: emptyFeatures(),
  buildingSource: { worldId: 'idf-paris', tileId: '0_5' },
};

describe('Tour Eiffel dans Paris low-poly', () => {
  it('modélise quatre pieds à l’échelle et culmine à 330 mètres', () => {
    const mesh = createEiffelTower();
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox!;
    expect(bounds.max.y).toBeCloseTo(330);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThanOrEqual(125);
    expect(bounds.max.z - bounds.min.z).toBeGreaterThanOrEqual(125);
    const positions = mesh.geometry.getAttribute('position');
    expect(positions.count).toBe(mesh.geometry.getAttribute('color').count);
    expect(positions.count / 3).toBeLessThan(26_000);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });

  it('laisse le centre du premier étage ouvert entre les deux pavillons', () => {
    const tower = createEiffelTower();
    const ray = new Raycaster(new Vector3(0, 65, 0), new Vector3(0, -1, 0), 0, 11);
    expect(ray.intersectObject(tower)).toHaveLength(0);
    ray.ray.origin.z = 24;
    expect(ray.intersectObject(tower).length).toBeGreaterThan(0);
    tower.geometry.dispose();
    tower.material.dispose();
  });

  it('pose la tour une seule fois, puis libère son maillage au déchargement', () => {
    const buildings = new Buildings(() => 34);
    buildings.setWorld('idf-paris');
    buildings.addTile({ ...owner, buildingSource: { worldId: 'idf-montreuil', tileId: '0_5' } });
    buildings.addTile({ ...owner, id: '0_4', tz: 4, z0: 4000 });
    expect(buildings.group.children).toHaveLength(0);
    buildings.addTile(owner);
    buildings.addTile(owner);
    const mesh = buildings.group.getObjectByName('tour-eiffel')! as ReturnType<typeof createEiffelTower>;
    expect(mesh.position.toArray()).toEqual([EIFFEL_SITE.x, 34, EIFFEL_SITE.z]);
    expect(buildings.group.children).toHaveLength(1);
    const disposed = vi.spyOn(mesh.geometry, 'dispose');
    buildings.removeTile(owner);
    expect(buildings.group.children).toHaveLength(0);
    expect(disposed).toHaveBeenCalledOnce();
    buildings.addTile(owner);
    expect(buildings.group.getObjectByName('tour-eiffel')).not.toBe(mesh);
    buildings.removeTile(owner);
  });

  it('écarte uniquement les quatre volumes génériques connus de la tour', () => {
    expect(isEiffelSourceBuilding('bdtopo:BATIMENT0000000000162158')).toBe(true);
    expect(isEiffelSourceBuilding('bdtopo:BATIMENT0000000000162699')).toBe(true);
    expect(isEiffelSourceBuilding('bdtopo:BATIMENT0000000000162164')).toBe(false);
  });
});
