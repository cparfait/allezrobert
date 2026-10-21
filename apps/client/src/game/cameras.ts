import * as THREE from 'three/webgpu';
import type { CameraMode, RouteTrack } from '@allezrobert/shared';

export interface CameraTarget {
  position: THREE.Vector3;
  /** Direction de marche (unitaire, plan horizontal). */
  dir: THREE.Vector3;
  distM: number;
  speedMs: number;
}

/**
 * Caméras : poursuite (par défaut), cockpit, drone, réalisation TV (plans fixes en bord
 * de route qui se succèdent), mode photo (orbite libre à la souris).
 */
export class CameraRig {
  mode: CameraMode = 'chase';
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

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.tvSpot = null;
    this.initialized = false;
  }

  cycle(): CameraMode {
    const order: CameraMode[] = ['chase', 'cockpit', 'gopro', 'drone', 'tv', 'photo'];
    this.setMode(order[(order.indexOf(this.mode) + 1) % order.length] as CameraMode);
    return this.mode;
  }

  private ground(x: number, z: number, fallback: number): number {
    const h = this.groundAt(x, z);
    return Number.isFinite(h) ? h : fallback;
  }

  update(dt: number, t: CameraTarget): void {
    const cam = this.camera;
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
        // Vue depuis la selle, devant la tête (l'avatar du joueur est masqué dans ce mode).
        desired.copy(t.position).addScaledVector(t.dir, 0.55).add(new THREE.Vector3(0, 1.5, 0));
        const ahead = this.track.sample(t.distM + 25);
        look.set(ahead.x, ahead.y + 1.2, ahead.z);
        stiffness = 14;
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
    if (this.mode !== 'tv' && cam.fov < 40) {
      cam.fov = cam.aspect > 2.5 ? 48 : 62;
      cam.updateProjectionMatrix();
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
    this.smoothPos.lerp(desired, k);
    this.smoothLook.lerp(look, Math.min(1, k * 1.5));
    cam.position.copy(this.smoothPos);
    cam.lookAt(this.smoothLook);
  }
}
