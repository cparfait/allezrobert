import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { applyRiderShadows } from '../src/game/riderShadows.ts';

function rider() {
  const root = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 0.1));
  const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.05));
  const body = new THREE.SkinnedMesh(new THREE.BoxGeometry(0.4, 1.6, 0.3));
  for (const m of [frame, glasses, body]) m.castShadow = true;
  root.add(frame, glasses, body);
  root.updateMatrixWorld(true);
  return { root, frame, glasses, body };
}

describe('ombres des coureurs V3', () => {
  it('hors budget : aucune pièce ne projette d’ombre', () => {
    const r = rider();
    applyRiderShadows(r.root, false);
    expect([r.frame, r.glasses, r.body].some((m) => m.castShadow)).toBe(false);
  });
  it('dans le budget : corps et grandes pièces seulement', () => {
    const r = rider();
    applyRiderShadows(r.root, true);
    expect(r.body.castShadow).toBe(true);
    expect(r.frame.castShadow).toBe(true);
    expect(r.glasses.castShadow).toBe(false);
  });
  it('version légère hors budget : son ombre reste coupée à chaque image (updateRiderLight la remet)', () => {
    const r = rider();
    const group = new THREE.Group();
    group.visible = false; // rendu détaillé masqué : version légère
    r.root.add(group);
    const light = new THREE.Mesh(new THREE.BoxGeometry(1, 1.7, 0.4));
    light.name = 'rider-light';
    r.root.add(light);
    for (let frame = 0; frame < 40; frame++) {
      light.castShadow = true; // ce que fait updateRiderLight(…, true) à chaque image
      applyRiderShadows(r.root, false, group, false);
      expect(light.castShadow).toBe(false);
    }
  });
  it('version légère dans le budget : elle projette son ombre', () => {
    const r = rider();
    const group = new THREE.Group();
    group.visible = false;
    r.root.add(group);
    const light = new THREE.Mesh(new THREE.BoxGeometry(1, 1.7, 0.4));
    light.name = 'rider-light';
    r.root.add(light);
    for (let frame = 0; frame < 5; frame++) applyRiderShadows(r.root, true, group, false);
    expect(light.castShadow).toBe(true);
  });
});
