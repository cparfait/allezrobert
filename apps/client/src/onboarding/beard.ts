import type { Landmark } from './likenessFit.ts';

/**
 * Barbe d'après une photo (docs/AVATARS.md § 11) : le menton et le bas des joues sont comparés aux
 * joues rasées de la même photo. Une barbe assombrit la zone et la rend granuleuse (poils) ; ni
 * l'un ni l'autre ne dépend du teint ni de l'éclairage, puisque la référence vient de la photo.
 * Pure (aucun accès à l'image : les zones sont lues par l'appelant) pour être testée seule.
 */

export interface PatchStats {
  /** Luminance médiane (0-255). */
  lum: number;
  /** Granularité : écart moyen d'un pixel à la moyenne de son voisinage 5 × 5 (luminance). */
  tex: number;
}

/** Statistiques d'une zone de pixels RGBA. */
export function patchStats(data: Uint8ClampedArray, w: number, h: number): PatchStats {
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.2126 * (data[i * 4] as number) + 0.7152 * (data[i * 4 + 1] as number) + 0.0722 * (data[i * 4 + 2] as number);
  const sorted = Array.from(L).sort((a, b) => a - b);
  const lum = sorted[Math.floor(sorted.length / 2)] ?? 0;
  let sum = 0;
  let n = 0;
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      let m = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) m += L[(y + dy) * w + x + dx] as number;
      sum += Math.abs((L[y * w + x] as number) - m / 25);
      n++;
    }
  return { lum, tex: n ? sum / n : 0 };
}

/** Granularité minimale supposée d'une peau lisse : évite de diviser par le bruit d'une photo très douce. */
const TEX_FLOOR = 1;
/** Rapport de granularité (zone / joue) à partir duquel la zone est tenue pour poilue, et celui d'une barbe fournie. */
const TEX_NONE = 1.6;
const TEX_FULL = 4.5;
/** Assombrissement relatif (par rapport à la joue) d'une zone sans poils et d'une barbe fournie. */
const DARK_NONE = 0.04;
const DARK_FULL = 0.3;

/** Score brut en dessous duquel on tient le visage pour rasé, et au-dessus duquel la barbe est pleine. */
const FLOOR = 0.3;
const CEIL = 0.9;

const ramp = (v: number, lo: number, hi: number): number => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));

/**
 * Part de barbe (0 = rasé → 1 = barbe courte et fournie) : moyenne, sur les zones du bas du
 * visage, de la granularité et de l'assombrissement relatifs à la joue de référence.
 */
export function beardAmount(zones: readonly PatchStats[], cheek: PatchStats): number {
  if (!zones.length) return 0;
  const scores = zones.map((z) => {
    const tex = ramp(z.tex / Math.max(TEX_FLOOR, cheek.tex), TEX_NONE, TEX_FULL);
    const dark = ramp((cheek.lum - z.lum) / Math.max(1, cheek.lum), DARK_NONE, DARK_FULL);
    return 0.6 * tex + 0.4 * dark;
  });
  const v = scores.reduce((a, b) => a + b, 0) / scores.length;
  // Une peau rasée, mais ombrée sous la lèvre et le menton, garde un faible score : zone morte.
  return Math.round(ramp(v, FLOOR, CEIL) * 20) / 20;
}

/** Lecteur de pixels (ImageData) d'une image : `getImageData` d'un canvas. */
export interface PixelSource {
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number };
}

/** Rectangle en pixels : x, y, largeur, hauteur. */
export type Rect = [number, number, number, number];

/**
 * Zones du bas du visage (menton, entre la lèvre et le menton, bas des joues de chaque côté de la
 * bouche) et joues de référence, en pixels ; `null` si une zone sort de l'image.
 */
export function beardZones(lm: readonly Landmark[], W: number, H: number): { zones: Rect[]; cheeks: Rect[] } | null {
  const P = (i: number) => [(lm[i]?.x ?? 0.5) * W, (lm[i]?.y ?? 0.5) * H] as const;
  const iod = Math.hypot(P(33)[0] - P(263)[0], P(33)[1] - P(263)[1]);
  const mix = (a: readonly [number, number], b: readonly [number, number], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as const;
  const box = (c: readonly [number, number], hx: number, hy: number): Rect => [Math.round(c[0] - hx * iod), Math.round(c[1] - hy * iod), Math.round(2 * hx * iod), Math.round(2 * hy * iod)];
  const zones = [
    box(mix(P(14), P(152), 0.65), 0.22, 0.1),
    box(mix(P(172), P(61), 0.5), 0.15, 0.15),
    box(mix(P(397), P(291), 0.5), 0.15, 0.15),
  ];
  const cheeks = [box(P(50), 0.12, 0.12), box(P(280), 0.12, 0.12)];
  const all = [...zones, ...cheeks];
  if (all.some(([x, y, w, h]) => w < 8 || h < 8 || x < 0 || y < 0 || x + w > W || y + h > H)) return null;
  return { zones, cheeks };
}

/** Part de barbe d'une photo d'après ses repères (0 si les zones sortent de l'image). */
export function beardFromImage(src: PixelSource, lm: readonly Landmark[], W: number, H: number): number {
  const z = beardZones(lm, W, H);
  if (!z) return 0;
  const stats = ([x, y, w, h]: Rect): PatchStats => {
    const img = src.getImageData(x, y, w, h);
    const s = patchStats(img.data, img.width, img.height);
    img.data.fill(0);
    return s;
  };
  // Référence : la plus lisse des deux joues (sous les pommettes).
  const cheek = z.cheeks.map(stats).sort((a, b) => a.tex - b.tex)[0] as PatchStats;
  return beardAmount(z.zones.map(stats), cheek);
}
