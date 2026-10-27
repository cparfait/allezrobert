/**
 * Toits sans pente mesurée (BD TOPO « plat » ou hauteur de toit nulle), sans dépendance à Three.js.
 *
 * Une tuile ne tient pas à plat : un petit bâtiment couvert de tuiles est un appentis en faible pente
 * que le LiDAR ne distingue pas d'un toit plat (abris, garages, annexes accolées). Le bac acier reste
 * un toit métallique presque plat. Le reste est un toit-terrasse : gravier ou étanchéité, acrotère.
 */
export type FlatRoof = 'lean' | 'steel' | 'terrace';

/** Pente d'un appentis de tuiles (°), le minimum courant des tuiles mécaniques. */
export const LEAN_PITCH = 12;
/** Surface au-delà de laquelle un toit « plat » en tuiles est une terrasse (m²). */
const LEAN_MAX_AREA = 100;
const NOT_LEAN = new Set(['apartments', 'commercial', 'public', 'industrial', 'church', 'chapel', 'castle']);

export function flatRoofKind(roofMaterial: string | undefined, kind: string, area: number): FlatRoof {
  if (roofMaterial === 'metal') return 'steel';
  if (roofMaterial === 'tiles' && area < LEAN_MAX_AREA && !NOT_LEAN.has(kind)) return 'lean';
  return 'terrace';
}

/**
 * Côté haut d'un appentis : +1 si le pan monte vers (sx, sz), −1 sinon. Il s'adosse au plus proche
 * bâtiment plus grand que lui (centre à moins de 25 m) ; aucun : +1. `others` = [x, z, surface, …].
 */
export function leanSide(cx: number, cz: number, sx: number, sz: number, area: number, others: ArrayLike<number>): 1 | -1 {
  let best = 25 * 25;
  let side: 1 | -1 = 1;
  for (let i = 0; i + 2 < others.length; i += 3) {
    if ((others[i + 2] as number) <= area) continue;
    const dx = (others[i] as number) - cx;
    const dz = (others[i + 1] as number) - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < 1e-6 || d2 >= best) continue;
    best = d2;
    side = dx * sx + dz * sz < 0 ? -1 : 1;
  }
  return side;
}
