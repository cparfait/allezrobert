import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { RouteTrack } from '@allezrobert/shared';
import { vehicleDraftReduction, type VehicleKind } from '@allezrobert/physics';
import { rng } from '../engine/noise.ts';
import { sharedKtx2Loader } from '../engine/textures.ts';
import type { VehicleSound } from '../audio/soundscape.ts';
import { UNPAVED_SURFACES } from './dust.ts';
import { followSpeed, keepApart, keepClearOfRiders, leaderOf, oncomingInLane, RIDER_CLEAR_LAT } from './trafficSpacing.ts';

/**
 * Circulation : voitures, utilitaire et tracteur dans le même repère que les coureurs (distance
 * déroulée + décalage latéral). Les voitures doublent en s'écartant (et patientent si quelqu'un
 * arrive en face), d'autres roulent en sens inverse, le tracteur se traîne.
 *
 * Modèles réalistes (Sketchfab, CC BY 4.0, voir ASSETS_LICENSES.md) préparés par tools/blender/vehicles :
 * `<nom>.glb` (proche) et `<nom>.far.glb` (lointain, simplifié), Meshopt + KTX2, à l'échelle réelle,
 * avant vers +z, roues = nœuds « wheel* » centrés sur leur axe. Sans fichiers : primitives.
 */

interface ModelSpec {
  file: string;
  kind: VehicleKind;
  /** Plage de vitesse de croisière (m/s). */
  cruise: [number, number];
  /** Repeint à chaque instance (matériau « paint » / « body ») ; sinon couleur d'origine. */
  repaint: boolean;
  /** Fréquence relative dans la circulation. */
  weight: number;
  /** Exporté l'avant vers −z (sans `--flip` à l'export) : retourné au chargement. */
  reversed?: boolean;
}

const MODELS: ModelSpec[] = [
  // Vitesses de croisière (m/s) de routes de campagne et de bourgs : 36 à 68 km/h ; en virage, la vitesse est
  // en plus bornée par la courbure (Traffic.update, CORNER_ACCEL).
  { file: 'citadine', kind: 'car', cruise: [10, 14], repaint: true, weight: 2 },
  { file: 'berline', kind: 'car', cruise: [11, 16], repaint: true, weight: 3 },
  { file: 'suv', kind: 'car', cruise: [11, 15], repaint: true, weight: 2 },
  { file: 'porsche-911', kind: 'car', cruise: [13, 19], repaint: true, weight: 1 },
  { file: 'nissan-silvia', kind: 'car', cruise: [12, 17], repaint: true, weight: 1.5 },
  { file: 'bmw-733i', kind: 'car', cruise: [11, 16], repaint: false, weight: 1.5, reversed: true },
  { file: 'mercedes-c230', kind: 'car', cruise: [11, 16], repaint: false, weight: 1.5 },
  { file: 'lamborghini-aventador', kind: 'car', cruise: [13, 19], repaint: true, weight: 0.8 },
  { file: 'mclaren-720s', kind: 'car', cruise: [13, 19], repaint: true, weight: 0.8, reversed: true },
  { file: 'utilitaire', kind: 'van', cruise: [10, 14], repaint: false, weight: 1.5 },
  { file: 'tractor', kind: 'tractor', cruise: [6.5, 8.5], repaint: false, weight: 0 },
];

/** Teintes courantes sur les routes françaises (gris, blanc, noir dominent). */
const PAINTS = ['#d9dadb', '#f4f4f2', '#1b1c1e', '#6f7378', '#9da2a8', '#2b3a55', '#7b1e22', '#37502f', '#c2c6c9', '#173b6c', '#b5651d'];

/** Au-delà, modèle lointain (m, multiplié par `Traffic.lodScale`). */
const FAR_M = 45;
/** Accélération latérale maximale d'un véhicule en virage (m/s²) : conduite tranquille. */
const CORNER_ACCEL = 2.5;

interface Template {
  spec: ModelSpec;
  near: THREE.Object3D;
  far: THREE.Object3D | null;
  length: number;
  wheelRadius: number;
}

const templates: Template[] = [];
let loading: Promise<boolean> | null = null;

/** Charge les modèles une fois (facultatif : sans eux, primitives). */
export function loadVehicleModels(base = '/models/vehicles/'): Promise<boolean> {
  loading ??= (async () => {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const ktx2 = await sharedKtx2Loader();
    if (ktx2) loader.setKTX2Loader(ktx2);
    const results = await Promise.allSettled(
      MODELS.map(async (spec) => {
        const near = (await loader.loadAsync(`${base}${spec.file}.glb`)).scene;
        const far = await loader.loadAsync(`${base}${spec.file}.far.glb`).then(
          (g) => g.scene,
          () => null,
        );
        prepare(near, true);
        if (far) prepare(far, false);
        // Modèle d'un seul tenant (tracteur) : roues retrouvées dans le maillage pour qu'elles tournent.
        for (const root of far ? [near, far] : [near]) {
          let has = false;
          root.traverse((o) => (has ||= isWheel(o)));
          if (!has) {
            const n = splitWheelIslands(root);
            if (n && root === near) console.info(`Véhicule ${spec.file} : ${n} roues extraites du maillage`);
          }
        }
        const straightened: string[] = [];
        for (const root of far ? [near, far] : [near])
          root.traverse((o) => {
            const deg = isWheel(o) ? straightenWheel(o) : 0;
            if (deg) straightened.push(`${o.name} ${deg.toFixed(1)}°`);
          });
        if (straightened.length) console.info(`Véhicule ${spec.file} : roues redressées (${straightened.join(', ')})`);
        if (spec.reversed) for (const root of far ? [near, far] : [near]) turnAround(root);
        const size = new THREE.Box3().setFromObject(near).getSize(new THREE.Vector3());
        let wheelRadius = 0.33;
        // Rayon de chaque roue (une roue avant de tracteur fait la moitié d'une roue arrière) : chacune tourne à sa vitesse.
        for (const root of far ? [near, far] : [near])
          root.traverse((o) => {
            if (!isWheel(o)) return;
            const r = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).y / 2;
            if (r > 0.05) o.userData.radius = r;
            if (root === near) wheelRadius = r;
          });
        templates.push({ spec, near, far, length: size.z, wheelRadius });
      }),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) console.warn(`Véhicules : ${failed.length} modèle(s) indisponible(s), repli sur les primitives`, failed[0]);
    return templates.length > 0;
  })();
  return loading;
}

const WHEEL = /^wheel/i;
/** Nœud de roue le plus haut (ses sous-maillages, un par matériau, tournent avec lui). */
const isWheel = (o: THREE.Object3D) => WHEEL.test(o.name) && !(o.parent && WHEEL.test(o.parent.name));
const isPaint = (m: THREE.Material) => /paint|body|carros/i.test(m.name);

function prepare(root: THREE.Object3D, shadows: boolean): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
  });
}

/**
 * Roues d'un modèle d'un seul tenant (tracteur : un maillage « body », roues comprises) : elles ne tournaient
 * pas. Les triangles sont regroupés en pièces connexes (sommets fusionnés par position) ; une roue est une
 * pièce ronde de profil (hauteur ≈ longueur), plus fine que son diamètre et qui touche le bas du véhicule ;
 * jantes et moyeux centrés sur le même axe lui sont rattachés. Chaque roue devient un nœud « wheel_N » centré
 * sur son axe (enfant du maillage d'origine, dont ses triangles sont retirés). Renvoie le nombre de roues.
 */
export function splitWheelIslands(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
  const all = new THREE.Box3().setFromObject(root);
  const groundY = all.min.y;
  const height = all.max.y - all.min.y;
  let count = 0;
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const pos = g.getAttribute('position');
    const index = g.getIndex();
    if (!pos || !index) continue;
    // Sommets fusionnés par position (coutures d'UV ou de normales : mêmes points, sommets distincts).
    const key = new Map<string, number>();
    const canon = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const k = `${Math.round(v.x * 2e4)},${Math.round(v.y * 2e4)},${Math.round(v.z * 2e4)}`;
      let c = key.get(k);
      if (c === undefined) key.set(k, (c = i));
      canon[i] = c;
    }
    const parent = new Int32Array(pos.count).map((_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) x = parent[x] = parent[parent[x] as number] as number;
      return x;
    };
    const tris = index.count / 3;
    for (let t = 0; t < tris; t++) {
      const a = find(canon[index.getX(t * 3)] as number);
      for (const k of [1, 2]) {
        const b = find(canon[index.getX(t * 3 + k)] as number);
        if (a !== b) parent[b] = a;
      }
    }
    // Emprise (repère monde du modèle) de chaque pièce.
    const boxes = new Map<number, THREE.Box3>();
    const world = mesh.matrixWorld;
    for (let i = 0; i < pos.count; i++) {
      const r = find(canon[i] as number);
      let b = boxes.get(r);
      if (!b) boxes.set(r, (b = new THREE.Box3()));
      b.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(world));
    }
    const size = new THREE.Vector3();
    const wheels: Array<{ box: THREE.Box3; parts: Set<number> }> = [];
    for (const [r, b] of boxes) {
      b.getSize(size);
      const round = size.y > 0.3 && Math.abs(size.y - size.z) < 0.2 * size.y && size.x < 0.8 * size.y;
      if (round && b.min.y - groundY < 0.12 * height) wheels.push({ box: b.clone(), parts: new Set([r]) });
    }
    if (!wheels.length) continue;
    // Jantes, moyeux, écrous : pièces dont le centre est sur l'axe d'une roue et dans son emprise.
    const c = new THREE.Vector3();
    const wc = new THREE.Vector3();
    for (const [r, b] of boxes) {
      if (wheels.some((w) => w.parts.has(r))) continue;
      b.getCenter(c);
      for (const w of wheels) {
        w.box.getCenter(wc);
        const rad = (w.box.max.y - w.box.min.y) / 2;
        if (Math.abs(c.y - wc.y) < 0.15 * rad && Math.abs(c.z - wc.z) < 0.15 * rad && b.min.x >= w.box.min.x - 0.1 * rad && b.max.x <= w.box.max.x + 0.1 * rad && b.max.y <= w.box.max.y + 0.01) {
          w.parts.add(r);
          break;
        }
      }
    }
    // Triangles de chaque roue → nouveau maillage centré sur l'axe ; le reste garde ses triangles.
    const keep: number[] = [];
    const picked = wheels.map(() => [] as number[]);
    for (let t = 0; t < tris; t++) {
      const r = find(canon[index.getX(t * 3)] as number);
      const w = wheels.findIndex((x) => x.parts.has(r));
      const dst = w < 0 ? keep : (picked[w] as number[]);
      dst.push(index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2));
    }
    const toLocal = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    wheels.forEach((w, i) => {
      const wg = new THREE.BufferGeometry();
      for (const name of Object.keys(g.attributes)) wg.setAttribute(name, g.getAttribute(name));
      wg.setIndex(picked[i] as number[]);
      const sub = wg.toNonIndexed();
      // Positions quantifiées : en flottants, recentrées sur l'axe de la roue (repère du maillage).
      const center = w.box.getCenter(new THREE.Vector3()).applyMatrix4(toLocal);
      const p = sub.getAttribute('position');
      const f = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) v.fromBufferAttribute(p, k).sub(center).toArray(f, k * 3);
      sub.setAttribute('position', new THREE.BufferAttribute(f, 3));
      sub.computeBoundingBox();
      sub.computeBoundingSphere();
      const node = new THREE.Mesh(sub, mesh.material);
      node.name = `wheel_${count + i}`;
      node.castShadow = mesh.castShadow;
      node.receiveShadow = mesh.receiveShadow;
      node.position.copy(center);
      mesh.add(node);
    });
    g.setIndex(keep);
    count += wheels.length;
  }
  return count;
}

/**
 * Roue braquée dans le modèle d'origine (Porsche 911 : roues avant tournées d'une dizaine de degrés) : tournée
 * sur `rotation.x`, elle « voilait ». On cherche l'axe du moyeu (direction où le pneu est le plus fin, en
 * pivotant autour de la verticale) et l'on redresse la géométrie sur l'axe x du nœud, recentrée sur le moyeu
 * (le nœud est déplacé d'autant : la roue reste à sa place). Sans effet sur une roue déjà droite.
 */
export function straightenWheel(node: THREE.Object3D): number {
  node.updateMatrix();
  const meshes: THREE.Mesh[] = [];
  node.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
  if (!meshes.length) return 0;
  // Sommets dans le repère du nœud de roue.
  const pts: THREE.Vector3[] = [];
  const toNode = (m: THREE.Object3D) => {
    const mat = new THREE.Matrix4();
    for (let o: THREE.Object3D | null = m; o && o !== node; o = o.parent) mat.premultiply(o.matrix);
    return mat;
  };
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    const mat = toNode(m);
    const step = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat));
  }
  const extent = (ax: number, az: number) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      const s = p.x * ax + p.z * az;
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    return hi - lo;
  };
  let best = 0;
  let bestW = extent(1, 0);
  for (let deg = -25; deg <= 25; deg += 0.25) {
    const a = (deg * Math.PI) / 180;
    const w = extent(Math.cos(a), Math.sin(a));
    if (w < bestW - 1e-9) {
      bestW = w;
      best = a;
    }
  }
  if (Math.abs(best) < (1 * Math.PI) / 180) return 0;
  // Rotation qui ramène l'axe trouvé (cos a, 0, sin a) sur x, puis recentrage sur le moyeu.
  const rot = new THREE.Matrix4().makeRotationY(best);
  const box = new THREE.Box3();
  for (const p of pts) box.expandByPoint(p.clone().applyMatrix4(rot));
  const center = box.getCenter(new THREE.Vector3());
  const fix = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z).multiply(rot);
  for (const m of meshes) {
    const g = m.geometry.clone();
    // Attributs quantifiés (entiers normalisés) : passés en flottants avant d'être transformés.
    for (const name of ['position', 'normal'] as const) {
      const at = g.getAttribute(name);
      if (!at || at.array instanceof Float32Array) continue;
      const f = new Float32Array(at.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < at.count; i++) v.fromBufferAttribute(at, i).toArray(f, i * 3);
      g.setAttribute(name, new THREE.BufferAttribute(f, 3));
    }
    const mat = toNode(m);
    g.applyMatrix4(new THREE.Matrix4().copy(mat).invert().multiply(fix).multiply(mat));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    m.geometry = g;
  }
  // Le moyeu était en R⁻¹·center dans l'ancien repère du nœud : le nœud y est déplacé (la roue reste en place).
  const hub = center.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(-best));
  node.position.add(hub.applyMatrix3(new THREE.Matrix3().setFromMatrix4(node.matrix)));
  node.updateMatrix();
  return (best * 180) / Math.PI;
}

const HALF_TURN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/**
 * Remet l'avant vers +z : chaque nœud de premier niveau (caisse, roues) fait un demi-tour autour de
 * l'axe vertical. Les roues tournent toujours dans le bon sens : `rotation.x` s'applique en dernier
 * (ordre XYZ), donc autour de l'axe transversal du véhicule.
 */
function turnAround(root: THREE.Object3D): void {
  for (const c of root.children) {
    c.position.set(-c.position.x, c.position.y, -c.position.z);
    c.quaternion.premultiply(HALF_TURN);
  }
}

/** Repeint les matériaux de carrosserie d'une copie (matériaux clonés, partagés entre ses niveaux). */
function repaint(roots: THREE.Object3D[], color: string): void {
  const cache = new Map<THREE.Material, THREE.Material>();
  for (const root of roots)
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material) || !isPaint(mesh.material)) return;
      let m = cache.get(mesh.material);
      if (!m) {
        m = mesh.material.clone();
        (m as THREE.MeshStandardMaterial).color.set(color);
        cache.set(mesh.material, m);
      }
      mesh.material = m;
    });
}

interface Built {
  kind: VehicleKind;
  group: THREE.Object3D;
  wheels: THREE.Object3D[];
  length: number;
  wheelRadius: number;
  cruise: [number, number];
}

function buildModel(t: Template, color: string, lodScale: number): Built {
  const near = t.near.clone(true);
  const far = t.far?.clone(true) ?? null;
  if (t.spec.repaint) repaint(far ? [near, far] : [near], color);
  const wheels: THREE.Object3D[] = [];
  for (const root of far ? [near, far] : [near]) root.traverse((o) => isWheel(o) && wheels.push(o));
  let group: THREE.Object3D = near;
  if (far) {
    const lod = new THREE.LOD();
    lod.addLevel(near, 0);
    lod.addLevel(far, FAR_M * lodScale);
    group = lod;
  }
  return { kind: t.spec.kind, group, wheels, length: t.length, wheelRadius: t.wheelRadius, cruise: t.spec.cruise };
}

function box(w: number, h: number, l: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, l).translate(x, y, z);
}

/** Repli en primitives : caisse, vitrage, roues (avant vers +z). */
function buildPrimitive(kind: VehicleKind, color: string): Built {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardNodeMaterial({ color: kind === 'tractor' ? '#2e7d32' : color, roughness: 0.35, metalness: 0.5 });
  const glass = new THREE.MeshStandardNodeMaterial({ color: '#1a2330', roughness: 0.1, metalness: 0.3 });
  const tire = new THREE.MeshStandardNodeMaterial({ color: '#141414', roughness: 0.9 });
  const wheels: THREE.Object3D[] = [];
  const add = (geo: THREE.BufferGeometry, m: THREE.Material) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const wheel = (r: number, w: number, x: number, z: number) => {
    const mesh = add(new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2), tire);
    mesh.position.set(x, r, z);
    wheels.push(mesh);
  };
  if (kind === 'tractor') {
    add(box(1.2, 1.0, 2.2, 0, 1.2, 0.6), paint);
    add(box(1.0, 1.3, 1.1, 0, 2.2, -0.5), paint);
    add(box(0.95, 0.9, 0.05, 0, 2.3, 0.06), glass);
    wheel(0.75, 0.45, 0.85, -0.7);
    wheel(0.75, 0.45, -0.85, -0.7);
    wheel(0.42, 0.3, 0.7, 1.3);
    wheel(0.42, 0.3, -0.7, 1.3);
    return { kind, group: g, wheels, length: 4.2, wheelRadius: 0.6, cruise: [6.5, 8.5] };
  }
  const long = kind === 'van' ? 4.9 : 4.2;
  const tall = kind === 'van' ? 1.25 : 0.7;
  add(box(1.8, 0.75, long, 0, 0.7, 0), paint);
  add(box(1.6, tall, kind === 'van' ? 3.6 : 2.2, 0, 1.07 + tall / 2, kind === 'van' ? -0.4 : -0.2), paint);
  add(box(1.62, tall * 0.7, 0.05, 0, 1.07 + tall / 2, kind === 'van' ? 1.42 : 0.92), glass);
  for (const z of [long / 2 - 0.8, -long / 2 + 0.8]) {
    wheel(0.33, 0.25, 0.85, z);
    wheel(0.33, 0.25, -0.85, z);
  }
  return { kind, group: g, wheels, length: long, wheelRadius: 0.33, cruise: kind === 'van' ? [13, 17] : [13, 19] };
}

interface Vehicle {
  kind: VehicleKind;
  mesh: THREE.Object3D;
  wheels: THREE.Object3D[];
  length: number;
  wheelRadius: number;
  /** Distance « déroulée » sur l'itinéraire (m), centre du véhicule. */
  d: number;
  /** +1 : même sens que les coureurs ; −1 : en face. */
  sens: 1 | -1;
  cruise: number;
  speed: number;
  lateral: number;
  /** Vitesse dans le repère monde (m/s), pour le son (Doppler). */
  vx: number;
  vz: number;
  /** Sur un chemin non revêtu , voie étroite (piste cyclable) ou (tracteur) près d'une commune : masqué, muet, sans aspiration. */
  onTrack?: boolean;
}

/** Véhicules pour une densité donnée (`QualitySettings.trafficDensity`, 0–1) : 2 à 6. */
export function vehicleCount(density: number): number {
  return density <= 0 ? 0 : Math.max(1, Math.round(6 * Math.min(density, 1.5)));
}

export class Traffic {
  readonly group = new THREE.Group();
  private readonly vehicles: Vehicle[] = [];
  private readonly track: RouteTrack;
  private readonly r = rng(77);
  /** Communes (bourgs, villes) près desquelles les tracteurs n'apparaissent pas. */
  private urban: ReadonlyArray<{ x: number; z: number }> = [];
  private readonly sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };

  /** @param lodScale facteur des distances de niveau de détail (préréglage graphique) */
  constructor(track: RouteTrack, density = 1, startD = 0, lodScale = 1) {
    this.track = track;
    this.group.name = 'traffic';
    const n = vehicleCount(density);
    // Un tracteur dès 3 véhicules ; le reste tiré selon les fréquences, sans répéter de suite.
    const pool = templates.filter((t) => t.spec.weight > 0);
    const total = pool.reduce((s, t) => s + t.spec.weight, 0);
    let last: Template | undefined;
    for (let i = 0; i < n; i++) {
      const color = PAINTS[Math.floor(this.r() * PAINTS.length)] as string;
      let built: Built;
      if (i === 1 && n >= 3) {
        const t = templates.find((m) => m.spec.kind === 'tractor');
        built = t ? buildModel(t, color, lodScale) : buildPrimitive('tractor', color);
      } else if (pool.length) {
        let t: Template = pool[0] as Template;
        for (let k = 0; k < 4 && (k === 0 || t === last); k++) {
          let x = this.r() * total;
          t = pool.find((m) => (x -= m.spec.weight) < 0) ?? (pool[0] as Template);
        }
        last = t;
        built = buildModel(t, color, lodScale);
      } else built = buildPrimitive(i % 4 === 3 ? 'van' : 'car', color);
      const sens: 1 | -1 = i % 2 ? -1 : 1;
      const cruise = built.cruise[0] + this.r() * (built.cruise[1] - built.cruise[0]);
      const d = startD + (sens > 0 ? -150 : 300) - i * 180;
      this.vehicles.push({ kind: built.kind, mesh: built.group, wheels: built.wheels, length: built.length, wheelRadius: built.wheelRadius, d, sens, cruise, speed: cruise, lateral: this.laneOf(sens), vx: 0, vz: 0 });
      this.group.add(built.group);
    }
  }

  /** Largeur de chaussée sous 4,8 m à la distance d de l'itinéraire. */
  private narrowAt(d: number): boolean {
    const w = this.track.route.roadWidths?.find((r) => d >= r.startM && d <= r.endM)?.widthM ?? this.track.route.roadWidthM;
    return w < 4.8;
  }

  setPlaces(places: ReadonlyArray<{ kind: string; x: number; z: number }> | undefined): void {
    this.urban = (places ?? []).filter((p) => p.kind === 'town' || p.kind === 'city' || p.kind === 'village' || p.kind === 'suburb');
  }

  private laneOf(sens: 1 | -1): number {
    return sens * (this.track.route.roadWidthM / 4 + 0.2);
  }

  /**
   * Aspiration (0–0,45) derrière le véhicule le plus abritant qui roule dans le même sens.
   * `distM` repère l'avant du vélo, `d` d'un véhicule son centre.
   */
  draftFor(distM: number, lateral: number): number {
    let best = 0;
    for (const v of this.vehicles) {
      if (v.sens < 0 || v.speed < 2 || v.onTrack) continue;
      const r = vehicleDraftReduction(v.kind, v.d - v.length / 2 - distM, lateral - v.lateral);
      if (r > best) best = r;
    }
    return best;
  }

  /** @param riders distances déroulées et décalages des coureurs (joueur compris) */
  update(dt: number, player: { distM: number }, riders: Array<{ distM: number; lateral: number; speedMs: number }>, playerDir: 1 | -1 = 1): void {
    const L = this.track.length;
    const me = riders[0];
    const half = this.track.route.roadWidthM / 4;
    // Véhicules masqués (chemin, voie étroite, tracteur près d'un bourg) : ni suivis ni écartés, on ne les voit pas.
    const present = (o: Vehicle) => o.mesh.visible;
    for (const v of this.vehicles) {
      // Recyclage : un véhicule trop loin réapparaît hors de vue, derrière (même sens) ou devant (en face),
      // à l'écart des véhicules de sa voie.
      const rel = v.d - player.distM;
      if (rel > 700 || rel < -700) {
        v.d = player.distM + (v.sens > 0 ? -350 - this.r() * 300 : 450 + this.r() * 400);
        for (let k = 0; k < 10 && this.vehicles.some((o) => o !== v && o.sens === v.sens && Math.abs(o.d - v.d) < 60); k++) v.d -= v.sens * 60;
        v.speed = v.cruise;
        v.lateral = this.laneOf(v.sens);
      }
      let target = v.cruise;
      // Virages : vitesse bornée pour rester sous CORNER_ACCEL d'accélération latérale, courbure lue jusqu'à 40 m
      // devant (le véhicule freine avant le virage, pas dedans).
      let kappa = 0;
      for (let k = 0; k <= 40; k += 8) kappa = Math.max(kappa, Math.abs(this.track.curvatureAt(((v.d + v.sens * k) % L + L) % L, v.cruise)));
      if (kappa > 1e-4) target = Math.min(target, Math.max(4, Math.sqrt(CORNER_ACCEL / kappa)));
      let lateralTarget = this.laneOf(v.sens);
      let brake = 4;
      if (v.sens > 0) {
        // Coureur devant à moins de 60 m : on déboîte s'il n'y a personne en face, sinon on patiente.
        let ahead: (typeof riders)[number] | undefined;
        for (const r of riders) if (r.distM > v.d && r.distM - v.d < 60 && (!ahead || r.distM < ahead.distM)) ahead = r;
        if (ahead) {
          const oncoming = this.vehicles.some((o) => o.sens < 0 && o.d > v.d && o.d - v.d < 220);
          if (oncoming) target = Math.min(target, ahead.speedMs);
          // Dépassement : à 1,7 m au moins du coureur (qui peut lui-même rouler au milieu ou à gauche).
          else lateralTarget = Math.max(-this.track.route.roadWidthM / 2 - 0.3, Math.min(-half - 0.3, ahead.lateral - 1.7));
          // Pas encore déboîté : on reste derrière, à sa vitesse, jusqu'à avoir la place de passer.
          const gapFront = ahead.distM - 1.8 - (v.d + v.length / 2);
          if (Math.abs(v.lateral - ahead.lateral) < 1.5 && gapFront < 14) {
            target = Math.min(target, ahead.speedMs);
            if (gapFront < 5) brake = 8;
          }
        }
      } else {
        // En face : ralentit quand un coureur occupe le milieu de la chaussée, s'arrête s'il est dans sa voie.
        if (riders.some((r) => Math.abs(r.distM - v.d) < 40 && r.lateral < 0.3)) target = Math.min(target, 9);
        if (riders.some((r) => v.d - v.length / 2 - r.distM > 0 && v.d - v.length / 2 - r.distM < 35 && Math.abs(r.lateral - v.lateral) < RIDER_CLEAR_LAT + 0.3)) {
          target = 0;
          brake = 8;
        }
      }
      // Véhicule de devant dans le même sens : vitesse qui permet de s'arrêter derrière lui s'il pile.
      const lead = present(v) ? leaderOf(v, this.vehicles, present) : null;
      if (lead) {
        const safe = followSpeed(lead.gap, lead.leader.speed);
        if (safe < target) target = safe;
        if (safe < v.speed) brake = 8;
      }
      // Voiture en face dans notre voie (dépassement en cours) : on ralentit et on se serre.
      if (present(v) && oncomingInLane(v, this.vehicles, 120, present)) {
        target = Math.min(target, 6);
        brake = 8;
      }
      // Joueur de face dans notre voie : on s'arrête net (le vélo est déporté par `yieldPush`).
      if (me && v.sens !== playerDir) {
        const gap = (me.distM - v.d) * v.sens;
        if (gap > 0 && gap < 45 && Math.abs(me.lateral - v.lateral) < 1.8) {
          target = 0;
          brake = 8;
        }
      }
      v.speed += Math.max(-brake * dt, Math.min(2 * dt, target - v.speed));
      v.speed = Math.max(0, v.speed);
      // Sorti de sa voie avec quelqu'un en face : retour franc.
      const back = lateralTarget === this.laneOf(v.sens) && Math.abs(v.lateral - lateralTarget) > 0.5 && oncomingInLane(v, this.vehicles, 220, present);
      v.lateral += (lateralTarget - v.lateral) * Math.min(1, dt * (back ? 2.5 : 0.9));
      v.d += v.sens * v.speed * dt;
    }
    // Aucun chevauchement, quoi qu'il arrive (freinage trop court, véhicule réapparu, dépassement surpris).
    keepApart(this.vehicles, (s) => this.laneOf(s), present);
    // Ni à travers un coureur : le joueur (dans son sens de marche), les coureurs IA et les autres joueurs.
    keepClearOfRiders(this.vehicles, riders.map((r, i) => (i === 0 ? { ...r, dir: playerDir } : r)), present);
    for (const v of this.vehicles) {
      // Itinéraire ouvert (monde ouvert, montée) : pas de véhicule au-delà des extrémités connues.
      const outside = !this.track.route.loop && (v.d < 0 || v.d > L);
      // Pas de voiture sur un chemin non revêtu : le véhicule disparaît tant qu'il y est.
      const surface = outside ? undefined : this.track.surfaceAt(((v.d % L) + L) % L);
      v.onTrack = surface !== undefined && UNPAVED_SURFACES.has(surface);
      // Pistes cyclables (Longchamp…) et voies étroites : pas de voiture sous 4,8 m de large.
      if (!v.onTrack && !outside && this.narrowAt(((v.d % L) + L) % L)) v.onTrack = true;
      // Pas de tracteur près d'une commune : il disparaît à moins de 1,2 km d'un bourg ou d'une ville.
      if (v.kind === 'tractor' && !v.onTrack && !outside && this.urban.length) {
        const q = this.track.positionAt(((v.d % L) + L) % L, 0, this.sample);
        v.onTrack = this.urban.some((u) => (u.x - q.x) ** 2 + (u.z - q.z) ** 2 < 1200 * 1200);
      }
      v.mesh.visible = !outside && !v.onTrack;
      if (outside || v.onTrack) continue;
      // Trajectoire en arc, comme les coureurs : plus de pivot brutal à chaque sommet du tracé.
      const p = this.track.linePositionAt(((v.d % L) + L) % L, v.lateral, v.speed, this.sample);
      // Pneus posés sur la chaussée, surélevée de 6 cm comme pour les coureurs (road.ts).
      v.mesh.position.set(p.x, p.y + 0.06, p.z);
      v.vx = p.dirX * v.sens * v.speed;
      v.vz = p.dirZ * v.sens * v.speed;
      v.mesh.rotation.set(0, Math.atan2(p.dirX, p.dirZ) + (v.sens < 0 ? Math.PI : 0), 0);
      v.mesh.rotateX(-Math.atan(p.grade / 100) * v.sens);
      // Rotation affichée plafonnée (≈ 17° par image) : au-delà, les jantes semblent tourner à l'envers
      // (effet stroboscopique, 48° par image à 54 km/h et 60 images/s) ; plus lent mais dans le bon sens.
      // Chaque roue à sa vitesse (rayon propre : petites roues avant d'un tracteur, grandes à l'arrière).
      for (const w of v.wheels) w.rotation.x += Math.min((v.speed / ((w.userData.radius as number | undefined) ?? v.wheelRadius)) * dt, 0.3);
    }
  }

  /**
   * Déport latéral (m/s, signé) à appliquer au joueur qui roule en face d'un véhicule arrêté devant lui :
   * le vélo est ramené vers sa voie pour repartir. 0 si rien ne bloque.
   */
  yieldPush(distM: number, lateral: number, dir: 1 | -1): number {
    for (const v of this.vehicles) {
      if (v.sens === dir || v.speed > 2) continue;
      const gap = (distM - v.d) * v.sens;
      if (gap > -2 && gap < 14 && Math.abs(lateral - v.lateral) < 1.8) return dir * 2.5;
    }
    return 0;
  }

  /** Véhicules pour le son (position, vitesse) ; `id` stable = rang du véhicule. */
  audible(): VehicleSound[] {
    return this.vehicles.flatMap((v, id) => (v.onTrack ? [] : [{ id, kind: v.kind, x: v.mesh.position.x, z: v.mesh.position.z, vx: v.vx, vz: v.vz }]));
  }
}
