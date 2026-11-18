import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { skipHiddenMatrixUpdates } from '../src/game/hiddenMatrices.ts';

function rider() {
  const root = new THREE.Group();
  const bone = new THREE.Bone();
  const body = new THREE.SkinnedMesh(new THREE.BoxGeometry(0.4, 1.6, 0.3), new THREE.MeshBasicMaterial());
  body.add(bone);
  body.bind(new THREE.Skeleton([bone]));
  const hiddenKit = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
  hiddenKit.visible = false;
  root.add(body, hiddenKit);
  return { root, body, hiddenKit };
}

describe('matrices des branches masquées des coureurs', () => {
  it('garde la matrice de liaison du corps à jour quand le coureur avance', () => {
    const { root, body } = rider();
    skipHiddenMatrixUpdates(root, true);
    root.updateMatrixWorld(true);
    root.position.set(25, 0, -40);
    root.updateMatrixWorld();
    const expected = body.matrixWorld.clone().invert();
    expect(body.bindMatrixInverse.elements[12]).toBeCloseTo(expected.elements[12]!, 5);
    expect(body.bindMatrixInverse.elements[14]).toBeCloseTo(expected.elements[14]!, 5);
  });

  it('ne recalcule pas une branche masquée sans os', () => {
    const { root, hiddenKit } = rider();
    skipHiddenMatrixUpdates(root, true);
    root.updateMatrixWorld(true);
    const before = hiddenKit.matrixWorld.elements[12];
    root.position.set(10, 0, 0);
    root.updateMatrixWorld();
    expect(hiddenKit.matrixWorld.elements[12]).toBe(before);
  });

  it('saute un squelette masqué inutilisé, garde celui d’un corps visible', () => {
    const root = new THREE.Group();
    // Ancien modèle masqué, avec son squelette, que plus personne n'utilise.
    const old = new THREE.Group();
    old.visible = false;
    const oldBone = new THREE.Bone();
    old.add(oldBone);
    // Squelette rangé dans une branche masquée mais utilisé par un corps visible.
    const rig = new THREE.Group();
    rig.visible = false;
    const bone = new THREE.Bone();
    rig.add(bone);
    const body = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    root.add(old, rig, body);
    body.bind(new THREE.Skeleton([bone]));
    skipHiddenMatrixUpdates(root, true);
    root.updateMatrixWorld(true);
    const oldBefore = oldBone.matrixWorld.elements[12];
    root.position.set(7, 0, 0);
    root.updateMatrixWorld();
    expect(bone.matrixWorld.elements[12]).toBeCloseTo(7, 5);
    expect(oldBone.matrixWorld.elements[12]).toBe(oldBefore);
  });
});
