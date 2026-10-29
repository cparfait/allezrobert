import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/**
 * Animaux de ferme animés du style jeu vidéo : vache, cheval et mouton de Quaternius (Farm Animal Pack, CC0,
 * voir ASSETS_LICENSES.md et tools/blender/convert_quaternius_animals.py), à la place des troupeaux en blocs
 * de roadsideLife.ts. Maillages squelettés à facettes (600 à 800 triangles) : chaque animal a sa copie et
 * son AnimationMixer, mis à jour seulement près du coureur (au-delà, pose figée ; masqué au loin).
 * Comportement à l'approche du coureur : les vaches font quelques pas, les chevaux d'un manège partent au
 * galop autour du centre (les autres marchent), les moutons sautillent de temps en temps.
 */

export type FarmKind = 'cow' | 'sheep' | 'horse';

export interface AnimalSpec {
  kind: FarmKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  /** Robe (vache, cheval) ou laine (mouton). */
  color: THREE.Color;
  /** Manège de chevaux : centre, rayon et angle de départ sur le cercle. */
  ring?: { cx: number; cz: number; r: number; phi: number };
  /** Altitude du sol (pour suivre le terrain en se déplaçant). */
  ground: (x: number, z: number) => number;
}

/** Longueur réelle (m) de chaque animal. */
const LENGTH: Record<FarmKind, number> = { cow: 2.3, horse: 2.5, sheep: 1.3 };
const FILES: Record<FarmKind, string> = { cow: '/models/animals/cow.glb', horse: '/models/animals/horse.glb', sheep: '/models/animals/sheep.glb' };
/** Matériau recoloré par animal (robe) ; les autres (taches, sabots, museau) gardent leur couleur. */
const COAT: Record<FarmKind, string> = { cow: 'White', horse: 'Material.003', sheep: 'White' };
/** Distance (m) à laquelle l'animal réagit au coureur, animation mise à jour, ombre portée, masqué. */
const REACT: Record<FarmKind, number> = { cow: 70, horse: 80, sheep: 55 };
const ANIMATE_M = 160;
const SHADOW_M = 60;
const HIDE_M = 650;

interface Model {
  scene: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  scale: number;
  lift: number;
  /** Rotation (rad) qui tourne la tête du modèle vers +z (avant du jeu). */
  face: number;
}

let models: Record<FarmKind, Model> | null = null;
let loading: Promise<boolean> | null = null;

/** Charge les trois modèles une fois (facultatif : sans eux, troupeaux en blocs). */
export function loadFarmAnimals(): Promise<boolean> {
  // Hors navigateur (tests) : pas de modèles, troupeaux en blocs.
  if (typeof document === 'undefined') return Promise.resolve(false);
  loading ??= (async () => {
    try {
      const loader = new GLTFLoader();
      const entries = await Promise.all(
        (Object.keys(FILES) as FarmKind[]).map(async (kind) => {
          const gltf = await loader.loadAsync(FILES[kind]);
          const scene = gltf.scene;
          // Aplats à facettes, couleurs d'origine.
          scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const src = mesh.material as THREE.MeshStandardMaterial;
            const m = new THREE.MeshStandardNodeMaterial({ color: src.color ?? new THREE.Color('#ffffff'), roughness: 0.9, metalness: 0 });
            m.flatShading = true;
            m.name = src.name;
            mesh.material = m;
            mesh.frustumCulled = false;
          });
          scene.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(scene);
          const size = box.getSize(new THREE.Vector3());
          // Modèle exporté de Blender (Y en haut) : la longueur est l'axe horizontal le plus long.
          const alongX = size.x > size.z;
          const len = Math.max(size.x, size.z);
          const model: Model = {
            scene,
            clips: new Map(gltf.animations.map((c) => [c.name, c])),
            scale: LENGTH[kind] / len,
            lift: -box.min.y,
            face: alongX ? -Math.PI / 2 : 0,
          };
          return [kind, model] as const;
        }),
      );
      models = Object.fromEntries(entries) as Record<FarmKind, Model>;
      return true;
    } catch (err) {
      console.warn('Animaux de ferme indisponibles (troupeaux en blocs)', err);
      return false;
    }
  })();
  return loading;
}

export const farmAnimalsReady = (): boolean => models !== null;

interface Animal {
  spec: AnimalSpec;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: THREE.AnimationAction | null;
  /** Temps restant de l'action déclenchée (marche, saut) ; ≤ 0 : au repos. */
  busy: number;
  /** Déjà réveillé par ce passage du coureur (une fois par passage). */
  woke: boolean;
  next: number;
  angle: number;
  shadow: boolean;
  visible: boolean;
}

/** Robes partagées : un matériau par animal, robe et couleur. */
const coats = new Map<string, THREE.MeshStandardNodeMaterial>();
function coatMaterial(kind: FarmKind, base: THREE.MeshStandardNodeMaterial, color: THREE.Color): THREE.MeshStandardNodeMaterial {
  const key = `${kind}:${color.getHexString()}`;
  let m = coats.get(key);
  if (!m) {
    m = base.clone();
    m.color.copy(color);
    coats.set(key, m);
  }
  return m;
}

export class FarmAnimals {
  readonly group = new THREE.Group();
  private readonly byChunk = new Map<number, Animal[]>();
  private readonly tmp = new THREE.Vector3();

  constructor() {
    this.group.name = 'farm-animals';
  }

  /** Animaux d'un tronçon (modèles chargés : voir farmAnimalsReady). */
  add(key: number, specs: AnimalSpec[]): void {
    if (!models || !specs.length) return;
    const list: Animal[] = [];
    for (const spec of specs) {
      const model = models[spec.kind];
      const obj = cloneSkinned(model.scene);
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const m = mesh.material as THREE.MeshStandardNodeMaterial;
        if (m.name === COAT[spec.kind]) mesh.material = coatMaterial(spec.kind, m, spec.color);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
      });
      obj.scale.setScalar(model.scale * spec.scale);
      obj.position.y = model.lift * model.scale * spec.scale;
      obj.rotation.y = model.face;
      const root = new THREE.Group();
      root.add(obj);
      root.position.set(spec.x, spec.y, spec.z);
      root.rotation.y = spec.yaw;
      const mixer = new THREE.AnimationMixer(obj);
      const actions = new Map<string, THREE.AnimationAction>();
      for (const [name, clip] of model.clips) actions.set(name, mixer.clipAction(clip));
      const a: Animal = { spec, root, mixer, actions, current: null, busy: 0, woke: false, next: 2 + Math.random() * 4, angle: spec.ring?.phi ?? 0, shadow: false, visible: true };
      this.play(a, 'Idle', 0);
      // Repos décalé d'un animal à l'autre.
      a.mixer.update(Math.random() * 5);
      this.group.add(root);
      list.push(a);
    }
    this.byChunk.set(key, list);
  }

  remove(key: number): void {
    const list = this.byChunk.get(key);
    if (!list) return;
    for (const a of list) {
      a.mixer.stopAllAction();
      this.group.remove(a.root);
    }
    this.byChunk.delete(key);
  }

  private play(a: Animal, name: string, fade = 0.35): void {
    const next = a.actions.get(name) ?? a.actions.get('Idle');
    if (!next || next === a.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (name === 'Jump') {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = false;
    }
    a.current?.fadeOut(fade);
    a.current = next;
  }

  update(dt: number, focus: THREE.Vector3): void {
    for (const list of this.byChunk.values())
      for (const a of list) {
        const s = a.spec;
        const d = Math.hypot(a.root.position.x - focus.x, a.root.position.z - focus.z);
        const vis = d < HIDE_M;
        if (vis !== a.visible) a.root.visible = a.visible = vis;
        if (!vis || d > ANIMATE_M) continue;
        const shadow = d < SHADOW_M;
        if (shadow !== a.shadow) {
          a.shadow = shadow;
          a.root.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = shadow) : undefined));
        }
        const near = d < REACT[s.kind];
        if (!near && d > REACT[s.kind] + 40) a.woke = false;
        if (s.ring) {
          // Manège : galop autour du centre tant que le coureur est proche, puis pas, puis arrêt.
          const target = near ? 3.6 : 0;
          a.busy += (target - a.busy) * Math.min(1, dt * 0.8);
          if (a.busy > 0.05) {
            a.angle += (a.busy / s.ring.r) * dt;
            const x = s.ring.cx + Math.cos(a.angle) * s.ring.r;
            const z = s.ring.cz - Math.sin(a.angle) * s.ring.r;
            a.root.position.set(x, this.groundAt(s, x, z), z);
            a.root.rotation.y = a.angle + Math.PI;
          }
          this.play(a, a.busy > 2 ? 'Run' : a.busy > 0.4 ? 'Walk' : 'Idle');
        } else if (near && !a.woke) {
          // Réveil : quelques pas (vache, cheval) ou un saut (mouton).
          a.woke = true;
          a.busy = s.kind === 'sheep' ? 0.9 : 3 + Math.random() * 3;
          this.play(a, s.kind === 'sheep' ? 'Jump' : s.kind === 'horse' ? 'Walk' : 'WalkSlow');
        } else if (a.busy > 0) {
          a.busy -= dt;
          if (s.kind !== 'sheep') {
            const v = s.kind === 'horse' ? 1.2 : 0.55;
            const x = a.root.position.x + Math.sin(a.root.rotation.y) * v * dt;
            const z = a.root.position.z + Math.cos(a.root.rotation.y) * v * dt;
            a.root.position.set(x, this.groundAt(s, x, z), z);
          }
          if (a.busy <= 0) this.play(a, 'Idle');
        } else if (s.kind === 'sheep' && near) {
          // Moutons : un saut de temps en temps tant que le coureur est là.
          a.next -= dt;
          if (a.next <= 0) {
            a.next = 3 + Math.random() * 5;
            a.busy = 0.9;
            this.play(a, 'Jump', 0.15);
          }
        }
        a.mixer.update(dt);
      }
  }

  private groundAt(s: AnimalSpec, x: number, z: number): number {
    const y = s.ground(x, z);
    return Number.isFinite(y) ? y : s.y;
  }

  dispose(): void {
    for (const k of [...this.byChunk.keys()]) this.remove(k);
  }
}
