import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { cullSmallParts, MIN_SCREEN_FRAC, screenFrac } from '../src/game/smallParts.ts';

const projY = 1 / Math.tan((60 * Math.PI) / 360); // fov 60°

describe('pièces trop petites à l’écran', () => {
  it('taille apparente : diamètre / hauteur d’image', () => {
    // Sphère de 1 m de rayon à 10 m, fov 60° : 2 / 10 / (2 tan 30°) ≈ 0,173 de la hauteur.
    expect(screenFrac(1, 10, projY)).toBeCloseTo(0.1732, 3);
  });

  it('retire un œil lointain, garde le cadre, rétablit l’œil de près', () => {
    const root = new THREE.Group();
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012));
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 0.05));
    root.add(eye, frame);
    root.position.set(0, 0, -60);
    root.updateMatrixWorld(true);
    const cam = new THREE.Vector3();
    expect(cullSmallParts(root, cam, projY)).toBe(1);
    expect(eye.layers.isEnabled(0)).toBe(false);
    expect(frame.layers.isEnabled(0)).toBe(true);
    root.position.set(0, 0, -2);
    root.updateMatrixWorld(true);
    expect(cullSmallParts(root, cam, projY)).toBe(0);
    expect(eye.layers.isEnabled(0)).toBe(true);
  });

  it('ne touche pas une pièce en cours de préchauffage (masque à 0)', () => {
    const root = new THREE.Group();
    const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.004));
    bolt.layers.mask = 0;
    root.add(bolt);
    root.position.set(0, 0, -80);
    root.updateMatrixWorld(true);
    cullSmallParts(root, new THREE.Vector3(), projY);
    bolt.layers.mask = 1; // fin du préchauffage
    cullSmallParts(root, new THREE.Vector3(), projY);
    expect(bolt.layers.isEnabled(0)).toBe(false);
    expect(MIN_SCREEN_FRAC).toBeCloseTo(1.5 / 1080);
  });
});
