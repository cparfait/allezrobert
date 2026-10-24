import type * as THREE from 'three/webgpu';
import type { AvatarLook, RouteSegment, RouteTrack } from '@allezrobert/shared';
import { ghostAvatar, ghostify } from './ghost.ts';
import type { RiderAvatarLike } from '../rider/gltfAvatar.ts';

/** Record d'une montée : temps et distance parcourue depuis le pied, chaque seconde. */
export interface KomRecord {
  timeS: number;
  dist: number[];
  date: string;
}

const KEY = (routeId: string, segId: string) => `ar.kom.${routeId}.${segId}`;
/** Élan avant le pied de la côte (m). */
export const CHALLENGE_RUNUP_M = 150;

export function readKomRecord(routeId: string, segId: string): KomRecord | null {
  try {
    const raw = localStorage.getItem(KEY(routeId, segId));
    return raw ? (JSON.parse(raw) as KomRecord) : null;
  } catch {
    return null;
  }
}

function writeKomRecord(routeId: string, segId: string, r: KomRecord): void {
  try {
    localStorage.setItem(KEY(routeId, segId), JSON.stringify(r));
  } catch {
    // Stockage indisponible : le record ne sera pas gardé.
  }
}

/** Temps (s) auquel le record avait parcouru `d` m depuis le pied (interpolé), ou null. */
export function recordTimeAt(rec: KomRecord, d: number): number | null {
  const a = rec.dist;
  if (!a.length || d > (a[a.length - 1] as number)) return null;
  let i = 0;
  while (i + 1 < a.length && (a[i + 1] as number) < d) i++;
  const d0 = a[i] as number;
  const d1 = (a[i + 1] ?? d0) as number;
  return i + (d1 > d0 ? (d - d0) / (d1 - d0) : 0);
}

export interface ChallengeInfo {
  name: string;
  phase: 'runup' | 'climbing' | 'done';
  /** Distance jusqu'au pied (élan) ou jusqu'au sommet (montée), m. */
  toGoM: number;
  elapsedS: number;
  recordS: number | null;
  /** Écart avec le fantôme du record à la même distance (s, négatif = en avance). */
  deltaS: number | null;
  progress: number;
}

export interface ChallengeResult {
  name: string;
  timeS: number;
  previousS: number | null;
  isRecord: boolean;
}

/**
 * Mode défi : battre son record sur une montée chronométrée. Départ lancé 150 m avant le
 * pied, fantôme du record (avatar translucide) et écart en direct, arrivée au sommet.
 */
export class KomChallenge {
  readonly seg: RouteSegment;
  /** Distance de départ de la sortie sur l'itinéraire (m). */
  readonly startD: number;
  private readonly runup: number;
  private readonly len: number;
  private readonly record: KomRecord | null;
  private readonly ghost: RiderAvatarLike | null;
  private readonly track: RouteTrack;
  private readonly routeId: string;
  private phase: ChallengeInfo['phase'] = 'runup';
  private t0 = 0;
  private elapsed = 0;
  private acc = 0;
  private readonly trace: number[] = [];
  private readonly sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  onDone?: (r: ChallengeResult) => void;

  private reGhost = 0;

  constructor(scene: THREE.Scene, track: RouteTrack, seg: RouteSegment, look: AvatarLook) {
    this.track = track;
    this.seg = seg;
    this.routeId = track.route.id;
    this.len = seg.endM > seg.startM ? seg.endM - seg.startM : seg.endM + track.length - seg.startM;
    let start = seg.startM - CHALLENGE_RUNUP_M;
    if (start < 0) start = track.route.loop ? start + track.length : 0;
    this.startD = start;
    this.runup = track.route.loop ? (seg.startM - start + track.length) % track.length : seg.startM - start;
    this.record = readKomRecord(this.routeId, seg.id);
    this.ghost = this.record ? ghostAvatar(scene, look) : null;
    if (this.ghost) this.ghost.root.visible = false;
  }

  /** @param rel distance parcourue depuis le départ de la sortie (m) ; @param elapsedS temps de sortie */
  update(dt: number, rel: number, elapsedS: number): void {
    const climbed = rel - this.runup;
    if (this.phase === 'runup' && climbed >= 0) {
      this.phase = 'climbing';
      this.t0 = elapsedS;
      this.trace.push(0);
    }
    if (this.phase === 'climbing') {
      this.elapsed = elapsedS - this.t0;
      this.acc += dt;
      while (this.acc >= 1) {
        this.acc -= 1;
        this.trace.push(Math.max(0, climbed));
      }
      if (climbed >= this.len) {
        this.phase = 'done';
        // Temps au sommet interpolé sur le dernier pas.
        const timeS = this.elapsed;
        const previousS = this.record?.timeS ?? null;
        const isRecord = previousS === null || timeS < previousS;
        if (isRecord) writeKomRecord(this.routeId, this.seg.id, { timeS, dist: [...this.trace, this.len], date: new Date().toISOString() });
        this.onDone?.({ name: this.seg.name, timeS, previousS, isRecord });
      }
    }
    // Fantôme : visible dès le pied, au rythme du record.
    if (this.ghost && this.record) {
      const show = this.phase === 'climbing';
      this.ghost.root.visible = show;
      if (show) {
        const t = this.elapsed;
        const i = Math.min(Math.floor(t), this.record.dist.length - 1);
        const a = this.record.dist[i] ?? 0;
        const b = this.record.dist[i + 1] ?? a;
        const d = this.seg.startM + a + (b - a) * Math.min(t - i, 1);
        const p = this.track.positionAt(d, 0.3, this.sample);
        this.ghost.root.position.set(p.x, p.y + 0.06, p.z);
        this.ghost.root.rotation.set(0, Math.atan2(p.dirX, p.dirZ), 0);
        this.ghost.root.rotateX(-Math.atan(p.grade / 100));
        this.ghost.update(dt, b > a ? 80 : 0, b - a, p.grade > 7 ? 'standing' : 'seated');
        // Vélo remonté après coup (famille chargée) : de nouveau translucide.
        if ((this.reGhost += dt) > 2) {
          this.reGhost = 0;
          ghostify(this.ghost.root);
        }
      }
    }
  }

  info(rel: number): ChallengeInfo {
    const climbed = rel - this.runup;
    const recordAt = this.record && this.phase === 'climbing' ? recordTimeAt(this.record, climbed) : null;
    return {
      name: this.seg.name,
      phase: this.phase,
      toGoM: this.phase === 'runup' ? Math.max(0, -climbed) : Math.max(0, this.len - climbed),
      elapsedS: this.phase === 'runup' ? 0 : this.elapsed,
      recordS: this.record?.timeS ?? null,
      deltaS: recordAt === null ? null : this.elapsed - recordAt,
      progress: Math.min(1, Math.max(0, climbed / this.len)),
    };
  }
}
