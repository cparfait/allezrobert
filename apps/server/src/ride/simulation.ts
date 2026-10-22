/**
 * Simulation autoritaire d'une sortie, indépendante du réseau (testable sans Colyseus).
 *
 * À chaque tick (10 Hz) :
 *  1. transitions de phase (salon → compte à rebours → course → arrivée) ;
 *  2. consignes : puissance mesurée (humains), pilote automatique ou puissance virtuelle
 *     bornée (invités), décisions des IA (`AiRider`, contexte construit ici) ;
 *  3. aspiration (`DraftCalculator`) sur les distances DÉPLIÉES (tour × longueur + distance) ;
 *  4. intégration physique (`stepRider`, Martin 1998) avec la pente et la densité de l'air
 *     sous la roue ; option « groupe soudé » (`StickyGroupRegulator`) ;
 *  5. décalage latéral, tours, segments KOM/sprint, arrivée, posture d'avatar.
 *
 * Sortie de groupe : allure annoncée (les IA la tiennent), meneur (référence de regroupement
 * des IA), regroupement à la demande (élastique doux temporaire), alerte quand le groupe se
 * scinde. Course : salon → compte à rebours → grille → course, primes KOM / sprint (ordre de
 * passage), heure limite après le premier arrivé, abandons (DNF), hors délai, contrôle de
 * puissance (`PowerGuard` : plafonnement, mise hors course si l'infraction dure).
 *
 * Toutes les distances internes (`state.distM`) sont dépliées ; l'instantané diffuse la
 * distance dans le tour + le numéro de tour.
 */
import {
  AI_PROFILES,
  AiRider,
  DraftCalculator,
  PoseController,
  SeededRng,
  StickyGroupRegulator,
  airDensity,
  createRiderState,
  poseCdaFactor,
  surfaceCrr,
  FOOT_DOWN_SPEED_MS,
  effectiveMass,
  paramsFromBike,
  powerForSpeed,
  stepRider,
  type AiContext,
  type AiProfileName,
  type AiSegmentInfo,
  type Environment,
  type RiderPhysicsParams,
  type RiderState,
  type StickyRider,
} from '@allezrobert/physics';
import {
  DEFAULT_BIKE,
  DEFAULT_LOOK,
  MAX_RIDERS_PER_ROOM,
  PRIME_POINTS,
  RouteTrack,
  type AvatarLook,
  type BikeSetup,
  type HostOptions,
  type RaceStatus,
  type RideEventMsg,
  type RidePhase,
  type RideResult,
  type RideRoomOptions,
  type RosterEntry,
  type RouteData,
  type SnapshotRow,
  type TelemetryMsg,
  type TrackSample,
} from '@allezrobert/shared';
import { PowerGuard } from './power-guard.ts';

export type RiderKind = 'human' | 'guest' | 'ai';

export interface SimRiderInit {
  id: string;
  name: string;
  kind: RiderKind;
  userId?: string;
  avatar?: AvatarLook;
  riderMassKg?: number;
  ftpWatts?: number;
  bike?: BikeSetup;
  /** Diffuser la FC aux autres coureurs (consentement du profil). */
  shareHr?: boolean;
  aiProfile?: AiProfileName;
}

export interface ResolvedRideOptions extends RideRoomOptions {
  laps: number;
  aiPaceWkg: number;
  aiLevel: number;
}

export function resolveRideOptions(o: Partial<RideRoomOptions>, routeId: string): ResolvedRideOptions {
  const clamp = (v: number | undefined, lo: number, hi: number, def: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : def;
  const r: ResolvedRideOptions = {
    routeId,
    mode: o.mode ?? 'group',
    stickyGroup: o.stickyGroup ?? false,
    allowGuests: o.allowGuests ?? true,
    draftingStrength: clamp(o.draftingStrength, 0, 1, 1),
    trainerDifficulty: clamp(o.trainerDifficulty, 0, 1, 0.5),
    aiRiders: Math.round(clamp(o.aiRiders, 0, MAX_RIDERS_PER_ROOM - 1, 0)),
    laps: Math.round(clamp(o.laps, 1, 50, 1)),
    aiPaceWkg: clamp(o.aiPaceWkg, 1, 6, 2.6),
    aiLevel: clamp(o.aiLevel, 0.6, 1.3, 1),
  };
  if (typeof o.paceWkg === 'number' && Number.isFinite(o.paceWkg)) r.paceWkg = clamp(o.paceWkg, 1, 6, 2.5);
  if (o.name) r.name = o.name.slice(0, 60);
  if (o.weather) r.weather = { ...o.weather };
  if (typeof o.startAt === 'number' && Number.isFinite(o.startAt)) r.startAt = o.startAt;
  return r;
}

/** Longueur de vélo (m) : même convention que le calcul d'aspiration. */
const BIKE_LENGTH_M = 1.75;
/** Télémétrie plus vieille que ça : le coureur passe en roue libre. */
const TELEMETRY_STALE_MS = 2000;
/** Écart maximal entre deux coureurs d'un même groupe (m). */
const GROUP_GAP_M = 12;
const LATERAL_SPEED_MS = 1.5;
const FINISH_TIMEOUT_MS = 10 * 60_000;
/** Hors course, une IA à plus de REGROUP_M des humains les attend ou les rejoint. */
const REGROUP_M = 40;
/** Regroupement : terminé quand l'écart tête – queue reste sous REGROUPED_M pendant 3 s. */
const REGROUPED_M = 20;
const REGROUP_MAX_MS = 180_000;
/** Sortie de groupe : alerte « groupe scindé » au-delà de SPLIT_M entre humains (réarmée sous SPLIT_REARM_M). */
const SPLIT_M = 150;
const SPLIT_REARM_M = 60;
/** Course : temps cumulé (s) de puissance invraisemblable avant la mise hors course. */
const DQ_VIOLATION_S = 10;

export class SimRider {
  readonly id: string;
  readonly n: number;
  readonly kind: RiderKind;
  readonly userId: string | undefined;
  name: string;
  avatar: AvatarLook;
  readonly riderMassKg: number;
  readonly ftpWatts: number;
  readonly params: RiderPhysicsParams;
  readonly state: RiderState;
  readonly pose = new PoseController();
  /** Pneus du vélo (résistance au roulement hors enrobé). */
  readonly tyre: 'road' | 'gravel' | 'mtb';
  readonly ai: AiRider | undefined;
  shareHr: boolean;
  lateralM = 0;
  lateralTarget = 0;
  watts = 0;
  cadence = 0;
  hr: number | undefined;
  gear = 0;
  /** Réduction de CdA due à l'aspiration (0–~0,58). */
  draft = 0;
  grade = 0;
  connected = true;
  lastTelemetryMs = -Infinity;
  lastSeq = -1;
  guestThrottle: number | undefined;
  /** Accélération appliquée par le groupe soudé (m/s²), pour l'affichage « assisté ». */
  assist = 0;
  finishMs: number | undefined;
  rank = 0;
  /** Arrivé après le départ d'une course : non classé. */
  lateJoin = false;
  /** Contrôle de puissance (humains avec matériel). */
  readonly guard: PowerGuard | undefined;
  /** Dernière puissance reçue, avant contrôle. */
  rawWatts = 0;
  /** Mis hors course (puissance invraisemblable trop longtemps). */
  dq = false;
  /** Avertissement de puissance déjà envoyé. */
  warned = false;
  /** Points des primes KOM / sprint (course). */
  komPts = 0;
  sprintPts = 0;
  lap = 0;
  /** Distance dépliée au début du pas (détection des franchissements). */
  prevDist = 0;
  readonly row: SnapshotRow;
  readonly activeSegments = new Map<string, { startMs: number; endDist: number }>();
  readonly joinedAt: number;

  constructor(init: SimRiderInit, n: number, now: number, rng: SeededRng) {
    this.id = init.id;
    this.n = n;
    this.kind = init.kind;
    this.userId = init.userId;
    this.name = init.name;
    this.avatar = init.avatar ?? DEFAULT_LOOK;
    this.riderMassKg = init.riderMassKg ?? 75;
    this.ftpWatts = init.ftpWatts ?? 200;
    this.params = paramsFromBike(this.riderMassKg, init.bike ?? DEFAULT_BIKE);
    this.tyre = init.bike?.tyre ?? 'road';
    this.state = createRiderState();
    this.shareHr = init.shareHr ?? false;
    this.joinedAt = now;
    this.guard = init.kind === 'human' ? new PowerGuard(this.riderMassKg) : undefined;
    if (init.kind === 'ai') {
      this.ai = new AiRider({
        id: init.id,
        profile: init.aiProfile ?? 'rouleur',
        ftpWatts: this.ftpWatts,
        params: this.params,
        riderMassKg: this.riderMassKg,
        seed: rng.int(2 ** 31),
      });
    }
    this.row = { n, distM: 0, lateralM: 0, speedMs: 0, watts: 0, cadence: 0, draftPct: 0, lap: 0, pose: 'seated' };
  }

  get eligible(): boolean {
    return this.kind !== 'guest' && !this.lateJoin && !this.dq;
  }
}

export interface SegmentEffortOut {
  riderId: string;
  userId: string;
  segmentId: string;
  elapsedMs: number;
}

export interface TickResult {
  events: RideEventMsg[];
  efforts: SegmentEffortOut[];
}

const AI_NAMES = ['Bernard', 'Gilberte', 'Jacky', 'Mireille', 'Raymond', 'Josiane', 'Lucien', 'Paulette', 'Marcel', 'Simone', 'Roger', 'Odette', 'Fernand', 'Huguette', 'Gaston', 'Yvette', 'Maurice', 'Colette', 'René', 'Ginette'];
const AI_PROFILE_CYCLE: AiProfileName[] = ['rouleur', 'puncheur', 'diesel', 'sprinter'];
const JERSEYS = ['#e63946', '#2a9d8f', '#e9c46a', '#264653', '#f4a261', '#8d99ae', '#6a4c93', '#1982c4', '#8ac926', '#ff595e'];

export class RideSimulation {
  readonly track: RouteTrack;
  readonly route: RouteData;
  readonly options: ResolvedRideOptions;
  readonly guestMaxWkg: number;
  readonly riders: SimRider[] = [];
  private readonly byId = new Map<string, SimRider>();
  phase: RidePhase;
  startsAt: number | undefined;
  startedAt: number | undefined;
  tick = 0;
  private nextN = 0;
  private readonly rng: SeededRng;
  private readonly draft: DraftCalculator;
  private readonly sticky = new StickyGroupRegulator();
  private readonly sample: TrackSample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  private readonly env: Environment = { airDensity: 1.2, windSpeedMs: 0 };
  private readonly draftView: Array<{ distM: number; lateralM: number; speedMs: number }> = [];
  private readonly stickyView: Array<StickyRider & { r: SimRider }> = [];
  private order: SimRider[] = [];
  private groupPaceWkg: number;
  /** Meilleurs temps de la sortie par segment : riderId → ms. */
  private readonly segmentBests = new Map<string, Map<string, number>>();
  /** Records personnels connus (base) : userId → segmentId → ms. */
  private readonly personalBests = new Map<string, Map<string, number>>();
  private finishedCount = 0;
  private firstFinishAt: number | undefined;
  private aiCount = 0;
  /** Événements produits hors du pas (abandons) : diffusés au pas suivant. */
  private readonly pendingEvents: RideEventMsg[] = [];
  /** Primes : passages classés par segment et par tour (`segId:tour`). */
  private readonly primeCounts = new Map<string, number>();
  /** Abandons de la course (coureurs partis), gardés pour le classement. */
  private readonly dnfs: RideResult[] = [];
  /** Course : heure limite d'arrivée (epoch ms). */
  deadline: number | undefined;
  /** Sortie de groupe : meneur ('' = aucun, l'appelant passe l'hôte). */
  leaderId = '';
  /** Regroupement en cours jusqu'à cette heure (epoch ms). */
  private regroupUntil: number | undefined;
  private regroupOkS = 0;
  private splitArmed = true;
  /** Élastique doux du regroupement : pas de borne dure (aucune téléportation). */
  private readonly regroupReg = new StickyGroupRegulator({ deadbandM: 10, maxGapM: 1e6, stiffness: 0.012, damping: 0.5, maxAccelMs2: 0.45 });

  constructor(route: RouteData, options: ResolvedRideOptions, now: number, opts: { guestMaxWkg?: number; seed?: number | string } = {}) {
    this.route = route;
    this.track = new RouteTrack(route);
    this.options = options;
    this.guestMaxWkg = opts.guestMaxWkg ?? 3.5;
    this.rng = new SeededRng(opts.seed ?? `${route.id}:${now}`);
    this.draft = new DraftCalculator({ strength: options.draftingStrength });
    this.groupPaceWkg = options.aiPaceWkg;
    if (options.startAt !== undefined && options.startAt > now) {
      this.phase = 'countdown';
      this.startsAt = options.startAt;
    } else if (options.mode === 'race') {
      this.phase = 'lobby';
    } else {
      this.phase = 'running';
      this.startedAt = now;
    }
  }

  get length(): number {
    return this.track.length;
  }

  /** Allure de référence des IA (W/kg) : annoncée, sinon celle des humains, lissée. */
  get groupPace(): number {
    return this.groupPaceWkg;
  }

  get holding(): boolean {
    return this.phase === 'lobby' || this.phase === 'countdown';
  }

  get(id: string): SimRider | undefined {
    return this.byId.get(id);
  }

  get humanCount(): number {
    let n = 0;
    for (const r of this.riders) if (r.kind !== 'ai') n++;
    return n;
  }

  get isFull(): boolean {
    return this.riders.length >= MAX_RIDERS_PER_ROOM;
  }

  /** Ajoute un coureur ; renvoie `null` si la salle est pleine. */
  addRider(init: SimRiderInit, now: number): SimRider | null {
    if (this.byId.has(init.id)) return this.byId.get(init.id)!;
    if (this.isFull) return null;
    const r = new SimRider(init, this.nextN++, now, this.rng);
    this.placeOnJoin(r);
    if (this.options.mode === 'race' && (this.phase === 'running' || this.phase === 'finished')) r.lateJoin = true;
    this.riders.push(r);
    this.byId.set(r.id, r);
    this.writeRow(r);
    return r;
  }

  /** Coureurs IA demandés par les options (appelé à la création de la salle). */
  addAiRiders(count: number, now: number, refFtp = 240): SimRider[] {
    const out: SimRider[] = [];
    for (let i = 0; i < count && !this.isFull; i++) {
      const k = this.aiCount++;
      const massKg = Math.round(this.rng.range(60, 82));
      const look: AvatarLook = {
        ...DEFAULT_LOOK,
        jersey: JERSEYS[k % JERSEYS.length]!,
        jerseyAccent: JERSEYS[(k + 3) % JERSEYS.length]!,
        skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'][k % 5]!,
        hairStyle: k % 4,
        build: Math.round(this.rng.range(0.2, 0.7) * 100) / 100,
      };
      const r = this.addRider(
        {
          id: `ai-${k + 1}`,
          name: `${AI_NAMES[k % AI_NAMES.length]} (IA)`,
          kind: 'ai',
          avatar: look,
          riderMassKg: massKg,
          ftpWatts: Math.round(refFtp * this.rng.range(0.85, 1.1) * (massKg / 72)),
          aiProfile: AI_PROFILE_CYCLE[k % AI_PROFILE_CYCLE.length]!,
        },
        now,
      );
      if (r) {
        // Sortie de groupe : attaques rares ; course : profil complet.
        if (r.ai && this.options.mode !== 'race') r.ai.aggressiveness = 0.3;
        out.push(r);
      }
    }
    return out;
  }

  removeRider(id: string): boolean {
    const r = this.byId.get(id);
    if (!r) return false;
    // Course en cours : un humain classable qui s'en va abandonne (DNF au classement).
    if (this.options.mode === 'race' && this.phase === 'running' && r.kind !== 'ai' && r.eligible && r.finishMs === undefined) {
      this.dnfs.push({ ...this.resultOf(r), rank: 0, timeMs: 0, status: 'dnf' });
      this.pendingEvents.push({ kind: 'abandon', riderId: r.id, name: r.name });
    }
    this.byId.delete(id);
    this.riders.splice(this.riders.indexOf(r), 1);
    return true;
  }

  /**
   * Course au salon : une IA cède sa place quand un humain arrive, pour garder la taille du
   * peloton demandée à la création (1 + `aiRiders`). Renvoie l'IA retirée.
   */
  yieldAiSlot(): SimRider | null {
    if (this.options.mode !== 'race' || !this.holding) return null;
    if (this.riders.length <= 1 + this.options.aiRiders) return null;
    const ai = [...this.riders].reverse().find((r) => r.kind === 'ai');
    if (!ai) return null;
    this.removeRider(ai.id);
    return ai;
  }

  setConnected(id: string, connected: boolean): void {
    const r = this.byId.get(id);
    if (r) r.connected = connected;
  }

  setPersonalBests(userId: string, bests: Iterable<[string, number]>): void {
    const m = this.personalBests.get(userId) ?? new Map<string, number>();
    for (const [seg, ms] of bests) {
      const cur = m.get(seg);
      if (cur === undefined || ms < cur) m.set(seg, ms);
    }
    this.personalBests.set(userId, m);
  }

  updateHostOptions(patch: Partial<HostOptions>): HostOptions {
    if (typeof patch.allowGuests === 'boolean') this.options.allowGuests = patch.allowGuests;
    if (patch.paceWkg === null) delete this.options.paceWkg;
    else if (typeof patch.paceWkg === 'number' && Number.isFinite(patch.paceWkg)) this.options.paceWkg = Math.round(Math.min(Math.max(patch.paceWkg, 1), 6) * 10) / 10;
    if (typeof patch.leaderId === 'string' && (patch.leaderId === '' || this.byId.get(patch.leaderId)?.kind === 'human')) this.leaderId = patch.leaderId;
    if (typeof patch.stickyGroup === 'boolean') this.options.stickyGroup = patch.stickyGroup;
    if (typeof patch.draftingStrength === 'number' && Number.isFinite(patch.draftingStrength)) {
      this.options.draftingStrength = Math.min(Math.max(patch.draftingStrength, 0), 1);
      this.draft.setStrength(this.options.draftingStrength);
    }
    return this.hostOptions();
  }

  hostOptions(): HostOptions {
    return {
      allowGuests: this.options.allowGuests,
      stickyGroup: this.options.stickyGroup,
      draftingStrength: this.options.draftingStrength,
      paceWkg: this.options.paceWkg ?? null,
      leaderId: this.leaderId,
    };
  }

  get regrouping(): boolean {
    return this.regroupUntil !== undefined;
  }

  /** Sortie de groupe : lance (ou arrête) un regroupement ; renvoie l'événement à diffuser. */
  setRegroup(active: boolean, now: number): RideEventMsg | null {
    if (this.options.mode === 'race' || this.holding) return null;
    if (active === this.regrouping) return null;
    this.regroupUntil = active ? now + REGROUP_MAX_MS : undefined;
    this.regroupOkS = 0;
    return { kind: 'regroup', active, spreadM: Math.round(this.spread()) };
  }

  /** Écart tête – queue (m) des coureurs encore en route. */
  private spread(filter: (r: SimRider) => boolean = () => true): number {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of this.riders) {
      if (r.finishMs !== undefined || !filter(r)) continue;
      lo = Math.min(lo, r.state.distM);
      hi = Math.max(hi, r.state.distM);
    }
    return hi > lo ? hi - lo : 0;
  }

  /** Télémétrie d'un humain ou d'un invité (valeurs déjà bornées par le schéma). */
  setTelemetry(id: string, msg: TelemetryMsg, now: number): void {
    const r = this.byId.get(id);
    if (!r || r.kind === 'ai') return;
    // Paquets en retard ignorés (le compteur repart de 0 après une reconnexion du jeu).
    if (msg.seq <= r.lastSeq && r.lastSeq - msg.seq < 1000) return;
    r.lastSeq = msg.seq;
    r.lastTelemetryMs = now;
    r.gear = msg.gear;
    const halfRoad = this.halfRoad();
    r.lateralTarget = Math.min(Math.max(msg.steer, -halfRoad), halfRoad);
    if (r.kind === 'guest') {
      // Invité : aucune puissance mesurée acceptée, uniquement l'accélérateur virtuel.
      r.guestThrottle = msg.guestThrottle === undefined ? undefined : Math.min(Math.max(msg.guestThrottle, 0), 1);
      r.cadence = msg.cadence;
    } else {
      // Puissance retenue après contrôle (PowerGuard) au prochain pas.
      r.rawWatts = msg.watts;
      r.cadence = msg.cadence;
    }
    r.hr = msg.hr !== undefined && msg.hr > 0 ? msg.hr : undefined;
  }

  /** Lance (ou relance) le compte à rebours ; les coureurs sont replacés sur la ligne. */
  startCountdown(now: number, seconds = 10): RideEventMsg | null {
    if (this.phase === 'countdown' || this.phase === 'finished') return null;
    if (this.phase === 'running' && this.finishedCount > 0) return null;
    this.phase = 'countdown';
    this.startsAt = now + Math.round(Math.min(Math.max(seconds, 3), 120) * 1000);
    this.placeOnGrid();
    return { kind: 'countdown', startsAt: this.startsAt };
  }

  private halfRoad(): number {
    return Math.max(1, (this.route.roadWidthM || 6) / 2 - 0.4);
  }

  /** Grille de départ : rangées de 6 coureurs, 2,2 m entre rangées, en arrière de la ligne. */
  private placeOnGrid(): void {
    const perRow = 6;
    const span = Math.min(this.halfRoad() * 2, 5);
    const humansFirst = [...this.riders].sort((a, b) => Number(a.kind === 'ai') - Number(b.kind === 'ai') || a.n - b.n);
    humansFirst.forEach((r, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      r.state.distM = -row * 2.2;
      r.state.speedMs = 0;
      r.lateralM = r.lateralTarget = -span / 2 + (span * (col + 0.5)) / perRow;
      r.activeSegments.clear();
      r.lap = this.lapOf(r.state.distM);
      r.finishMs = undefined;
      r.rank = 0;
      r.lateJoin = false;
      r.komPts = r.sprintPts = 0;
    });
    this.finishedCount = 0;
    this.firstFinishAt = undefined;
    this.deadline = undefined;
    this.segmentBests.clear();
    this.primeCounts.clear();
    this.dnfs.length = 0;
  }

  /** Arrivée en cours de sortie : à l'arrière du groupe principal (ou sur la ligne). */
  private placeOnJoin(r: SimRider): void {
    if (this.holding || this.riders.length === 0) {
      const i = this.riders.length;
      const perRow = 6;
      const span = Math.min(this.halfRoad() * 2, 5);
      r.state.distM = -Math.floor(i / perRow) * 2.2;
      r.lateralM = r.lateralTarget = -span / 2 + (span * ((i % perRow) + 0.5)) / perRow;
    } else {
      const dists = this.riders.map((x) => x.state.distM).sort((a, b) => a - b);
      const median = dists[Math.floor(dists.length / 2)]!;
      r.state.distM = median - 6;
      r.state.speedMs = this.riders.reduce((s, x) => s + x.state.speedMs, 0) / this.riders.length;
      r.lateralM = r.lateralTarget = Math.min(1.2, this.halfRoad());
    }
    r.lap = this.lapOf(r.state.distM);
  }

  private lapOf(dist: number): number {
    return this.route.loop ? Math.floor(dist / this.track.length) : 0;
  }

  private raceTarget(): number {
    return this.route.loop ? this.options.laps * this.track.length : this.track.length;
  }

  /** Avance la simulation d'un pas `dt` (s) ; `now` = heure serveur (epoch ms) en fin de pas. */
  step(now: number, dt = 0.1): TickResult {
    const events: RideEventMsg[] = this.pendingEvents.splice(0);
    const efforts: SegmentEffortOut[] = [];
    const tStart = now - dt * 1000;

    if (this.phase === 'countdown' && this.startsAt !== undefined && now >= this.startsAt) {
      this.phase = 'running';
      this.startedAt = this.startsAt;
      events.push({ kind: 'phase', phase: 'running', startsAt: this.startsAt });
    }
    const holding = this.holding;
    const riders = this.riders;
    const n = riders.length;

    // Ordre de course (tête en premier), sur les positions du pas précédent.
    this.order = riders.slice().sort((a, b) => b.state.distM - a.state.distM);
    this.updateGroupPace(dt, now);

    // Centre du groupe (hors invités) pour le pilote automatique.
    let centerDist = 0;
    let centerSpeed = 0;
    let nonGuest = 0;
    {
      const ds: number[] = [];
      for (const r of riders) {
        if (r.kind === 'guest') continue;
        ds.push(r.state.distM);
        centerSpeed += r.state.speedMs;
        nonGuest++;
      }
      if (nonGuest > 0) {
        ds.sort((a, b) => a - b);
        centerDist = ds[Math.floor(ds.length / 2)]!;
        centerSpeed /= nonGuest;
      }
    }

    // Centre des humains (avec ou sans matériel) : référence de regroupement des IA.
    let humanCenter: number | undefined;
    {
      const hs = riders.filter((r) => r.kind !== 'ai').map((r) => r.state.distM).sort((a, b) => a - b);
      if (hs.length) humanCenter = hs[Math.floor(hs.length / 2)]!;
      // Sortie de groupe avec meneur : les IA se calent sur lui.
      const leader = this.leaderId ? this.byId.get(this.leaderId) : undefined;
      if (leader && leader.finishMs === undefined) humanCenter = leader.state.distM;
    }

    // 1. Consignes.
    for (const r of riders) {
      if (r.kind === 'human') {
        if (!r.connected || now - r.lastTelemetryMs > TELEMETRY_STALE_MS) {
          r.watts *= 0.5;
          if (r.watts < 1) r.watts = 0;
          r.cadence = r.watts > 0 ? r.cadence : 0;
        } else if (r.guard) {
          const g = r.guard.filter(r.rawWatts, dt);
          r.watts = g.watts;
          if (g.windowS !== undefined && !r.warned) {
            r.warned = true;
            events.push({ kind: 'flag', riderId: r.id, action: 'warn', reason: `puissance plafonnée (moyenne sur ${g.windowS} s invraisemblable)` });
          }
          if (this.options.mode === 'race' && this.phase === 'running' && !r.dq && r.finishMs === undefined && r.guard.violationS > DQ_VIOLATION_S) {
            r.dq = true;
            r.rank = 0;
            events.push({ kind: 'flag', riderId: r.id, action: 'dq', reason: 'puissance invraisemblable trop longtemps' });
          }
        } else r.watts = r.rawWatts;
      } else if (r.kind === 'guest') {
        if (r.guestThrottle !== undefined && now - r.lastTelemetryMs <= 1000) {
          r.watts = r.guestThrottle * this.guestMaxWkg * r.riderMassKg;
          r.cadence = r.watts > 0 ? 88 : 0;
        }
      } else if (r.ai) {
        const ctx = this.aiContext(r);
        const out = r.ai.update(ctx, dt);
        r.watts = out.watts;
        r.cadence = out.cadence;
        r.lateralTarget = this.aiLateral(r, out.lateralTargetM);
        // Sortie de groupe (hors course) : les IA attendent ou rejoignent les humains.
        if (this.options.mode !== 'race' && humanCenter !== undefined) {
          const e = r.state.distM - humanCenter;
          if (e > REGROUP_M) r.watts *= 0.55;
          else if (e < -REGROUP_M) r.watts = Math.max(r.watts, r.ftpWatts * 1.05);
        }
      }
    }

    // 2. Aspiration (distances dépliées).
    if (this.draftView.length < n) for (let i = this.draftView.length; i < n; i++) this.draftView.push({ distM: 0, lateralM: 0, speedMs: 0 });
    for (let i = 0; i < n; i++) {
      const r = riders[i]!;
      const v = this.draftView[i]!;
      v.distM = r.state.distM;
      v.lateralM = r.lateralM;
      v.speedMs = holding ? 0 : r.state.speedMs;
    }
    this.draftView.length = n;
    const reductions = this.draft.compute(this.draftView);

    // 3. Physique.
    for (let i = 0; i < n; i++) {
      const r = riders[i]!;
      r.draft = holding ? 0 : reductions[i]!;
      r.prevDist = r.state.distM;
      const s = this.track.sample(this.track.wrap(r.state.distM), this.sample);
      r.grade = s.grade;
      this.env.airDensity = airDensity(s.y);
      if (holding) {
        r.state.speedMs = 0;
        r.state.accelMs2 = 0;
        continue;
      }
      if (!this.route.loop && r.state.distM >= this.track.length) {
        r.state.speedMs = 0;
        r.state.distM = this.track.length;
        continue;
      }
      const autopilot = r.kind === 'guest' && !(r.guestThrottle !== undefined && now - r.lastTelemetryMs <= 1000);
      if (autopilot && nonGuest > 0) {
        this.guestAutopilot(r, centerDist, centerSpeed, dt);
      } else {
        if (autopilot) {
          r.watts = 2.2 * r.riderMassKg;
          r.cadence = 85;
        }
        // Mêmes conditions que la prédiction locale du client : revêtement, posture, pied à terre.
        stepRider(
          r.state,
          {
            watts: r.watts,
            gradePercent: r.grade,
            params: r.params,
            env: this.env,
            cdaFactor: (1 - r.draft) * poseCdaFactor(r.pose.pose, r.grade, r.state.speedMs),
            crr: surfaceCrr(this.track.surfaceAt(r.state.distM), r.params.crr, r.tyre),
            footDownBelowMs: r.kind === 'ai' ? 0 : FOOT_DOWN_SPEED_MS,
          },
          dt,
        );
      }
    }

    // 4. Groupe soudé.
    if (this.options.stickyGroup && !holding && n > 1) {
      const view = this.stickyView;
      view.length = 0;
      for (const r of riders) view.push({ distM: r.state.distM, speedMs: r.state.speedMs, inGroup: r.finishMs === undefined, r });
      this.sticky.apply(view, dt);
      const assist = this.sticky.assist(view.length);
      view.forEach((v, i) => {
        v.r.state.distM = v.distM;
        v.r.state.speedMs = v.speedMs;
        v.r.assist = assist[i]!;
      });
    } else if (this.regroupUntil !== undefined && !holding && n > 1) {
      // Regroupement demandé : élastique doux (la tête est retenue, la queue aidée).
      const view = this.stickyView;
      view.length = 0;
      for (const r of riders) view.push({ distM: r.state.distM, speedMs: r.state.speedMs, inGroup: r.finishMs === undefined, r });
      this.regroupReg.apply(view, dt);
      const assist = this.regroupReg.assist(view.length);
      view.forEach((v, i) => {
        v.r.state.distM = v.distM;
        v.r.state.speedMs = v.speedMs;
        v.r.assist = assist[i]!;
      });
    } else {
      for (const r of riders) r.assist = 0;
    }
    if (this.regroupUntil !== undefined) {
      const spread = this.spread();
      this.regroupOkS = spread <= REGROUPED_M ? this.regroupOkS + dt : 0;
      if (this.regroupOkS >= 3 || now >= this.regroupUntil || n < 2) {
        this.regroupUntil = undefined;
        events.push({ kind: 'regroup', active: false, spreadM: Math.round(spread) });
      }
    } else if (this.options.mode === 'group' && !this.options.stickyGroup && !holding) {
      // Groupe scindé entre humains : alerte (une fois, réarmée quand l'écart se résorbe).
      const humans = (r: SimRider) => r.kind === 'human' && r.connected;
      if (riders.filter(humans).length >= 2) {
        const gap = this.spread(humans);
        if (this.splitArmed && gap > SPLIT_M) {
          this.splitArmed = false;
          events.push({ kind: 'split', gapM: Math.round(gap) });
        } else if (gap < SPLIT_REARM_M) this.splitArmed = true;
      }
    }

    // 5. Latéral, tours, segments, arrivée, posture.
    const target = this.raceTarget();
    for (const r of riders) {
      const dl = r.lateralTarget - r.lateralM;
      const maxStep = LATERAL_SPEED_MS * dt;
      r.lateralM += Math.abs(dl) <= maxStep ? dl : Math.sign(dl) * maxStep;

      const cur = r.state.distM;
      const prev = r.prevDist;
      if (!holding) {
        const lap = this.lapOf(cur);
        if (lap > r.lap && lap >= 1) events.push({ kind: 'lap', riderId: r.id, lap });
        r.lap = lap;
        if (r.kind !== 'guest' && cur > prev) this.trackSegments(r, prev, cur, tStart, dt, events, efforts);
        if (this.phase === 'running' && this.options.mode === 'race' && r.finishMs === undefined && prev < target && cur >= target && this.startedAt !== undefined) {
          const tCross = tStart + ((target - prev) / Math.max(cur - prev, 1e-6)) * dt * 1000;
          r.finishMs = Math.round(tCross - this.startedAt);
          if (r.eligible) {
            this.finishedCount++;
            r.rank = this.finishedCount;
            if (this.firstFinishAt === undefined) {
              this.firstFinishAt = now;
              this.deadline = now + FINISH_TIMEOUT_MS;
              events.push({ kind: 'deadline', at: this.deadline });
            }
          }
          events.push({ kind: 'finish', riderId: r.id, rank: r.rank, timeMs: r.finishMs });
        }
      }
      const pose = r.pose.update({ watts: r.watts, cadence: r.cadence, gradePercent: r.grade, ftpWatts: r.ftpWatts, speedMs: r.state.speedMs }, dt);
      this.writeRow(r, pose);
    }

    // Fin de course : tous les humains classables arrivés, ou délai après le premier.
    if (this.phase === 'running' && this.options.mode === 'race' && this.firstFinishAt !== undefined) {
      const pending = riders.some((r) => r.kind === 'human' && r.eligible && r.connected && r.finishMs === undefined);
      if (!pending || now - this.firstFinishAt > FINISH_TIMEOUT_MS) {
        this.phase = 'finished';
        events.push({ kind: 'phase', phase: 'finished' });
        events.push({ kind: 'results', results: this.results() });
      }
    }

    this.tick++;
    return { events, efforts };
  }

  /** Invité « accroché » : suit la queue du groupe à la vitesse du groupe (aucune physique libre). */
  private guestAutopilot(r: SimRider, centerDist: number, centerSpeed: number, dt: number): void {
    const targetDist = centerDist - 3;
    const err = targetDist - r.state.distM;
    const vTarget = Math.min(Math.max(centerSpeed + 0.35 * err, 0), centerSpeed + 4);
    const v0 = r.state.speedMs;
    const maxDv = 1.5 * dt;
    const v = v0 + Math.min(Math.max(vTarget - v0, -maxDv), maxDv);
    const accel = (v - v0) / dt;
    // Puissance virtuelle affichée : ce qu'il faudrait pour rouler ainsi (bornée à 6 W/kg).
    const p = powerForSpeed(v, r.grade, r.params, this.env, 1 - r.draft) + effectiveMass(r.params) * accel * v;
    r.watts = Math.min(Math.max(p, 0), 6 * r.riderMassKg);
    r.cadence = v > 0.5 ? (r.watts > 20 ? 88 : 0) : 0;
    r.state.accelMs2 = accel;
    r.state.speedMs = v;
    r.state.distM += v * dt;
    r.state.timeS += dt;
  }

  private updateGroupPace(dt: number, now: number): void {
    let sum = 0;
    let k = 0;
    for (const r of this.riders) {
      if (r.kind !== 'human' || !r.connected || now - r.lastTelemetryMs > TELEMETRY_STALE_MS || r.watts <= 0) continue;
      sum += r.watts / r.riderMassKg;
      k++;
    }
    // Allure annoncée (sortie de groupe) : les IA la tiennent, quoi que fassent les humains.
    const announced = this.options.paceWkg;
    const target = announced ?? (k > 0 ? sum / k : this.options.aiPaceWkg);
    const a = 1 - Math.exp(-dt / (announced !== undefined ? 5 : 15));
    this.groupPaceWkg += (Math.min(Math.max(target, 1.2), 5.5) - this.groupPaceWkg) * a;
  }

  private aiContext(r: SimRider): AiContext {
    const order = this.order;
    const p = order.indexOf(r);
    const me = r.state;
    // Groupe : coureurs contigus à moins de GROUP_GAP_M.
    let a = p;
    while (a > 0 && order[a - 1]!.state.distM - order[a]!.state.distM <= GROUP_GAP_M) a--;
    let b = p;
    while (b < order.length - 1 && order[b]!.state.distM - order[b + 1]!.state.distM <= GROUP_GAP_M) b++;
    let groupSpeed = 0;
    for (let i = a; i <= b; i++) groupSpeed += order[i]!.state.speedMs;
    groupSpeed /= b - a + 1;

    const ahead = p > 0 ? order[p - 1] : undefined;
    const gapAhead = ahead && ahead.state.distM - me.distM < 200 ? ahead.state.distM - me.distM - BIKE_LENGTH_M : Infinity;
    const ctx: AiContext = {
      gradePercent: r.grade,
      speedMs: me.speedMs,
      groupPaceWkg: this.groupPaceWkg,
      gapAheadM: gapAhead,
      speedAheadMs: ahead ? ahead.state.speedMs : me.speedMs,
      lateralAheadM: ahead ? ahead.lateralM - r.lateralM : 0,
      positionInGroup: p - a,
      groupSize: b - a + 1,
      cdaFactor: 1 - r.draft,
      env: this.env,
    };
    const seg = this.segmentInfo(me.distM);
    if (seg) ctx.segment = seg;
    // Attaque : un coureur devant (≤ 80 m) nettement plus rapide que le groupe.
    let best: SimRider | undefined;
    for (let i = p - 1; i >= 0; i--) {
      const o = order[i]!;
      const gap = o.state.distM - me.distM;
      if (gap > 80) break;
      if (gap > 4 && o.state.speedMs > groupSpeed + 1.0 && (!best || o.state.speedMs > best.state.speedMs)) best = o;
    }
    if (best) ctx.attack = { riderId: best.id, gapM: best.state.distM - me.distM - BIKE_LENGTH_M, speedMs: best.state.speedMs };
    return ctx;
  }

  /** Latéral d'une IA : dans la roue du coureur devant, décalée selon sa consigne. */
  private aiLateral(r: SimRider, offset: number): number {
    const p = this.order.indexOf(r);
    const ahead = p > 0 ? this.order[p - 1] : undefined;
    const base = ahead && ahead.state.distM - r.state.distM < 10 ? ahead.lateralM : Math.min(1, this.halfRoad());
    const half = this.halfRoad();
    return Math.min(Math.max(base + offset, -half), half);
  }

  private segmentInfo(dist: number): AiSegmentInfo | undefined {
    const L = this.track.length;
    const d = this.track.wrap(dist);
    let best: AiSegmentInfo | undefined;
    for (const s of this.route.segments) {
      const len = s.endM > s.startM ? s.endM - s.startM : s.endM + L - s.startM;
      let toStart = s.startM - d;
      if (this.route.loop && toStart < -len) toStart += L;
      const toEnd = toStart + len;
      if (toEnd <= 0 || toStart > 2000) continue;
      if (!best || toStart < best.distToStartM) best = { kind: s.kind, distToStartM: toStart, distToEndM: toEnd };
    }
    return best;
  }

  private trackSegments(r: SimRider, prev: number, cur: number, tStart: number, dt: number, events: RideEventMsg[], efforts: SegmentEffortOut[]): void {
    const L = this.track.length;
    const dtMs = dt * 1000;
    const at = (x: number): number => tStart + ((x - prev) / Math.max(cur - prev, 1e-6)) * dtMs;
    // Fins d'efforts en cours.
    for (const [segId, eff] of r.activeSegments) {
      if (cur < eff.endDist) continue;
      r.activeSegments.delete(segId);
      const elapsed = Math.round(at(eff.endDist) - eff.startMs);
      const bests = this.segmentBests.get(segId) ?? new Map<string, number>();
      this.segmentBests.set(segId, bests);
      const prevBest = bests.get(r.id);
      if (prevBest === undefined || elapsed < prevBest) bests.set(r.id, elapsed);
      const mine = bests.get(r.id)!;
      let rank = 1;
      for (const [id, ms] of bests) if (id !== r.id && ms < mine) rank++;
      let pr = false;
      if (r.userId) {
        const pbs = this.personalBests.get(r.userId) ?? new Map<string, number>();
        this.personalBests.set(r.userId, pbs);
        const pb = pbs.get(segId);
        pr = pb === undefined || elapsed < pb;
        if (pr) pbs.set(segId, elapsed);
      }
      events.push({ kind: 'segmentEnd', riderId: r.id, segmentId: segId, timeMs: elapsed, rank, pr });
      this.awardPrime(r, segId, eff.endDist, events);
      if (r.kind === 'human' && r.userId && !r.lateJoin) efforts.push({ riderId: r.id, userId: r.userId, segmentId: segId, elapsedMs: elapsed });
    }
    // Départs de segments.
    for (const s of this.route.segments) {
      if (r.activeSegments.has(s.id)) continue;
      const len = s.endM > s.startM ? s.endM - s.startM : s.endM + L - s.startM;
      const k = this.route.loop ? Math.floor((cur - s.startM) / L) : 0;
      const start = s.startM + k * L;
      if (start > prev && start <= cur) {
        r.activeSegments.set(s.id, { startMs: at(start), endDist: start + len });
        events.push({ kind: 'segmentStart', riderId: r.id, segmentId: s.id });
      }
    }
  }

  /** Course : primes aux trois premiers à passer au sommet d'un KOM / sur la ligne d'un sprint. */
  private awardPrime(r: SimRider, segId: string, endDist: number, events: RideEventMsg[]): void {
    if (this.options.mode !== 'race' || this.phase !== 'running' || !r.eligible || r.finishMs !== undefined) return;
    const seg = this.route.segments.find((s) => s.id === segId);
    if (!seg || seg.kind === 'section') return;
    const lap = this.route.loop ? Math.floor((endDist - 1e-6) / this.track.length) : 0;
    const key = `${segId}:${lap}`;
    const place = (this.primeCounts.get(key) ?? 0) + 1;
    this.primeCounts.set(key, place);
    const points = PRIME_POINTS[place - 1];
    if (points === undefined) return;
    if (seg.kind === 'kom') r.komPts += points;
    else r.sprintPts += points;
    events.push({ kind: 'prime', segmentId: segId, segmentKind: seg.kind, riderId: r.id, place, points, lap });
  }

  private writeRow(r: SimRider, pose = r.pose.pose): void {
    const row = r.row;
    row.distM = this.track.wrap(r.state.distM);
    if (this.route.loop && row.distM >= this.track.length) row.distM = 0;
    row.lap = this.lapOf(r.state.distM);
    row.lateralM = r.lateralM;
    row.speedMs = r.state.speedMs;
    row.watts = r.watts;
    row.cadence = r.cadence;
    row.draftPct = r.draft * 100;
    row.pose = pose;
    if (r.shareHr && r.hr !== undefined) row.hr = r.hr;
    else delete row.hr;
  }

  rows(): SnapshotRow[] {
    return this.riders.map((r) => r.row);
  }

  private statusOf(r: SimRider): RaceStatus {
    if (r.dq) return 'dq';
    if (r.kind === 'guest' || r.lateJoin) return 'unranked';
    if (r.finishMs !== undefined && r.rank > 0) return 'finished';
    return this.phase === 'finished' ? 'otl' : 'racing';
  }

  private resultOf(r: SimRider): RideResult {
    const status = this.statusOf(r);
    return {
      riderId: r.id,
      name: r.name,
      rank: status === 'finished' ? r.rank : 0,
      timeMs: r.finishMs ?? 0,
      isAI: r.kind === 'ai',
      isGuest: r.kind === 'guest',
      status,
      komPts: r.komPts,
      sprintPts: r.sprintPts,
      distM: Math.round(Math.max(0, Math.min(r.state.distM, this.raceTarget()))),
    };
  }

  /**
   * Classement : arrivés (rang), puis en course / hors délai (distance), puis abandons,
   * mises hors course et hors classement. Écart au vainqueur pour les arrivés.
   */
  results(): RideResult[] {
    const order: Record<RaceStatus, number> = { finished: 0, racing: 1, otl: 2, dnf: 3, dq: 4, unranked: 5 };
    const list = [...this.riders.map((r) => this.resultOf(r)), ...this.dnfs];
    list.sort((x, y) => order[x.status!] - order[y.status!] || (x.rank || 1e9) - (y.rank || 1e9) || (y.distM ?? 0) - (x.distM ?? 0) || x.timeMs - y.timeMs);
    const winner = list.find((x) => x.status === 'finished');
    if (winner) for (const x of list) if (x.status === 'finished') x.gapMs = x.timeMs - winner.timeMs;
    return list;
  }

  /** Course commencée : classement courant (accueil d'un coureur qui (re)joint). */
  liveResults(): RideResult[] | undefined {
    return this.options.mode === 'race' && (this.phase === 'running' || this.phase === 'finished') ? this.results() : undefined;
  }

  roster(hostId: string): RosterEntry[] {
    return this.riders.map((r) => ({
      n: r.n,
      id: r.id,
      name: r.name,
      avatar: r.avatar,
      isAI: r.kind === 'ai',
      isGuest: r.kind === 'guest',
      isHost: r.id === hostId,
      connected: r.connected,
      ftpWatts: r.ftpWatts,
      massKg: r.riderMassKg,
    }));
  }

  /** Classement de la sortie sur un segment (meilleur temps par coureur). */
  segmentBoard(segmentId: string): Array<{ riderId: string; name: string; timeMs: number }> {
    const bests = this.segmentBests.get(segmentId);
    if (!bests) return [];
    return [...bests]
      .map(([riderId, timeMs]) => ({ riderId, name: this.byId.get(riderId)?.name ?? '?', timeMs }))
      .sort((a, b) => a.timeMs - b.timeMs);
  }

  /** Profil IA disponible (pour validation des options). */
  static readonly aiProfiles = Object.keys(AI_PROFILES);
}
