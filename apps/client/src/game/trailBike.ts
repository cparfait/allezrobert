import type { AvatarLook, RouteBike, RouteData } from '@allezrobert/shared';

/** Part hors bitume à partir de laquelle un parcours sans vélo déclaré (roulage libre, tracé) se roule en gravel. */
const OFFROAD_SHARE = 0.4;
const PAVED = new Set(['asphalt', 'paved', 'concrete', 'wood', '']);

type TrailRoute = Pick<RouteData, 'bike' | 'surfaces' | 'lengthM'>;

/** Vélo des autres cyclistes d'un parcours : VTT sur les sentiers, gravel (et un VTT sur quatre) sur les chemins, route ailleurs. */
export function trailBike(route: TrailRoute, i: number): RouteBike {
  if (route.bike === 'mtb') return 'mtb';
  const off = (route.surfaces ?? []).reduce((s, q) => s + (PAVED.has(q.surface) ? 0 : q.endM - q.startM), 0);
  if (route.bike !== 'gravel' && (!off || off < route.lengthM * OFFROAD_SHARE)) return 'road';
  return i % 4 === 3 ? 'mtb' : 'gravel';
}

/** Tenue d'un cycliste avec le vélo du parcours (modèle complet gravel ou VTT à la place du vélo de route). */
export function withTrailBike(look: AvatarLook, route: TrailRoute, i: number): AvatarLook {
  const bikeType = trailBike(route, i);
  if (bikeType === 'road') return look;
  const out: AvatarLook = { ...look, bikeType };
  delete out.bikeModel;
  return out;
}
