import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { MID_FROM_M, buildMidGeometry, disposeRiderMid, riderMidCounters, updateRiderMid } from '../src/game/riderMid.ts';

/** Coureur témoin : corps animé en deux pièces (même squelette), cadre en deux pièces, roue en deux pièces qui tourne. */
function rider() {
  const root = new THREE.Group();
  const detail = new THREE.Group();
  root.add(detail);
  const bone = new THREE.Bone();
  detail.add(bone);
  const skeleton = new THREE.Skeleton([bone]);
  const skinned = (color: number) => {
    const g = new THREE.BoxGeometry(0.4, 0.8, 0.3);
    const n = g.getAttribute('position').count;
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Float32Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const m = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial({ color }));
    detail.add(m);
    m.bind(skeleton);
    return m;
  };
  const jersey = skinned(0xff0000);
  const shorts = skinned(0x000000);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: 0x00ff00 }));
  const fork = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.1), new THREE.MeshStandardMaterial({ color: 0x0000ff }));
  fork.position.set(0.5, 0.3, 0);
  detail.add(frame, fork);
  const wheel = new THREE.Group();
  wheel.position.set(0.5, 0.35, 0);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  const tyre = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.65, 0.65), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  wheel.add(rim, tyre);
  detail.add(wheel);
  root.updateMatrixWorld(true);
  return { root, detail, jersey, shorts, frame, fork, wheel, rim, tyre };
}

const mids = (o: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  o.traverse((x) => {
    if (x.name === 'merged-mid' && x.visible) out.push(x as THREE.Mesh);
  });
  return out;
};

describe('coureur réaliste au niveau intermédiaire', () => {
  it('au-delà de 20 m : un corps animé, un bloc immobile, une roue (qui tourne avec son parent) ; de près, les originaux', () => {
    const r = rider();
    const far = MID_FROM_M + 5;
    // Repérage, puis la roue tourne pendant quelques images.
    expect(updateRiderMid(r.root, r.detail, far, 1, 0, undefined, true)).toBe(false);
    r.wheel.rotation.x = 0.7;
    r.root.updateMatrixWorld(true);
    expect(updateRiderMid(r.root, r.detail, far, 12, 0, undefined, true)).toBe(true);
    const proxies = mids(r.root);
    expect(proxies).toHaveLength(3);
    expect(proxies.filter((p) => (p as THREE.SkinnedMesh).isSkinnedMesh)).toHaveLength(1);
    expect(r.wheel.children.some((c) => c.name === 'merged-mid')).toBe(true);
    for (const m of [r.jersey, r.shorts, r.frame, r.fork, r.rim, r.tyre]) expect(m.layers.mask).toBe(0);
    // Couleur de chaque pièce en couleurs de sommets.
    const skin = proxies.find((p) => (p as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
    const col = skin.geometry.getAttribute('color');
    expect(col.getX(0)).toBeCloseTo(1, 3);
    expect(col.getX(col.count - 1)).toBeCloseTo(0, 3);
    // La roue continue de tourner : le maillage fusionné reste valable (il suit son parent).
    r.wheel.rotation.x = 1.4;
    r.root.updateMatrixWorld(true);
    expect(updateRiderMid(r.root, r.detail, far, 20, 0, undefined, true)).toBe(true);
    expect(r.rim.layers.mask).toBe(0);
    // Revenu près : originaux rendus, maillages fusionnés masqués.
    expect(updateRiderMid(r.root, r.detail, 10, 21, 0, undefined, true)).toBe(false);
    expect(mids(r.root)).toHaveLength(0);
    for (const m of [r.jersey, r.frame, r.rim]) expect(m.layers.mask).toBe(1);
    disposeRiderMid(r.root);
  });

  it('pièce qui tourne seule (repérée au contrôle) : laissée telle quelle à la reconstruction', () => {
    const r = rider();
    updateRiderMid(r.root, r.detail, 30, 101, 0, undefined, true);
    updateRiderMid(r.root, r.detail, 30, 112, 0, undefined, true);
    expect(r.fork.layers.mask).toBe(0);
    r.fork.rotation.x = 1;
    r.root.updateMatrixWorld(true);
    // Contrôle (image 120) : défait, nouveau repérage, reconstruction sans la fourche.
    expect(updateRiderMid(r.root, r.detail, 30, 120, 0, undefined, true)).toBe(false);
    expect(r.fork.layers.mask).toBe(1);
    r.fork.rotation.x = 2;
    r.root.updateMatrixWorld(true);
    expect(updateRiderMid(r.root, r.detail, 30, 132, 0, undefined, true)).toBe(true);
    expect(r.fork.layers.mask).toBe(1);
    expect(r.frame.layers.mask).toBe(0);
    disposeRiderMid(r.root);
  });

  it('niveau du modèle qui bascule (branche masquée puis rendue) : fusion gardée, pas reconstruite', () => {
    const r = rider();
    updateRiderMid(r.root, r.detail, 30, 201, 0, undefined, true);
    expect(updateRiderMid(r.root, r.detail, 30, 212, 0, undefined, true)).toBe(true);
    const built = riderMidCounters.built;
    // Le niveau change : la roue (une branche) est masquée, ses pièces rendues ; la fusion n'est plus en place.
    r.wheel.visible = false;
    updateRiderMid(r.root, r.detail, 30, 220, 0, undefined, true);
    expect(r.frame.layers.mask).toBe(1);
    // Retour au niveau précédent : la même fusion revient sans reconstruction.
    r.wheel.visible = true;
    expect(updateRiderMid(r.root, r.detail, 30, 221, 0, undefined, true)).toBe(true);
    expect(r.frame.layers.mask).toBe(0);
    expect(riderMidCounters.built).toBe(built);
    disposeRiderMid(r.root);
  });

  it('géométrie fusionnée : pièces placées par leur matrice, indices décalés', () => {
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const g = buildMidGeometry([a, b], [new THREE.Matrix4(), new THREE.Matrix4().makeTranslation(10, 0, 0)], [new THREE.Color(1, 0, 0), new THREE.Color(0, 0, 1)], false);
    const n = a.geometry.getAttribute('position').count;
    expect(g.getAttribute('position').count).toBe(2 * n);
    expect(g.getAttribute('position').getX(n)).toBeCloseTo(a.geometry.getAttribute('position').getX(0) + 10, 5);
    expect(g.index?.getX(a.geometry.index!.count)).toBe(a.geometry.index!.getX(0) + n);
    expect(g.getAttribute('color').getZ(2 * n - 1)).toBeCloseTo(1, 5);
  });
});
