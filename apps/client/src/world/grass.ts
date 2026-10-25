import * as THREE from 'three/webgpu';
import { attribute, positionLocal, time, sin, vec3, float, uniform, mix, instanceIndex, hash, varying, transformNormalToView } from 'three/tsl';
import { colorUniform } from '../engine/tsl.ts';
import { rng } from '../engine/noise.ts';
import type { QualitySettings } from '../engine/quality.ts';
import type { LoadedTile } from './types.ts';
import { splatAt } from './splat.ts';
import type { Season } from './environment.ts';
import { snowCoverAt } from './alpine.ts';

const RADIUS = 60;
/** Essais de placement par image pendant une regénération (≈ 12 ms ; une vingtaine d'images pour la densité la plus forte). */
const GRASS_TRIES_PER_FRAME = 6000;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
/** Base (pied, ombragé) et pointe des brins par saison : verts sourds, pointes olive (pas de jaune vif). */
const SEASON_GRASS: Record<Season, [string, string]> = {
  spring: ['#3d6324', '#86a84e'],
  summer: ['#3e5a22', '#7d8f45'],
  autumn: ['#45552a', '#8c8a52'],
  winter: ['#4b5338', '#8a8a6c'],
};

/**
 * Touffe : 7 brins effilés et courbés, de hauteurs différentes, ouverts en éventail depuis le pied
 * (chaque brin : un quadrilatère puis une pointe, penchés vers l'extérieur). `tip` = 0 au pied,
 * 1 à la pointe (couleur et balancement).
 */
function clumpGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const tip: number[] = [];
  const r = rng(17);
  const blades = 7;
  for (let k = 0; k < blades; k++) {
    const a = (k / blades) * Math.PI * 2 + r() * 0.6;
    const ox = Math.cos(a) * (0.02 + r() * 0.05);
    const oz = Math.sin(a) * (0.02 + r() * 0.05);
    const h = 0.18 + r() * 0.3;
    const w = 0.012 + r() * 0.01;
    // largeur perpendiculaire à la direction d'ouverture
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    // courbure : le brin s'écarte de plus en plus vers la pointe
    const lean = 0.35 + r() * 0.35;
    const mx = ox + Math.cos(a) * h * lean * 0.35;
    const mz = oz + Math.sin(a) * h * lean * 0.35;
    const tx = ox + Math.cos(a) * h * lean;
    const tz = oz + Math.sin(a) * h * lean;
    const hm = h * 0.55;
    // quadrilatère du bas (2 triangles), puis pointe
    pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, mx + px * 0.7, hm, mz + pz * 0.7);
    pos.push(ox - px, 0, oz - pz, mx + px * 0.7, hm, mz + pz * 0.7, mx - px * 0.7, hm, mz - pz * 0.7);
    pos.push(mx - px * 0.7, hm, mz - pz * 0.7, mx + px * 0.7, hm, mz + pz * 0.7, tx, h * 0.92, tz);
    tip.push(0, 0, 0.55, 0, 0.55, 0.55, 0.55, 0.55, 1);
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
  private season: Season = 'summer';
  /**
   * Regénération en cours, étalée sur quelques images : jusqu'à 48 000 touffes refaites d'un coup tous les
   * 12 m figeaient l'image (≈ 55 ms). Les touffes affichées restent en place jusqu'à la fin.
   */
  private job: { focus: THREE.Vector3; r: () => number; i: number; n: number } | null = null;
  /** Matrices de la regénération en cours (gardé d'une fois à l'autre : 3 Mo). */
  private staging: Float32Array | null = null;

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
    // une touffe sur huit plus sèche (paille), variation de teinte par touffe
    const dry = hash(instanceIndex.add(31)).greaterThan(0.875).select(float(1), float(0));
    const tipCol = mix(this.tipCol.node, vec3(0.42, 0.38, 0.22), dry.mul(0.7));
    m.colorNode = varying(mix(this.base.node, tipCol, tip.pow(0.8)).mul(h.mul(0.25).add(0.82)));
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
    this.season = season;
    // régénérer au prochain update (enneigement)
    this.center.set(1e9, 0, 1e9);
    this.job = null;
    const [b, t] = SEASON_GRASS[season];
    this.base.set(b);
    this.tipCol.set(t);
  }

  update(focus: THREE.Vector3): void {
    if (!this.max) return;
    if (!this.job && Math.hypot(focus.x - this.center.x, focus.z - this.center.z) >= 12) {
      this.center.copy(focus);
      const r = rng(Math.floor(focus.x / 12) * 7349 + Math.floor(focus.z / 12) * 1931);
      this.job = { focus: focus.clone(), r, i: 0, n: 0 };
      this.staging ??= new Float32Array(this.max * 16);
      // Premier remplissage (départ, changement de saison) : tout de suite, sous l'écran d'attente.
      if (this.mesh.count === 0) return this.advance(Infinity);
    }
    if (this.job) this.advance(GRASS_TRIES_PER_FRAME);
  }

  /** Avance la regénération de `budget` essais ; à la fin, les nouvelles touffes remplacent les anciennes. */
  private advance(budget: number): void {
    const job = this.job;
    if (!job) return;
    const { focus, r } = job;
    const staging = this.staging as Float32Array;
    const m = _m;
    const q = _q;
    const s = _s;
    const p = _p;
    const up = _up;
    let n = job.n;
    const tries = this.max * 2;
    const end = Math.min(tries, job.i + budget);
    let i = job.i;
    for (; i < end && n < this.max; i++) {
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
      // abords de l'itinéraire actif : bas-côté herbeux dense et plus haut
      const verge = splatAt(tile, 6, x, z);
      // Herbe partout sauf chaussée et eau, plus dense dans les prés et sur les bas-côtés.
      // ni sur la roche, les éboulis et les glaciers
      const rock = splatAt(tile, 7, x, z);
      const density = road > 0.3 || water > 0.3 || rock > 0.2 ? 0 : 0.35 + meadow * 0.65 - forest * 0.25 + field * 0.1 + verge * 0.8;
      if (r() > density) continue;
      if (this.avoid(x, z)) continue;
      const y = this.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      // au-dessus de la limite d'enneigement : sous la neige
      const snow = snowCoverAt(y, this.season);
      if (snow > 0 && r() < snow) continue;
      const k = (0.6 + r() * 0.7) * (1 + verge * 0.6);
      p.set(x, y - 0.02, z);
      q.setFromAxisAngle(up, r() * Math.PI);
      s.set(k, k * (0.8 + r() * 0.6), k);
      m.compose(p, q, s);
      m.toArray(staging, n++ * 16);
    }
    job.i = i;
    job.n = n;
    if (i < tries && n < this.max) return;
    (this.mesh.instanceMatrix.array as Float32Array).set(staging.subarray(0, n * 16));
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.job = null;
  }
}
