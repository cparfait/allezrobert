/**
 * Coureurs IA : comportement par profil (diesel, puncheur, sprinteur, rouleur) produisant une
 * puissance cible selon la situation : tenir l'allure du groupe dans les roues, prendre des
 * relais (rotation), attaquer en côte / sur les segments, répondre aux attaques, s'épuiser
 * (modèle W′ balance de Skiba) puis récupérer.
 *
 * Entièrement déterministe : tout l'aléa passe par un {@link SeededRng} propre au coureur, et
 * les décisions aléatoires sont prises à cadence fixe (1 Hz d'horloge interne) ; une même
 * suite d'appels `update(ctx, dt)` donne la même suite de sorties sur client et serveur.
 *
 * La puissance produite est ensuite intégrée par {@link stepRider} comme pour un humain.
 */
import { DEFAULT_ENVIRONMENT, effectiveMass, powerForSpeed, type Environment, type RiderPhysicsParams } from './model.ts';
import { SeededRng } from './rng.ts';
import { WPrimeBalance } from './training.ts';

export type AiProfileName = 'diesel' | 'puncheur' | 'sprinter' | 'rouleur';

export interface AiProfile {
  name: AiProfileName | string;
  /** W′ en joules par watt de FTP (≈ 60–110). */
  wPrimePerFtp: number;
  /** Puissance maximale en fraction de FTP. */
  maxPowerFtp: number;
  /** Durée moyenne d'un relais (s) et multiplicateur de l'allure en tête. */
  pullDurationS: number;
  pullPowerFactor: number;
  /** Attaques par minute selon le terrain (avant agressivité). */
  attackRatePerMin: { flat: number; climb: number; segment: number };
  /** Puissance (× FTP) et durée (s) d'une attaque. */
  attackPowerFtp: number;
  attackDurationS: number;
  /** Probabilité de suivre une attaque. */
  respondProbability: number;
  /** Bonus d'allure en côte (1 = neutre). */
  climbFactor: number;
  /** Cadence préférée sur le plat (tr/min). */
  cadence: number;
}

export const AI_PROFILES: Readonly<Record<AiProfileName, AiProfile>> = {
  diesel: {
    name: 'diesel',
    wPrimePerFtp: 60,
    maxPowerFtp: 1.8,
    pullDurationS: 60,
    pullPowerFactor: 1.08,
    attackRatePerMin: { flat: 0.02, climb: 0.15, segment: 0.2 },
    attackPowerFtp: 1.2,
    attackDurationS: 180,
    respondProbability: 0.5,
    climbFactor: 1.03,
    cadence: 85,
  },
  puncheur: {
    name: 'puncheur',
    wPrimePerFtp: 90,
    maxPowerFtp: 2.6,
    pullDurationS: 25,
    pullPowerFactor: 1.04,
    attackRatePerMin: { flat: 0.03, climb: 0.6, segment: 0.8 },
    attackPowerFtp: 1.6,
    attackDurationS: 40,
    respondProbability: 0.8,
    climbFactor: 1.05,
    cadence: 92,
  },
  sprinter: {
    name: 'sprinter',
    wPrimePerFtp: 110,
    maxPowerFtp: 3.2,
    pullDurationS: 20,
    pullPowerFactor: 1.02,
    attackRatePerMin: { flat: 0.01, climb: 0.02, segment: 1.5 },
    attackPowerFtp: 2.4,
    attackDurationS: 15,
    respondProbability: 0.6,
    climbFactor: 0.95,
    cadence: 95,
  },
  rouleur: {
    name: 'rouleur',
    wPrimePerFtp: 70,
    maxPowerFtp: 2.0,
    pullDurationS: 75,
    pullPowerFactor: 1.1,
    attackRatePerMin: { flat: 0.08, climb: 0.08, segment: 0.3 },
    attackPowerFtp: 1.35,
    attackDurationS: 90,
    respondProbability: 0.7,
    climbFactor: 0.98,
    cadence: 90,
  },
};

export interface AiRiderConfig {
  id: string;
  profile: AiProfileName | AiProfile;
  ftpWatts: number;
  params: RiderPhysicsParams;
  /** Masse du coureur seul (kg) pour l'allure en W/kg. Défaut : masse totale − 8,5 kg. */
  riderMassKg?: number;
  /** Graine (défaut : hachage de l'id). */
  seed?: number | string;
  /** W′ (J), sinon profil × FTP. */
  wPrimeJ?: number;
  /** Agressivité 0–2 (multiplie les taux d'attaque). Défaut 1. */
  aggressiveness?: number;
}

/** Segment (KOM, sprint) en cours ou à venir. */
export interface AiSegmentInfo {
  kind: 'kom' | 'sprint' | 'section';
  /** Distance jusqu'au début (≤ 0 si déjà dedans). */
  distToStartM: number;
  /** Distance jusqu'à la fin. */
  distToEndM: number;
}

/** Situation perçue par l'IA à chaque pas (fournie par le serveur). */
export interface AiContext {
  gradePercent: number;
  /** Vitesse propre (m/s). */
  speedMs: number;
  /** Allure du groupe en W/kg pour le coureur de tête (« groupe à x % de FTP »). */
  groupPaceWkg: number;
  /** Écart roue-à-roue au coureur devant (m) ; Infinity si personne à portée. */
  gapAheadM: number;
  speedAheadMs: number;
  /** Décalage latéral du coureur devant par rapport à soi (m). */
  lateralAheadM?: number;
  /** Rang dans le groupe (0 = tête) et taille du groupe. */
  positionInGroup: number;
  groupSize: number;
  /** Multiplicateur de CdA courant (1 − aspiration). */
  cdaFactor?: number;
  segment?: AiSegmentInfo;
  /** Attaque d'un autre coureur : écart devant soi (m) et vitesse. */
  attack?: { riderId: string; gapM: number; speedMs: number };
  env?: Readonly<Environment>;
}

export type AiState = 'follow' | 'pull' | 'pullOff' | 'attack' | 'chase' | 'recover';

export interface AiOutput {
  watts: number;
  cadence: number;
  state: AiState;
  /** Décalage latéral souhaité relatif à la trajectoire du groupe (m, + = droite). */
  lateralTargetM: number;
  /** W′bal / W′ (0–1). */
  wPrimeFraction: number;
}

const DESIRED_GAP_M = 0.6;
const DECISION_PERIOD_S = 1;

export class AiRider {
  readonly id: string;
  readonly profile: AiProfile;
  readonly ftpWatts: number;
  readonly params: RiderPhysicsParams;
  readonly riderMassKg: number;
  readonly wPrime: WPrimeBalance;
  readonly rng: SeededRng;
  aggressiveness: number;
  state: AiState = 'follow';
  private stateTime = 0;
  private stateDuration = 0;
  private decisionClock = 0;
  private sinceAttack = Infinity;
  private lastRespondedTo = '';
  private noise = 0;
  private lastWatts = 0;
  private readonly out: AiOutput = { watts: 0, cadence: 0, state: 'follow', lateralTargetM: 0, wPrimeFraction: 1 };

  constructor(cfg: AiRiderConfig) {
    this.id = cfg.id;
    this.profile = typeof cfg.profile === 'string' ? AI_PROFILES[cfg.profile] : cfg.profile;
    this.ftpWatts = cfg.ftpWatts;
    this.params = cfg.params;
    this.riderMassKg = cfg.riderMassKg ?? Math.max(30, cfg.params.massKg - 8.5);
    this.rng = new SeededRng(cfg.seed ?? cfg.id);
    this.aggressiveness = cfg.aggressiveness ?? 1;
    this.wPrime = new WPrimeBalance(cfg.ftpWatts, cfg.wPrimeJ ?? this.profile.wPrimePerFtp * cfg.ftpWatts);
  }

  private setState(s: AiState, durationS = 0): void {
    this.state = s;
    this.stateTime = 0;
    this.stateDuration = durationS;
  }

  /** Puissance pour tenir l'allure de tête du groupe. */
  private pacePower(ctx: AiContext): number {
    const climb = ctx.gradePercent > 2 ? this.profile.climbFactor : 1;
    return ctx.groupPaceWkg * this.riderMassKg * climb;
  }

  /** Puissance pour viser un écart donné derrière une cible. */
  private followPower(ctx: AiContext, gapM: number, targetSpeed: number, desiredGap: number): number {
    const env = ctx.env ?? DEFAULT_ENVIRONMENT;
    const err = gapM - desiredGap;
    const vTarget = Math.max(0, targetSpeed + Math.min(Math.max(0.35 * err, -1.5), 2.5));
    const steady = powerForSpeed(vTarget, ctx.gradePercent, this.params, env, ctx.cdaFactor ?? 1);
    // Terme d'accélération : rejoindre vTarget en ~2 s.
    const accel = (effectiveMass(this.params) * (vTarget - ctx.speedMs) * Math.max(ctx.speedMs, 2)) / 2;
    return steady + accel;
  }

  private decide(ctx: AiContext): void {
    const p = this.profile;
    const frac = this.wPrime.fraction;
    // Répondre à une attaque.
    if (ctx.attack && ctx.attack.riderId !== this.id && this.state !== 'attack' && this.state !== 'recover') {
      if (this.lastRespondedTo !== ctx.attack.riderId && ctx.attack.gapM > 4) {
        this.lastRespondedTo = ctx.attack.riderId;
        if (frac > 0.3 && this.rng.chance(p.respondProbability * Math.min(1, frac + 0.2))) this.setState('chase', 120);
      }
    }
    if (!ctx.attack) this.lastRespondedTo = '';
    // Attaquer.
    if ((this.state === 'follow' || this.state === 'pull') && frac > 0.7 && this.sinceAttack > 90) {
      const seg = ctx.segment;
      const inSeg = seg !== undefined && seg.distToStartM <= 0 && seg.distToEndM > 0;
      let rate = p.attackRatePerMin.flat;
      if (ctx.gradePercent >= 4) rate = p.attackRatePerMin.climb;
      if (inSeg && seg) {
        const nearEnd = seg.kind === 'sprint' ? seg.distToEndM < 300 : seg.distToEndM < 600;
        if (nearEnd) rate = Math.max(rate, p.attackRatePerMin.segment * (seg.kind === 'sprint' ? 3 : 1));
      }
      if (this.rng.chance((rate * this.aggressiveness * DECISION_PERIOD_S) / 60)) {
        this.setState('attack', p.attackDurationS * this.rng.range(0.7, 1.3));
        this.sinceAttack = 0;
      }
    }
    // Bruit d'allure lent (±2 %).
    this.noise += 0.3 * (this.rng.normal() * 0.02 - this.noise);
  }

  /** Avance l'IA d'un pas et renvoie sa consigne (objet réutilisé). */
  update(ctx: AiContext, dt: number): AiOutput {
    const p = this.profile;
    this.stateTime += dt;
    this.sinceAttack += dt;
    this.decisionClock += dt;
    while (this.decisionClock >= DECISION_PERIOD_S) {
      this.decisionClock -= DECISION_PERIOD_S;
      this.decide(ctx);
    }

    const pace = this.pacePower(ctx);
    const lateralAhead = Math.abs(ctx.lateralAheadM ?? 0);
    const hasWheel = Number.isFinite(ctx.gapAheadM) && ctx.gapAheadM < 25 && lateralAhead < 0.9;
    let lateral = 0;
    let watts: number;

    // Transitions dépendant de la position.
    if (this.state === 'follow' && ctx.positionInGroup === 0 && ctx.groupSize > 1) {
      this.setState('pull', p.pullDurationS * this.rng.range(0.7, 1.3));
    } else if (this.state === 'pull' && (ctx.positionInGroup > 0 || ctx.groupSize <= 1)) {
      this.setState('follow');
    }

    switch (this.state) {
      case 'pull': {
        watts = pace * p.pullPowerFactor;
        if (this.stateTime >= this.stateDuration) this.setState('pullOff', 25);
        break;
      }
      case 'pullOff': {
        lateral = 1.2;
        watts = pace * 0.8;
        if (ctx.positionInGroup >= ctx.groupSize - 1 || this.stateTime >= this.stateDuration) this.setState('follow');
        break;
      }
      case 'attack': {
        lateral = -0.8;
        watts = this.ftpWatts * p.attackPowerFtp;
        if (this.stateTime >= this.stateDuration || this.wPrime.fraction < 0.25) this.setState('recover', 60);
        break;
      }
      case 'chase': {
        const a = ctx.attack;
        if (!a || a.gapM < 1.5 || this.wPrime.fraction < 0.2 || this.stateTime >= this.stateDuration) {
          this.setState(this.wPrime.fraction < 0.2 ? 'recover' : 'follow', 45);
          watts = hasWheel ? this.followPower(ctx, ctx.gapAheadM, ctx.speedAheadMs, DESIRED_GAP_M) : pace;
        } else {
          watts = Math.min(this.followPower(ctx, a.gapM, a.speedMs, DESIRED_GAP_M), this.ftpWatts * 1.5);
        }
        break;
      }
      case 'recover': {
        const base = hasWheel ? this.followPower(ctx, ctx.gapAheadM, ctx.speedAheadMs, DESIRED_GAP_M) : pace * 0.85;
        watts = Math.min(base, this.ftpWatts * 0.8);
        if (this.stateTime >= this.stateDuration && this.wPrime.fraction > 0.6) this.setState('follow');
        break;
      }
      default: {
        watts = hasWheel ? this.followPower(ctx, ctx.gapAheadM, ctx.speedAheadMs, DESIRED_GAP_M) : pace;
        break;
      }
    }

    // Fatigue : W′ épuisé ⇒ plafonné sous CP ; plafond physiologique.
    const frac = this.wPrime.fraction;
    let cap = this.ftpWatts * p.maxPowerFtp;
    if (frac < 0.1) cap = Math.min(cap, this.ftpWatts * (frac <= 0 ? 0.85 : 0.97));
    watts = Math.min(Math.max(watts * (1 + this.noise), 0), cap);
    // Lissage (inertie humaine ~0,7 s).
    watts = this.lastWatts + (watts - this.lastWatts) * (1 - Math.exp(-dt / 0.7));
    this.lastWatts = watts;
    this.wPrime.update(watts, dt);

    const out = this.out;
    out.watts = Math.round(watts);
    out.cadence = watts < 10 ? 0 : Math.round(p.cadence - Math.max(0, ctx.gradePercent) * 1.5 + (this.state === 'attack' ? 8 : 0));
    out.state = this.state;
    out.lateralTargetM = lateral;
    out.wPrimeFraction = Math.max(0, frac);
    return out;
  }
}
