import * as THREE from 'three/webgpu';
import { LOW_POLY } from '../engine/style.ts';
import { attribute, positionLocal, positionWorld, time, sin, vec3, float, uniform, mix, fract, floor, mx_noise_float, varying, transformNormalToView } from 'three/tsl';
import { colorUniform } from '../engine/tsl.ts';
import { rng } from '../engine/noise.ts';
import type { QualitySettings } from '../engine/quality.ts';
import type { LoadedTile } from './types.ts';
import type { Season } from './environment.ts';
import { cloudShade } from './clouds.ts';
import { GRASS_BLOCK, GRASS_RADIUS, appendGrassBlock, generateGrassBlock, grassBlocksAround, grassTriesPerBlock, type GrassBlock, type GrassEnv } from './grassPlacement.ts';

/** Essais de placement par image pendant une regénération (≈ 12 ms ; une vingtaine d'images pour la densité la plus forte). */
const GRASS_TRIES_PER_FRAME = 6000;
/** Coût compté (en essais) d'un bloc repris du cache : une simple copie. */
const CACHED_BLOCK_COST = 40;
/** Les blocs gardés en mémoire sont ceux du disque d'herbe et une marge de quelques blocs autour. */
const KEEP_RADIUS = GRASS_RADIUS + GRASS_BLOCK * 4;
/** Clé d'un bloc dans le cache (indices de bloc : |indice| < 2^19). */
const BLOCK_KEY = 1_048_576;
/** Base (pied, ombragé) et pointe des brins par saison : verts sourds, pointes olive (pas de jaune vif). */
const SEASON_GRASS: Record<Season, [string, string]> = LOW_POLY
  ? {
      // Style jeu vidéo : pied au vert du pré (LOWPOLY_GROUND de terrain.ts), pointe plus claire.
      spring: ['#7cbf4a', '#b3df6a'],
      summer: ['#86c04e', '#b8dc62'],
      autumn: ['#8cba4c', '#c2d46a'],
      winter: ['#9aae7a', '#c4cca0'],
    }
  : {
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
/**
 * Style jeu vidéo : touffe de 5 larges brins triangulaires, coudés une fois (deux facettes chacun), plus
 * trapus que les brins fins et courbés du rendu réaliste. `tip` = 0 au pied, 1 à la pointe.
 */
function lowPolyClumpGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const tip: number[] = [];
  const r = rng(29);
  const blades = 5;
  for (let k = 0; k < blades; k++) {
    const a = (k / blades) * Math.PI * 2 + r() * 0.8;
    const ox = Math.cos(a) * (0.015 + r() * 0.04);
    const oz = Math.sin(a) * (0.015 + r() * 0.04);
    const h = 0.2 + r() * 0.22;
    const w = 0.035 + r() * 0.025;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    // coude à mi-hauteur, pointe penchée vers l'extérieur
    const lean = 0.3 + r() * 0.3;
    const mx = ox + Math.cos(a) * h * lean * 0.3;
    const mz = oz + Math.sin(a) * h * lean * 0.3;
    const tx = ox + Math.cos(a) * h * lean;
    const tz = oz + Math.sin(a) * h * lean;
    const hm = h * 0.5;
    pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, mx, hm, mz);
    pos.push(ox - px, 0, oz - pz, mx, hm, mz, tx, h, tz);
    pos.push(mx, hm, mz, ox + px, 0, oz + pz, tx, h, tz);
    tip.push(0, 0, 0.5, 0, 0.5, 1, 0.5, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('tip', new THREE.Float32BufferAttribute(tip, 1));
  g.computeVertexNormals();
  return g;
}

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
  private readonly env: GrassEnv;
  private readonly tries: number;
  private season: Season = 'summer';
  /**
   * Touffes déjà placées, par bloc du monde : un bloc ne dépend ni du coureur ni du rayon (graine fixe), donc une
   * regénération ne refait que les blocs qui entrent dans le disque (une bande de 12 m, au lieu des ~80 blocs
   * à chaque pas). Vidé au changement de saison (neige).
   */
  private readonly blocks = new Map<number, GrassBlock>();
  /**
   * Regénération en cours, étalée sur quelques images : jusqu'à 48 000 touffes refaites d'un coup tous les
   * 12 m figeaient l'image (≈ 55 ms). Les touffes affichées restent en place jusqu'à la fin.
   */
  private job: { focus: THREE.Vector3; blocks: Array<{ bx: number; bz: number; d: number }>; bi: number; n: number } | null = null;
  /** Matrices de la regénération en cours (gardé d'une fois à l'autre : 3 Mo). */
  private staging: Float32Array | null = null;
  /** Graine de chaque touffe (0–1), tirée de sa position monde. */
  private readonly seeds: THREE.InstancedBufferAttribute;

  constructor(q: QualitySettings, season: Season, tileAt: (x: number, z: number) => LoadedTile | undefined, heightAt: (x: number, z: number) => number, avoid: (x: number, z: number) => boolean) {
    const field = this;
    this.env = {
      tileAt,
      heightAt,
      avoid,
      get season() {
        return field.season;
      },
    };
    this.max = Math.floor(60000 * q.grassDensity);
    this.tries = grassTriesPerBlock(this.max);
    const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
    const tip = attribute<'float'>('tip');
    // Graine par touffe tirée de sa position (attribut `seed`, voir update) : les touffes sont renumérotées à
    // chaque regénération des blocs (tous les 12 m), une graine tirée de l'indice d'instance changeait la
    // teinte des touffes d'un coup.
    const h = attribute<'float'>('seed');
    // Brins couchés dans le sens du vent, avec des vagues de rafales qui parcourent la prairie.
    const wave = sin(positionLocal.x.mul(this.windDir.x).add(positionLocal.z.mul(this.windDir.y)).mul(0.35).sub(time.mul(2.2)));
    const sway = sin(time.mul(float(1.6).add(h.mul(0.8))).add(h.mul(30))).mul(0.4).add(wave.mul(0.35)).add(0.6).mul(this.wind).mul(tip).mul(0.12);
    m.positionNode = positionLocal.add(vec3(this.windDir.x.mul(sway), 0, this.windDir.y.mul(sway)));
    // une touffe sur huit plus sèche (paille), variation de teinte par touffe
    const dry = fract(h.mul(7.13).add(0.31)).greaterThan(0.875).select(float(1), float(0));
    const tipCol = mix(this.tipCol.node, vec3(0.42, 0.38, 0.22), dry.mul(0.7));
    // Style jeu vidéo : pied de la touffe à la couleur du pré, avec les mêmes taches en paliers que le sol
    // (terrain.ts, createLowPolyMaterial), pointe plus claire ; réaliste : variation douce par touffe.
    const patch = floor(mx_noise_float(positionWorld.xz.mul(0.006)).mul(0.5).add(0.5).mul(3)).div(3).mul(0.14).add(0.9);
    const shade = LOW_POLY ? patch.mul(h.mul(0.08).add(0.96)) : h.mul(0.25).add(0.82);
    m.colorNode = varying(mix(this.base.node, tipCol, tip.pow(0.8)).mul(shade)).mul(cloudShade());
    m.roughnessNode = float(0.85);
    // Brins tournés vers le ciel : moitié moins de lumière du ciel, sinon l'herbe blanchit (voile bleuté).
    m.envMapIntensity = 0.5;
    // Normale verticale des deux côtés : les brins sont éclairés comme le sol (pas de faces sombres).
    // Style jeu vidéo : facettes visibles (aplats par face) ; réaliste : normale verticale, éclairage doux.
    if (LOW_POLY) m.flatShading = true;
    else m.normalNode = transformNormalToView(vec3(0, 1, 0));
    const geo = LOW_POLY ? lowPolyClumpGeometry() : clumpGeometry();
    this.seeds = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(this.max, 1)), 1);
    this.seeds.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('seed', this.seeds);
    this.mesh = new THREE.InstancedMesh(geo, m, Math.max(this.max, 1));
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
    this.blocks.clear();
    const [b, t] = SEASON_GRASS[season];
    this.base.set(b);
    this.tipCol.set(t);
  }

  update(focus: THREE.Vector3): void {
    if (!this.max) return;
    if (!this.job && Math.hypot(focus.x - this.center.x, focus.z - this.center.z) >= 12) {
      this.center.copy(focus);
      // Les touffes sont ancrées au monde : blocs fixes de GRASS_BLOCK m, chacun avec sa graine. Une regénération
      // refait donc les mêmes touffes aux mêmes endroits (l'herbe ne bouge plus quand on avance) ; seule la
      // bordure du rayon change. Blocs triés du plus proche au plus loin : si le plafond est atteint, ce
      // sont les plus lointains qui manquent.
      for (const [key, b] of this.blocks) {
        if (Math.hypot((b.bx + 0.5) * GRASS_BLOCK - focus.x, (b.bz + 0.5) * GRASS_BLOCK - focus.z) > KEEP_RADIUS) this.blocks.delete(key);
      }
      this.job = { focus: focus.clone(), blocks: grassBlocksAround(focus.x, focus.z), bi: 0, n: 0 };
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
    let n = job.n;
    let spent = 0;
    while (job.bi < blocks.length && n < this.max && spent < budget) {
      const { bx, bz } = blocks[job.bi] as { bx: number; bz: number };
      const key = bx * BLOCK_KEY + bz;
      let block = this.blocks.get(key);
      if (block) spent += CACHED_BLOCK_COST;
      else {
        block = generateGrassBlock(bx, bz, this.tries, this.env);
        spent += this.tries;
        // Un bloc écarté faute de tuile (pas encore chargée) est refait à la prochaine regénération.
        if (block.complete) this.blocks.set(key, block);
      }
      n = appendGrassBlock(block, focus.x, focus.z, staging, n, this.max);
      job.bi++;
    }
    job.n = n;
    if (job.bi < blocks.length && n < this.max) return;
    (this.mesh.instanceMatrix.array as Float32Array).set(staging.subarray(0, n * 16));
    const seeds = this.seeds.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const v = Math.sin((staging[i * 16 + 12] as number) * 12.9898 + (staging[i * 16 + 14] as number) * 78.233) * 43758.5453;
      seeds[i] = v - Math.floor(v);
    }
    this.seeds.needsUpdate = true;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.job = null;
  }
}
