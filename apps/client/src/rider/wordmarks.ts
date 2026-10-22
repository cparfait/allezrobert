import * as THREE from 'three/webgpu';
import { BIKE_BRANDS, BIKE_TEAMS, type BikeBuild } from '@allezrobert/shared';

/**
 * Décors des cadres : mots-symboles de la marque et de l'équipe, dessinés une fois par vélo sur
 * un canevas, puis projetés sur les tubes par le shader de livrée (livery.ts) dans les boîtes
 * decal_* des familles (tools/blender/bike_families.py).
 *
 * Repère d'une boîte (glTF) : +Y le long du tube (sens de lecture), −Z vers le haut du texte,
 * X latéral ; échelle = (épaisseur latérale, longueur, hauteur).
 */

/** Boîtes de décor dans l'ordre des lignes de la texture. */
export const DECALS = ['decal_dt', 'decal_tt', 'decal_st', 'decal_fork'] as const;
const ROW_W = 1024;
const ROW_H = 128;

const FONTS: Record<string, string> = {
  serif: '700 {px}px Georgia, "Times New Roman", serif',
  'sans-bold': '900 {px}px "Arial Black", "Helvetica Neue", Arial, sans-serif',
  'sans-italic': 'italic 900 {px}px "Arial Black", "Helvetica Neue", Arial, sans-serif',
  script: 'italic 700 {px}px "Brush Script MT", "Segoe Script", "Comic Sans MS", cursive',
};

export interface DecalBox {
  /** Monde du cadre → boîte unité (|x|, |y|, |z| ≤ 0,5). */
  inverse: THREE.Matrix4;
  /** Longueur / hauteur de la boîte. */
  aspect: number;
}

/** Textes de chaque boîte : diagonal = marque, horizontal = équipe (sinon marque), tube de selle et fourche = marque. */
function texts(build: BikeBuild & { brand?: string; group?: string }): string[] | null {
  const brand = BIKE_BRANDS.find((b) => b.id === build.brand);
  if (!brand) return null;
  const team = BIKE_TEAMS.find((t) => t.id === build.group);
  return [brand.wordmark, team?.wordmark ?? brand.wordmark, brand.wordmark, brand.wordmark];
}

const cache = new Map<string, THREE.CanvasTexture>();

/**
 * Texture des mots-symboles (alpha = texte) d'un vélo de marque, ou null (vélo sans marque).
 * Une ligne de 1024 × 128 par boîte ; les lettres sont élargies ou resserrées pour garder leurs
 * proportions une fois étirées sur la boîte.
 */
export function wordmarkTexture(build: BikeBuild & { brand?: string; group?: string }, boxes: readonly (DecalBox | null)[]): THREE.CanvasTexture | null {
  const t = texts(build);
  if (!t || typeof document === 'undefined') return null;
  const font = FONTS[BIKE_BRANDS.find((b) => b.id === build.brand)?.font ?? ''] ?? (FONTS['sans-bold'] as string);
  const key = `${t.join('|')}|${font}|${boxes.map((b) => b?.aspect.toFixed(2) ?? '-').join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = ROW_W;
  cv.height = ROW_H * DECALS.length;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  t.forEach((text, i) => {
    const box = boxes[i];
    if (!box) return;
    // Étirement horizontal qui compense le rapport de la ligne (8:1) à celui de la boîte.
    const k = ROW_W / ROW_H / box.aspect;
    let px = ROW_H * 0.92;
    g.font = font.replace('{px}', String(px));
    const w = g.measureText(text).width * k;
    if (w > ROW_W * 0.96) {
      px *= (ROW_W * 0.96) / w;
      g.font = font.replace('{px}', px.toFixed(1));
    }
    g.save();
    g.translate(ROW_W / 2, ROW_H * (i + 0.5));
    g.scale(k, 1);
    g.fillText(text, 0, 0);
    g.restore();
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  cache.set(key, tex);
  return tex;
}

/** Boîtes de décor d'une famille (scène LOD 0, repère du vélo = celui du cadre). */
export function decalBoxes(scene: THREE.Object3D): (DecalBox | null)[] {
  scene.updateMatrixWorld(true);
  return DECALS.map((name) => {
    const o = scene.getObjectByName(name);
    if (!o) return null;
    const m = new THREE.Matrix4().compose(o.position, o.quaternion, o.scale);
    return { inverse: m.invert(), aspect: o.scale.y / Math.max(o.scale.z, 1e-4) };
  });
}
