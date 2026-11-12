import type { RouteTrack, TrackSample } from '@allezrobert/shared';
import { BuildingObstacleIndex, type BuildingObstacle, type ObstacleContact, type ObstaclePoint } from './building-obstacles.ts';
import type { RiderState } from './model.ts';
import { roadHalfM } from './lanes.ts';

export interface RouteObstaclePose {
  distM: number;
  lateral: number;
  speedMs: number;
}

export interface RouteObstacleResult extends RouteObstaclePose {
  hit: boolean;
}

// Trois disques recouvrants suivent l'axe du vélo (enveloppe ~2 × 0,84 m).
const OFFSETS = [-0.6, 0, 0.6];
export const BUILDING_COLLISION_RADIUS_M = 0.42;
const HEIGHT = 1.85;
const STEP_M = 0.5;
const SKIN_M = 0.005;
/** Marge pilote pour les instantanés quantifiés au centimètre. */
export const PILOT_LATERAL_SPEED_MS = 1.5;
const EPS = 1e-7;

/** Pas d'échantillonnage du couloir praticable le long du tracé (m). */
const CORRIDOR_STEP_M = 0.5;
/** Échantillons calculés ensemble, à la première demande. */
const CORRIDOR_CHUNK = 256;
/** Garde entre le bord du couloir et le premier contact avec une façade (m). */
const CORRIDOR_MARGIN_M = 0.1;
/** Garde entre l'axe du vélo et le bord d'une chaussée ou d'une piste étroite (m). */
const CORRIDOR_EDGE_M = 0.25;
/** Horizon d'anticipation : de quoi rentrer de 6 m à PILOT_LATERAL_SPEED_MS. */
const CORRIDOR_LOOKAHEAD_S = 4;

/** Bornes d'un décalage latéral : il reste dans [-left, right]. */
export interface LateralBounds {
  left: number;
  right: number;
}

/** Demi-largeur où l'axe du vélo garde ses roues sur la chaussée ou la piste. */
export function corridorHalfM(roadWidthM: number): number {
  return Math.max(0, Math.min(roadHalfM(roadWidthM), roadWidthM / 2 - CORRIDOR_EDGE_M));
}

function sample(): TrackSample {
  return { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
}

function bodyPoint(pose: TrackSample, offset: number, out: ObstaclePoint): void {
  out.x = pose.x + pose.dirX * offset;
  out.z = pose.z + pose.dirZ * offset;
  out.y = pose.y + 0.06;
}

/**
 * Résolution dans le repère du tracé. Les extrémités de chaque balayage sont des poses de la
 * simulation (`positionAt`). Créer un solveur par simulation et réutiliser le résultat par coureur.
 */
export class RouteBuildingCollision {
  private readonly a = sample();
  private readonly b = sample();
  private readonly start = { x: 0, y: 0, z: 0 };
  private readonly end = { x: 0, y: 0, z: 0 };
  private readonly hit = { fraction: 0, nx: 0, nz: 0 };
  private readonly retryHit = { fraction: 0, nx: 0, nz: 0 };
  private readonly probe = { fraction: 0, nx: 0, nz: 0 };

  private readonly from = { distM: 0, lateral: 0, speedMs: 0 };
  private readonly to = { distM: 0, lateral: 0, speedMs: 0 };
  private readonly result = { distM: 0, lateral: 0, speedMs: 0, hit: false };

  private readonly corridorHit = { fraction: 0, nx: 0, nz: 0 };
  private readonly corridors = new WeakMap<RouteTrack, Map<number, Float32Array>>();

  constructor(private readonly index: BuildingObstacleIndex, private readonly skinM = SKIN_M, private readonly motionMarginM = 0) {}

  /** Demi-largeur praticable de la chaussée à `distM`, bornée par `limitM`. */
  roadHalfAt(track: RouteTrack, distM: number, limitM = Infinity): number {
    return Math.min(limitM, corridorHalfM(track.widthAt(distM)));
  }

  /**
   * Bornes que le décalage peut viser maintenant pour rester sur la chaussée et hors des façades à venir,
   * en se déplaçant latéralement à PILOT_LATERAL_SPEED_MS au plus. `dir` est le sens de marche sur le tracé.
   */
  steeringBounds(track: RouteTrack, distM: number, speedMs: number, dir: number, out: LateralBounds): LateralBounds {
    const step = CORRIDOR_STEP_M;
    const ahead = Math.max(step, Math.abs(speedMs) * CORRIDOR_LOOKAHEAD_S);
    const v = Math.max(0.5, Math.abs(speedMs));
    const forward = dir < 0 ? -1 : 1;
    const lo = Math.floor((distM - (forward > 0 ? step : ahead)) / step);
    const hi = Math.ceil((distM + (forward > 0 ? ahead : step)) / step);
    out.left = Infinity;
    out.right = Infinity;
    for (let k = lo; k <= hi; k++) {
      const chunk = this.corridorSample(track, k);
      if (!chunk) continue;
      // Prudent : un rétrécissement peut commencer jusqu'à un pas avant l'échantillon.
      const slack = PILOT_LATERAL_SPEED_MS * Math.max(0, forward * (k * step - distM) - step) / v;
      const i = this.corridorIndex(track, k) % CORRIDOR_CHUNK;
      out.right = Math.min(out.right, chunk[2 * i]! + slack);
      out.left = Math.min(out.left, chunk[2 * i + 1]! + slack);
    }
    if (!Number.isFinite(out.right)) out.right = this.roadHalfAt(track, distM);
    if (!Number.isFinite(out.left)) out.left = this.roadHalfAt(track, distM);
    return out;
  }

  private corridorIndex(track: RouteTrack, k: number): number {
    const count = Math.max(1, Math.ceil(track.length / CORRIDOR_STEP_M));
    return track.route.loop ? ((k % count) + count) % count : Math.max(0, Math.min(count, k));
  }

  /** Bloc d'échantillons contenant `k` : [droite, gauche] par échantillon, calculé à la première demande. */
  private corridorSample(track: RouteTrack, k: number): Float32Array | undefined {
    let chunks = this.corridors.get(track);
    if (!chunks) this.corridors.set(track, (chunks = new Map()));
    const index = this.corridorIndex(track, k);
    const id = Math.floor(index / CORRIDOR_CHUNK);
    let chunk = chunks.get(id);
    if (!chunk) {
      chunk = new Float32Array(2 * CORRIDOR_CHUNK);
      for (let i = 0; i < CORRIDOR_CHUNK; i++) {
        const d = (id * CORRIDOR_CHUNK + i) * CORRIDOR_STEP_M;
        const half = this.roadHalfAt(track, d);
        chunk[2 * i] = this.sideLimit(track, d, 1, half);
        chunk[2 * i + 1] = this.sideLimit(track, d, -1, half);
      }
      chunks.set(id, chunk);
    }
    return chunk;
  }

  /** Plus grand décalage libre d'un côté, de l'axe jusqu'au bord : un seul balayage latéral. */
  private sideLimit(track: RouteTrack, d: number, side: 1 | -1, half: number): number {
    if (half <= 0) return 0;
    if (!this.sweep(track, d, 0, 0, side * half, this.corridorHit, true)) return half;
    return Math.max(0, this.corridorHit.fraction * half - CORRIDOR_MARGIN_M);
  }

  isClear(track: RouteTrack, distM: number, lateral: number): boolean {
    return !this.sweep(track, distM, lateral, 0, 0, this.hit, true);
  }

  pathIsClear(track: RouteTrack, from: RouteObstaclePose, to: RouteObstaclePose): boolean {
    const d = to.distM - from.distM, l = to.lateral - from.lateral;
    if (this.sweep(track, from.distM, from.lateral, d, l, this.hit, true)) return false;
    // Le rendu relie les deux poses par une corde, tandis que la simulation suit le tracé.
    const steps = Math.ceil(Math.hypot(d, l) / STEP_M);
    for (let i = 0; steps > 1 && i < steps; i++) {
      if (this.sweep(track, from.distM + d * i / steps, from.lateral + l * i / steps, d / steps, l / steps, this.hit, true)) return false;
    }
    return true;
  }

  /** Applique un déplacement proposé à l'état physique, puis renvoie son décalage résolu. */
  apply(track: RouteTrack, prevDistM: number, prevLateral: number, state: RiderState, lateral: number, half: number, dt: number): number {
    if (prevDistM === state.distM && prevLateral === lateral) return lateral;
    this.from.distM = prevDistM;
    this.from.lateral = prevLateral;
    this.to.distM = state.distM;
    this.to.lateral = lateral;
    this.to.speedMs = state.speedMs;
    this.resolve(track, this.from, this.to, half, this.result);
    state.distM = this.result.distM;
    if (dt > 0) state.accelMs2 += (this.result.speedMs - state.speedMs) / dt;
    state.speedMs = this.result.speedMs;
    return this.result.lateral;
  }

  resolve(track: RouteTrack, from: RouteObstaclePose, to: RouteObstaclePose, halfRoadM: number, out: RouteObstacleResult): void {
    const distance = to.distM - from.distM;
    const lateral = to.lateral - from.lateral;
    const proposedDist = to.distM, proposedLateral = to.lateral, speed = to.speedMs;
    const steps = Math.max(1, Math.ceil(Math.hypot(distance, lateral) / STEP_M));
    const dd = distance / steps, dl = lateral / steps;
    out.distM = from.distM;
    out.lateral = from.lateral;
    out.speedMs = speed;
    out.hit = false;
    for (let i = 0; i < steps; i++) {
      // La chaussée peut se rétrécir le long du pas : demi-largeur du tronçon atteint.
      const half = this.roadHalfAt(track, out.distM + dd, halfRoadM);
      const nextLateral = Math.max(-half, Math.min(half, out.lateral + dl));
      const stepLateral = nextLateral - out.lateral;
      const stepLength = Math.hypot(dd, stepLateral);
      if (stepLength < EPS) break;
      if (!this.sweep(track, out.distM, out.lateral, dd, stepLateral, this.hit)) {
        out.distM += dd;
        out.lateral = nextLateral;
        continue;
      }

      out.hit = true;
      const fraction = this.advanceToContact(track, out, dd, stepLateral, this.hit.fraction, stepLength);
      const heading = track.positionAt(out.distM, out.lateral, this.a);
      const forward = this.hit.nx * heading.dirX + this.hit.nz * heading.dirZ;
      const right = -this.hit.nx * heading.dirZ + this.hit.nz * heading.dirX;
      const inward = Math.min(0, dd * forward + stepLateral * right);
      // Projeter sur le mur dans la base locale du tracé. La projection peut sortir du ruban.
      const rest = 1 - fraction;
      const slideD = Math.max(Math.min(dd, 0), Math.min(Math.max(dd, 0), dd - inward * forward)) * rest;
      const slideL = Math.max(-half, Math.min(half, out.lateral + (stepLateral - inward * right) * rest)) - out.lateral;
      let advanced = 0;
      if (Math.hypot(slideD, slideL) >= EPS && (forward !== 0 || right !== 0)) {
        if (this.sweep(track, out.distM, out.lateral, slideD, slideL, this.retryHit)) {
          // Coin ou tangente hors de la chaussée : dernier point sûr. Le pas suivant repart de là.
          this.advanceToContact(track, out, slideD, slideL, this.retryHit.fraction, Math.hypot(slideD, slideL));
        } else {
          out.distM += slideD;
          out.lateral += slideL;
          advanced = slideD;
        }
      }
      if (Math.abs(dd) >= EPS && rest > EPS) out.speedMs = Math.min(out.speedMs, speed * Math.abs(advanced / (dd * rest)));
      if (fraction === 0 && advanced === 0 && Math.abs(slideL) < EPS) break;
    }
    if (!out.hit) {
      // Conserver le résultat exact de la simulation quand aucun obstacle ne modifie le pas.
      out.distM = proposedDist;
      const half = this.roadHalfAt(track, proposedDist, halfRoadM);
      out.lateral = Math.max(-half, Math.min(half, proposedLateral));
    }
  }

  private advanceToContact(track: RouteTrack, out: RouteObstaclePose, dd: number, dl: number, hitFraction: number, length: number): number {
    let fraction = Math.max(0, hitFraction - this.skinM / length);
    // La trajectoire paramétrique peut s'écarter de sa corde dans un virage.
    for (let i = 0; i < 4 && fraction > EPS; i++) {
      if (!this.sweep(track, out.distM, out.lateral, dd * fraction, dl * fraction, this.retryHit)) {
        out.distM += dd * fraction;
        out.lateral += dl * fraction;
        return fraction;
      }
      fraction *= 0.5;
    }
    return 0;
  }

  private sweep(track: RouteTrack, d: number, lateral: number, dd: number, dl: number, hit: ObstacleContact, rejectInitialOverlap = false): boolean {
    track.positionAt(d, lateral, this.a);
    track.positionAt(d + dd, lateral + dl, this.b);
    hit.fraction = Infinity;
    const radius = BUILDING_COLLISION_RADIUS_M + (rejectInitialOverlap ? 0 : this.motionMarginM);
    for (const offset of OFFSETS) {
      bodyPoint(this.a, offset, this.start);
      bodyPoint(this.b, offset, this.end);
      if (this.index.sweep(this.start, this.end, radius, HEIGHT, this.probe, rejectInitialOverlap) && this.probe.fraction < hit.fraction) {
        hit.fraction = this.probe.fraction;
        hit.nx = this.probe.nx;
        hit.nz = this.probe.nz;
      }
    }
    return hit.fraction <= 1;
  }
}

let roadCorridor: RouteBuildingCollision | undefined;

/**
 * Couloir de chaussée seul, sans façade : largeur réelle de chaque tronçon (`widthAt`), pour tous les parcours.
 * Instance partagée (calcul synchrone ; couloir mis en cache par tracé).
 */
export function sharedRoadCorridor(): RouteBuildingCollision {
  return (roadCorridor ??= new RouteBuildingCollision(new BuildingObstacleIndex([])));
}

export function createPilotBuildingCollision(obstacles: readonly BuildingObstacle[]): RouteBuildingCollision {
  return new RouteBuildingCollision(new BuildingObstacleIndex(obstacles), 0.025, 0.015);
}
