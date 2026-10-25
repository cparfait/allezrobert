/**
 * Aspiration (drafting) : réduction du CdA selon l'écart longitudinal et le décalage latéral.
 *
 * Ordres de grandeur de la littérature :
 * - Kyle (1979), Zdravkovich (1996), Blocken et al. (2013, 2018) : derrière un seul coureur,
 *   −30 à −40 % de traînée à 0,5–1 m d'écart roue-à-roue, décroissance quasi exponentielle,
 *   effet négligeable au-delà de 10–15 m et dès que le décalage latéral dépasse ~0,8 m.
 * - Paceline / peloton : les coureurs plus profonds gagnent davantage (−45 à −60 % retenus ici,
 *   valeurs prudentes par rapport aux CFD de Blocken 2018 qui vont jusqu'à −90 %).
 * - Le coureur de tête gagne ~2–3 % grâce à celui qui le suit de près.
 *
 * Modèle retenu (réduction r ∈ [0, maxGroup]) :
 *   gap   = Δdistance − longueur du vélo (écart roue arrière → roue avant)
 *   fLong = 1 si 0 ≤ gap ≤ 0,5 m ; exp(−(gap − 0,5)/λ) au-delà (λ = 5 m), atténué en douceur
 *           jusqu'à 0 entre `fadeStartM` (10 m) et `rangeM` (15 m) ; roues qui se chevauchent :
 *           1 + gap/0,8 (0 côte à côte).
 *   fLat  = 1 si |lat| ≤ 0,15 m, puis cosinus jusqu'à 0 à w = 0,8 m + 0,04·gap (sillage qui s'élargit).
 *   r₁    = maxSingle · fLong · fLat   (contribution d'un coureur devant)
 *   r     = r_best + (maxGroup − r_best) · (1 − exp(−k · Σ r_autres))   (bonus de groupe)
 * Le tout est multiplié par `strength` (option de salle `draftingStrength`, 0–1).
 *
 * Vent de côté : le sillage est poussé sous le vent, de `gap · vent latéral / vitesse` (l'air qui
 * quitte le coureur de devant dérive pendant qu'il parcourt l'écart) ; l'abri se trouve alors de
 * biais, d'où les bordures (échelons) des pelotons par vent de travers.
 */

/** Coureur vu par le calcul d'aspiration. */
export interface DraftRider {
  distM: number;
  lateralM: number;
  speedMs: number;
}

export interface DraftOptions {
  /** Intensité globale 0–1 (`RoomOptions.draftingStrength`). Défaut 1. */
  strength?: number;
  /** Longueur d'un vélo (m) : `distM` repère la même extrémité pour tous. Défaut 1,75. */
  bikeLengthM?: number;
  /** Réduction maximale derrière un seul coureur. Défaut 0,38. */
  maxSingle?: number;
  /** Réduction maximale au cœur d'un groupe. Défaut 0,58. */
  maxGroup?: number;
  /** Longueur de décroissance exponentielle (m). Défaut 5. */
  decayM?: number;
  /** Début d'atténuation finale (m d'écart). Défaut 10. */
  fadeStartM?: number;
  /** Portée maximale (m d'écart). Défaut 15. */
  rangeM?: number;
  /** Demi-largeur du sillage à écart nul (m). Défaut 0,8. */
  wakeHalfWidthM?: number;
  /** Raideur du bonus de groupe. Défaut 1,5. */
  groupGain?: number;
  /** Gain du coureur de tête poussé par celui qui suit. Défaut 0,03. */
  leadBonus?: number;
  /** Vitesse sous laquelle un coureur n'abrite plus personne (m/s). Défaut 1. */
  minShelterSpeedMs?: number;
}

interface ResolvedDraftOptions {
  strength: number;
  bikeLengthM: number;
  maxSingle: number;
  maxGroup: number;
  decayM: number;
  fadeStartM: number;
  rangeM: number;
  wakeHalfWidthM: number;
  groupGain: number;
  leadBonus: number;
  minShelterSpeedMs: number;
}

export const DEFAULT_DRAFT_OPTIONS: Readonly<ResolvedDraftOptions> = {
  strength: 1,
  bikeLengthM: 1.75,
  maxSingle: 0.38,
  maxGroup: 0.58,
  decayM: 5,
  fadeStartM: 10,
  rangeM: 15,
  wakeHalfWidthM: 0.8,
  groupGain: 1.5,
  leadBonus: 0.03,
  minShelterSpeedMs: 1,
};

function resolve(o: DraftOptions | undefined): ResolvedDraftOptions {
  return o ? { ...DEFAULT_DRAFT_OPTIONS, ...o } : DEFAULT_DRAFT_OPTIONS;
}

/**
 * Décalage latéral (m, positif vers la droite) du sillage d'un coureur à `gapM` derrière lui, par un
 * vent latéral `crossMs` (positif : souffle vers la droite de la route) et à la vitesse `speedMs`.
 */
export function wakeShiftM(gapM: number, crossMs: number, speedMs: number): number {
  if (gapM <= 0 || crossMs === 0) return 0;
  return Math.min(Math.max((gapM * crossMs) / Math.max(speedMs, 3), -1.5), 1.5);
}

function smoothstep(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/** Facteur longitudinal (0–1) en fonction de l'écart roue-à-roue (m). */
export function draftLongitudinalFactor(gapM: number, opts?: DraftOptions): number {
  const o = resolve(opts);
  return longFactor(gapM, o);
}

function longFactor(gap: number, o: ResolvedDraftOptions): number {
  if (gap < 0) return Math.max(0, 1 + gap / 0.8);
  if (gap >= o.rangeM) return 0;
  let f = gap <= 0.5 ? 1 : Math.exp(-(gap - 0.5) / o.decayM);
  if (gap > o.fadeStartM) f *= 1 - smoothstep((gap - o.fadeStartM) / (o.rangeM - o.fadeStartM));
  return f;
}

function latFactor(lat: number, gap: number, o: ResolvedDraftOptions): number {
  const a = Math.abs(lat);
  const inner = 0.15;
  const w = Math.min(o.wakeHalfWidthM + 0.04 * Math.max(gap, 0), 1.2);
  if (a <= inner) return 1;
  if (a >= w) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * (a - inner)) / (w - inner)));
}

/**
 * Réduction de CdA (0–maxSingle, avant `strength`) derrière un seul coureur.
 * @param gapM écart roue arrière du coureur devant → roue avant du suiveur (m)
 * @param lateralM décalage latéral entre les deux (m)
 */
export function draftReductionSingle(gapM: number, lateralM: number, opts?: DraftOptions): number {
  const o = resolve(opts);
  return o.maxSingle * longFactor(gapM, o) * latFactor(lateralM, gapM, o);
}

/**
 * Calculateur réutilisable (tampons internes, aucune allocation en régime établi).
 * Complexité : tri O(n log n) + balayage des seuls coureurs à portée devant chacun.
 * Hypothèse : itinéraire non bouclé ou coureurs loin de la ligne de bouclage ; pour une
 * boucle, passer des `distM` dépliés (tour × longueur + distance).
 */
export class DraftCalculator {
  private order: number[] = [];
  private bonus: Float64Array = new Float64Array(0);
  private out: Float64Array = new Float64Array(0);
  private readonly o: ResolvedDraftOptions;
  /** Vent latéral (m/s, positif : souffle vers la droite de la route). */
  private cross = 0;

  constructor(opts?: DraftOptions) {
    this.o = { ...DEFAULT_DRAFT_OPTIONS, ...opts };
  }

  /** Vent latéral courant (m/s, positif vers la droite de la route) : décale les sillages. */
  setCrosswind(ms: number): void {
    this.cross = Number.isFinite(ms) ? ms : 0;
  }

  /** Modifie l'intensité globale (option de salle). */
  setStrength(strength: number): void {
    this.o.strength = Math.min(Math.max(strength, 0), 1);
  }

  /**
   * Réductions de CdA par coureur, dans l'ordre d'entrée (vue sur un tampon interne,
   * valable jusqu'au prochain appel). CdA effectif = CdA × (1 − r).
   */
  compute(riders: ArrayLike<DraftRider>): Float64Array {
    const n = riders.length;
    const o = this.o;
    if (this.out.length < n) {
      this.out = new Float64Array(Math.max(n, 2 * this.out.length));
      this.bonus = new Float64Array(this.out.length);
    }
    const out = this.out.subarray(0, n);
    const bonus = this.bonus.subarray(0, n);
    out.fill(0);
    bonus.fill(0);
    const order = this.order;
    order.length = n;
    for (let i = 0; i < n; i++) order[i] = i;
    // Tri décroissant : la tête de course en premier.
    order.sort((a, b) => riders[b]!.distM - riders[a]!.distM);

    const reach = o.rangeM + o.bikeLengthM;
    for (let p = 0; p < n; p++) {
      const i = order[p]!;
      const ri = riders[i]!;
      let best = 0;
      let sum = 0;
      for (let q = p - 1; q >= 0; q--) {
        const j = order[q]!;
        const rj = riders[j]!;
        const dd = rj.distM - ri.distM;
        if (dd > reach) break;
        if (rj.speedMs < o.minShelterSpeedMs) continue;
        const gap = dd - o.bikeLengthM;
        const shift = wakeShiftM(gap, this.cross, rj.speedMs);
        const r = o.maxSingle * longFactor(gap, o) * latFactor(rj.lateralM + shift - ri.lateralM, gap, o);
        if (r <= 0) continue;
        sum += r;
        if (r > best) best = r;
        // Le coureur devant profite un peu de la poussée du suiveur proche.
        if (gap < 1.5) {
          const b = (o.leadBonus * r) / o.maxSingle;
          if (b > bonus[j]!) bonus[j] = b;
        }
      }
      if (best > 0) {
        const others = sum - best;
        out[i] = best + (o.maxGroup - best) * (1 - Math.exp(-o.groupGain * others));
      }
    }
    for (let i = 0; i < n; i++) {
      const r = Math.min(out[i]! + (out[i]! > 0 ? 0 : bonus[i]!), o.maxGroup);
      out[i] = r * o.strength;
    }
    return out;
  }
}

/**
 * Raccourci fonctionnel : réductions de CdA (0–~0,58 × strength) par coureur.
 * Alloue un calculateur à chaque appel : préférer {@link DraftCalculator} dans une boucle.
 */
export function computeDraftFactors(riders: ArrayLike<DraftRider>, opts?: DraftOptions): Float64Array {
  return new DraftCalculator(opts).compute(riders).slice();
}

/** Gabarit d'un véhicule pour l'aspiration. */
export type VehicleKind = 'car' | 'van' | 'tractor';

const VEHICLE_WAKE: Record<VehicleKind, { max: number; halfWidthM: number }> = {
  // Abri derrière un véhicule : sillage plus large et plus long que derrière un coureur ;
  // culot carré (camionnette, tracteur et sa remorque) plus efficace qu'une berline.
  car: { max: 0.35, halfWidthM: 1.0 },
  van: { max: 0.45, halfWidthM: 1.15 },
  tractor: { max: 0.45, halfWidthM: 1.2 },
};

/**
 * Réduction de CdA (0–0,45) derrière un véhicule qui roule dans le même sens.
 * @param gapM écart entre l'arrière du véhicule et la roue avant du coureur (m)
 * @param lateralM décalage latéral entre l'axe du véhicule et le coureur (m)
 * Pleine jusqu'à 1 m, décroissance exponentielle (λ = 8 m), nulle au-delà de 25 m.
 */
export function vehicleDraftReduction(kind: VehicleKind, gapM: number, lateralM: number): number {
  const w = VEHICLE_WAKE[kind];
  if (gapM < 0 || gapM >= 25) return 0;
  let f = gapM <= 1 ? 1 : Math.exp(-(gapM - 1) / 8);
  if (gapM > 18) f *= 1 - smoothstep((gapM - 18) / 7);
  const a = Math.abs(lateralM);
  const inner = w.halfWidthM * 0.6;
  const outer = w.halfWidthM + 0.6 + 0.03 * gapM;
  const lat = a <= inner ? 1 : a >= outer ? 0 : 0.5 * (1 + Math.cos((Math.PI * (a - inner)) / (outer - inner)));
  return w.max * f * lat;
}
