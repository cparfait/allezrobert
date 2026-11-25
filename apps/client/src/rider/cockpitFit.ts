import * as THREE from 'three/webgpu';

/**
 * Poste de pilotage des vélos de route et de gravel (style réaliste). Les modèles Blender posent les cocottes à hauteur de
 * selle et trop près du coureur : dos plat et coudes ouverts étaient impossibles ensemble. Le cintre est donc avancé et
 * baissé au chargement ; la potence s'allonge (≈ 14 cm), le pivot et les entretoises restent en place.
 * Les vélos de chrono (repose-coudes) et le VTT gardent leur poste de pilotage.
 */
export const COCKPIT_SHIFT = { y: -0.045, z: 0.02 } as const;

/** La potence absorbe le décalage entre ces deux z (m) : pivot de direction, puis arrière du cintre. */
const STEM_FROM = 0.42;
const STEM_TO = 0.495;

/** Part du décalage (0 à 1) d'un point du poste de pilotage selon sa position en avant du pédalier (m). */
export function cockpitShare(z: number): number {
  const t = Math.min(1, Math.max(0, (z - STEM_FROM) / (STEM_TO - STEM_FROM)));
  return t * t * (3 - 2 * t);
}

/** Décale le cintre, les cocottes et le compteur d'un vélo chargé, et ses ancres de mains ; false si le vélo n'est pas concerné. */
export function fitCockpit(scene: THREE.Object3D): boolean {
  if (scene.userData.cockpitFit) return true;
  const cockpit = scene.getObjectByName('cockpit');
  const hands = ['hand_L', 'hand_R'].map((name) => scene.getObjectByName(name));
  if (!cockpit || hands.some((h) => !h) || scene.getObjectByName('pad_L')) return false;
  scene.updateMatrixWorld(true);
  const toScene = new THREE.Matrix4();
  const back = new THREE.Matrix4();
  const p = new THREE.Vector3();
  cockpit.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    toScene.copy(scene.matrixWorld).invert().multiply(mesh.matrixWorld);
    back.copy(toScene).invert();
    const from = mesh.geometry.getAttribute('position');
    const to = new Float32Array(from.count * 3);
    for (let i = 0; i < from.count; i++) {
      p.fromBufferAttribute(from, i).applyMatrix4(toScene);
      const w = cockpitShare(p.z);
      p.y += COCKPIT_SHIFT.y * w;
      p.z += COCKPIT_SHIFT.z * w;
      p.applyMatrix4(back).toArray(to, i * 3);
    }
    // Attributs partagés entre matériaux du même maillage : géométrie propre à ce maillage.
    mesh.geometry = mesh.geometry.clone();
    mesh.geometry.setAttribute('position', new THREE.BufferAttribute(to, 3));
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  });
  for (const h of hands) {
    (h as THREE.Object3D).position.y += COCKPIT_SHIFT.y;
    (h as THREE.Object3D).position.z += COCKPIT_SHIFT.z;
  }
  scene.userData.cockpitFit = true;
  return true;
}
