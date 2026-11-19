import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { bakeLightGeometry } from '../src/game/riderLight.ts';
import { detailGroup, lightColorOf } from '../src/game/riderDetail.ts';
import type { RiderAvatarLike } from '../src/rider/gltfAvatar.ts';

/** Coureur minimal : racine → branche d'inclinaison (comme gltfAvatar.ts et lowPolyRider.ts). */
function fakeAvatar(look: Record<string, unknown>): { avatar: RiderAvatarLike; lean: THREE.Group } {
  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);
  return { avatar: { root, look } as unknown as RiderAvatarLike, lean };
}

describe('optimisations Bêta portées aux styles réaliste et poly', () => {
  it('rendu détaillé : la branche sous la racine, jamais la version légère', () => {
    const { avatar, lean } = fakeAvatar({});
    const light = new THREE.Mesh();
    light.name = 'rider-light';
    avatar.root.add(light);
    avatar.root.children.reverse(); // version légère en tête : elle doit être ignorée
    expect(detailGroup(avatar)).toBe(lean);
  });

  it('version légère : peau et cadre teintés par nœuds pris dans la tenue, couleurs de sommets reprises', () => {
    const { avatar, lean } = fakeAvatar({ skin: '#8d5524', bike: '#16a085' });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    skinMat.name = 'skin';
    const skin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), skinMat);
    // Corps en tubes du coureur poly : matériau blanc, couleurs de sommets.
    const tubes = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const n = tubes.getAttribute('position').count;
    tubes.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.25), 3));
    const body = new THREE.Mesh(tubes, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true }));
    lean.add(skin, body);
    avatar.root.updateMatrixWorld(true);
    const g = bakeLightGeometry([skin, body], avatar.root, lightColorOf(avatar));
    const col = g.getAttribute('color');
    const want = new THREE.Color('#8d5524');
    expect(col.getX(0)).toBeCloseTo(want.r, 3);
    expect(col.getY(0)).toBeCloseTo(want.g, 3);
    expect(col.getX(col.count - 1)).toBeCloseTo(0.25, 3);
  });

  it('style Bêta : aucune teinte de remplacement', () => {
    const { avatar } = fakeAvatar({ skin: '#000000' });
    expect(lightColorOf(avatar, {} as never)).toBeUndefined();
  });
});
