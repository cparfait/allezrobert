/**
 * Boucle commencée ailleurs qu'à son départ d'origine : même tracé, dans le même sens, mais les
 * distances repartent de zéro au point choisi (rotation de la boucle). Identifiant
 * « <id>-depart-<m> » (m = distance du nouveau départ sur le tracé d'origine, dans le sens roulé),
 * reconnu par le client et le serveur (sorties de groupe, contrôle des temps).
 *
 * Les montées, sprints et le tour complet restent ceux de la boucle : records et classements sont
 * partagés avec le départ d'origine ({@link rankRouteId}). Une montée à cheval sur le nouveau départ
 * n'est plus chronométrée (elle ne se fait plus d'un seul tenant depuis la ligne).
 * Un aller simple ne se fait pas tourner : son départ reste fixe.
 */
import { forwardRouteId } from './reverse.ts';
import type { RouteData, RoutePoint } from './route.ts';

export const START_INFIX = '-depart-';

export function startedRouteId(id: string, startM: number): string {
  return `${id}${START_INFIX}${Math.round(startM)}`;
}

/** Parcours d'origine et distance du départ choisi d'un identifiant « <id>-depart-<m> », sinon null. */
export function parseStartedRouteId(id: string): { id: string; startM: number } | null {
  const m = /^(.+)-depart-(\d+)$/.exec(id);
  return m ? { id: m[1] as string, startM: Number(m[2]) } : null;
}

/** Identifiant des records et classements : le départ choisi ne change ni la boucle ni ses montées. */
export function rankRouteId(id: string): string {
  return parseStartedRouteId(id)?.id ?? id;
}

/** Identifiant de l'itinéraire du monde (routes des tuiles) : sans sens ni départ. */
export function baseRouteId(id: string): string {
  const r = rankRouteId(id);
  return forwardRouteId(r) ?? r;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** « à Billom », « au Cendre », « aux Martres », « à la Roche ». */
function frenchAt(name: string): string {
  if (/^Le /.test(name)) return `au ${name.slice(3)}`;
  if (/^Les /.test(name)) return `aux ${name.slice(4)}`;
  return `à ${name.replace(/^La /, 'la ').replace(/^L['’]/, 'l’')}`;
}

/**
 * Indice du point de la boucle le plus proche de la distance `d` (ramenée dans [0, longueur) ;
 * au-delà du dernier point, la fermeture ramène au départ, indice 0).
 */
export function startIndex(r: RouteData, d: number): number {
  const pts = r.points;
  const L = r.lengthM;
  const x = ((d % L) + L) % L;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((pts[mid] as RoutePoint).d <= x) lo = mid;
    else hi = mid - 1;
  }
  const a = (pts[lo] as RoutePoint).d;
  const next = lo + 1 < pts.length ? (pts[lo + 1] as RoutePoint).d : L;
  if (x - a <= next - x) return lo;
  return lo + 1 < pts.length ? lo + 1 : 0;
}

/** Même point physique vu dans l'autre sens de la boucle (voir `reverseRoute`). */
export function mirrorStartM(lengthM: number, startM: number): number {
  return startM > 0 ? Math.round(lengthM - startM) : 0;
}

/**
 * Boucle commencée au point du tracé le plus proche de `startM` : points, montées, sprints,
 * revêtements, largeurs, villages et lacets repris depuis ce départ. Rend le parcours lui-même
 * pour un aller simple ou un départ d'origine.
 */
export function rotateRoute(r: RouteData, startM: number): RouteData {
  if (!r.loop || r.points.length < 3) return r;
  const k = startIndex(r, startM);
  if (k === 0) return r;
  const L = r.lengthM;
  const d0 = (r.points[k] as RoutePoint).d;
  const shift = (d: number) => round2((((d - d0) % L) + L) % L);
  const points = [...r.points.slice(k), ...r.points.slice(0, k)].map((p) => ({ x: p.x, y: p.y, z: p.z, d: shift(p.d) }));
  // tronçons : celui qui passe sur le nouveau départ est coupé en deux (fin de tour, début de tour)
  const runs = <T extends { startM: number; endM: number }>(xs: T[]): T[] =>
    xs
      .flatMap((x) => {
        const a = shift(x.startM);
        const e = a + Math.min(L, x.endM - x.startM);
        return e <= L + 0.01 ? [{ ...x, startM: a, endM: round2(Math.min(e, L)) }] : [{ ...x, startM: a, endM: L }, { ...x, startM: 0, endM: round2(e - L) }];
      })
      .filter((x) => x.endM > x.startM)
      .sort((p, q) => p.startM - q.startM);
  // montées et sprints : mêmes identifiants (records partagés) ; à cheval sur le départ, retirés
  const segments = r.segments
    .map((s) => ({ ...s, startM: shift(s.startM), endM: round2(shift(s.startM) + (s.endM - s.startM)) }))
    .filter((s) => s.endM <= L)
    .sort((a, b) => a.startM - b.startM);
  // village pris juste avant le nouveau départ (clic un peu après son point) : il est au départ
  const landmarks = r.landmarks?.map((l) => ({ ...l, d: shift(l.d) > L - 150 ? 0 : shift(l.d) })).sort((a, b) => a.d - b.d);
  const hairpins = r.hairpins?.map((h) => ({ ...h, d: shift(h.d) })).sort((a, b) => a.d - b.d);
  // nom : le village du départ s'il est tout près, sinon le kilomètre du tracé d'origine
  const gap = (d: number) => Math.min(Math.abs(d - d0), L - Math.abs(d - d0));
  const near = r.landmarks?.slice().sort((a, b) => gap(a.d) - gap(b.d))[0];
  const km = (d0 / 1000).toFixed(1);
  const at = near && gap(near.d) < 800 ? near.name : null;
  // « (sens inverse) » : le départ va dans la même parenthèse
  const tag = (name: string, t: string) => (forwardRouteId(r.id) && name.endsWith(')') ? `${name.slice(0, -1)}, ${t})` : `${name} (${t})`);
  return {
    ...r,
    id: startedRouteId(r.id, d0),
    name: tag(r.name, `départ ${at ? frenchAt(at) : `au km ${km.replace('.', ',')}`}`),
    nameEn: tag(r.nameEn ?? r.name, `start at ${at ?? `km ${km}`}`),
    points,
    segments,
    ...(r.roadWidths ? { roadWidths: runs(r.roadWidths) } : {}),
    ...(r.surfaces ? { surfaces: runs(r.surfaces) } : {}),
    ...(landmarks ? { landmarks } : {}),
    ...(hairpins ? { hairpins } : {}),
  };
}
