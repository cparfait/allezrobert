import * as THREE from 'three/webgpu';
import { attribute, positionLocal, time, sin, vec3, float, uniform, mix, instanceIndex, hash, varying, transformNormalToView } from 'three/tsl';
import { colorUniform } from '../engine/tsl.ts';
import { rng } from '../engine/noise.ts';
import type { QualitySettings } from '../engine/quality.ts';
import type { LoadedTile } from './types.ts';
import { splatAt } from './splat.ts';
import type { Season } from './environment.ts';
import { snowCoverAt } from './alpine.ts';
import { cloudShade } from './clouds.ts';

const RADIUS = 60;
/** Côté (m) des blocs du monde où l'herbe est semée : mêmes touffes aux mêmes endroits à chaque regénération. */
const BLOCK = 12;
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
  private job: { focus: THREE.Vector3; blocks: Array<{ bx: number; bz: number; d: number }>; bi: number; ti: number; r: (() => number) | null; n: number } | null = null;
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
    m.colorNode = varying(mix(this.base.node, tipCol, tip.pow(0.8)).mul(h.mul(0.25).add(0.82))).mul(cloudShade());
    m.roughnessNode = float(0.85);
    // Brins tournés vers le ciel : moitié moins de lumière du ciel, sinon l'herbe blanchit (voile bleuté).
    m.envMapIntensity = 0.5;
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
      // Les touffes sont ancrées au monde : blocs fixes de BLOCK m, chacun avec sa graine. Une regénération
      // refait donc les mêmes touffes aux mêmes endroits (l'herbe ne bouge plus quand on avance) ; seule la
      // bordure du rayon change. Blocs triés du plus proche au plus loin : si le plafond est atteint, ce
      // sont les plus lointains qui manquent.
      const blocks: Array<{ bx: number; bz: number; d: number }> = [];
      const bx0 = Math.floor((focus.x - RADIUS) / BLOCK);
      const bx1 = Math.floor((focus.x + RADIUS) / BLOCK);
      const bz0 = Math.floor((focus.z - RADIUS) / BLOCK);
      const bz1 = Math.floor((focus.z + RADIUS) / BLOCK);
      for (let bx = bx0; bx <= bx1; bx++)
        for (let bz = bz0; bz <= bz1; bz++) {
          const d = Math.hypot((bx + 0.5) * BLOCK - focus.x, (bz + 0.5) * BLOCK - focus.z);
          if (d <= RADIUS + BLOCK * 0.71) blocks.push({ bx, bz, d });
        }
      blocks.sort((a, b) => a.d - b.d);
      this.job = { focus: focus.clone(), blocks, bi: 0, ti: 0, r: null, n: 0 };
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
    const { focus, blocks } = job;
    const staging = this.staging as Float32Array;
    const m = _m;
    const q = _q;
    const s = _s;
    const p = _p;
    const up = _up;
    let n = job.n;
    // Essais par bloc : 2 × le plafond réparti sur l'aire du disque (comme avant, où les essais étaient tirés au hasard).
    const triesPerBlock = Math.ceil((2 * this.max * BLOCK * BLOCK) / (Math.PI * RADIUS * RADIUS));
    let spent = 0;
    while (job.bi < blocks.length && n < this.max && spent < budget) {
      const blk = blocks[job.bi] as { bx: number; bz: number };
      job.r ??= rng(((blk.bx * 73856093) ^ (blk.bz * 19349663)) | 0);
      const r = job.r;
      for (; job.ti < triesPerBlock && spent < budget && n < this.max; job.ti++, spent++) {
        // Tous les tirages à chaque essai, acceptés ou non : la suite du bloc ne dépend pas du foyer ni du terrain.
        const ux = r();
        const uz = r();
        const uDensity = r();
        const uSnow = r();
        const uSize = r();
        const uTurn = r();
        const uHeight = r();
        const x = (blk.bx + ux) * BLOCK;
        const z = (blk.bz + uz) * BLOCK;
        if (Math.hypot(x - focus.x, z - focus.z) > RADIUS) continue;
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
        if (uDensity > density) continue;
        if (this.avoid(x, z)) continue;
        const y = this.heightAt(x, z);
        if (!Number.isFinite(y)) continue;
        // au-dessus de la limite d'enneigement : sous la neige
        const snow = snowCoverAt(y, this.season);
        if (snow > 0 && uSnow < snow) continue;
        const k = (0.6 + uSize * 0.7) * (1 + verge * 0.6);
        p.set(x, y - 0.02, z);
        q.setFromAxisAngle(up, uTurn * Math.PI);
        s.set(k, k * (0.8 + uHeight * 0.6), k);
        m.compose(p, q, s);
        m.toArray(staging, n++ * 16);
      }
      if (job.ti >= triesPerBlock) {
        job.bi++;
        job.ti = 0;
        job.r = null;
      }
    }
    job.n = n;
    if (job.bi < blocks.length && n < this.max) return;
    (this.mesh.instanceMatrix.array as Float32Array).set(staging.subarray(0, n * 16));
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.job = null;
  }
}
