import * as THREE from 'three/webgpu';

/**
 * Normales d'une géométrie de triangles non indexés (une normale par face, répétée sur ses trois sommets).
 * Même résultat, au bit près, que `BufferGeometry.computeVertexNormals()` pour ce cas, sans passer par les
 * vecteurs et les accesseurs de three.js : c'était 0,5 s du chargement des bâtiments d'un monde.
 */
export function setFlatNormals(g: THREE.BufferGeometry): void {
  const pos = g.getAttribute('position').array as ArrayLike<number>;
  const n = new Float32Array(pos.length);
  for (let i = 0; i + 8 < pos.length; i += 9) {
    // cb = (C − B) × (A − B), comme computeVertexNormals
    const cbx = (pos[i + 6] as number) - (pos[i + 3] as number);
    const cby = (pos[i + 7] as number) - (pos[i + 4] as number);
    const cbz = (pos[i + 8] as number) - (pos[i + 5] as number);
    const abx = (pos[i] as number) - (pos[i + 3] as number);
    const aby = (pos[i + 1] as number) - (pos[i + 4] as number);
    const abz = (pos[i + 2] as number) - (pos[i + 5] as number);
    // three.js range d'abord la normale non normalisée dans un tableau de flottants 32 bits, puis la normalise
    const x = Math.fround(cby * abz - cbz * aby);
    const y = Math.fround(cbz * abx - cbx * abz);
    const z = Math.fround(cbx * aby - cby * abx);
    const inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    const nx = x * inv;
    const ny = y * inv;
    const nz = z * inv;
    for (let k = 0; k < 9; k += 3) {
      n[i + k] = nx;
      n[i + k + 1] = ny;
      n[i + k + 2] = nz;
    }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
}
