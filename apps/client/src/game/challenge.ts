import type * as THREE from 'three/webgpu';
import { rankRouteId, type AvatarLook, type RouteSegment, type RouteTrack } from '@allezrobert/shared';
import { ghostAvatar, ghostify } from './ghost.ts';
import type { RiderAvatarLike } from '../rider/gltfAvatar.ts';
import { BIKE_FRONT_M, BIKE_REAR_M, roadPose, type RoadPose } from '../world/roadHeight.ts';

const _pose: RoadPose = { y: 0, pitch: 0 };

/** Record d'une montée : temps et distance parcourue depuis le pied, chaque seconde. */
export interface KomRecord {
  timeS: number;
  dist: number[];
  date: string;
}

/**
 * Clé d'un record : zone, itinéraire et montée. Plusieurs zones ont les mêmes identifiants d'itinéraire
 * (boucle-30-km…) et donc de montée : sans la zone, un record de l'une valait pour toutes.
 */
const KEY = (zone: string, routeId: string, segId: string) => (zone ? `ar.kom.${zone}.${routeId}.${segId}` : `ar.kom.${routeId}.${segId}`);
/** Clé d'avant la zone : relue pour reprendre les anciens records. */
const LEGACY_KEY = (routeId: string, segId: string) => `ar.kom.${routeId}.${segId}`;
/** Zone affichée (réglée au chargement de chaque zone) : zone des records lus et écrits sans zone précisée. */
let komZone = '';
export function setKomZone(zone: string): void {
  komZone = zone;
}
/** Zone affichée, pour ranger aussi par zone les autres meilleurs temps (segments, voix). */
export function recordZone(): string {
  return komZone;
}
/** Élan avant le pied de la côte (m). */
export const CHALLENGE_RUNUP_M = 150;

/**
 * Record d'une montée. `zone` : zone de l'itinéraire (défaut : la zone affichée). `lenM` : longueur de la montée ;
 * un ancien record (clé sans zone) n'est repris que si sa longueur, son dernier point, est la même (±1 m) :
 * il revient ainsi à la seule zone où il a été fait, puis il est recopié sous la clé avec la zone.
 */
export function readKomRecord(routeId: string, segId: string, opts: { zone?: string; lenM?: number } = {}): KomRecord | null {
  const zone = opts.zone ?? komZone;
  try {
    const raw = localStorage.getItem(KEY(zone, routeId, segId));
    if (raw) return JSON.parse(raw) as KomRecord;
    if (!zone) return null;
    const old = localStorage.getItem(LEGACY_KEY(routeId, segId));
    if (!old) return null;
    const rec = JSON.parse(old) as KomRecord;
    const last = rec.dist?.[rec.dist.length - 1];
    if (opts.lenM === undefined || last === undefined || Math.abs(last - opts.lenM) > 1) return null;
    writeKomRecord(routeId, segId, rec, zone);
    return rec;
  } catch {
    return null;
  }
}

function writeKomRecord(routeId: string, segId: string, r: KomRecord, zone = komZone): void {
  try {
    localStorage.setItem(KEY(zone, routeId, segId), JSON.stringify(r));
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
    this.routeId = rankRouteId(track.route.id);
    this.len = seg.endM > seg.startM ? seg.endM - seg.startM : seg.endM + track.length - seg.startM;
    let start = seg.startM - CHALLENGE_RUNUP_M;
    if (start < 0) start = track.route.loop ? start + track.length : 0;
    this.startD = start;
    this.runup = track.route.loop ? (seg.startM - start + track.length) % track.length : seg.startM - start;
    this.record = readKomRecord(this.routeId, seg.id, { lenM: this.len });
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
        // Monde ouvert : roues posées sur la chaussée dessinée (roadHeight.ts).
        roadPose(p.x, p.z, p.dirX, p.dirZ, p.y + 0.06, Math.atan(p.grade / 100), BIKE_FRONT_M, BIKE_REAR_M, _pose);
        this.ghost.root.position.set(p.x, _pose.y, p.z);
        this.ghost.root.rotation.set(0, Math.atan2(p.dirX, p.dirZ), 0);
        this.ghost.root.rotateX(-_pose.pitch);
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
