import * as THREE from 'three/webgpu';

/**
 * Lunettes de l'avatar MPFB : le maillage repris de l'ancien coureur est trop grand pour ce
 * visage (écran à 4 cm des yeux, enveloppe qui rejoint les oreilles, 5 cm de haut sur les côtés),
 * ce qui donne de profil un bandeau noir de la tempe à l'oreille. On le remodèle une fois, dans
 * l'espace du maillage (quantifié : même repère que le modèle à une échelle près, d'où des
 * mesures relatives à la demi-largeur de l'écran) :
 * - écran rapproché du visage et un peu moins large ;
 * - enveloppe raccourcie (les côtés s'arrêtent aux tempes) ; branches étirées jusqu'aux oreilles ;
 * - écran moins haut, surtout sur les côtés.
 */
export interface GlassesFit {
  /** Recul de tout l'ensemble vers le visage (× demi-largeur de l'écran). */
  back: number;
  /** Largeur de l'écran (facteur). */
  width: number;
  /** Profondeur gardée de l'enveloppe, au-delà de `wrapFrom` (facteur). */
  wrap: number;
  /** Profondeur (× demi-largeur) à partir de laquelle l'enveloppe est raccourcie. */
  wrapFrom: number;
  /** Hauteur de l'écran au centre et sur les côtés (facteurs). */
  height: number;
  heightSides: number;
}

export const GLASSES_FIT: GlassesFit = { back: 0.2, width: 0.88, wrap: 0.45, wrapFrom: 0.35, height: 0.82, heightSides: 0.55 };

const fitted = new WeakSet<THREE.BufferGeometry>();

/** Lunettes d'un niveau de détail : maillages `rider_glasses*` (écran « lens » et monture). */
export function fitGlasses(meshes: THREE.Mesh[], fit: GlassesFit = GLASSES_FIT): void {
  const geos = meshes.map((m) => m.geometry as THREE.BufferGeometry).filter((g) => !fitted.has(g));
  if (!geos.length) return;
  // Repère : l'écran (matériau « lens ») ; à défaut, tout l'ensemble.
  const lensGeos = meshes.filter((m) => (m.material as THREE.Material).name === 'lens').map((m) => m.geometry as THREE.BufferGeometry);
  const box = new THREE.Box3();
  for (const g of lensGeos.length ? lensGeos : geos) {
    g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox);
  }
  const W = (box.max.x - box.min.x) / 2;
  const cx = (box.max.x + box.min.x) / 2;
  const cy = (box.max.y + box.min.y) / 2;
  const zF = box.max.z;
  const lensBack = (zF - box.min.z) / W; // profondeur de l'enveloppe d'origine
  // Profondeur → nouvelle profondeur : enveloppe raccourcie au-delà de wrapFrom, branches
  // (au-delà de l'écran) étirées pour finir au même endroit.
  let farthest = lensBack;
  for (const g of geos) {
    g.computeBoundingBox();
    if (g.boundingBox) farthest = Math.max(farthest, (zF - g.boundingBox.min.z) / W);
  }
  const wrapEnd = fit.wrapFrom + (lensBack - fit.wrapFrom) * fit.wrap;
  const depth = (d: number): number => {
    if (d <= fit.wrapFrom) return d;
    if (d <= lensBack) return fit.wrapFrom + (d - fit.wrapFrom) * fit.wrap;
    return wrapEnd + ((d - lensBack) * (farthest - fit.back - wrapEnd)) / Math.max(1e-6, farthest - lensBack);
  };
  const smooth = (e0: number, e1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (const g of geos) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getX(i) - cx) / W;
      const v = (pos.getY(i) - cy) / W;
      const d = (zF - pos.getZ(i)) / W;
      const inLens = d <= lensBack;
      // Côtés de l'écran : moins hauts ; branches : simplement ramenées vers l'axe de l'écran.
      const side = inLens ? smooth(0.35, 1, Math.abs(u)) : 1;
      const k = fit.height + (fit.heightSides - fit.height) * side;
      // Largeur : l'écran se resserre, les branches gardent leur écart (crâne).
      const wk = inLens ? fit.width : 1 - (1 - fit.width) * (1 - smooth(lensBack, lensBack + 0.4, d));
      pos.setXYZ(i, cx + u * wk * W, cy + v * k * W, zF - (depth(d) + fit.back) * W);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    fitted.add(g);
  }
}
