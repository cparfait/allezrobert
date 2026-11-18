import type * as THREE from 'three/webgpu';

/**
 * Pièces trop petites à l'écran (yeux, cils, valves, boulons, plateaux…) retirées du rendu des coureurs IA et
 * des cyclistes croisés. Mesure du 17/11/2026 (version compilée) : les coureurs font environ 75 % des appels de
 * dessin d'une sortie en groupe, un coureur à 200 m en envoie encore 61, et chaque appel coûte environ 30 µs de
 * processeur dans three.js (WebGPU), qui est la limite de l'image. Une pièce dont le diamètre apparent est
 * sous `minScreenFrac` de la hauteur de l'image (≈ 1,5 px en 1080p) n'est plus dessinée.
 *
 * On passe par les calques (bit 0 : celui de la caméra et des ombres) et non par `visible` : la garde-robe, les
 * niveaux de détail et le préchauffage des shaders gardent la main sur `visible`. Une pièce qui redevient assez
 * grande est rétablie au passage suivant.
 */
export const MIN_SCREEN_FRAC = 1.5 / 1080;

/** ?smallparts=0 : tout dessiner (comparaison). */
export const SMALL_PARTS_CULL = typeof location !== 'undefined' && new URLSearchParams(location.search).get('smallparts') !== '0';

const culled = new WeakSet<THREE.Object3D>();
const _c = { x: 0, y: 0, z: 0 };

/** Diamètre apparent d'une sphère (rayon `r` m à `dist` m) en fraction de la hauteur de l'image. */
export function screenFrac(r: number, dist: number, projY: number): number {
  return (r * projY) / Math.max(dist, 0.01);
}

/**
 * Un passage sur les pièces visibles de `root` (à appeler une image sur quelques-unes : la taille apparente
 * change lentement). `projY` = camera.projectionMatrix.elements[5] (1 / tan(fov / 2)).
 */
export function cullSmallParts(root: THREE.Object3D, camPos: THREE.Vector3, projY: number, minFrac = MIN_SCREEN_FRAC): number {
  let hidden = 0;
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.name.startsWith('shadow-')) return;
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const bs = g.boundingSphere;
    if (!bs) return;
    const e = m.matrixWorld.elements;
    _c.x = e[0]! * bs.center.x + e[4]! * bs.center.y + e[8]! * bs.center.z + e[12]!;
    _c.y = e[1]! * bs.center.x + e[5]! * bs.center.y + e[9]! * bs.center.z + e[13]!;
    _c.z = e[2]! * bs.center.x + e[6]! * bs.center.y + e[10]! * bs.center.z + e[14]!;
    const dist = Math.hypot(_c.x - camPos.x, _c.y - camPos.y, _c.z - camPos.z);
    // Hystérésis : une pièce retirée ne revient qu'au-dessus de 1,4 × le seuil (pas de clignotement au seuil).
    const frac = screenFrac(bs.radius * m.matrixWorld.getMaxScaleOnAxis(), dist, projY);
    const small = frac < (culled.has(m) ? minFrac * 1.4 : minFrac);
    if (small) {
      // Pas pendant le préchauffage d'un shader (masque à 0) : la pièce sera vue au passage suivant.
      if (!culled.has(m) && m.layers.mask !== 0) {
        m.layers.disable(0);
        culled.add(m);
      }
      if (culled.has(m)) hidden++;
    } else if (culled.has(m)) {
      m.layers.enable(0);
      culled.delete(m);
    }
  });
  return hidden;
}
