import * as THREE from 'three/webgpu';
import { emissive, mrt, normalView, output, packNormalToRGB, pass, sample, unpackRGBToNormal, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { DEFAULT_LOOK, type AvatarLook, type TuneSlot } from '@allezrobert/shared';
import { createAvatar, type RiderAvatarLike } from '../rider/gltfAvatar.ts';
import { crowdBike, loneWheel, onBikeFamilyLoaded } from '../rider/bikes.ts';
import type { Engine } from '../engine/renderer.ts';
import { box, buildRoom, cyl, mat, rod } from './atelierRoom.ts';

/**
 * Atelier du garage : le vélo du joueur sur un pied d'atelier, dans une pièce procédurale (établi,
 * panneau perforé et outils, râtelier à roues, lampe chaude, home trainer dans un coin). Scène et
 * chaîne de rendu propres (bloom des jantes lumineuses), rendue à la demande comme l'image
 * d'accueil : seulement quand quelque chose change (pièce essayée, caméra, surbrillance) ou tant
 * qu'un effet animé est monté (film irisé, jantes lumineuses, décors holographiques).
 */

/** Ce que le menu demande à l'atelier. */
export interface AtelierState {
  look: AvatarLook;
  /** Emplacement mis en avant (caméra) ; « overview » : tout le vélo. */
  focus: TuneSlot | 'overview';
  /** Coureur en selle (vélo posé au sol) ou vélo seul sur le pied. */
  rider: boolean;
  /** Rotation de la vue autour du vélo (rad). */
  yaw: number;
  /** Matériaux à faire briller brièvement (pièce qui vient d'être changée). */
  pulse?: readonly string[];
  /** Tête nue (éditeur de visage : casque retiré le temps de l'aperçu). */
  bareHead?: boolean;
  /** Cadrage imposé (bancs d'essai) : remplace celui de `focus`, sans rotation ni recul. */
  view?: Shot;
}

/** Matériaux du vélo concernés par chaque emplacement (surbrillance). */
export const SLOT_PARTS: Record<TuneSlot, readonly string[]> = {
  wheelset: ['rim', 'rim_decal', 'disc_face', 'spokes', 'hub', 'tire', 'tire_wall'],
  tyres: ['tire', 'tire_wall'],
  cockpit: ['bar_tape', 'spacers', 'topcap'],
  groupset: ['chain', 'chainring', 'crank', 'cassette', 'pulley', 'caliper'],
  crank: ['crank', 'chainring'],
  cassette: ['cassette'],
  pulleys: ['pulley'],
  rotors: ['rotor'],
  saddle: ['saddle'],
  seatpost: ['seatpost'],
  finish: ['frame'],
  paint: ['frame'],
  sticker: ['frame'],
  number: ['frame'],
  rimdecal: ['rim_decal'],
  spokes: ['spokes'],
  rimglow: ['rim_decal'],
  valves: ['valve'],
  tape: ['bar_tape'],
  bottles: ['bottle', 'cage'],
  topcap: ['topcap'],
  spacers: ['spacers'],
  bolts: ['bolts'],
  computer: ['computer'],
  chain: ['chain'],
};

export type Shot = { cam: [number, number, number]; look: [number, number, number]; fov: number };
/** Cadrages (repère du vélo : +z avant, +x à gauche, côté transmission en −x). */
const SHOTS: Record<'overview' | 'wheel' | 'cockpit' | 'drive' | 'rotor' | 'saddle' | 'frame' | 'bottles', Shot> = {
  overview: { cam: [2.05, 1.3, 1.65], look: [0, 0.7, 0], fov: 36 },
  wheel: { cam: [1.5, 0.78, 1.55], look: [0, 0.48, 0.55], fov: 34 },
  cockpit: { cam: [0.95, 1.5, 1.5], look: [0, 1.0, 0.5], fov: 32 },
  drive: { cam: [-1.55, 0.92, 0.55], look: [0, 0.42, -0.12], fov: 34 },
  rotor: { cam: [1.15, 0.66, 1.25], look: [0.04, 0.4, 0.58], fov: 30 },
  saddle: { cam: [1.35, 1.32, -1.15], look: [0, 0.95, -0.2], fov: 30 },
  frame: { cam: [2.7, 1.15, 0.45], look: [0, 0.68, 0.08], fov: 36 },
  bottles: { cam: [1.6, 1.0, 0.95], look: [0, 0.6, 0.15], fov: 32 },
};
const SLOT_SHOT: Record<TuneSlot | 'overview', keyof typeof SHOTS> = {
  overview: 'overview',
  wheelset: 'wheel',
  tyres: 'wheel',
  rimdecal: 'wheel',
  spokes: 'wheel',
  rimglow: 'wheel',
  valves: 'wheel',
  cockpit: 'cockpit',
  tape: 'cockpit',
  topcap: 'cockpit',
  spacers: 'cockpit',
  computer: 'cockpit',
  groupset: 'drive',
  crank: 'drive',
  cassette: 'drive',
  pulleys: 'drive',
  chain: 'drive',
  rotors: 'rotor',
  saddle: 'saddle',
  seatpost: 'saddle',
  number: 'saddle',
  paint: 'frame',
  finish: 'frame',
  sticker: 'frame',
  bottles: 'bottles',
  bolts: 'bottles',
};

/** Emplacement d'atelier d'une pièce du vélo touchée (noms renvoyés par AtelierHost.pick), sinon null. */
export function slotOfPicked(names: readonly string[]): TuneSlot | null {
  const byMaterial: Record<string, TuneSlot> = {
    tire: 'tyres', tire_wall: 'tyres', rim: 'wheelset', hub: 'wheelset', rim_decal: 'rimdecal', spokes: 'spokes', valve: 'valves',
    rotor: 'rotors', caliper: 'rotors', cassette: 'cassette', chain: 'chain', chainring: 'crank', crank: 'crank', pulley: 'pulleys',
    bar_tape: 'tape', computer: 'computer', computer_screen: 'computer', topcap: 'topcap', spacers: 'spacers', bolts: 'bolts',
    saddle: 'saddle', seatpost: 'seatpost', frame: 'paint', bottle: 'bottles', cage: 'bottles',
  };
  const direct = byMaterial[names[0] ?? ''];
  if (direct) return direct;
  // Matériaux partagés (composants, chrome) : on lit le groupe de la pièce.
  for (const n of names) {
    if (n.startsWith('cockpit')) return 'cockpit';
    if (n.startsWith('crankset') || n.startsWith('pedal')) return 'crank';
    if (n.startsWith('opt_derailleur')) return 'groupset';
    if (n.startsWith('opt_brakes') || n.includes('_rotor')) return 'rotors';
    if (n.startsWith('opt_bottle')) return 'bottles';
    if (n.startsWith('saddle')) return 'saddle';
    if (n.startsWith('wheel_')) return 'wheelset';
    if (n === 'frame' || n.startsWith('frame_')) return 'paint';
  }
  return null;
}

/** Hauteur du vélo sur le pied d'atelier (roues décollées). */
const LIFT = 0.5;

/**
 * Environnement de studio (reflets et lumière ambiante, préfiltré par PMREM) : pièce chaude et
 * sombre, grande boîte à lumière avant droite (lumière principale), panneau au plafond, deux bandes
 * de contre-jour derrière le coureur qui dessinent sa silhouette, fenêtre froide à droite.
 */
function studioEnvironment(renderer: THREE.WebGPURenderer): THREE.Texture {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicNodeMaterial({ color: '#6d6358', side: THREE.BackSide }));
  room.position.y = 2.6;
  env.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicNodeMaterial({ color: '#4a3c30' }));
  floor.rotation.x = -Math.PI / 2;
  env.add(floor);
  const panel = (w: number, h: number, hex: string, power: number, pos: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(hex).multiplyScalar(power), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 1.1, 0);
    env.add(m);
  };
  panel(2.4, 1.8, '#fff3e4', 7, [-2.4, 2.9, 2.4]); // boîte à lumière principale
  panel(3, 3, '#ffeedd', 2.2, [0, 5.4, 0.3]); // plafond
  panel(0.6, 3.2, '#e8f0ff', 9, [-2.4, 2.2, -3.2]); // contre-jour gauche
  panel(0.6, 3.2, '#e8f0ff', 7, [2.4, 2.2, -3.2]); // contre-jour droit
  panel(1.6, 1.2, '#cfe0ff', 2.5, [4.8, 2.0, -0.5]); // fenêtre
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.02);
  pm.dispose();
  return rt.texture;
}

/**
 * Pied de réparation : trépied noir à entretoises et patins, mât télescopique à bagues turquoise,
 * plateau à outils, bras horizontal et mâchoire à levier sur la tige de selle (vélo suspendu par la selle).
 */
function buildStand(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'atelier_stand';
  const black = mat('#17181b', 0.45, 0.6);
  const rubber = mat('#0c0c0e', 0.9);
  const teal = mat('#1fb5a3', 0.55);
  const steel = mat('#aeb4bb', 0.3, 0.9);
  // Mât juste à côté du tube de selle ; le bras part vers lui.
  const clamp = new THREE.Vector3(-0.04, 0.7 + LIFT, -0.13);
  const mast = new THREE.Vector3(-0.5, 0, clamp.z);
  const topY = clamp.y + 0.05;
  g.add(rod(new THREE.Vector3(mast.x, 0.2, mast.z), new THREE.Vector3(mast.x, topY, mast.z), 0.019, black));
  // Trépied : trois jambes inclinées, patins en caoutchouc, entretoises entre elles.
  const hub = new THREE.Vector3(mast.x, 0.24, mast.z);
  const feet: THREE.Vector3[] = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2 + 0.35;
    const foot = new THREE.Vector3(mast.x + Math.cos(a) * 0.52, 0.025, mast.z + Math.sin(a) * 0.52);
    feet.push(foot);
    g.add(rod(hub, foot, 0.013, black));
    g.add(box(0.07, 0.03, 0.05, rubber, foot.x, 0.015, foot.z));
  }
  for (let i = 0; i < 3; i++) {
    const a = feet[i] as THREE.Vector3;
    const b = feet[(i + 1) % 3] as THREE.Vector3;
    g.add(rod(new THREE.Vector3(hub.x + (a.x - hub.x) * 0.55, 0.13, hub.z + (a.z - hub.z) * 0.55), new THREE.Vector3(hub.x + (b.x - hub.x) * 0.55, 0.13, hub.z + (b.z - hub.z) * 0.55), 0.007, black));
  }
  g.add(cyl(0.03, 0.05, black, mast.x, 0.24, mast.z, 16));
  // Bagues turquoise du réglage de hauteur, plateau à outils.
  g.add(cyl(0.027, 0.03, teal, mast.x, 0.34, mast.z, 16));
  g.add(cyl(0.027, 0.03, teal, mast.x, 0.78, mast.z, 16));
  g.add(box(0.24, 0.012, 0.17, black, mast.x + 0.02, 0.92, mast.z));
  for (const s of [-1, 1]) g.add(box(0.24, 0.02, 0.008, black, mast.x + 0.02, 0.932, mast.z + s * 0.081));
  // Té, bras horizontal, bouton de serrage, mâchoire à levier.
  g.add(box(0.06, 0.06, 0.06, black, mast.x, topY, mast.z));
  g.add(rod(new THREE.Vector3(mast.x, topY, mast.z), new THREE.Vector3(clamp.x - 0.05, topY, clamp.z), 0.016, black));
  g.add(cyl(0.022, 0.03, black, mast.x - 0.05, topY, mast.z, 14).rotateZ(Math.PI / 2));
  g.add(box(0.06, 0.05, 0.075, black, clamp.x - 0.03, topY, clamp.z));
  g.add(box(0.016, 0.07, 0.085, steel, clamp.x + 0.015, topY, clamp.z)); // mâchoire côté vélo
  g.add(rod(new THREE.Vector3(clamp.x - 0.03, topY + 0.03, clamp.z), new THREE.Vector3(clamp.x - 0.08, topY + 0.085, clamp.z), 0.007, steel)); // levier
  g.traverse((o) => {
    (o as THREE.Mesh).castShadow = true;
  });
  return g;
}

export class AtelierHost {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.05, 40);
  private pipeline: THREE.RenderPipeline | null = null;
  private avatar: RiderAvatarLike | null = null;
  private readonly bikeRoot = new THREE.Group();
  private stand: THREE.Group | null = null;
  /** Arrivée dans l'atelier : avancement 0 → 1 de l'entrée de caméra et de l'allumage des lumières. */
  private intro = 1;
  private readonly lamps: Array<[THREE.Light, number]> = [];
  private lookKey = '';
  private state: AtelierState | null = null;
  /** Images à rendre (0 : rien ne bouge). */
  private frames = 0;
  /** Caméra : position et cible courantes, interpolées vers le cadrage demandé. */
  private readonly camPos = new THREE.Vector3(2.5, 1.6, 2.1);
  private readonly camLook = new THREE.Vector3(0, 0.9, 0);
  private camFov = 36;
  private readonly goalPos = new THREE.Vector3();
  private readonly goalLook = new THREE.Vector3();
  private goalFov = 36;
  private pulseT = 1;
  private pulseParts: readonly string[] = [];
  private lastT = 0;
  /** Effet animé monté (film irisé, jantes lumineuses, lettres holographiques) : rendu continu. */
  private animated = false;
  private lastAnimRender = 0;

  constructor(private readonly engine: Engine) {
    this.scene.add(this.bikeRoot);
    onBikeFamilyLoaded(() => {
      if (this.state) this.frames = Math.max(this.frames, 2);
    });
  }

  /**
   * Pièce du vélo sous le pointeur (coordonnées écran) : noms du maillage touché, de son matériau
   * et de ses parents, du plus précis au plus général ; null si rien du vélo n'est touché.
   */
  pick(clientX: number, clientY: number): string[] | null {
    if (!this.state || !this.avatar) return null;
    const canvas = this.engine.renderer.domElement;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    // Le décalage de vue (panneau à droite) change la projection : la caméra courante en tient compte.
    this.camera.updateMatrixWorld();
    ray.setFromCamera(ndc, this.camera);
    const shown = (o: THREE.Object3D) => {
      let inBike = false;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) {
        if (!p.visible) return false;
        if (p.name === 'bike') inBike = true;
      }
      return inBike;
    };
    // Le vélo seul (pas le coureur et ses maillages à squelette, bien plus lourds à tester).
    const bike = this.avatar.root.getObjectByName('bike');
    if (!bike) return null;
    const h = ray.intersectObject(bike, true).find((x) => (x.object as THREE.Mesh).isMesh && shown(x.object));
    if (!h) return null;
    const names: string[] = [];
    const mesh = h.object as THREE.Mesh;
    const m = mesh.material as THREE.Material | undefined;
    if (m?.name) names.push(m.name);
    if (mesh.userData.matKey) names.push(String(mesh.userData.matKey));
    for (let o: THREE.Object3D | null = mesh; o && o !== this.avatar.root; o = o.parent) if (o.name) names.push(o.name);
    return names;
  }

  get active(): boolean {
    return this.state !== null;
  }

  /** Vélos du jeu (sans coureur) posés sur la lisse du mur de gauche, de profil, comme dans un vrai rack. */
  private hangBikes(): void {
    const slots: Array<[number, number]> = [[-1.6, 1], [0.1, 4], [1.8, 9]];
    for (const [x, n] of slots) {
      const bikeModel = crowdBike(n);
      if (!bikeModel) continue;
      const a = createAvatar({ ...DEFAULT_LOOK, bikeModel });
      (a as RiderAvatarLike & { setRiderVisible?(on: boolean): void }).setRiderVisible?.(false);
      a.update(0, 0, 0, 'coasting');
      a.setShadows(false);
      a.root.rotation.y = -Math.PI / 2;
      a.root.position.set(x, 1.3, 3.22);
      this.scene.add(a.root);
    }
    // Quatrième vélo sur la lisse du mur du fond (le long de z), de profil.
    const back = crowdBike(12);
    if (back) {
      const a = createAvatar({ ...DEFAULT_LOOK, bikeModel: back });
      (a as RiderAvatarLike & { setRiderVisible?(on: boolean): void }).setRiderVisible?.(false);
      a.update(0, 0, 0, 'coasting');
      a.setShadows(false);
      a.root.position.set(-2.9, 1.3, 2.15);
      this.scene.add(a.root);
    }
    // Roues carbone (profils 50 et 65 mm, lenticulaire) accrochées au mur du fond au-dessus du vélo.
    [['c50', 1.35], ['c65', 2.15], ['disc', 2.95]].forEach(([type, z]) => {
      const w = loneWheel(type as string, 'F');
      if (!w) return;
      w.position.set(-3.1, 2.78, z as number);
      w.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.scene.add(w);
    });
  }

  /** Construction paresseuse : pièce, lumières, environnement, chaîne de rendu. */
  private build(): void {
    if (this.pipeline) return;
    this.scene.background = new THREE.Color('#3a342e');
    this.scene.environment = studioEnvironment(this.engine.renderer);
    this.scene.environmentIntensity = 0.75;
    this.scene.add(buildRoom());
    this.scene.add(new THREE.HemisphereLight(0xfff0dc, 0x6a5a48, 0.6));
    // Éclairage de studio : lumière principale douce de côté (à droite du coureur, à l'opposé des
    // caméras de l'atelier : le volume se lit), plafonnier (ombre au sol), contre-jours froids qui
    // détachent la silhouette du fond, débouchage léger côté caméra.
    const key = new THREE.SpotLight(0xfff1e2, 80, 12, 0.5, 1, 1.4);
    key.position.set(-2.4, 3.0, 2.2);
    key.target.position.set(0, 0.95, 0.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.radius = 6;
    this.scene.add(key, key.target);
    const lamp = new THREE.SpotLight(0xffd6a0, 10, 9, 0.85, 0.7, 1.6);
    lamp.position.set(0, 2.45, 0);
    lamp.target.position.set(0, 0, 0);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.bias = -0.0004;
    lamp.shadow.radius = 8;
    this.scene.add(lamp, lamp.target);
    for (const [x, power] of [[-1.6, 4], [1.6, 2.8]] as const) {
      const rim = new THREE.DirectionalLight(0xe6eeff, power);
      rim.position.set(x, 2.4, -3.0);
      rim.target.position.set(0, 1.0, 0);
      this.scene.add(rim, rim.target);
    }
    const benchLight = new THREE.PointLight(0xffc58a, 4, 4, 1.5);
    benchLight.position.set(-2.4, 1.9, -0.9);
    this.scene.add(benchLight);
    const fill = new THREE.PointLight(0xfff0dc, 2, 6, 1.2);
    fill.position.set(2.4, 1.4, 2.4);
    this.scene.add(fill);
    this.scene.traverse((o) => {
      if ((o as THREE.Light).isLight) this.lamps.push([o as THREE.Light, (o as THREE.Light).intensity]);
    });
    this.hangBikes();
    this.stand = buildStand();
    this.scene.add(this.stand);
    this.pipeline = new THREE.RenderPipeline(this.engine.renderer);
    const scenePass = pass(this.scene, this.camera);
    scenePass.setMRT(mrt({ output, emissive, normal: packNormalToRGB(normalView) }));
    scenePass.getTexture('normal').type = THREE.UnsignedByteType;
    const col = scenePass.getTextureNode('output');
    // Occlusion ambiante (plis du tissu, aisselles, contact avec le sol), comme en jeu.
    const normalTex = scenePass.getTextureNode('normal');
    const aoPass = ao(scenePass.getTextureNode('depth'), sample((uvNode) => unpackRGBToNormal(normalTex.sample(uvNode))), this.camera);
    aoPass.radius.value = 0.35;
    aoPass.distanceExponent.value = 1;
    aoPass.thickness.value = 1;
    const occ = aoPass.getTextureNode().r.mul(0.7).add(0.3);
    const glow = bloom(scenePass.getTextureNode('emissive'), 0.55, 0.35, 0);
    this.pipeline.outputNode = vec4(col.rgb.mul(occ), col.a).add(glow);
  }

  /** Nouvel état demandé par le menu (null : l'atelier se ferme). */
  /**
   * Prépare la pièce et le coureur à l'avance, sans les afficher : construction et compilation des
   * shaders en coulisse, pour que la première ouverture du garage ou de l'aperçu du tutoriel soit
   * immédiate (pièce et coureur restent gardés ensuite).
   */
  async prepare(look: AvatarLook): Promise<void> {
    this.build();
    if (!this.avatar) {
      this.avatar = createAvatar(look);
      this.bikeRoot.add(this.avatar.root);
      this.lookKey = JSON.stringify(look);
    }
    await this.engine.renderer.compileAsync(this.scene, this.camera).catch(() => undefined);
  }

  set(st: AtelierState | null): void {
    if (!st) {
      this.state = null;
      return;
    }
    this.build();
    const first = !this.state;
    this.state = st;
    const key = JSON.stringify(st.look);
    if (!this.avatar) {
      this.avatar = createAvatar(st.look);
      this.bikeRoot.add(this.avatar.root);
      this.lookKey = key;
    } else if (key !== this.lookKey) {
      this.avatar.setLook(st.look);
      this.lookKey = key;
    }
    const av = this.avatar as RiderAvatarLike & { setRiderVisible?(on: boolean): void };
    av.setRiderVisible?.(st.rider);
    (this.avatar as RiderAvatarLike).setBareHead?.(!!st.bareHead);
    // Coureur en selle : vélo au sol (pied replié) ; sinon sur le pied d'atelier, roues décollées.
    this.bikeRoot.position.y = st.rider ? 0 : LIFT;
    if (this.stand) this.stand.visible = !st.rider;
    for (let i = 0; i < 4; i++) this.avatar.update(1 / 60, 0, 0, 'coasting');
    if (st.pulse?.length) {
      this.pulseParts = st.pulse;
      this.pulseT = 0;
    }
    const tune = st.look.tune ?? [];
    this.animated = tune.some((id) => /^tune-(gl-|ev-streak30|fi-irise|rd-holo|pa-aurore)/.test(id));
    this.aim(first);
    if (first) this.intro = 0;
    this.frames = Math.max(this.frames, 3);
  }

  /** Cadrage demandé : imposé (`view`) ou celui de l'emplacement. */
  private aim(snap: boolean): void {
    const st = this.state;
    if (!st) return;
    if (st.view) {
      this.goalPos.set(...st.view.cam);
      this.goalLook.set(...st.view.look);
      this.goalFov = st.view.fov;
    } else this.aimShot(st);
    if (snap) {
      this.camPos.copy(this.goalPos);
      this.camLook.copy(this.goalLook);
      this.camFov = this.goalFov;
    }
  }

  /** Cadrage de l'emplacement demandé, tourné de `yaw` autour du vélo. */
  private aimShot(st: AtelierState): void {
    const shot = SHOTS[SLOT_SHOT[st.focus] ?? 'overview'];
    const lift = st.rider ? 0 : LIFT;
    const c = Math.cos(st.yaw);
    const s = Math.sin(st.yaw);
    const [x, y, z] = shot.cam;
    // Coureur affiché : un peu plus de recul.
    const k = st.rider && SLOT_SHOT[st.focus] === 'overview' ? 1.15 : 1;
    this.goalPos.set((x * c + z * s) * k, y + lift + (k - 1) * 0.4, (-x * s + z * c) * k);
    this.goalLook.set(shot.look[0], shot.look[1] + lift + (k - 1) * 0.25, shot.look[2]);
    // Gros plans : un peu de recul, pour que la pièce reste entière avec son environnement dans l'espace libre.
    if (SLOT_SHOT[st.focus] !== 'overview') {
      const back = 1.08;
      this.goalPos.sub(this.goalLook).multiplyScalar(back).add(this.goalLook);
    }
    this.goalFov = shot.fov;
  }

  /** À appeler à chaque image de la boucle du menu ; rend si besoin. Renvoie vrai si l'atelier est ouvert. */
  tick(now = performance.now()): boolean {
    if (!this.state || !this.pipeline) return false;
    const dt = Math.min((now - (this.lastT || now)) / 1000, 0.1);
    this.lastT = now;
    // Arrivée : la caméra entre dans la pièce (arc depuis le fond, recul et hauteur qui se résorbent)
    // pendant que les lumières s'allument ; ensuite, approche amortie du cadrage demandé.
    if (this.intro < 1) {
      this.intro = Math.min(1, this.intro + dt / 1.9);
      const e = 1 - (1 - this.intro) ** 3;
      const rest = 1 - e;
      const off = this.goalPos.clone().sub(this.goalLook);
      const ang = rest * 0.9;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      off.set(off.x * c + off.z * s, off.y, -off.x * s + off.z * c).multiplyScalar(1 + rest * 0.85);
      off.y += rest * 0.55;
      this.camPos.copy(this.goalLook).add(off);
      this.camLook.copy(this.goalLook);
      this.camFov = this.goalFov + rest * 7;
      const glow = 0.12 + 0.88 * Math.min(1, this.intro * 1.6) ** 2;
      for (const [l, base] of this.lamps) l.intensity = base * glow;
      this.frames = Math.max(this.frames, 1);
    }
    const k = 1 - Math.exp(-dt * 7);
    const moving = this.camPos.distanceToSquared(this.goalPos) > 1e-6 || this.camLook.distanceToSquared(this.goalLook) > 1e-6 || Math.abs(this.camFov - this.goalFov) > 0.01;
    if (moving && this.intro >= 1) {
      this.camPos.lerp(this.goalPos, k);
      this.camLook.lerp(this.goalLook, k);
      this.camFov += (this.goalFov - this.camFov) * k;
      this.frames = Math.max(this.frames, 1);
    }
    // Surbrillance de la pièce changée : éclat bref (0,7 s).
    if (this.pulseT < 1) {
      this.pulseT = Math.min(1, this.pulseT + dt / 0.7);
      const a = Math.sin(Math.PI * this.pulseT) ** 2;
      (this.avatar as { highlightBike?(n: readonly string[], a: number): void } | null)?.highlightBike?.(this.pulseParts, this.pulseT >= 1 ? 0 : a);
      this.frames = Math.max(this.frames, 1);
    }
    // Effets animés : ~30 images/s suffisent.
    if (this.animated && now - this.lastAnimRender > 33) this.frames = Math.max(this.frames, 1);
    if (this.frames <= 0) return true;
    this.frames--;
    this.lastAnimRender = now;
    this.render();
    return true;
  }

  private render(): void {
    const canvas = this.engine.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const cam = this.camera;
    cam.aspect = w / h;
    // Écran large : le vélo à gauche du panneau de l'atelier (à droite).
    if (cam.aspect > 1.2) {
      // Centre du vélo au milieu de l'espace libre à gauche du panneau (mesuré), repli : 7 % de la largeur.
      const panel = document.querySelector('.mm-side, .ob-side')?.getBoundingClientRect();
      const free = panel && panel.left > w * 0.4 ? panel.left - 8 : w * 0.86;
      cam.setViewOffset(w, h, (w - free) / 2, 0, w, h);
    }
    else cam.clearViewOffset();
    cam.fov = cam.aspect > 1.2 ? this.camFov : this.camFov * 1.45;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    cam.updateProjectionMatrix();
    this.pipeline?.render();
  }

  /** Rendu immédiat hors boucle d'animation (onglet masqué, captures) : comme engine.renderManual. */
  renderManual(): void {
    if (!this.state || !this.pipeline) return;
    this.camPos.copy(this.goalPos);
    this.camLook.copy(this.goalLook);
    this.camFov = this.goalFov;
    const r = this.engine.renderer as unknown as { _nodes: { nodeFrame: { update(): void; frameId: number } }; info: { frame: number } };
    r._nodes.nodeFrame.update();
    r.info.frame = r._nodes.nodeFrame.frameId;
    this.render();
  }
}
