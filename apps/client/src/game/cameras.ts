import * as THREE from 'three/webgpu';
import type { CameraMode, RouteTrack } from '@allezrobert/shared';
import { FreeFlyCamera } from './freecam.ts';
import { getLang } from '../i18n/index.ts';

/** Modes de la caméra du jeu : ceux du protocole (appli compagnon) plus la caméra libre, locale. */
export type RigMode = CameraMode | 'free';

export interface CameraTarget {
  position: THREE.Vector3;
  /** Direction de marche (unitaire, plan horizontal). */
  dir: THREE.Vector3;
  distM: number;
  speedMs: number;
  /** Yeux du coureur (repère monde), pour la vue subjective ; à défaut, position estimée. */
  eye?: THREE.Vector3;
  /** Milieu des mains sur les cocottes (repère monde) : la vue subjective garde le cintre en bas de l'image. */
  hands?: THREE.Vector3;
}

const _up = new THREE.Vector3(0, 1, 0);
/**
 * Vue subjective : caméra entre les bras, COCKPIT_BACK m en arrière des mains et COCKPIT_UP m
 * au-dessus (sous la ligne des épaules, tête et cou masqués) ; regard COCKPIT_PITCH rad sous
 * l'axe de la route. Focale verticale COCKPIT_FOV (≈ 95° en horizontal en 16/9, sans fish-eye) :
 * cintre (≈ 40 cm) en bas de l'image, bras par les coins, horizon vers le tiers haut.
 */
const COCKPIT_BACK = 0.5;
const COCKPIT_UP = 0.29;
const COCKPIT_PITCH = 0.27;
const COCKPIT_FOV = 60;

/**
 * Caméras : poursuite (par défaut), cockpit (vue subjective), caméra embarquée, drone,
 * réalisation TV (plans fixes en bord de route qui se succèdent), mode photo (orbite à la
 * souris), caméra libre (vol au clavier et à la souris, voir FreeFlyCamera).
 */
export class CameraRig {
  mode: RigMode = 'chase';
  /** Caméra libre (mode « free ») : vol indépendant du coureur. */
  readonly free: FreeFlyCamera;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly track: RouteTrack;
  private readonly groundAt: (x: number, z: number) => number;
  private readonly smoothPos = new THREE.Vector3();
  private readonly smoothLook = new THREE.Vector3();
  private initialized = false;
  private tvSpot: { pos: THREE.Vector3; untilD: number } | null = null;
  private droneAngle = 0;
  private photo = { yaw: 0, pitch: 0.2, dist: 6 };
  private dragging = false;
  /** Objets qui bloquent la vue (bâtiments) : la caméra TV cherche un plan dégagé. */
  occluders: THREE.Object3D[] = [];
  private readonly ray = new THREE.Raycaster();
  private collideTick = 0;
  private collideScale = 1;

  constructor(camera: THREE.PerspectiveCamera, track: RouteTrack, groundAt: (x: number, z: number) => number, dom: HTMLElement) {
    this.camera = camera;
    this.track = track;
    this.groundAt = groundAt;
    this.free = new FreeFlyCamera(camera, dom, groundAt);
    this.free.exitHint = getLang() === 'fr' ? '<kbd>C</kbd> caméra suivante' : '<kbd>C</kbd> next camera';
    dom.addEventListener('pointerdown', () => (this.dragging = this.mode === 'photo'));
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.photo.yaw -= e.movementX * 0.005;
      this.photo.pitch = THREE.MathUtils.clamp(this.photo.pitch + e.movementY * 0.004, -0.2, 1.3);
    });
    dom.addEventListener('wheel', (e) => {
      if (this.mode !== 'photo') return;
      this.photo.dist = THREE.MathUtils.clamp(this.photo.dist * (1 + Math.sign(e.deltaY) * 0.1), 1.5, 40);
    });
  }

  setMode(mode: RigMode): void {
    if (mode === 'free') this.free.enable();
    else this.free.disable();
    this.mode = mode;
    this.tvSpot = null;
    this.initialized = false;
  }

  cycle(): RigMode {
    const order: RigMode[] = ['chase', 'cockpit', 'gopro', 'drone', 'tv', 'photo', 'free'];
    this.setMode(order[(order.indexOf(this.mode) + 1) % order.length] as RigMode);
    return this.mode;
  }

  private ground(x: number, z: number, fallback: number): number {
    const h = this.groundAt(x, z);
    return Number.isFinite(h) ? h : fallback;
  }

  /** Focale verticale (°) par défaut, et celle de la vue subjective (bornée à 120° en horizontal sur écran très large). */
  private fovFor(mode: RigMode): number {
    const cam = this.camera;
    if (mode === 'cockpit') return Math.min(COCKPIT_FOV, 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(60)) / cam.aspect) * THREE.MathUtils.RAD2DEG);
    if (mode === 'free') return cam.aspect > 2.5 ? 55 : 70;
    return cam.aspect > 2.5 ? 48 : 62;
  }

  update(dt: number, t: CameraTarget): void {
    const cam = this.camera;
    if (this.mode !== 'tv') {
      const fov = this.fovFor(this.mode);
      if (Math.abs(cam.fov - fov) > 0.01) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
    }
    if (this.mode === 'free') {
      this.free.update(dt);
      return;
    }
    const desired = new THREE.Vector3();
    const look = new THREE.Vector3();
    let stiffness = 6;
    switch (this.mode) {
      case 'chase': {
        // Derrière et au-dessus, regard vers un point devant le coureur (anticipe les virages).
        const ahead = this.track.sample(t.distM + 18);
        desired.copy(t.position).addScaledVector(t.dir, -5.2).add(new THREE.Vector3(0, 2.1, 0));
        look.set(ahead.x, ahead.y + 1.0, ahead.z).lerp(t.position.clone().add(new THREE.Vector3(0, 1.1, 0)), 0.55);
        stiffness = 5;
        // Collision : un mur entre le coureur et la caméra rapproche la caméra (une image sur trois).
        if (this.occluders.length && (this.collideTick = (this.collideTick + 1) % 3) === 0) {
          const head = t.position.clone().add(new THREE.Vector3(0, 1.3, 0));
          const toCam = desired.clone().sub(head);
          const len = toCam.length();
          this.ray.set(head, toCam.normalize());
          this.ray.far = len;
          const hit = this.ray.intersectObjects(this.occluders, true)[0];
          this.collideScale = hit ? Math.max(0.25, (hit.distance - 0.6) / len) : 1;
        }
        if (this.collideScale < 1) {
          const head = t.position.clone().add(new THREE.Vector3(0, 1.3, 0));
          desired.sub(head).multiplyScalar(this.collideScale).add(head);
        }
        break;
      }
      case 'cockpit': {
        // Vue subjective depuis les yeux du coureur (tête masquée) : la caméra suit la tête, donc
        // le balancement du coup de pédale. Regard vers la route devant, un peu plongeant, pour
        // garder avant-bras, mains sur les cocottes, cintre, potence et compteur en bas de l'image.
        // Placée entre les bras, en arrière du cintre et sous la ligne des épaules (comme les vues
        // subjectives des simulateurs) : cintre grand en bas de l'image, bras entrant par les coins,
        // horizon vers le tiers haut, sans grand angle déformant.
        if (t.hands) desired.copy(t.hands).addScaledVector(t.dir, -COCKPIT_BACK).addScaledVector(_up, COCKPIT_UP);
        else if (t.eye) desired.copy(t.eye).addScaledVector(t.dir, 0.1).addScaledVector(_up, -0.25);
        else desired.copy(t.position).addScaledVector(t.dir, 0.1).addScaledVector(_up, 1.3);
        // Tangage : mains (cintre) calées en bas de l'image, en côte comme en descente (plongée bornée :
        // en danseuse elles descendent un peu) ; sans repère des mains, pente du vélo plus un tiers
        // de l'écart vers la route à 30 m.
        const ahead = this.track.sample(t.distM + 30);
        const dx = ahead.x - desired.x;
        const dz = ahead.z - desired.z;
        const hd = Math.hypot(dx, dz) || 1;
        const bikePitch = Math.atan(this.track.sample(t.distM).grade / 100);
        // Regard presque dans l'axe de la route (légère plongée), quelle que soit la pente.
        const roadPitch = Math.atan2(ahead.y + 1.0 - desired.y, hd);
        const pitch = bikePitch + (roadPitch - bikePitch) / 3 - COCKPIT_PITCH;
        look.set(desired.x + (dx / hd) * Math.cos(pitch) * 10, desired.y + Math.sin(pitch) * 10, desired.z + (dz / hd) * Math.cos(pitch) * 10);
        stiffness = 12;
        break;
      }
      case 'gopro': {
        // Caméra embarquée sur la poitrine : bras et cintre dans le champ, vibrations de la route.
        const shake = Math.sin(performance.now() * 0.031) * 0.006 * Math.min(t.speedMs / 8, 1);
        desired.copy(t.position).addScaledVector(t.dir, 0.42).add(new THREE.Vector3(0, 1.22 + shake, 0));
        const ahead = this.track.sample(t.distM + 12);
        look.set(ahead.x, ahead.y + 0.4, ahead.z);
        stiffness = 30;
        break;
      }
      case 'drone': {
        this.droneAngle += dt * 0.06;
        const r = 28;
        desired.set(t.position.x + Math.cos(this.droneAngle) * r, t.position.y + 16, t.position.z + Math.sin(this.droneAngle) * r);
        look.copy(t.position).add(new THREE.Vector3(0, 1, 0));
        stiffness = 2;
        break;
      }
      case 'tv': {
        // Plan fixe en bord de route, 60 à 90 m devant ; on change quand le coureur l'a dépassé.
        if (!this.tvSpot || t.distM > this.tvSpot.untilD) {
          // Plusieurs emplacements candidats ; on garde le premier qui voit la route sans bâtiment devant.
          for (let attempt = 0; attempt < 10; attempt++) {
            const d = t.distM + 55 + Math.random() * 40;
            const side = attempt % 2 ? 1 : -1;
            const s = this.track.positionAt(d, side * (6 + Math.random() * 6));
            const y = this.ground(s.x, s.z, s.y) + 1.6 + Math.random() * 2.5 + attempt * 0.8;
            const pos = new THREE.Vector3(s.x, y, s.z);
            const road = this.track.positionAt(d - 25, 0);
            const dir = new THREE.Vector3(road.x, road.y + 1, road.z).sub(pos);
            const len = dir.length();
            this.ray.set(pos, dir.normalize());
            this.ray.far = len;
            const blocked = this.occluders.length > 0 && this.ray.intersectObjects(this.occluders, true).length > 0;
            if (!blocked || attempt === 9) {
              this.tvSpot = { pos, untilD: d + 15 };
              break;
            }
          }
          this.initialized = false;
        }
        if (this.tvSpot) desired.copy(this.tvSpot.pos);
        look.copy(t.position).add(new THREE.Vector3(0, 1, 0));
        stiffness = 50;
        // Zoom : focale plus serrée quand le coureur est loin.
        const dist = desired.distanceTo(t.position);
        cam.fov = THREE.MathUtils.clamp(2 * Math.atan(6 / dist) * (180 / Math.PI), 8, 55);
        cam.updateProjectionMatrix();
        break;
      }
      case 'photo': {
        const { yaw, pitch, dist } = this.photo;
        const base = Math.atan2(t.dir.x, t.dir.z) + Math.PI + yaw;
        desired.set(t.position.x + Math.sin(base) * Math.cos(pitch) * dist, t.position.y + 1 + Math.sin(pitch) * dist, t.position.z + Math.cos(base) * Math.cos(pitch) * dist);
        look.copy(t.position).add(new THREE.Vector3(0, 1, 0));
        stiffness = 12;
        break;
      }
    }
    // La caméra ne passe jamais sous le terrain.
    const minY = this.ground(desired.x, desired.z, desired.y - 2) + 0.6;
    if (desired.y < minY) desired.y = minY;
    if (!this.initialized) {
      this.smoothPos.copy(desired);
      this.smoothLook.copy(look);
      this.initialized = true;
    }
    const k = 1 - Math.exp(-dt * stiffness);
    // Vues embarquées : la caméra est solidaire du coureur (un retard ferait « nager » le cintre).
    if (this.mode === 'cockpit' || this.mode === 'gopro') this.smoothPos.copy(desired);
    else this.smoothPos.lerp(desired, k);
    this.smoothLook.lerp(look, Math.min(1, k * 1.5));
    cam.position.copy(this.smoothPos);
    cam.lookAt(this.smoothLook);
  }
}
