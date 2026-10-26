/** Libellés et petites fonctions pures du monde ouvert (menu), sans accès au DOM : testables telles quelles. */
import type { WorldCatalogue } from '@allezrobert/shared';

/** Zone du catalogue qui contient l'itinéraire public. */
export function zoneOfRoute(zones: WorldCatalogue['zones'], routeId: string): WorldCatalogue['zones'][number] | undefined {
  return zones.find((z) => z.routes.some((r) => r.id === routeId));
}

/** « 1 coureur en ligne », « 12 coureurs en ligne », « Personne pour l'instant ». */
export function ridersLabel(n: number, fr: boolean): string {
  if (n <= 0) return fr ? 'Personne pour l’instant : sois le premier' : 'Nobody yet: be the first';
  return fr ? `${n} coureur${n > 1 ? 's' : ''} en ligne` : `${n} rider${n > 1 ? 's' : ''} online`;
}

/** « Léa roule ici », « Léa et Paul roulent ici », « Léa, Paul et 2 autres roulent ici ». */
export function friendsLabel(names: string[], fr: boolean): string {
  if (!names.length) return '';
  const [a = '', b = ''] = names;
  if (names.length === 1) return fr ? `${a} roule ici` : `${a} is riding here`;
  if (names.length === 2) return fr ? `${a} et ${b} roulent ici` : `${a} and ${b} are riding here`;
  const rest = names.length - 2;
  return fr ? `${a}, ${b} et ${rest} autre${rest > 1 ? 's' : ''} roulent ici` : `${a}, ${b} and ${rest} other${rest > 1 ? 's' : ''} are riding here`;
}
