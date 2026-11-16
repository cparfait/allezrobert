import type { RouteTrack } from '@allezrobert/shared';

/**
 * Freinage avant les virages serrés, pour le joueur, les IA et les cyclistes : personne ne prend un angle droit de
 * village à 50 km/h. Vitesse de passage d'un virage de rayon R : √(a·R), a = 0,7 g sur enrobé sec, 0,45 g mouillé ou
 * en terre ; R estimé par le changement de cap sur ±6 m du tracé. Seuls les virages de moins de 30 m de rayon comptent
 * (au-delà, la vitesse permise dépasse 50 km/h) : les courbes douces ne freinent jamais. Freinage à 4 m/s² au plus,
 * juste ce qu'il faut pour arriver au virage à sa vitesse de passage.
 *
 * Les rayons sont calculés une fois par itinéraire (un point tous les 3 m) : la recherche devant chaque coureur ne
 * coûte qu'une dizaine de lectures de tableau par image.
 */

export const BRAKE_MS2 = 4;
const STEP_M = 3;
const HALF_M = 6;
const MAX_R = 30;
const G = 9.81;

/** Adhérence latérale (m/s²) selon la pluie et le revêtement. */
export function cornerGrip(rain: number, surface = 'asphalt'): number {
  return G * (rain > 0.2 || !/^(asphalt|paved|concrete|chipseal)/.test(surface) ? 0.45 : 0.7);
}

class CornerTable {
  /** Rayon (m) tous les STEP_M mètres ; Infinity hors des virages serrés. */
  readonly radius: Float32Array;
  readonly length: number;
  readonly loop: boolean;

  constructor(track: RouteTrack) {
    this.length = track.length;
    this.loop = !!track.route.loop;
    const n = Math.max(1, Math.ceil(track.length / STEP_M) + 1);
    this.radius = new Float32Array(n).fill(Infinity);
    const L = track.length;
    const at = (d: number) => track.sample(this.loop ? ((d % L) + L) % L : Math.min(L, Math.max(0, d)));
    for (let i = 0; i < n; i++) {
      const d = i * STEP_M;
      if (!this.loop && (d < HALF_M || d > L - HALF_M)) continue;
      const a = at(d - HALF_M);
      const m = at(d);
      const b = at(d + HALF_M);
      let ang = Math.atan2(b.x - m.x, b.z - m.z) - Math.atan2(m.x - a.x, m.z - a.z);
      ang = Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang)));
      const r = ang > 1e-3 ? (2 * HALF_M) / ang : Infinity;
      if (r <= MAX_R) this.radius[i] = r;
    }
  }
}

const tables = new WeakMap<RouteTrack, CornerTable>();

function tableFor(track: RouteTrack): CornerTable {
  let t = tables.get(track);
  // Monde ouvert : le tracé s'allonge au fil des carrefours, la table est refaite quand il a changé.
  if (!t || t.length !== track.length) {
    t = new CornerTable(track);
    tables.set(track, t);
  }
  return t;
}

/** Vitesse permise maintenant (m/s) pour aborder les virages serrés devant (`dir` = ±1) ; Infinity si rien ne freine. */
export function cornerSpeedLimit(track: RouteTrack, distM: number, dir: number, speedMs: number, grip: number): number {
  if (speedMs < 5) return Infinity;
  const t = tableFor(track);
  const n = t.radius.length;
  const reach = (speedMs * speedMs) / (2 * BRAKE_MS2) + 12;
  let limit = Infinity;
  for (let k = 0; k <= reach; k += STEP_M) {
    const d = distM + dir * k;
    let i = Math.round(d / STEP_M);
    if (t.loop) i = ((i % n) + n) % n;
    else if (i < 0 || i >= n) break;
    const r = t.radius[i] as number;
    if (r === Infinity) continue;
    limit = Math.min(limit, Math.sqrt(grip * r + 2 * BRAKE_MS2 * Math.max(0, k - HALF_M)));
  }
  return limit;
}

/** Applique le freinage à une vitesse ; renvoie la nouvelle vitesse (identique si rien ne freine). */
export function brakeForCorners(track: RouteTrack, distM: number, dir: number, speedMs: number, grip: number, dt: number): number {
  const limit = cornerSpeedLimit(track, distM, dir, speedMs, grip);
  return speedMs > limit ? Math.max(limit, speedMs - BRAKE_MS2 * dt) : speedMs;
}
