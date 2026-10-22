import * as THREE from 'three/webgpu';
import { attribute, positionLocal, time, sin, vec3, float, uniform, mix, instanceIndex, hash, varying, transformNormalToView } from 'three/tsl';
import { colorUniform } from '../engine/tsl.ts';
import { rng } from '../engine/noise.ts';
import type { QualitySettings } from '../engine/quality.ts';
import type { LoadedTile } from './types.ts';
import { splatAt } from './splat.ts';
import type { Season } from './environment.ts';

const RADIUS = 60;
const SEASON_GRASS: Record<Season, [string, string]> = {
  spring: ['#4f7f2c', '#a9d36a'],
  summer: ['#5b7a30', '#c9c46a'],
  autumn: ['#5d6f2e', '#b3ad62'],
  winter: ['#5f6447', '#a3a283'],
};

/** Touffe : 3 brins croisés, sommets colorés de la base (sombre) à la pointe (claire). */
function clumpGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const tip: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const dx = Math.cos(a) * 0.035;
    const dz = Math.sin(a) * 0.035;
    const h = 0.2 + k * 0.05;
    const lean = 0.05 * (k - 1);
    // Brin = triangle effilé (base large, pointe fine).
    pos.push(-dx, 0, -dz, dx, 0, dz, lean, h, lean * 0.5);
    tip.push(0, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('tip', new THREE.Float32BufferAttribute(tip, 1));
  // Normales vers le haut : éclairage doux et homogène des brins.
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

/**
 * Herbe instanciée autour de la caméra (prairies, bas-côtés, lisières), régénérée par pas de
 * 12 m ; balancement au vent sur le GPU. Densité selon la qualité graphique.
 */
export class GrassField {
  readonly mesh: THREE.InstancedMesh;
  readonly wind = uniform(0.3);
  /** Direction vers laquelle souffle le vent (x, z), unitaire. */
  readonly windDir = uniform(new THREE.Vector2(0.6, 0.8));
  private readonly base = colorUniform();
  private readonly tipCol = colorUniform();
  private readonly max: number;
  private readonly center = new THREE.Vector3(1e9, 0, 1e9);
  private readonly tileAt: (x: number, z: number) => LoadedTile | undefined;
  private readonly heightAt: (x: number, z: number) => number;
  private readonly avoid: (x: number, z: number) => boolean;

  constructor(q: QualitySettings, season: Season, tileAt: (x: number, z: number) => LoadedTile | undefined, heightAt: (x: number, z: number) => number, avoid: (x: number, z: number) => boolean) {
    this.tileAt = tileAt;
    this.heightAt = heightAt;
    this.avoid = avoid;
    this.max = Math.floor(60000 * q.grassDensity);
    const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
    const tip = attribute<'float'>('tip');
    const h = hash(instanceIndex);
    // Brins couchés dans le sens du vent, avec des vagues de rafales qui parcourent la prairie.
    const wave = sin(positionLocal.x.mul(this.windDir.x).add(positionLocal.z.mul(this.windDir.y)).mul(0.35).sub(time.mul(2.2)));
    const sway = sin(time.mul(float(1.6).add(h.mul(0.8))).add(h.mul(30))).mul(0.4).add(wave.mul(0.35)).add(0.6).mul(this.wind).mul(tip).mul(0.12);
    m.positionNode = positionLocal.add(vec3(this.windDir.x.mul(sway), 0, this.windDir.y.mul(sway)));
    m.colorNode = varying(mix(this.base.node, this.tipCol.node, tip.mul(h.mul(0.4).add(0.6))).mul(h.mul(0.3).add(0.8)));
    m.roughnessNode = float(0.85);
    // Normale verticale des deux côtés : les brins sont éclairés comme le sol (pas de faces sombres).
    m.normalNode = transformNormalToView(vec3(0, 1, 0));
    this.mesh = new THREE.InstancedMesh(clumpGeometry(), m, Math.max(this.max, 1));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'grass';
    this.setSeason(season);
  }

  setSeason(season: Season): void {
    const [b, t] = SEASON_GRASS[season];
    this.base.set(b);
    this.tipCol.set(t);
  }

  update(focus: THREE.Vector3): void {
    if (!this.max) return;
    if (Math.hypot(focus.x - this.center.x, focus.z - this.center.z) < 12) return;
    this.center.copy(focus);
    const r = rng(Math.floor(focus.x / 12) * 7349 + Math.floor(focus.z / 12) * 1931);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    const tries = this.max * 2;
    for (let i = 0; i < tries && n < this.max; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * RADIUS;
      const x = focus.x + Math.cos(a) * d;
      const z = focus.z + Math.sin(a) * d;
      const tile = this.tileAt(x, z);
      if (!tile) continue;
      const meadow = splatAt(tile, 2, x, z);
      const field = splatAt(tile, 1, x, z);
      const forest = splatAt(tile, 0, x, z);
      const road = splatAt(tile, 5, x, z);
      const water = splatAt(tile, 3, x, z);
      // Herbe partout sauf chaussée et eau, plus dense dans les prés et sur les bas-côtés.
      const density = road > 0.3 || water > 0.3 ? 0 : 0.35 + meadow * 0.65 - forest * 0.25 + field * 0.1;
      if (r() > density) continue;
      if (this.avoid(x, z)) continue;
      const y = this.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      const k = 0.6 + r() * 0.7;
      p.set(x, y - 0.02, z);
      q.setFromAxisAngle(up, r() * Math.PI);
      s.set(k, k * (0.8 + r() * 0.6), k);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(n++, m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
