import type * as THREE from 'three/webgpu';

/**
 * Les coureurs (style V3 surtout) portent des centaines de nœuds masqués : variantes de maillots, casques,
 * chaussures… (793 nœuds par coureur, dont 131 visibles, mesuré le 17/11/2026). Three.js recalcule pourtant la
 * matrice de chacun à chaque image. Ici, une branche masquée n'est plus parcourue, sauf si elle contient des os
 * (un squelette peut servir à un maillage visible ailleurs). Une branche qui redevient visible est recalculée à
 * l'image suivante : la racine d'un coureur bouge à chaque image, la mise à jour est donc toujours forcée.
 * Mesure (dev, 24 coureurs) : 2,46 → 0,88 ms par image pour la mise à jour des matrices de la scène.
 */
export function skipHiddenMatrixUpdates(root: THREE.Object3D): void {
  root.updateMatrixWorld = function (this: THREE.Object3D, force?: boolean) {
    updateVisible(this, force ?? false);
  };
}

const bonesCache = new WeakMap<THREE.Object3D, boolean>();

function hasBones(o: THREE.Object3D): boolean {
  let b = bonesCache.get(o);
  if (b === undefined) {
    b = false;
    o.traverse((x) => {
      if ((x as THREE.Bone).isBone) b = true;
    });
    bonesCache.set(o, b);
  }
  return b;
}

/** Même calcul que Object3D.updateMatrixWorld (three r186), sans descendre dans les branches masquées sans os. */
function updateVisible(o: THREE.Object3D, force: boolean): void {
  if (o.matrixAutoUpdate) o.updateMatrix();
  if (o.matrixWorldNeedsUpdate || force) {
    if (o.matrixWorldAutoUpdate === true) {
      if (o.parent === null) o.matrixWorld.copy(o.matrix);
      else o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
    }
    o.matrixWorldNeedsUpdate = false;
    force = true;
  }
  for (const c of o.children) {
    if (!c.visible && !hasBones(c)) continue;
    updateVisible(c, force);
  }
}
