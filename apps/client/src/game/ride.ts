import * as THREE from 'three/webgpu';
import type { ActivityRecord, RiderProfile, RouteSegment, RouteTrack, VirtualGearing } from '@allezrobert/shared';
import { DEFAULT_GEARING } from '@allezrobert/shared';
import {
  buildGearTable,
  computeTrainerGrade,
  createRiderState,
  neutralGearIndex,
  paramsFromProfile,
  shiftGear,
  stepRider,
  airDensity,
  PoseController,
  TrainerGradeSmoother,
  NormalizedPowerAccumulator,
  type Gear,
  type RiderPhysicsParams,
  type RiderState,
} from '@allezrobert/physics';
import type { InputSource, RideInputs } from './inputs.ts';

export interface RideOptions {
  profile: RiderProfile;
  track: RouteTrack;
  trainerDifficulty: number;
  gearing?: VirtualGearing;
  /** Rapport réel monté sur le trainer (Cog 14 dents par défaut). */
  referenceRatio?: number;
  /** Vent (m/s, d'où il vient en radians, 0 = nord). */
  wind?: { ms: number; from: number };
  startDistM?: number;
}

export interface SegmentEffort {
  seg: RouteSegment;
  startT: number;
  progress: number;
}

export interface SegmentResult {
  seg: RouteSegment;
  timeS: number;
  avgWatts: number;
}

/**
 * Session de sortie locale : intègre la physique à partir de la puissance mesurée,
 * pilote le home trainer (pente simulée × rapport virtuel × difficulté), suit les
 * segments et enregistre à 1 Hz pour le FIT. La vitesse est TOUJOURS celle du jeu.
 */
export class RideSession {
  readonly state: RiderState;
  readonly params: RiderPhysicsParams;
  readonly gears: Gear[];
  gearIndex: number;
  lateral = -1.2; // on roule à droite de l'axe (circulation à droite)
  pose: 'seated' | 'standing' | 'coasting' = 'seated';
  inputs: RideInputs = { watts: 0, cadence: 0, steer: 0 };
  paused = false;
  elapsedS = 0;
  elevationGainM = 0;
  gradePercent = 0;
  /** Consigne ERG imposée par une séance (W) ; null = simulation de pente. */
  ergTarget: number | null = null;
  private ergAcc = 0;
  /** Économie due à l'aspiration (0–1), fournie par le serveur ou les coureurs IA proches. */
  draft = 0;
  lap = 1;
  readonly records: ActivityRecord[] = [];
  readonly startT = Date.now();
  segment: SegmentEffort | null = null;
  readonly segmentResults: SegmentResult[] = [];
  /** Fins de tour (epoch ms), pour les tours du FIT. */
  readonly lapTimes: number[] = [];
  onSegmentDone?: (r: SegmentResult) => void;
  onLap?: (lap: number) => void;

  private readonly opts: RideOptions;
  private readonly poseCtl = new PoseController();
  private readonly smoother = new TrainerGradeSmoother(0);
  private readonly np = new NormalizedPowerAccumulator();
  private readonly power3s: Array<{ t: number; w: number }> = [];
  private totalWork = 0;
  private lastY: number | null = null;
  private recAcc = 0;
  private trainerAcc = 0;
  private segWatts = 0;
  private segSamples = 0;
  private readonly referenceRatio: number;
  private readonly sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };

  constructor(opts: RideOptions) {
    this.opts = opts;
    this.params = paramsFromProfile(opts.profile);
    const gearing = opts.gearing ?? DEFAULT_GEARING;
    this.gears = buildGearTable(gearing);
    this.referenceRatio = opts.referenceRatio ?? gearing.referenceRatio;
    this.gearIndex = neutralGearIndex(gearing, this.gears);
    this.state = createRiderState({ distM: opts.startDistM ?? 0 });
  }

  /** Itinéraire de la sortie. */
  get route(): RouteTrack['route'] {
    return this.opts.track.route;
  }

  get gear(): Gear {
    return this.gears[this.gearIndex] as Gear;
  }

  shift(delta: number): void {
    this.gearIndex = shiftGear(this.gearIndex, delta, this.gears);
  }

  /** Puissance moyenne sur 3 s (affichage). */
  watts3s(): number {
    if (!this.power3s.length) return 0;
    return this.power3s.reduce((s, p) => s + p.w, 0) / this.power3s.length;
  }

  avgWatts(): number {
    return this.elapsedS > 0 ? this.totalWork / this.elapsedS : 0;
  }

  normalizedPower(): number {
    return this.np.value;
  }

  /** Vent apparent de face (m/s) selon la direction de la route. */
  private headwind(dirX: number, dirZ: number): number {
    const w = this.opts.wind;
    if (!w || w.ms <= 0) return 0;
    // Vent venant de `from` : il souffle vers −(sin, −cos) dans le repère x est / z sud.
    const blowX = -Math.sin(w.from);
    const blowZ = Math.cos(w.from);
    return -(blowX * dirX + blowZ * dirZ) * w.ms;
  }

  update(dt: number, source: InputSource, steer: number): void {
    this.inputs = source.read();
    if (this.paused) return;
    this.elapsedS += dt;
    // Horloge de la sortie : temps en mouvement (pauses exclues), indépendante de la cadence d'affichage.
    const now = this.startT + this.elapsedS * 1000;
    const track = this.opts.track;
    const s = track.sample(this.state.distM, this.sample);
    this.gradePercent = s.grade;
    const env = { airDensity: airDensity(s.y, 14), windSpeedMs: this.headwind(s.dirX, s.dirZ) };
    const prevDist = this.state.distM;
    stepRider(this.state, { watts: this.inputs.watts, gradePercent: s.grade, params: this.params, env, cdaFactor: 1 - this.draft }, dt);
    // Tour de boucle.
    if (track.route.loop && Math.floor(this.state.distM / track.length) > Math.floor(prevDist / track.length)) {
      this.lap++;
      this.lapTimes.push(this.startT + this.elapsedS * 1000);
      this.onLap?.(this.lap);
    }
    // Direction : décalage latéral borné à la chaussée.
    const half = track.route.roadWidthM / 2 - 0.5;
    this.lateral = THREE.MathUtils.clamp(this.lateral + steer * dt * 1.8, -half, half);

    this.pose = this.poseCtl.update(
      { watts: this.inputs.watts, cadence: this.inputs.cadence, gradePercent: s.grade, ftpWatts: this.opts.profile.ftpWatts, speedMs: this.state.speedMs },
      dt,
    );

    this.totalWork += this.inputs.watts * dt;
    this.power3s.push({ t: now, w: this.inputs.watts });
    while (this.power3s.length && (this.power3s[0] as { t: number }).t < now - 3000) this.power3s.shift();
    const y = s.y;
    if (this.lastY !== null && y > this.lastY) this.elevationGainM += y - this.lastY;
    this.lastY = y;

    // Home trainer : pente lissée, au plus 4 commandes/s.
    this.trainerAcc += dt;
    const target = computeTrainerGrade({
      gradePercent: s.grade,
      speedMs: this.state.speedMs,
      gearRatio: this.gear.ratio,
      referenceRatio: this.referenceRatio,
      params: this.params,
      env,
      cdaFactor: 1 - this.draft,
      trainerDifficulty: this.opts.trainerDifficulty,
    });
    if (this.ergTarget !== null) {
      // Séance : consigne ERG renvoyée chaque seconde (le power match corrige côté DeviceManager).
      this.ergAcc += dt;
      if (this.ergAcc >= 1) {
        this.ergAcc = 0;
        source.sendTrainer({ kind: 'erg', watts: Math.round(this.ergTarget) });
      }
      this.smoother.reset(target);
    } else {
      const send = this.smoother.update(target, dt);
      if (send !== null) source.sendTrainer({ kind: 'simulation', gradePercent: send, windSpeedMs: 0, crr: this.params.crr, cw: 0.5 * env.airDensity * this.params.cda });
    }

    // Ventilateur : asservi à la vitesse (48 km/h = 100 %).
    source.setFan?.(Math.min(100, (this.state.speedMs * 3.6 * 100) / 48));

    this.updateSegments(now);

    // Enregistrement 1 Hz.
    this.recAcc += dt;
    if (this.recAcc >= 1) {
      this.recAcc -= 1;
      this.np.add(this.inputs.watts);
      const i = this.inputs;
      this.records.push({
        t: now,
        distanceM: this.state.distM - (this.opts.startDistM ?? 0),
        speedMs: this.state.speedMs,
        altitudeM: s.y,
        watts: Math.round(i.watts),
        cadence: Math.round(i.cadence),
        ...(i.hr !== undefined ? { hr: Math.round(i.hr) } : {}),
        ...(i.balanceLeft !== undefined ? { balanceLeft: i.balanceLeft } : {}),
        ...(i.teLeft !== undefined ? { teLeft: i.teLeft, teRight: i.teRight } : {}),
        ...(i.psLeft !== undefined ? { psLeft: i.psLeft, psRight: i.psRight } : {}),
        gradePercent: s.grade,
        x: s.x,
        z: s.z,
      } as ActivityRecord & { x: number; z: number });
    }
  }

  private updateSegments(now: number): void {
    const track = this.opts.track;
    const d = track.wrap(this.state.distM);
    if (this.segment) {
      const seg = this.segment.seg;
      const len = seg.endM - seg.startM;
      const rel = track.wrap(d - seg.startM);
      this.segWatts += this.inputs.watts;
      this.segSamples++;
      if (rel > len || rel < 0) {
        const res = { seg, timeS: (now - this.segment.startT) / 1000, avgWatts: this.segWatts / Math.max(this.segSamples, 1) };
        this.segmentResults.push(res);
        this.segment = null;
        this.onSegmentDone?.(res);
      } else this.segment.progress = rel / len;
      return;
    }
    for (const seg of track.route.segments) {
      const rel = track.wrap(d - seg.startM);
      if (rel >= 0 && rel < 4) {
        this.segment = { seg, startT: now, progress: 0 };
        this.segWatts = 0;
        this.segSamples = 0;
        break;
      }
    }
  }
}
