import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { buildRigidGeometry, buildSkinnedGeometry, disposeRiderMerge, riderMergeStats, updateRiderMerge } from '../src/game/riderMerge.ts';

function box(material: THREE.Material, x: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material);
  m.position.set(x, 0.5, 0);
  return m;
}

/** Un « vélo » : cadre, fourche et pédalier sur le même matériau ; le pédalier tourne. */
function bike() {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  const frame = box(mat, 0);
  const fork = box(mat, 0.6);
  const crank = box(mat, 0.3);
  root.add(frame, fork, crank);
  root.updateMatrixWorld(true);
  return { root, frame, fork, crank };
}

function run(root: THREE.Object3D, frames: number, each?: (f: number) => void, start = 0): number {
  let f = start;
  for (; f < start + frames; f++) {
    each?.(f);
    root.updateMatrixWorld(true);
    updateRiderMerge(root, f, true);
  }
  return f;
}

describe('fusion des pièces des coureurs', () => {
  it('géométrie rigide : mêmes positions dans le repère de l’ancre', () => {
    const { root, frame, fork } = bike();
    const built = buildRigidGeometry([frame, fork], root);
    expect(built).not.toBeNull();
    const pos = built!.geometry.getAttribute('position');
    let maxX = -Infinity;
    for (let i = 0; i < pos.count; i++) maxX = Math.max(maxX, pos.getX(i));
    expect(maxX).toBeCloseTo(0.7, 5); // fourche à 0,6 + demi-côté 0,1
  });

  it('géométrie animée : sommets ramenés dans l’espace de liaison', () => {
    const bone = new THREE.Bone();
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    const n = mesh.geometry.getAttribute('position').count;
    mesh.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
    mesh.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    mesh.add(bone);
    mesh.position.set(2, 0, 0);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton([bone]));
    const g = buildSkinnedGeometry([mesh, mesh]);
    expect(g).not.toBeNull();
    const pos = g!.getAttribute('position');
    let minX = Infinity;
    for (let i = 0; i < pos.count; i++) minX = Math.min(minX, pos.getX(i));
    expect(minX).toBeCloseTo(1.5, 5); // bindMatrix = position du maillage au moment de la liaison
  });

  it('fusionne cadre et fourche, laisse le pédalier qui tourne, cache les originaux', () => {
    const { root, frame, fork, crank } = bike();
    run(root, 80, (f) => crank.rotation.set(f * 0.1, 0, 0));
    const stats = riderMergeStats([root]);
    expect(stats).toEqual({ merges: 1, members: 2 });
    expect(frame.layers.mask).toBe(0);
    expect(fork.layers.mask).toBe(0);
    expect(crank.layers.mask).not.toBe(0);
    expect(root.getObjectByName('merged-rigid')).toBeTruthy();
    disposeRiderMerge(root);
  });

  it('défait la fusion quand une pièce disparaît (garde-robe, niveau de détail)', () => {
    const { root, frame, fork, crank } = bike();
    const f = run(root, 80, (k) => crank.rotation.set(k * 0.1, 0, 0));
    expect(riderMergeStats([root]).merges).toBe(1);
    fork.visible = false;
    run(root, 5, undefined, f);
    expect(riderMergeStats([root]).merges).toBe(0);
    expect(frame.layers.mask).toBe(1);
    expect(root.getObjectByName('merged-rigid')).toBeUndefined();
  });
});
