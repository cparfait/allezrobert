/**
 * Format compact des fichiers d'itinéraire (worlds/<zone>/routes/*.json).
 *
 * L'ancien format écrit chaque point comme un objet `{"x":…,"y":…,"z":…,"d":…}` tous les 2 m ; `d` répète en
 * général `i × pas`. Le format compact remplace `points` par `pointsFlat` : un tableau plat `[x, y, z, x, y, z…]`
 * (pas régulier, `step` donné) ou `[x, y, z, d, …]` (pas irrégulier : 21 fichiers sur 311 en novembre 2026).
 * Environ deux fois moins d'octets, et tout le reste du fichier est inchangé. `id` reste la première clé : le
 * serveur lit les 256 premiers octets d'un fichier pour l'identifier.
 *
 * Transition : tous les lecteurs passent par `decodeRoute`, qui accepte les deux formats. Les fichiers ne seront
 * convertis (tools/terrain/src/compact-routes.ts) qu'une fois une version de l'application qui sait les lire publiée
 * et installée, et les manifestes de collision régénérés (ils retiennent l'empreinte des fichiers d'itinéraire).
 */

import type { RouteData, RoutePoint } from './route.ts';

export const ROUTE_FLAT_VERSION = 1;

export interface RoutePointsFlat {
  v: typeof ROUTE_FLAT_VERSION;
  /** 3 : x, y, z (distance = i × step) ; 4 : x, y, z, d. */
  stride: 3 | 4;
  step?: number;
  data: number[];
}

/** Fichier compact : comme RouteData, avec `pointsFlat` à la place de `points`. */
export type CompactRouteFile = Omit<RouteData, 'points'> & { pointsFlat: RoutePointsFlat };

/** Écart toléré entre `d` et `i × pas` pour retenir le pas régulier (m). */
const STEP_TOLERANCE_M = 1e-6;

/** Itinéraire lu d'un fichier, dans l'un ou l'autre format ; renvoie l'objet tel quel s'il n'est pas compact. */
export function decodeRoute<T = RouteData>(raw: unknown): T {
  const r = raw as (Partial<RouteData> & { pointsFlat?: RoutePointsFlat }) | null;
  if (!r || typeof r !== 'object' || Array.isArray(r.points) || !r.pointsFlat) return raw as T;
  // `points` reprend la place de `pointsFlat` : même ordre de clés que l'ancien format, donc même JSON.stringify et
  // même empreinte (les manifestes de collision retiennent l'empreinte du contenu relu, voir build-collision-obstacles).
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'pointsFlat') out.points = expandPoints(v as RoutePointsFlat);
    else out[k] = v;
  }
  return out as T;
}

export function expandPoints(f: RoutePointsFlat): RoutePoint[] {
  if (!f || f.v !== ROUTE_FLAT_VERSION || !Array.isArray(f.data) || (f.stride !== 3 && f.stride !== 4)) throw new Error('Format d’itinéraire compact inconnu');
  const n = Math.floor(f.data.length / f.stride);
  const out: RoutePoint[] = new Array(n);
  const step = f.step ?? 0;
  for (let i = 0; i < n; i++) {
    const k = i * f.stride;
    out[i] = { x: f.data[k] as number, y: f.data[k + 1] as number, z: f.data[k + 2] as number, d: f.stride === 4 ? (f.data[k + 3] as number) : Math.round(i * step * 1e6) / 1e6 };
  }
  return out;
}

/** Itinéraire au format compact (mêmes clés, dans le même ordre, `pointsFlat` à la place de `points`). */
export function encodeRoute(route: RouteData): CompactRouteFile {
  const pts = route.points;
  const step = route.stepM ?? (pts.length > 1 ? (pts[1] as RoutePoint).d - (pts[0] as RoutePoint).d : 0);
  const regular = step > 0 && pts.every((p, i) => Math.abs(p.d - Math.round(i * step * 1e6) / 1e6) <= STEP_TOLERANCE_M);
  const stride: 3 | 4 = regular ? 3 : 4;
  const data: number[] = new Array(pts.length * stride);
  pts.forEach((p, i) => {
    const k = i * stride;
    data[k] = p.x;
    data[k + 1] = p.y;
    data[k + 2] = p.z;
    if (stride === 4) data[k + 3] = p.d;
  });
  const flat: RoutePointsFlat = { v: ROUTE_FLAT_VERSION, stride, ...(regular ? { step } : {}), data };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(route)) {
    if (k === 'points') out.pointsFlat = flat;
    else out[k] = v;
  }
  return out as CompactRouteFile;
}
