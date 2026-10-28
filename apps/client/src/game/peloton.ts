import { shadowCasters } from './shadowBudget.ts';
import * as THREE from 'three/webgpu';
import { AiRider, AI_PROFILES, DraftCalculator, FORMATION_PREFS, LANE_PACE, LaneRotator, Overtaker, keepRightM, laneOffsets, resolveFormation, roadHalfM, type Formation, type FormationPref, type LaneBody, PoseController, TeammateUTurn, createRiderState, paramsFromBike, powerForSpeed, stepRider, airDensity, wakeShiftM, type AiProfileName, type RiderState } from '@allezrobert/physics';
import { BASE_PROFILES, DEFAULT_BIKE, aiIdentity, DEFAULT_LOOK, FACE_SLIDERS, encodeFace, type AvatarLook, type FaceShape, type RouteTrack } from '@allezrobert/shared';
import { createAvatar, type RiderAvatarLike } from '../rider/gltfAvatar.ts';
import { crowdShoes } from '../rider/shoeLook.ts';
import { crowdBike } from '../rider/bikes.ts';
import { rng } from '../engine/noise.ts';

const JERSEYS = ['#e63946', '#2a9d8f', '#f4a261', '#8d99ae', '#06d6a0', '#ef476f', '#118ab2', '#ffd166', '#6a4c93', '#90be6d', '#f3722c', '#277da1'];
const PROFILES: AiProfileName[] = ['rouleur', 'diesel', 'puncheur', 'sprinter'];
/** Visages des IA (avatar MPFB) : profils de base selon le prénom (un coureur sur deux est une femme, comme son prénom). */
const MEN = ['robert', 'moussa', 'karim', 'tom'];
const WOMEN = ['lea', 'aiko', 'ines', 'marta'];

/** Tenue d'un profil de base, curseurs du visage un peu variés (pas deux têtes identiques). */
function botFace(i: number, r: () => number): Partial<AvatarLook> {
  const ids = i % 2 === 0 ? MEN : WOMEN;
  const p = BASE_PROFILES.find((b) => b.id === ids[Math.floor(i / 2) % ids.length]);
  if (!p) return {};
  const shape: FaceShape = { ...p.shape };
  for (const s of FACE_SLIDERS) {
    if (s.group === 'body') continue;
    shape[s.id] = Math.max(-1, Math.min(1, (shape[s.id] ?? 0) + (r() - 0.5) * 0.5));
  }
  const { jersey: _j, jerseyAccent: _a, ...look } = p.look;
  return { ...look, face: encodeFace(shape) };
}

/**
 * Couloir de la caméra de poursuite : derrière le joueur, sur CAMERA_CLEAR_BACK_M (recul de la caméra, CHASE_BACK = 3,5 m
 * dans cameras.ts, plus une marge) et de part et d'autre de son axe sur CAMERA_CLEAR_SIDE_M (moins que l'écart de
 * dépassement, 1,2 m : celui qui double est hors du couloir). Aucune IA n'y reste : elle double ou reste en retrait.
 */
export const CAMERA_CLEAR_BACK_M = 5.5;
export const CAMERA_CLEAR_SIDE_M = 1.0;
/** Écart latéral (m) en dessous duquel une IA qui suit le joueur est dans son couloir ou sur le point d'y entrer. */
const CAMERA_FOLLOW_SIDE_M = 1.6;
/** Vitesse (m/s) à laquelle une IA entrée dans le couloir est repoussée en arrière. */
const CAMERA_PUSHBACK_MS = 8;

export interface PelotonRider {
  id: string;
  name: string;
  /** Nationalité (code ISO) : celle de son « Prénom NOM ». */
  nationality: string;
  color: string;
  state: RiderState;
  lateral: number;
  ai: AiRider;
  avatar: RiderAvatarLike;
  label: THREE.Sprite;
  watts: number;
  cadence: number;
  draft: number;
  massKg: number;
  ftp: number;
  poseCtl: PoseController;
  pose: 'seated' | 'standing' | 'coasting';
  /** Demi-tour vers le groupe quand l'équipier est parti trop loin devant. */
  uturn: TeammateUTurn;
  /** Cap relatif à la route (rad) : 0 sens de marche, π contresens (demi-tour). */
  heading: number;
  /** Dépassement propre d'un coureur plus lent : déboîte à gauche tôt, double, se rabat une fois dégagé. */
  overtaker: Overtaker;
}

function nameSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = 'rgba(10,14,22,0.7)';
  ctx.beginPath();
  ctx.roundRect(4, 8, 248, 48, 22);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(32, 32, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f5f7fa';
  ctx.font = '600 26px Inter, Segoe UI, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 52, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Taille constante à l'écran, quelle que soit la distance.
  const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, sizeAttenuation: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.11, 0.0275, 1);
  s.renderOrder = 10;
  return s;
}

/**
 * Peloton local de coureurs IA (sortie solo). Les IA roulent à l'allure du joueur
 * (W/kg glissant), prennent des relais, attaquent sur les segments ; l'aspiration est
 * calculée pour tout le monde, joueur compris.
 */
export class Peloton {
  readonly riders: PelotonRider[] = [];
  private readonly track: RouteTrack;
  private readonly scene: THREE.Scene;
  private readonly draft = new DraftCalculator();
  private headWindMs = 0;
  private crossWindMs = 0;
  private paceWkg = 2.6;
  /** Puissance moyenne actuelle des équipiers (W), pour l'affichage. */
  groupWatts(): number {
    if (!this.riders.length) return 0;
    return this.riders.reduce((s, r) => s + r.watts, 0) / this.riders.length;
  }
  /**
   * Équipiers (idée « rouler seul en semaine ») : allure imposée en % de la FTP du joueur,
   * réglable en sortie ; null = le groupe suit l'allure du joueur.
   */
  paceFtpPct: number | null = null;
  /** Nombre maximal de coureurs qui projettent une ombre (les plus proches ; voir shadowBudget.ts). */
  shadowRiders = Number.POSITIVE_INFINITY;
  /** Ordre « ralentissez » : allure réduite jusqu'à cet instant (s de sortie). */
  private slowUntil = 0;
  private time = 0;
  /** Équipier attendu (lâché) — pour l'affichage. */
  waitingFor: string | null = null;
  onWait?: (name: string | null) => void;
  /** Un équipier fait demi-tour pour revenir au groupe (annonce dans le HUD). */
  onUTurn?: (name: string) => void;

  /** Forme demandée (touche F) et forme effective (route, vent, nombre d'équipiers). */
  formationPref: FormationPref = 'auto';
  private formationNow: Formation = 'single';
  private formationCheckAt = 0;
  private readonly lanes = new LaneRotator();
  /** Ordre « attendez-moi » : les équipiers devant moi lèvent le pied jusqu'à cet instant (s de sortie). */
  private waitUntil = 0;
  /** Changement de forme effective (annonce dans le HUD). */
  onFormation?: (formation: Formation, pref: FormationPref) => void;

  get formation(): Formation {
    return this.formationNow;
  }

  /** Ordre « ralentissez » : −15 % pendant une minute. */
  slowDown(): void {
    this.slowUntil = this.time + 60;
  }

  /** Ordre « attendez-moi » : pendant 90 s, ceux qui sont devant moi me laissent revenir. */
  waitForMe(): void {
    this.waitUntil = this.time + 90;
  }

  /** Forme suivante : auto → file indienne → deux files → bordure. */
  cycleFormation(): FormationPref {
    this.formationPref = FORMATION_PREFS[(FORMATION_PREFS.indexOf(this.formationPref) + 1) % FORMATION_PREFS.length] as FormationPref;
    this.formationCheckAt = 0;
    return this.formationPref;
  }

  /** Réévalue la forme effective (toutes les 2 s : pas de va-et-vient quand le vent tourne). */
  private updateFormation(): void {
    if (this.time < this.formationCheckAt) return;
    this.formationCheckAt = this.time + 2;
    const f = resolveFormation(this.formationPref, { roadWidthM: this.track.route.roadWidthM, crossWindMs: this.crossWindMs, riders: this.riders.length });
    if (f === this.formationNow) return;
    this.formationNow = f;
    if (f === 'double') this.lanes.assign(this.riders.map((r) => ({ id: r.id, distM: r.state.distM })));
    this.onFormation?.(f, this.formationPref);
  }
  private readonly sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  /** Inclinaison affichée de chaque coureur en virage (rad, lissée). */
  private readonly banks = new WeakMap<PelotonRider, number>();

  constructor(scene: THREE.Scene, track: RouteTrack, count: number, startDistM: number, ftpRef: number) {
    this.scene = scene;
    this.track = track;
    const r = rng(42);
    for (let i = 0; i < count; i++) {
      const massKg = 58 + r() * 30;
      // FTP de chaque IA autour du niveau choisi (± 10 %).
      const ftp = Math.round(ftpRef * (0.9 + r() * 0.2));
      const color = JERSEYS[i % JERSEYS.length] as string;
      // Un sur deux est une femme (voir botFace) : prénom, nom et nationalité cohérents.
      const identity = aiIdentity(i, i % 2 === 1);
      const look: AvatarLook = {
        ...DEFAULT_LOOK,
        nationality: identity.nationality,
        jersey: color,
        jerseyAccent: JERSEYS[(i + 5) % JERSEYS.length] as string,
        bike: ['#1d1d1f', '#c0392b', '#f4f4f4', '#2c3e50', '#16a085'][i % 5] as string,
        bikeModel: crowdBike(i),
        skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'][i % 5] as string,
        helmet: ['#f4f4f4', '#111111', color][i % 3] as string,
        build: r(),
        ...crowdShoes(i),
        ...botFace(i, r),
        heightCm: 160 + ((i * 13) % 36),
      };
      const avatar = createAvatar(look);
      scene.add(avatar.root);
      const name = identity.name;
      const label = nameSprite(name, color);
      scene.add(label);
      const params = paramsFromBike(massKg, DEFAULT_BIKE);
      this.riders.push({
        id: `ai-${i}`,
        name,
        nationality: identity.nationality,
        color,
        // Départ groupé : en file indienne juste devant le joueur et derrière lui, hors du champ de la caméra de poursuite.
        state: createRiderState({ distM: startDistM + (i % 2 ? 2 + Math.floor(i / 2) * 2.2 : -(CAMERA_CLEAR_BACK_M + 1 + Math.floor(i / 2) * 2.2)), speedMs: 0 }),
        lateral: Math.min(((i % 3) - 1) * 0.7 + 1.2, roadHalfM(track.route.roadWidthM)),
        ai: new AiRider({ id: `ai-${i}`, profile: PROFILES[i % PROFILES.length] as AiProfileName, ftpWatts: ftp, params, riderMassKg: massKg, seed: i * 7919, aggressiveness: 0.35 }),
        avatar,
        label,
        watts: 0,
        cadence: 0,
        draft: 0,
        massKg,
        ftp,
        poseCtl: new PoseController(),
        pose: 'seated',
        uturn: new TeammateUTurn({ halfRoadM: Math.max(1.2, track.route.roadWidthM / 2 - 0.4) }),
        heading: 0,
        overtaker: new Overtaker(),
      });
    }
    void AI_PROFILES;
  }

  /**
   * @param player position et puissance du joueur (référence d'allure et d'aspiration)
   * @returns l'aspiration dont bénéficie le joueur (0–1)
   */
  update(
    dt: number,
    player: { distM: number; lateral: number; speedMs: number; watts: number; massKg: number; ftpWatts?: number; reversed?: boolean; headWindMs?: number; crossWindMs?: number },
    /** Cyclistes d'ambiance qui vont dans le même sens : des obstacles à doubler, jamais à traverser. */
    ambient: readonly LaneBody[] = [],
  ): number {
    if (!this.riders.length) return 0;
    // Même vent pour tout le groupe (la route est la même) : de face pour l'effort, de côté pour les sillages.
    this.headWindMs = player.headWindMs ?? 0;
    this.crossWindMs = player.crossWindMs ?? 0;
    this.draft.setCrosswind(this.crossWindMs);
    // Joueur à contresens (demi-tour pour aller chercher quelqu'un) : le groupe continue à son
    // allure, sans l'attendre ni l'abriter ; tout reprend quand il refait demi-tour.
    if (player.reversed) return this.rideOn(dt);
    this.time += dt;
    // Allure : % de FTP imposé (équipiers) ou W/kg du joueur lissé sur ~20 s (le groupe roule « avec » lui).
    const target = this.paceFtpPct !== null && player.ftpWatts ? (player.ftpWatts * this.paceFtpPct) / Math.max(player.massKg, 1) : player.watts / Math.max(player.massKg, 1);
    this.paceWkg += (Math.min(Math.max(target, 1.2), 5.5) - this.paceWkg) * Math.min(1, dt / (this.paceFtpPct !== null ? 6 : 20));
    // Équipier lâché (> 60 m derrière le joueur) : le groupe lève le pied pour l'attendre.
    const dropped = this.riders.filter((r) => !r.uturn.active && player.distM - r.state.distM > 60).sort((a, b) => a.state.distM - b.state.distM)[0];
    const waiting = dropped?.name ?? null;
    if (waiting !== this.waitingFor) {
      this.waitingFor = waiting;
      this.onWait?.(waiting);
    }
    const easing = (this.time < this.slowUntil ? 0.85 : 1) * (waiting ? 0.85 : 1);
    this.updateFormation();
    const double = this.formationNow === 'double';
    const halfRoad = Math.max(1.2, roadHalfM(this.track.route.roadWidthM));
    const laneAt = laneOffsets(halfRoad);
    if (double) this.lanes.update(this.riders.filter((r) => !r.uturn.active).map((r) => ({ id: r.id, distM: r.state.distM })), [{ distM: player.distM }], dt);
    const waitingForMe = this.time < this.waitUntil;

    // Équipier à contresens (demi-tour) : hors aspiration (écarté latéralement) et jamais « roue devant ».
    const all = [
      { distM: player.distM, lateralM: player.lateral, speedMs: player.speedMs },
      ...this.riders.map((r) => ({ distM: r.state.distM, lateralM: r.uturn.active ? 100 : r.lateral, speedMs: r.uturn.active ? 0 : r.state.speedMs })),
    ];
    const factors = this.draft.compute(all);
    const order = [...this.riders].sort((a, b) => b.state.distM - a.state.distM);
    const half = roadHalfM(this.track.route.roadWidthM);
    const right = keepRightM(half);
    order.forEach((r, rank) => {
      r.draft = r.uturn.active ? 0 : (factors[this.riders.indexOf(r) + 1] ?? 0);
      const s = this.track.sample(r.state.distM, this.sample);
      const env = { airDensity: airDensity(s.y, 14), windSpeedMs: this.headWindMs };
      // Demi-tour : l'équipier parti trop loin devant revient vers le groupe (sauf dans un segment disputé).
      const wasActive = r.uturn.active;
      const turn = r.uturn.update(
        { leadM: r.state.distM - player.distM, groupSpeedMs: player.speedMs, distM: r.state.distM, speedMs: r.state.speedMs, lateralM: r.lateral, blocked: this.inSegment(r.state.distM) },
        dt,
      );
      if (turn.active) {
        if (!wasActive) this.onUTurn?.(r.name);
        r.state.distM = turn.distM;
        r.state.speedMs = turn.speedMs;
        r.state.accelMs2 = 0;
        r.lateral = turn.lateralM;
        r.heading = turn.headingRad;
        // À contresens, la pente ressentie est l'opposée de celle de l'itinéraire.
        r.watts = turn.pedaling ? Math.max(0, Math.round(powerForSpeed(turn.speedMs, -s.grade, r.ai.params, env))) : 0;
        r.cadence = r.watts > 15 ? 82 : 0;
        r.pose = r.poseCtl.update({ watts: r.watts, cadence: r.cadence, gradePercent: turn.pedaling ? -s.grade : 0, ftpWatts: r.ftp, speedMs: turn.speedMs }, dt);
        return;
      }
      r.heading = 0;
      // Coureur juste devant (IA dans le sens de marche, ou joueur).
      let ahead: { distM: number; speedMs: number; lateral: number; isPlayer?: boolean } | null = null;
      const myLane = this.lanes.laneOf(r.id);
      // Deux files : on suit le coureur de sa propre file (ou le joueur), pas celui de l'autre file.
      const peers = this.riders.filter((x) => x !== r && !x.uturn.active && (!double || this.lanes.laneOf(x.id) === myLane));
      for (const o of [...peers.map((x) => ({ distM: x.state.distM, speedMs: x.state.speedMs, lateral: x.lateral })), { distM: player.distM, speedMs: player.speedMs, lateral: player.lateral, isPlayer: true }]) {
        if (o.distM > r.state.distM + 0.01 && (!ahead || o.distM < ahead.distM)) ahead = o;
      }
      // Dépassement propre : plus rapide que celui de devant (le joueur, une IA, un cycliste d'ambiance), on déboîte par la
      // gauche à bonne distance, on double avec un mètre d'écart et on se rabat une fois dégagé ; sans place, on reste dans sa roue.
      const sameWay: LaneBody[] = [
        { id: 'player', distM: player.distM, lateralM: player.lateral, speedMs: player.speedMs },
        ...peers.map((x) => ({ id: x.id, distM: x.state.distM, lateralM: x.lateral, speedMs: x.state.speedMs })),
        ...ambient,
      ];
      const plan = r.overtaker.update({ id: r.id, distM: r.state.distM, lateralM: r.lateral, speedMs: r.state.speedMs }, sameWay, half, !this.leftLaneBusy(r.state.distM));
      const out = r.ai.update(
        {
          gradePercent: s.grade,
          speedMs: r.state.speedMs,
          // Élastique autour du joueur : on ralentit devant lui, on accélère derrière (sortie solo).
          groupPaceWkg:
            this.paceWkg * easing * (double ? LANE_PACE[myLane] : 1) * (waitingForMe && r.state.distM > player.distM + 6 ? 0.78 : 1) * (1 - THREE.MathUtils.clamp((r.state.distM - player.distM - 4) / 50, -0.3, 0.45)),
          // Pas de roue à suivre pendant un dépassement : l'IA garde son allure jusqu'à être passée.
          // Derrière le joueur on reste hors du champ de la caméra de poursuite (jamais dans sa roue).
          gapAheadM: ahead && !plan.passing ? ahead.distM - r.state.distM - (ahead.isPlayer && Math.abs(ahead.lateral - r.lateral) < CAMERA_FOLLOW_SIDE_M ? CAMERA_CLEAR_BACK_M : 1.8) : Infinity,
          speedAheadMs: ahead?.speedMs ?? r.state.speedMs,
          ...(ahead && !plan.passing ? { lateralAheadM: ahead.lateral - r.lateral } : {}),
          positionInGroup: rank,
          groupSize: this.riders.length + 1,
          cdaFactor: 1 - r.draft,
          env,
        },
        dt,
      );
      r.watts = out.watts;
      // Se laisser glisser : au-delà de 40 m d'avance, l'équipier se relève et attend le groupe
      // (au-delà de ~120 m qui ne se résorbent pas, il fait demi-tour : voir TeammateUTurn).
      const leadM = r.state.distM - player.distM;
      if (leadM > 40) r.watts = Math.min(r.watts, this.paceWkg * r.massKg * Math.max(0.2, 0.7 - (leadM - 40) / 200));
      r.cadence = out.cadence;
      r.pose = r.poseCtl.update({ watts: r.watts, cadence: out.cadence, gradePercent: s.grade, ftpWatts: r.ftp, speedMs: r.state.speedMs }, dt);
      stepRider(r.state, { watts: r.watts, gradePercent: s.grade, params: r.ai.params, env, cdaFactor: 1 - r.draft }, dt);
      // Vent de côté : l'abri est décalé sous le vent ; le coureur s'y place (bordure).
      const shelter = ahead && this.formationNow !== 'single' ? wakeShiftM(ahead.distM - r.state.distM - 1.75, this.crossWindMs, ahead.speedMs) : 0;
      const base = double ? laneAt[myLane] : (ahead?.lateral ?? Math.min(1.2, half));
      // Circulation à droite : sauf pour doubler, on reste dans la moitié droite (ceux d'en face roulent à gauche).
      let targetLat = THREE.MathUtils.clamp(base + (double ? 0 : out.lateralTargetM) + shelter, right, half);
      if (plan.lateralM !== null) targetLat = plan.lateralM;
      r.lateral += (targetLat - r.lateral) * Math.min(1, dt * (plan.passing ? 1.8 : 0.8));
    });
    return factors[0] ?? 0;
  }

  /**
   * Garde le couloir de la caméra de poursuite dégagé : une IA qui y est entrée (joueur qui ralentit, départ) est
   * repoussée en arrière et ne dépasse pas l'allure du joueur tant qu'elle n'est pas passée sur le côté.
   * À appeler après la séparation des coureurs.
   */
  keepCameraClear(player: { distM: number; lateral: number; speedMs: number }, dt: number): void {
    for (const r of this.riders) {
      if (r.uturn.active) continue;
      const gap = player.distM - r.state.distM;
      if (gap < 0 || gap >= CAMERA_CLEAR_BACK_M || Math.abs(r.lateral - player.lateral) >= CAMERA_CLEAR_SIDE_M) continue;
      r.state.distM -= Math.min(CAMERA_CLEAR_BACK_M - gap, CAMERA_PUSHBACK_MS * dt);
      r.state.speedMs = Math.min(r.state.speedMs, player.speedMs);
    }
  }

  /** Cyclistes d'ambiance qui viennent en face : branché par le jeu (`AmbientCyclists.oncomingAhead`). */
  oncoming: ((distM: number, rangeM: number) => boolean) | null = null;

  /** La voie de gauche est occupée devant `distM` (cycliste d'ambiance ou équipier qui revient à contresens) : pas de dépassement par la gauche. */
  private leftLaneBusy(distM: number): boolean {
    if (this.oncoming?.(distM, 80)) return true;
    return this.riders.some((x) => x.uturn.active && x.state.distM > distM - 8 && x.state.distM < distM + 80);
  }

  /** Le groupe roule seul, à l'allure courante (joueur à contresens). */
  private rideOn(dt: number): number {
    this.time += dt;
    const all = this.riders.map((r) => ({ distM: r.state.distM, lateralM: r.lateral, speedMs: r.state.speedMs }));
    const factors = this.draft.compute(all);
    const order = [...this.riders].sort((a, b) => b.state.distM - a.state.distM);
    order.forEach((r, rank) => {
      const i = this.riders.indexOf(r);
      r.draft = factors[i] ?? 0;
      const s = this.track.sample(r.state.distM, this.sample);
      const ahead = order[rank - 1];
      const env = { airDensity: airDensity(s.y, 14), windSpeedMs: this.headWindMs };
      const out = r.ai.update(
        {
          gradePercent: s.grade,
          speedMs: r.state.speedMs,
          groupPaceWkg: this.paceWkg,
          gapAheadM: ahead ? ahead.state.distM - r.state.distM - 1.8 : Infinity,
          speedAheadMs: ahead?.state.speedMs ?? r.state.speedMs,
          ...(ahead ? { lateralAheadM: ahead.lateral - r.lateral } : {}),
          positionInGroup: rank,
          groupSize: this.riders.length,
          cdaFactor: 1 - r.draft,
          env,
        },
        dt,
      );
      r.watts = out.watts;
      r.cadence = out.cadence;
      r.pose = r.poseCtl.update({ watts: out.watts, cadence: out.cadence, gradePercent: s.grade, ftpWatts: r.ftp, speedMs: r.state.speedMs }, dt);
      stepRider(r.state, { watts: r.watts, gradePercent: s.grade, params: r.ai.params, env, cdaFactor: 1 - r.draft }, dt);
    });
    return 0;
  }

  /** Dans un segment KOM / sprint (on ne fait pas demi-tour en pleine bagarre). */
  private inSegment(distM: number): boolean {
    const d = this.track.wrap(distM);
    return this.track.route.segments.some((g) => g.kind !== 'section' && d >= g.startM && d <= g.endM);
  }

  /** Place les avatars ; les coureurs lointains ne sont pas animés (économie). */
  render(dt: number, camera: THREE.Camera): void {
    const dists: number[] = [];
    for (const r of this.riders) {
      // Même trajectoire en arc que le joueur (virages fluides).
      const p = this.track.linePositionAt(r.state.distM, r.lateral, r.state.speedMs, this.sample);
      r.avatar.root.position.set(p.x, p.y + 0.06, p.z);
      r.avatar.root.rotation.set(0, 0, 0);
      // Cap relatif (demi-tour) : à contresens, l'inclinaison de la pente s'inverse.
      r.avatar.root.rotateY(Math.atan2(p.dirX, p.dirZ) + r.heading);
      r.avatar.root.rotateX(-Math.atan(p.grade / 100) * Math.cos(r.heading));
      const dist = camera.position.distanceTo(r.avatar.root.position);
      r.avatar.root.visible = dist < 600;
      if (dist < 250) {
        r.avatar.setEffort?.(r.watts / r.ftp);
        // Inclinaison en virage, lissée comme celle du joueur (contresens après un demi-tour : virage inversé).
        const lean = this.track.leanAt(r.state.distM, r.state.speedMs, Math.cos(r.heading) < 0 ? -1 : 1);
        const bank = (this.banks.get(r) ?? 0) + (lean - (this.banks.get(r) ?? 0)) * Math.min(1, dt * 3);
        this.banks.set(r, bank);
        r.avatar.update(dt, r.cadence, r.state.speedMs, r.pose, bank);
      }
      dists.push(dist);
      r.label.position.set(p.x, p.y + 2.15, p.z);
      r.label.visible = dist > 7 && dist < 150;
    }
    // Ombres portées : seulement les coureurs les plus proches (coût des cascades d'ombre).
    const casters = shadowCasters(dists, this.shadowRiders, 40);
    this.riders.forEach((r, i) => r.avatar.setShadows(casters[i] as boolean));
  }

  dispose(): void {
    for (const r of this.riders) this.scene.remove(r.avatar.root, r.label);
  }
}
