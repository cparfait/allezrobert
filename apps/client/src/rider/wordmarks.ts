import * as THREE from 'three/webgpu';
import { BIKE_BRANDS, type BikeBuild, type FrameMark } from '@allezrobert/shared';

/**
 * Inscriptions des cadres, comme sur le vrai vélo (livery.marks ; par défaut la marque sur le
 * diagonal seulement), dessinées une fois par vélo sur
 * un canevas, puis projetés sur les tubes par le shader de livrée (livery.ts) dans les boîtes
 * decal_* des familles (tools/blender/bike_families.py).
 *
 * Repère d'une boîte (glTF) : +Y le long du tube (sens de lecture), −Z vers le haut du texte,
 * X latéral ; échelle = (épaisseur latérale, longueur, hauteur).
 */

/** Emplacements et boîtes de décor, dans l'ordre des lignes de la texture (« ttf » : seulement les modèles qui ont sa boîte). */
export const MARKS: readonly FrameMark[] = ['dt', 'tt', 'st', 'fork', 'cs', 'ttf'];
export const DECALS = MARKS.map((m) => `decal_${m}`);
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

export type Mark = { text: string; color?: string; stretch?: number } | null;

/** Inscription de chaque emplacement (null : rien) ; vélo sans marque : aucune. */
export function frameMarks(build: BikeBuild): Mark[] {
  const brand = BIKE_BRANDS.find((b) => b.id === build.brand);
  if (!brand) return MARKS.map(() => null);
  const marks = build.livery.marks ?? { dt: { text: brand.wordmark } };
  return MARKS.map((m) => marks[m] ?? null);
}

const cache = new Map<string, THREE.CanvasTexture>();

/**
 * Texture des inscriptions (alpha = texte) d'un vélo, ou null (aucune inscription).
 * Une ligne de 1024 × 128 par boîte ; les lettres sont élargies ou resserrées pour garder leurs
 * proportions une fois étirées sur la boîte.
 */
export function wordmarkTexture(build: BikeBuild, boxes: readonly (DecalBox | null)[]): THREE.CanvasTexture | null {
  const marks = frameMarks(build);
  const t = marks.map((m) => m?.text ?? '');
  if (!t.some(Boolean) || typeof document === 'undefined') return null;
  const font = FONTS[BIKE_BRANDS.find((b) => b.id === build.brand)?.font ?? ''] ?? (FONTS['sans-bold'] as string);
  const key = `${t.join('|')}|${marks.map((m) => m?.stretch ?? 1).join(',')}|${font}|${boxes.map((b) => b?.aspect.toFixed(2) ?? '-').join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = ROW_W;
  cv.height = ROW_H * DECALS.length;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  // Ligne de base alphabétique : les mesures (ascendante, descendante) servent au cadrage.
  g.textBaseline = 'alphabetic';
  t.forEach((text, i) => {
    const box = boxes[i];
    if (!box || !text) return;
    // Étirement horizontal qui compense le rapport de la ligne (8:1) à celui de la boîte.
    const k = (ROW_W / ROW_H / box.aspect) * (marks[i]?.stretch ?? 1);
    // Taille par la hauteur réelle des lettres (capitales ≈ 90 % de la ligne), puis par la longueur.
    let px = ROW_H;
    g.font = font.replace('{px}', String(px));
    let m = g.measureText(text);
    const glyphH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent || px * 0.72;
    px *= (ROW_H * 0.9) / glyphH;
    g.font = font.replace('{px}', px.toFixed(1));
    m = g.measureText(text);
    if (m.width * k > ROW_W * 0.96) {
      px *= (ROW_W * 0.96) / (m.width * k);
      g.font = font.replace('{px}', px.toFixed(1));
      m = g.measureText(text);
    }
    // Centrage sur la boîte englobante réelle des lettres.
    const dy = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    g.save();
    g.translate(ROW_W / 2, ROW_H * (i + 0.5) + dy);
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
