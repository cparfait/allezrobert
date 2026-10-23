import * as THREE from 'three/webgpu';
import { float, mix, mx_noise_float, normalMap, pow, smoothstep, texture, uniform, uv, vec3 } from 'three/tsl';
import { colorUniform, type ColorUniform } from '../engine/tsl.ts';

/**
 * Peau de l'avatar MPFB (docs/AVATARS.md § 6), commune à tous les coureurs : deux textures
 * (tools/blender/avatars/build_avatar.py, bake_skin_textures) et des uniformes par coureur.
 *
 *  - skin_albedo : peau MakeHuman (CC0) divisée par sa teinte moyenne, × 0,5 (variations
 *    relatives : lèvres, sourcils, ombres), multipliée par le teint du coureur ;
 *  - skin_masks : R rougeur d'effort et sueur, G barbe, B rides (détail de la peau âgée ;
 *    0,5 = neutre), A taches de rousseur ;
 *  - skin_detail (facultative) : pores et ridules en mosaïque fine (avatars/bake_cloth.mjs), le
 *    grain qui manque à une texture de 1024 px vue de près.
 *
 * Lumière : diffusion sous la peau simulée (MeshSSSNodeMaterial : oreilles et nez rougeoient en
 * contre-jour), léger duvet (sheen), reflet moins brillant qu'un plastique.
 *
 * En sortie, la rougeur et la sueur suivent l'effort (SkinMaterial.update).
 */

export interface SkinTextures {
  albedo: THREE.Texture;
  masks: THREE.Texture;
  detail: THREE.Texture | null;
}

let textures: SkinTextures | null = null;

/** Charge les textures de peau (une fois) ; null si absentes. */
export async function loadSkinTextures(baseUrl: string): Promise<SkinTextures | null> {
  if (textures) return textures;
  try {
    const loader = new THREE.TextureLoader();
    const [albedo, masks, detail] = await Promise.all([
      loader.loadAsync(`${baseUrl}skin_albedo.webp`),
      loader.loadAsync(`${baseUrl}skin_masks.webp`),
      loader.loadAsync(`${baseUrl}skin_detail.webp`).catch(() => null),
    ]);
    for (const t of [albedo, masks, detail]) {
      if (!t) continue;
      t.colorSpace = THREE.NoColorSpace;
      t.flipY = false; // convention glTF
      t.anisotropy = 4;
    }
    if (detail) detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
    textures = { albedo, masks, detail };
  } catch (e) {
    console.warn('Textures de peau indisponibles', e);
  }
  return textures;
}

export function skinTextures(): SkinTextures | null {
  return textures;
}

/** Réglages de peau d'un coureur. */
export interface SkinLook {
  /** Teint (couleur de la tenue `skin`). */
  tone: string;
  /** 0 → 1 : rides (âge au-delà de la tête de base). */
  age: number;
  /** 0 → 1 : barbe naissante → courte. */
  beard: number;
  beardColor: string;
  /** 0 → 1 : taches de rousseur. */
  freckles: number;
}

export class SkinMaterial {
  readonly material: THREE.MeshSSSNodeMaterial;
  private readonly tone: ColorUniform;
  private readonly beardColor: ColorUniform;
  private readonly age = uniform(0);
  private readonly beard = uniform(0);
  private readonly freckles = uniform(0);
  private readonly flush = uniform(0);
  private readonly sweat = uniform(0);
  /** Sueur accumulée (0 → 1) : monte après quelques minutes au-dessus du seuil. */
  private sweatLevel = 0;

  constructor(tex: SkinTextures, look: SkinLook) {
    this.tone = colorUniform(look.tone);
    this.beardColor = colorUniform(look.beardColor);
    const m = new THREE.MeshSSSNodeMaterial({ roughness: 0.6, metalness: 0 });
    m.name = 'skin';
    const a = texture(tex.albedo, uv());
    const k = texture(tex.masks, uv());
    // Variations relatives (encodées en sRGB × 0,5) ramenées en linéaire.
    const rel = pow(a.rgb.mul(2), vec3(2.2));
    let col = this.tone.node.mul(rel);
    // Rides : le détail de la peau âgée assombrit ou éclaircit autour de 0,5.
    col = col.mul(mix(float(1), k.b.mul(2), this.age));
    // Taches de rousseur : brun plus foncé que le teint.
    col = mix(col, col.mul(vec3(0.62, 0.45, 0.36)), k.a.mul(this.freckles));
    // Barbe : poils en points fins (bruit), denses au centre de la zone.
    const hairs = smoothstep(0.1, 0.45, mx_noise_float(uv().mul(1400)).add(k.g.mul(0.35)));
    col = mix(col, this.beardColor.node, k.g.mul(this.beard).mul(hairs).mul(0.85));
    // Effort : rougeur des pommettes, du nez, des oreilles et du front.
    col = mix(col, col.mul(vec3(1.18, 0.72, 0.7)), k.r.mul(this.flush));
    m.colorNode = col;
    // Sueur : peau plus brillante sur les mêmes zones (et un peu partout).
    m.roughnessNode = mix(float(0.62), float(0.3), k.r.mul(0.7).add(0.3).mul(this.sweat));
    // Grain : pores et ridules (mosaïque de ~4 cm), plus marqués sur la peau âgée.
    if (tex.detail) m.normalNode = normalMap(texture(tex.detail, uv().mul(45)), vec3(0.35).add(this.age.mul(0.2)).xy);
    // Diffusion sous la peau : lumière rouge qui traverse les parties fines en contre-jour.
    m.thicknessColorNode = col.mul(vec3(0.6, 0.22, 0.16));
    m.thicknessDistortionNode = float(0.25);
    m.thicknessAmbientNode = float(0);
    m.thicknessAttenuationNode = float(0.25);
    m.thicknessPowerNode = float(4);
    m.thicknessScaleNode = float(1.2);
    // Duvet : voile clair et doux en lumière rasante.
    m.sheenNode = vec3(0.07, 0.06, 0.055);
    m.sheenRoughnessNode = float(0.6);
    m.specularIntensity = 0.7;
    this.material = m;
    this.setLook(look);
  }

  setLook(look: SkinLook): void {
    this.tone.set(look.tone);
    this.beardColor.set(look.beardColor);
    this.age.value = THREE.MathUtils.clamp(look.age, 0, 1);
    this.beard.value = THREE.MathUtils.clamp(look.beard, 0, 1);
    this.freckles.value = THREE.MathUtils.clamp(look.freckles, 0, 1);
  }

  /** Effort lissé (puissance / FTP) : rougeur immédiate, sueur accumulée. */
  update(dt: number, effort: number): void {
    this.flush.value = smoothstepJs(0.75, 1.3, effort) * 0.9;
    const target = effort > 0.85 ? 1 : 0;
    this.sweatLevel += (target - this.sweatLevel) * (1 - Math.exp(-dt / (target ? 300 : 600)));
    this.sweat.value = this.sweatLevel;
  }
}

function smoothstepJs(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
