/**
 * Profil en long des voies ferrées. La hauteur de base (railways.ts, `railY`) suit le relief LiDAR (MNT). Or, sous
 * un pont ferroviaire, le MNT donne le sol de la route du dessous : la voie y plongeait de plusieurs mètres
 * (−7 m sur 100 m à Boulogne, soit 14 %, 18/11/2026). Une voie ne dépasse guère 3,5 % : les creux plus raides sont
 * comblés (la voie passe au-dessus, en pont), sans jamais abaisser la voie.
 */

/** Pente maximale d'une voie (m/m). */
export const RAIL_MAX_GRADE = 0.035;

/** Largeur maximale d'un creux comblé (m) : route ou ruisseau sous un pont ; une longue descente (tranchée) reste. */
export const RAIL_DIP_WINDOW_M = 100;

/**
 * Comble les creux étroits et trop raides par une fermeture morphologique (dilatation puis érosion) dont l'élément
 * structurant est un cône de pente `grade` sur ±`window` mètres. Une pente continue, même raide (rampe, tranchée),
 * est rendue telle quelle ; un creux plus étroit que la fenêtre est comblé à la pente maximale depuis ses rives.
 * Le résultat n'est jamais plus bas que l'entrée. `s` : abscisses cumulées croissantes. Modifie `y` en place.
 */
export function fillDips(s: ArrayLike<number>, y: number[], grade = RAIL_MAX_GRADE, window = RAIL_DIP_WINDOW_M): number[] {
  const n = y.length;
  const src = y.slice();
  const dil = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const si = s[i] as number;
    let v = src[i] as number;
    for (let j = i - 1; j >= 0 && si - (s[j] as number) <= window; j--) v = Math.max(v, (src[j] as number) - grade * (si - (s[j] as number)));
    for (let j = i + 1; j < n && (s[j] as number) - si <= window; j++) v = Math.max(v, (src[j] as number) - grade * ((s[j] as number) - si));
    dil[i] = v;
  }
  for (let i = 0; i < n; i++) {
    const si = s[i] as number;
    let v = dil[i] as number;
    for (let j = i - 1; j >= 0 && si - (s[j] as number) <= window; j--) v = Math.min(v, (dil[j] as number) + grade * (si - (s[j] as number)));
    for (let j = i + 1; j < n && (s[j] as number) - si <= window; j++) v = Math.min(v, (dil[j] as number) + grade * ((s[j] as number) - si));
    y[i] = Math.max(src[i] as number, v);
  }
  return y;
}

/**
 * Raccorde une extrémité à une hauteur imposée (voisine déjà construite) : l'écart est réparti en décroissant
 * linéairement sur la distance qu'il faut pour le rattraper à la pente maximale. `atEnd` : extrémité de fin.
 */
export function pinEnd(s: ArrayLike<number>, y: number[], target: number, atEnd: boolean, grade = RAIL_MAX_GRADE): number[] {
  const n = y.length;
  if (!n) return y;
  const k = atEnd ? n - 1 : 0;
  const delta = target - (y[k] as number);
  if (Math.abs(delta) < 1e-6) return y;
  const reach = Math.abs(delta) / grade;
  const s0 = s[k] as number;
  for (let i = 0; i < n; i++) {
    const w = 1 - Math.abs((s[i] as number) - s0) / reach;
    if (w > 0) y[i] = (y[i] as number) + delta * w;
  }
  return y;
}
