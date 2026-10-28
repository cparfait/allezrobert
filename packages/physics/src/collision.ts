/**
 * Collisions entre coureurs : deux cyclistes ne se traversent pas. Celui qui arrive de derrière s'écarte d'abord
 * sur le côté (c'est lui qui double, il passe donc à côté de l'autre, qui garde sa ligne). Si la chaussée est pleine,
 * il est retenu à une longueur de vélo et à la vitesse de l'autre. Un coureur « prioritaire » (le joueur, mené au
 * guidon) n'est jamais déporté par une IA ; un coureur « imposé » (serveur, fantôme) ne bouge pas non plus.
 *
 * Module pur, partagé par le jeu (60 Hz) et le serveur (10 Hz).
 */
export interface Body {
  /** Distance sur l'itinéraire (m, non repliée). */
  distM: number;
  /** Décalage latéral (m, + = à droite). */
  lateral: number;
  speedMs: number;
  /** Position imposée (serveur, fantôme) : les autres s'écartent, elle ne bouge pas. */
  fixed?: boolean;
  /** Mené par un humain : garde sa ligne, ce sont les IA qui s'écartent. */
  priority?: boolean;
}

/** Longueur d'un vélo avec son coureur, et largeur d'encombrement (m). */
export const BIKE_LENGTH_M = 1.8;
export const BIKE_WIDTH_M = 0.7;
/** Vitesse maximale du décalage latéral de séparation (m/s), et quand une IA laisse la place à un humain qui la rattrape. */
const PUSH_MS = 2.5;
const YIELD_MS = 4;

const movable = (b: Body): boolean => !b.fixed && !b.priority;

export function separateRiders(bodies: Body[], halfRoadM: number, dt: number): void {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i] as Body;
        const b = bodies[j] as Body;
        if (a.fixed && b.fixed) continue;
        const front = a.distM >= b.distM ? a : b;
        const rear = front === a ? b : a;
        if (front.distM - rear.distM >= BIKE_LENGTH_M) continue;
        const overlap = BIKE_WIDTH_M - Math.abs(front.lateral - rear.lateral);
        if (overlap <= 0) continue;
        // Qui s'écarte : celui qui arrive de derrière (il double), sauf s'il est mené par un humain ou imposé :
        // alors celui de devant lui laisse la place. Aucun des deux ne peut bouger : retenue longitudinale seulement.
        const giver = movable(rear) ? rear : movable(front) ? front : null;
        const other = giver === rear ? front : rear;
        let moved = 0;
        let push = 0;
        if (giver) {
          // Vers le côté où l'on est déjà ; à égalité, le doubleur part à gauche (on double par la gauche), le doublé se range à droite.
          const away = giver.lateral > other.lateral ? 1 : giver.lateral < other.lateral ? -1 : giver === rear ? -1 : 1;
          push = Math.min(overlap, (giver === front ? YIELD_MS : PUSH_MS) * dt);
          moved = shift(giver, away * push, halfRoadM);
          // Bord de chaussée : le reste de l'écart est pris par l'autre, s'il peut bouger.
          if (moved < push - 1e-9 && movable(other)) moved += shift(other, -away * (push - moved), halfRoadM);
        }
        // Écart pas encore suffisant (poussée plafonnée ou bord de chaussée) : retenue longitudinale.
        if (overlap - moved > 0.05) {
          const hold = (r: Body) => {
            r.distM = front.distM - BIKE_LENGTH_M;
            r.speedMs = Math.min(r.speedMs, front.speedMs);
          };
          const advance = (f: Body) => {
            f.distM = rear.distM + BIKE_LENGTH_M;
            f.speedMs = Math.max(f.speedMs, rear.speedMs);
          };
          // L'IA de derrière est retenue. Un humain qui rattrape une IA ne perd pas sa vitesse : l'IA se range (rapidement),
          // sauf si elle ne peut plus bouger (bord de chaussée) : l'humain est alors retenu comme devant n'importe quel obstacle.
          if (movable(rear)) hold(rear);
          else if (giver === front && moved >= push - 1e-9) continue;
          else if (!rear.fixed) hold(rear);
          else if (movable(front)) advance(front);
          else if (!front.fixed) advance(front);
        }
      }
    }
  }
}

/** Décale `r` de `delta` (m) dans la chaussée ; renvoie ce dont il a réellement bougé. */
function shift(r: Body, delta: number, halfRoadM: number): number {
  const before = r.lateral;
  r.lateral = Math.max(-halfRoadM, Math.min(halfRoadM, r.lateral + delta));
  return Math.abs(r.lateral - before);
}
