import type * as THREE from 'three/webgpu';

/**
 * Style jeu vidéo : facettes visibles et aplats (sans relief de tissu, pores ni reflet de lycra). Les
 * couleurs, motifs de maillot et logos sont gardés.
 */
export function flatLook(mat: THREE.Material): void {
  const m = mat as THREE.MeshPhysicalNodeMaterial;
  if (m.flatShading) return;
  m.flatShading = true;
  m.normalNode = null;
  m.normalMap = null;
  if ('sheenNode' in m) m.sheenNode = null;
  m.needsUpdate = true;
}
