/**
 * Sens et départ du parcours choisis au départ : le parcours inversé (identifiant « <id>-inverse »)
 * a ses propres classements, records et fantôme ; une boucle peut commencer ailleurs qu'à son départ
 * d'origine (« <id>[-inverse]-depart-<m> », mêmes classements que la boucle). Les itinéraires
 * dessinés ne s'inversent pas et gardent leur départ.
 */
import { forwardRouteId, parseStartedRouteId, reversedRouteId, reverseRoute, rotateRoute, startIndex, type RoutePoint, type RouteData } from '@allezrobert/shared';
import { ITINERARY_PREFIX } from '../ui/routePlanner.ts';

const cache = new WeakMap<RouteData, RouteData>();
const rotated = new WeakMap<RouteData, Map<number, RouteData>>();

export function canReverse(r: RouteData): boolean {
  return !r.id.startsWith(ITINERARY_PREFIX) && forwardRouteId(r.id) === null && parseStartedRouteId(r.id) === null;
}

/** Départ déplaçable : boucles du monde seulement (un aller simple garde son départ). */
export function canMoveStart(r: RouteData): boolean {
  return r.loop && !r.id.startsWith(ITINERARY_PREFIX) && parseStartedRouteId(r.id) === null;
}

/** Parcours dans l'autre sens (calculé une fois par parcours). */
export function reversedOf(r: RouteData): RouteData {
  let rev = cache.get(r);
  if (!rev) cache.set(r, (rev = reverseRoute(r)));
  return rev;
}

/** Boucle commencée au point le plus proche de `startM` (calculée une fois par départ). */
export function startedOf(r: RouteData, startM: number): RouteData {
  if (!(startM > 0) || !canMoveStart(r)) return r;
  let m = rotated.get(r);
  if (!m) rotated.set(r, (m = new Map()));
  const key = Math.round(startM);
  let out = m.get(key);
  if (!out) m.set(key, (out = rotateRoute(r, key)));
  return out;
}

/** Départ calé sur le point de la boucle le plus proche de `d` (m, entier) ; 0 = départ d'origine. */
export function snapStartM(r: RouteData, d: number): number {
  if (!canMoveStart(r)) return 0;
  const i = startIndex(r, d);
  return i === 0 ? 0 : Math.round((r.points[i] as RoutePoint).d);
}

/** Identifiant du parcours à rouler selon les réglages (sens et départ compris). */
export function routeKey(s: { routeId: string; reverse?: boolean; startM?: number }): string {
  if (!s.routeId || s.routeId.startsWith(ITINERARY_PREFIX)) return s.routeId;
  const id = s.reverse ? reversedRouteId(s.routeId) : s.routeId;
  return s.startM && s.startM > 0 ? `${id}-depart-${Math.round(s.startM)}` : id;
}

/** Parcours d'un identifiant, sens inverse et départ choisi compris. */
export function findRoute(routes: readonly RouteData[], id: string): RouteData | undefined {
  const hit = routes.find((r) => r.id === id);
  if (hit) return hit;
  const started = parseStartedRouteId(id);
  if (started) {
    const dir = findRoute(routes, started.id);
    return dir ? startedOf(dir, started.startM) : undefined;
  }
  const fwd = forwardRouteId(id);
  const base = fwd ? routes.find((r) => r.id === fwd) : undefined;
  return base && canReverse(base) ? reversedOf(base) : undefined;
}
