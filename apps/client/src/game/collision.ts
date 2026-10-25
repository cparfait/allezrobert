/**
 * Collisions entre coureurs : deux cyclistes ne se traversent pas. Un coureur se décale d'abord
 * sur le côté (le plus libre des deux s'écarte), et si la chaussée est pleine, celui de derrière
 * ne peut pas passer devant : il est retenu à une longueur de vélo et à la vitesse de l'autre.
 */
export interface Body {
  /** Distance sur l'itinéraire (m, non repliée). */
  distM: number;
  /** Décalage latéral (m, + = à droite). */
  lateral: number;
  speedMs: number;
  /** Position imposée (serveur, fantôme) : les autres s'écartent, elle ne bouge pas. */
  fixed?: boolean;
}

/** Longueur d'un vélo avec son coureur, et largeur d'encombrement (m). */
export const BIKE_LENGTH_M = 1.8;
export const BIKE_WIDTH_M = 0.7;
/** Vitesse maximale du décalage latéral de séparation (m/s). */
const PUSH_MS = 2.5;

export function separateRiders(bodies: Body[], halfRoadM: number, dt: number): void {
  const maxPush = PUSH_MS * dt;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i] as Body;
        const b = bodies[j] as Body;
        if (a.fixed && b.fixed) continue;
        const front = a.distM >= b.distM ? a : b;
        const rear = front === a ? b : a;
        if (front.distM - rear.distM >= BIKE_LENGTH_M) continue;
        const dl = front.lateral - rear.lateral;
        const overlap = BIKE_WIDTH_M - Math.abs(dl);
        if (overlap <= 0) continue;
        // Côté d'écart : vers le côté où l'on est déjà ; à égalité, le coureur de devant va à gauche.
        const dir = dl > 0 ? 1 : dl < 0 ? -1 : -1;
        const push = Math.min(overlap, maxPush);
        const movers = (front.fixed ? 0 : 1) + (rear.fixed ? 0 : 1);
        const share = push / movers;
        const apply = (r: Body, sign: number) => {
          if (r.fixed) return 0;
          const before = r.lateral;
          r.lateral = Math.max(-halfRoadM, Math.min(halfRoadM, r.lateral + sign * share));
          return Math.abs(r.lateral - before);
        };
        const moved = apply(front, dir) + apply(rear, -dir);
        // Écart pas encore suffisant (poussée plafonnée ou bord de chaussée) : retenue longitudinale.
        if (overlap - moved > 0.05) {
          if (!rear.fixed) {
            rear.distM = front.distM - BIKE_LENGTH_M;
            rear.speedMs = Math.min(rear.speedMs, front.speedMs);
          } else if (!front.fixed) {
            front.distM = rear.distM + BIKE_LENGTH_M;
            front.speedMs = Math.max(front.speedMs, rear.speedMs);
          }
        }
      }
    }
  }
}
