import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { TileBatcher, tileFamily } from '../src/world/tileBatch.ts';

function tileMesh(name: string, material: THREE.Material, x = 0, size = 1): THREE.Mesh {
  // Comme le décor d'une tuile (fusionné sans groupes) : une boîte non indexée, groupes retirés.
  const geometry = new THREE.BoxGeometry(size, size, size).toNonIndexed();
  geometry.clearGroups();
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.position.x = x;
  return m;
}

const batches = (scene: THREE.Object3D) => (scene.getObjectByName('tile-batches')?.children ?? []) as THREE.BatchedMesh[];

describe('TileBatcher', () => {
  it('nomme la famille sans le suffixe de tuile', () => {
    expect(tileFamily('roads_-4_-8')).toBe('roads');
    expect(tileFamily('buildings_12_3')).toBe('buildings');
    expect(tileFamily('horizon')).toBe('horizon');
  });

  it('regroupe les tuiles d’une famille et masque les maillages d’origine', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    scene.add(group);
    const roads = new THREE.MeshStandardNodeMaterial();
    const props = new THREE.MeshStandardNodeMaterial();
    const batcher = new TileBatcher(scene);
    batcher.adopt(group);
    const a = tileMesh('roads_0_0', roads, 0);
    const b = tileMesh('roads_1_0', roads, 1000);
    const c = tileMesh('props_0_0', props, 0);
    group.add(a, b, c);
    expect([a, b, c].map((m) => m.visible)).toEqual([false, false, false]);
    expect(batches(scene).map((m) => [m.name, m.instanceCount]).sort()).toEqual([['batch:props', 1], ['batch:roads', 2]]);
    const roadBatch = batches(scene).find((m) => m.name === 'batch:roads')!;
    const matrix = new THREE.Matrix4();
    roadBatch.getMatrixAt(1, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).x).toBe(1000);
  });

  it('libère la place au retrait de la tuile et retire le lot vide', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    scene.add(group);
    const mat = new THREE.MeshStandardNodeMaterial();
    const batcher = new TileBatcher(scene);
    batcher.adopt(group);
    const a = tileMesh('rails_0_0', mat);
    group.add(a);
    group.remove(a);
    expect(a.visible).toBe(true);
    expect(batches(scene)).toEqual([]);
  });

  it('agrandit le lot quand les tuiles dépassent la place prévue', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    scene.add(group);
    const mat = new THREE.MeshStandardNodeMaterial();
    const batcher = new TileBatcher(scene);
    batcher.adopt(group);
    const meshes = Array.from({ length: 40 }, (_, i) => tileMesh(`water_${i}_0`, mat, i * 1000, 1 + (i % 3)));
    for (const m of meshes) group.add(m);
    // Retraits et ajouts successifs (tuiles qui défilent) : la place libérée est réutilisée.
    for (const m of meshes.slice(0, 20)) group.remove(m);
    for (let i = 40; i < 70; i++) group.add(tileMesh(`water_${i}_0`, mat, i * 1000, 3));
    const [batch] = batches(scene);
    expect(batch?.instanceCount).toBe(50);
  });

  it('laisse seuls les maillages instanciés ou sans nom', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    scene.add(group);
    const batcher = new TileBatcher(scene);
    batcher.adopt(group);
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardNodeMaterial(), 2);
    inst.name = 'trees_0_0';
    const anon = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardNodeMaterial());
    group.add(inst, anon);
    expect(inst.visible && anon.visible).toBe(true);
    expect(batches(scene)).toEqual([]);
  });
});
