import * as THREE from 'three/webgpu';
import { float, materialColor, mix, normalMap, texture, uv, vec3 } from 'three/tsl';

/**
 * Tissu de la tenue de l'avatar MPFB (maillot, bande, cuissard, chaussettes) : deux cartes de
 * normales faites maison (tools/blender/avatars/bake_cloth.mjs) et un reflet de lycra (sheen).
 *
 *  - cloth_normal : plis de la pose de conduite, poches, fermeture éclair, ourlets et coutures,
 *    dans l'espace UV du corps (commune à tous les coureurs et à tous les LOD) ;
 *  - knit_normal : maille du tissu, en mosaïque fine (s'efface avec les mipmaps au loin).
 */

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
  jersey: { roughness: 0.62, sheen: 0.35, knit: 0.35, folds: 1.7 },
  jersey_accent: { roughness: 0.62, sheen: 0.35, knit: 0.35, folds: 1.7 },
  // Lycra du cuissard : plus lisse, reflet gris doux en lumière rasante, maille plus fine.
  shorts: { roughness: 0.5, sheen: 0.22, knit: 0.2, folds: 1 },
  sock: { roughness: 0.8, sheen: 0.2, knit: 0.5, folds: 0 },
};

export const isClothPart = (name: string): boolean => name in CLOTH;

/** Matériau de tissu ; couleur par défaut, ensuite celle de la tenue (applyLookColor). */
export function makeClothMaterial(name: string, tex: ClothTextures, color: THREE.ColorRepresentation): THREE.MeshPhysicalNodeMaterial {
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
  m.specularIntensity = 0.5;
  return m;
}
