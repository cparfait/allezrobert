import * as THREE from 'three/webgpu';
import type { RouteTrack } from '@allezrobert/shared';

/**
 * Rampe de départ du contre-la-montre : plateforme surélevée, pente de descente, portique « DÉPART » avec l'horloge du
 * compte à rebours tournée vers la caméra de poursuite. Le joueur attend en haut (liftAt le soulève), puis descend la
 * pente au « go ». La rampe disparaît une fois le joueur loin (le parcours en boucle repasse par le départ).
 */

/** Hauteur de la plateforme (m), longueur du plat derrière la ligne et de la pente devant (m). */
export const RAMP_H = 0.9;
const FLAT_BACK_M = 3.0;
const FLAT_FRONT_M = 0.6;
const SLOPE_M = 4.5;
const WIDTH_M = 2.6;

/** Élévation (m) et tangage (rad, négatif en descente) du coureur à `d` mètres de la ligne de départ. */
export function rampLift(d: number): { dy: number; pitch: number } {
  if (d < -FLAT_BACK_M || d > FLAT_FRONT_M + SLOPE_M) return { dy: 0, pitch: 0 };
  if (d <= FLAT_FRONT_M) return { dy: RAMP_H, pitch: 0 };
  return { dy: RAMP_H * (1 - (d - FLAT_FRONT_M) / SLOPE_M), pitch: -Math.atan(RAMP_H / SLOPE_M) };
}

/** Texte de l'horloge : « 0:10 » … « 0:01 », puis « GO ». */
export function clockText(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'GO';
  const s = Math.ceil(secondsLeft);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class StartRamp {
  readonly root = new THREE.Group();
  private readonly clock = document.createElement('canvas');
  private readonly clockTex: THREE.CanvasTexture;
  private lastClock = '';

  constructor(
    scene: THREE.Scene,
    track: RouteTrack,
    private readonly startD: number,
    lateral: number,
  ) {
    const p = track.positionAt(startD, lateral);
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = Math.atan2(p.dirX, p.dirZ);
    const mat = (color: string, roughness = 0.7, metalness = 0) => new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
    const carpet = mat('#1d3f8f', 0.85);
    const frame = mat('#2a2d33', 0.6, 0.4);
    const white = mat('#f2f2ee', 0.6);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      return mesh;
    };
    // Plateforme : flancs sombres, dessus en moquette bleue, liserés blancs.
    const flatLen = FLAT_BACK_M + FLAT_FRONT_M;
    const flatZ = (FLAT_FRONT_M - FLAT_BACK_M) / 2;
    add(new THREE.BoxGeometry(WIDTH_M, RAMP_H - 0.04, flatLen), frame, 0, (RAMP_H - 0.04) / 2, flatZ);
    add(new THREE.BoxGeometry(WIDTH_M, 0.04, flatLen), carpet, 0, RAMP_H - 0.02, flatZ);
    for (const x of [-WIDTH_M / 2 + 0.05, WIDTH_M / 2 - 0.05]) add(new THREE.BoxGeometry(0.1, 0.045, flatLen), white, x, RAMP_H - 0.015, flatZ);
    // Ligne de départ blanche.
    add(new THREE.BoxGeometry(WIDTH_M - 0.2, 0.046, 0.12), white, 0, RAMP_H - 0.015, 0);
    // Pente : prisme (profil triangulaire extrudé sur la largeur).
    const shape = new THREE.Shape([new THREE.Vector2(FLAT_FRONT_M, 0), new THREE.Vector2(FLAT_FRONT_M + SLOPE_M, 0), new THREE.Vector2(FLAT_FRONT_M, RAMP_H)]);
    const prism = new THREE.ExtrudeGeometry(shape, { depth: WIDTH_M, bevelEnabled: false });
    prism.rotateY(-Math.PI / 2);
    prism.translate(WIDTH_M / 2, 0, 0);
    const slope = new THREE.Mesh(prism, [frame, carpet]);
    slope.castShadow = slope.receiveShadow = true;
    this.root.add(slope);
    // Portique : deux poteaux, traverse, banderole « DÉPART », horloge au-dessus.
    const postH = RAMP_H + 2.6;
    for (const x of [-WIDTH_M / 2 - 0.25, WIDTH_M / 2 + 0.25]) add(new THREE.BoxGeometry(0.16, postH, 0.16), frame, x, postH / 2, 0.2);
    add(new THREE.BoxGeometry(WIDTH_M + 0.66, 0.14, 0.16), frame, 0, postH, 0.2);
    const banner = document.createElement('canvas');
    banner.width = 512;
    banner.height = 96;
    const g = banner.getContext('2d');
    if (g) {
      g.fillStyle = '#1d3f8f';
      g.fillRect(0, 0, 512, 96);
      g.fillStyle = '#ffd23f';
      g.fillRect(0, 84, 512, 12);
      g.fillStyle = '#f2f2ee';
      g.font = '900 62px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('DÉPART', 256, 44);
    }
    const bannerTex = new THREE.CanvasTexture(banner);
    bannerTex.colorSpace = THREE.SRGBColorSpace;
    const bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH_M + 0.5, 0.48), new THREE.MeshBasicNodeMaterial({ map: bannerTex, side: THREE.DoubleSide }));
    bannerMesh.position.set(0, postH - 0.32, 0.1);
    bannerMesh.rotation.y = Math.PI;
    this.root.add(bannerMesh);
    this.clock.width = 256;
    this.clock.height = 128;
    this.clockTex = new THREE.CanvasTexture(this.clock);
    this.clockTex.colorSpace = THREE.SRGBColorSpace;
    // Horloge contre le poteau droit, à hauteur des yeux : visible de la caméra de poursuite, sous le HUD du haut.
    const clockX = -(WIDTH_M / 2 - 0.15); // −x : à droite quand on regarde vers +z
    const clockY = RAMP_H + 1.75;
    add(new THREE.BoxGeometry(0.7, 0.4, 0.1), frame, clockX, clockY, 0.2);
    const clockMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.34), new THREE.MeshBasicNodeMaterial({ map: this.clockTex }));
    clockMesh.position.set(clockX, clockY, 0.14);
    clockMesh.rotation.y = Math.PI;
    this.root.add(clockMesh);
    this.setClock(10);
    scene.add(this.root);
  }

  /** Élévation et tangage du coureur à la distance `distM` de l'itinéraire. */
  liftAt(distM: number): { dy: number; pitch: number } {
    return this.root.visible ? rampLift(distM - this.startD) : { dy: 0, pitch: 0 };
  }

  /** Horloge du portique (secondes restantes ; ≤ 0 : « GO »). */
  setClock(secondsLeft: number): void {
    const text = clockText(secondsLeft);
    if (text === this.lastClock) return;
    this.lastClock = text;
    const g = this.clock.getContext('2d');
    if (!g) return;
    g.fillStyle = '#0b0d10';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = text === 'GO' ? '#3fe07a' : secondsLeft <= 5 ? '#ff5a4a' : '#ffd23f';
    g.font = '700 92px ui-monospace, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 68);
    this.clockTex.needsUpdate = true;
  }

  /** Masque la rampe quand le joueur est parti loin (au-delà de 80 m). */
  update(distM: number): void {
    if (this.root.visible && distM - this.startD > 80) this.root.visible = false;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        (mat as THREE.MeshBasicNodeMaterial).map?.dispose();
        mat.dispose();
      }
    });
  }
}
