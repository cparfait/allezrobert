/** Bruits déterministes côté CPU (placement de la végétation, monde procédural de secours). */

/** Générateur pseudo-aléatoire mulberry32, déterministe. */
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

/** Hachage entier 2D → [0, 1). */
export function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Bruit de valeur 2D lissé, dans [-1, 1]. */
export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  const u = fade(xf);
  const v = fade(yf);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** Bruit fractal (fBm). */
export function fbm(x: number, y: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * f + i * 17.3, y * f - i * 9.1);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

/** Test point-dans-polygone (pair-impair) sur un tableau plat x,z. */
export function pointInPolygon(x: number, z: number, pts: ArrayLike<number>): boolean {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2] as number;
    const zi = pts[i * 2 + 1] as number;
    const xj = pts[j * 2] as number;
    const zj = pts[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Aire signée d'un polygone plat x,z. */
export function polygonArea(pts: ArrayLike<number>): number {
  let a = 0;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += (pts[j * 2] as number) * (pts[i * 2 + 1] as number) - (pts[i * 2] as number) * (pts[j * 2 + 1] as number);
  }
  return a / 2;
}
