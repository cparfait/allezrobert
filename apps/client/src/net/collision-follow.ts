import type { RouteTrack } from '@allezrobert/shared';
import { roadHalfM, type RouteBuildingCollision, type RouteObstaclePose, type RouteObstacleResult } from '@allezrobert/physics';

/** Au-delà de cet écart (m), la pose se recale d'un coup au lieu de rattraper à +8 m/s (même seuil que SelfReconciler). */
export const COLLISION_SNAP_M = 25;

/** La correction et le rendu distant suivent le ruban. Un coin se contourne par l'axe du parcours. */
export class CollisionPoseFollower {
  private bypass = false;
  private readonly next: RouteObstaclePose = { distM: 0, lateral: 0, speedMs: 0 };
  private readonly half: number;

  constructor(private readonly track: RouteTrack, private readonly collision: RouteBuildingCollision) {
    this.half = roadHalfM(track.route.roadWidthM);
  }

  follow(from: RouteObstaclePose, target: RouteObstaclePose, dt: number, smooth: boolean, out: RouteObstaclePose): void {
    const gain = smooth ? 1 - Math.exp(-dt / 0.22) : 1;
    const d = target.distM - from.distM;
    // Grand écart (arrivée en cours de sortie, reprise, regroupement) : recaler d'un coup sur une pose libre.
    // Un saut ne trace aucun trajet à travers un mur, contrairement à un rattrapage de plusieurs secondes.
    if (Math.hypot(d, target.lateral - from.lateral) > COLLISION_SNAP_M && this.collision.isClear(this.track, target.distM, target.lateral)) {
      this.bypass = false;
      Object.assign(out, { distM: target.distM, lateral: target.lateral, speedMs: target.speedMs });
      return;
    }
    const longitudinalLimit = (Math.max(from.speedMs, target.speedMs) + 8) * dt;
    const next = this.next;
    next.distM = from.distM + bounded(d * gain, longitudinalLimit);
    next.lateral = bounded(from.lateral + bounded((target.lateral - from.lateral) * gain, 4 * dt), this.collision.roadHalfAt(this.track, next.distM, this.half));
    next.speedMs = from.speedMs + (target.speedMs - from.speedMs) * gain;
    if (!this.bypass && this.collision.pathIsClear(this.track, from, next)) {
      Object.assign(out, next);
      return;
    }

    this.bypass = Math.abs(d) > 0.04;
    if (this.bypass) {
      // Rentrer dans l'axe, avancer autour du coin, puis retrouver le décalage autoritaire.
      const centering = Math.abs(from.lateral) > 0.02;
      next.distM = centering ? from.distM : next.distM;
      next.lateral = centering ? from.lateral + bounded(-from.lateral, 4 * dt) : 0;
      if (centering) next.speedMs = 0;
    }
    next.lateral = bounded(next.lateral, this.collision.roadHalfAt(this.track, next.distM, this.half));
    if (this.collision.pathIsClear(this.track, from, next)) Object.assign(out, next);
    else {
      Object.assign(out, from);
      out.speedMs = 0;
    }
  }
}

/** Extrapolation courte de l'instantané de soi avant la correction amortie. */
export class CollisionPrediction {
  private readonly follower: CollisionPoseFollower;
  private readonly predicted: RouteObstacleResult = { distM: 0, lateral: 0, speedMs: 0, hit: false };
  private readonly goal: RouteObstaclePose = { distM: 0, lateral: 0, speedMs: 0 };

  constructor(private readonly track: RouteTrack, private readonly collision: RouteBuildingCollision) {
    this.follower = new CollisionPoseFollower(track, collision);
  }

  reconcile(local: RouteObstaclePose, authoritative: RouteObstaclePose, ageS: number, dt: number, out: RouteObstaclePose): void {
    const target = this.goal;
    target.distM = authoritative.distM + authoritative.speedMs * Math.min(Math.max(ageS, 0), 0.25);
    target.lateral = authoritative.lateral;
    target.speedMs = authoritative.speedMs;
    this.collision.resolve(this.track, authoritative, target, roadHalfM(this.track.route.roadWidthM), this.predicted);
    this.follower.follow(local, this.predicted, dt, true, out);
  }
}

function bounded(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}
