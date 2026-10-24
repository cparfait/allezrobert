/**
 * Sens du parcours choisi au départ : le parcours inversé (identifiant « <id>-inverse ») a ses
 * propres classements, records et fantôme. Les itinéraires dessinés ne s'inversent pas.
 */
import { forwardRouteId, reversedRouteId, reverseRoute, type RouteData } from '@allezrobert/shared';
import { ITINERARY_PREFIX } from '../ui/routePlanner.ts';

const cache = new WeakMap<RouteData, RouteData>();

export function canReverse(r: RouteData): boolean {
  return !r.id.startsWith(ITINERARY_PREFIX) && forwardRouteId(r.id) === null;
}

/** Parcours dans l'autre sens (calculé une fois par parcours). */
export function reversedOf(r: RouteData): RouteData {
  let rev = cache.get(r);
  if (!rev) cache.set(r, (rev = reverseRoute(r)));
  return rev;
}

/** Identifiant du parcours à rouler selon les réglages (sens compris). */
export function routeKey(s: { routeId: string; reverse?: boolean }): string {
  return s.reverse && s.routeId && !s.routeId.startsWith(ITINERARY_PREFIX) ? reversedRouteId(s.routeId) : s.routeId;
}

/** Parcours d'un identifiant, sens inverse compris. */
export function findRoute(routes: readonly RouteData[], id: string): RouteData | undefined {
  const hit = routes.find((r) => r.id === id);
  if (hit) return hit;
  const fwd = forwardRouteId(id);
  const base = fwd ? routes.find((r) => r.id === fwd) : undefined;
  return base && canReverse(base) ? reversedOf(base) : undefined;
}
