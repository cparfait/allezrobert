/**
 * Contrôle simple de la puissance déclarée par un coureur (règles anti-triche côté serveur).
 *
 * Le serveur ne voit que la puissance envoyée par le jeu : il ne peut pas prouver une triche,
 * mais il peut refuser l'invraisemblable. Trois règles, appliquées à chaque tick (10 Hz) :
 *  1. **Pics isolés** : un saut brutal d'un seul paquet est ignoré (un pic de capteur
 *     disparaît, une vraie accélération passe avec 100 ms de retard) ;
 *  2. **Plafond instantané** : 30 W/kg ;
 *  3. **Records du monde** : moyennes glissantes 5 s / 1 min / 5 min / 20 min comparées à des
 *     plafonds en W/kg au-dessus des meilleures performances humaines. Au-delà, la puissance
 *     acceptée est plafonnée (la physique ne profite pas de l'excès) et le temps en infraction
 *     est cumulé ; l'appelant décide (avertissement, mise hors course en compétition).
 *
 * Indépendant de la FTP déclarée (qu'un tricheur pourrait gonfler) : seule la masse compte,
 * et elle sert aussi à la physique (une masse sous-déclarée rend le coureur plus rapide en côte
 * mais abaisse d'autant le plafond en watts).
 */

export interface PowerLimit {
  /** Fenêtre de la moyenne glissante (s). */
  windowS: number;
  /** Plafond (W/kg) au-dessus duquel la moyenne est jugée invraisemblable. */
  maxWkg: number;
}

/** Plafonds : environ 10 à 20 % au-dessus des records humains connus pour chaque durée. */
export const POWER_LIMITS: readonly PowerLimit[] = [
  { windowS: 5, maxWkg: 25 },
  { windowS: 60, maxWkg: 12 },
  { windowS: 300, maxWkg: 7.8 },
  { windowS: 1200, maxWkg: 6.8 },
];
export const MAX_INSTANT_WKG = 30;

export interface PowerGuardResult {
  /** Puissance retenue pour la physique (W). */
  watts: number;
  /** La puissance a été plafonnée pendant ce pas. */
  capped: boolean;
  /** Fenêtre en infraction (s), si plafonnée par une moyenne. */
  windowS?: number;
}

class Window {
  readonly buf: Float64Array;
  sum = 0;
  idx = 0;
  filled = 0;
  constructor(
    readonly size: number,
    readonly limitW: number,
    readonly windowS: number,
  ) {
    this.buf = new Float64Array(size);
  }
  /**
   * Moyenne si l'on ajoutait `w` (sans l'ajouter). Fenêtre incomplète : moyenne sur la fenêtre
   * entière (les secondes manquantes comptent 0 W), pour ne pas juger 5 min sur 10 s de données.
   */
  meanWith(w: number): number {
    const out = this.filled === this.size ? this.buf[this.idx]! : 0;
    return (this.sum - out + w) / this.size;
  }
  /** Puissance maximale admissible pour que la moyenne reste sous le plafond. */
  maxAdmissible(): number {
    const out = this.filled === this.size ? this.buf[this.idx]! : 0;
    return this.limitW * this.size - (this.sum - out);
  }
  push(w: number): void {
    const out = this.filled === this.size ? this.buf[this.idx]! : 0;
    this.sum += w - out;
    this.buf[this.idx] = w;
    this.idx = (this.idx + 1) % this.size;
    if (this.filled < this.size) this.filled++;
  }
}

export class PowerGuard {
  readonly massKg: number;
  /** Temps cumulé (s) avec une moyenne au-dessus d'un plafond. */
  violationS = 0;
  /** Nombre de pics isolés écartés par le filtre médian. */
  spikes = 0;
  private readonly windows: Window[];
  /** [dernière puissance retenue, dernier échantillon brut]. */
  private readonly last = [0, 0];

  constructor(massKg: number, opts: { hz?: number; limits?: readonly PowerLimit[] } = {}) {
    this.massKg = Math.max(30, massKg);
    const hz = opts.hz ?? 10;
    this.windows = (opts.limits ?? POWER_LIMITS).map((l) => new Window(Math.max(1, Math.round(l.windowS * hz)), l.maxWkg * this.massKg, l.windowS));
  }

  /** Filtre un échantillon (un appel par tick, `dt` en s) et renvoie la puissance retenue. */
  filter(rawWatts: number, dt: number): PowerGuardResult {
    const raw = Number.isFinite(rawWatts) ? Math.max(0, rawWatts) : 0;
    // 1. Pic isolé : saut brutal par rapport au précédent ⇒ on garde la valeur précédente
    //    pendant un tick ; s'il se confirme au paquet suivant, c'est une vraie accélération.
    const prevRaw = this.last[1]!;
    const prevOut = this.last[0]!;
    const jump = raw > prevOut + 400 && raw > 3 * Math.max(prevOut, 60);
    const confirmed = prevRaw > prevOut + 400 && raw >= prevRaw * 0.6;
    const filtered = jump && !confirmed ? prevOut : raw;
    if (jump && !confirmed) this.spikes++;
    this.last[1] = raw;
    // 2. Plafond instantané.
    let w = Math.min(filtered, MAX_INSTANT_WKG * this.massKg);
    let capped = w < filtered;
    let windowS: number | undefined;
    // 3. Moyennes glissantes : la plus contraignante l'emporte.
    for (const win of this.windows) {
      if (win.meanWith(w) > win.limitW) {
        w = Math.max(0, Math.min(w, win.maxAdmissible()));
        capped = true;
        windowS ??= win.windowS;
      }
    }
    if (windowS !== undefined) this.violationS += dt;
    for (const win of this.windows) win.push(w);
    this.last[0] = w;
    const res: PowerGuardResult = { watts: w, capped };
    if (windowS !== undefined) res.windowS = windowS;
    return res;
  }
}
