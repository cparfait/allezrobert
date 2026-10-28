import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { rng } from '../src/engine/noise.ts';
import { setFlatNormals } from '../src/world/flatNormals.ts';

describe('setFlatNormals', () => {
  it('donne les mêmes normales que computeVertexNormals (triangles non indexés, dégénérés compris)', () => {
    const r = rng(5);
    const pos: number[] = [];
    for (let t = 0; t < 4000; t++) {
      // triangles de toutes tailles et orientations, coordonnées du monde (grandes valeurs comprises)
      const ox = (r() - 0.5) * 20000;
      const oz = (r() - 0.5) * 20000;
      const s = 10 ** (r() * 3 - 1);
      for (let v = 0; v < 3; v++) pos.push(ox + (r() - 0.5) * s, (r() - 0.2) * 40, oz + (r() - 0.5) * s);
    }
    // un triangle plat et un point : normales nulles
    pos.push(1, 2, 3, 1, 2, 3, 1, 2, 3, 0, 0, 0, 1, 0, 0, 2, 0, 0);
    const a = new THREE.BufferGeometry();
    a.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const b = a.clone();
    a.computeVertexNormals();
    setFlatNormals(b);
    const na = a.getAttribute('normal').array;
    const nb = b.getAttribute('normal').array;
    expect(nb.length).toBe(na.length);
    let diff = 0;
    for (let i = 0; i < na.length; i++) if (na[i] !== nb[i]) diff++;
    expect(diff).toBe(0);
  });
});
