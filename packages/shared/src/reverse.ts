/**
 * Parcours roulé dans l'autre sens : même tracé parcouru à l'envers, avec son propre identifiant
 * (classements, records et fantôme séparés du sens normal) et ses montées, détectées sur le profil
 * inversé (les descentes du sens normal). Partagé par le client et le serveur (sorties de groupe,
 * contrôle des temps envoyés).
 */
import { detectProfileClimbs, frenchOf } from './roadgraph.ts';
import type { RouteData, RoutePoint, RouteSegment } from './route.ts';

export const REVERSE_SUFFIX = '-inverse';

export function reversedRouteId(id: string): string {
  return `${id}${REVERSE_SUFFIX}`;
}

/** Identifiant du sens normal d'un parcours inversé, sinon null. */
export function forwardRouteId(id: string): string | null {
  return id.endsWith(REVERSE_SUFFIX) ? id.slice(0, -REVERSE_SUFFIX.length) : null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function reverseRoute(r: RouteData): RouteData {
  const pts = r.points;
  const L = r.loop ? r.lengthM : (pts[pts.length - 1] as RoutePoint).d;
  // boucle : même départ, on tourne dans l'autre sens ; aller simple : départ à l'arrivée
  const order = r.loop ? [pts[0] as RoutePoint, ...pts.slice(1).reverse()] : [...pts].reverse();
  const points = order.map((p, i) => ({ x: p.x, y: p.y, z: p.z, d: i === 0 ? 0 : round2(L - p.d) }));
  const mirror = (d: number) => round2(r.loop ? (L - d) % L : L - d);
  const runs = <T extends { startM: number; endM: number }>(xs: T[]) => xs.map((x) => ({ ...x, startM: round2(L - x.endM), endM: round2(L - x.startM) })).reverse();
  const id = reversedRouteId(r.id);
  const hs = points.map((p) => p.y);
  const step = r.stepM ?? L / Math.max(points.length - 1, 1);
  const landmarks = r.landmarks?.map((l) => ({ name: l.name, d: mirror(l.d) })).sort((a, b) => a.d - b.d);
  const segments: RouteSegment[] = [
    ...detectProfileClimbs(hs, step).map((c, i) => {
      const startM = (points[c.startIdx] as RoutePoint).d;
      const endM = (points[c.endIdx] as RoutePoint).d;
      const near = landmarks?.slice().sort((a, b) => Math.abs(a.d - endM) - Math.abs(b.d - endM))[0];
      const name = near && Math.abs(near.d - endM) < 1500 ? `Côte ${frenchOf(near.name)}` : `Côte ${i + 1}`;
      return { id: `${id}-kom-${i + 1}`, kind: 'kom' as const, name, startM, endM, avgGrade: round2(c.avgGrade) };
    }),
    // les sprints (sur le plat) et les sections restent valables dans l'autre sens
    ...runs(r.segments.filter((s) => s.kind !== 'kom')).map((s, i) => ({ ...s, id: `${id}-${s.kind}-${i + 1}` })),
  ].sort((a, b) => a.startM - b.startM);
  let gain = 0;
  for (let i = 1; i < hs.length; i++) gain += Math.max(0, (hs[i] as number) - (hs[i - 1] as number));
  if (r.loop) gain += Math.max(0, (hs[0] as number) - (hs[hs.length - 1] as number));
  const { hairpins: _hairpins, ...rest } = r;
  return {
    ...rest,
    id,
    name: `${r.name} (sens inverse)`,
    nameEn: `${r.nameEn ?? r.name} (reverse)`,
    lengthM: L,
    elevationGainM: round2(gain),
    points,
    segments,
    ...(r.roadWidths ? { roadWidths: runs(r.roadWidths) } : {}),
    ...(r.surfaces ? { surfaces: runs(r.surfaces) } : {}),
    ...(landmarks ? { landmarks } : {}),
  };
}
