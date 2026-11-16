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

export type V3Bike = { id: string; name: string; brand: string; type: string; preview?: boolean };
export type V3Object = { id: string; name: string; category: string; path: string };
export type V3Catalog = { bikes: V3Bike[]; objects: V3Object[] };
export type V3Color = { name: string; hue?: number };
export type V3GearSelection = { id: number; color: number; hue?: number };
export type V3Equipment = { bike: string; color: number; hue?: number; sex?: 'male' | 'female'; kit?: Record<string, V3GearSelection> };
export type V3Gear = {
  id: number; type: string; category: string; name: string; variant: string; sex: string; sport?: string; group?: number;
  model: boolean; pair: boolean; bone?: string; pairBone?: string;
  offset: [number, number, number]; rotation: [number, number, number];
  pairOffset?: [number, number, number]; pairRotation?: [number, number, number];
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
  .then(items => items.filter(item => item.sport ? item.sport === 'cycling' || item.sport === 'any' : !item.type.startsWith('RUNNING_')))
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
  return { item, left: value(parts[0]), right: value(parts[1]), diffuse: value(parts[2]), normal: value(parts[3]),
    incomplete: parts.some(part => part.status === 'rejected') };
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

export async function loadRider(sex: 'male' | 'female') {
  const id = sex === 'male' ? 'homme' : 'femme';
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
  return { scene, joints, rest, levels, head, helmet, groups, originalMaterials, sex, shoeBasis };
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

export function attachKit(rider: RiderVisual, kit: MountedGear[]): void {
  const worn = new Map(kit.map(gear => [gear.item.type, gear]));
  function showGroup(ids: number[], shown: boolean) {
    for (const { id, node } of rider.groups) if (ids.includes(id)) node.visible = shown;
  }
  const head = worn.get('HEAD_TYPE')?.item.group;
  if (head !== undefined && head !== null) {
    showGroup([1, 32, 36], false);
    showGroup([head], true);
  }
  if (worn.get('CYCLING_SHOES')?.left && worn.get('CYCLING_SHOES')?.right) showGroup([14, 19, 20], false);
  if (worn.has('HAIR')) showGroup([24, 25, 26, 27, 28, 29, 30], false);
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
    if (sex !== this.sex) {
      this.sex = sex;
      const request = ++this.riderRequest;
      void loadRider(sex).then(rider => {
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
    if (this.rider?.sex === sex) this.applyKit();
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
    const key = JSON.stringify(kit);
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
    const name = options.clip ?? (pose === 'standing' ? 'cyclistStandingHoods' : bike.type === 'chrono' ? 'cyclistSeatedDrops_TT' : 'cyclistSeatedHoods');
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
