import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { straightenWheel } from '../src/world/traffic.ts';

/** Roue (cylindre d'axe x, rayon 0,33 m, largeur 0,25 m) braquée de `deg` autour de la verticale. */
function wheel(deg: number): THREE.Mesh {
  const g = new THREE.CylinderGeometry(0.33, 0.33, 0.25, 48);
  g.rotateZ(Math.PI / 2);
  g.rotateY((deg * Math.PI) / 180);
  const m = new THREE.Mesh(g);
  m.name = 'wheel_FR';
  m.position.set(-0.76, 0.31, 1.22);
  return m;
}

describe('straightenWheel', () => {
  it('redresse une roue braquée sur l\'axe x, sans la déplacer', () => {
    const w = wheel(10);
    const before = new THREE.Box3().setFromObject(w).getCenter(new THREE.Vector3());
    const deg = straightenWheel(w);
    expect(Math.abs(deg)).toBeGreaterThan(9);
    expect(Math.abs(deg)).toBeLessThan(11);
    w.geometry.computeBoundingBox();
    const size = w.geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(0.25, 2);
    expect(size.y).toBeCloseTo(size.z, 2);
    const after = new THREE.Box3().setFromObject(w).getCenter(new THREE.Vector3());
    expect(after.distanceTo(before)).toBeLessThan(0.01);
  });

  it('laisse une roue droite telle quelle', () => {
    const w = wheel(0);
    expect(straightenWheel(w)).toBe(0);
    expect(w.position.x).toBe(-0.76);
  });
});
