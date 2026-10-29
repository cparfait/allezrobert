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

/**
 * Boîtes de décor d'une famille (scène LOD 0, repère du vélo = celui du cadre). Celle du diagonal commence au-dessus
 * du bidon du diagonal (« opt_bottle_down ») : la marque se lit en entier, du bidon jusqu'à la douille, comme sur les
 * vrais cadres (porte-bidon bas, logo au-dessus). `fit` faux : boîtes du modèle telles quelles (modèles dédiés,
 * déjà posées sur leurs tubes) ; `bottle` faux : vélo sans bidon sur le diagonal, toute la longueur reste.
 */
export function decalBoxes(scene: THREE.Object3D, fit = true, bottle = true): (DecalBox | null)[] {
  scene.updateMatrixWorld(true);
  return DECALS.map((name) => {
    const o = scene.getObjectByName(name);
    if (!o) return null;
    const pos = o.position.clone();
    const scale = o.scale.clone();
    const quat = o.quaternion.clone();
    // Marques des tubes : boîte recalée sur le tube réel (axe, pente, hauteur), sinon les lettres débordent du tube.
    if (fit && FIT.has(name)) fitToTube(scene, pos, quat, scale);
    if (fit && bottle && name === 'decal_dt') {
      const top = bottleTop(scene, new THREE.Matrix4().compose(pos, quat, scale).invert());
      // Bas de la boîte (y = −0,5) remonté au-dessus du bidon ; le haut ne bouge pas. Au plus 55 % de la longueur en moins.
      if (top !== null && top > -0.5) {
        const lo = Math.min(top + 0.03, 0.05);
        const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
        pos.addScaledVector(axis, ((lo + 0.5) / 2) * scale.y);
        scale.y *= (0.5 - lo);
      }
    }
    const m = new THREE.Matrix4().compose(pos, quat, scale);
    return { inverse: m.invert(), aspect: scale.y / Math.max(scale.z, 1e-4) };
  });
}

/** Boîtes recalées sur leur tube (la fourche, boîte à cheval sur les deux fourreaux, garde la sienne). */
const FIT = new Set(['decal_dt', 'decal_tt', 'decal_st', 'decal_cs', 'decal_ttf']);

/**
 * Recale une boîte de décor sur le tube du cadre qu'elle couvre : par tranches le long de la boîte, milieu et hauteur
 * du tube (sommets du cadre de part et d'autre de l'axe), puis droite des milieux → centre et pente ; hauteur de la
 * boîte : 95 % de la hauteur médiane du tube (lettres sur presque toute la hauteur, comme sur les vrais cadres).
 * Sans assez de mesures, la boîte reste telle quelle.
 */
function fitToTube(scene: THREE.Object3D, pos: THREE.Vector3, quat: THREE.Quaternion, scale: THREE.Vector3): void {
  const toBox = new THREE.Matrix4().compose(pos, quat, scale).invert();
  const BINS = 9;
  const lo = new Array<number>(BINS).fill(Infinity);
  const hi = new Array<number>(BINS).fill(-Infinity);
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh.material as THREE.Material | undefined)?.name !== 'frame') return;
    m.multiplyMatrices(toBox, mesh.matrixWorld);
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      if (Math.abs(v.y) > 0.36 || Math.abs(v.z) > 1.3 || Math.abs(v.x) > 0.6) continue;
      const b = Math.min(BINS - 1, Math.floor(((v.y + 0.36) / 0.72) * BINS));
      lo[b] = Math.min(lo[b] as number, v.z);
      hi[b] = Math.max(hi[b] as number, v.z);
    }
  });
  const ys: number[] = [];
  const mids: number[] = [];
  const hs: number[] = [];
  for (let b = 0; b < BINS; b++) {
    if (!Number.isFinite(lo[b] as number) || (hi[b] as number) - (lo[b] as number) < 0.2) continue;
    ys.push(-0.36 + ((b + 0.5) / BINS) * 0.72);
    mids.push(((lo[b] as number) + (hi[b] as number)) / 2);
    hs.push((hi[b] as number) - (lo[b] as number));
  }
  if (ys.length < 4) return;
  // Droite des milieux (moindres carrés), en mètres le long de la boîte et en travers.
  const n = ys.length;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const mz = mids.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += ((ys[i] as number) - my) * ((mids[i] as number) - mz);
    sxx += ((ys[i] as number) - my) ** 2;
  }
  const slope = sxx > 1e-9 ? sxy / sxx : 0;
  const z0 = mz - slope * my;
  const h = [...hs].sort((a, b) => a - b)[Math.floor(n / 2)] as number;
  const up = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
  pos.addScaledVector(up, z0 * scale.z);
  quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.atan2(slope * scale.z, scale.y)));
  scale.z *= THREE.MathUtils.clamp(h * 0.95, 0.7, 1.6);
}

/** Plus haute abscisse (repère unité de la boîte, le long du tube) du bidon du diagonal ; null sans bidon. */
function bottleTop(scene: THREE.Object3D, toBox: THREE.Matrix4): number | null {
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  let top: number | null = null;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !o.name.startsWith('opt_bottle_down')) return;
    m.multiplyMatrices(toBox, mesh.matrixWorld);
    const p = mesh.geometry.getAttribute('position');
    const idx = mesh.geometry.index;
    const n = idx ? idx.count : p.count;
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(p, idx ? idx.getX(k) : k).applyMatrix4(m);
      if (top === null || v.y > top) top = v.y;
    }
  });
  return top;
}
