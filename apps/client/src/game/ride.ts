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
  bodyCdaFactor,
  poseCdaFactor,
  riderWind,
  surfaceCrr,
  trainerModelFor,
  wetCrrFactor,
  FOOT_DOWN_SPEED_MS,
  PowerSmoother,
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
  /** Vent météo à 10 m (m/s, d'où il vient en radians, 0 = nord). */
  wind?: { ms: number; from: number };
  startDistM?: number;
  /** Fraction de l'inertie appliquée aux accélérations (0,6–1), 1 par défaut. */
  inertiaFactor?: number;
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
  lateral = 1.2; // voie de droite (décalage positif = à droite dans le sens de marche)
  pose: 'seated' | 'standing' | 'coasting' = 'seated';
  inputs: RideInputs = { watts: 0, cadence: 0, steer: 0 };
  paused = false;
  elapsedS = 0;
  elevationGainM = 0;
  gradePercent = 0;
  /** Consigne ERG imposée par une séance (W) ; null = simulation de pente. */
  ergTarget: number | null = null;
  private ergAcc = 0;
  /**
   * Sens de marche sur l'itinéraire : 1 = sens normal, −1 = après un demi-tour (on remonte
   * l'itinéraire, la pente et le vent s'inversent ; ni segment ni tour comptés).
   */
  dir: 1 | -1 = 1;
  /** Économie due à l'aspiration (0–1), fournie par le serveur, les coureurs IA ou les véhicules proches. */
  draft = 0;
  /** Revêtement OSM sous les roues (tenu à jour par la boucle de jeu). */
  surface = 'asphalt';
  /** Abri du vent 0–1 (rue de village, sous-bois). */
  shelter = 0;
  /** Pluie 0–1 (chaussée mouillée). */
  rain = 0;
  /** Coefficient de roulement effectif au dernier pas. */
  crr: number;
  /** Vent de face ressenti à hauteur du coureur (m/s), au dernier pas. */
  windMs = 0;
  /** En groupe : temps dans les roues (s), énergie économisée (J), relais pris. */
  readonly group = { draftS: 0, savedJ: 0, pulls: 0 };
  /** Quelqu'un est dans ma roue (tenu à jour par la boucle de jeu). */
  wheelFollowed = false;
  private pullS = 0;
  private pullCounted = false;
  /** Puissance après lissage (volant d'inertie), celle qui fait avancer le vélo. */
  readonly smoothedPower = new PowerSmoother(0.5);
  lap = 1;
  readonly records: ActivityRecord[] = [];
  readonly startT = Date.now();
  segment: SegmentEffort | null = null;
  readonly segmentResults: SegmentResult[] = [];
  /** Photos automatiques au sommet des côtes (data URL JPEG), pour l'image de partage et la vidéo résumé. */
  readonly summitPhotos: string[] = [];
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
    // Morphologie : le CdA du vélo vaut pour un coureur de 1,78 m et 75 kg.
    const base = paramsFromProfile(opts.profile);
    this.params = { ...base, cda: base.cda * bodyCdaFactor(opts.profile.heightCm, opts.profile.massKg), inertiaFactor: opts.inertiaFactor ?? 1 };
    this.crr = this.params.crr;
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

  /** Demi-tour sur place : on repart dans l'autre sens, sur la voie de droite. */
  uturn(): void {
    this.dir = this.dir > 0 ? -1 : 1;
    this.lateral = -this.lateral;
    this.state.speedMs = Math.min(this.state.speedMs, 3);
    this.smoothedPower.reset(this.inputs.watts);
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
    // Pente dans le sens de marche (inversée après un demi-tour).
    const grade = s.grade * this.dir;
    this.gradePercent = grade;
    this.windMs = riderWind(this.headwind(s.dirX * this.dir, s.dirZ * this.dir), this.shelter);
    const env = { airDensity: airDensity(s.y, 14), windSpeedMs: this.windMs };
    this.crr = surfaceCrr(this.surface, this.params.crr, this.opts.profile.bike.tyre) * wetCrrFactor(this.rain);
    const cdaFactor = (1 - this.draft) * poseCdaFactor(this.pose, grade, this.state.speedMs);
    const prevDist = this.state.distM;
    // Statistiques de groupe : aspiration et relais.
    if (this.draft > 0.05) {
      this.group.draftS += dt;
      const va = this.state.speedMs + env.windSpeedMs;
      this.group.savedJ += this.draft * 0.5 * env.airDensity * this.params.cda * va * Math.abs(va) * this.state.speedMs * dt;
    }
    if (this.wheelFollowed && this.draft < 0.05 && this.state.speedMs > 3) {
      this.pullS += dt;
      if (this.pullS >= 10 && !this.pullCounted) {
        this.group.pulls++;
        this.pullCounted = true;
      }
    } else {
      this.pullS = 0;
      this.pullCounted = false;
    }
    stepRider(
      this.state,
      {
        watts: this.smoothedPower.update(this.inputs.watts, dt),
        gradePercent: grade,
        params: this.params,
        env,
        cdaFactor,
        crr: this.crr,
        footDownBelowMs: FOOT_DOWN_SPEED_MS,
      },
      dt,
    );
    // Sens inverse : stepRider avance toujours ; on recule d'autant sur l'itinéraire.
    if (this.dir < 0) {
      this.state.distM = prevDist - (this.state.distM - prevDist);
      if (!track.route.loop && this.state.distM < 0) {
        this.state.distM = 0;
        this.state.speedMs = 0;
      }
    }
    // Tour de boucle.
    if (this.dir > 0 && track.route.loop && Math.floor(this.state.distM / track.length) > Math.floor(prevDist / track.length)) {
      this.lap++;
      this.lapTimes.push(this.startT + this.elapsedS * 1000);
      this.onLap?.(this.lap);
    }
    // Direction : décalage latéral borné à la chaussée.
    const half = track.route.roadWidthM / 2 - 0.5;
    // Décalage dans le repère de l'itinéraire : à contresens, la droite du coureur est à gauche.
    this.lateral = THREE.MathUtils.clamp(this.lateral + steer * this.dir * dt * 1.8, -half, half);

    this.pose = this.poseCtl.update(
      { watts: this.inputs.watts, cadence: this.inputs.cadence, gradePercent: grade, ftpWatts: this.opts.profile.ftpWatts, speedMs: this.state.speedMs },
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
      gradePercent: grade,
      speedMs: this.state.speedMs,
      gearRatio: this.gear.ratio,
      referenceRatio: this.referenceRatio,
      // Le trainer simule le vélo sur enrobé sec : le revêtement et la pluie se sentent en plus.
      params: this.crr === this.params.crr ? this.params : { ...this.params, crr: this.crr },
      trainer: trainerModelFor(this.params, env),
      env,
      cdaFactor,
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
        gradePercent: grade,
        x: s.x,
        z: s.z,
      } as ActivityRecord & { x: number; z: number });
    }
  }

  private updateSegments(now: number): void {
    const track = this.opts.track;
    // À contresens : segment en cours abandonné, aucun nouveau.
    if (this.dir < 0) {
      this.segment = null;
      return;
    }
    const d = track.wrap(this.state.distM);
    // Distance depuis le début d'un segment : repliée sur une boucle, signée sinon (wrap bornerait
    // les distances négatives à 0 et ouvrirait le segment dès le départ).
    const relTo = (startM: number) => (track.route.loop ? track.wrap(d - startM) : d - startM);
    if (this.segment) {
      const seg = this.segment.seg;
      const len = seg.endM - seg.startM;
      const rel = relTo(seg.startM);
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
      const rel = relTo(seg.startM);
      if (rel >= 0 && rel < 4) {
        this.segment = { seg, startT: now, progress: 0 };
        this.segWatts = 0;
        this.segSamples = 0;
        break;
      }
    }
  }
}
