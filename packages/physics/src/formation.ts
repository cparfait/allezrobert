/**
 * Forme du peloton des équipiers IA (sortie solo).
 *
 * Trois formes, choisies d'après la pratique des sorties de club :
 * - **file indienne** (`single`) : route étroite, vent de face fort, circulation ;
 * - **deux files tournantes** (`double`, « chaîne belge » à deux) : route assez large, peu de
 *   vent de côté. La file de gauche (rapide) remonte, celle de droite (lente) se laisse glisser ;
 *   le coureur qui arrive en tête de la file rapide se rabat dans la file lente, celui qui est
 *   dernier de la file lente passe dans la file rapide : les relais tournent sans arrêt ;
 * - **bordure** (`echelon`) : vent de côté marqué, chacun se décale sous le vent du précédent
 *   (voir `wakeShiftM`), le peloton forme un éventail en travers de la route.
 *
 * `auto` choisit selon la largeur de la route et le vent de côté. Module pur et déterministe.
 */
export type FormationPref = 'auto' | 'single' | 'double' | 'echelon';
export type Formation = 'single' | 'double' | 'echelon';

export const FORMATION_PREFS: readonly FormationPref[] = ['auto', 'single', 'double', 'echelon'];

/** Vent de côté (m/s) à partir duquel `auto` passe en bordure. */
export const ECHELON_CROSSWIND_MS = 4;
/** Largeur de route (m) minimale pour deux files de front. */
export const DOUBLE_MIN_ROAD_M = 5.5;
/** Nombre minimal d'équipiers pour deux files. */
export const DOUBLE_MIN_RIDERS = 3;

export interface FormationContext {
  roadWidthM: number;
  /** Vent de côté (m/s, signe quelconque). */
  crossWindMs: number;
  /** Nombre d'équipiers IA. */
  riders: number;
}

/** Forme effective : la demande si elle est possible, sinon la meilleure forme possible. */
export function resolveFormation(pref: FormationPref, c: FormationContext): Formation {
  const canDouble = c.roadWidthM >= DOUBLE_MIN_ROAD_M && c.riders >= DOUBLE_MIN_RIDERS;
  if (pref === 'single') return 'single';
  if (pref === 'echelon') return c.riders >= 2 ? 'echelon' : 'single';
  if (pref === 'double') return canDouble ? 'double' : 'single';
  if (Math.abs(c.crossWindMs) >= ECHELON_CROSSWIND_MS && c.riders >= 2) return 'echelon';
  return canDouble ? 'double' : 'single';
}

/** Décalages latéraux (m, + = droite) des deux files, pour une demi-largeur de route utile. */
export function laneOffsets(halfRoadM: number): { fast: number; slow: number } {
  const slow = Math.min(halfRoadM, 1.9);
  return { slow, fast: Math.max(-halfRoadM, slow - 1.5) };
}

/** Facteur d'allure des deux files : la rapide remonte, la lente se laisse glisser. */
export const LANE_PACE = { fast: 1.05, slow: 0.95 } as const;

export type Lane = 'fast' | 'slow';

export interface LaneRider {
  id: string;
  distM: number;
}

/**
 * Répartit les coureurs en deux files et fait tourner les relais : en tête de la file rapide on
 * se rabat dans la lente, en queue de la file lente on passe dans la rapide. Un coureur change
 * au plus une fois toutes les `minHoldS` secondes.
 */
export class LaneRotator {
  private readonly lanes = new Map<string, Lane>();
  private readonly held = new Map<string, number>();
  private clock = 0;

  constructor(
    /** Écart (m) en dessous duquel un coureur est « avec » un autre. */
    private readonly gapM = 14,
    private readonly minHoldS = 8,
  ) {}

  laneOf(id: string): Lane {
    return this.lanes.get(id) ?? 'slow';
  }

  /** Répartition initiale : un sur deux, par rang (0 = tête). */
  assign(riders: readonly LaneRider[]): void {
    const ordered = [...riders].sort((a, b) => b.distM - a.distM);
    this.lanes.clear();
    this.held.clear();
    ordered.forEach((r, i) => this.lanes.set(r.id, i % 2 === 0 ? 'fast' : 'slow'));
  }

  /**
   * @param riders les équipiers
   * @param others autres coureurs de la route (le joueur), pris en compte comme « devant » ou « derrière »
   */
  update(riders: readonly LaneRider[], others: readonly { distM: number }[], dt: number): void {
    this.clock += dt;
    for (const r of riders) if (!this.lanes.has(r.id)) this.lanes.set(r.id, 'slow');
    const everyone = [...riders.map((r) => r.distM), ...others.map((o) => o.distM)];
    const toSwap: Array<[string, Lane]> = [];
    for (const r of riders) {
      if (this.clock - (this.held.get(r.id) ?? -Infinity) < this.minHoldS) continue;
      const lane = this.laneOf(r.id);
      const inLane = riders.filter((o) => o.id !== r.id && this.laneOf(o.id) === lane);
      if (lane === 'fast') {
        // En tête de sa file ET du groupe : il a fini son relais, il se rabat.
        const ahead = inLane.some((o) => o.distM > r.distM) || everyone.some((d) => d > r.distM + 0.01 && d - r.distM < this.gapM * 2);
        if (!ahead) toSwap.push([r.id, 'slow']);
      } else {
        // Dernier de la file lente : il reprend la file rapide.
        const behind = inLane.some((o) => o.distM < r.distM);
        if (!behind) toSwap.push([r.id, 'fast']);
      }
    }
    for (const [id, lane] of toSwap) {
      this.lanes.set(id, lane);
      this.held.set(id, this.clock);
    }
  }
}
