/**
 * Montées chronométrées de toutes les zones publiées, pour le tableau du Défi KOM.
 *
 * L'index (`src/data/komIndex.json`) est fabriqué par `scripts/kom-index.ts` à partir du catalogue et des
 * fichiers d'itinéraires : le tableau n'attend plus que chaque zone ait été ouverte dans le navigateur.
 */
import type { RouteBike, RouteSegment } from '@allezrobert/shared';

/** Une montée du tableau. */
export interface KomClimb {
  routeId: string;
  segId: string;
  name: string;
  lengthM: number;
  grade: number;
}

/** Index d'une zone : itinéraires qui portent une montée, vélos de tous ses itinéraires, montées. */
export interface KomZoneIndex {
  routes: Array<{ id: string; name: string; nameEn?: string; bike?: RouteBike }>;
  /** Vélos attendus par les itinéraires de la zone (avec ou sans montée), pour le choix selon le vélo équipé. */
  bikes: RouteBike[];
  climbs: KomClimb[];
}

export interface KomIndex {
  formatVersion: 1;
  zones: Record<string, KomZoneIndex>;
}

/** Ce que le script lit d'une zone du catalogue. */
export interface KomSourceZone {
  id: string;
  routes: Array<{ id: string; name: string; nameEn?: string; bike?: RouteBike; segments: RouteSegment[] }>;
}

const bikeOf = (b: RouteBike | undefined): RouteBike => b ?? 'road';

/**
 * Index des montées : toutes les zones publiées, dans l'ordre du catalogue ; une montée portée par plusieurs itinéraires
 * du même type de vélo n'est gardée qu'une fois (la première), comme dans la liste de la zone affichée.
 */
export function buildKomIndex(zones: readonly KomSourceZone[]): KomIndex {
  const out: KomIndex = { formatVersion: 1, zones: {} };
  for (const z of zones) {
    const seen = new Set<string>();
    const climbs: KomClimb[] = [];
    const used = new Set<string>();
    for (const r of z.routes)
      for (const k of r.segments) {
        const key = `${bikeOf(r.bike)}|${k.name}`;
        if (k.kind !== 'kom' || seen.has(key)) continue;
        seen.add(key);
        used.add(r.id);
        climbs.push({ routeId: r.id, segId: k.id, name: k.name, lengthM: Math.round((k.endM - k.startM) * 10) / 10, grade: Math.round(k.avgGrade * 100) / 100 });
      }
    // Zone sans montée gardée (liste vide) : l'index connaît ainsi toutes les zones publiées, et une entrée
    // mémorisée dans le navigateur sous ce nom (parfois fausse) n'est plus montrée.
    out.zones[z.id] = {
      routes: z.routes.filter((r) => used.has(r.id)).map((r) => ({ id: r.id, name: r.name, ...(r.nameEn ? { nameEn: r.nameEn } : {}), ...(r.bike ? { bike: r.bike } : {}) })),
      bikes: [...new Set(z.routes.map((r) => bikeOf(r.bike)))],
      climbs,
    };
  }
  return out;
}

/**
 * Montées d'une zone proposées au vélo équipé (même règle que `routesForBike` : les itinéraires de son type,
 * ou tous si la zone n'en a aucun), une fois chacune, avec le nom de leur itinéraire dans la langue choisie.
 */
export function zoneClimbs(z: KomZoneIndex, tyre: RouteBike | undefined, lang: string): Array<KomClimb & { routeName: string }> {
  const want = bikeOf(tyre);
  const anyBike = !z.bikes.includes(want);
  const routes = new Map(z.routes.filter((r) => anyBike || bikeOf(r.bike) === want).map((r) => [r.id, r]));
  const seen = new Set<string>();
  const list: Array<KomClimb & { routeName: string }> = [];
  for (const c of z.climbs) {
    const r = routes.get(c.routeId);
    if (!r || seen.has(c.name)) continue;
    seen.add(c.name);
    list.push({ ...c, routeName: lang === 'en' && r.nameEn ? r.nameEn : r.name });
  }
  return list;
}
