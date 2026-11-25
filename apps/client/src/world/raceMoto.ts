import * as THREE from 'three/webgpu';
import type { RouteTrack } from '@allezrobert/shared';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { roadPose, type RoadPose } from './roadHeight.ts';
import { LOW_POLY } from '../engine/style.ts';
import { CHRONO_H, CHRONO_W, drawChrono } from './motoChrono.ts';

/**
 * Moto de l'ardoisier (idée NCT Ride) : quand la course est cassée en groupes, une moto vient de temps en temps
 * (MotoSchedule) rouler devant le groupe du joueur ; le passager montre sur son ardoise l'écart avec le groupe de devant
 * (ou l'avance sur celui de derrière), puis la moto repart devant. Les écarts restent affichés discrètement à l'écran
 * (gapsLine, ui/raceGaps.ts). Modèle : moto chrono avec pilote casqué et panneau LED arrière (`Chrono_Ecran`), une
 * version par style : /models/vehicles/moto-chrono-poly.glb (Poly), moto-chrono-reel-beta.glb (Réel et Bêta). Le
 * panneau affiche l'écart en chiffres ambre (motoChrono.ts). Les volumes simples et leur ardoise restent affichés le
 * temps du chargement, et en repli si le GLB ne se charge pas.
 *
 * `raceGroups` (pur, testé) découpe les coureurs en groupes ; `RaceMoto` place la moto et peint l'ardoise.
 */

export interface GroupRider {
  distM: number;
  me?: boolean;
}

/** Cassure entre deux groupes (m) : au-delà, deux coureurs consécutifs ne roulent plus ensemble. */
export const GROUP_SPLIT_M = 12;

export interface RaceGroups {
  /** Tête et queue (distance) du groupe du joueur. */
  myFrontM: number;
  myBackM: number;
  /** Écart (m) avec la queue du groupe de devant, ou null si mon groupe est en tête. */
  aheadGapM: number | null;
  /** Écart (m) avec la tête du groupe de derrière, ou null si personne derrière. */
  behindGapM: number | null;
}

/** Groupes de la course autour du joueur ; null s'il n'y a qu'un seul groupe (rien à montrer). */
export function raceGroups(riders: readonly GroupRider[]): RaceGroups | null {
  const sorted = [...riders].sort((a, b) => b.distM - a.distM);
  const groups: GroupRider[][] = [];
  for (const r of sorted) {
    const g = groups[groups.length - 1];
    if (g && (g[g.length - 1] as GroupRider).distM - r.distM <= GROUP_SPLIT_M) g.push(r);
    else groups.push([r]);
  }
  if (groups.length < 2) return null;
  const i = groups.findIndex((g) => g.some((r) => r.me));
  if (i < 0) return null;
  const mine = groups[i] as GroupRider[];
  const myFrontM = (mine[0] as GroupRider).distM;
  const myBackM = (mine[mine.length - 1] as GroupRider).distM;
  const prev = groups[i - 1];
  const next = groups[i + 1];
  return {
    myFrontM,
    myBackM,
    aheadGapM: prev ? (prev[prev.length - 1] as GroupRider).distM - myFrontM : null,
    behindGapM: next ? myBackM - (next[0] as GroupRider).distM : null,
  };
}

/**
 * Écart du panneau (s, signé) : positif = retard sur le groupe de devant (« +0:42 »), négatif = avance sur le groupe de
 * derrière (« −0:25 »). Même arrondi que slateText.
 */
export function slateSeconds(g: RaceGroups, speedMs: number): number {
  const v = Math.max(speedMs, 4);
  if (g.aheadGapM !== null) return Math.round(g.aheadGapM / v);
  return -Math.round((g.behindGapM ?? 0) / v);
}

/** Texte de l'ardoise : « +0:12 » derrière l'échappée, « −0:25 » d'avance sur le groupe de derrière. */
export function slateText(g: RaceGroups, speedMs: number): { top: string; gap: string } {
  const v = Math.max(speedMs, 4);
  const fmt = (m: number) => {
    const s = Math.round(m / v);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  if (g.aheadGapM !== null) return { top: 'TÊTE', gap: `+${fmt(g.aheadGapM)}` };
  return { top: 'PELOTON', gap: `−${fmt(g.behindGapM ?? 0)}` };
}

/** Écarts en une ligne discrète : « Échappée +0:12 · Derrière −0:25 » (null s'il n'y a qu'un groupe). */
export function gapsLine(g: RaceGroups | null, speedMs: number, fr: boolean): string | null {
  if (!g) return null;
  const v = Math.max(speedMs, 4);
  const fmt = (m: number) => {
    const s = Math.round(m / v);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const parts: string[] = [];
  if (g.aheadGapM !== null) parts.push(`${fr ? 'Devant' : 'Ahead'} +${fmt(g.aheadGapM)}`);
  if (g.behindGapM !== null) parts.push(`${fr ? 'Derrière' : 'Behind'} −${fmt(g.behindGapM)}`);
  return parts.join(' · ') || null;
}

/**
 * Passages de la moto : pas en permanence. Premier passage `firstS` après la cassure, puis un passage de `visitS`
 * toutes les `everyS` environ (±25 %, tirage déterministe). La course se regroupe : la visite s'arrête.
 */
export class MotoSchedule {
  private t = 0;
  private nextAt: number;
  private until = -1;
  private k = 0;
  constructor(
    private readonly firstS = 15,
    private readonly visitS = 40,
    private readonly everyS = 150,
  ) {
    this.nextAt = firstS;
  }
  /** `split` : la course est cassée. Renvoie vrai pendant une visite de la moto. */
  update(dt: number, split: boolean): boolean {
    this.t += dt;
    if (!split) {
      this.until = -1;
      // Après un regroupement, la prochaine cassure attend au moins `firstS`.
      this.nextAt = Math.max(this.nextAt, this.t + this.firstS);
      return false;
    }
    if (this.t < this.until) return true;
    if (this.t >= this.nextAt) {
      this.until = this.t + this.visitS;
      this.k++;
      const h = Math.sin(this.k * 12.9898) * 43758.5453;
      const jitter = 0.75 + 0.5 * (h - Math.floor(h));
      this.nextAt = this.until + this.everyS * jitter;
      return true;
    }
    return false;
  }
}

/**
 * Distance devant la tête du groupe du joueur (m). 9 m : en caméra poursuite (1600 × 900), le panneau LED fait environ
 * 45 × 22 px et l'écart se lit ; à 16 m il tombait à 27 × 13 px (essai au Tourmalet du 2026-11-25).
 */
const LEAD_M = 9;
/** Rayon des roues de la moto chrono (m) : rotation des pivots Roue_AV et Roue_AR. */
const WHEEL_R = 0.328;
/** Moto chrono du style courant (avant vers +z, Y vers le haut, origine au sol : aucune correction d'orientation). */
const MODEL_URL = LOW_POLY ? '/models/vehicles/moto-chrono-poly.glb' : '/models/vehicles/moto-chrono-reel-beta.glb';
/** Décalage latéral (m) par rapport au joueur, vers la gauche : la moto ne se cache pas derrière lui à l'écran. */
const SIDE_M = 2.2;

export class RaceMoto {
  readonly root = new THREE.Group();
  /** Moto en volumes simples (Poly, ou en attendant le modèle). */
  private readonly body = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly tex: THREE.CanvasTexture;
  private readonly wheels: THREE.Mesh[] = [];
  /** Pivots des roues du modèle (Roue_AV, Roue_AR), tournés autour de leur axe x local. */
  private modelWheels: THREE.Object3D[] = [];
  /** Ardoise des volumes simples, masquée quand le panneau LED du modèle prend le relais. */
  private readonly slate: THREE.Mesh;
  /** Panneau LED du modèle (canevas 640 × 300, texture sRGB sans retournement, comme l'UV du GLB). */
  private chronoCanvas: HTMLCanvasElement | null = null;
  private chronoTex: THREE.CanvasTexture | null = null;
  private lastChrono = Number.NaN;
  private distM = Number.NaN;
  private lateral = -0.6;
  private shown = 0;
  /** Fin de passage : élan (m/s cumulés) de la moto qui repart devant. */
  private leaveM = 0;
  private lastText = '';
  private readonly sample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  private readonly pose: RoadPose = { y: 0, pitch: 0 };

  constructor(scene: THREE.Scene, private readonly track: RouteTrack) {
    this.canvas.width = 256;
    this.canvas.height = 160;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = (color: string, roughness = 0.6, metalness = 0) => new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
    const black = mat('#1b1d22', 0.5, 0.3);
    const red = mat('#c8202a', 0.35, 0.2);
    const suit = mat('#1f3b7a', 0.8);
    const skin = mat('#d9a27e', 0.8);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.rotation.x = rx;
      mesh.castShadow = true;
      this.body.add(mesh);
      return mesh;
    };
    // Moto (vers +z) : roues, carénage, réservoir, selle.
    for (const z of [-0.72, 0.72]) {
      const w = add(new THREE.TorusGeometry(0.29, 0.09, 8, 18), black, 0, 0.32, z);
      w.rotation.y = Math.PI / 2;
      this.wheels.push(w);
    }
    add(new THREE.BoxGeometry(0.32, 0.36, 1.25), red, 0, 0.62, 0.05);
    add(new THREE.BoxGeometry(0.4, 0.22, 0.5), red, 0, 0.86, 0.32);
    add(new THREE.BoxGeometry(0.34, 0.12, 0.8), black, 0, 0.86, -0.3);
    add(new THREE.BoxGeometry(0.5, 0.42, 0.12), red, 0, 1.0, 0.7, -0.35);
    // Pilote et passager (ardoisier) : buste, tête casquée.
    for (const [z, lean] of [[0.05, 0.45], [-0.45, 0.1]] as const) {
      add(new THREE.BoxGeometry(0.42, 0.62, 0.28), suit, 0, 1.22, z, lean);
      add(new THREE.SphereGeometry(0.15, 10, 8), mat('#f2f2ee', 0.3), 0, 1.68, z + 0.12 * lean * 2);
    }
    // Ardoise tenue sur le côté gauche par le passager, tournée vers l'arrière (vers les coureurs).
    add(new THREE.BoxGeometry(0.06, 0.06, 0.5), skin, -0.32, 1.32, -0.6).rotation.set(0, 0, 0.5);
    const slate = (this.slate = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.39), new THREE.MeshBasicNodeMaterial({ map: this.tex, side: THREE.DoubleSide })));
    slate.position.set(-0.55, 1.55, -0.75);
    slate.rotation.y = Math.PI;
    this.root.add(slate);
    this.root.add(this.body);
    this.root.visible = false;
    scene.add(this.root);
    this.ready = this.loadModel();
  }

  /** Moto chrono du style courant : remplace les volumes simples et leur ardoise ; en cas d'échec, ils restent. */
  private async loadModel(): Promise<void> {
    try {
      const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
      if (this.disposed) return;
      const model = gltf.scene;
      const panel = model.getObjectByName('Chrono_Ecran') as THREE.Mesh | undefined;
      const front = model.getObjectByName('Roue_AV');
      const rear = model.getObjectByName('Roue_AR');
      if (!panel?.isMesh || !front || !rear) throw new Error('panneau Chrono_Ecran ou pivots Roue_AV / Roue_AR introuvables');
      const canvas = document.createElement('canvas');
      canvas.width = CHRONO_W;
      canvas.height = CHRONO_H;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      tex.anisotropy = 8;
      const mat = panel.material as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      mat.emissiveMap?.dispose();
      mat.map = tex;
      mat.emissiveMap = tex;
      mat.emissive.set(0xffffff);
      mat.emissiveIntensity = 1.5;
      mat.needsUpdate = true;
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = o !== panel;
      });
      this.chronoCanvas = canvas;
      this.chronoTex = tex;
      this.lastChrono = Number.NaN;
      this.modelWheels = [front, rear];
      this.root.add(model);
      this.model = model;
      this.body.visible = false;
      this.slate.visible = false;
    } catch (e) {
      console.warn('[moto] modèle indisponible, volumes simples', e);
    }
  }

  /** Panneau LED : redessiné seulement quand l'écart affiché change (à la seconde). */
  private paintChrono(seconds: number): void {
    if (seconds === this.lastChrono || !this.chronoCanvas || !this.chronoTex) return;
    const g = this.chronoCanvas.getContext('2d');
    if (!g) return;
    this.lastChrono = seconds;
    drawChrono(g, seconds);
    this.chronoTex.needsUpdate = true;
  }
  private model: THREE.Object3D | null = null;
  /** Modèle chargé (ou abandonné) : à attendre avant la compilation de départ, sinon à-coup à la première apparition. */
  readonly ready: Promise<void>;
  private disposed = false;

  private paint(top: string, gap: string): void {
    const text = `${top}|${gap}`;
    if (text === this.lastText) return;
    this.lastText = text;
    const g = this.canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = '#16191c';
    g.fillRect(0, 0, 256, 160);
    g.strokeStyle = '#c9a36a';
    g.lineWidth = 10;
    g.strokeRect(5, 5, 246, 150);
    g.fillStyle = '#f2f2ee';
    g.textAlign = 'center';
    g.font = '700 30px "Comic Sans MS", "Marker Felt", sans-serif';
    g.fillText(top, 128, 52);
    g.font = '900 64px "Comic Sans MS", "Marker Felt", sans-serif';
    g.fillText(gap, 128, 128);
    this.tex.needsUpdate = true;
  }

  /** `groups` : situation de course (null = un seul groupe, la moto s'efface). */
  update(dt: number, groups: RaceGroups | null, speedMs: number, myLateral = 0): void {
    const half = this.track.route.roadWidthM / 2;
    const wantLat = Math.max(-half + 0.2, Math.min(half - 0.2, myLateral - SIDE_M));
    this.lateral += (wantLat - this.lateral) * Math.min(1, dt * 0.6);
    const want = groups ? 1 : 0;
    this.shown += (want - this.shown) * Math.min(1, dt * 1.5);
    if (!groups && (!this.root.visible || !Number.isFinite(this.distM))) return;
    if (groups) {
      this.leaveM = 0;
      if (this.model) this.paintChrono(slateSeconds(groups, speedMs));
      else {
        const t = slateText(groups, speedMs);
        this.paint(t.top, t.gap);
      }
      const target = groups.myFrontM + LEAD_M;
      // Arrivée : la moto remonte depuis l'arrière du groupe plutôt que d'apparaître devant.
      if (!Number.isFinite(this.distM)) this.distM = groups.myBackM - 15;
      // La moto roule à la vitesse du groupe, plus un rattrapage borné (relatif : elle suit aussi en descente à 70 km/h).
      this.distM += speedMs * dt + Math.max(-6 * dt, Math.min(8 * dt, (target - this.distM) * Math.min(1, dt * 0.8)));
      this.distM = Math.min(this.distM, target + 3);
    } else {
      // Fin du passage : la moto accélère et s'éloigne devant, puis disparaît au loin.
      this.leaveM += 7 * dt;
      this.distM += (speedMs + this.leaveM * 0.15) * dt;
    }
    const p = this.track.positionAt(this.distM, this.lateral, this.sample);
    const yaw = Math.atan2(p.dirX, p.dirZ);
    roadPose(p.x, p.z, Math.sin(yaw), Math.cos(yaw), p.y + 0.06, Math.atan(p.grade / 100), 0.72, 0.72, this.pose);
    this.root.position.set(p.x, this.pose.y, p.z);
    this.root.rotation.set(0, 0, 0);
    this.root.rotateY(yaw);
    this.root.rotateX(-this.pose.pitch);
    this.root.visible = true;
    for (const w of this.wheels) w.rotation.x -= (speedMs * dt) / 0.38;
    // Moto chrono : avant vers +z, une rotation positive autour de x fait avancer le haut de la roue.
    for (const w of this.modelWheels) w.rotation.x = (w.rotation.x + (speedMs * dt) / WHEEL_R) % (Math.PI * 2);
    if (!groups && (this.leaveM > 60 || !Number.isFinite(this.distM))) {
      this.root.visible = false;
      this.distM = Number.NaN;
      this.leaveM = 0;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.tex.dispose();
    this.chronoTex?.dispose();
  }
}
