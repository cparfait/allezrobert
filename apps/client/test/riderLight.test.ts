import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { bakeLightGeometry } from '../src/game/riderLight.ts';

describe('coureur lointain en version légère', () => {
  it('un seul maillage, sommets dans le repère du coureur, couleur de chaque pièce', () => {
    const root = new THREE.Group();
    root.position.set(100, 0, -50);
    root.rotation.y = Math.PI / 2;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
    frame.position.set(0, 0.8, 0);
    const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x0000ff }));
    wheel.position.set(0.5, 0.35, 0);
    root.add(frame, wheel);
    root.updateMatrixWorld(true);
    const g = bakeLightGeometry([frame, wheel], root);
    const pos = g.getAttribute('position');
    const col = g.getAttribute('color');
    expect(pos.count).toBe(frame.geometry.getAttribute('position').count + wheel.geometry.getAttribute('position').count);
    // Premier sommet du cadre : dans le repère du coureur (rotation et position de la racine retirées).
    const p0 = new THREE.Vector3().fromBufferAttribute(frame.geometry.getAttribute('position'), 0).add(frame.position);
    expect(pos.getX(0)).toBeCloseTo(p0.x, 5);
    expect(pos.getY(0)).toBeCloseTo(p0.y, 5);
    expect(col.getX(0)).toBeCloseTo(1, 3);
    expect(col.getZ(pos.count - 1)).toBeCloseTo(1, 3);
    expect(g.index?.count).toBe((frame.geometry.index?.count ?? 0) + (wheel.geometry.index?.count ?? 0));
  });
});
