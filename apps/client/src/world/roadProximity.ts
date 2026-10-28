/** Cellules assez petites pour qu'un point soit entouré des seules 9 cellules voisines, assez grandes pour peu de cellules. */
const MIN_CELL_M = 8;
/** Clé numérique d'une cellule (|indice| < 2^21) : pas de chaîne à fabriquer à chaque appel, ce test sert chaque touffe d'herbe. */
const CELL_KEY = 4_194_304;

/** Test rapide « trop près de la route » via une grille de hachage des points de l'itinéraire. */
export function buildRoadProximity(route: { points: ReadonlyArray<{ x: number; z: number }> }, radius: number): (x: number, z: number) => boolean {
  const cell = Math.max(radius, MIN_CELL_M);
  const grid = new Map<number, Array<{ x: number; z: number }>>();
  for (const p of route.points) {
    const k = Math.floor(p.x / cell) * CELL_KEY + Math.floor(p.z / cell);
    let a = grid.get(k);
    if (!a) grid.set(k, (a = []));
    a.push(p);
  }
  const r2 = radius * radius;
  return (x, z) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const a = grid.get((cx + i) * CELL_KEY + cz + j);
        if (!a) continue;
        for (const p of a) if ((p.x - x) ** 2 + (p.z - z) ** 2 < r2) return true;
      }
    return false;
  };
}
