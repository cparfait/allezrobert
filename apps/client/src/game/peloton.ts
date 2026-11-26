import { withHeadgear, type GearKind } from './headgear.ts';
import { shadowCasters } from './shadowBudget.ts';
import { AnimBudget } from './animBudget.ts';
import { disposeRiderMerge, updateRiderMerge } from './riderMerge.ts';
import { disposeRiderLight, needsLightBuild, updateRiderLight } from './riderLight.ts';
import { disposeRiderMid, updateRiderMid } from './riderMid.ts';
import { applyRiderShadows, disposeRiderShadows } from './riderShadows.ts';
import { createNameTag, placeNameTags, removeNameTag, type NameTag } from './nameTags.ts';
import { skipHiddenMatrixUpdates } from './hiddenMatrices.ts';
import { SMALL_PARTS_CULL, cullSmallParts } from './smallParts.ts';
import { castsShadow, detailGroup, lightColorOf } from './riderDetail.ts';
import { LATERAL_CRUISE, LATERAL_PASSING, LATERAL_SPRING, stepLateral, syncLateral, type LateralMotion } from './lateralSpring.ts';
import * as THREE from 'three/webgpu';
import { AiRider, AI_PROFILES, DraftCalculator, FORMATION_PREFS, GRID_HOLD_M, GRID_RELEASE_M, GRID_ROW_M, GRID_SAME_LINE_M, fromCentre, gridBlend, gridColumns, LANE_PACE, LaneRotator, Overtaker, aheadAlongM, clampToOwnHalf, facingWithin, keepRightM, oncomingLookM, laneOffsets, resolveFormation, roadHalfM, type Formation, type FormationPref, type LaneBody, PoseController, TeammateUTurn, createRiderState, paramsFromBike, powerForSpeed, stepRider, airDensity, wakeShiftM, sharedRoadCorridor, type AiProfileName, type RiderState } from '@allezrobert/physics';
import { BASE_PROFILES, DEFAULT_BIKE, aiIdentity, DEFAULT_LOOK, FACE_SLIDERS, encodeFace, type AvatarLook, type FaceShape, type RouteTrack } from '@allezrobert/shared';
import { GltfRiderAvatar, createAvatar, type RiderAvatarLike } from '../rider/gltfAvatar.ts';
import { brakeForCorners, cornerGrip } from './cornerBrake.ts';
import { crowdShoes } from '../rider/shoeLook.ts';
import { crowdBike } from '../rider/bikes.ts';
import { withTrailBike } from './trailBike.ts';
import { rng } from '../engine/noise.ts';
import { BIKE_FRONT_M, BIKE_REAR_M, roadPose, type RoadPose } from '../world/roadHeight.ts';
import type { RouteBuildingCollision } from '@allezrobert/physics';
import { LEADER_V3_JERSEY, crowdV3, rivalV3Jersey, type V3TeamJersey } from './v3Crowd.ts';
import type { V3Visual } from '../v3/visuals.ts';

/** Adhérence des IA en virage (enrobé sec), voir cornerBrake.ts. */
const CORNER_GRIP = cornerGrip(0);
/** Vitesse latérale (m/s) d'une IA qui regagne sa moitié de chaussée quand le joueur arrive en face (à contresens). */
const RETURN_LATERAL_MS = 1.5;

/**
 * Équipes d'une course (idée du 25/11/2026) : l'IA n° i court pour l'équipe i % RACE_TEAM_COUNT (même partage que le
 * tour à étapes, stageRace.ts : TOUR_TEAMS) ; l'équipe 0 est celle du joueur et porte son maillot. Seuls ses équipiers
 * reçoivent ses ordres (attaque, roule pour moi).
 */
export const RACE_TEAM_COUNT = 4;
export interface RaceTeams {
  /** Maillot du joueur (styles Réel et Poly) : couleur et rappel. */
  jersey: string;
  jerseyAccent: string;
  /** Maillot V3 du joueur (garage V3). */
  v3?: V3TeamJersey;
  /** Tour à étapes : maillots distinctifs gagnés aux étapes précédentes (identifiant de l'IA → maillot). */
  leaders?: Partial<Record<string, 'gc' | 'points' | 'kom'>>;
  /** Tirage des coureurs (noms, profils, tactiques) : fixe pendant tout un tour, nouveau à chaque course sinon. */
  seed?: number;
}
/** Couleurs des maillots distinctifs (styles Réel et Poly) : jaune, vert, blanc à pois rouges. */
export const LEADER_COLORS = { gc: ['#ffd23f', '#ffd23f'], points: ['#3fa65a', '#3fa65a'], kom: ['#f2f2ee', '#d63a2f'] } as const;
/** Couleur d'une équipe adverse : loin de celle du joueur. */
function rivalColor(team: number, mine: string): string {
  const hex = (c: string) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
  const [r0, g0, b0] = hex(mine.length === 7 ? mine : '#000000') as [number, number, number];
  const far = JERSEYS.filter((c) => {
    const [r, g, b] = hex(c) as [number, number, number];
    return Math.hypot(r - r0, g - g0, b - b0) > 120;
  });
  const list = far.length >= RACE_TEAM_COUNT ? far : JERSEYS;
  return list[(team * 3) % list.length] as string;
}

const JERSEYS = ['#e63946', '#2a9d8f', '#f4a261', '#8d99ae', '#06d6a0', '#ef476f', '#118ab2', '#ffd166', '#6a4c93', '#90be6d', '#f3722c', '#277da1'];
const PROFILES: AiProfileName[] = ['rouleur', 'diesel', 'puncheur', 'sprinter'];
/** Visages des IA (avatar MPFB) : profils de base selon le prénom (un coureur sur deux est une femme, comme son prénom). */
const MEN = ['robert', 'mathieu', 'cheick', 'clement', 'roger'];
const WOMEN = ['chloe', 'christine', 'nathalie', 'laetitia'];

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
/** Vitesse approchée (m/s) sur le plat, seul, à `watts` (même relation que le placement des départs décalés). */
function ttSpeedMs(watts: number, massKg: number): number {
  return 10.5 * Math.cbrt(Math.max(0.4, watts / Math.max(40, massKg) / 3.4));
}

/**
 * Puissance de contre-la-montre (W) d'une IA : celle qu'elle peut tenir sur la durée de l'effort, modèle puissance
 * critique (FTP ≈ CP) : P = FTP + 0,9 × W′ / T. Un chrono de 5 min se roule vers 115–125 % de la FTP, une heure
 * vers 100 % ; plafonné à 130 % (efforts très courts), jamais sous 95 %. La durée T dépend de la vitesse, donc de P :
 * quelques itérations suffisent.
 */
export function ttPowerW(lengthM: number, ftp: number, massKg: number, wPrimePerFtp: number): number {
  let p = ftp;
  for (let k = 0; k < 4; k++) {
    const t = Math.max(60, lengthM / ttSpeedMs(p, massKg));
    p = Math.min(ftp * 1.3, Math.max(ftp * 0.95, ftp + (0.9 * wPrimePerFtp * ftp) / t));
  }
  return p;
}

export const CAMERA_CLEAR_BACK_M = 5.5;
export const CAMERA_CLEAR_SIDE_M = 1.0;
/** Écart latéral (m) en dessous duquel une IA qui suit le joueur est dans son couloir ou sur le point d'y entrer. */
const CAMERA_FOLLOW_SIDE_M = 1.6;
/** Vitesse (m/s) à laquelle une IA entrée dans le couloir est repoussée en arrière. */
const CAMERA_PUSHBACK_MS = 8;

/**
 * Arrivée d'un parcours non bouclé : à PARK_ZONE_M de la fin, une IA cesse de rouler et va se ranger à l'arrêt, pied à
 * terre, sur la moitié gauche de la chaussée (le joueur roule à droite et s'arrête au bout du tracé). Places en rangs
 * de deux, premier rang à PARK_FRONT_M avant la fin, rangs espacés de PARK_ROW_M et colonnes de PARK_COL_M (plus que
 * l'encombrement d'un vélo, 1,8 × 0,7 m) : personne ne s'empile, même au bout de la route où la position est bornée.
 */
const PARK_ZONE_M = 40;
const PARK_FRONT_M = 5;
const PARK_ROW_M = 2.4;
const PARK_COL_M = 0.85;
/** Bord gauche : marge entre la première colonne et la bordure (m). */
const PARK_EDGE_M = 0.45;
/** Décélération pour s'arrêter pile à sa place (m/s²), allure d'approche minimale (m/s), pas de côté à l'arrêt (m/s). */
const PARK_BRAKE_MS2 = 1.6;
const PARK_CREEP_MS = 1.5;
const PARK_SIDESTEP_MS = 0.3;
/** Le joueur garde au moins cet écart (m) à droite de la colonne la plus à droite des IA rangées. */
const PARK_PLAYER_GAP_M = 0.85;

/**
 * Fin de relais : l'IA qui quitte la tête fait signe du coude au suivant de passer (clip
 * cyclistHoodsElbowFlick, joué une fois par-dessus la posture en selle). Le clip avance avec le pédalier : il est
 * déroulé par un angle de pédalier imposé, deux tours sur sa durée (1,33 s, soit 90 tr/min).
 */
const FLICK_CLIP = 'cyclistHoodsElbowFlick';
const FLICK_S = 4 / 3;
/** Pas de geste presque arrêté (le clip pédale) : interrompu sous cette vitesse (m/s). */
const FLICK_MIN_MS = 2.5;

/** Passage noté au relevé de course : sommet d'une côte ou ligne de sprint (fin de segment). */
export interface RaceLogSeg {
  key: string;
  segmentId: string;
  name: string;
  kind: 'kom' | 'sprint';
  /** Distance depuis le départ de la course (m). */
  atM: number;
  avgGrade: number;
  lengthM: number;
  /** Ordre de passage (identifiants, 'me' = joueur). */
  order: string[];
}

/** « Roule pour moi » : point suivi par l'équipier, devant le joueur (m) ; follow garde 1,8 + 0,6 m derrière, d'où ~2 m entre les deux. */
const ESCORT_AHEAD_M = 4.4;

export interface PelotonRider {
  id: string;
  name: string;
  /** Nationalité (code ISO) : celle de son « Prénom NOM ». */
  nationality: string;
  color: string;
  /** Course : équipe (0 = celle du joueur) ; absente en sortie (tous équipiers). */
  team?: number;
  state: RiderState;
  lateral: number;
  ai: AiRider;
  avatar: RiderAvatarLike;
  /** Style V3 : coureur et vélo V3 montés sur l'avatar (v3Crowd.ts). */
  v3?: V3Visual;
  label: THREE.Object3D;
  /** Nom affiché au-dessus du coureur (texte de la page, nameTags.ts). */
  tag: NameTag;
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
  private collision?: RouteBuildingCollision;
  private readonly bounds = { left: 0, right: 0 };

  enableBuildingCollisions(collision: RouteBuildingCollision): void {
    this.collision = collision;
    for (const r of this.riders) if (!collision.isClear(this.track, r.state.distM, r.lateral)) r.lateral = 0;
  }
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
  /** Ordre « attaque ! » : l'équipier qui attaque, jusqu'à cet instant (ni plafond d'avance ni demi-tour pendant ce temps). */
  private readonly attackers = new Map<PelotonRider, number>();
  /** Ordre « roule pour moi » : l'équipier qui roule juste devant le joueur, jusqu'à cet instant. */
  private escort: { r: PelotonRider; until: number } | null = null;
  /** Dernière position du joueur (choix de l'équipier qui reçoit un ordre). */
  private playerDistM = 0;
  /**
   * Contre-la-montre (idée NCT Ride) : départs décalés de `gapS` (les IA sont parties avant le joueur, qui part en
   * dernier), pas d'aspiration, chacun à son allure ; temps aux intermédiaires (1/3, 2/3) et à l'arrivée.
   */
  private tt: { startD: number; lengthM: number; offsets: Map<PelotonRider, number>; pace: Map<PelotonRider, number>; splits: number[]; splitTimes: Array<Array<{ name: string; t: number }>>; finish: Array<{ name: string; t: number }>; done: Map<PelotonRider, number> } | null = null;
  /**
   * Relevé de course (tour à étapes) : ordre de passage au sommet des côtes et sur les lignes de sprint (fin des
   * segments, à chaque tour d'une boucle), temps d'arrivée de chacun (avance au départ du contre-la-montre comprise).
   */
  private log: { startD: number; lengthM: number; segs: RaceLogSeg[]; finish: Array<{ id: string; name: string; t: number }>; seen: Map<string, number> } | null = null;
  /** Fin d'un ordre « roule pour moi » : `cracked` si l'équipier a craqué, `done` au bout du temps. */
  onEscortEnd?: (name: string, why: 'cracked' | 'done') => void;
  /** Changement de forme effective (annonce dans le HUD). */
  onFormation?: (formation: Formation, pref: FormationPref) => void;
  /** IA rangées (ou qui vont se ranger) à l'arrivée d'un parcours non bouclé : place attribuée dans l'ordre d'arrivée. */
  private readonly parked = new Map<PelotonRider, { distM: number; lateral: number }>();

  /** IA qui se range à l'arrivée : hors des séparations et du couloir caméra (sa place est déjà libre). */
  isParked(r: PelotonRider): boolean {
    return this.parked.has(r);
  }

  /**
   * Décalage minimal (m) laissé au joueur près de l'arrivée, à droite des IA rangées ; null loin de la fin ou si
   * personne n'est rangé.
   */
  playerMinLateral(distM: number): number | null {
    if (!this.parked.size || this.track.route.loop || distM < this.track.length - PARK_ZONE_M - 20) return null;
    let max = -Infinity;
    for (const slot of this.parked.values()) max = Math.max(max, slot.lateral);
    return max + PARK_PLAYER_GAP_M;
  }

  /** Place n° k à l'arrivée : rangs de deux (un seul sur chaussée étroite) sur la moitié gauche. */
  private parkSlot(k: number): { distM: number; lateral: number } {
    const half = roadHalfM(this.track.route.roadWidthM);
    const cols = half >= 2.2 ? 2 : 1;
    const distM = this.track.length - PARK_FRONT_M - Math.floor(k / cols) * PARK_ROW_M;
    const b = (this.collision ?? sharedRoadCorridor()).steeringBounds(this.track, distM, 0, 1, this.bounds);
    return { distM, lateral: -b.left + PARK_EDGE_M + (k % cols) * PARK_COL_M };
  }

  /**
   * Arrivée d'une IA sur un parcours non bouclé : elle se range avant la ligne, qu'elle ne franchit donc jamais. Son
   * temps est celui qu'elle aurait fait en gardant sa vitesse sur les derniers mètres.
   */
  private noteFinish(r: PelotonRider): void {
    const end = this.track.length;
    const rem = Math.max(0, end - r.state.distM);
    if (rem > PARK_ZONE_M + 5 || (!this.log && !this.tt)) return;
    const t = this.time + (this.tt?.offsets.get(r) ?? 0) + rem / Math.max(4, r.state.speedMs);
    this.logRider(r.id, r.name, end, t);
    this.ttTimes(r, end, t);
  }

  /** L'IA va à sa place d'arrivée et s'y arrête (roue libre, freinage doux) : le coureur V3 pose alors le pied à terre. */
  private park(r: PelotonRider, dt: number): void {
    let slot = this.parked.get(r);
    if (!slot) {
      this.noteFinish(r);
      this.parked.set(r, (slot = this.parkSlot(this.parked.size)));
    }
    const rem = slot.distM - r.state.distM;
    let v = 0;
    if (rem > 0.02) {
      const vStop = Math.sqrt(2 * PARK_BRAKE_MS2 * rem);
      v = Math.max(Math.min(r.state.speedMs, vStop), Math.min(PARK_CREEP_MS, vStop));
      r.state.distM = Math.min(slot.distM, r.state.distM + v * dt);
    } else if (rem < -0.02) {
      // Déjà passé sa place (rare) : il recule au pas, vélo à la main.
      r.state.distM += Math.max(rem, -PARK_SIDESTEP_MS * dt);
    }
    // Vers sa colonne : en roulant (jusqu'à 0,35 × la vitesse), sinon un petit pas de côté.
    const step = Math.max(PARK_SIDESTEP_MS, 0.35 * v) * dt;
    r.lateral += THREE.MathUtils.clamp(slot.lateral - r.lateral, -step, step);
    r.state.speedMs = v;
    r.state.accelMs2 = 0;
    r.heading = 0;
    r.watts = 0;
    r.cadence = 0;
    r.draft = 0;
    r.pose = 'coasting';
  }

  /** Coup de coude en cours (temps écoulé, s) ; file de chaque IA à l'image précédente (double file). */
  private readonly flicks = new Map<PelotonRider, number>();
  private readonly prevLane = new Map<PelotonRider, string>();

  /** Fin de relais : coup de coude (une fois ; pas en roue libre presque arrêté, ni à l'arrivée). */
  private flick(r: PelotonRider): void {
    if (!this.flicks.has(r) && !this.parked.has(r) && r.state.speedMs > FLICK_MIN_MS) this.flicks.set(r, 0);
  }

  private stepFlicks(dt: number): void {
    for (const [r, t] of this.flicks) {
      if (t + dt >= FLICK_S || r.state.speedMs < FLICK_MIN_MS || this.parked.has(r)) this.flicks.delete(r);
      else this.flicks.set(r, t + dt);
    }
  }

  /** Options du coureur V3 pendant le coup de coude : clip imposé, déroulé par l'angle du pédalier. */
  private gesture(r: PelotonRider): { clip: string; crank: number } | undefined {
    const t = this.flicks.get(r);
    return t === undefined || this.parked.has(r) ? undefined : { clip: FLICK_CLIP, crank: Math.min(t / FLICK_S, 0.999) * 2 * 2 * Math.PI };
  }

  /** Doit se ranger : parcours non bouclé, dans la zone d'arrivée (ou déjà rangé). */
  private parking(r: PelotonRider): boolean {
    return this.parked.has(r) || (!this.track.route.loop && !r.uturn.active && r.state.distM >= this.track.length - PARK_ZONE_M);
  }

  /**
   * Joueur arrivé (sortie figée sur l'écran d'arrivée) : toutes les IA finissent leur course et se rangent à leur
   * place, pied à terre, sans jamais s'empiler.
   */
  settleAtFinish(dt: number): void {
    if (this.track.route.loop) return;
    const order = [...this.riders].sort((a, b) => b.state.distM - a.state.distM);
    for (const r of order) this.park(r, dt);
  }

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

  /** Équipiers qui peuvent recevoir un ordre : à moins de 30 m du joueur, dans le sens de marche, les plus frais d'abord. */
  private orderable(except?: PelotonRider): PelotonRider[] {
    return this.riders
      .filter((r) => r !== except && (r.team === undefined || r.team === 0) && !r.uturn.active && !this.parked.has(r) && Math.abs(r.state.distM - this.playerDistM) < 30)
      .sort((a, b) => b.ai.wPrime.fraction - a.ai.wPrime.fraction);
  }

  /** Ordre « attaque ! » : l'équipier le plus frais attaque tout de suite. Renvoie son nom, ou null si personne ne peut. */
  orderAttack(): string | null {
    for (const r of this.orderable(this.escort?.r)) {
      if (!r.ai.orderAttack()) continue;
      this.attackers.set(r, this.time + 300);
      return r.name;
    }
    return null;
  }

  /**
   * Ordre « roule pour moi » : l'équipier le plus frais (sauf un attaquant) vient rouler juste devant le joueur pendant
   * deux minutes. Renvoie son nom, ou null si aucun n'a assez d'énergie (W′ sous 30 %).
   */
  orderPull(): string | null {
    const r = this.orderable().find((x) => !this.attackers.has(x) && x.ai.state !== 'cracked' && x.ai.wPrime.fraction >= 0.3);
    if (!r) return null;
    this.escort = { r, until: this.time + 120 };
    return r.name;
  }

  /**
   * Passe en contre-la-montre : chaque IA est partie `gapS` secondes avant la suivante, le joueur en dernier. Elle est
   * placée là où son allure l'a menée depuis son départ ; son temps = horloge de la course + son avance au départ.
   */
  /**
   * Grille de départ d'une course locale : IA réparties sur toute la largeur, autour du joueur (à sa hauteur, devant et
   * derrière, hors du couloir de la caméra de poursuite). Renvoie la place latérale du joueur, au centre de sa rangée.
   */
  placeOnGrid(startD: number): number {
    const half = roadHalfM(this.track.route.roadWidthM);
    const b = (this.collision ?? sharedRoadCorridor()).steeringBounds(this.track, startD, 0, 1, this.bounds);
    const cols = gridColumns(-Math.min(half, b.left), Math.min(half, b.right));
    const order = fromCentre(cols.length);
    const mine = cols[order[0] as number] as number;
    let k = 0;
    // Rangées : la mienne, puis une devant, une derrière, et ainsi de suite.
    for (let n = 0; k < this.riders.length; n++) {
      const row = n === 0 ? 0 : n % 2 ? (n + 1) / 2 : -n / 2;
      for (const c of order) {
        if (k >= this.riders.length) break;
        const lateralM = cols[c] as number;
        if (row === 0 && lateralM === mine) continue;
        if (row < 0 && -row * GRID_ROW_M < CAMERA_CLEAR_BACK_M && Math.abs(lateralM - mine) < CAMERA_CLEAR_SIDE_M) continue;
        const r = this.riders[k++] as PelotonRider;
        r.state.distM = startD + row * GRID_ROW_M;
        r.state.speedMs = 0;
        r.lateral = lateralM;
        this.grid.set(r, { lateralM, distM: r.state.distM });
      }
    }
    return mine;
  }

  setTimeTrial(startD: number, lengthM: number, gapS = 30): void {
    const n = this.riders.length;
    const offsets = new Map<PelotonRider, number>();
    const pace = new Map<PelotonRider, number>();
    this.riders.forEach((r, i) => {
      const offset = (n - i) * gapS;
      offsets.set(r, offset);
      const watts = ttPowerW(lengthM, r.ftp, r.massKg, r.ai.profile.wPrimePerFtp);
      pace.set(r, watts);
      const v = ttSpeedMs(watts, r.massKg);
      r.state.distM = startD + v * offset;
      r.state.speedMs = v;
      r.lateral = 0.6;
      r.ai.aggressiveness = 0;
    });
    this.tt = { startD, lengthM, offsets, pace, splits: [lengthM / 3, (2 * lengthM) / 3], splitTimes: [[], []], finish: [], done: new Map() };
  }

  /** Lance le relevé de course : sommets et sprints de l'itinéraire entre `startD` et `startD + lengthM`, arrivée. */
  setRaceLog(startD: number, lengthM: number): void {
    const L = this.track.length;
    const laps = this.track.route.loop ? Math.ceil((startD + lengthM) / L) + 1 : 1;
    const segs: RaceLogSeg[] = [];
    for (let lap = 0; lap < laps; lap++) {
      for (const g of this.track.route.segments) {
        if (g.kind !== 'kom' && g.kind !== 'sprint') continue;
        const abs = g.endM + lap * (this.track.route.loop ? L : 0);
        if (abs <= startD || abs - startD > lengthM) continue;
        segs.push({ key: `${g.id}#${lap}`, segmentId: g.id, name: g.name, kind: g.kind, atM: abs - startD, avgGrade: g.avgGrade, lengthM: g.endM - g.startM, order: [] });
      }
    }
    segs.sort((a, b) => a.atM - b.atM);
    this.log = { startD, lengthM, segs, finish: [], seen: new Map() };
  }

  /** Relevé : un coureur (`id`, joueur = 'me') à `distM` au temps de course `t` (s) ; passages et arrivée notés une fois. */
  logRider(id: string, name: string, distM: number, t: number): void {
    const log = this.log;
    if (!log) return;
    const done = distM - log.startD;
    let k = log.seen.get(id) ?? 0;
    while (k < log.segs.length && done >= (log.segs[k] as RaceLogSeg).atM) (log.segs[k++] as RaceLogSeg).order.push(id);
    if (k === log.segs.length && done >= log.lengthM) {
      log.finish.push({ id, name, t });
      k++;
    }
    log.seen.set(id, k);
  }

  /** Relevé de la course : passages, arrivées, et ceux pas encore arrivés (distance restante, vitesse). */
  raceLog(): { segs: RaceLogSeg[]; finish: Array<{ id: string; name: string; t: number }>; pending: Array<{ id: string; name: string; remainingM: number; speedMs: number; t: number }> } | null {
    const log = this.log;
    if (!log) return null;
    const arrived = new Set(log.finish.map((f) => f.id));
    const pending = this.riders
      .filter((r) => !arrived.has(r.id))
      .map((r) => ({ id: r.id, name: r.name, remainingM: Math.max(0, log.lengthM - (r.state.distM - log.startD)), speedMs: Math.max(3, r.state.speedMs), t: this.time + (this.tt?.offsets.get(r) ?? 0) }));
    return { segs: log.segs, finish: log.finish, pending };
  }

  /** Réserve d'énergie et travail de chaque IA (fatigue d'une étape à l'autre). */
  fatigueOf(): Array<{ id: string; wPrime: number; ftp: number }> {
    return this.riders.map((r) => ({ id: r.id, wPrime: r.ai.wPrime.fraction, ftp: r.ai.ftpNow }));
  }

  /** Forme du jour imposée (tour à étapes : fatigue des étapes précédentes) : FTP × `factor`. */
  setForm(id: string, factor: number): void {
    const r = this.riders.find((x) => x.id === id);
    if (!r) return;
    r.ftp = r.ftp * factor;
    r.ai = new AiRider({ id: r.ai.id, profile: r.ai.profile, ftpWatts: r.ftp, params: r.ai.params, riderMassKg: r.massKg, seed: r.ai.id, aggressiveness: r.ai.aggressiveness, tactic: r.ai.tactic });
  }

  get timeTrial(): boolean {
    return this.tt !== null;
  }

  /** Meilleur temps des IA à l'intermédiaire `k`, comparé au temps `t` du joueur (s) : écart (négatif = plus rapide). */
  ttCheckpoint(k: number, t: number): { deltaS: number | null; rival: string | null } {
    const times = this.tt?.splitTimes[k] ?? [];
    if (!times.length) return { deltaS: null, rival: null };
    const best = times.reduce((a, b) => (b.t < a.t ? b : a));
    return { deltaS: t - best.t, rival: best.name };
  }

  /** Classement du contre-la-montre avec le joueur (temps `t`, s) : seules les IA déjà arrivées y figurent. */
  ttResults(name: string, t: number): Array<{ name: string; t: number; me?: boolean }> {
    return [...(this.tt?.finish ?? []), { name, t, me: true }].sort((a, b) => a.t - b.t);
  }

  /** Contre-la-montre : temps d'une IA aux intermédiaires et à l'arrivée (une fois chacun). */
  private ttTimes(r: PelotonRider, distM = r.state.distM, t = this.time + (this.tt?.offsets.get(r) ?? 0)): void {
    const tt = this.tt;
    if (!tt) return;
    const k = tt.done.get(r) ?? 0;
    const marks = [...tt.splits, tt.lengthM];
    if (k >= marks.length || distM - tt.startD < (marks[k] as number)) return;
    if (k < tt.splits.length) tt.splitTimes[k]?.push({ name: r.name, t });
    else tt.finish.push({ name: r.name, t });
    tt.done.set(r, k + 1);
  }

  /** L'équipier qui roule pour le joueur (affichage), ou null. */
  get escortName(): string | null {
    return this.escort?.r.name ?? null;
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
  private readonly pose: RoadPose = { y: 0, pitch: 0 };
  /** Inclinaison affichée de chaque coureur en virage (rad, lissée). */
  private readonly banks = new WeakMap<PelotonRider, number>();
  /** Coureurs dont le dépassement est suspendu (quelqu'un arrive en face). */
  private readonly passHeld = new WeakSet<PelotonRider>();
  /** Vitesse latérale de chaque coureur (lateralSpring.ts : écarts sans à-coup). */
  private readonly latMotion = new WeakMap<PelotonRider, LateralMotion>();
  /** Budget d'animation : coureurs lointains animés une image sur 2 à 4 (animBudget.ts). */
  private readonly animBudgets = new WeakMap<PelotonRider, AnimBudget>();
  private animFrame = 0;
  /** Départ de course (start-grid.ts) : ligne de chaque IA, gardée au début puis rejointe du peloton. */
  private readonly grid = new Map<PelotonRider, { lateralM: number; distM: number }>();

  constructor(scene: THREE.Scene, track: RouteTrack, count: number, startDistM: number, ftpRef: number, teams?: RaceTeams, gearKind: GearKind = teams ? 'race' : 'ride') {
    this.scene = scene;
    this.track = track;
    // Nouveau tirage à chaque course (même équipe tout un tour) : noms, nations, profils, forces et tactiques changent.
    const seed = teams?.seed ?? Math.floor(Math.random() * 1e6);
    const r = rng(42 + seed);
    for (let i = 0; i < count; i++) {
      const massKg = 58 + r() * 30;
      // FTP de chaque IA autour du niveau choisi (± 10 %).
      const ftp = Math.round(ftpRef * (0.9 + r() * 0.2));
      // Course : équipe i % RACE_TEAM_COUNT ; la 0 porte le maillot du joueur, les autres une couleur par équipe.
      const team = teams ? i % RACE_TEAM_COUNT : undefined;
      const lead = teams?.leaders?.[`ai-${i}`];
      const color = lead ? LEADER_COLORS[lead][0] : team === undefined ? (JERSEYS[i % JERSEYS.length] as string) : team === 0 ? teams!.jersey : rivalColor(team, teams!.jersey);
      // Un sur deux est une femme (voir botFace) : prénom, nom et nationalité cohérents.
      const identity = aiIdentity(i + (seed % 997), i % 2 === 1);
      // Couvre-chef et vélo selon la sortie (game/headgear.ts) : tirage propre, sans toucher la suite de r().
      const gearRoll = (i * 0.618034 + 0.137) % 1;
      // Chemins et sentiers : gravel ou VTT, jamais un vélo de route.
      const look: AvatarLook = withTrailBike(withHeadgear({
        ...DEFAULT_LOOK,
        nationality: identity.nationality,
        jersey: color,
        jerseyAccent: lead ? LEADER_COLORS[lead][1] : team === 0 ? teams!.jerseyAccent : (JERSEYS[((team ?? i) + 5) % JERSEYS.length] as string),
        bike: ['#1d1d1f', '#c0392b', '#f4f4f4', '#2c3e50', '#16a085'][i % 5] as string,
        bikeModel: crowdBike(i),
        skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'][i % 5] as string,
        helmet: ['#f4f4f4', '#111111', color][i % 3] as string,
        build: r(),
        ...crowdShoes(i),
        ...botFace(i, r),
        heightCm: 160 + ((i * 13) % 36),
      }, gearKind, gearRoll, { bikeIndex: i }), track.route, i);
      const avatar = createAvatar(look);
      avatar.setFootDown?.(true);
      scene.add(avatar.root);
      skipHiddenMatrixUpdates(avatar.root);
      const v3 = crowdV3(avatar, look, i >> 1, i % 2 === 1, lead ? { piece: { id: LEADER_V3_JERSEY[lead], color: 0 } } : team === undefined ? undefined : team === 0 ? teams!.v3 : rivalV3Jersey(team, teams!.v3?.piece.id), { kind: gearKind, roll: gearRoll });
      const name = identity.name;
      const tag = createNameTag(name, identity.nationality);
      const label = tag.anchor;
      const params = paramsFromBike(massKg, DEFAULT_BIKE);
      this.riders.push({
        id: `ai-${i}`,
        name,
        ...(team !== undefined ? { team } : {}),
        nationality: identity.nationality,
        color,
        // Départ groupé : en file indienne juste devant le joueur et derrière lui, hors du champ de la caméra de poursuite.
        state: createRiderState({ distM: startDistM + (i % 2 ? 2 + Math.floor(i / 2) * 2.2 : -(CAMERA_CLEAR_BACK_M + 1 + Math.floor(i / 2) * 2.2)), speedMs: 0 }),
        lateral: Math.min(((i % 3) - 1) * 0.7 + 1.2, roadHalfM(track.route.roadWidthM)),
        ai: new AiRider({ id: `ai-${i}`, profile: PROFILES[(i + seed) % PROFILES.length] as AiProfileName, ftpWatts: ftp, params, riderMassKg: massKg, seed: i * 7919 + seed * 31, aggressiveness: 0.2 + r() * 0.35 }),
        avatar,
        ...(v3 ? { v3 } : {}),
        label,
        tag,
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
    if (player.reversed) return this.rideOn(dt, player);
    this.time += dt;
    this.playerDistM = player.distM;
    // Ordres : attaque terminée (ou reprise), escorte au bout du temps ou équipier cramé.
    for (const [r, until] of this.attackers) if (this.time > until || r.ai.state !== 'attack') this.attackers.delete(r);
    if (this.escort && (this.time > this.escort.until || this.escort.r.ai.state === 'cracked' || this.escort.r.uturn.active)) {
      const { r } = this.escort;
      this.escort = null;
      this.onEscortEnd?.(r.name, r.ai.state === 'cracked' ? 'cracked' : 'done');
    }
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
    // Double file : celui qui quitte la file rapide (fin de son relais) fait signe du coude.
    this.stepFlicks(dt);
    for (const r of this.riders) {
      const lane = double ? this.lanes.laneOf(r.id) : 'single';
      if (this.prevLane.get(r) === 'fast' && lane === 'slow') this.flick(r);
      this.prevLane.set(r, lane);
    }
    const waitingForMe = this.time < this.waitUntil;

    // Équipier à contresens (demi-tour) : hors aspiration (écarté latéralement) et jamais « roue devant ».
    const all = [
      { distM: player.distM, lateralM: player.lateral, speedMs: player.speedMs },
      ...this.riders.map((r) => ({ distM: r.state.distM, lateralM: r.uturn.active ? 100 : r.lateral, speedMs: r.uturn.active ? 0 : r.state.speedMs })),
    ];
    const factors = this.draft.compute(all);
    // Contre-la-montre : personne ne profite de l'aspiration de personne.
    if (this.tt) factors.fill(0);
    const order = [...this.riders].sort((a, b) => b.state.distM - a.state.distM);
    const half = roadHalfM(this.track.route.roadWidthM);
    const right = keepRightM(half);
    order.forEach((r, rank) => {
      if (this.parking(r)) {
        this.park(r, dt);
        return;
      }
      const beforeD = r.state.distM, beforeLateral = r.lateral;
      r.draft = r.uturn.active ? 0 : (factors[this.riders.indexOf(r) + 1] ?? 0);
      const s = this.track.sample(r.state.distM, this.sample);
      const env = { airDensity: airDensity(s.y, 14), windSpeedMs: this.headWindMs };
      // Demi-tour : l'équipier parti trop loin devant revient vers le groupe (sauf dans un segment disputé).
      const wasActive = r.uturn.active;
      const turn = r.uturn.update(
        { leadM: r.state.distM - player.distM, groupSpeedMs: player.speedMs, distM: r.state.distM, speedMs: r.state.speedMs, lateralM: r.lateral, blocked: this.inSegment(r.state.distM) || this.attackers.has(r) || this.tt !== null },
        dt,
      );
      if (turn.active) {
        if (!wasActive) this.onUTurn?.(r.name);
        r.state.distM = turn.distM;
        r.state.speedMs = turn.speedMs;
        r.state.accelMs2 = 0;
        r.lateral = turn.lateralM;
        // À contresens (retour vers le groupe) : sur sa moitié de la chaussée réelle, jamais sur celle du joueur.
        if (turn.phase === 'back' || turn.phase === 'brakeBack') {
          const b = (this.collision ?? sharedRoadCorridor()).steeringBounds(this.track, r.state.distM, r.state.speedMs, -1, this.bounds);
          r.lateral = clampToOwnHalf(r.lateral, -1, -b.left, b.right);
        }
        if (this.collision) r.lateral = this.collision.apply(this.track, beforeD, beforeLateral, r.state, r.lateral, half, dt);
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
      const grid = this.grid.get(r);
      const onGrid = !!grid && r.state.distM - grid.distM < GRID_HOLD_M;
      if (grid && r.state.distM - grid.distM >= GRID_RELEASE_M) this.grid.delete(r);
      const myLane = this.lanes.laneOf(r.id);
      // Deux files : on suit le coureur de sa propre file (ou le joueur), pas celui de l'autre file.
      const peers = this.riders.filter((x) => x !== r && !x.uturn.active && (!double || this.lanes.laneOf(x.id) === myLane));
      for (const o of [...peers.map((x) => ({ distM: x.state.distM, speedMs: x.state.speedMs, lateral: x.lateral })), { distM: player.distM, speedMs: player.speedMs, lateral: player.lateral, isPlayer: true }]) {
        // Grille de départ : les voisins de rangée ne sont pas « devant » (ils le feraient freiner).
        if (onGrid && Math.abs(o.lateral - r.lateral) >= GRID_SAME_LINE_M) continue;
        if (o.distM > r.state.distM + 0.01 && (!ahead || o.distM < ahead.distM)) ahead = o;
      }
      // « Roule pour moi » : il suit un point fictif devant le joueur, sur sa ligne (sa roue arrière à ~0,6 m de la mienne).
      const escorting = this.escort?.r === r;
      if (escorting) ahead = { distM: player.distM + ESCORT_AHEAD_M, speedMs: player.speedMs, lateral: player.lateral };
      // Dépassement propre : plus rapide que celui de devant (le joueur, une IA, un cycliste d'ambiance), on déboîte par la
      // gauche à bonne distance, on double avec un mètre d'écart et on se rabat une fois dégagé ; sans place, on reste dans sa roue.
      const sameWay: LaneBody[] = [
        { id: 'player', distM: player.distM, lateralM: player.lateral, speedMs: player.speedMs },
        ...peers.map((x) => ({ id: x.id, distM: x.state.distM, lateralM: x.lateral, speedMs: x.state.speedMs })),
        ...ambient,
      ];
      const plan = r.overtaker.update({ id: r.id, distM: r.state.distM, lateralM: r.lateral, speedMs: r.state.speedMs }, sameWay, half, !this.leftLaneBusy(r.state.distM));
      const wasPulling = r.ai.state === 'pull';
      const out = r.ai.update(
        {
          gradePercent: s.grade,
          speedMs: r.state.speedMs,
          // Élastique autour du joueur : on ralentit devant lui, on accélère derrière (sortie solo).
          // Contre-la-montre : chacun seul, à la puissance qu'il peut tenir sur la durée du chrono (ttPowerW).
          groupPaceWkg: this.tt
            ? (this.tt.pace.get(r) ?? r.ftp) / r.massKg
            : this.paceWkg * easing * (double ? LANE_PACE[myLane] : 1) * (waitingForMe && r.state.distM > player.distM + 6 ? 0.78 : 1) * (1 - THREE.MathUtils.clamp((r.state.distM - player.distM - 4) / 50, -0.3, 0.45)),
          // Pas de roue à suivre pendant un dépassement : l'IA garde son allure jusqu'à être passée.
          // Derrière le joueur on reste hors du champ de la caméra de poursuite (jamais dans sa roue).
          gapAheadM: this.tt ? Infinity : escorting && ahead ? Math.min(24, ahead.distM - r.state.distM - 1.8) : ahead && !plan.passing ? ahead.distM - r.state.distM - (ahead.isPlayer && Math.abs(ahead.lateral - r.lateral) < CAMERA_FOLLOW_SIDE_M ? CAMERA_CLEAR_BACK_M : 1.8) : Infinity,
          speedAheadMs: ahead?.speedMs ?? r.state.speedMs,
          ...(ahead && !plan.passing ? { lateralAheadM: ahead.lateral - r.lateral } : {}),
          // L'escorte ne passe pas en mode relais (allure du groupe) : elle cale son allure sur le joueur.
          positionInGroup: escorting || this.tt ? 1 : rank,
          groupSize: this.riders.length + 1,
          cdaFactor: 1 - r.draft,
          env,
        },
        dt,
      );
      // File simple : relais terminé (il quitte la tête et se décale) → signe du coude au suivant.
      if (wasPulling && r.ai.state === 'pullOff') this.flick(r);
      r.watts = out.watts;
      // Se laisser glisser : au-delà de 40 m d'avance, l'équipier se relève et attend le groupe
      // (au-delà de ~120 m qui ne se résorbent pas, il fait demi-tour : voir TeammateUTurn).
      const leadM = r.state.distM - player.distM;
      if (leadM > 40 && !this.attackers.has(r) && !this.tt) r.watts = Math.min(r.watts, this.paceWkg * r.massKg * Math.max(0.2, 0.7 - (leadM - 40) / 200));
      r.cadence = out.cadence;
      r.pose = r.poseCtl.update({ watts: r.watts, cadence: out.cadence, gradePercent: s.grade, ftpWatts: r.ftp, speedMs: r.state.speedMs }, dt);
      stepRider(r.state, { watts: r.watts, gradePercent: s.grade, params: r.ai.params, env, cdaFactor: 1 - r.draft }, dt);
      if (this.tt) this.ttTimes(r);
      if (this.log) this.logRider(r.id, r.name, r.state.distM, this.time + (this.tt?.offsets.get(r) ?? 0));
      // Freinage avant les virages serrés, comme le joueur (cornerBrake.ts).
      r.state.speedMs = brakeForCorners(this.track, r.state.distM, Math.cos(r.heading) < 0 ? -1 : 1, r.state.speedMs, CORNER_GRIP, dt);
      // Vent de côté : l'abri est décalé sous le vent ; le coureur s'y place (bordure).
      const shelter = ahead && this.formationNow !== 'single' ? wakeShiftM(ahead.distM - r.state.distM - 1.75, this.crossWindMs, ahead.speedMs) : 0;
      const base = escorting ? player.lateral : double ? laneAt[myLane] : (ahead?.lateral ?? Math.min(1.2, half));
      // Circulation à droite : sauf pour doubler, on reste dans la moitié droite (ceux d'en face roulent à gauche).
      let targetLat = THREE.MathUtils.clamp(base + (double ? 0 : out.lateralTargetM) + shelter, right, half);
      // Dépassement en cours mais quelqu'un arrive en face à moins de 60 m : on l'abandonne et on se rabat
      // (sinon le cycliste d'en face roulait à travers le doubleur).
      // Hystérésis : une fois abandonné, le dépassement ne reprend que lorsque plus personne n'arrive à moins de
      // 120 m (sinon, au seuil, le coureur déboîtait et se rabattait d'une image à l'autre et scintillait).
      const held = this.passHeld.has(r);
      const look = oncomingLookM(r.state.speedMs);
      const comingClose = this.facing(r.state.distM, held ? Math.max(120, look * 1.5) : Math.max(60, look));
      if (comingClose && plan.passing) this.passHeld.add(r);
      else if (!comingClose) this.passHeld.delete(r);
      const abortPass = plan.lateralM !== null && plan.passing && this.passHeld.has(r);
      if (plan.lateralM !== null && !abortPass && !onGrid) targetLat = plan.lateralM;
      else if (grid) targetLat = gridBlend(grid.lateralM, targetLat, r.state.distM - grid.distM);
      // Rester sur la chaussée réelle du tronçon (et, en pilote, contourner les façades à venir).
      const bounds = (this.collision ?? sharedRoadCorridor()).steeringBounds(this.track, r.state.distM, r.state.speedMs, 1, this.bounds);
      targetLat = THREE.MathUtils.clamp(targetLat, -bounds.left, bounds.right);
      // Quelqu'un arrive en face : jamais sur sa moitié (lanes.ts), on se rabat sans à-coup.
      if (comingClose) targetLat = clampToOwnHalf(targetLat, 1, -bounds.left, bounds.right);
      // Ressort amorti à vitesse plafonnée : déboîter et se rabattre sans à-coup (lateralSpring.ts).
      let motion = this.latMotion.get(r);
      if (!motion) this.latMotion.set(r, (motion = { v: 0 }));
      const tuning = plan.passing ? LATERAL_PASSING : LATERAL_CRUISE;
      const latBefore = r.lateral;
      r.lateral = LATERAL_SPRING ? stepLateral(motion, r.lateral, targetLat, dt, tuning) : r.lateral + (targetLat - r.lateral) * Math.min(1, dt * (plan.passing ? 1.8 : 0.8));
      r.lateral = THREE.MathUtils.clamp(r.lateral, -bounds.left, bounds.right);
      if (this.collision) r.lateral = this.collision.apply(this.track, beforeD, beforeLateral, r.state, r.lateral, half, dt);
      syncLateral(motion, latBefore, r.lateral, dt, tuning);
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
      if (r.uturn.active || this.parked.has(r)) continue;
      const gap = player.distM - r.state.distM;
      if (gap < 0 || gap >= CAMERA_CLEAR_BACK_M || Math.abs(r.lateral - player.lateral) >= CAMERA_CLEAR_SIDE_M) continue;
      const beforeD = r.state.distM;
      r.state.distM -= Math.min(CAMERA_CLEAR_BACK_M - gap, CAMERA_PUSHBACK_MS * dt);
      r.state.speedMs = Math.min(r.state.speedMs, player.speedMs);
      if (this.collision) r.lateral = this.collision.apply(this.track, beforeD, r.lateral, r.state, r.lateral, roadHalfM(this.track.route.roadWidthM), dt);
    }
  }

  /** Cyclistes d'ambiance qui viennent en face : branché par le jeu (`AmbientCyclists.oncomingAhead`). */
  oncoming: ((distM: number, rangeM: number) => boolean) | null = null;

  /** La voie de gauche est occupée devant `distM` (cycliste d'ambiance ou équipier qui revient à contresens) : pas de dépassement par la gauche. */
  private leftLaneBusy(distM: number): boolean {
    if (this.oncoming?.(distM, 80)) return true;
    return this.riders.some((x) => x.uturn.active && x.state.distM > distM - 8 && x.state.distM < distM + 80);
  }

  /**
   * Un équipier arrive en face de qui roule dans le sens `dir` à `distM` (entre 8 m derrière et `rangeM` devant) :
   * pour le joueur dans le sens de marche, l'équipier qui revient à contresens ; à contresens, le groupe.
   */
  approaching(distM: number, dir: 1 | -1, rangeM: number): boolean {
    return this.riders.some((x) => {
      const back = x.uturn.phase === 'back' || x.uturn.phase === 'brakeBack';
      if (dir > 0 ? !back : x.uturn.active || this.parked.has(x)) return false;
      return facingWithin(aheadAlongM(distM, x.state.distM, dir), rangeM);
    });
  }

  /** Quelqu'un arrive en face entre 8 m derrière et `rangeM` devant `distM` (cycliste, véhicule, équipier qui revient). */
  private facing(distM: number, rangeM: number): boolean {
    if (this.oncoming?.(distM, rangeM)) return true;
    return this.riders.some((x) => (x.uturn.phase === 'back' || x.uturn.phase === 'brakeBack') && facingWithin(x.state.distM - distM, rangeM));
  }

  /** Le groupe roule seul, à l'allure courante (joueur à contresens). */
  private rideOn(dt: number, player: { distM: number; lateral: number; speedMs: number }): number {
    this.time += dt;
    this.stepFlicks(dt);
    const all = this.riders.map((r) => ({ distM: r.state.distM, lateralM: r.lateral, speedMs: r.state.speedMs }));
    const factors = this.draft.compute(all);
    const order = [...this.riders].sort((a, b) => b.state.distM - a.state.distM);
    order.forEach((r, rank) => {
      if (this.parking(r)) {
        this.park(r, dt);
        return;
      }
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
      // Freinage avant les virages serrés, comme le joueur (cornerBrake.ts).
      r.state.speedMs = brakeForCorners(this.track, r.state.distM, Math.cos(r.heading) < 0 ? -1 : 1, r.state.speedMs, CORNER_GRIP, dt);
      // Le joueur arrive en face : l'IA (même en plein dépassement) regagne sa moitié de la chaussée, sans à-coup.
      if (!r.uturn.active && facingWithin(aheadAlongM(r.state.distM, player.distM, 1), oncomingLookM(r.state.speedMs + player.speedMs))) {
        const b = (this.collision ?? sharedRoadCorridor()).steeringBounds(this.track, r.state.distM, r.state.speedMs, 1, this.bounds);
        const target = clampToOwnHalf(r.lateral, 1, -b.left, b.right);
        r.lateral += THREE.MathUtils.clamp(target - r.lateral, -RETURN_LATERAL_MS * dt, RETURN_LATERAL_MS * dt);
      }
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
    this.animFrame++;
    for (const [ri, r] of this.riders.entries()) {
      // Même trajectoire en arc que le joueur (virages fluides).
      const p = this.collision ? this.track.positionAt(r.state.distM, r.lateral, this.sample) : this.track.linePositionAt(r.state.distM, r.lateral, r.state.speedMs, this.sample);
      // Cap relatif (demi-tour) : à contresens, l'inclinaison de la pente s'inverse.
      const heading = this.collision ? (Math.cos(r.heading) < 0 ? Math.PI : 0) : r.heading;
      const yaw = Math.atan2(p.dirX, p.dirZ) + heading;
      // Monde ouvert : roues posées sur la chaussée dessinée (roadHeight.ts), comme le coureur.
      roadPose(p.x, p.z, Math.sin(yaw), Math.cos(yaw), p.y + 0.06, Math.atan(p.grade / 100) * Math.cos(r.heading), BIKE_FRONT_M, BIKE_REAR_M, this.pose);
      r.avatar.root.position.set(p.x, this.pose.y, p.z);
      r.avatar.root.rotation.set(0, 0, 0);
      r.avatar.root.rotateY(yaw);
      r.avatar.root.rotateX(-this.pose.pitch);
      const dist = camera.position.distanceTo(r.avatar.root.position);
      r.avatar.root.visible = dist < 600;
      // Rendu détaillé (groupe V3, ou branche du coureur réaliste / poly) ; masqué = version légère en place.
      const detail = detailGroup(r.avatar, r.v3);
      const light = !r.v3 && !!detail && !detail.visible;
      if (dist < 250) {
        r.avatar.setEffort?.(r.watts / r.ftp);
        // Inclinaison en virage, lissée comme celle du joueur (contresens après un demi-tour : virage inversé).
        const lean = this.track.leanAt(r.state.distM, r.state.speedMs, Math.cos(r.heading) < 0 ? -1 : 1);
        const bank = (this.banks.get(r) ?? 0) + (lean - (this.banks.get(r) ?? 0)) * Math.min(1, dt * 3);
        this.banks.set(r, bank);
        let budget = this.animBudgets.get(r);
        if (!budget) this.animBudgets.set(r, (budget = new AnimBudget(ri)));
        const animDt = budget.step(dt, dist, this.animFrame);
        if (animDt > 0) {
          // Version légère (réaliste, poly) : maillage figé, l'animation du coureur détaillé ne se voit pas.
          if (!light) r.avatar.update(animDt, r.cadence, r.state.speedMs, r.pose, bank);
          // Transitions : pied à terre à l'arrêt (arrivée, demi-tour arrêté), départ au premier coup de pédale.
          // Coup de coude en fin de relais : clip imposé à la place de la posture (voir FLICK_CLIP).
          r.v3?.update(animDt, r.cadence, r.state.speedMs, r.pose, { effort: r.watts / r.ftp, transitions: true, ...this.gesture(r) });
        }
      } else if (r.v3 && r.avatar.root.visible && needsLightBuild(r.avatar.root) && (this.animFrame + ri) % 30 === 0) {
        // Trop loin pour être animé : une mise à jour V3 de temps en temps pour qu'il se charge (sinon l'ancien
        // coureur détaillé, plus de 100 pièces, restait affiché) et qu'on en tire sa version légère.
        r.v3.update(1 / 60, r.cadence, r.state.speedMs, r.pose, { effort: r.watts / r.ftp });
      }
      dists.push(dist);
      r.label.position.set(p.x, p.y + 2.15, p.z);
      // Nom seulement quand le coureur est juste à côté : au-delà, les étiquettes s'empilent et cachent le groupe.
      r.label.visible = dist < 12;
      // Pièces sous ~1,5 px retirées du rendu (smallParts.ts), une image sur 6 par coureur.
      if (SMALL_PARTS_CULL && r.avatar.root.visible && (this.animFrame + ri) % 6 === 0) cullSmallParts(r.avatar.root, camera.position, camera.projectionMatrix.elements[5] ?? 1);
      // Au-delà de 60 m, version légère : un seul maillage figé (riderLight.ts), après la mise à jour V3 en style Bêta.
      if (detail) updateRiderLight(r.avatar.root, detail, dist, this.animFrame, true, undefined, lightColorOf(r.avatar, r.v3), !r.v3 || r.v3.posed);
      // Réaliste au-delà de 20 m : niveau intermédiaire, quelques maillages animés à couleurs de sommets (riderMid.ts).
      const mid = !!detail && !r.v3 && r.avatar instanceof GltfRiderAvatar && r.avatar.root.visible && updateRiderMid(r.avatar.root, detail, dist, this.animFrame, ri, lightColorOf(r.avatar));
      // Pièces de même matériau fusionnées (riderMerge.ts), tous styles : vérification une image sur 10.
      if (!mid && r.avatar.root.visible && (this.animFrame + ri) % 10 === 0) updateRiderMerge(r.avatar.root, this.animFrame);
    }
    // Noms : placés après le rendu de cette image (caméra à jour), d'où la microtâche.
    queueMicrotask(() => placeNameTags(this.riders.map((x) => x.tag), camera));
    // Ombres portées : seulement les coureurs les plus proches (coût des cascades d'ombre).
    const casters = shadowCasters(dists, this.shadowRiders, 40);
    this.riders.forEach((r, i) => {
      r.avatar.setShadows(casters[i] as boolean);
      // Pièces V3 : le budget s'applique aussi (riderShadows.ts), grandes pièces seulement.
      if (r.v3) applyRiderShadows(r.avatar.root, casters[i] as boolean, (r.v3 as unknown as { group: THREE.Object3D }).group);
      // Version légère des autres styles : ombre selon le budget, et seulement si le coureur en projette (poly).
      else for (const c of r.avatar.root.children) if (c.name === 'rider-light') (c as THREE.Mesh).castShadow = c.visible && (casters[i] as boolean) && castsShadow(r.avatar);
    });
  }

  dispose(): void {
    for (const r of this.riders) {
      r.v3?.dispose();
      disposeRiderMid(r.avatar.root);
      disposeRiderMerge(r.avatar.root);
      disposeRiderLight(r.avatar.root);
      disposeRiderShadows(r.avatar.root);
      this.scene.remove(r.avatar.root);
      removeNameTag(r.tag);
    }
  }
}
