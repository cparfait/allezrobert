import { lookSex, type AvatarLook } from '@allezrobert/shared';
import { Box3, Color, Group, MeshStandardMaterial, MeshStandardNodeMaterial, Quaternion, type Raycaster, SRGBColorSpace, Texture, TextureLoader, Vector3, type Bone, type Material, type Mesh, type Object3D } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { abs, clamp, float, materialColor, mix, positionGeometry, step, uniform, vec3 } from 'three/tsl';
import type { RiderPose } from '../rider/gltfAvatar.ts';
import { rootNeutral, sampleV3, sampleV3At, type V3Clip } from './animation.ts';
import { loadSettings } from '../ui/settings.ts';
import { AERO_COAST_FULL, AERO_SPEED, AERO_SPEED_OUT, HARD_EFFORT } from '../rider/poseThresholds.ts';
import { recoverV3Access, v3Resource } from '../engine/v3Access.ts';

const base = v3Resource('');
/** Vélo de départ du style Beta. */
export const V3_DEFAULT_BIKE = 'canyonaeroad2024';
const defaultBike = V3_DEFAULT_BIKE;
const axis = new Vector3(0, 0, 1);
const wheelRotation = new Quaternion();
const facing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
const roll = new Quaternion();
const up = new Vector3(0, 1, 0);
const forward = new Vector3();
const footRight = new Vector3();
const footLeft = new Vector3();
const pivot = new Vector3();
const hinge = new Vector3();
const pivotTurned = new Vector3();
const swing = new Quaternion();
const inverse = new Quaternion();
const frame = new Quaternion();
/**
 * Groupes de géométrie montrés d'origine. Maillot fermé (3, col jusqu'à la base du cou) ; le corps a aussi un maillot
 * ouvert en V sur la poitrine (40). Les groupes 8 à 12 sont les poches arrière, plus ou moins garnies (non montrées).
 */
const cycling = new Set([1, 3, 5, 13, 15, 18, 20, 24, 31]);
/** Chaussures par défaut du coureur V3 (variante du catalogue) : S-Works SP7, chaussures de vélo de route. */
const DEFAULT_SHOES = 'SworksSpSevenL';
export const V3_DEFAULT_SHOES = DEFAULT_SHOES;
/**
 * Tenue de départ du style Beta, sans marquage Zwift : maillot blanc du Tour de France (validé pour le film d'accueil) et
 * chaussettes noires unies ; casque et chaussures d'origine. « D'origine » dans le vestiaire y revient.
 */
export const V3_DEFAULT_KIT: Readonly<Record<string, V3GearSelection>> = {
  CYCLING_JERSEY: { id: 452, color: 0 },
  SOCKS: { id: 2037, color: 0 },
};

export const V3_POSES: Record<string, string> = {
  cyclistSeatedHoods: 'Assis · cocottes',
  cyclistSeatedDrops: 'Assis · bas du cintre',
  cyclistStandingHoods: 'En danseuse · cocottes',
  cyclistSprint: 'Sprint',
  cyclistSprint_alt: 'Sprint · variante',
  cyclistSeatedDrops_TT: 'Aéro · chrono',
  cyclistSuperAero: 'Super-aéro · roue libre',
};

export type V3Bike = {
  id: string; name: string; brand: string; type: string; preview?: boolean; weightG?: number; cdaBias?: number;
  /** Roues d'origine : paire du catalogue (si elle y figure), poids (g) et bonus de traînée (m²) compris dans le vélo. */
  wheels?: { id?: string; weightG: number; cdaBias: number };
};
/** Paire de roues de Zwift (avant + arrière) : famille, poids total (g) et bonus de traînée (m²). */
export type V3Wheel = { id: string; name: string; brand: string; kind: 'route' | 'gravel' | 'vtt'; weightG: number; cdaBias: number; preview?: boolean };
export type V3Object = { id: string; name: string; category: string; path: string };
export type V3Catalog = { bikes: V3Bike[]; objects: V3Object[]; wheels?: V3Wheel[] };

/**
 * Roues proposées selon le type de vélo, comme dans Zwift : roues de route et de gravel sur les vélos de route, de
 * chrono et de gravel ; les autres (VTT, ville, concept, tricycle, handbike, couché) gardent leurs roues.
 */
export function wheelsFor(type: string | undefined, wheels: readonly V3Wheel[]): V3Wheel[] {
  return type === 'route' || type === 'chrono' || type === 'gravel' ? wheels.filter(wheel => wheel.kind !== 'vtt') : [];
}

/** Roues montées : celles choisies si elles vont sur ce vélo, sinon aucune (roues d'origine). */
export function mountedWheel(equipment: V3Equipment, bike: V3Bike | undefined, wheels: readonly V3Wheel[]): V3Wheel | undefined {
  if (!equipment.wheels || !bike || equipment.wheels === bike.wheels?.id) return undefined;
  return wheelsFor(bike.type, wheels).find(wheel => wheel.id === equipment.wheels);
}
export type V3Color = { name: string; hue?: number };
export type V3GearSelection = { id: number; color: number; hue?: number };
export type V3SockHeight = 'low' | 'mid' | 'high';
export type V3Body = 'standard' | 'skinny' | 'big';

/** IMC du joueur (poids et taille des Mensurations), arrondi au dixième. */
export function riderBmi(): number | undefined {
  try {
    const { massKg, heightCm } = loadSettings();
    const metres = heightCm / 100;
    return massKg > 0 && metres > 0 ? Math.round((massKg / (metres * metres)) * 10) / 10 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Corps par défaut selon l'IMC : mince sous 20,5, fort au-delà de 27 (coureur seulement, Zwift n'a pas de corps fort
 * féminin), standard entre les deux.
 */
export function bodyForBmi(bmi: number | undefined, sex: 'male' | 'female'): V3Body {
  if (bmi === undefined) return 'standard';
  if (bmi < 20.5) return 'skinny';
  if (bmi > 27 && sex === 'male') return 'big';
  return 'standard';
}

/** Corps montré : celui choisi dans le garage, sinon celui de l'IMC ; jamais « fort » pour la coureuse. */
export function resolvedBody(equipment: V3Equipment, sex: 'male' | 'female'): V3Body {
  const body = equipment.body ?? bodyForBmi(riderBmi(), sex);
  return body === 'big' && sex === 'female' ? 'standard' : body;
}
export type V3Equipment = {
  bike: string; color: number; hue?: number; sex?: 'male' | 'female'; kit?: Record<string, V3GearSelection>; sockHeight?: V3SockHeight;
  /**
   * Manches du maillot : 0 courtes, col en V (maillot 3 du corps Zwift, d'origine), 1 longues, col rond (maillot 40).
   * Nom `zip` gardé pour les réglages déjà enregistrés.
   */
  zip?: number;
  /** Poches du maillot, dans le dos : 0 vides (d'origine) à 4 pleines (pièces 9 à 12 du corps Zwift, 55 à 58 en manches longues). */
  pockets?: number;
  /** Maillot ouvert (fermeture éclair descendue sur la poitrine), manches courtes comme longues ; fermé d'origine. */
  open?: boolean;
  /** Corps Zwift : standard, mince ou fort (fort : coureur seulement). */
  body?: V3Body;
  /** Couleurs des cheveux et de la barbe : case 0 à 5 des planches Zwift. */
  hairColor?: number;
  beardColor?: number;
  /** Couleur libre (palette) des cheveux et de la barbe, « #rrggbb » : prime sur la case de la planche. */
  hairTint?: string;
  beardTint?: string;
  /** Roues choisies (paire du catalogue) ; absent : roues d'origine du vélo. */
  wheels?: string;
  /** Home trainer du garage (catalogue du jeu) ; null : aucun ; absent : celui par défaut. */
  trainer?: string | null;
};

/** Six couleurs des planches de cheveux et de barbe Zwift (2 colonnes × 3 lignes), dans l'ordre des cases. */
export const V3_HAIR_COLORS: Array<{ name: string; swatch: string }> = [
  { name: 'Châtain', swatch: '#6b4a2b' }, { name: 'Blond', swatch: '#c9a25a' }, { name: 'Roux', swatch: '#b5562a' },
  { name: 'Brun foncé', swatch: '#2e2520' }, { name: 'Gris', swatch: '#b8b4ad' }, { name: 'Bleu', swatch: '#2f7f93' },
];
const hairCell = (index = 0): [number, number] => [(index % 2) * 0.5, Math.floor(Math.min(5, Math.max(0, index)) / 2) / 3];

/**
 * Barbes et moustaches intégrées au visage du coureur (groupes de géométrie 24 à 30, matériau HAIR, à hauteur de
 * bouche et de menton) : la moustache 24 est montrée d'origine. « Sans barbe » les masque toutes.
 */
export const BUILT_IN_BEARDS = [24, 25, 26, 27, 28, 29, 30];
/** Barbe du catalogue → pièce du visage (mêmes formes, appariées une à une par leur emprise). */
const BEARD_GROUPS: Record<string, number> = {
  MaleFacialHair01: 24, MaleFacialHair02: 25, MaleFacialHair03: 26, MaleFacialHair04: 27, MaleFacialHair05: 28, MaleFacialHair07: 29, MaleFacialHair08: 30,
};

/**
 * Posture adaptée au type de vélo : variantes Zwift VTT (Mountain), ville (_Buffalo), concept, chrono (_TT),
 * couché (Recumbent) et handbike (Handcycle) ; la posture de base si la variante n'existe pas.
 */
/**
 * Clips d'arrêt et de départ selon le type de vélo : pied à terre (en boucle), clip-in au premier coup de pédale,
 * clip-out à l'arrêt. Sans variante pour le type, le clip du vélo de route ; absent (couché, handbike) : pas de transition.
 */
const TRANSITIONS: Record<'idle' | 'clipIn' | 'clipOut', Record<string, string[]>> = {
  idle: {
    '': ['cyclistFootDownIdle'], vtt: ['CyclistFootDownIdleMountain'], cruiser: ['cyclistFootDownIdle_Buffalo'],
    concept: ['cyclist_clipOutIdleConcept'], 'couché': ['CyclistIdleRecumbent'], handbike: ['CyclistIdleHandcycle'],
  },
  clipIn: {
    '': ['cyclistClipIn'], vtt: ['CyclistClipInMountain'], cruiser: ['cyclistClipIn_Buffalo'], concept: ['cyclist_clipInConcept'],
    chrono: ['cyclist_clipIn_TT'], 'couché': [], handbike: [],
  },
  clipOut: {
    '': ['cyclistClipOut'], vtt: ['CyclistClipOutMountain'], cruiser: ['cyclistClipOut_Buffalo'], concept: ['cyclist_clipOutConcept'],
    'couché': [], handbike: [],
  },
};

export function transitionClip(kind: 'idle' | 'clipIn' | 'clipOut', type: string | undefined, exists: (name: string) => boolean): string | undefined {
  const table = TRANSITIONS[kind];
  return (table[type ?? ''] ?? table[''] ?? []).find(exists);
}

export function clipForBike(wanted: string, type: string | undefined, exists: (name: string) => boolean): string {
  const kind = /superaero/i.test(wanted) ? 'aero' : /sprint.*alt/i.test(wanted) ? 'sprintAlt' : /sprint/i.test(wanted) ? 'sprint'
    : /standing/i.test(wanted) ? 'standing' : /drops/i.test(wanted) ? 'drops' : 'hoods';
  const variants: Record<string, Partial<Record<string, string[]>>> = {
    vtt: { hoods: ['CyclistSeatedHoodsMountain'], drops: ['CyclistSeatedDropsMountain'], standing: ['CyclistStandingHoodsMountain'],
      sprint: ['CyclistSprintMountain'], sprintAlt: ['CyclistSprintMountain_alt', 'CyclistSprintAltMountain'], aero: ['CyclistSeatedDropsMountain'] },
    cruiser: { hoods: ['cyclistSeatedHoods_Buffalo'], drops: ['cyclistSeatedDrops_Buffalo'], standing: ['cyclistStandingHoods_Buffalo'],
      sprint: ['cyclistSprint_Buffalo'], sprintAlt: ['cyclistSprint_alt_Buffalo'], aero: ['cyclistSeatedDrops_Buffalo'] },
    concept: { hoods: ['cyclist_SeatedDrops_Concept'], drops: ['cyclist_SeatedDrops_Concept'], aero: ['cyclist_SeatedDrops_Concept'] },
    chrono: { hoods: ['cyclistSeatedDrops_TT'], drops: ['cyclistSeatedDrops_TT'], standing: ['cyclistStandingHoods_TT'], aero: ['cyclistSuperAero'] },
    'couché': { hoods: ['CyclistSeatedHoodsRecumbent'], drops: ['CyclistSeatedDropsRecumbent'], standing: ['CyclistSprintRecumbent'],
      sprint: ['CyclistSprintRecumbent'], sprintAlt: ['CyclistSprintRecumbent'], aero: ['CyclistSeatedDropsRecumbent'] },
    handbike: { hoods: ['CyclistSeatedHoodsHandcycle'], drops: ['CyclistSeatedDropsHandcycle'], standing: ['CyclistSprintHandcycle'],
      sprint: ['CyclistSprintHandcycle'], sprintAlt: ['CyclistSprintHandcycle'], aero: ['CyclistSeatedDropsHandcycle'] },
  };
  // Posture déjà propre à un type de vélo (choisie dans « Variantes ») : gardée telle quelle.
  if (/Mountain|_Buffalo|Concept|_TT|Recumbent|Handcycle/i.test(wanted)) return wanted;
  const found = (variants[type ?? ''] ?? {})[kind]?.find(exists);
  return found ?? wanted;
}
/** Hauteurs de chaussettes du coureur V3 : trois maillages (bord à 14, 20 et 31 cm du sol), la texture reste la même. */
const SOCK_GROUPS: Record<V3SockHeight, number> = { low: 5, mid: 6, high: 7 };

/** Montre la chaussette de la hauteur choisie (basse par défaut, comme le coureur d'origine). */
/**
 * Sexe d'un article pour les listes et les tirages : celui du catalogue, sinon celui que son nom indique (beaucoup
 * d'articles « pour tous » sont des tenues d'équipe féminine ou masculine : « … Femmes », « Ladies », « Équipe masculine »).
 */
const FEMALE_NAME = /femme|women|woman|wmn|f[ée]minin|ladies|female/i;
const MALE_NAME = /homme|\bmen\b|men.s\b|\bmens\b|masculin|\bmale\b/i;
export function itemSex(item: Pick<V3Gear, 'sex' | 'name' | 'variant'>): 'male' | 'female' | 'tous' {
  if (item.sex === 'male' || item.sex === 'female') return item.sex;
  const text = item.name + ' ' + item.variant;
  const female = FEMALE_NAME.test(text);
  const male = MALE_NAME.test(text);
  return female && !male ? 'female' : male && !female ? 'male' : 'tous';
}

/** Article « None » de Zwift (gants, casque, lunettes, chaussettes) : la pièce est retirée. */
export function isBare(item: Pick<V3Gear, 'variant'>): boolean {
  return /^none$/i.test(item.variant ?? '');
}

/** Article proposé pour cette silhouette (listes du garage, tirages au hasard). */
export function itemFits(item: Pick<V3Gear, 'sex' | 'name' | 'variant'>, sex: 'male' | 'female'): boolean {
  const own = itemSex(item);
  return own === 'tous' || own === sex;
}

/** Coupe du maillot : les deux maillots du corps Zwift, manches courtes et col en V (3) ou manches longues et col rond (40). */
const ZIP_JERSEYS = [3, 40];
export const V3_ZIPS = ['Courtes', 'Longues'];
/** Contenu des poches arrière (pièces du corps Zwift posées sur le maillot, de plus en plus remplies). */
export const V3_POCKETS = ['Vides', 'Peu', 'Moyennes', 'Remplies', 'Pleines'];
export const V3_OPENINGS = ['Fermé', 'Ouvert'];
const POCKETS_SHORT = [9, 10, 11, 12];
const POCKETS_LONG = [55, 56, 57, 58];

/**
 * Ouverture du maillot : le corps Zwift n'a pas de maillot ouvert (ni morphose, ni pièce) et pas de peau sous le haut
 * du maillot. L'ouverture est donc dessinée : un V de peau sous le col, sur le devant, bordé d'une fermeture éclair
 * sombre. Le dessin suit la pose de repos (positionGeometry), donc les animations, et vaut pour les deux maillots.
 */
const openingUniforms = () => ({ on: uniform(0), skin: uniform(new Color(0.78, 0.58, 0.46)) });
type Opening = ReturnType<typeof openingUniforms> & { bottom: number; top: number; width: number };
/** Copie d'un matériau du corps Zwift en matériau à nœuds (même texture, relief et réglages). */
function nodeCopy(source: MeshStandardMaterial): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.name = source.name;
  material.map = source.map;
  material.normalMap = source.normalMap;
  material.normalScale.copy(source.normalScale);
  material.color.copy(source.color);
  material.roughness = source.roughness;
  material.metalness = source.metalness;
  material.roughnessMap = source.roughnessMap;
  material.metalnessMap = source.metalnessMap;
  material.side = source.side;
  material.transparent = source.transparent;
  material.opacity = source.opacity;
  material.alphaTest = source.alphaTest;
  return material;
}

function openableJersey(source: MeshStandardMaterial, opening: Opening): MeshStandardNodeMaterial {
  const material = nodeCopy(source);
  const p = positionGeometry;
  const top = float(opening.top);
  const bottom = float(opening.bottom);
  // V : demi-largeur `width` au col, quelques millimètres en bas de la fermeture.
  const t = clamp(top.sub(p.y).div(top.sub(bottom)), 0, 1);
  const half = mix(float(opening.width), float(0.004), t);
  const zone = step(bottom, p.y).mul(step(float(0), p.x)).mul(opening.on);
  const skin = step(abs(p.z), half).mul(zone);
  const zip = step(abs(p.z), half.add(0.0055)).mul(zone).sub(skin);
  material.colorNode = mix(mix(materialColor.rgb, vec3(0.07, 0.07, 0.08), zip), opening.skin, skin);
  return material;
}

/**
 * Col fermé du maillot à col en V (groupe 3, le seul de la coureuse) : Zwift n'a pas de version fermée. Le V de peau
 * sous le col (cou et haut du sternum, matériaux FLESH) prend la couleur dominante du devant du maillot, comme si la
 * fermeture était remontée. Même dessin sur la pose de repos que l'ouverture.
 */
const closingUniforms = () => ({ on: uniform(0), color: uniform(new Color(0.5, 0.5, 0.5)) });
type Closing = ReturnType<typeof closingUniforms>;
/** V du col du maillot 3 (pose de repos, mètres) : pointe à 1,43 m, bords du col à 1,50 m, ±7 cm (débord caché sous le col). */
const COLLAR_V = { bottom: 1.43, top: 1.5, half: 0.07 };

function closableSkin(source: MeshStandardMaterial, closing: Closing): MeshStandardNodeMaterial {
  const material = nodeCopy(source);
  const p = positionGeometry;
  const t = clamp(p.y.sub(COLLAR_V.bottom).div(COLLAR_V.top - COLLAR_V.bottom), 0, 1);
  const inside = step(abs(p.z), t.mul(COLLAR_V.half)).mul(step(float(COLLAR_V.bottom), p.y)).mul(step(p.y, float(COLLAR_V.top)))
    .mul(step(float(0), p.x)).mul(closing.on);
  material.colorNode = mix(materialColor.rgb, closing.color, inside);
  return material;
}

/** Couleur dominante du maillot porté sur le devant de la poitrine (pixel médian de sa texture à cet endroit). */
const collarColors = new WeakMap<object, Color>();
function collarColor(rider: RiderVisual): Color | undefined {
  let mesh: Mesh | undefined;
  rider.groups.find(group => group.id === 3 && /^LOD0_/.test(group.node.name))?.node.traverse(node => {
    if (!mesh && (node as Mesh).isMesh && /^CyclistKIT$/i.test(((node as Mesh).material as Material).name)) mesh = node as Mesh;
  });
  const map = (mesh?.material as MeshStandardMaterial | undefined)?.map;
  const image = map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!mesh || !image?.width || typeof document === 'undefined') return;
  const known = collarColors.get(image);
  if (known) return known;
  const position = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  if (!position || !uv) return;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(image, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const samples: Array<[number, number, number, number]> = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (x < 0.02 || Math.abs(z) > 0.09 || y < 1.22 || y > 1.42) continue;
    const u = uv.getX(i) - Math.floor(uv.getX(i));
    const v = uv.getY(i) - Math.floor(uv.getY(i));
    const at = (Math.min(size - 1, Math.floor(v * size)) * size + Math.min(size - 1, Math.floor(u * size))) * 4;
    samples.push([0.299 * data[at]! + 0.587 * data[at + 1]! + 0.114 * data[at + 2]!, data[at]!, data[at + 1]!, data[at + 2]!]);
  }
  if (!samples.length) return;
  samples.sort((a, b) => a[0] - b[0]);
  const [, r, g, b] = samples[samples.length >> 1]!;
  const color = new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace).multiply(mesh.material instanceof MeshStandardMaterial ? (mesh.material as MeshStandardMaterial).color : new Color(1, 1, 1));
  collarColors.set(image, color);
  return color;
}

/** Teinte de peau du coureur : pixel médian de la texture du visage porté (planche FLESH). */
const skinTones = new WeakMap<object, Color>();
function skinTone(rider: RiderVisual): Color {
  const fallback = new Color(0.78, 0.58, 0.46);
  const flesh = rider.originalMaterials.find(({ material }) => /^FLESH$/i.test(material.name))?.material.map
    ?? rider.originalMaterials.find(({ material }) => /^FLESH/i.test(material.name))?.material.map;
  const image = flesh?.image as (CanvasImageSource & { width: number }) | undefined;
  if (!image?.width || typeof document === 'undefined') return fallback;
  const known = skinTones.get(image);
  if (known) return known;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return fallback;
  ctx.drawImage(image, 0, 0, 32, 32);
  const data = ctx.getImageData(0, 0, 32, 32).data;
  const pixels: Array<[number, number, number, number]> = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 200) continue;
    pixels.push([0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!, data[i]!, data[i + 1]!, data[i + 2]!]);
  }
  if (!pixels.length) return fallback;
  pixels.sort((a, b) => a[0] - b[0]);
  const [, r, g, b] = pixels[Math.floor(pixels.length * 0.8)]!;
  const tone = new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
  skinTones.set(image, tone);
  return tone;
}

/**
 * Montre le maillot à manches courtes (d'origine) ou longues et ses poches ; la texture du maillot porté s'applique
 * à toutes ces pièces.
 */
export function showZip(rider: RiderVisual, zip = 0, pockets = 0, open = false): void {
  rider.opening.on.value = open ? 1 : 0;
  if (open) rider.opening.skin.value.copy(skinTone(rider));
  // Corps féminin : pas de manches longues (son groupe 40 est le déguisement de dinosaure de Zwift) ; corps fort
  // masculin : pas de groupe 40 du tout (manches courtes gardées, sinon le coureur n'aurait plus de haut).
  const long = zip > 0 && rider.sex === 'male' && rider.groups.some(group => group.id === 40);
  const shown = ZIP_JERSEYS[long ? 1 : 0];
  for (const { id, node } of rider.groups) if (ZIP_JERSEYS.includes(id)) node.visible = id === shown;
  // Col fermé : le V du maillot à manches courtes est comblé à la couleur du maillot (le col rond n'en a pas besoin).
  const collar = !open && !long ? collarColor(rider) : undefined;
  rider.closing.on.value = collar ? 1 : 0;
  if (collar) rider.closing.color.value.copy(collar);
  const pocket = pockets > 0 ? (long ? POCKETS_LONG : POCKETS_SHORT)[Math.min(pockets, 4) - 1] : undefined;
  for (const { id, node } of rider.groups) if (POCKETS_SHORT.includes(id) || POCKETS_LONG.includes(id)) node.visible = id === pocket;
}

export function showSockHeight(rider: RiderVisual, height: V3SockHeight = 'low'): void {
  const shown = SOCK_GROUPS[height];
  for (const { id, node } of rider.groups) if (Object.values(SOCK_GROUPS).includes(id)) node.visible = id === shown;
}
export type V3Gear = {
  id: number; type: string; category: string; name: string; variant: string; sex: string; sport?: string; group?: number;
  model: boolean; pair: boolean; bone?: string; pairBone?: string;
  offset: [number, number, number]; rotation: [number, number, number];
  pairOffset?: [number, number, number]; pairRotation?: [number, number, number];
  /** Poids (grammes) et bonus de traînée (m²) selon Zwift. */
  weightG?: number;
  cdaBias?: number;
  /** Couvre-chef : géométrie de coiffure à montrer dessous (1 libre, 2 bandeau ou visière, 3 tassée) ; casque : aucune. */
  hairGeom?: number;
  colors: (V3Color & { diffuse?: boolean; normal?: boolean; femaleNormal?: boolean; preview?: boolean; icon?: boolean })[];
};
export type V3Mount = {
  parent: Group;
  level(): number;
  replace(bike: boolean, rider: boolean): void;
};
const equipmentKey = 'ar.v3.equipment';

export function readV3Equipment(): V3Equipment {
  try {
    const value = JSON.parse(localStorage.getItem(equipmentKey) ?? 'null') as V3Equipment | null;
    // Pièce jamais choisie (ou remise « d'origine ») : celle de la tenue de départ, sans marquage Zwift.
    if (value && typeof value.bike === 'string' && Number.isInteger(value.color)) return { ...value, kit: { ...V3_DEFAULT_KIT, ...value.kit } };
  } catch { /* stockage indisponible */ }
  return { bike: defaultBike, color: 0, kit: { ...V3_DEFAULT_KIT } };
}

export function saveV3Equipment(equipment: V3Equipment): void {
  localStorage.setItem(equipmentKey, JSON.stringify(equipment));
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(base + path);
  if (response.status === 403) {
    void recoverV3Access();
    throw new Error('Session V3 expirée. Saisis à nouveau le code pour retrouver le catalogue.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Ressource V3 indisponible (HTTP ${response.status}).`);
  }
  return response.json() as Promise<T>;
}

let catalog: Promise<V3Catalog> | undefined;
let clips: Promise<V3Clip[]> | undefined;
let gear: Promise<V3Gear[]> | undefined;
export const getV3Catalog = () => catalog ??= get<V3Catalog>('catalogue').catch(error => { catalog = undefined; throw error; });
export const getV3Clips = () => clips ??= get<V3Clip[]>('clips').catch(error => { clips = undefined; throw error; });
export const getV3Gear = () => gear ??= get<V3Gear[]>('gear')
  .then(items => {
    // Accessories.xml de Zwift déclare certains articles deux fois à l'identique (43 maillots) : on garde le premier.
    const seen = new Set<string>();
    return items.filter(item => {
      if (item.sport ? item.sport !== 'cycling' && item.sport !== 'any' : item.type.startsWith('RUNNING_')) return false;
      // Mascottes de série (Scotty, récompense des semaines d'affilée de Zwift) : rubrique retirée du V3.
      if (item.type === 'STREAK_FLAIR') return false;
      const key = item.type + '|' + item.variant + '|' + item.sex;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(item => {
      // Barbes du catalogue : leurs modèles sont enfoncés de quelques millimètres dans le visage (invisibles) ;
      // ce sont exactement les pièces 24 à 30 du visage, bien placées : la barbe est montrée par sa pièce.
      const group = BEARD_GROUPS[item.variant];
      return item.type === 'FACIAL_HAIR' && group ? { ...item, group, model: false } : item;
    });
  })
  .catch(error => { gear = undefined; throw error; });
export const getV3Colors = (id: string) => get<{ colors: V3Color[] }>('bike/' + id + '.json');

function colorQuery(color: number, hue?: number): string {
  return '?color=' + color + (hue === undefined ? '' : '&hue=' + hue);
}

async function model(path: string): Promise<Group> {
  const result = await new GLTFLoader().loadAsync(base + path);
  result.scene.traverse(node => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  // Pneus unis : inscriptions claires des flancs (marques, tailles) effacées, roues des vélos et paires de roues.
  if (path.startsWith('bike/') || path.startsWith('wheel/')) plainTyres(result.scene, path.startsWith('wheel/'));
  return result.scene;
}

/** Rayon du talon d'une roue de 700c (jante ISO 622) : au-delà, c'est le pneu. */
const TYRE_BEAD = 0.3105;
/** Triangle du pneu : tous ses sommets au-delà du talon et son centre nettement dehors (pas l'arête de la jante). */
const TYRE_CENTER = 0.3135;

/**
 * Pneus sans inscriptions : dans les textures Zwift, le pneu partage souvent la planche de la jante (lettrage blanc
 * de la jante étiré sur les flancs). Les triangles du pneu sont retrouvés par la géométrie ; si la zone de texture
 * qu'ils lisent porte du lettrage clair, ils passent sur un matériau de gomme unie (couleur ordinaire de cette zone).
 * Les pneus sans lettrage (flancs bruns de la roue classique) gardent leur texture ; jante et rayons ne changent pas.
 */
function plainTyres(root: Object3D, whole: boolean): void {
  const found: Array<{ mesh: Mesh; map: Texture; tyre: number[] }> = [];
  const uvTriangles = new Map<Texture, number[][]>();
  root.traverse(node => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    if (!whole) {
      let wheel = false;
      for (let at: Object3D | null = mesh; at && !wheel; at = at.parent) wheel = /^(FrontWheel|RearWheel)(?:_|$)/.test(at.name);
      if (!wheel) return;
    }
    const map = (mesh.material as MeshStandardMaterial).map;
    const position = mesh.geometry.getAttribute('position');
    const uv = mesh.geometry.getAttribute('uv');
    if (!map?.image || !position || !uv) return;
    // Axe de la roue : la plus petite dimension du modèle (les deux autres portent le rayon).
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox!.getSize(new Vector3());
    if (Math.max(size.x, size.y, size.z) / 2 < TYRE_BEAD + 0.005) return;
    const axis = size.x < size.y && size.x < size.z ? 0 : size.y < size.z ? 1 : 2;
    const center = mesh.geometry.boundingBox!.getCenter(new Vector3());
    const radius = (i: number) => {
      const q = [position.getX(i) - center.x, position.getY(i) - center.y, position.getZ(i) - center.z];
      q[axis] = 0;
      return Math.hypot(q[0]!, q[1]!, q[2]!);
    };
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : position.count;
    const tyre: number[] = [];
    const triangles = uvTriangles.get(map) ?? [];
    for (let t = 0; t + 2 < count; t += 3) {
      const ids = [0, 1, 2].map(k => (index ? index.getX(t + k) : t + k));
      const r = ids.map(radius);
      if (r.some(value => value <= TYRE_BEAD) || (r[0]! + r[1]! + r[2]!) / 3 <= TYRE_CENTER) continue;
      tyre.push(t);
      triangles.push(ids.flatMap(i => [uv.getX(i), uv.getY(i)]));
    }
    if (!tyre.length) return;
    uvTriangles.set(map, triangles);
    found.push({ mesh, map, tyre });
  });
  const rubbers = new Map<Texture, MeshStandardMaterial | null>();
  for (const { mesh, map, tyre } of found) {
    if (!rubbers.has(map)) {
      const color = letteredTyreColor(map, uvTriangles.get(map)!);
      rubbers.set(map, color ? new MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, name: 'pneu uni' }) : null);
    }
    const rubber = rubbers.get(map);
    if (!rubber) continue;
    // Index refait : triangles ordinaires d'abord (matériau d'origine), puis ceux du pneu (gomme unie).
    const geometry = mesh.geometry;
    const index = geometry.getIndex();
    const count = index ? index.count : geometry.getAttribute('position').count;
    const isTyre = new Uint8Array(count / 3);
    for (const t of tyre) isTyre[t / 3] = 1;
    const order: number[] = [];
    for (const pass of [0, 1]) for (let t = 0; t + 2 < count; t += 3) {
      if (isTyre[t / 3] !== pass) continue;
      for (let k = 0; k < 3; k++) order.push(index ? index.getX(t + k) : t + k);
    }
    geometry.setIndex(order);
    geometry.clearGroups();
    geometry.addGroup(0, count - tyre.length * 3, 0);
    geometry.addGroup(count - tyre.length * 3, tyre.length * 3, 1);
    mesh.material = [mesh.material as Material, rubber];
  }
}

/**
 * Couleur de gomme d'un pneu si la zone de texture qu'il lit porte du lettrage clair (sinon `null` : texture gardée).
 * Zone retrouvée en posant ses triangles dans l'espace de la texture (coordonnées répétées ramenées dans [0, 1[).
 */
function letteredTyreColor(map: Texture, triangles: number[][]): Color | null {
  const image = map.image as CanvasImageSource & { width: number; height: number };
  const w = Math.min(512, image.width);
  const h = Math.min(512, image.height);
  if (!w || !h || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const mask = maskCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !mask) return null;
  ctx.drawImage(image, 0, 0, w, h);
  mask.fillStyle = '#fff';
  for (const tri of triangles) {
    const du = Math.floor(Math.min(tri[0]!, tri[2]!, tri[4]!));
    const dv = Math.floor(Math.min(tri[1]!, tri[3]!, tri[5]!));
    for (const ox of [0, -1]) for (const oy of [0, -1]) {
      mask.beginPath();
      for (let k = 0; k < 3; k++) {
        const x = (tri[k * 2]! - du + ox) * w;
        const y = (tri[k * 2 + 1]! - dv + oy) * h;
        if (k === 0) mask.moveTo(x, y);
        else mask.lineTo(x, y);
      }
      mask.closePath();
      mask.fill();
    }
  }
  const inside = mask.getImageData(0, 0, w, h).data;
  const data = ctx.getImageData(0, 0, w, h).data;
  const lums: number[] = [];
  const pixels: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!inside[i * 4]) continue;
    pixels.push(i * 4);
    lums.push(0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!);
  }
  if (pixels.length < 64) return null;
  const sorted = [...lums].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1]!;
  // Lettrage : pixels nettement plus clairs que la gomme et peu colorés (blanc, gris).
  let letters = 0;
  let r = 0, g = 0, b = 0, n = 0;
  pixels.forEach((at, k) => {
    const sat = Math.max(data[at]!, data[at + 1]!, data[at + 2]!) - Math.min(data[at]!, data[at + 1]!, data[at + 2]!);
    if (lums[k]! - median >= 60 && sat <= 60) letters++;
    else if (Math.abs(lums[k]! - median) < 25) { r += data[at]!; g += data[at + 1]!; b += data[at + 2]!; n++; }
  });
  if (letters < pixels.length * 0.004 || !n) return null;
  return new Color().setRGB(r / n / 255, g / n / 255, b / n / 255, SRGBColorSpace);
}

function free(scene: Object3D): void {
  const materials = new Set<Material>();
  const maps = new Set<Texture>();
  scene.traverse(node => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) maps.add(value);
    }
  });
  maps.forEach(map => map.dispose());
  materials.forEach(material => material.dispose());
  scene.removeFromParent();
}

export async function prepareV3Object(id: string, extentLimit: number, lod = 0): Promise<Group> {
  const node = await model('object/' + encodeURIComponent(id) + '.glb?color=' + lod);
  const box = new Box3().setFromObject(node);
  const size = box.getSize(new Vector3());
  const extent = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(extent) || extent <= 0) { free(node); throw new Error('Maillage sans volume exploitable.'); }
  const scale = Math.min(1, extentLimit / extent);
  const center = box.getCenter(new Vector3());
  node.scale.setScalar(scale);
  node.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  return node;
}

// ——— Chemins des ressources (relatifs à /__v3/) : partagés par les chargements et par la préparation hors ligne.
const bikePath = (equipment: V3Equipment) => 'bike/' + encodeURIComponent(equipment.bike) + '.glb' + colorQuery(equipment.color, equipment.hue);
const wheelPaths = (id: string) => ['wheel/' + id + '-av.glb', 'wheel/' + id + '-ar.glb'];
const riderId = (sex: 'male' | 'female', body: V3Body) =>
  (sex === 'male' ? 'homme' : 'femme') + (body === 'skinny' ? '-mince' : body === 'big' && sex === 'male' ? '-fort' : '');
const hairAtlasName = (item: V3Gear) => /^curly/i.test(item.name) ? 'male02' : item.sex === 'female' ? 'female01' : 'male01';

/** Fichiers d'un article porté : modèle, modèle de la paire, texture et relief (relief féminin s'il existe). */
function gearFiles(item: V3Gear, selection: V3GearSelection, sex?: 'male' | 'female') {
  const color = item.colors[selection.color];
  const query = colorQuery(selection.color, selection.hue);
  const path = 'gear/' + item.id + '/';
  return {
    model: item.model ? path + 'model.glb' + query : undefined,
    pair: item.pair ? path + 'pair.glb' + query : undefined,
    diffuse: color?.diffuse ? path + 'diffuse.png' + query : undefined,
    normal: sex === 'female' && color?.femaleNormal ? path + 'female-normal.png' + query
      : color?.normal ? path + 'normal.png' + query : undefined,
  };
}

/**
 * Articles chargés pour cette tenue et cette silhouette, et pièces retirées (article « None ») : sans chaussures
 * choisies, chaussures de vélo de route (le corps de Zwift n'a que des chaussures de course).
 */
function wornItems(items: readonly V3Gear[], kit: Record<string, V3GearSelection>, sex: 'male' | 'female' | undefined) {
  const ownShoes = !!kit.CYCLING_SHOES || !!kit.RUNNING_SHOES;
  const shoes = ownShoes ? undefined : items.find(row => row.variant === DEFAULT_SHOES);
  const bare = new Set<string>();
  const worn = [...Object.values(kit), ...(shoes ? [{ id: shoes.id, color: 0 }] : [])].flatMap(selection => {
    const item = items.find(row => row.id === selection.id);
    if (!item || (item.sex !== 'tous' && item.sex !== sex)) return [];
    if (isBare(item)) { bare.add(item.type); return []; }
    return [{ item, selection }];
  });
  return { worn, bare };
}

/**
 * Ressources V3 d'une sortie (chemins « /__v3/… » tels que la page les demande) : catalogues et animations, puis pour
 * chaque coureur son vélo, ses roues, son corps, son casque, les articles de sa tenue et les planches de cheveux.
 * L'application de bureau les copie sur le disque pour rouler en V3 sans connexion (v3/offline.ts).
 */
export async function v3RidePaths(riders: readonly { equipment: V3Equipment; sex: 'male' | 'female' }[]): Promise<string[]> {
  const [catalog, items] = await Promise.all([getV3Catalog(), getV3Gear()]);
  const paths = new Set<string>(['catalogue', 'gear', 'clips']);
  for (const { equipment, sex } of riders) {
    paths.add(bikePath(equipment));
    const wheel = mountedWheel(equipment, catalog.bikes.find(bike => bike.id === equipment.bike), catalog.wheels ?? []);
    if (wheel) wheelPaths(wheel.id).forEach(path => paths.add(path));
    const id = riderId(sex, resolvedBody(equipment, sex));
    paths.add('rider/' + id + '.glb');
    paths.add('helmet/' + id + '.glb');
    for (const { item, selection } of wornItems(items, equipment.kit ?? {}, sex).worn) {
      for (const path of Object.values(gearFiles(item, selection, sex))) if (path) paths.add(path);
      if (item.type === 'HAIR' && item.model) for (const part of ['diffuse', 'normal']) paths.add('hair/' + hairAtlasName(item) + '/' + part + '.png');
    }
  }
  return [...paths].map(path => '/__v3/' + path);
}

type BikeVisual = Awaited<ReturnType<typeof loadBike>>;
export type RiderVisual = Awaited<ReturnType<typeof loadRider>>;
export type MountedGear = Awaited<ReturnType<typeof loadGearItem>>;
const boneIndex: Record<string, number> = { HEAD: 15, FOOT_LEFT: 6, FOOT_RIGHT: 10, SPINE_1: 2 };

export async function loadGearItem(item: V3Gear, selection: V3GearSelection, sex?: 'male' | 'female') {
  const files = gearFiles(item, selection, sex);
  const texture = async (path: string, srgb: boolean) => {
    const map = await new TextureLoader().loadAsync(base + path);
    map.flipY = false;
    if (srgb) map.colorSpace = SRGBColorSpace;
    return map;
  };
  const parts = await Promise.allSettled([
    files.model ? model(files.model) : undefined,
    files.pair ? model(files.pair) : undefined,
    files.diffuse ? texture(files.diffuse, true) : undefined,
    files.normal ? texture(files.normal, false) : undefined,
  ] as const);
  const value = <T>(part: PromiseSettledResult<T>) => part.status === 'fulfilled' ? part.value : undefined;
  const left = value(parts[0]);
  if (item.type === 'HAIR' && left) {
    // Coiffure convertie sans texture (matériau presque noir) : planche Zwift, une copie par modèle (décalage de couleur).
    const atlas = await hairAtlas(item).catch(() => undefined);
    if (atlas) for (const material of materialsOf(left)) {
      material.map = atlas.map.clone();
      material.normalMap = atlas.normal?.clone() ?? null;
      material.color.set(0xffffff);
      material.needsUpdate = true;
    }
  }
  return { item, left, right: value(parts[1]), diffuse: value(parts[2]), normal: value(parts[3]),
    incomplete: parts.some(part => part.status === 'rejected') };
}

/** Planche de texture d'une coiffure : bouclée, féminine ou masculine (les modèles convertis n'en ont pas). */
const hairAtlases = new Map<string, Promise<{ map: Texture; normal?: Texture }>>();
function hairAtlas(item: V3Gear): Promise<{ map: Texture; normal?: Texture }> {
  const name = hairAtlasName(item);
  let job = hairAtlases.get(name);
  if (!job) {
    const load = async (part: string, srgb: boolean) => {
      const map = await new TextureLoader().loadAsync(base + 'hair/' + name + '/' + part + '.png');
      map.flipY = false;
      if (srgb) map.colorSpace = SRGBColorSpace;
      return map;
    };
    job = Promise.all([load('diffuse', true), load('normal', false).catch(() => undefined)]).then(([map, normal]) => ({ map, normal }));
    job.catch(() => hairAtlases.delete(name));
    hairAtlases.set(name, job);
  }
  return job;
}

/** Matériaux d'un modèle d'article. */
function materialsOf(node: Object3D | undefined): MeshStandardMaterial[] {
  const list: MeshStandardMaterial[] = [];
  node?.traverse(child => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) list.push(material as MeshStandardMaterial);
  });
  return list;
}

/** Place chaque planche de cheveux ou de barbe sur la case de couleur choisie. */
/** Case grise claire de la planche : base des couleurs libres (teinte multipliée par la couleur choisie). */
const TINT_CELL = 4;

export function applyHairColors(rider: RiderVisual, kit: MountedGear[], hair = 0, beard = 0, hairTint?: string, beardTint?: string): void {
  const paint = (material: MeshStandardMaterial, index: number, tint?: string) => {
    for (const map of [material.map, material.normalMap]) {
      if (!map) continue;
      const [u, v] = hairCell(tint ? TINT_CELL : index);
      map.offset.set(u, v);
      map.needsUpdate = true;
    }
    // Couleur libre : la case grise est teintée ; sinon couleur neutre (la planche porte la couleur).
    material.color.set(tint ?? 0xffffff);
  };

  for (const gear of kit) {
    if (gear.item.type === 'HAIR') materialsOf(gear.left).forEach(material => paint(material, hair, hairTint));
    if (gear.item.type === 'FACIAL_HAIR') materialsOf(gear.left).forEach(material => paint(material, beard, beardTint));
  }
  // Matériau HAIR du corps : barbes et moustaches intégrées au visage, donc couleur de barbe.
  for (const { material } of rider.originalMaterials) if (/^HAIR$/i.test(material.name)) paint(material, beard, beardTint);
}

export function freeGear(gear: MountedGear): void {
  if (gear.left) free(gear.left);
  if (gear.right) free(gear.right);
  gear.diffuse?.dispose();
  gear.normal?.dispose();
}

async function loadBike(equipment: V3Equipment) {
  const [scene, catalog] = await Promise.all([
    model(bikePath(equipment)),
    getV3Catalog().catch(() => undefined),
  ]);
  const levels = scene.children.filter(node => /^LOD[0-2]$/.test(node.name));
  const info = catalog?.bikes.find(bike => bike.id === equipment.bike);
  const wheel = mountedWheel(equipment, info, catalog?.wheels ?? []);
  // Roues indisponibles (conversion en échec) : le vélo garde les siennes.
  if (wheel) await mountWheels(levels, wheel.id).catch((error: unknown) => console.warn('V3 · roues', error));
  const parts = levels.map(level => level.children.flatMap(node => {
    const part = /^(FrontWheel|RearWheel|Crank)(?:_|$)/.exec(node.name)?.[1];
    if (!part) return [];
    const box = new Box3().setFromObject(node);
    return [{ node, part, rest: node.quaternion.clone(), radius: Math.max(0.1, (box.max.y - box.min.y) / 2), bottom: box.min.y }];
  }));
  const wheels = parts[0]?.filter(part => part.part !== 'Crank') ?? [];
  scene.position.y = wheels.length ? -Math.min(...wheels.map(part => part.bottom)) : 0;
  return { scene, levels, parts, equipment, type: info?.type };
}

/**
 * Roues choisies montées à la place de celles d'origine, sur chaque niveau de détail : même moyeu (origine des nœuds
 * FrontWheel / RearWheel), même nom, donc même rotation et même calage sur le home trainer.
 */
async function mountWheels(levels: Object3D[], id: string): Promise<void> {
  const [av, ar] = wheelPaths(id) as [string, string];
  const [front, rear] = await Promise.all([model(av), model(ar)]);
  for (const level of levels) {
    for (const [part, source] of [['FrontWheel', front], ['RearWheel', rear]] as const) {
      const original = level.children.find(node => new RegExp('^' + part + '(?:_|$)').test(node.name));
      if (!original) continue;
      const mount = new Group();
      mount.name = part;
      mount.position.copy(original.position);
      mount.quaternion.copy(original.quaternion);
      mount.add(source.clone(true));
      level.add(mount);
      level.remove(original);
      free(original);
    }
  }
}

/** Roue avant d'une paire (vignette du studio pour les roues sans icône Zwift). */
export async function loadV3DisplayWheel(id: string): Promise<Group> {
  const wheel = await model('wheel/' + id + '-av.glb');
  wheel.traverse(node => { node.castShadow = false; });
  const mount = new Group();
  mount.name = 'v3-wheel-' + id;
  mount.add(wheel);
  return mount;
}

export async function loadV3DisplayBike(id: string, wheels?: string): Promise<Group> {
  const bike = await loadBike({ bike: id, color: 0, wheels });
  const detail = bike.levels[1] ?? bike.levels[0];
  for (const level of bike.levels) level.visible = level === detail;
  bike.scene.traverse(node => { node.castShadow = false; });
  const mount = new Group();
  mount.name = 'v3-wall-' + id;
  bike.scene.rotation.y = -Math.PI / 2;
  mount.add(bike.scene);
  return mount;
}

export async function loadRider(sex: 'male' | 'female', body: V3Body = 'standard') {
  const id = riderId(sex, body);
  const scene = await model('rider/' + id + '.glb');
  const joints = new Map<number, Bone>();
  const levels: Object3D[] = [];
  const groups: { id: number; node: Object3D }[] = [];
  const materials = new Set<MeshStandardMaterial>();
  // Ouverture du maillot : col à 1,50 m, fermeture descendue jusqu'au sternum (moins bas pour la coureuse).
  const opening: Opening = { ...openingUniforms(), top: 1.5, bottom: sex === 'female' ? 1.37 : 1.32, width: 0.038 };
  const jerseys = new Map<MeshStandardMaterial, MeshStandardNodeMaterial>();
  const closing = closingUniforms();
  scene.traverse(node => {
    const match = /^os_(\d+)$/.exec(node.name);
    if (match) joints.set(Number(match[1]), node as Bone);
    if (/^LOD\d+$/.test(node.name)) levels.push(node);
    const group = /^LOD\d+_g(\d+)$/.exec(node.name);
    if (group) {
      const id = Number(group[1]);
      node.visible = cycling.has(id);
      groups.push({ id, node });
    }
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    // Maillot : matériau à ouverture dessinée (voir openableJersey), un par matériau d'origine.
    if (!Array.isArray(mesh.material) && /^CyclistKIT$/i.test(mesh.material.name)) {
      const source = mesh.material as MeshStandardMaterial;
      let jersey = jerseys.get(source);
      if (!jersey) jerseys.set(source, jersey = openableJersey(source, opening));
      mesh.material = jersey;
    } else if (!Array.isArray(mesh.material) && /^FLESH/i.test(mesh.material.name)) {
      // Peau : matériau à col fermé dessiné (voir closableSkin), un par matériau d'origine.
      const source = mesh.material as MeshStandardMaterial;
      let skin = jerseys.get(source);
      if (!skin) jerseys.set(source, skin = closableSkin(source, closing));
      mesh.material = skin;
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if ((material as MeshStandardMaterial).isMeshStandardMaterial) materials.add(material as MeshStandardMaterial);
    }
  });
  jerseys.forEach((_, source) => source.dispose());
  const rest = [...joints.values()].map(node => ({ node, position: node.position.clone(), rotation: node.quaternion.clone() }));
  const head = joints.get(15);
  if (!head) { free(scene); throw new Error('Squelette V3 incomplet.'); }
  const worldBasis = scene.getWorldQuaternion(new Quaternion());
  const shoeBasis = new Map<Bone, Quaternion>();
  // Les chaussures GDE sont orientées dans le repère neutre de l’avatar, avec leur origine à la cheville.
  // Les deux os ont des repères différents. Le changement de base précède la rotation de l’animation.
  for (const id of [boneIndex.FOOT_LEFT!, boneIndex.FOOT_RIGHT!]) {
    const ankle = joints.get(id);
    if (ankle) shoeBasis.set(ankle, ankle.getWorldQuaternion(new Quaternion()).invert().multiply(worldBasis));
  }
  const helmet = await model('helmet/' + id + '.glb').catch(() => null);
  if (helmet) head.add(helmet);
  const originalMaterials = [...materials].map(material => ({ material, map: material.map, normal: material.normalMap, color: material.color.clone() }));
  return { scene, joints, rest, levels, head, helmet, groups, originalMaterials, sex, body, shoeBasis, opening, closing };
}

function materialsFor(item: V3Gear): RegExp | undefined {
  switch (item.type) {
    case 'HEAD_TYPE': return /^FLESH/i;
    case 'CYCLING_JERSEY': return /^CyclistKIT$/i;
    case 'SOCKS': return /^SockKIT$/i;
    case 'GLOVES': return /^GloveKIT$/i;
    default: return undefined;
  }
}

export function restoreRider(rider: RiderVisual): void {
  for (const { material, map, normal, color } of rider.originalMaterials) {
    material.map = map;
    material.normalMap = normal;
    material.color.copy(color);
    material.needsUpdate = true;
  }
  for (const { id, node } of rider.groups) node.visible = cycling.has(id);
}

/**
 * Une coiffure Zwift contient trois géométries : cheveux libres, variante bandeau ou visière, version tassée.
 * Le couvre-chef choisit (hairGeomOverride 1, 2 ou 3) ; sous un casque (sans valeur), la version tassée.
 * Sans couvre-chef, cheveux libres. Une seule géométrie visible à la fois.
 */
export function showHairGeometry(hair: Object3D | undefined, headgear: 'none' | 'helmet' | number): void {
  if (!hair) return;
  const parts: Object3D[] = [];
  hair.traverse(node => { if ((node as Mesh).isMesh) parts.push(node); });
  if (parts.length < 3) return;
  const index = headgear === 'none' ? 0 : headgear === 'helmet' ? 2 : Math.min(2, Math.max(0, headgear - 1));
  parts.forEach((part, i) => { part.visible = i === index; });
}

/** Maillages de la tête par origine (visage, cou, troisième pièce) : caucasienne, asiatique, africaine. */
const HEAD_SETS: Record<number, number[]> = { 1: [1, 31, 18], 32: [32, 33, 34], 36: [36, 37, 38] };

export function attachKit(rider: RiderVisual, kit: MountedGear[]): void {
  const worn = new Map(kit.map(gear => [gear.item.type, gear]));
  function showGroup(ids: number[], shown: boolean) {
    for (const { id, node } of rider.groups) if (ids.includes(id)) node.visible = shown;
  }
  const head = worn.get('HEAD_TYPE')?.item.group;
  if (head !== undefined && head !== null) {
    // Une tête = visage, cou et troisième pièce de la même origine ; sans cette pièce (coureuse), la pièce commune 18.
    const set = HEAD_SETS[head] ?? [head];
    const present = new Set(rider.groups.map(group => group.id));
    showGroup(Object.values(HEAD_SETS).flat(), false);
    showGroup(set.map(id => (present.has(id) ? id : 18)), true);
  }
  if (worn.get('CYCLING_SHOES')?.left && worn.get('CYCLING_SHOES')?.right) showGroup([14, 19, 20], false);
  // Barbe choisie (« sans barbe » compris) : les barbes intégrées au visage sont masquées, sauf celle choisie.
  if (worn.has('FACIAL_HAIR')) {
    showGroup(BUILT_IN_BEARDS, false);
    const builtIn = worn.get('FACIAL_HAIR')?.item.group;
    if (builtIn !== undefined && builtIn !== null && BUILT_IN_BEARDS.includes(builtIn)) showGroup([builtIn], true);
  }
  for (const { item, left, right, diffuse, normal } of kit) {
    if (item.type === 'CYCLING_SHOES' && (!left || !right)) continue;
    const matcher = materialsFor(item);
    if (matcher && (diffuse || normal)) for (const { material } of rider.originalMaterials) {
      if (!matcher.test(material.name)) continue;
      if (diffuse) { material.map = diffuse; material.color.set(0xffffff); }
      if (normal) material.normalMap = normal;
      material.needsUpdate = true;
    }
    for (const [mesh, bone, offset, rotation] of [
      [left, item.bone, item.offset, item.rotation], [right, item.pairBone, item.pairOffset, item.pairRotation],
    ] as const) {
      const joint = bone ? rider.joints.get(boneIndex[bone] ?? Number(bone.replace(/^os_/, ''))) : undefined;
      if (!mesh || !joint) continue;
      if (offset) mesh.position.fromArray(offset).multiplyScalar(0.01);
      if (rotation) mesh.rotation.set(rotation[0] * Math.PI / 180, rotation[1] * Math.PI / 180, rotation[2] * Math.PI / 180);
      const basis = item.type === 'CYCLING_SHOES' ? rider.shoeBasis.get(joint) : undefined;
      if (basis) mesh.quaternion.premultiply(basis);
      joint.add(mesh);
    }
  }
}

/** Pièce à faire pulser sur le coureur (récompense venue de la page Progression, clic sur la vue du garage). */
export type V3Glow = { kind: 'bike'; id: string } | { kind: 'wheel'; id: string } | { kind: 'gear'; item: V3Gear }
  /** Emplacement porté, quel que soit l'article (gants ou maillot d'origine du corps compris). */
  | { kind: 'slot'; type: string }
  /** Objet de la scène du garage hors coureur et vélo (home trainer). */
  | { kind: 'object'; root: Object3D };
/** Pièce cliquée sur la vue du garage : le vélo, ses roues, ou un emplacement de la tenue ou du personnage. */
export type V3Part = { kind: 'bike' } | { kind: 'wheel' } | { kind: 'trainer' } | { kind: 'slot'; type: string };
/** Matériaux du corps Zwift et emplacement qu'ils habillent. */
const PART_OF_MATERIAL: Array<[RegExp, string]> = [
  [/^CyclistKIT$/i, 'CYCLING_JERSEY'], [/^SockKIT$/i, 'SOCKS'], [/^GloveKIT$/i, 'GLOVES'], [/^HAIR$/i, 'HAIR'], [/^FLESH/i, 'HEAD_TYPE'],
];
const GLOW_COLOR = new Color(0xffd23f);
/** Un seul flash : montée puis retombée, en moins d'une seconde. */
const GLOW_SECONDS = 0.8;
/** Délai avant la première pulsation : la caméra du garage a fini d'arriver sur le coureur. */
const GLOW_DELAY_MS = 1400;
/** Matériau du corps Zwift habillé par chaque emplacement (pièces portées sans modèle à part). */
const SLOT_MATERIAL: Record<string, RegExp> = { CYCLING_JERSEY: /^CyclistKIT$/i, SOCKS: /^SockKIT$/i, GLOVES: /^GloveKIT$/i, HEAD_TYPE: /^FLESH/i };

export class V3Visual {
  private readonly group = new Group();
  /** Pulsation jaune d'une pièce : attendue (chargement en cours), puis un seul flash, et matériaux rendus tels quels. */
  private glow?: { target: V3Glow; asked: number; delay: number; start: number; materials: Array<{ material: MeshStandardMaterial; emissive: Color; intensity: number; map: Texture | null }> };
  private bike?: BikeVisual;
  private rider?: RiderVisual;
  private equipment?: V3Equipment;
  private sex?: 'male' | 'female';
  private body?: V3Body;
  private clips: V3Clip[] = [];
  private clip?: V3Clip;
  private turns = 0;
  private distance = 0;
  private bikeRequest = 0;
  private riderRequest = 0;
  private kitRequest = 0;
  private kitKey = '';
  private kit: MountedGear[] = [];
  private ready = false;
  /** Balancement du vélo (garage) : part de danseuse et de pédalage, lissées ; pieds du coureur repérés. */
  private stance = 0;
  private pedalled = 0;
  /** Chargements en cours (vélo, coureur, tenue) : le film d'accueil attend qu'il n'y en ait plus. */
  private loading = 0;

  /** Vélo, coureur, clips et tenue chargés (rien en attente). */
  get settled(): boolean {
    return this.ready && !!this.bike && !!this.rider && this.loading === 0;
  }
  private feet?: { rider: RiderVisual; right: Bone; left: Bone };

  activeEquipment(): V3Equipment | undefined {
    return this.group.visible ? this.bike?.equipment : undefined;
  }

  constructor(private readonly mount: V3Mount, private readonly redraw = () => {}, private readonly report = (error: unknown) => console.warn(error)) {
    this.group.rotation.y = -Math.PI / 2;
    this.mount.parent.add(this.group);
    void getV3Clips().then(clips => { this.clips = clips; this.ready = true; this.redraw(); }).catch(this.report);
  }

  set(look: AvatarLook, equipment = readV3Equipment()): void {
    const previous = this.equipment;
    this.equipment = equipment;
    if (equipment.bike !== previous?.bike || equipment.color !== previous.color || equipment.hue !== previous.hue || equipment.wheels !== previous.wheels) {
      const request = ++this.bikeRequest;
      this.loading++;
      void loadBike(equipment).then(bike => {
        if (request !== this.bikeRequest) { free(bike.scene); return; }
        if (this.bike) free(this.bike.scene);
        this.bike = bike;
        this.group.add(bike.scene);
        this.redraw();
      }).catch(error => { if (request === this.bikeRequest) this.report(error); }).finally(() => { this.loading--; });
    }
    const sex = equipment.sex ?? lookSex(look);
    const body = resolvedBody(equipment, sex);
    if (sex !== this.sex || body !== this.body) {
      this.sex = sex;
      this.body = body;
      const request = ++this.riderRequest;
      this.loading++;
      void loadRider(sex, body).then(rider => {
        if (request !== this.riderRequest) { free(rider.scene); return; }
        if (this.rider) {
          this.clearKit(this.rider);
          free(this.rider.scene);
        }
        this.rider = rider;
        this.clip = undefined;
        this.group.add(rider.scene);
        this.applyKit();
        this.redraw();
      }).catch(error => { if (request === this.riderRequest) this.report(error); }).finally(() => { this.loading--; });
    }
    if (this.rider?.sex === sex && this.rider.body === body) {
      this.applyKit();
      this.applyHairColors();
      showZip(this.rider, equipment.zip, equipment.pockets, equipment.open);
      this.redraw();
    }
  }

  /** Silhouette effective du coureur (choisie, sinon celle du profil). */
  riderSex(): 'male' | 'female' | undefined {
    return this.sex;
  }

  /** Couleurs des cheveux (coiffure portée ou intégrée) et de la barbe : case de la planche Zwift. */
  private applyHairColors(): void {
    const rider = this.rider;
    if (!rider) return;
    applyHairColors(rider, this.kit, this.equipment?.hairColor, this.equipment?.beardColor, this.equipment?.hairTint, this.equipment?.beardTint);
    this.redraw();
  }

  private clearKit(rider: RiderVisual): void {
    ++this.kitRequest;
    this.kitKey = '';
    if (this.kit.length) restoreRider(rider);
    this.kit.forEach(freeGear);
    this.kit = [];
  }

  /** Casque retiré (article « None ») : ni casque d'origine ni couvre-chef. */
  private bareHead = false;

  private applyKit(): void {
    const rider = this.rider;
    if (!rider) return;
    const kit = this.equipment?.kit ?? {};
    const sockHeight = this.equipment?.sockHeight;
    const key = JSON.stringify(kit) + (sockHeight ?? '');
    if (this.kitKey === key) return;
    this.kitKey = key;
    const request = ++this.kitRequest;
    this.loading++;
    // Pièces retirées (article « None ») : rien à charger, la pièce du corps est cachée.
    const bare = new Set<string>();
    const loaded = getV3Gear().then(items => {
      const kept = wornItems(items, kit, this.sex);
      kept.bare.forEach(type => bare.add(type));
      return Promise.all(kept.worn.map(({ item, selection }) => loadGearItem(item, selection, this.sex)));
    });
    void loaded.then(next => {
      if (request !== this.kitRequest) { next.forEach(freeGear); return; }
      restoreRider(rider);
      this.kit.forEach(freeGear);
      this.kit = next;
      attachKit(rider, next);
      showSockHeight(rider, sockHeight);
      showZip(rider, this.equipment?.zip, this.equipment?.pockets, this.equipment?.open);
      // Mains et chevilles nues : la peau du corps (groupe 15) est dessous.
      for (const { id, node } of rider.groups) {
        if ((bare.has('GLOVES') && id === 13) || (bare.has('SOCKS') && Object.values(SOCK_GROUPS).includes(id))) node.visible = false;
      }
      this.bareHead = bare.has('HEAD_GEAR');
      this.applyHairColors();
      this.redraw();
      const missing = next.filter(item => item.incomplete).map(item => item.item.name);
      if (missing.length) this.report(new Error('Ressources manquantes · ' + missing.join(', ')));
    }).catch(error => { if (request === this.kitRequest) this.report(error); }).finally(() => { this.loading--; });
  }

  /**
   * Phase de sortie : arrêt pied à terre, départ (clip-in), en selle, arrivée (clip-out). Au départ d'un parcours,
   * le coureur attend pied à terre le premier coup de pédale.
   */
  private phase: 'idle' | 'clipIn' | 'ride' | 'clipOut' = 'idle';
  private phaseT = 0;
  private dropsOn = false;
  private tuckOn = false;

  private enter(phase: 'idle' | 'clipIn' | 'ride' | 'clipOut'): void {
    this.phase = phase;
    this.phaseT = 0;
  }

  /**
   * Posture en selle selon l'allure et l'effort, aux seuils de l'avatar du jeu (poseThresholds.ts) : cocottes, bas du
   * cintre vite ou fort, super-aéro en roue libre rapide (descente), danseuse, sprint en danseuse à forte puissance.
   * Le type de vélo choisit ensuite la variante (clipForBike).
   */
  private ridingClip(pose: RiderPose, speed: number, cadence: number, effort: number, type: string | undefined): string {
    if (pose === 'standing') return effort > 1.5 ? 'cyclistSprint' : 'cyclistStandingHoods';
    const coasting = pose === 'coasting' || cadence < 5;
    this.tuckOn = coasting && (speed > AERO_COAST_FULL || (this.tuckOn && speed > AERO_SPEED));
    if (this.tuckOn && (type === 'route' || type === 'chrono' || type === 'gravel')) return 'cyclistSuperAero';
    // Bas du cintre seulement vite (45 km/h, retour sous 41), comme l'avatar du jeu : à allure basse, haut du cintre,
    // même en forçant (l'effort fort ne compte qu'au-delà de 45 km/h).
    this.dropsOn = speed > AERO_SPEED || (this.dropsOn && speed > AERO_SPEED_OUT) || (speed > AERO_SPEED_OUT && effort > HARD_EFFORT);
    return this.dropsOn ? 'cyclistSeatedDrops' : 'cyclistSeatedHoods';
  }

  /**
   * Pieds du coureur : les deux os les plus bas de la pose en cours (pieds sur les pédales), un de chaque côté du vélo
   * (côté droit = avant × haut).
   * Les os du coureur V3 ne sont que numérotés.
   */
  private findFeet(rider: RiderVisual, ahead: Vector3): { rider: RiderVisual; right: Bone; left: Bone } | undefined {
    if (this.feet?.rider === rider) return this.feet;
    rider.scene.updateMatrixWorld(true);
    const side = new Vector3().crossVectors(ahead, up);
    const bones = [...rider.joints.values()].map(bone => {
      const at = rider.scene.worldToLocal(bone.getWorldPosition(new Vector3()));
      return { bone, y: at.y, side: at.dot(side) };
    }).sort((a, b) => a.y - b.y);
    const right = bones.find(bone => bone.side > 0.03);
    const left = bones.find(bone => bone.side < -0.03);
    this.feet = right && left ? { rider, right: right.bone, left: left.bone } : undefined;
    return this.feet;
  }

  /** Groupe V3 droit, sans balancement. */
  private steady(): void {
    this.group.quaternion.copy(facing);
    this.group.position.set(0, 0, 0);
  }

  /**
   * Balancement du vélo et du coureur, d'un bloc. Les clips de Zwift (danseuse, sprint) font osciller tout le coureur
   * par l'os racine (os_0) : Zwift fait suivre le vélo. Ici l'écart à sa pose moyenne est retiré de l'os racine et appliqué au
   * groupe (vélo + coureur), les mains restent donc sur le cintre et les pieds sur les pédales.
   * Au garage (« Pédaler »), s'y ajoute en selle un léger balancement (≈ 1°, un peu plus en forçant, comme l'avatar du
   * jeu), à l'opposé de la jambe qui appuie (phase tirée des pieds du coureur).
   * Charnière : au sol, la ligne des deux contacts des pneus ; sur un home trainer, la ligne de l'axe arrière (serré) au
   * contact du pneu avant (calé) : rien ne décroche.
   */
  private sway(dt: number, cadence: number, effort: number, clip: string, steady: boolean, extra: boolean, trainer: boolean): void {
    const { bike, rider } = this;
    const front = bike?.parts[0]?.find(part => part.part === 'FrontWheel');
    const rear = bike?.parts[0]?.find(part => part.part === 'RearWheel');
    if (!bike || !rider || !front || !rear) { this.steady(); return; }
    pivot.copy(rear.node.position).add(bike.scene.position);
    if (!trainer) pivot.y -= rear.radius;
    hinge.copy(front.node.position).add(bike.scene.position);
    hinge.y -= front.radius;
    forward.subVectors(hinge, pivot);
    if (forward.lengthSq() < 1e-6) { this.steady(); return; }
    forward.normalize();
    // Oscillation de l'os racine (écart à sa pose de repos), exprimée dans le repère du groupe, puis os remis au repos.
    swing.identity();
    const root = rider.joints.get(0);
    const neutral = this.clip && rootNeutral(this.clip);
    if (root && neutral) {
      swing.copy(root.quaternion).multiply(inverse.copy(neutral).invert());
      root.quaternion.copy(neutral);
      if (root.parent) {
        this.group.updateMatrixWorld(true);
        root.parent.getWorldQuaternion(frame).premultiply(this.group.getWorldQuaternion(inverse).invert());
        swing.premultiply(frame).multiply(frame.invert());
      }
    }
    let angle = 0;
    if (extra) {
      const flat = hinge.copy(forward).setY(0).normalize();
      const feet = this.findFeet(rider, flat);
      const k = 1 - Math.exp(-dt * 4);
      this.stance += ((/standing|sprint/i.test(clip) ? 1 : 0) - this.stance) * k;
      this.pedalled += ((steady && cadence >= 5 && !/superaero/i.test(clip) ? 1 : 0) - this.pedalled) * k;
      if (feet && this.pedalled > 0.001) {
        rider.scene.updateMatrixWorld(true);
        rider.scene.worldToLocal(feet.right.getWorldPosition(footRight));
        rider.scene.worldToLocal(feet.left.getWorldPosition(footLeft));
        const push = Math.max(-1, Math.min(1, footRight.sub(footLeft).dot(flat) / 0.3));
        const seated = 0.014 + 0.01 * Math.max(0, Math.min(0.6, effort - 0.6));
        // En danseuse et en sprint, le clip donne déjà l'oscillation.
        angle = -push * seated * (1 - this.stance) * this.pedalled;
      }
    }
    // Rotation autour de la charnière : la position compense pour que son point d'appui ne bouge pas.
    this.group.quaternion.copy(facing).multiply(swing).multiply(roll.setFromAxisAngle(forward, angle));
    pivotTurned.copy(pivot).applyQuaternion(this.group.quaternion);
    this.group.position.copy(pivot).applyQuaternion(facing).sub(pivotTurned);
  }

  /**
   * La pièce pulse en jaune sur le coureur (ou le vélo) quelques secondes, dès qu'elle est chargée. Arrivée depuis la
   * page Progression : `delayed`, la caméra du garage finit d'abord d'arriver ; clic sur la vue : tout de suite.
   */
  highlight(target: V3Glow, delayed = false): void {
    this.endGlow();
    this.glow = { target, asked: performance.now(), delay: delayed ? GLOW_DELAY_MS : 0, start: -1, materials: [] };
    this.redraw();
  }

  /** Matériaux de la pièce, une fois l'équipement voulu chargé (sinon `undefined` : on attend). */
  private glowMaterials(target: V3Glow): MeshStandardMaterial[] | undefined {
    const { bike, rider } = this;
    if (this.loading > 0 || !bike || !rider) return;
    const found = new Set<MeshStandardMaterial>();
    const take = (node: Object3D) => {
      const material = (node as Mesh).material as Material | Material[] | undefined;
      for (const one of Array.isArray(material) ? material : material ? [material] : []) {
        if ((one as MeshStandardMaterial).emissive) found.add(one as MeshStandardMaterial);
      }
    };
    const wheel = (node: Object3D) => {
      for (let at: Object3D | null = node; at; at = at.parent) if (/^(FrontWheel|RearWheel)(?:_|$)/.test(at.name)) return true;
      return false;
    };
    if (target.kind === 'object') {
      target.root.traverse(take);
    } else if (target.kind === 'bike') {
      if (target.id && bike.equipment.bike !== target.id) return;
      bike.scene.traverse(node => { if (!wheel(node)) take(node); });
    } else if (target.kind === 'wheel') {
      if (target.id && bike.equipment.wheels !== target.id) return;
      bike.scene.traverse(node => { if (wheel(node)) take(node); });
    } else if (target.kind === 'slot') {
      const pattern = SLOT_MATERIAL[target.type];
      if (pattern) {
        for (const { material } of rider.originalMaterials) {
          if (pattern.test(material.name) && (material as MeshStandardMaterial).emissive) found.add(material as MeshStandardMaterial);
        }
      }
      for (const gear of this.kit) if (gear.item.type === target.type) { gear.left?.traverse(take); gear.right?.traverse(take); }
      if (target.type === 'HEAD_GEAR' && !this.kit.some(gear => gear.item.type === 'HEAD_GEAR')) rider.helmet?.traverse(take);
    } else {
      if (this.equipment?.kit?.[target.item.type]?.id !== target.item.id) return;
      const pattern = materialsFor(target.item);
      if (pattern) {
        for (const { material } of rider.originalMaterials) {
          if (pattern.test(material.name) && (material as MeshStandardMaterial).emissive) found.add(material as MeshStandardMaterial);
        }
      } else {
        const mounted = this.kit.find(gear => gear.item.id === target.item.id);
        mounted?.left?.traverse(take);
        mounted?.right?.traverse(take);
      }
    }
    return found.size ? [...found] : undefined;
  }

  /** Pièce du vélo ou du coureur sous le rayon (clic sur la vue du garage) ; `undefined` si rien n'est touché. */
  partAt(ray: Raycaster): (V3Part & { distance: number }) | undefined {
    if (!this.group.visible) return;
    const shown = (node: Object3D) => {
      for (let at: Object3D | null = node; at; at = at.parent) if (!at.visible) return false;
      return true;
    };
    const hit = ray.intersectObject(this.group, true).find(one => (one.object as Mesh).isMesh && shown(one.object));
    if (!hit) return;
    const mesh = hit.object as Mesh;
    const within = (root: Object3D | null | undefined) => {
      for (let at: Object3D | null = mesh; at; at = at.parent) if (at === root) return true;
      return false;
    };
    const distance = hit.distance;
    if (this.bike && within(this.bike.scene)) {
      for (let at: Object3D | null = mesh; at; at = at.parent) if (/^(FrontWheel|RearWheel)(?:_|$)/.test(at.name)) return { kind: 'wheel', distance };
      return { kind: 'bike', distance };
    }
    const gear = this.kit.find(one => within(one.left) || within(one.right));
    if (gear) return { kind: 'slot', type: gear.item.type, distance };
    if (this.rider && within(this.rider.helmet)) return { kind: 'slot', type: 'HEAD_GEAR', distance };
    const material = Array.isArray(mesh.material) ? mesh.material[hit.face?.materialIndex ?? 0] : mesh.material;
    const type = PART_OF_MATERIAL.find(([pattern]) => pattern.test(material?.name ?? ''))?.[1];
    // Peau du corps (bras, jambes) : rien à changer ; seule la tête renvoie au visage.
    if (type === 'HEAD_TYPE' && this.rider && hit.point.y < this.rider.head.getWorldPosition(new Vector3()).y - 0.12) return;
    return type ? { kind: 'slot', type, distance } : undefined;
  }

  private tickGlow(): void {
    const glow = this.glow;
    if (!glow) return;
    const now = performance.now();
    if (glow.start < 0) {
      // Pièce introuvable après 20 s (chargement en échec) : abandon.
      if (now - glow.asked > 20000) { this.glow = undefined; return; }
      const found = now - glow.asked < glow.delay ? undefined : this.glowMaterials(glow.target);
      if (!found) { this.redraw(); return; }
      glow.materials = found.map(material => ({ material, emissive: material.emissive.clone(), intensity: material.emissiveIntensity, map: material.emissiveMap }));
      glow.start = now;
    }
    const t = (now - glow.start) / 1000;
    if (t > GLOW_SECONDS) { this.endGlow(); return; }
    const k = Math.sin((t / GLOW_SECONDS) * Math.PI);
    for (const { material } of glow.materials) {
      material.emissive.copy(GLOW_COLOR);
      material.emissiveMap = null;
      material.emissiveIntensity = 0.85 * k;
    }
    this.redraw();
  }

  private endGlow(): void {
    for (const { material, emissive, intensity, map } of this.glow?.materials ?? []) {
      material.emissive.copy(emissive);
      material.emissiveIntensity = intensity;
      material.emissiveMap = map;
    }
    this.glow = undefined;
    this.redraw();
  }

  update(dt: number, cadence: number, speed: number, pose: RiderPose, options: { rider?: boolean; head?: boolean; helmet?: boolean; clip?: string; effort?: number; transitions?: boolean; rock?: boolean; trainer?: boolean; crank?: number } = {}): void {
    this.tickGlow();
    const { bike, rider } = this;
    const showRider = this.ready && !!rider && options.rider !== false;
    // Vélo ou coureur V3 pas encore chargé : rien plutôt que le coureur et le vélo du jeu (mode Réel) en attendant.
    if (!bike || (options.rider !== false && !showRider)) {
      this.mount.replace(true, true);
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.mount.replace(true, showRider);
    if (rider) rider.scene.visible = showRider;
    const level = Math.min(this.mount.level(), 2);
    const rigName = this.sex === 'female' ? 'Female' : 'Male';
    const exists = (n: string) => this.clips.some(c => c.name === n && c.rig === rigName) || this.clips.some(c => c.name === n);
    // Sortie : pied à terre à l'arrêt, clip-in au premier coup de pédale, clip-out en s'arrêtant.
    let wanted = options.clip;
    let at: number | undefined;
    let loop = false;
    if (!wanted && options.transitions) {
      const stopped = speed < 0.4 && cadence < 5;
      this.phaseT += dt;
      if (this.phase === 'ride' && stopped) this.enter('clipOut');
      else if ((this.phase === 'idle' || this.phase === 'clipOut') && !stopped) this.enter('clipIn');
      if (this.phase === 'clipIn' || this.phase === 'clipOut') {
        const transition = transitionClip(this.phase, bike.type, exists);
        const clip = transition ? this.clips.find(c => c.name === transition) : undefined;
        if (!clip || this.phaseT >= clip.duration) this.enter(this.phase === 'clipIn' ? 'ride' : 'idle');
        else { wanted = transition; at = this.phaseT; }
      }
      if (this.phase === 'idle') {
        const idle = transitionClip('idle', bike.type, exists);
        if (idle) { wanted = idle; at = this.phaseT; loop = true; }
      }
    }
    wanted ??= this.ridingClip(pose, speed, cadence, options.effort ?? 0.7, bike.type);
    const name = at === undefined ? clipForBike(wanted, bike.type, exists) : wanted;
    // Angle du pédalier imposé (radians, film d'accueil), sinon intégré de la cadence.
    this.turns = options.crank !== undefined ? (((options.crank / (2 * Math.PI)) % 2) + 2) % 2 : (this.turns + dt * Math.max(0, cadence) / 60) % 2;
    this.distance += dt * speed;
    bike.levels.forEach((node, i) => { node.visible = i === level; });
    for (const { node, part, rest, radius } of bike.parts[level] ?? []) {
      const angle = part === 'Crank' ? (name === 'cyclistSuperAero' ? 0 : this.turns * 2 * Math.PI) : this.distance / radius;
      node.quaternion.copy(rest).premultiply(wheelRotation.setFromAxisAngle(axis, -angle));
    }
    if (!rider || !showRider) { this.steady(); return; }
    const rig = this.sex === 'female' ? 'Female' : 'Male';
    const clip = this.clips.find(c => c.name === name && c.rig === rig) ?? this.clips.find(c => c.name === name);
    if (clip && clip !== this.clip) {
      for (const { node, rotation, position } of rider.rest) {
        node.quaternion.copy(rotation);
        node.position.copy(position);
      }
      this.clip = clip;
    }
    if (clip && at !== undefined) sampleV3At(clip, rider.joints, at, loop);
    else if (clip) sampleV3(clip, rider.joints, this.turns);
    rider.head.scale.setScalar(options.head === false ? 0.001 : 1);
    const helmetGear = this.kit.find(gear => gear.item.type === 'HEAD_GEAR');
    if (rider.helmet) rider.helmet.visible = options.helmet !== false && !helmetGear && !this.bareHead;
    if (helmetGear?.left) helmetGear.left.visible = options.helmet !== false;
    // Coiffure adaptée au couvre-chef porté (casque d'origine ou article du vestiaire) ; tête nue : cheveux libres.
    const covered = options.helmet !== false && (!!helmetGear?.left || (!!rider.helmet && !this.bareHead));
    showHairGeometry(this.kit.find(gear => gear.item.type === 'HAIR')?.left,
      !covered ? 'none' : helmetGear?.item.hairGeom ?? 'helmet');
    rider.levels.forEach(node => { node.visible = node.name === ['LOD0', 'LOD2', 'LOD5'][level]; });
    this.sway(dt, cadence, options.effort ?? 0.7, name, at === undefined, !!options.rock, !!options.trainer);
  }

  dispose(): void {
    ++this.bikeRequest;
    ++this.riderRequest;
    this.mount.replace(false, false);
    if (this.bike) free(this.bike.scene);
    if (this.rider) {
      this.clearKit(this.rider);
      free(this.rider.scene);
    }
    this.group.removeFromParent();
  }
}
