/**
 * Sol des façades, sans dépendance à Three.js (testable sous Node).
 *
 * Les murs partent sous le point le plus bas de l'emprise (jamais de mur qui flotte) ; en pente, le
 * terrain remonte contre le mur côté amont. Le dessin de la façade (porte, appuis de fenêtres,
 * soubassement) part donc du sol le plus haut le long de chaque mur : rien n'est enterré, et côté
 * aval le soubassement se découvre, comme une maison bâtie sur un terrain en pente.
 */

/** Pas d'échantillonnage du terrain le long du mur (m), celui de la grille fine des tuiles. */
const STEP = 2;

/**
 * Hauteur (m) du sol le plus haut le long du mur [a, b] au-dessus du pied du mur (`base`), bornée
 * à [0, hauteur du mur − 2,4 m] pour garder un rez-de-chaussée. 0 si le terrain est inconnu.
 */
export function wallGroundOffset(ax: number, az: number, bx: number, bz: number, base: number, height: number, groundAt: (x: number, z: number) => number): number {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP));
  let hi = -Infinity;
  for (let k = 0; k <= n; k++) {
    const g = groundAt(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
    if (Number.isFinite(g) && g > hi) hi = g;
  }
  if (!Number.isFinite(hi)) return 0;
  return Math.min(Math.max(hi - base, 0), Math.max(height - 2.4, 0));
}
