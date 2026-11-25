import * as THREE from 'three/webgpu';
import { abs, float, fract, max, min, mix, smoothstep, texture, uniform } from 'three/tsl';

/**
 * Peinture des véhicules réalistes (traffic.ts) : plusieurs teintes par modèle, celles qu'on croise sur les routes
 * françaises (blanc, gris et noirs surtout, puis bleus, rouges et quelques teintes vives). Les carrosseries d'origine
 * étaient en métal pur : sans ciel à refléter, elles viraient au noir ou à une couleur sale.
 */

const C = {
  white: '#e8e8e4',
  silver: '#b3b7ba',
  grey: '#7c8085',
  anthracite: '#404449',
  black: '#1b1c1e',
  navy: '#24385a',
  blue: '#3d6ea5',
  sky: '#8fb4cf',
  red: '#a52a28',
  burgundy: '#5f2026',
  green: '#3d5f4b',
  sand: '#c7bb9f',
  bronze: '#8a6f4d',
  orange: '#cc6a2c',
  yellow: '#e2bb3c',
} as const;

/** Teintes de chaque modèle, avec leur fréquence. */
const PALETTES: Record<string, ReadonlyArray<readonly [string, number]>> = {
  citadine: [[C.white, 4], [C.silver, 2], [C.anthracite, 2], [C.sky, 2], [C.red, 2], [C.yellow, 1.5], [C.orange, 1]],
  berline: [[C.grey, 3], [C.black, 3], [C.silver, 3], [C.white, 2], [C.navy, 2.5], [C.burgundy, 1]],
  suv: [[C.white, 3], [C.anthracite, 3], [C.grey, 2], [C.blue, 2], [C.sand, 1.5], [C.green, 1], [C.bronze, 1]],
  'porsche-911': [[C.silver, 3], [C.red, 2], [C.black, 2], [C.blue, 1.5], [C.white, 1.5], [C.yellow, 1]],
  'nissan-silvia': [[C.white, 2], [C.blue, 2], [C.red, 2], [C.silver, 2], [C.black, 1]],
  'bmw-733i': [[C.silver, 3], [C.navy, 2], [C.burgundy, 2], [C.bronze, 1.5], [C.green, 1], [C.white, 1]],
  // Vitres peintes dans la même texture, claire : la teinte la multiplie, donc seulement des teintes claires.
  'mercedes-c230': [['#ffffff', 2], ['#c9cdd1', 3], ['#a9bccd', 1.5], ['#d9ccb2', 1.5], ['#9aa0a6', 2]],
  'lamborghini-aventador': [[C.orange, 2], [C.yellow, 2], [C.white, 2], [C.anthracite, 2], [C.green, 1]],
  'mclaren-720s': [[C.orange, 3], [C.blue, 2], [C.white, 2], [C.grey, 2]],
  utilitaire: [[C.white, 6], [C.yellow, 2], [C.sky, 1.5], [C.grey, 1.5], [C.red, 1]],
};
const COMMON: ReadonlyArray<readonly [string, number]> = [[C.white, 3], [C.silver, 3], [C.grey, 2], [C.black, 2], [C.navy, 2], [C.red, 1]];

/** Teintes possibles d'un modèle. */
export function paintsOf(file: string): string[] {
  return (PALETTES[file] ?? COMMON).map(([c]) => c);
}

/** Teinte tirée selon les fréquences du modèle ; jamais une de `taken` (teintes déjà en circulation) s'il en reste. */
export function pickPaint(file: string, rand: () => number, taken: ReadonlySet<string> = new Set()): string {
  const all = PALETTES[file] ?? COMMON;
  const free = all.filter(([c]) => !taken.has(c));
  const list = free.length ? free : all;
  let x = rand() * list.reduce((s, [, w]) => s + w, 0);
  return (list.find(([, w]) => (x -= w) < 0) ?? (list[0] as readonly [string, number]))[0];
}

/**
 * Carrosseries dont la couleur est dans la texture : teinte d'origine (0–1, cercle chromatique) à remplacer ; le reste
 * de la texture (chromes, joints, plaques) est gardé.
 */
const TEXTURE_HUE: Record<string, number> = { 'bmw-733i': 0.99, 'mclaren-720s': 0.02, utilitaire: 0.12 };

/** Matériau de carrosserie à la teinte voulue. */
export function paintedMaterial(file: string, src: THREE.Material, color: string): THREE.Material {
  const std = src as THREE.MeshStandardMaterial;
  // Vieux tracteur rouillé : sa peinture écaillée est dans la texture, elle reste telle quelle.
  if (file === 'tractor') return src;
  const hue = TEXTURE_HUE[file];
  if (std.map && hue !== undefined) {
    const m = new THREE.MeshStandardNodeMaterial();
    m.name = std.name;
    m.map = std.map;
    m.normalMap = std.normalMap;
    m.roughnessMap = std.roughnessMap;
    m.side = std.side;
    m.roughness = std.roughnessMap ? std.roughness : 0.42;
    m.metalness = 0.1;
    m.envMapIntensity = std.envMapIntensity;
    const t = texture(std.map).rgb;
    const hi = max(t.r, max(t.g, t.b));
    const lo = min(t.r, min(t.g, t.b));
    const span = max(hi.sub(lo), 1e-4);
    // Teinte du texel, puis part de carrosserie : proche de la teinte d'origine et assez saturée.
    const h = mix(mix(t.r.sub(t.g).div(span).add(4), t.b.sub(t.r).div(span).add(2), t.g.greaterThanEqual(t.b).select(float(1), float(0))), t.g.sub(t.b).div(span), t.r.greaterThanEqual(max(t.g, t.b)).select(float(1), float(0))).div(6);
    const gap = abs(fract(h.sub(hue).add(0.5)).sub(0.5));
    const sat = hi.sub(lo).div(max(hi, 1e-4));
    const body = smoothstep(0.1, 0.05, gap).mul(smoothstep(0.18, 0.38, sat));
    const c = new THREE.Color(color);
    const paint = uniform(new THREE.Vector3(c.r, c.g, c.b));
    // Ombrage de la texture gardé (joints, arêtes), ramené autour de 1.
    const shade = smoothstep(0, 1, hi.mul(1.6)).mul(0.5).add(0.55);
    m.colorNode = mix(t, paint.mul(shade), body);
    return m;
  }
  const m = std.clone();
  m.color.set(color);
  // Vernis automobile : couleur franche, reflets du ciel par-dessus, jamais du métal nu.
  m.metalness = Math.min(m.metalness, 0.25);
  m.roughness = Math.min(Math.max(m.roughness, 0.28), 0.45);
  return m;
}
