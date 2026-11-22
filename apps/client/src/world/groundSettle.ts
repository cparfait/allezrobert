import type * as THREE from 'three/webgpu';

/**
 * Décor posé une fois pour toutes au départ (arches, drapeaux, panneaux) : le sol mesuré à la construction
 * peut être faux ou absent (tuile pas encore chargée, maillage remplacé par un niveau de détail plus fin, sol
 * abaissé sous la chaussée après coup). `fn` re-pose l'objet sur le sol affiché ; il est appelé au premier
 * rendu de `mesh`, puis au plus toutes les `everyMs` ms tant que `mesh` est dessiné (hors champ : rien à faire).
 */
export function settleWhileVisible(mesh: THREE.Object3D, fn: () => void, everyMs = 400, now: () => number = () => performance.now()): void {
  let last = Number.NEGATIVE_INFINITY;
  const prev = mesh.onBeforeRender;
  mesh.onBeforeRender = function (this: THREE.Object3D, ...args: Parameters<THREE.Object3D['onBeforeRender']>) {
    prev.apply(this, args);
    const t = now();
    if (t - last < everyMs) return;
    last = t;
    fn();
  };
}

/** Nouvelle altitude à retenir : le sol mesuré s'il est connu et s'écarte de plus d'1 cm, sinon null. */
export function groundChange(current: number, measured: number): number | null {
  return Number.isFinite(measured) && Math.abs(measured - current) > 0.01 ? measured : null;
}
