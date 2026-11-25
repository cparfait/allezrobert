import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { COCKPIT_SHIFT, cockpitShare, fitCockpit } from '../src/rider/cockpitFit.ts';

/** Vélo minimal : pivot (z 0,39), cintre (z 0,51), ancres des mains. */
function bike(pads = false): THREE.Group {
  const scene = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.85, 0.39, 0, 0.866, 0.51, 0.2, 0.9, 0.6], 3));
  const cockpit = new THREE.Mesh(geometry);
  cockpit.name = 'cockpit';
  scene.add(cockpit);
  for (const name of ['hand_L', 'hand_R', ...(pads ? ['pad_L', 'pad_R'] : [])]) {
    const anchor = new THREE.Object3D();
    anchor.name = name;
    anchor.position.set(0.2, 0.958, 0.54);
    scene.add(anchor);
  }
  return scene;
}
const z = (scene: THREE.Group, i: number) => (scene.getObjectByName('cockpit') as THREE.Mesh).geometry.getAttribute('position').getZ(i);

describe('poste de pilotage avancé et baissé', () => {
  it('le pivot ne bouge pas, le cintre et les cocottes sont décalés d’un bloc', () => {
    const scene = bike();
    expect(fitCockpit(scene)).toBe(true);
    expect(z(scene, 0)).toBeCloseTo(0.39, 6);
    expect(z(scene, 1)).toBeCloseTo(0.51 + COCKPIT_SHIFT.z, 6);
    expect(z(scene, 2)).toBeCloseTo(0.6 + COCKPIT_SHIFT.z, 6);
    expect(scene.getObjectByName('hand_L')!.position.y).toBeCloseTo(0.958 + COCKPIT_SHIFT.y, 6);
  });

  it('une seule fois par vélo', () => {
    const scene = bike();
    fitCockpit(scene);
    fitCockpit(scene);
    expect(z(scene, 1)).toBeCloseTo(0.51 + COCKPIT_SHIFT.z, 6);
  });

  it('vélo de chrono (repose-coudes) inchangé', () => {
    const scene = bike(true);
    expect(fitCockpit(scene)).toBe(false);
    expect(z(scene, 1)).toBeCloseTo(0.51, 6);
  });

  it('le long de la potence, les points gardent leur ordre (pas de repli)', () => {
    let last = -Infinity;
    for (let d = 0.35; d < 0.6; d += 0.005) {
      const shifted = d + COCKPIT_SHIFT.z * cockpitShare(d);
      expect(shifted).toBeGreaterThan(last);
      last = shifted;
    }
  });
});
