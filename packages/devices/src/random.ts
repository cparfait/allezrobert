/** Générateur pseudo-aléatoire déterministe (mulberry32) pour le simulateur. */
export class SeededRandom {
  private state: number;

  constructor(seed = 0x5eed) {
    this.state = seed >>> 0;
  }

  /** Uniforme dans [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Loi normale centrée réduite (Box-Muller). */
  gaussian(): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  normal(mean: number, sd: number): number {
    return mean + sd * this.gaussian();
  }
}
