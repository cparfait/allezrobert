/**
 * Demi-tour d'un équipier IA trop loin devant (idée « rouler seul en semaine ») : plutôt que
 * de s'arrêter au milieu de la route, l'équipier freine, fait demi-tour en arc de cercle sur
 * la voie de gauche, redescend vers le groupe, puis refait demi-tour juste avant que le groupe
 * n'arrive et se replace en queue.
 *
 * Machine à états pure et déterministe (aucun aléa) :
 *   pack → brake → turn → back → brakeBack → turnBack → pack (avec délai avant un nouveau demi-tour)
 *
 * Tant que le contrôleur est actif (`active`), c'est lui qui intègre la cinématique (distance
 * le long de l'itinéraire, décalage latéral, cap relatif) ; en `pack`, l'appelant garde l'IA
 * normale ({@link AiRider} + `stepRider`). Les distances sont celles de l'itinéraire (m),
 * le latéral est positif à droite dans le sens de marche, le cap `headingRad` est relatif à
 * la route : 0 = dans le sens de marche, π = à contresens.
 */

export type UTurnPhase = 'pack' | 'brake' | 'turn' | 'back' | 'brakeBack' | 'turnBack';

export interface UTurnConfig {
  /** Avance (m) sur le groupe au-delà de laquelle l'équipier envisage le demi-tour. */
  triggerLeadM: number;
  /** Durée (s) pendant laquelle l'avance doit rester au-delà du seuil sans se résorber. */
  triggerHoldS: number;
  /** Avance (m) qui déclenche le demi-tour immédiatement. */
  hardLeadM: number;
  /** Vitesse de manœuvre pendant le virage (m/s). */
  turnSpeedMs: number;
  /** Durée du demi-tour (s). */
  turnDurationS: number;
  /** Décélération au freinage (m/s²). */
  brakeDecelMs2: number;
  /** Vitesse du retour vers le groupe, à contresens (m/s). */
  returnSpeedMs: number;
  /** Accélération au retour (m/s²). */
  returnAccelMs2: number;
  /** Délai minimal entre deux demi-tours d'un même équipier (s). */
  cooldownS: number;
  /** Avance visée sur le groupe à la fin du second demi-tour (m). */
  rejoinLeadM: number;
  /** Demi-largeur utile de la chaussée (m). */
  halfRoadM: number;
}

export const DEFAULT_UTURN_CONFIG: Readonly<UTurnConfig> = {
  triggerLeadM: 120,
  triggerHoldS: 4,
  hardLeadM: 260,
  turnSpeedMs: 1.9,
  turnDurationS: 2.6,
  brakeDecelMs2: 2.2,
  returnSpeedMs: 8,
  returnAccelMs2: 0.9,
  cooldownS: 60,
  rejoinLeadM: 4,
  halfRoadM: 2.6,
};

export interface UTurnInput {
  /** Avance de l'équipier sur la référence du groupe (m, > 0 = devant). */
  leadM: number;
  /** Vitesse du groupe (m/s, ≥ 0). */
  groupSpeedMs: number;
  /** Distance courante de l'équipier sur l'itinéraire (m). */
  distM: number;
  /** Vitesse courante (m/s) — lue au déclenchement. */
  speedMs: number;
  /** Décalage latéral courant (m) — lu au déclenchement. */
  lateralM: number;
  /** Interdire un nouveau déclenchement (segment disputé, séance…). */
  blocked?: boolean;
}

export interface UTurnOutput {
  /** Le contrôleur pilote la cinématique pendant ce pas. */
  active: boolean;
  phase: UTurnPhase;
  /** Nouvelle distance sur l'itinéraire (m). */
  distM: number;
  /** Vitesse scalaire (m/s, ≥ 0), dans la direction du cap. */
  speedMs: number;
  /** Composante de vitesse le long de l'itinéraire (m/s, négative à contresens). */
  alongMs: number;
  lateralM: number;
  /** Cap relatif à la route (rad) : 0 sens de marche, π contresens. */
  headingRad: number;
  /** Pédale (retour) ou roue libre (freinage, virage). */
  pedaling: boolean;
}

const smoothstep = (x: number): number => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

export class TeammateUTurn {
  readonly config: UTurnConfig;
  phase: UTurnPhase = 'pack';
  private hold = 0;
  private sinceLast = Infinity;
  private prevLead = Number.NaN;
  private dist = 0;
  private speed = 0;
  private lateral = 0;
  private heading = 0;
  private turnT = 0;
  /** Nombre de demi-tours effectués (statistiques, tests). */
  count = 0;
  private readonly out: UTurnOutput = { active: false, phase: 'pack', distM: 0, speedMs: 0, alongMs: 0, lateralM: 0, headingRad: 0, pedaling: true };

  constructor(config: Partial<UTurnConfig> = {}) {
    this.config = { ...DEFAULT_UTURN_CONFIG, ...config };
  }

  get active(): boolean {
    return this.phase !== 'pack';
  }

  /** Abandonne la manœuvre (téléportation, fin de sortie) et rend la main à l'IA. */
  reset(): void {
    this.phase = 'pack';
    this.hold = 0;
    this.heading = 0;
    this.prevLead = Number.NaN;
  }

  /**
   * Distance de rencontre : avance à laquelle commencer le second demi-tour pour finir
   * `rejoinLeadM` devant le groupe (freinage + virage, pendant lesquels le groupe avance).
   */
  meetLeadM(groupSpeedMs: number, speedMs = this.speed): number {
    const c = this.config;
    const tb = Math.max(0, speedMs - c.turnSpeedMs) / c.brakeDecelMs2;
    const backDuringBrake = ((speedMs + c.turnSpeedMs) / 2) * tb;
    // Le virage est un demi-cercle symétrique : déplacement net le long de la route ≈ 0.
    return c.rejoinLeadM + backDuringBrake + Math.max(groupSpeedMs, 0) * (tb + c.turnDurationS);
  }

  update(input: UTurnInput, dt: number): UTurnOutput {
    const c = this.config;
    const o = this.out;
    this.sinceLast += dt;

    if (this.phase === 'pack') {
      // L'avance se résorbe déjà (le groupe revient) : pas de demi-tour.
      const closing = Number.isFinite(this.prevLead) && dt > 0 ? (this.prevLead - input.leadM) / dt : 0;
      this.prevLead = input.leadM;
      if (input.leadM > c.triggerLeadM && closing < 1.5 && !input.blocked) this.hold += dt;
      else this.hold = 0;
      const go = !input.blocked && this.sinceLast >= c.cooldownS && (this.hold >= c.triggerHoldS || input.leadM > c.hardLeadM);
      if (!go) {
        o.active = false;
        o.phase = 'pack';
        o.distM = input.distM;
        o.speedMs = input.speedMs;
        o.alongMs = input.speedMs;
        o.lateralM = input.lateralM;
        o.headingRad = 0;
        o.pedaling = true;
        return o;
      }
      this.phase = 'brake';
      this.dist = input.distM;
      this.speed = input.speedMs;
      this.lateral = input.lateralM;
      this.heading = 0;
      this.hold = 0;
      this.count++;
    }

    const half = c.halfRoadM;
    const leftLane = -half * 0.55;
    let pedaling = false;
    switch (this.phase) {
      case 'brake':
      case 'brakeBack': {
        const forward = this.phase === 'brake' ? 1 : -1;
        this.speed = Math.max(c.turnSpeedMs, this.speed - c.brakeDecelMs2 * dt);
        this.dist += forward * this.speed * dt;
        // Au freinage aller, on se rapproche du bord droit pour amorcer le virage à gauche.
        if (this.phase === 'brake') this.lateral += (Math.min(half - 0.4, 1.2) - this.lateral) * Math.min(1, dt * 0.8);
        if (this.speed <= c.turnSpeedMs + 1e-6) {
          this.phase = this.phase === 'brake' ? 'turn' : 'turnBack';
          this.turnT = 0;
        }
        break;
      }
      case 'turn':
      case 'turnBack': {
        this.turnT += dt;
        const k = smoothstep(this.turnT / c.turnDurationS);
        const base = this.phase === 'turn' ? 0 : Math.PI;
        this.heading = base + Math.PI * k;
        this.speed = c.turnSpeedMs;
        this.dist += this.speed * Math.cos(this.heading) * dt;
        // Virage à gauche : sin(cap) > 0 entre 0 et π ⇒ vers la gauche (latéral négatif).
        this.lateral = Math.min(Math.max(this.lateral - this.speed * Math.sin(this.heading) * dt, -half), half);
        if (this.turnT >= c.turnDurationS) {
          if (this.phase === 'turn') {
            this.phase = 'back';
            this.heading = Math.PI;
          } else {
            this.phase = 'pack';
            this.heading = 0;
            this.sinceLast = 0;
            this.prevLead = Number.NaN;
          }
        }
        break;
      }
      case 'back': {
        pedaling = true;
        this.speed = Math.min(c.returnSpeedMs, this.speed + c.returnAccelMs2 * dt);
        this.dist -= this.speed * dt;
        this.lateral += (leftLane - this.lateral) * Math.min(1, dt * 0.6);
        // Avance recalculée avec la distance déjà mise à jour.
        const lead = input.leadM - (input.distM - this.dist);
        if (lead <= this.meetLeadM(input.groupSpeedMs)) this.phase = 'brakeBack';
        break;
      }
      default:
        break;
    }

    // Actif pendant tout le pas, y compris celui qui termine le second virage (la main revient
    // à l'IA au pas suivant, en phase « pack »).
    o.active = true;
    o.phase = this.phase;
    o.distM = this.dist;
    o.speedMs = this.speed;
    o.alongMs = this.speed * Math.cos(this.heading);
    o.lateralM = this.lateral;
    o.headingRad = this.heading;
    o.pedaling = pedaling;
    return o;
  }
}
