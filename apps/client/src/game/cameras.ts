import * as THREE from 'three/webgpu';
import type { CameraMode, RouteTrack } from '@allezrobert/shared';
import { FreeFlyCamera } from './freecam.ts';
import { getLang } from '../i18n/index.ts';
import { buzzOffset } from './roadBuzz.ts';

/** Modes de la caméra du jeu : ceux du protocole (appli compagnon) plus la caméra libre, locale. */
export type RigMode = CameraMode | 'free';

export interface CameraTarget {
  position: THREE.Vector3;
  /** Direction de marche (unitaire, plan horizontal). */
  dir: THREE.Vector3;
  distM: number;
  speedMs: number;
  /** Sens de marche sur l'itinéraire (−1 après un demi-tour) : « devant » = distM − x. */
  sign?: 1 | -1;
  /** Yeux du coureur (repère monde), pour la vue subjective ; à défaut, position estimée. */
  eye?: THREE.Vector3;
  /** Milieu des mains sur les cocottes (repère monde) : la vue subjective garde le cintre en bas de l'image. */
  hands?: THREE.Vector3;
  /** Vibration du revêtement sous les roues (0 = lisse, 1 = pavés), voir roadBuzz.ts. */
  buzz?: number;
  /** Demi-tour en cours : vue de poursuite élargie, même depuis une vue embarquée (on voit le vélo tourner). */
  uturn?: boolean;
  /** Coureur tel qu'il est affiché (arc du demi-tour) : la caméra le suit du regard pendant le demi-tour. */
  subject?: THREE.Vector3;
}

const _up = new THREE.Vector3(0, 1, 0);
/**
 * Vues embarquées (cockpit, caméra casque) : caméra placée par rapport aux yeux animés du coureur (tête
 * masquée), `up` m au-dessus (négatif : dessous), `back` m en arrière ; regard **dans l'axe du vélo** (le
 * cintre reste droit à l'écran, même en roulant sur le côté de la route ou en virage), baissé pour poser
 * les mains à `handsAt` de la hauteur de l'image ; grand angle `hfov`° en horizontal (focale verticale déduite).
 * Mesuré sur le modèle : mains ≈ 66 cm sous les yeux et seulement 16 cm devant (presque à la verticale).
 * Pour voir le cintre devant soi, la caméra descend à hauteur de poitrine, derrière les mains.
 * En développement, `window.__arOnboard` permet de régler ces valeurs en direct.
 */
interface OnboardView {
  up: number;
  back: number;
  hfov: number;
  handsAt: number;
}
const ONBOARD: Record<'cockpit' | 'action', OnboardView> = {
  /** Cockpit : à hauteur des avant-bras, juste derrière les mains (cintre sur la moitié de la largeur, compteur au centre). */
  cockpit: { up: -0.57, back: 0.07, hfov: 100, handsAt: 0.62 },
  /** Caméra casque : plus haut et plus en retrait (épaules et manches dans les coins hauts), plus grand angle, plus de route. */
  action: { up: -0.4, back: 0.3, hfov: 110, handsAt: 0.72 },
};
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __arOnboard: typeof ONBOARD }).__arOnboard = ONBOARD;
/** Poursuite : recul derrière le coureur et hauteur au-dessus du sol (m). Rapprochée (elle était à 5,2 m et 2,1 m). */
const CHASE_BACK = 3.5;
const CHASE_UP = 1.75;
/** Orbite de la caméra photo et du drone : toujours dans l'arc derrière le coureur (rad de part et d'autre). */
const PHOTO_MAX_YAW = 1.2;

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
  /** Ouverture du champ due à la vitesse (°), lissée. */
  private fovBoost = 0;
  /** Demi-tour : 0 → 1, la poursuite recule et monte (lissé). */
  private uturnPull = 0;
  private readonly aheadSample = { x: 0, y: 0, z: 0, dirX: 1, dirZ: 0, grade: 0, d: 0 };
  private photo = { yaw: 0, pitch: 0.15, dist: 3 };
  private dragging = false;
  /** Regarder derrière soi (touche X maintenue) : caméra devant le coureur, tournée vers l'arrière. */
  lookBack = false;
  /** Objets qui bloquent la vue (bâtiments) : la caméra TV cherche un plan dégagé. */
  /**
   * Obstacles entre deux points (bâtiments) : fraction du segment a → b au premier obstacle, null si dégagé.
   * Branché sur les emprises des bâtiments (voir FootprintIndex).
   */
  occlusion: ((a: THREE.Vector3, b: THREE.Vector3) => number | null) | null = null;
  private collideTick = 0;
  /** Rapprochement visé (mur entre le coureur et la caméra) et rapprochement appliqué, lissé. */
  private collideTarget = 1;
  private collideScale = 1;
  /**
   * Poursuite : cap de la caméra (rad), lissé. Placée derrière le cap instantané, la caméra
   * balayait un arc de 5 m en un quart de seconde dans les virages serrés.
   */
  private chaseYaw = 0;

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
      this.photo.yaw = THREE.MathUtils.clamp(this.photo.yaw - e.movementX * 0.005, -PHOTO_MAX_YAW, PHOTO_MAX_YAW);
      this.photo.pitch = THREE.MathUtils.clamp(this.photo.pitch + e.movementY * 0.004, -0.2, 1.3);
    });
    dom.addEventListener('wheel', (e) => {
      if (this.mode !== 'photo') return;
      this.photo.dist = THREE.MathUtils.clamp(this.photo.dist * (1 + Math.sign(e.deltaY) * 0.1), 0.8, 25);
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
    const order: RigMode[] = ['chase', 'cockpit', 'action', 'gopro', 'drone', 'tv', 'photo', 'free'];
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
    // Vues embarquées : grand angle fixe en horizontal (focale verticale déduite, bornée sur écran étroit).
    if (mode === 'cockpit' || mode === 'action') return Math.min(88, 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(ONBOARD[mode].hfov / 2)) / cam.aspect) * THREE.MathUtils.RAD2DEG);
    if (mode === 'free') return cam.aspect > 2.5 ? 55 : 70;
    return cam.aspect > 2.5 ? 48 : 62;
  }

  update(dt: number, t: CameraTarget): void {
    const cam = this.camera;
    if (this.mode !== 'tv') {
      // Poursuite : le champ s'ouvre un peu avec la vitesse (jusqu'à +6° vers 70 km/h), lissé : sensation de vitesse.
      const boost = this.mode === 'chase' ? 6 * THREE.MathUtils.smoothstep(t.speedMs, 8, 19) : 0;
      this.fovBoost += (boost - this.fovBoost) * Math.min(1, dt * 1.2);
      const fov = this.fovFor(this.mode) + this.fovBoost;
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
    if (this.lookBack && this.mode !== 'tv' && this.mode !== 'photo' && this.mode !== 'drone') {
      // Coup d'œil en arrière : qui arrive, l'équipier lâché, la voiture qui va doubler.
      desired.copy(t.position).addScaledVector(t.dir, 5).add(new THREE.Vector3(0, 1.9, 0));
      look.copy(t.position).addScaledVector(t.dir, -12).add(new THREE.Vector3(0, 1.0, 0));
      this.smoothPos.lerp(desired, 1 - Math.exp(-dt * 10));
      this.smoothLook.lerp(look, 1 - Math.exp(-dt * 10));
      cam.position.copy(this.smoothPos);
      cam.lookAt(this.smoothLook);
      return;
    }
    // Demi-tour : poursuite, même depuis une vue embarquée (retour à la vue choisie à la fin).
    const onboardTurn = !!t.uturn && (this.mode === 'cockpit' || this.mode === 'action' || this.mode === 'gopro');
    switch (onboardTurn ? 'chase' : this.mode) {
      case 'chase': {
        // Derrière et au-dessus, regard vers un point devant le coureur (anticipe les virages), pris sur la
        // trajectoire d'affichage (sur le tracé, il sautait à chaque sommet : la caméra balayait par à-coups).
        const ahead = this.track.linePositionAt(t.distM + 18 * (t.sign ?? 1), 0, t.speedMs, this.aheadSample);
        // Cap lissé (≈ 0,4 s, par le plus court chemin) : la caméra suit le virage sans fouetter.
        const yaw = Math.atan2(t.dir.x, t.dir.z);
        if (!this.initialized) this.chaseYaw = yaw;
        const dYaw = Math.atan2(Math.sin(yaw - this.chaseYaw), Math.cos(yaw - this.chaseYaw));
        this.chaseYaw += dYaw * (1 - Math.exp(-dt * 2));
        // Demi-tour : recul et hauteur en plus (tout l'arc dans le cadre), regard sur le coureur affiché.
        this.uturnPull += ((t.uturn ? 1 : 0) - this.uturnPull) * (1 - Math.exp(-dt * 2.5));
        const back = CHASE_BACK * (1 + 0.7 * this.uturnPull);
        const up = CHASE_UP + 0.9 * this.uturnPull;
        desired.set(t.position.x - Math.sin(this.chaseYaw) * back, t.position.y + up, t.position.z - Math.cos(this.chaseYaw) * back);
        look.set(ahead.x, ahead.y + 1.0, ahead.z).lerp(t.position.clone().add(new THREE.Vector3(0, 1.1, 0)), 0.55);
        if (t.uturn && t.subject) look.set(t.subject.x, t.subject.y + 1.0, t.subject.z);
        stiffness = 5;
        // Collision : un mur entre le coureur et la caméra rapproche la caméra (une image sur trois).
        if (this.occlusion && (this.collideTick = (this.collideTick + 1) % 3) === 0) {
          const head = t.position.clone().add(new THREE.Vector3(0, 1.3, 0));
          const len = desired.distanceTo(head);
          const hit = this.occlusion(head, desired);
          this.collideTarget = hit !== null ? Math.max(0.25, (hit * len - 0.6) / len) : 1;
        }
        // Vite vers le coureur (ne pas traverser le mur), lentement en reculant (pas de va-et-vient).
        const rate = this.collideTarget < this.collideScale ? 14 : 1.5;
        this.collideScale += (this.collideTarget - this.collideScale) * (1 - Math.exp(-dt * rate));
        if (this.collideScale < 1) {
          const head = t.position.clone().add(new THREE.Vector3(0, 1.3, 0));
          desired.sub(head).multiplyScalar(this.collideScale).add(head);
        }
        break;
      }
      case 'cockpit':
      case 'action': {
        // Solidaire de la tête (balancement du coup de pédale compris), dans l'axe du vélo.
        const v = ONBOARD[this.mode as 'cockpit' | 'action'];
        if (t.eye) desired.copy(t.eye).addScaledVector(t.dir, -v.back).addScaledVector(_up, v.up);
        else desired.copy(t.position).addScaledVector(t.dir, 0.1).addScaledVector(_up, 1.6 + v.up);
        const bikePitch = Math.atan(this.track.sample(t.distM).grade * (t.sign ?? 1) / 100);
        let pitch = bikePitch - 0.35;
        if (t.hands) {
          // Mains à v.handsAt de la hauteur de l'image : angle sous l'horizontale des mains, moins l'écart
          // entre le centre et cette hauteur (projection perspective : par la tangente).
          const hx = t.hands.x - desired.x;
          const hz = t.hands.z - desired.z;
          const ahead = Math.max(0.05, hx * t.dir.x + hz * t.dir.z);
          const handsBelow = Math.atan2(desired.y - t.hands.y, ahead);
          const vfov = THREE.MathUtils.degToRad(this.fovFor(this.mode));
          const offset = Math.atan((v.handsAt - 0.5) * 2 * Math.tan(vfov / 2));
          pitch = -THREE.MathUtils.clamp(handsBelow - offset, -0.2, 0.9);
        }
        look.set(desired.x + t.dir.x * Math.cos(pitch) * 10, desired.y + Math.sin(pitch) * 10, desired.z + t.dir.z * Math.cos(pitch) * 10);
        stiffness = 12;
        break;
      }
      case 'gopro': {
        // Caméra embarquée sur la poitrine : bras et cintre dans le champ, vibrations de la route.
        const shake = Math.sin(performance.now() * 0.031) * 0.006 * Math.min(t.speedMs / 8, 1);
        desired.copy(t.position).addScaledVector(t.dir, 0.42).add(new THREE.Vector3(0, 1.22 + shake, 0));
        const ahead = this.track.sample(t.distM + 12 * (t.sign ?? 1));
        look.set(ahead.x, ahead.y + 0.4, ahead.z);
        stiffness = 30;
        break;
      }
      case 'drone': {
        // Balayage lent de part et d'autre de l'axe, jamais devant le coureur.
        this.droneAngle += dt * 0.2;
        const r = 28;
        const a = Math.atan2(t.dir.x, t.dir.z) + Math.PI + Math.sin(this.droneAngle) * PHOTO_MAX_YAW;
        desired.set(t.position.x + Math.sin(a) * r, t.position.y + 16, t.position.z + Math.cos(a) * r);
        look.copy(t.position).add(new THREE.Vector3(0, 1, 0));
        stiffness = 2;
        break;
      }
      case 'tv': {
        // Plan fixe en bord de route, 60 à 90 m devant ; on change quand le coureur l'a dépassé.
        const sg = t.sign ?? 1;
        if (!this.tvSpot || (t.distM - this.tvSpot.untilD) * sg > 0) {
          // Plusieurs emplacements candidats ; on garde le premier qui voit la route sans bâtiment devant.
          for (let attempt = 0; attempt < 10; attempt++) {
            const d = t.distM + (55 + Math.random() * 40) * sg;
            const side = attempt % 2 ? 1 : -1;
            const s = this.track.positionAt(d, side * (6 + Math.random() * 6));
            const y = this.ground(s.x, s.z, s.y) + 1.6 + Math.random() * 2.5 + attempt * 0.8;
            const pos = new THREE.Vector3(s.x, y, s.z);
            const road = this.track.positionAt(d - 25 * sg, 0);
            const blocked = !!this.occlusion && this.occlusion(pos, new THREE.Vector3(road.x, road.y + 1, road.z)) !== null;
            if (!blocked || attempt === 9) {
              this.tvSpot = { pos, untilD: d + 15 * sg };
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
        // Sans main sur la souris, la caméra revient derrière le coureur.
        if (!this.dragging) {
          this.photo.yaw -= this.photo.yaw * (1 - Math.exp(-dt * 1.5));
          this.photo.pitch += (0.15 - this.photo.pitch) * (1 - Math.exp(-dt * 0.8));
        }
        const { yaw, pitch, dist } = this.photo;
        const base = Math.atan2(t.dir.x, t.dir.z) + Math.PI + yaw;
        desired.set(t.position.x + Math.sin(base) * Math.cos(pitch) * dist, t.position.y + 0.9 + Math.sin(pitch) * dist, t.position.z + Math.cos(base) * Math.cos(pitch) * dist);
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
    if ((this.mode === 'cockpit' || this.mode === 'action' || this.mode === 'gopro') && !onboardTurn) this.smoothPos.copy(desired);
    else this.smoothPos.lerp(desired, k);
    // Poursuite : le regard suit au même rythme que la position (plus vite, il pivotait d'un coup en virage).
    this.smoothLook.lerp(look, Math.min(1, this.mode === 'chase' ? k : k * 1.5));
    cam.position.copy(this.smoothPos);
    cam.lookAt(this.smoothLook);
    // Vibration du revêtement : forte en vue embarquée (solidaire du vélo), légère en poursuite.
    const share = this.mode === 'gopro' ? 1.3 : this.mode === 'action' ? 1.15 : this.mode === 'cockpit' ? 1 : this.mode === 'chase' ? 0.3 : 0;
    if (share > 0 && t.buzz) {
      const { dy, pitch } = buzzOffset(performance.now() / 1000, t.speedMs, t.buzz * share);
      cam.position.y += dy;
      cam.rotateX(pitch);
    }
  }
}
