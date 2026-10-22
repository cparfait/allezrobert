import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { RouteTrack } from '@allezrobert/shared';
import { rng } from '../engine/noise.ts';

type Kind = 'car' | 'van' | 'tractor';

interface Vehicle {
  kind: Kind;
  mesh: THREE.Group;
  wheels: THREE.Object3D[];
  /** Distance « déroulée » sur l'itinéraire (m). */
  d: number;
  /** +1 : même sens que les coureurs ; −1 : en face. */
  sens: 1 | -1;
  cruise: number;
  speed: number;
  lateral: number;
}

interface Walker {
  mesh: THREE.Group;
  d: number;
  lateral: number;
  speed: number;
  phase: number;
}

const CAR_COLORS = ['#c0392b', '#2c3e50', '#ecf0f1', '#7f8c8d', '#1f6feb', '#16a085', '#f1c40f', '#111111', '#8e44ad'];

function box(w: number, h: number, l: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, l).translate(x, y, z);
}

/** Véhicule en primitives : caisse, vitrage, roues (repère : +z avant). */
/**
 * Modèles de véhicules CC0 (Kenney Car Kit, voir ASSETS_LICENSES.md), chargés une fois.
 * Longueur réelle visée par modèle (m) : les modèles sont remis à l'échelle au chargement.
 */
const VEHICLE_MODELS: Array<{ file: string; kind: Kind; lengthM: number }> = [
  { file: 'sedan.glb', kind: 'car', lengthM: 4.5 },
  { file: 'hatchback-sports.glb', kind: 'car', lengthM: 4.1 },
  { file: 'suv.glb', kind: 'car', lengthM: 4.6 },
  { file: 'delivery.glb', kind: 'van', lengthM: 5.4 },
  { file: 'tractor.glb', kind: 'tractor', lengthM: 4.2 },
];
const templates = new Map<string, THREE.Object3D>();

export async function loadVehicleModels(base = '/models/vehicles/'): Promise<boolean> {
  const loader = new GLTFLoader();
  try {
    await Promise.all(
      VEHICLE_MODELS.map(async (m) => {
        const gltf = await loader.loadAsync(base + m.file);
        const root = gltf.scene;
        // Échelle : la plus grande dimension horizontale devient la longueur réelle du véhicule.
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const s = m.lengthM / Math.max(size.x, size.z);
        root.scale.setScalar(s);
        // Avant du véhicule vers +z (sens de marche) si le modèle est allongé selon x.
        if (size.x > size.z) root.rotation.y = -Math.PI / 2;
        root.updateMatrixWorld(true);
        const b2 = new THREE.Box3().setFromObject(root);
        root.position.y -= b2.min.y;
        root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          // Matériau WebGPU avec la même palette de couleurs (texture du kit).
          const src = mesh.material as THREE.MeshStandardMaterial;
          mesh.material = new THREE.MeshStandardNodeMaterial({ map: src.map ?? null, color: src.color, roughness: 0.45, metalness: 0.25 });
        });
        const wrap = new THREE.Group();
        // Axe des essieux dans le repère du modèle : perpendiculaire à sa longueur.
        wrap.userData.axle = size.x > size.z ? 'z' : 'x';
        wrap.add(root);
        templates.set(m.file, wrap);
      }),
    );
    return true;
  } catch (e) {
    console.warn('Modèles de véhicules indisponibles, repli sur les primitives', e);
    return false;
  }
}

/** Instance d'un modèle chargé : les roues (nœuds « wheel-* ») tournent avec la vitesse. */
function modelVehicle(kind: Kind, pick: number): { group: THREE.Group; wheels: THREE.Object3D[] } | null {
  const candidates = VEHICLE_MODELS.filter((m) => m.kind === kind && templates.has(m.file));
  const m = candidates[pick % Math.max(candidates.length, 1)];
  if (!m) return null;
  const group = (templates.get(m.file) as THREE.Object3D).clone(true) as THREE.Group;
  const wheels: THREE.Object3D[] = [];
  group.traverse((o) => {
    if (/^wheel/i.test(o.name)) {
      o.userData.axle = group.userData.axle;
      wheels.push(o);
    }
  });
  return { group, wheels };
}

function buildVehicle(kind: Kind, color: string, pick = 0): { group: THREE.Group; wheels: THREE.Object3D[] } {
  const model = modelVehicle(kind, pick);
  if (model) return model;
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardNodeMaterial({ color, roughness: 0.35, metalness: 0.5 });
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
    add(mergeGeometries([box(1.2, 1.0, 2.2, 0, 1.2, 0.6), box(1.0, 1.3, 1.1, 0, 2.2, -0.5)]) as THREE.BufferGeometry, paint);
    add(box(0.95, 0.9, 0.05, 0, 2.3, 0.06), glass);
    wheel(0.75, 0.45, 0.85, -0.7);
    wheel(0.75, 0.45, -0.85, -0.7);
    wheel(0.42, 0.3, 0.7, 1.3);
    wheel(0.42, 0.3, -0.7, 1.3);
  } else {
    const long = kind === 'van' ? 4.9 : 4.2;
    const tall = kind === 'van' ? 1.25 : 0.7;
    add(box(1.8, 0.75, long, 0, 0.7, 0), paint);
    add(box(1.6, tall, kind === 'van' ? 3.6 : 2.2, 0, 1.07 + tall / 2, kind === 'van' ? -0.4 : -0.2), paint);
    add(box(1.62, tall * 0.7, 0.05, 0, 1.07 + tall / 2, kind === 'van' ? 1.42 : 0.92), glass);
    for (const z of [long / 2 - 0.8, -long / 2 + 0.8]) {
      wheel(0.33, 0.25, 0.85, z);
      wheel(0.33, 0.25, -0.85, z);
    }
  }
  return { group: g, wheels };
}

/** Piéton : corps, tête ; balancement de marche animé sur le CPU (quelques unités seulement). */
function buildWalker(color: string, skin: string): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 3, 8).translate(0, 0.75, 0), new THREE.MeshStandardNodeMaterial({ color, roughness: 0.8 }));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8).translate(0, 1.42, 0), new THREE.MeshStandardNodeMaterial({ color: skin, roughness: 0.7 }));
  body.castShadow = head.castShadow = true;
  g.add(body, head);
  return g;
}

/**
 * Monde vivant peu coûteux, dans le même repère que les coureurs (distance + décalage) :
 * voitures et camionnettes qui doublent en s'écartant (et patientent si quelqu'un arrive en
 * face), circulation en sens inverse, tracteur ; piétons sur les bas-côtés des villages.
 */
export class Traffic {
  readonly group = new THREE.Group();
  private readonly vehicles: Vehicle[] = [];
  private readonly walkers: Walker[] = [];
  private readonly track: RouteTrack;
  private readonly r = rng(77);
  private readonly sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };

  constructor(track: RouteTrack, density = 1) {
    this.track = track;
    this.group.name = 'traffic';
    const n = Math.round(6 * density);
    for (let i = 0; i < n; i++) {
      const kind: Kind = i === 0 ? 'tractor' : i % 4 === 0 ? 'van' : 'car';
      const { group, wheels } = buildVehicle(kind, kind === 'tractor' ? '#2e7d32' : (CAR_COLORS[i % CAR_COLORS.length] as string), i);
      const sens: 1 | -1 = i % 2 ? -1 : 1;
      const cruise = kind === 'tractor' ? 7 : 13 + this.r() * 6;
      this.vehicles.push({ kind, mesh: group, wheels, d: (sens > 0 ? -150 : 300) - i * 180, sens, cruise, speed: cruise, lateral: this.laneOf(sens) });
      this.group.add(group);
    }
    // Piétons : autour des villages traversés.
    for (const lm of track.route.landmarks ?? []) {
      for (let k = 0; k < 2; k++) {
        const m = buildWalker(CAR_COLORS[(k * 3 + lm.name.length) % CAR_COLORS.length] as string, k ? '#e0ac69' : '#f1c27d');
        const side = k ? 1 : -1;
        this.walkers.push({ mesh: m, d: lm.d + (this.r() - 0.5) * 120, lateral: side * (track.route.roadWidthM / 2 + 1.3), speed: (this.r() > 0.5 ? 1 : -1) * (1.1 + this.r() * 0.4), phase: this.r() * 6 });
        this.group.add(m);
      }
    }
  }

  private laneOf(sens: 1 | -1): number {
    return sens * (this.track.route.roadWidthM / 4 + 0.2);
  }

  /** @param riders distances déroulées et décalages des coureurs (joueur compris) */
  update(dt: number, player: { distM: number }, riders: Array<{ distM: number; lateral: number; speedMs: number }>): void {
    const L = this.track.length;
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
        const ahead = riders.filter((r) => r.distM > v.d && r.distM - v.d < 60).sort((a, b) => a.distM - b.distM)[0];
        if (ahead) {
          const oncoming = this.vehicles.some((o) => o.sens < 0 && o.d > v.d && o.d - v.d < 220);
          if (oncoming) {
            target = Math.min(target, ahead.speedMs);
          } else lateralTarget = -this.track.route.roadWidthM / 4 - 0.3;
        }
        // Pas de collision avec un véhicule devant dans le même sens.
        const car = this.vehicles.find((o) => o !== v && o.sens > 0 && o.d > v.d && o.d - v.d < 14);
        if (car) target = Math.min(target, car.speed);
      } else {
        // En face : ralentit quand un coureur occupe le milieu de la chaussée.
        const near = riders.some((r) => Math.abs(r.distM - v.d) < 40 && r.lateral < 0.3);
        if (near) target = Math.min(target, 9);
      }
      v.speed += Math.max(-4 * dt, Math.min(2 * dt, target - v.speed));
      v.lateral += (lateralTarget - v.lateral) * Math.min(1, dt * 0.9);
      v.d += v.sens * v.speed * dt;
      const p = this.track.positionAt(((v.d % L) + L) % L, v.lateral, this.sample);
      v.mesh.position.set(p.x, p.y + 0.02, p.z);
      v.mesh.rotation.set(0, Math.atan2(p.dirX, p.dirZ) + (v.sens < 0 ? Math.PI : 0), 0);
      v.mesh.rotateX(-Math.atan(p.grade / 100) * v.sens);
      for (const w of v.wheels) {
        const spin = (v.speed / (v.kind === 'tractor' ? 0.6 : 0.33)) * dt;
        if (w.userData.axle === 'z') w.rotation.z -= spin;
        else w.rotation.x += spin;
      }
    }
    for (const w of this.walkers) {
      w.d += w.speed * dt;
      w.phase += dt * 7;
      const p = this.track.positionAt(((w.d % L) + L) % L, w.lateral, this.sample);
      w.mesh.position.set(p.x, p.y + Math.abs(Math.sin(w.phase)) * 0.04, p.z);
      w.mesh.rotation.set(0, Math.atan2(p.dirX, p.dirZ) + (w.speed < 0 ? Math.PI : 0), Math.sin(w.phase) * 0.04);
    }
  }
}
