/** Bruits et hasard déterministes de l'île (aucun Math.random : deux générations donnent le même monde). */

/** Générateur pseudo-aléatoire semé (mulberry32), valeurs dans [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(i: number, j: number, seed: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h;
}

const GRAD: Array<[number, number]> = Array.from({ length: 16 }, (_, k) => [Math.cos((k * Math.PI) / 8), Math.sin((k * Math.PI) / 8)]);
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Bruit de gradient 2D (type Perlin), environ dans [−1, 1]. */
export function noise2(x: number, z: number, seed = 0): number {
  const i = Math.floor(x);
  const j = Math.floor(z);
  const fx = x - i;
  const fz = z - j;
  const g = (a: number, b: number, dx: number, dz: number) => {
    const v = GRAD[hash(a, b, seed) & 15]!;
    return v[0] * dx + v[1] * dz;
  };
  const u = fade(fx);
  const v = fade(fz);
  const n00 = g(i, j, fx, fz);
  const n10 = g(i + 1, j, fx - 1, fz);
  const n01 = g(i, j + 1, fx, fz - 1);
  const n11 = g(i + 1, j + 1, fx - 1, fz - 1);
  return 1.41 * ((n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v);
}

/** Somme d'octaves (≈ [−1, 1]). */
export function fbm(x: number, z: number, octaves = 4, seed = 0): number {
  let v = 0;
  let a = 1;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    v += a * noise2(x * f + o * 17.3, z * f - o * 9.1, seed + o * 101);
    norm += a;
    a *= 0.5;
    f *= 2.03;
  }
  return v / norm;
}

/** Bruit « en crêtes » (≈ [0, 1]) : arêtes vives, pour les montagnes. */
export function ridged(x: number, z: number, octaves = 4, seed = 0): number {
  let v = 0;
  let a = 1;
  let f = 1;
  let norm = 0;
  let w = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise2(x * f + o * 31.7, z * f + o * 7.7, seed + o * 57));
    n *= n * w;
    w = Math.min(1, n * 1.6);
    v += a * n;
    norm += a;
    a *= 0.5;
    f *= 2.1;
  }
  return v / norm;
}

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
