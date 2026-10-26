import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { RouteTrack } from '@allezrobert/shared';
import { vehicleDraftReduction, type VehicleKind } from '@allezrobert/physics';
import { rng } from '../engine/noise.ts';
import { sharedKtx2Loader } from '../engine/textures.ts';
import type { VehicleSound } from '../audio/soundscape.ts';
import { UNPAVED_SURFACES } from './dust.ts';

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
}

const MODELS: ModelSpec[] = [
  { file: 'citadine', kind: 'car', cruise: [12, 17], repaint: true, weight: 2 },
  { file: 'berline', kind: 'car', cruise: [14, 20], repaint: true, weight: 3 },
  { file: 'suv', kind: 'car', cruise: [13, 19], repaint: true, weight: 2 },
  { file: 'porsche-911', kind: 'car', cruise: [17, 24], repaint: true, weight: 1 },
  { file: 'nissan-silvia', kind: 'car', cruise: [15, 21], repaint: true, weight: 1.5 },
  { file: 'bmw-733i', kind: 'car', cruise: [14, 20], repaint: false, weight: 1.5 },
  { file: 'mercedes-c230', kind: 'car', cruise: [14, 20], repaint: false, weight: 1.5 },
  { file: 'lamborghini-aventador', kind: 'car', cruise: [17, 25], repaint: true, weight: 0.8 },
  { file: 'mclaren-720s', kind: 'car', cruise: [17, 25], repaint: true, weight: 0.8 },
  { file: 'de-tomaso-p72', kind: 'car', cruise: [16, 23], repaint: false, weight: 0.6 },
  { file: 'utilitaire', kind: 'van', cruise: [13, 17], repaint: false, weight: 1.5 },
  { file: 'tractor', kind: 'tractor', cruise: [6.5, 8.5], repaint: false, weight: 0 },
];

/** Teintes courantes sur les routes françaises (gris, blanc, noir dominent). */
const PAINTS = ['#d9dadb', '#f4f4f2', '#1b1c1e', '#6f7378', '#9da2a8', '#2b3a55', '#7b1e22', '#37502f', '#c2c6c9', '#173b6c', '#b5651d'];

/** Au-delà, modèle lointain (m, multiplié par `Traffic.lodScale`). */
const FAR_M = 45;

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
        const size = new THREE.Box3().setFromObject(near).getSize(new THREE.Vector3());
        let wheelRadius = 0.33;
        near.traverse((o) => {
          if (isWheel(o)) wheelRadius = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).y / 2;
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
  /** Sur un chemin non revêtu ou (tracteur) près d'une commune : masqué, muet, sans aspiration. */
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
    for (const v of this.vehicles) {
      // Recyclage : un véhicule trop loin réapparaît hors de vue, derrière (même sens) ou devant (en face).
      const rel = v.d - player.distM;
      if (rel > 700 || rel < -700) {
        v.d = player.distM + (v.sens > 0 ? -350 - this.r() * 300 : 450 + this.r() * 400);
        v.speed = v.cruise;
        v.lateral = this.laneOf(v.sens);
      }
      let target = v.cruise;
      let lateralTarget = this.laneOf(v.sens);
      if (v.sens > 0) {
        // Coureur devant à moins de 60 m : on déboîte s'il n'y a personne en face, sinon on patiente.
        let ahead: (typeof riders)[number] | undefined;
        for (const r of riders) if (r.distM > v.d && r.distM - v.d < 60 && (!ahead || r.distM < ahead.distM)) ahead = r;
        if (ahead) {
          const oncoming = this.vehicles.some((o) => o.sens < 0 && o.d > v.d && o.d - v.d < 220);
          if (oncoming) target = Math.min(target, ahead.speedMs);
          else lateralTarget = -half - 0.3;
        }
        // Pas de collision avec un véhicule devant dans le même sens.
        const car = this.vehicles.find((o) => o !== v && o.sens > 0 && o.d > v.d && o.d - v.d < (o.length + v.length) / 2 + 6);
        if (car) target = Math.min(target, car.speed);
      } else {
        // En face : ralentit quand un coureur occupe le milieu de la chaussée.
        if (riders.some((r) => Math.abs(r.distM - v.d) < 40 && r.lateral < 0.3)) target = Math.min(target, 9);
      }
      // Joueur de face dans notre voie : on s'arrête net (le vélo est déporté par `yieldPush`).
      let brake = 4;
      if (me && v.sens !== playerDir) {
        const gap = (me.distM - v.d) * v.sens;
        if (gap > 0 && gap < 45 && Math.abs(me.lateral - v.lateral) < 1.8) {
          target = 0;
          brake = 8;
        }
      }
      v.speed += Math.max(-brake * dt, Math.min(2 * dt, target - v.speed));
      v.lateral += (lateralTarget - v.lateral) * Math.min(1, dt * 0.9);
      v.d += v.sens * v.speed * dt;
      // Itinéraire ouvert (monde ouvert, montée) : pas de véhicule au-delà des extrémités connues.
      const outside = !this.track.route.loop && (v.d < 0 || v.d > L);
      // Pas de voiture sur un chemin non revêtu : le véhicule disparaît tant qu'il y est.
      const surface = outside ? undefined : this.track.surfaceAt(((v.d % L) + L) % L);
      v.onTrack = surface !== undefined && UNPAVED_SURFACES.has(surface);
      // Pas de tracteur près d'une commune : il disparaît à moins de 1,2 km d'un bourg ou d'une ville.
      if (v.kind === 'tractor' && !v.onTrack && !outside && this.urban.length) {
        const q = this.track.positionAt(((v.d % L) + L) % L, 0, this.sample);
        v.onTrack = this.urban.some((u) => (u.x - q.x) ** 2 + (u.z - q.z) ** 2 < 1200 * 1200);
      }
      v.mesh.visible = !outside && !v.onTrack;
      if (outside || v.onTrack) continue;
      const p = this.track.positionAt(((v.d % L) + L) % L, v.lateral, this.sample);
      v.mesh.position.set(p.x, p.y + 0.02, p.z);
      v.vx = p.dirX * v.sens * v.speed;
      v.vz = p.dirZ * v.sens * v.speed;
      v.mesh.rotation.set(0, Math.atan2(p.dirX, p.dirZ) + (v.sens < 0 ? Math.PI : 0), 0);
      v.mesh.rotateX(-Math.atan(p.grade / 100) * v.sens);
      const spin = (v.speed / v.wheelRadius) * dt;
      for (const w of v.wheels) w.rotation.x += spin;
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
