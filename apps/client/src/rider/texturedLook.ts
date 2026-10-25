import * as THREE from 'three/webgpu';
import { abs, attribute, clamp, dot, float, floor, max, mix, smoothstep, step, texture, uniform, uv, vec3 } from 'three/tsl';
import type { AvatarLook } from '@allezrobert/shared';
import { loadTexture } from '../engine/textures.ts';
import { colorUniform } from '../engine/tsl.ts';
import { jerseyPattern, jerseySleeve, type JerseyFrame } from './jerseyPattern.ts';

/**
 * Matériaux du modèle acheté (tools/blender/avatars/build_boutique.py) : textures d'origine,
 * maillot et casque recolorés aux couleurs du coureur en gardant le détail de la texture.
 *
 *  - maillot : jersey_mask.webp, R = zones bleues d'origine → couleur du maillot, G = zones
 *    blanches → couleur d'accent ; noir, gris et étiquette gardés ;
 *  - casque : attribut de sommet COLOR_0 (R) = coque extérieure → couleur du casque ;
 *  - chaussures : COLOR_0 (R) des jambes = chaussure, texels clairs de la tige seulement →
 *    couleur des chaussures (semelle et cale gardées) ;
 *  - styles de maillot (look.jerseyStyle) : « uni » (couleur du maillot partout, détail du tissu
 *    gardé : plis et coutures, sans le dessin d'origine), « bandes » (uni, plus les bandes de
 *    poitrine look.jerseyBands des maillots de champion ; hauteur sur le torse en COLOR_0) ;
 *  - dans les deux cas, couleur × luminance du texel / luminance de référence de la zone
 *    (extras « recolor_ref » du matériau) : ombres, plis, motifs et grain conservés.
 */

let jerseyMask: THREE.Texture | null = null;

/** Charge le masque du maillot (une fois) ; sans lui, le maillot garde ses couleurs d'origine. */
export async function loadTexturedMasks(dir: string): Promise<void> {
  if (jerseyMask) return;
  try {
    jerseyMask = await loadTexture(`${dir}jersey_mask.webp`, { colorSpace: THREE.NoColorSpace, flipY: false /* convention glTF */, anisotropy: 4 });
  } catch (e) {
    console.warn('Masque du maillot indisponible', e);
  }
}

const LUMA = vec3(0.2126, 0.7152, 0.0722);
/** Éclaircissement maximal d'un texel par rapport à sa zone (coutures et reflets clairs). */
const MAX_SHADE = 1.6;
const setters = new WeakMap<THREE.Material, (look: AvatarLook) => void>();

/**
 * Bandes de poitrine (look.jerseyBands, maillots de champion) : centrées sur la poitrine, hauteur
 * totale et hauteur maximale d'une bande (fractions du torse, du bas du maillot au col).
 */
const BANDS_CENTER = 0.645;
const BANDS_TOTAL = 0.225;
const BAND_MAX = 0.07;
const MAX_BANDS = 5;

/** Copie à nœuds d'un matériau « tex_* » chargé, recoloré s'il le permet. */
export function texturedMaterial(src: THREE.MeshStandardMaterial, look: AvatarLook, frame: JerseyFrame | null = null): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.name = src.name;
  m.color.copy(src.color);
  m.map = src.map;
  m.normalMap = src.normalMap;
  m.normalScale.copy(src.normalScale);
  m.roughness = src.roughness;
  m.roughnessMap = src.roughnessMap;
  m.metalness = src.metalness;
  m.metalnessMap = src.metalnessMap;
  m.transparent = src.transparent;
  m.opacity = src.opacity;
  m.depthWrite = !src.transparent;
  // Bras : peau d'origine ; avec les manches longues, avant-bras couverts du tissu du maillot
  // (couleur et motifs, jerseyPattern.ts), ombres de la peau gardées.
  if (src.name === 'tex_arms' && src.map && frame) {
    const skin = texture(src.map, uv()).rgb;
    const sleeve = jerseySleeve(look, frame);
    const shade = clamp(dot(skin, LUMA).div(0.45), 0.45, 1.3);
    m.colorNode = mix(skin, sleeve.color.mul(shade), sleeve.weight);
    setters.set(m, sleeve.set);
    sleeve.set(look);
    return m;
  }
  const ref = src.userData.recolor_ref as number[] | undefined;
  if (!src.map || !ref) return m;
  const base = texture(src.map, uv()).rgb;
  const lum = dot(base, LUMA);
  if (src.name === 'tex_jersey' && jerseyMask && ref.length === 2) {
    const main = colorUniform(look.jersey);
    const accent = colorUniform(look.jerseyAccent);
    const mask = texture(jerseyMask, uv());
    // Manches longues : le liseré d'accent de la manche courte disparaît (zone de manche → couleur du maillot).
    const longU = uniform(0);
    const sleeveZone = frame ? step(frame.sleeveX, abs(attribute<'vec3'>('jpos', 'vec3').x)).mul(longU) : float(0);
    const wMain = mask.r.add(mask.g.mul(sleeveZone));
    const wAccent = mask.g.mul(float(1).sub(sleeveZone));
    const zoneRef = mix(float(ref[0]), float(ref[1]), wAccent.div(max(wMain.add(wAccent), 1e-3)));
    const shade = clamp(lum.div(zoneRef), 0, MAX_SHADE);
    const design = mix(mix(base, main.node.mul(shade), wMain), accent.node.mul(shade), wAccent);
    // Uni et champions : couleur du maillot × détail du tissu ; bandes sur le torse.
    const detail = mask.b.mul(2);
    const plain = uniform(0);
    const coords = attribute<'vec4'>('color', 'vec4');
    const nBands = uniform(0);
    const from = uniform(0.5);
    const height = uniform(0.05);
    // Pois, manches, moitié, dégradé, chevrons : motifs du repère du torse (jerseyPattern.ts).
    const pattern = frame ? jerseyPattern(look, frame) : null;
    const bandColors = Array.from({ length: MAX_BANDS }, () => colorUniform('#ffffff'));
    const rel = coords.x.sub(from).div(height);
    const idx = floor(rel);
    const inBand = step(0, rel).mul(step(rel, nBands)).mul(coords.y);
    let band: THREE.Node<'vec3'> = bandColors[0]!.node;
    for (let i = 1; i < MAX_BANDS; i++) band = mix(band, bandColors[i]!.node, step(i, idx));
    const flat = main.node.mul(detail);
    const patterned = pattern ? pattern.color(flat, detail) : flat;
    m.colorNode = mix(mix(design, patterned, plain), band.mul(detail), inBand);
    setters.set(m, (l) => {
      main.set(l.jersey);
      accent.set(l.jerseyAccent);
      pattern?.set(l);
      longU.value = l.sleeves === 'long' ? 1 : 0;
      plain.value = 1; // pas de zones d'accent du dessin d'origine (bandes) : maillot uni ou à motif
      // Bandes données de haut en bas ; la première du shader est en bas.
      const b = l.jerseyStyle === 'bandes' ? (l.jerseyBands ?? []).slice(0, MAX_BANDS).reverse() : [];
      const h = b.length ? Math.min(BAND_MAX, BANDS_TOTAL / b.length) : 0.05;
      nBands.value = b.length;
      height.value = h;
      from.value = BANDS_CENTER - (h * b.length) / 2;
      b.forEach((c, i) => bandColors[i]?.set(c));
    });
    setters.get(m)?.(look);
  } else if (src.name === 'tex_helmet') {
    const shell = colorUniform(look.helmet);
    const w = attribute<'vec4'>('color', 'vec4').x;
    const shade = clamp(lum.div(ref[0] as number), 0, MAX_SHADE);
    m.colorNode = mix(base, shell.node.mul(shade), w);
    setters.set(m, (l) => shell.set(l.helmet));
  } else if (src.name === 'tex_legs') {
    const shoe = colorUniform(look.shoes ?? '#f2f2f2');
    const w = attribute<'vec4'>('color', 'vec4').x.mul(smoothstep(0.25, 0.5, lum));
    const shade = clamp(lum.div(ref[0] as number), 0, MAX_SHADE);
    m.colorNode = mix(base, shoe.node.mul(shade), w);
    setters.set(m, (l) => shoe.set(l.shoes ?? '#f2f2f2'));
  }
  return m;
}

/** Enregistre la mise à jour d'un matériau à nœuds propre (tissu du maillot MPFB). */
export function registerLookSetter(m: THREE.Material, fn: (look: AvatarLook) => void): void {
  setters.set(m, fn);
}

/** Couleurs du coureur sur un matériau recoloré (sans effet sur les autres). */
export function applyTexturedLook(m: THREE.Material, look: AvatarLook): void {
  setters.get(m)?.(look);
}
