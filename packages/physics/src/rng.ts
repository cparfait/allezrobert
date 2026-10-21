/**
 * Générateur pseudo-aléatoire déterministe (mulberry32) : même graine ⇒ même suite,
 * sur navigateur comme sur serveur. L'état (`state`) est sérialisable.
 */
export class SeededRng {
  state: number;

  constructor(seed: number | string = 1) {
    this.state = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  }

  /** Flottant uniforme dans [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Flottant uniforme dans [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Entier uniforme dans [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Vrai avec la probabilité p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Loi normale centrée réduite (Box-Muller). */
  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Nouveau générateur indépendant dérivé de celui-ci. */
  fork(): SeededRng {
    return new SeededRng((this.next() * 4294967296) >>> 0);
  }
}

/** Hachage FNV-1a 32 bits d'une chaîne (graine depuis un identifiant). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
