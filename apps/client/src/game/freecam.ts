import * as THREE from 'three/webgpu';
import { getLang, t } from '../i18n/index.ts';

/** Touches physiques (e.code) : WASD en QWERTY = ZQSD en AZERTY, même position sur le clavier. */
const MOVE: Record<string, [number, number, number]> = {
  KeyW: [1, 0, 0],
  ArrowUp: [1, 0, 0],
  KeyS: [-1, 0, 0],
  ArrowDown: [-1, 0, 0],
  KeyA: [0, -1, 0],
  ArrowLeft: [0, -1, 0],
  KeyD: [0, 1, 0],
  ArrowRight: [0, 1, 0],
  KeyE: [0, 0, 1],
  KeyQ: [0, 0, -1],
};
/** Hauteur minimale de la caméra au-dessus du sol (m). */
const MIN_CLEARANCE = 1.2;
const MAX_ALTITUDE = 2500;
const SPEED_MIN = 2;
const SPEED_MAX = 1000;
const FAST = 6;

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Caméra libre : vol au clavier (ZQSD / WASD selon la disposition, flèches), A/E (Q/E en QWERTY)
 * pour descendre / monter, Maj pour accélérer, molette pour la vitesse de base, regard en
 * maintenant un bouton de la souris (gauche ou droit). Mouvements amortis, jamais sous le terrain.
 * Utilisée pendant une sortie (mode « free » de CameraRig) et depuis le menu (« Explorer la carte »).
 */
export class FreeFlyCamera {
  active = false;
  /** Vitesse de base (m/s), réglée à la molette. */
  speed = 40;
  /** Hauteur au-dessus du sol à l'image précédente (m) : on vole plus vite en altitude. */
  private clearance = 0;
  /** Ligne ajoutée à l'aide affichée (ex. « Échap : retour au menu »). */
  exitHint = '';
  private readonly camera: THREE.PerspectiveCamera;
  private readonly dom: HTMLElement;
  private readonly groundAt: (x: number, z: number) => number;
  private readonly keys = new Set<string>();
  private readonly pos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private yawTarget = 0;
  private pitchTarget = 0;
  private dragging = -1;
  private hint: HTMLElement | null = null;
  private labels: Record<string, string> | null = null;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (MOVE[e.code] || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
    }
  };
  private readonly onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private readonly onBlur = () => {
    this.keys.clear();
    this.dragging = -1;
  };
  private readonly onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    this.dragging = e.pointerId;
    this.dom.setPointerCapture?.(e.pointerId);
  };
  private readonly onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== this.dragging) return;
    this.dragging = -1;
    if (this.dom.hasPointerCapture?.(e.pointerId)) this.dom.releasePointerCapture(e.pointerId);
  };
  private readonly onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== this.dragging) return;
    this.yawTarget -= e.movementX * 0.0032;
    this.pitchTarget = THREE.MathUtils.clamp(this.pitchTarget - e.movementY * 0.0028, -1.5, 1.5);
  };
  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.speed = THREE.MathUtils.clamp(this.speed * (e.deltaY < 0 ? 1.2 : 1 / 1.2), SPEED_MIN, SPEED_MAX);
    this.renderHint();
  };
  private readonly onContextMenu = (e: Event) => e.preventDefault();

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, groundAt: (x: number, z: number) => number) {
    this.camera = camera;
    this.dom = dom;
    this.groundAt = groundAt;
  }

  /** Prend la main sur la caméra à partir de sa position et de son orientation courantes. */
  enable(): void {
    if (this.active) return;
    this.active = true;
    const cam = this.camera;
    this.pos.copy(cam.position);
    const dir = cam.getWorldDirection(_fwd);
    this.yaw = this.yawTarget = Math.atan2(-dir.x, -dir.z);
    this.pitch = this.pitchTarget = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    this.vel.set(0, 0, 0);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointermove', this.onPointerMove);
    this.dom.addEventListener('wheel', this.onWheel, { passive: false });
    this.dom.addEventListener('contextmenu', this.onContextMenu);
    this.showHint();
  }

  disable(): void {
    if (!this.active) return;
    this.active = false;
    this.keys.clear();
    this.dragging = -1;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.removeEventListener('contextmenu', this.onContextMenu);
    this.hint?.remove();
    this.hint = null;
  }

  /** Position courante (suivie par le chargement des tuiles). */
  get position(): THREE.Vector3 {
    return this.pos;
  }

  update(dt: number): void {
    if (!this.active) return;
    // Regard amorti.
    const kl = 1 - Math.exp(-dt * 16);
    this.yaw += (this.yawTarget - this.yaw) * kl;
    this.pitch += (this.pitchTarget - this.pitch) * kl;
    // Déplacement dans l'axe du regard (on vole là où l'on regarde), montée / descente verticale.
    const cp = Math.cos(this.pitch);
    _fwd.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let f = 0;
    let r = 0;
    let u = 0;
    for (const k of this.keys) {
      const m = MOVE[k];
      if (!m) continue;
      f += m[0];
      r += m[1];
      u += m[2];
    }
    _wish.set(0, 0, 0).addScaledVector(_fwd, f).addScaledVector(_right, r);
    _wish.y += u;
    if (_wish.lengthSq() > 1) _wish.normalize();
    const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? FAST : 1;
    // Plus vite en altitude : ×1 au ras du sol, jusqu'à ×8 à 240 m et plus (traverser une vallée).
    const high = THREE.MathUtils.clamp(this.clearance / 30, 1, 8);
    _wish.multiplyScalar(this.speed * fast * high);
    // Vitesse amortie : départ et arrêt progressifs.
    this.vel.lerp(_wish, 1 - Math.exp(-dt * 5));
    this.pos.addScaledVector(this.vel, dt);
    // Jamais sous le terrain (tuile chargée) ni trop haut.
    const h = this.groundAt(this.pos.x, this.pos.z);
    if (Number.isFinite(h)) {
      this.clearance = this.pos.y - h;
      const minY = h + MIN_CLEARANCE;
      if (this.pos.y < minY) {
        this.pos.y = minY;
        if (this.vel.y < 0) this.vel.y = 0;
      }
      if (this.pos.y > h + MAX_ALTITUDE) this.pos.y = h + MAX_ALTITUDE;
    }
    const cam = this.camera;
    cam.position.copy(this.pos);
    cam.quaternion.setFromEuler(_euler.set(this.pitch, this.yaw, 0, 'YXZ'));
  }

  // ————————————————————————————————————————————— Aide à l'écran

  private showHint(): void {
    this.hint?.remove();
    const el = document.createElement('div');
    el.className = 'freecam-hint';
    (document.getElementById('app') ?? document.body).appendChild(el);
    this.hint = el;
    this.renderHint();
    // Libellés réels des touches selon la disposition du clavier (Chrome / Edge).
    const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
    if (!this.labels && kb?.getLayoutMap) {
      void kb
        .getLayoutMap()
        .then((map) => {
          const l: Record<string, string> = {};
          for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']) l[c] = (map.get(c) ?? '').toUpperCase();
          if (Object.values(l).every((v) => v)) {
            this.labels = l;
            this.renderHint();
          }
        })
        .catch(() => undefined);
    }
  }

  private renderHint(): void {
    if (!this.hint) return;
    const fr = getLang() === 'fr';
    // Sans l'API de disposition : AZERTY supposé en français, QWERTY sinon.
    const l = this.labels ?? (fr ? { KeyW: 'Z', KeyA: 'Q', KeyS: 'S', KeyD: 'D', KeyQ: 'A', KeyE: 'E' } : { KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyQ: 'Q', KeyE: 'E' });
    const move = `${l.KeyW}${l.KeyA}${l.KeyS}${l.KeyD}`;
    const speed = `${Math.round(this.speed)} m/s`;
    const items = fr
      ? [`<kbd>${move}</kbd> / <kbd>←↑↓→</kbd> se déplacer`, `<kbd>${l.KeyQ}</kbd> <kbd>${l.KeyE}</kbd> descendre / monter`, '<kbd>Maj</kbd> rapide', '<kbd>clic maintenu</kbd> regarder', `<kbd>molette</kbd> vitesse (${speed})`]
      : [`<kbd>${move}</kbd> / <kbd>←↑↓→</kbd> move`, `<kbd>${l.KeyQ}</kbd> <kbd>${l.KeyE}</kbd> down / up`, '<kbd>Shift</kbd> fast', '<kbd>hold click</kbd> look', `<kbd>wheel</kbd> speed (${speed})`];
    if (this.exitHint) items.push(this.exitHint);
    this.hint.innerHTML = `<b>${t('freeCam')}</b>${items.map((i) => `<span>${i}</span>`).join('')}`;
  }
}
