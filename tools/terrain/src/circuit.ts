/**
 * Tours qui reviennent à leur départ : le chemin routé repasse sur ses premiers mètres (arête de
 * départ parcourue deux fois), il est donc publié en boucle — coupé là où il retrouve le point de
 * départ — pour enchaîner les tours au lieu de s'arrêter à l'arrivée.
 */
import type { RouteData, RoutePoint } from '@allezrobert/shared';
import { elevationGain } from './profile.ts';

/** Écart maximal (m) entre le point de départ et le tracé qui y revient. */
const CLOSE_M = 5;
/** Le retour au départ est cherché sur le dernier quart du parcours. */
const TAIL_FRACTION = 0.25;
/** Virage maximal au passage de la ligne (au-delà : demi-tour d'un aller-retour en raquette). */
const MAX_TURN_RAD = (135 * Math.PI) / 180;

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Boucle équivalente si l'itinéraire revient sur son départ dans le même sens (pas un demi-tour
 * en raquette), sinon l'itinéraire inchangé.
 */
export function asCircuit(route: RouteData): RouteData {
  const pts = route.points;
  if (route.loop || pts.length < 10) return route;
  const p0 = pts[0]!;
  const length = pts[pts.length - 1]!.d;
  let bi = -1;
  let bd = CLOSE_M;
  for (let i = pts.length - 1; i > 0 && pts[i]!.d >= length * (1 - TAIL_FRACTION); i--) {
    const h = Math.hypot(pts[i]!.x - p0.x, pts[i]!.z - p0.z);
    if (h < bd) {
      bd = h;
      bi = i;
    }
  }
  if (bi < 2) return route;
  // le tracé repart déjà dans le sens du départ (il refait ses premiers mètres), ou bien le
  // passage de la ligne est un virage de carrefour, pas le demi-tour d'une raquette
  const p = pts[bi]!;
  const ahead = pts[Math.min(3, pts.length - 1)]!;
  const cos = (a: RoutePoint, b: RoutePoint) => {
    const ax = b.x - a.x;
    const az = b.z - a.z;
    const ox = ahead.x - p0.x;
    const oz = ahead.z - p0.z;
    return (ax * ox + az * oz) / (Math.hypot(ax, az) * Math.hypot(ox, oz) || 1);
  };
  const retraces = bi + 3 < pts.length && cos(p, pts[bi + 3]!) > Math.cos(Math.PI / 4);
  if (!retraces && cos(pts[Math.max(bi - 3, 0)]!, p) < Math.cos(MAX_TURN_RAD)) return route;

  const points: RoutePoint[] = pts.slice(0, bi);
  const last = points[points.length - 1]!;
  const lengthM = r2(last.d + Math.hypot(p0.x - last.x, p0.y - last.y, p0.z - last.z));
  const runs = <T extends { startM: number; endM: number }>(xs: T[] | undefined) =>
    xs?.filter((x) => x.startM < lengthM).map((x) => ({ ...x, endM: Math.min(x.endM, lengthM) }));
  const hs = points.map((p) => p.y);
  const step = route.stepM ?? 2;
  const w = Math.max(1, Math.round(10 / step));
  let maxGrade = 0;
  for (let i = 0; i + w < hs.length; i++) maxGrade = Math.max(maxGrade, Math.abs((hs[i + w]! - hs[i]!) / (w * step)) * 100);
  const roadWidths = runs(route.roadWidths);
  const surfaces = runs(route.surfaces);
  return {
    ...route,
    loop: true,
    lengthM,
    elevationGainM: r2(elevationGain(hs, true)),
    points,
    // une montée coupée par la ligne garde sa partie avant l'arrivée si elle reste assez longue
    segments: runs(route.segments)!.filter((s) => s.endM - s.startM >= 200),
    ...(roadWidths ? { roadWidths } : {}),
    ...(surfaces ? { surfaces } : {}),
    // boucle : un repère vu au-delà de l'arrivée (le tracé repasse au départ) revient au départ
    ...(route.landmarks ? { landmarks: wrapLandmarks(route.landmarks, lengthM) } : {}),
    ...(route.hairpins ? { hairpins: route.hairpins.filter((h) => h.d < lengthM) } : {}),
    ...(route.minElevationM !== undefined ? { minElevationM: r2(Math.min(...hs)) } : {}),
    ...(route.maxElevationM !== undefined ? { maxElevationM: r2(Math.max(...hs)) } : {}),
    ...(route.maxGradePct !== undefined ? { maxGradePct: r2(maxGrade) } : {}),
  };
}

/** Repères d'une boucle : au-delà de la longueur, ramenés au début du tour ; un seul par nom. */
function wrapLandmarks(marks: Array<{ name: string; d: number }>, lengthM: number): Array<{ name: string; d: number }> {
  const best = new Map<string, number>();
  for (const l of marks) {
    const d = l.d < lengthM ? l.d : r2(l.d - lengthM);
    if (d >= lengthM) continue;
    best.set(l.name, Math.min(best.get(l.name) ?? Infinity, d));
  }
  return [...best].map(([name, d]) => ({ name, d })).sort((a, b) => a.d - b.d);
}
