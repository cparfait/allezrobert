/**
 * Montées de la route reçue du jeu (détection et découpage : packages/shared/src/climbs.ts).
 */
import { detectClimbs, type Climb } from '@allezrobert/shared';
import type { RouteGeo } from './map.ts';

/** Montées d'une route : boucle parcourue depuis son point le plus bas (aucune montée n'y passe). */
export function climbsOf(geo: RouteGeo): Climb[] {
  if (geo.size < 2) return [];
  const r = geo.route;
  if (r.loop && r.lengthM > 0) {
    let lo = 0;
    for (let i = 1; i < geo.size; i++) if (geo.ys[i]! < geo.ys[lo]!) lo = i;
    const from = geo.ds[lo]!;
    return detectClimbs((d) => geo.elevationAt(d), from, from + r.lengthM);
  }
  return detectClimbs((d) => geo.elevationAt(d), geo.startD, geo.endD, { openEnd: !!r.open });
}
