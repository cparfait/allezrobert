import * as THREE from 'three/webgpu';
import { abs, dot, float, floor, materialColor, mix, normalMap, positionGeometry, step, texture, uniform, uv, vec3 } from 'three/tsl';
import type { AvatarLook } from '@allezrobert/shared';
import { colorUniform } from '../engine/tsl.ts';
import { jerseyPattern, jerseySleeveEdge, type JerseyFrame } from './jerseyPattern.ts';
import { registerLookSetter } from './texturedLook.ts';

/**
 * Tissu de la tenue de l'avatar MPFB (maillot, bande, cuissard, chaussettes) : deux cartes de
 * normales faites maison (tools/blender/avatars/bake_cloth.mjs) et un reflet de lycra (sheen).
 *
 *  - cloth_normal : plis de la pose de conduite, poches, fermeture éclair, ourlets et coutures,
 *    dans l'espace UV du corps (commune à tous les coureurs et à tous les LOD) ;
 *  - knit_normal : maille du tissu, en mosaïque fine (s'efface avec les mipmaps au loin).
 *
 * Styles de maillot (look.jerseyStyle) : « uni » = la bande de poitrine et les poignets de manche
 * prennent la couleur du maillot ; « bandes » = uni, plus les bandes de champion
 * (look.jerseyBands, de haut en bas) tracées dans le shader sur la poitrine, perpendiculairement
 * à l'axe du buste (JerseyAxis), sans toucher aux manches.
 */

/** Axe du buste au repos (repère du maillage) : origine = haut de la ceinture de poitrine. */
export interface JerseyAxis {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
}

/** Bandes de champion : décalage du centre (m) sur l'axe du buste, hauteur maximale d'une bande, nombre maximal. */
const BANDS_CENTER = 0.12;
const BAND_TOTAL = 0.15;
const BAND_MAX = 0.055;
const MAX_BANDS = 5;
/** Demi-largeur du torse (m) : au-delà, ce sont les manches, sans bandes. */
const TORSO_HALF = 0.2;
const clothSetters = new WeakMap<THREE.Material, (look: AvatarLook) => void>();

/** Couleur de tissu d'une tenue (maillot, bande selon le style). */
export function applyClothLook(m: THREE.Material, look: AvatarLook): void {
  clothSetters.get(m)?.(look);
}

export interface ClothTextures {
  folds: THREE.Texture;
  knit: THREE.Texture;
}

let textures: ClothTextures | null = null;

/** Charge les cartes du tissu (une fois) ; null si absentes. */
export async function loadClothTextures(baseUrl: string): Promise<ClothTextures | null> {
  if (textures) return textures;
  try {
    const loader = new THREE.TextureLoader();
    const [folds, knit] = await Promise.all([loader.loadAsync(`${baseUrl}cloth_normal.webp`), loader.loadAsync(`${baseUrl}knit_normal.webp`)]);
    for (const t of [folds, knit]) {
      t.colorSpace = THREE.NoColorSpace;
      t.flipY = false; // convention glTF
      t.anisotropy = 8;
    }
    knit.wrapS = knit.wrapT = THREE.RepeatWrapping;
    textures = { folds, knit };
  } catch (e) {
    console.warn('Textures du tissu indisponibles', e);
  }
  return textures;
}

export function clothTextures(): ClothTextures | null {
  return textures;
}

/** Réglages par pièce : rugosité, reflet de lycra, relief de la maille, plis. */
const CLOTH: Record<string, { roughness: number; sheen: number; knit: number; folds: number }> = {
  jersey: { roughness: 0.7, sheen: 0.3, knit: 0.18, folds: 1.1 },
  jersey_accent: { roughness: 0.7, sheen: 0.3, knit: 0.18, folds: 1.1 },
  // Lycra mat du cuissard : lisse, reflet doux et uniforme (plis légers, pas de brillance de vinyle).
  shorts: { roughness: 0.8, sheen: 0.12, knit: 0.06, folds: 0.4 },
  sock: { roughness: 0.8, sheen: 0.2, knit: 0.5, folds: 0 },
};

export const isClothPart = (name: string): boolean => name in CLOTH;

/** Matériau de tissu ; couleur par défaut, ensuite celle de la tenue (applyLookColor). */
export function makeClothMaterial(name: string, tex: ClothTextures, color: THREE.ColorRepresentation, axis?: JerseyAxis, frame?: JerseyFrame | null, look?: AvatarLook): THREE.MeshPhysicalNodeMaterial {
  const c = CLOTH[name] ?? { roughness: 0.6, sheen: 0.5, knit: 0.3, folds: 1 };
  const m = new THREE.MeshPhysicalNodeMaterial({ color, roughness: c.roughness, metalness: 0 });
  m.name = name;
  // Plis (espace tangent) + maille en mosaïque : mélange « whiteout » des deux reliefs.
  const folds = texture(tex.folds, uv()).rgb.mul(2).sub(1);
  const knit = texture(tex.knit, uv().mul(60)).rgb.mul(2).sub(1);
  const n = vec3(folds.xy.mul(c.folds).add(knit.xy.mul(c.knit)), folds.z).normalize();
  m.normalNode = normalMap(n.mul(0.5).add(0.5));
  // Reflet de lycra : voile clair de la couleur du tissu en lumière rasante.
  m.sheenNode = mix(materialColor.rgb, vec3(1), 0.25).mul(c.sheen);
  m.sheenRoughnessNode = float(0.45);
  // Tissu : reflet spéculaire faible (pas de vernis).
  m.specularIntensity = name === 'shorts' ? 0.2 : 0.35;
  // Maillot : pois, manches, moitié, dégradé, chevrons et logo (jerseyPattern.ts, repère du torse) ;
  // les bandes de champion ci-dessous se posent par-dessus.
  const pattern = name === 'jersey' && frame && look ? jerseyPattern(look, frame) : null;
  if (pattern) registerLookSetter(m, pattern.set);
  // Bande d'accent : sans liseré à la limite de la manche courte quand les manches sont longues.
  const edge = name === 'jersey_accent' && frame && look ? jerseySleeveEdge(look, frame) : null;
  if (edge) registerLookSetter(m, edge.set);
  const baseCol = (pattern ? pattern.color(materialColor.rgb) : edge ? mix(materialColor.rgb, edge.color, edge.weight) : materialColor.rgb) as THREE.Node<'vec3'>;
  if (pattern || edge) m.colorNode = baseCol;
  if (axis && (name === 'jersey' || name === 'jersey_accent')) {
    // Bandes de champion : de bas en haut dans le shader (la première est la plus basse).
    const nBands = uniform(0);
    const height = uniform(0.03);
    const from = uniform(BANDS_CENTER);
    const colors = Array.from({ length: MAX_BANDS }, () => colorUniform('#ffffff'));
    const s = dot(positionGeometry.sub(vec3(axis.origin)), vec3(axis.dir));
    const rel = s.sub(from).div(height);
    const idx = floor(rel);
    const inBand = step(0, rel).mul(step(rel, nBands)).mul(step(abs(positionGeometry.x), TORSO_HALF));
    let band: THREE.Node<'vec3'> = colors[0]!.node;
    for (let i = 1; i < MAX_BANDS; i++) band = mix(band, colors[i]!.node, step(i, idx));
    m.colorNode = mix(baseCol, band, inBand);
    clothSetters.set(m, (l) => {
      const b = l.jerseyStyle === 'bandes' ? (l.jerseyBands ?? []).slice(0, MAX_BANDS).reverse() : [];
      const h = b.length ? Math.min(BAND_MAX, BAND_TOTAL / b.length) : 0.03;
      nBands.value = b.length;
      height.value = h;
      from.value = BANDS_CENTER - (h * b.length) / 2;
      b.forEach((c, i) => colors[i]?.set(c));
    });
  }
  return m;
}
