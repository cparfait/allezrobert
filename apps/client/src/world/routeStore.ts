import { parseStageRouteId } from '../game/tourPlan.ts';
import { forwardRouteId, parseStartedRouteId, type RouteBike, type RouteData } from '@allezrobert/shared';

/** Ce que l'index du monde (`world.json`) dit d'un itinéraire, sans télécharger son fichier. */
export interface WorldRouteRef {
  id: string;
  name: string;
  lengthM: number;
  elevationGainM: number;
  loop: boolean;
  bike?: RouteBike;
}

/**
 * Itinéraires d'un monde, chargés à la demande : un fichier d'itinéraire pèse 1 à 2 Mo (un point tous les 2 m),
 * une zone en a une dizaine. Le menu n'a besoin au lancement que de celui qui est choisi ; les autres arrivent
 * quand on ouvre la liste des parcours, une fiche, le défi KOM, ou quand on en lance un.
 *
 * `index` suffit pour ce qui se lit dans `world.json` (nom, longueur, dénivelé, type de vélo). Tout ce qui lit
 * le tracé (`RouteData`) passe par `get` (déjà chargé) ou `load` (à la demande).
 */
export interface WorldRoutes {
  /** Tous les itinéraires connus, principal d'abord, tracés ajoutés (`add`) à la fin. */
  readonly index: readonly WorldRouteRef[];
  /** Itinéraires déjà chargés, dans l'ordre de l'index. */
  loaded(): RouteData[];
  /** Itinéraire s'il est déjà chargé. */
  get(id: string): RouteData | undefined;
  /** Charge un itinéraire (une seule requête, même demandé plusieurs fois) ; rejette s'il est inconnu ou introuvable. */
  load(id: string): Promise<RouteData>;
  /** Charge tous les itinéraires de l'index. */
  loadAll(): Promise<RouteData[]>;
  /** Vrai quand tous les itinéraires de l'index sont chargés. */
  readonly complete: boolean;
  /** Ajoute (ou remplace) un itinéraire créé sur place : tracé sur la carte. */
  add(route: RouteData): void;
  /** Retire un itinéraire ajouté par `add`. */
  remove(id: string): void;
}

export function createRouteStore(refs: readonly WorldRouteRef[], fetchRoute: (id: string) => Promise<RouteData>, preloaded: readonly RouteData[] = []): WorldRoutes {
  const loadedById = new Map<string, RouteData>(preloaded.map((r) => [r.id, r]));
  const pending = new Map<string, Promise<RouteData>>();
  const extras: RouteData[] = [];
  const known = new Set(refs.map((r) => r.id));
  const store: WorldRoutes = {
    get index() {
      return extras.length ? [...refs, ...extras] : refs;
    },
    loaded() {
      const out: RouteData[] = [];
      for (const r of refs) {
        const d = loadedById.get(r.id);
        if (d) out.push(d);
      }
      return extras.length ? out.concat(extras) : out;
    },
    get(id) {
      return loadedById.get(id) ?? extras.find((r) => r.id === id);
    },
    load(id) {
      const have = store.get(id);
      if (have) return Promise.resolve(have);
      if (!known.has(id)) return Promise.reject(new Error(`Itinéraire ${id} inconnu`));
      let p = pending.get(id);
      if (!p) {
        p = fetchRoute(id).then(
          (data) => {
            loadedById.set(id, data);
            pending.delete(id);
            return data;
          },
          (e: unknown) => {
            // Échec (réseau, fichier absent) : la prochaine demande réessaie.
            pending.delete(id);
            throw e;
          },
        );
        pending.set(id, p);
      }
      return p;
    },
    async loadAll() {
      await Promise.all(refs.map((r) => store.load(r.id)));
      return store.loaded();
    },
    get complete() {
      return loadedById.size >= refs.length;
    },
    add(route) {
      const i = extras.findIndex((r) => r.id === route.id);
      if (i >= 0) extras[i] = route;
      else extras.push(route);
    },
    remove(id) {
      const i = extras.findIndex((r) => r.id === id);
      if (i >= 0) extras.splice(i, 1);
    },
  };
  return store;
}

/** Monde dont tous les itinéraires sont déjà en mémoire (mondes générés sur place, essais). */
export function loadedRouteStore(routes: readonly RouteData[]): WorldRoutes {
  return createRouteStore(routes, (id) => Promise.reject(new Error(`Itinéraire ${id} inconnu`)), routes);
}

/**
 * Charge l'itinéraire de base d'une clé de sortie (`routeKey` : sens inverse et départ déplacé compris), pour que
 * `findRoute(routes.loaded(), clé)` le trouve ensuite. Sans effet si la clé ne désigne aucun itinéraire du monde.
 */
export async function loadRouteForKey(routes: WorldRoutes, key: string): Promise<void> {
  const started = parseStartedRouteId(key)?.id;
  const ids = [key, parseStageRouteId(key)?.baseId, started, started ? forwardRouteId(started) : null, forwardRouteId(key)];
  for (const id of ids) {
    if (id && routes.index.some((r) => r.id === id)) {
      await routes.load(id);
      return;
    }
  }
}
