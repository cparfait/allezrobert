import * as THREE from 'three/webgpu';
import { float, max, mix, normalize, positionLocal, pow, smoothstep, uniform, vec3, dot } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colorUniform } from '../engine/tsl.ts';
import { rng } from '../engine/noise.ts';
import { domeVertex } from './overcast.ts';
import { LOW_POLY } from '../engine/style.ts';

/**
 * Ciel du style jeu vidéo (par défaut avec LOW_POLY ; ?sky=real pour le ciel physique) : dégradé simple
 * bleu ciel → horizon laiteux en paliers doux, soleil en disque net avec un halo, et nuages en volumes
 * à facettes (icosaèdres aplatis, blancs, éclairés par le soleil) qui dérivent avec le vent autour du
 * coureur. Remplace à l'écran le ciel physique (gardé pour la lumière d'ambiance, SkyLight).
 */
export const LOW_POLY_SKY = (() => {
  const p = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('sky');
  return p === 'lowpoly' || (LOW_POLY && p !== 'real');
})();

const CLOUDS = 34;

/** Nuage : 4 à 6 boules à facettes aplaties dessous, de tailles décroissantes vers les bords. */
function cloudGeometry(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const n = 4 + Math.floor(r() * 3);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    const size = 70 * (1 - Math.abs(t) * 0.9) * (0.8 + r() * 0.4);
    const g = new THREE.IcosahedronGeometry(size, 1);
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) p.setY(k, Math.max(p.getY(k), -size * 0.25) * 0.75);
    g.translate(t * 220 + (r() - 0.5) * 30, size * 0.15, (r() - 0.5) * 60);
    g.deleteAttribute('uv');
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  return mergeGeometries(parts, false) as THREE.BufferGeometry;
}

export class LowPolySky {
  readonly group = new THREE.Group();
  private readonly zenith = colorUniform('#7fb8ea');
  private readonly horizon = colorUniform('#e9f1f6');
  private readonly sunDir = uniform(new THREE.Vector3(0, 1, 0));
  private readonly sunColor = colorUniform('#fff4dc');
  private readonly sunAmount = uniform(1);
  private readonly cloudMat: THREE.MeshStandardNodeMaterial;
  private readonly cloudTint = colorUniform('#ffffff');
  private readonly clouds = new THREE.Group();
  private readonly drift = new THREE.Vector2();
  private readonly slots: Array<{ x: number; z: number; y: number; mesh: THREE.Mesh }> = [];
  private readonly radius: number;

  constructor(viewDistance: number) {
    this.group.name = 'lowpoly-sky';
    // Dôme : dégradé en paliers doux (aplat bleu en haut, bande claire à l'horizon), disque solaire et halo.
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
    m.vertexNode = domeVertex();
    const dir = normalize(positionLocal);
    const up = max(dir.y, float(0));
    const band = smoothstep(0.0, 0.08, up).mul(0.45).add(smoothstep(0.08, 0.45, up).mul(0.55));
    const sky = mix(this.horizon.node, this.zenith.node, band);
    const toSun = max(dot(dir, normalize(this.sunDir)), float(0));
    const disc = smoothstep(0.9993, 0.9996, toSun);
    const halo = pow(toSun, float(60)).mul(0.35);
    m.colorNode = mix(sky.add(vec3(this.sunColor.node).mul(halo.mul(this.sunAmount))), vec3(this.sunColor.node).mul(1.6), disc.mul(this.sunAmount));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), m);
    dome.renderOrder = -1.8;
    dome.frustumCulled = false;
    dome.name = 'lowpoly-sky-dome';
    this.group.add(dome);

    // Nuages : blancs à facettes, sans brume (ils sont loin), sans ombre portée.
    this.cloudMat = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0, fog: false });
    this.cloudMat.flatShading = true;
    this.cloudMat.colorNode = this.cloudTint.node;
    this.cloudMat.emissiveNode = this.cloudTint.node.mul(0.35);
    this.radius = Math.min(viewDistance * 0.8, 3800);
    const r = rng(77);
    for (let i = 0; i < CLOUDS; i++) {
      const mesh = new THREE.Mesh(cloudGeometry(100 + i), this.cloudMat);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.rotation.y = r() * Math.PI * 2;
      mesh.scale.setScalar(0.7 + r() * 0.8);
      const a = r() * Math.PI * 2;
      const d = this.radius * (0.35 + r() * 0.65);
      this.slots.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, y: 420 + r() * 380, mesh });
      this.clouds.add(mesh);
    }
    this.group.add(this.clouds);
  }

  /**
   * @param sky couleur du ciel (zénith) et `haze` de la brume (horizon) du moment ; `daylight` 0 la nuit → 1 le jour ;
   * `cover` couverture nuageuse (0–1) : nuages plus nombreux et plus gris ; vent (m/s, d'où il vient).
   */
  update(dt: number, focus: THREE.Vector3, sky: THREE.Color, haze: THREE.Color, sunDir: THREE.Vector3, sunColor: THREE.Color, daylight: number, cover: number, windMs: number, windFrom: number): void {
    this.zenith.value.copy(sky).lerp(new THREE.Color('#5aa6ea'), 0.35 * daylight);
    this.horizon.value.copy(haze).lerp(new THREE.Color('#f4f8fb'), 0.45 * daylight);
    (this.sunDir.value as THREE.Vector3).copy(sunDir);
    this.sunColor.value.copy(sunColor);
    this.sunAmount.value = daylight * (1 - Math.max(0, cover - 0.5) * 2);
    // Nuages : blancs au soleil, gris sous un ciel couvert, sombres la nuit.
    this.cloudTint.value.setRGB(1, 1, 1).lerp(new THREE.Color('#9aa3ad'), Math.max(0, cover - 0.3)).multiplyScalar(0.15 + 0.85 * daylight);
    // Dérive avec le vent (vers où il souffle), recentrée autour du coureur.
    const v = Math.max(2, windMs) * 3;
    this.drift.x += -Math.sin(windFrom) * v * dt;
    this.drift.y += Math.cos(windFrom) * v * dt;
    const R = this.radius;
    const shown = Math.round(CLOUDS * (0.45 + 0.55 * Math.min(1, cover * 1.6 + 0.2)));
    this.slots.forEach((s, i) => {
      let x = s.x + this.drift.x;
      let z = s.z + this.drift.y;
      x = ((((x + R) % (2 * R)) + 2 * R) % (2 * R)) - R;
      z = ((((z + R) % (2 * R)) + 2 * R) % (2 * R)) - R;
      s.mesh.position.set(focus.x + x, focus.y + s.y, focus.z + z);
      s.mesh.visible = i < shown;
    });
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
  }
}
