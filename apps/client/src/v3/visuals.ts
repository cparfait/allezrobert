import { lookSex, type AvatarLook } from '@allezrobert/shared';
import { Box3, Group, Quaternion, SRGBColorSpace, Texture, TextureLoader, Vector3, type Bone, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { RiderPose } from '../rider/gltfAvatar.ts';
import { sampleV3, type V3Clip } from './animation.ts';

const base = '/__v3/';
const defaultBike = 'canyonaeroad2024';
const axis = new Vector3(0, 0, 1);
const wheelRotation = new Quaternion();
const cycling = new Set([1, 3, 5, 13, 15, 18, 20, 24, 31]);

export const V3_POSES: Record<string, string> = {
  cyclistSeatedHoods: 'Assis · cocottes',
  cyclistSeatedDrops: 'Assis · bas du cintre',
  cyclistStandingHoods: 'En danseuse · cocottes',
  cyclistSprint: 'Sprint',
  cyclistSprint_alt: 'Sprint · variante',
  cyclistSeatedDrops_TT: 'Aéro · chrono',
  cyclistSuperAero: 'Super-aéro · roue libre',
};

export type V3Bike = { id: string; name: string; brand: string; type: string; preview?: boolean; weightG?: number; cdaBias?: number };
export type V3Object = { id: string; name: string; category: string; path: string };
export type V3Catalog = { bikes: V3Bike[]; objects: V3Object[] };
export type V3Color = { name: string; hue?: number };
export type V3GearSelection = { id: number; color: number; hue?: number };
export type V3SockHeight = 'low' | 'mid' | 'high';
export type V3Body = 'standard' | 'skinny' | 'big';
export type V3Equipment = {
  bike: string; color: number; hue?: number; sex?: 'male' | 'female'; kit?: Record<string, V3GearSelection>; sockHeight?: V3SockHeight;
  /** Corps Zwift : standard, mince ou fort (fort : coureur seulement). */
  body?: V3Body;
  /** Couleurs des cheveux et de la barbe : case 0 à 5 des planches Zwift. */
  hairColor?: number;
  beardColor?: number;
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
const BUILT_IN_BEARD_NAMES = ['Moustache', 'Bouc et moustache', 'Barbe courte', 'Barbe fournie', 'Favoris', 'Barbiche', 'Fine moustache'];

/**
 * Posture adaptée au type de vélo : variantes Zwift VTT (Mountain), ville (_Buffalo), concept, chrono (_TT),
 * couché (Recumbent) et handbike (Handcycle) ; la posture de base si la variante n'existe pas.
 */
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
    if (value && typeof value.bike === 'string' && Number.isInteger(value.color)) return value;
  } catch { /* stockage indisponible */ }
  return { bike: defaultBike, color: 0 };
}

export function saveV3Equipment(equipment: V3Equipment): void {
  localStorage.setItem(equipmentKey, JSON.stringify(equipment));
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(base + path);
  if (!response.ok) throw new Error((await response.json() as { error: string }).error);
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
      const key = item.type + '|' + item.variant + '|' + item.sex;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).concat(BUILT_IN_BEARDS.map((group, i): V3Gear => ({
      id: -group, type: 'FACIAL_HAIR', category: 'Barbe / moustache', name: (BUILT_IN_BEARD_NAMES[i] ?? 'Barbe') + ' (visage)', variant: 'BuiltInBeard' + group,
      sex: 'male', sport: 'cycling', group, model: false, pair: false, offset: [0, 0, 0], rotation: [0, 0, 0], colors: [{ name: 'D’origine' }],
    })));
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
  return result.scene;
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

type BikeVisual = Awaited<ReturnType<typeof loadBike>>;
export type RiderVisual = Awaited<ReturnType<typeof loadRider>>;
export type MountedGear = Awaited<ReturnType<typeof loadGearItem>>;
const boneIndex: Record<string, number> = { HEAD: 15, FOOT_LEFT: 6, FOOT_RIGHT: 10, SPINE_1: 2 };

export async function loadGearItem(item: V3Gear, selection: V3GearSelection, sex?: 'male' | 'female') {
  const color = item.colors[selection.color];
  const query = colorQuery(selection.color, selection.hue);
  const path = 'gear/' + item.id + '/';
  const texture = async (part: string, srgb: boolean) => {
    const map = await new TextureLoader().loadAsync(base + path + part + '.png' + query);
    map.flipY = false;
    if (srgb) map.colorSpace = SRGBColorSpace;
    return map;
  };
  const parts = await Promise.allSettled([
    item.model ? model(path + 'model.glb' + query) : undefined,
    item.pair ? model(path + 'pair.glb' + query) : undefined,
    color?.diffuse ? texture('diffuse', true) : undefined,
    sex === 'female' && color?.femaleNormal ? texture('female-normal', false)
      : color?.normal ? texture('normal', false) : undefined,
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
  const name = /^curly/i.test(item.name) ? 'male02' : item.sex === 'female' ? 'female01' : 'male01';
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
export function applyHairColors(rider: RiderVisual, kit: MountedGear[], hair = 0, beard = 0): void {
  const move = (material: MeshStandardMaterial, index: number) => {
    for (const map of [material.map, material.normalMap]) {
      if (!map) continue;
      const [u, v] = hairCell(index);
      map.offset.set(u, v);
      map.needsUpdate = true;
    }
  };
  for (const gear of kit) {
    if (gear.item.type === 'HAIR') materialsOf(gear.left).forEach(material => move(material, hair));
    if (gear.item.type === 'FACIAL_HAIR') materialsOf(gear.left).forEach(material => move(material, beard));
  }
  // Matériau HAIR du corps : barbes et moustaches intégrées au visage, donc couleur de barbe.
  for (const { material } of rider.originalMaterials) if (/^HAIR$/i.test(material.name)) move(material, beard);
}

export function freeGear(gear: MountedGear): void {
  if (gear.left) free(gear.left);
  if (gear.right) free(gear.right);
  gear.diffuse?.dispose();
  gear.normal?.dispose();
}

async function loadBike(equipment: V3Equipment) {
  const [scene, catalog] = await Promise.all([
    model('bike/' + encodeURIComponent(equipment.bike) + '.glb' + colorQuery(equipment.color, equipment.hue)),
    getV3Catalog().catch(() => undefined),
  ]);
  const levels = scene.children.filter(node => /^LOD[0-2]$/.test(node.name));
  const parts = levels.map(level => level.children.flatMap(node => {
    const part = /^(FrontWheel|RearWheel|Crank)(?:_|$)/.exec(node.name)?.[1];
    if (!part) return [];
    const box = new Box3().setFromObject(node);
    return [{ node, part, rest: node.quaternion.clone(), radius: Math.max(0.1, (box.max.y - box.min.y) / 2), bottom: box.min.y }];
  }));
  const wheels = parts[0]?.filter(part => part.part !== 'Crank') ?? [];
  scene.position.y = wheels.length ? -Math.min(...wheels.map(part => part.bottom)) : 0;
  return { scene, levels, parts, equipment, type: catalog?.bikes.find(bike => bike.id === equipment.bike)?.type };
}

export async function loadV3DisplayBike(id: string): Promise<Group> {
  const bike = await loadBike({ bike: id, color: 0 });
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
  const id = (sex === 'male' ? 'homme' : 'femme') + (body === 'skinny' ? '-mince' : body === 'big' && sex === 'male' ? '-fort' : '');
  const scene = await model('rider/' + id + '.glb');
  const joints = new Map<number, Bone>();
  const levels: Object3D[] = [];
  const groups: { id: number; node: Object3D }[] = [];
  const materials = new Set<MeshStandardMaterial>();
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
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if ((material as MeshStandardMaterial).isMeshStandardMaterial) materials.add(material as MeshStandardMaterial);
    }
  });
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
  return { scene, joints, rest, levels, head, helmet, groups, originalMaterials, sex, body, shoeBasis };
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

export class V3Visual {
  private readonly group = new Group();
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
    if (equipment.bike !== previous?.bike || equipment.color !== previous.color || equipment.hue !== previous.hue) {
      const request = ++this.bikeRequest;
      void loadBike(equipment).then(bike => {
        if (request !== this.bikeRequest) { free(bike.scene); return; }
        if (this.bike) free(this.bike.scene);
        this.bike = bike;
        this.group.add(bike.scene);
        this.redraw();
      }).catch(error => { if (request === this.bikeRequest) this.report(error); });
    }
    const sex = equipment.sex ?? lookSex(look);
    const body: V3Body = equipment.body === 'big' && sex === 'female' ? 'standard' : equipment.body ?? 'standard';
    if (sex !== this.sex || body !== this.body) {
      this.sex = sex;
      this.body = body;
      const request = ++this.riderRequest;
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
      }).catch(error => { if (request === this.riderRequest) this.report(error); });
    }
    if (this.rider?.sex === sex && this.rider.body === body) {
      this.applyKit();
      this.applyHairColors();
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
    applyHairColors(rider, this.kit, this.equipment?.hairColor, this.equipment?.beardColor);
    this.redraw();
  }

  private clearKit(rider: RiderVisual): void {
    ++this.kitRequest;
    this.kitKey = '';
    if (this.kit.length) restoreRider(rider);
    this.kit.forEach(freeGear);
    this.kit = [];
  }

  private applyKit(): void {
    const rider = this.rider;
    if (!rider) return;
    const kit = this.equipment?.kit ?? {};
    const sockHeight = this.equipment?.sockHeight;
    const key = JSON.stringify(kit) + (sockHeight ?? '');
    if (this.kitKey === key) return;
    this.kitKey = key;
    const request = ++this.kitRequest;
    const entries = Object.values(kit);
    const loaded = entries.length ? getV3Gear().then(items => {
      return Promise.all(entries.flatMap(selection => {
        const item = items.find(row => row.id === selection.id);
        if (!item || (item.sex !== 'tous' && item.sex !== this.sex)) return [];
        return [loadGearItem(item, selection, this.sex)];
      }));
    }) : Promise.resolve([]);
    void loaded.then(next => {
      if (request !== this.kitRequest) { next.forEach(freeGear); return; }
      restoreRider(rider);
      this.kit.forEach(freeGear);
      this.kit = next;
      attachKit(rider, next);
      showSockHeight(rider, sockHeight);
      this.applyHairColors();
      this.redraw();
      const missing = next.filter(item => item.incomplete).map(item => item.item.name);
      if (missing.length) this.report(new Error('Ressources manquantes · ' + missing.join(', ')));
    }).catch(error => { if (request === this.kitRequest) this.report(error); });
  }

  update(dt: number, cadence: number, speed: number, pose: RiderPose, options: { rider?: boolean; head?: boolean; helmet?: boolean; clip?: string } = {}): void {
    const { bike, rider } = this;
    if (!bike) return;
    const showRider = this.ready && !!rider && options.rider !== false;
    if (options.rider !== false && !showRider) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.mount.replace(true, showRider);
    if (rider) rider.scene.visible = showRider;
    const level = Math.min(this.mount.level(), 2);
    const wanted = options.clip ?? (pose === 'standing' ? 'cyclistStandingHoods' : bike.type === 'chrono' ? 'cyclistSeatedDrops_TT' : 'cyclistSeatedHoods');
    const rigName = this.sex === 'female' ? 'Female' : 'Male';
    const name = clipForBike(wanted, bike.type, n => this.clips.some(c => c.name === n && c.rig === rigName) || this.clips.some(c => c.name === n));
    this.turns = (this.turns + dt * Math.max(0, cadence) / 60) % 2;
    this.distance += dt * speed;
    bike.levels.forEach((node, i) => { node.visible = i === level; });
    for (const { node, part, rest, radius } of bike.parts[level] ?? []) {
      const angle = part === 'Crank' ? (name === 'cyclistSuperAero' ? 0 : this.turns * 2 * Math.PI) : this.distance / radius;
      node.quaternion.copy(rest).premultiply(wheelRotation.setFromAxisAngle(axis, -angle));
    }
    if (!rider || !showRider) return;
    const rig = this.sex === 'female' ? 'Female' : 'Male';
    const clip = this.clips.find(c => c.name === name && c.rig === rig) ?? this.clips.find(c => c.name === name);
    if (clip && clip !== this.clip) {
      for (const { node, rotation, position } of rider.rest) {
        node.quaternion.copy(rotation);
        node.position.copy(position);
      }
      this.clip = clip;
    }
    if (clip) sampleV3(clip, rider.joints, this.turns);
    rider.head.scale.setScalar(options.head === false ? 0.001 : 1);
    const helmetGear = this.kit.find(gear => gear.item.type === 'HEAD_GEAR');
    if (rider.helmet) rider.helmet.visible = options.helmet !== false && !helmetGear;
    if (helmetGear?.left) helmetGear.left.visible = options.helmet !== false;
    // Coiffure adaptée au couvre-chef porté (casque d'origine ou article du vestiaire).
    const covered = options.helmet !== false && (!!helmetGear?.left || !!rider.helmet);
    showHairGeometry(this.kit.find(gear => gear.item.type === 'HAIR')?.left,
      !covered ? 'none' : helmetGear?.item.hairGeom ?? 'helmet');
    rider.levels.forEach(node => { node.visible = node.name === ['LOD0', 'LOD2', 'LOD5'][level]; });
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
