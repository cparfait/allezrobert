import { describe, expect, it } from 'vitest';
import { Mesh, Raycaster, Vector3 } from 'three/webgpu';
import { Buildings } from '../src/world/buildings.ts';
import { urbanRoofPlan } from '../src/world/urbanRoof.ts';
import { roofBuffers } from '../src/world/roofs.ts';
import { emptyFeatures, type LoadedTile, type TileBuilding } from '../src/world/types.ts';

// Façade de rue et deux ailes autour d'une cour ouverte.
const footprint = [10, 10, 34, 10, 34, 34, 28, 34, 28, 19, 16, 19, 16, 34, 10, 34];
const building: TileBuilding = {
  pts: footprint, height: 19, y: 30, kind: 'house', levels: 5, roof: 'gabled', roofHeight: 2.6, roofMaterial: 'metal', bdtopo: true,
};

describe('Toits de zinc et d’ardoise à Paris', () => {
  it('forme un terrasson en retrait et garde la cour ouverte', () => {
    const result = urbanRoofPlan(building, 'metal', 19, 0.16, true);
    expect(result).not.toBeNull();
    if (!result) throw new Error('Plan du toit absent');
    const { plan, height } = result;
    const pitch = Math.atan(height / (plan.tEnd - plan.overhang)) * 180 / Math.PI;
    const roof = roofBuffers(plan, 46.4, pitch).roof;
    const flatTriangles = Array.from({ length: roof.pos.length / 9 }, (_, i) => i * 9).filter(
      (i) => [1, 4, 7].every((k) => Math.abs(roof.pos[i + k]! - 49) < 1e-5),
    );
    expect(flatTriangles.length).toBeGreaterThan(0);
    expect(plan.gables).toHaveLength(0);
    expect(plan.tEnd - plan.overhang).toBeCloseTo(2.3);

    const featureTile: LoadedTile = {
      id: '0_0', tx: 0, tz: 0, x0: 0, z0: 0, size: 1000, n: 1,
      heights: new Float32Array([30, 30, 30, 30]),
      features: { ...emptyFeatures(), buildings: [building] },
      buildingSource: { worldId: 'idf-paris', tileId: '0_0' },
    };
    const buildings = new Buildings(() => 30, 0);
    buildings.setWorld('idf-paris');
    buildings.addTile(featureTile);
    const mesh = buildings.group.getObjectByName('buildings_0_0');
    expect(mesh).toBeInstanceOf(Mesh);
    const ray = new Raycaster(new Vector3(22, 60, 14), new Vector3(0, -1, 0), 0, 40);
    expect(ray.intersectObject(mesh!)[0]?.point.y).toBeCloseTo(49, 3);
    ray.ray.origin.z = 26;
    expect(ray.intersectObject(mesh!)).toHaveLength(0);
    buildings.removeTile(featureTile);
  });

  it('écarte les terrasses, le béton, les annexes basses et les grands combles mesurés', () => {
    expect(urbanRoofPlan({ ...building, roof: 'flat' }, 'metal', 19, 0.16, true)).toBeNull();
    expect(urbanRoofPlan(building, 'concrete', 19, 0.16, true)).toBeNull();
    expect(urbanRoofPlan({ ...building, levels: 2 }, 'metal', 9, 0.16, true)).toBeNull();
    expect(urbanRoofPlan({ ...building, roofHeight: 6 }, 'slate', 19, 0.16, true)).toBeNull();
  });

  it('adapte les immeubles hors Île-de-France et conserve les petits toits sans mansarde déclarée', () => {
    expect(urbanRoofPlan(building, 'slate', 19, 0.16, false)).not.toBeNull();
    const low = { ...building, levels: 3 };
    expect(urbanRoofPlan(low, 'metal', 12, 0.16, false)).toBeNull();
    expect(urbanRoofPlan({ ...low, roof: 'mansard' }, 'metal', 12, 0.16, false)).not.toBeNull();
  });
});
