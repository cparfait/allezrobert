/**
 * Indicateurs d'entraînement : W′ balance (Skiba), puissance normalisée (Coggan), IF, TSS,
 * courbe de puissance, puissance critique et estimation de FTP (test rampe, test 20 min).
 * Les séries de puissance sont supposées échantillonnées à pas constant (1 Hz par défaut).
 */

/**
 * W′ balance en temps réel, forme différentielle de Skiba et al. (2015) :
 *   P > CP : dW′/dt = −(P − CP)
 *   P ≤ CP : dW′/dt = (W′₀ − W′bal) · (CP − P) / W′₀
 * Résolue exactement sur le pas (exponentielle) pour rester stable à 1 Hz comme à 60 Hz.
 */
export class WPrimeBalance {
  readonly cp: number;
  readonly wPrime: number;
  /** Réserve courante (J). */
  balance: number;
  /** Plus bas atteint (J). */
  minBalance: number;

  constructor(cpWatts: number, wPrimeJ: number, initial = wPrimeJ) {
    this.cp = cpWatts;
    this.wPrime = wPrimeJ;
    this.balance = initial;
    this.minBalance = initial;
  }

  update(watts: number, dt: number): number {
    if (watts > this.cp) {
      this.balance -= (watts - this.cp) * dt;
    } else {
      const deficit = this.wPrime - this.balance;
      this.balance = this.wPrime - deficit * Math.exp((-(this.cp - watts) * dt) / this.wPrime);
    }
    if (this.balance < this.minBalance) this.minBalance = this.balance;
    return this.balance;
  }

  /** Fraction restante (peut être < 0 si le modèle est dépassé). */
  get fraction(): number {
    return this.balance / this.wPrime;
  }

  reset(): void {
    this.balance = this.wPrime;
    this.minBalance = this.wPrime;
  }
}

/** Série W′bal (forme différentielle) pour une série de puissances. */
export function wPrimeBalanceSeries(watts: ArrayLike<number>, cpWatts: number, wPrimeJ: number, dt = 1): Float64Array {
  const w = new WPrimeBalance(cpWatts, wPrimeJ);
  const out = new Float64Array(watts.length);
  for (let i = 0; i < watts.length; i++) out[i] = w.update(watts[i]!, dt);
  return out;
}

/**
 * Puissance normalisée (Coggan) : moyenne glissante 30 s, puissance 4, moyenne, racine 4.
 * Pendant les 30 premières secondes, la moyenne glissante porte sur les échantillons
 * disponibles. Renvoie 0 pour une série vide.
 */
export function normalizedPower(watts: ArrayLike<number>, sampleRateHz = 1): number {
  const acc = new NormalizedPowerAccumulator(sampleRateHz);
  for (let i = 0; i < watts.length; i++) acc.add(watts[i]!);
  return acc.value;
}

/** Puissance normalisée en flux (HUD en direct), mémoire O(fenêtre). */
export class NormalizedPowerAccumulator {
  private readonly win: Float64Array;
  private idx = 0;
  private filled = 0;
  private sum = 0;
  private sum4 = 0;
  private n = 0;

  constructor(sampleRateHz = 1, windowS = 30) {
    this.win = new Float64Array(Math.max(1, Math.round(windowS * sampleRateHz)));
  }

  add(watts: number): void {
    const w = Math.max(0, watts);
    if (this.filled === this.win.length) this.sum -= this.win[this.idx]!;
    else this.filled++;
    this.win[this.idx] = w;
    this.sum += w;
    this.idx = (this.idx + 1) % this.win.length;
    const avg = this.sum / this.filled;
    this.sum4 += avg * avg * avg * avg;
    this.n++;
  }

  get value(): number {
    return this.n === 0 ? 0 : Math.pow(this.sum4 / this.n, 0.25);
  }
}

/** Facteur d'intensité IF = NP / FTP. */
export function intensityFactor(np: number, ftpWatts: number): number {
  return ftpWatts > 0 ? np / ftpWatts : 0;
}

/** Training Stress Score : TSS = durée(s) · NP · IF / (FTP · 3600) · 100. */
export function trainingStressScore(durationS: number, np: number, ftpWatts: number): number {
  if (ftpWatts <= 0) return 0;
  return ((durationS * np * intensityFactor(np, ftpWatts)) / (ftpWatts * 3600)) * 100;
}

/** Moyenne arithmétique. */
export function averagePower(watts: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < watts.length; i++) s += watts[i]!;
  return watts.length ? s / watts.length : 0;
}

/** Travail (J) : Σ P · dt. */
export function workJoules(watts: ArrayLike<number>, dt = 1): number {
  let s = 0;
  for (let i = 0; i < watts.length; i++) s += Math.max(0, watts[i]!) * dt;
  return s;
}

/**
 * Calories métaboliques (kcal) depuis le travail mécanique, rendement brut ~24 % :
 * kcal = J / (4184 · 0,24) ≈ kJ (approximation usuelle des compteurs).
 */
export function caloriesFromWork(workJ: number, grossEfficiency = 0.24): number {
  return workJ / (4184 * grossEfficiency);
}

/** Meilleure puissance moyenne sur une durée (fenêtre glissante O(n)). 0 si trop court. */
export function meanMaxPower(watts: ArrayLike<number>, durationS: number, sampleRateHz = 1): number {
  const n = Math.round(durationS * sampleRateHz);
  if (n <= 0 || watts.length < n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += watts[i]!;
  let best = s;
  for (let i = n; i < watts.length; i++) {
    s += watts[i]! - watts[i - n]!;
    if (s > best) best = s;
  }
  return best / n;
}

/** Durées standard de la courbe de puissance (s). */
export const POWER_CURVE_DURATIONS = [1, 5, 10, 15, 30, 60, 120, 180, 300, 600, 1200, 1800, 3600] as const;

export interface PowerCurvePoint {
  durationS: number;
  watts: number;
}

/** Courbe de puissance (meilleures moyennes) aux durées demandées. */
export function powerCurve(
  watts: ArrayLike<number>,
  durations: readonly number[] = POWER_CURVE_DURATIONS,
  sampleRateHz = 1,
): PowerCurvePoint[] {
  const out: PowerCurvePoint[] = [];
  for (const d of durations) {
    const w = meanMaxPower(watts, d, sampleRateHz);
    if (w > 0) out.push({ durationS: d, watts: w });
  }
  return out;
}

export interface CriticalPowerFit {
  cp: number;
  wPrime: number;
  /** Coefficient de détermination de la régression travail–temps. */
  r2: number;
}

/**
 * Puissance critique par le modèle linéaire travail–temps (Monod & Scherrer) :
 * W = CP · t + W′, moindres carrés sur des efforts maximaux de 2 à 20 min idéalement.
 */
export function fitCriticalPower(points: readonly PowerCurvePoint[]): CriticalPowerFit {
  const n = points.length;
  if (n < 2) throw new Error('fitCriticalPower : au moins deux efforts sont nécessaires');
  let st = 0;
  let sw = 0;
  let stt = 0;
  let stw = 0;
  let sww = 0;
  for (const p of points) {
    const t = p.durationS;
    const w = p.watts * t;
    st += t;
    sw += w;
    stt += t * t;
    stw += t * w;
    sww += w * w;
  }
  const den = n * stt - st * st;
  const cp = (n * stw - st * sw) / den;
  const wPrime = (sw - cp * st) / n;
  const ssTot = sww - (sw * sw) / n;
  let ssRes = 0;
  for (const p of points) {
    const e = p.watts * p.durationS - (cp * p.durationS + wPrime);
    ssRes += e * e;
  }
  return { cp, wPrime, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1 };
}

/** FTP depuis un test de 20 min : 95 % de la meilleure moyenne sur 20 min. */
export function ftpFrom20MinTest(watts: ArrayLike<number>, sampleRateHz = 1): number {
  return Math.round(0.95 * meanMaxPower(watts, 1200, sampleRateHz));
}

/** FTP depuis un test rampe : 75 % de la meilleure minute (protocole usuel des applis). */
export function ftpFromRampTest(watts: ArrayLike<number>, sampleRateHz = 1): number {
  return Math.round(0.75 * meanMaxPower(watts, 60, sampleRateHz));
}

/** Estimation W′ par défaut quand on ne dispose que de la FTP (~ 20 kJ, borné). */
export function defaultWPrime(ftpWatts: number): number {
  return Math.min(Math.max(ftpWatts * 75, 12000), 30000);
}
