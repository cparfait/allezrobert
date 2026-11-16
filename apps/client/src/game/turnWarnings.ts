import type { RouteTrack } from '@allezrobert/shared';
import type { TileRoad } from '../world/types.ts';

/**
 * Petit panneau « virage au carrefour » des itinéraires fixes : prévient seulement quand l'itinéraire tourne
 * à une intersection (une autre route part du sommet du virage), jamais dans un simple virage de la route.
 *
 * Virages : changement de cap de plus de 34° entre 25 m avant et 25 m après (tracé de l'itinéraire).
 * Intersection : au moins trois « bras » de chaussée à moins de 7 m du sommet (un tronçon qui s'arrête là compte
 * pour un bras, un tronçon qui passe pour deux) ; un virage simple n'en a que deux. Les chemins, pistes et voies
 * de service ne comptent pas. Tant que les tuiles du sommet ne sont pas chargées, la réponse attend.
 */

export interface TurnWarning {
  /** Distance au sommet du virage (m). */
  inM: number;
  dir: 'left' | 'right';
  /** Virage de plus de 100° (épingle, angle aigu). */
  sharp: boolean;
}

interface Corner {
  d: number;
  /** Angle signé (rad) dans le sens de l'itinéraire : cap atan2(x, z), positif vers la gauche (x à droite quand on regarde vers −z). */
  ang: number;
  x: number;
  z: number;
  /** Intersection : inconnue (tuiles absentes), oui ou non. */
  junction?: boolean;
}

const MIN_TURN = 0.6;
const HALF_SPAN_M = 25;
const STEP_M = 4;
const ARM_R = 7;
const NOT_ROADS = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'pedestrian', 'corridor', 'platform', 'track', 'service']);
/** Distance à laquelle le panneau apparaît. */
export const TURN_WARN_M = 50;

/** Bras de chaussée autour de (x, z) : un par bout de tronçon proche, deux par tronçon qui passe. */
export function armsAt(x: number, z: number, roads: Iterable<TileRoad>, r = ARM_R): number {
  let n = 0;
  for (const road of roads) {
    if (NOT_ROADS.has(road.kind)) continue;
    const p = road.pts;
    if (p.length < 4) continue;
    let best = Infinity;
    let bestAlong = 0;
    let along = 0;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i] as number;
      const az = p[i + 1] as number;
      const ex = (p[i + 2] as number) - ax;
      const ez = (p[i + 3] as number) - az;
      const l2 = ex * ex + ez * ez;
      const len = Math.sqrt(l2);
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
      const q = Math.hypot(ax + ex * t - x, az + ez * t - z);
      if (q < best) {
        best = q;
        bestAlong = along + len * t;
      }
      along += len;
    }
    if (best >= r) continue;
    n += bestAlong < r + 3 || along - bestAlong < r + 3 ? 1 : 2;
  }
  return n;
}

export class TurnWarnings {
  private readonly corners: Corner[] = [];

  constructor(
    private readonly track: RouteTrack,
    /** Tronçons des tuiles chargées autour de (x, z), ou null si la tuile n'est pas encore là. */
    private readonly roadsNear: (x: number, z: number) => Iterable<TileRoad> | null,
  ) {
    const L = track.length;
    const heading = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.atan2(b.x - a.x, b.z - a.z);
    for (let d = HALF_SPAN_M; d < L - HALF_SPAN_M; d += STEP_M) {
      const a = track.sample(d - HALF_SPAN_M);
      const m = track.sample(d);
      const b = track.sample(d + HALF_SPAN_M);
      let ang = heading(m, b) - heading(a, m);
      ang = Math.atan2(Math.sin(ang), Math.cos(ang));
      if (Math.abs(ang) < MIN_TURN) continue;
      const last = this.corners[this.corners.length - 1];
      // Un même virage dépasse le seuil sur plusieurs pas : on garde son sommet (angle le plus fort).
      if (last && d - last.d < 2 * HALF_SPAN_M) {
        if (Math.abs(ang) > Math.abs(last.ang)) Object.assign(last, { d, ang, x: m.x, z: m.z });
      } else this.corners.push({ d, ang, x: m.x, z: m.z });
    }
  }

  /** Prochain virage à une intersection dans le sens de marche (`dir` = ±1), à moins de TURN_WARN_M. */
  next(distM: number, dir: number): TurnWarning | null {
    const L = this.track.length;
    const at = ((distM % L) + L) % L;
    let best: Corner | null = null;
    let bestIn = Infinity;
    for (const c of this.corners) {
      // Un peu au-delà du sommet : le panneau reste jusqu'à la sortie du virage.
      const inM = dir >= 0 ? c.d - at : at - c.d;
      if (inM < -8 || inM > TURN_WARN_M || inM >= bestIn) continue;
      if (!this.isJunction(c)) continue;
      best = c;
      bestIn = inM;
    }
    if (!best) return null;
    // En sens inverse, un virage à gauche de l'itinéraire se prend à droite.
    const right = dir >= 0 ? best.ang < 0 : best.ang > 0;
    return { inM: Math.max(0, bestIn), dir: right ? 'right' : 'left', sharp: Math.abs(best.ang) > 1.75 };
  }

  private isJunction(c: Corner): boolean {
    if (c.junction !== undefined) return c.junction;
    const roads = this.roadsNear(c.x, c.z);
    if (!roads) return false;
    const arms = armsAt(c.x, c.z, roads);
    // Aucune chaussée trouvée : tuile sans réseau (monde d'un seul itinéraire) — pas de panneau.
    c.junction = arms >= 3;
    return c.junction;
  }
}
