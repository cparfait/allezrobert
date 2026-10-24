/**
 * Quels coureurs projettent une ombre : au plus `max` des plus proches, et seulement à moins de `range` m.
 * Chaque avatar compte une soixantaine d'objets, redessinés dans chaque cascade d'ombres : c'est le premier
 * poste d'appels de dessin dès qu'un groupe roule autour du joueur.
 */
export function shadowCasters(dists: readonly number[], max: number, range: number): boolean[] {
  const order = dists.map((d, i) => i).sort((a, b) => (dists[a] as number) - (dists[b] as number));
  const out = dists.map(() => false);
  for (let rank = 0; rank < order.length && rank < max; rank++) {
    const i = order[rank] as number;
    if ((dists[i] as number) < range) out[i] = true;
  }
  return out;
}
