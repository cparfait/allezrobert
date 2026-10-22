import * as THREE from 'three/webgpu';
import { attribute, positionLocal, time, sin, vec3, float, uniform, mix, instanceIndex, hash, color, smoothstep, varying } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { QualitySettings } from '../engine/quality.ts';
import { colorUniform } from '../engine/tsl.ts';
import { fbm, rng } from '../engine/noise.ts';
import type { LoadedTile } from './types.ts';
import { splatAt } from './splat.ts';
import type { Season } from './environment.ts';
import { broadleafVariants, realTreeMaterial, shrubGeometry, TREE_H, TREE_R } from './trees.ts';

/** Couleurs de feuillage par saison (feuillus) — palettes de ART_DIRECTION.md. */
const LEAVES: Record<Season, [string, string, string]> = {
  spring: ['#7fb24a', '#a9cf6a', '#6e9e3f'],
  summer: ['#4f7a32', '#6b8e3a', '#3f6a2b'],
  autumn: ['#c8762c', '#e0a33a', '#9b3d1f'],
  winter: ['#6e5d4f', '#6e5d4f', '#6e5d4f'],
};

/** Taille des blocs d'instanciation (m) : compromis entre appels de dessin et élimination hors champ. */
const CHUNK = 500;
/** Distances de bascule des niveaux de détail (m). */
const LOD_NEAR = 300;
const LOD_MID = 1100;
/** Blocs plus petits pour la végétation réelle (LiDAR) : beaucoup plus dense, détail proche. */
const REAL_CHUNK = 125;
/** Végétation réelle : cartes de feuillage jusqu'à REAL_NEAR, silhouettes au-delà, buissons masqués après REAL_MID. */
const REAL_NEAR = 160;
const REAL_MID = 700;
/** Rapport hauteur / rayon de houppier au-delà duquel un arbre réel est élancé (peuplier, jeune arbre). */
const SLENDER = 4.2;

type Kind = 'decid' | 'conif' | 'real0' | 'real1' | 'real2' | 'shrub';

/** Marque chaque sommet : 0 = bois, 1 = feuillage (pour l'animation et la saison). */
function tag(geo: THREE.BufferGeometry, leaf: number, shade: number, center?: THREE.Vector3): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position');
  const n = pos.count;
  g.setAttribute('leaf', new THREE.BufferAttribute(new Float32Array(n).fill(leaf), 1));
  // Ombrage interne : le bas du houppier est plus sombre.
  const sh = new Float32Array(n);
  for (let i = 0; i < n; i++) sh[i] = shade * (0.72 + 0.28 * Math.min(1, pos.getY(i) / 10));
  g.setAttribute('shade', new THREE.BufferAttribute(sh, 1));
  if (center) {
    // Normales sphériques : feuillage doux, sans facettes, malgré très peu de triangles.
    const nrm = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(pos.getX(i) - center.x, (pos.getY(i) - center.y) * 0.8, pos.getZ(i) - center.z).normalize();
      nrm[i * 3] = v.x;
      nrm[i * 3 + 1] = v.y;
      nrm[i * 3 + 2] = v.z;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  } else if (!g.getAttribute('normal')) g.computeVertexNormals();
  g.deleteAttribute('uv');
  return g;
}

/** Feuillu : tronc et houppier en sphères déformées. lod 0 ≈ 190 tri, 1 ≈ 50 tri, 2 ≈ 28 tri. */
function deciduousGeometry(lod: number): THREE.BufferGeometry {
  const r = rng(7);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(tag(new THREE.CylinderGeometry(0.18, 0.32, 5.5, lod === 0 ? 7 : 4, 1, true).translate(0, 2.75, 0), 0, 1));
  if (lod === 0) {
    for (let b = 0; b < 3; b++) {
      const br = new THREE.CylinderGeometry(0.05, 0.11, 3, 4, 1, true).translate(0, 1.5, 0);
      br.rotateZ(0.7 + r() * 0.3).rotateY((b / 3) * Math.PI * 2 + r()).translate(0, 4 + b * 0.6, 0);
      parts.push(tag(br, 0, 1));
    }
  }
  const blobs = lod === 0 ? 7 : lod === 1 ? 2 : 1;
  const crown = new THREE.Vector3(0, 7.6, 0);
  for (let i = 0; i < blobs; i++) {
    const s = lod === 0 ? 2.3 + r() * 1.3 : lod === 1 ? 3.4 : 4.2;
    const blob = new THREE.IcosahedronGeometry(s, lod === 0 ? 1 : 0);
    const p = blob.getAttribute('position');
    // Déformation fonction de la direction du sommet (et non aléatoire par sommet) : les faces
    // restent jointives, le houppier est bosselé sans se déchirer.
    const seed = r() * 10;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      const y = p.getY(k);
      const z = p.getZ(k);
      const f = 0.86 + 0.14 * Math.sin((x * 3.1 + seed) / s) * Math.cos((z * 2.7 - y * 1.3 + seed) / s) + 0.08 * Math.sin((y * 4.2 + seed) / s);
      p.setXYZ(k, x * f, y * f * 0.82, z * f);
    }
    const a = (i / blobs) * Math.PI * 2;
    const rad = lod === 0 ? 1.7 + r() * 0.7 : lod === 1 ? 1.1 : 0;
    const y = lod === 0 ? (i === blobs - 1 ? 9.2 : 6.6 + r() * 2) : lod === 1 ? 7 + i * 1.2 : 7.6;
    blob.translate(i === blobs - 1 && lod === 0 ? 0 : Math.cos(a) * rad, y, i === blobs - 1 && lod === 0 ? 0 : Math.sin(a) * rad);
    parts.push(tag(blob, 1, 0.82 + r() * 0.3, crown));
  }
  return mergeGeometries(parts, false) as THREE.BufferGeometry;
}

/** Conifère (pin sylvestre / épicéa) : étages de cônes. */
function coniferGeometry(lod: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(tag(new THREE.CylinderGeometry(0.15, 0.28, 7, lod === 0 ? 6 : 4, 1, true).translate(0, 3.5, 0), 0, 1));
  const tiers = lod === 0 ? 4 : lod === 1 ? 2 : 1;
  for (let i = 0; i < tiers; i++) {
    const rad = 2.8 - i * (2.0 / tiers);
    const h = tiers === 1 ? 9 : 4 - i * 0.4;
    const cone = new THREE.ConeGeometry(rad, h, lod === 0 ? 8 : 5, 1, true).translate(0, 5 + i * (6 / tiers) + h / 2, 0);
    parts.push(tag(cone, 1, 0.75 + i * 0.12, new THREE.Vector3(0, 5 + i * (6 / tiers), 0)));
  }
  return mergeGeometries(parts, false) as THREE.BufferGeometry;
}

interface Chunk {
  key: string;
  tileId: string;
  cx: number;
  cz: number;
  /** Côté du bloc (m). */
  size: number;
  real: boolean;
  meshes: Array<{ kind: Kind; mesh: THREE.InstancedMesh }>;
  lod: number;
}

/**
 * Végétation instanciée par blocs de 250 m : feuillus et conifères placés selon le raster
 * de forêt, haies et arbres isolés dans les prés, animés par le vent (TSL).
 * Trois niveaux de détail selon la distance ; seuls les arbres proches projettent une ombre.
 */
export class Vegetation {
  readonly group = new THREE.Group();
  readonly windStrength = uniform(0.3);
  private readonly leafA = colorUniform();
  private readonly leafB = colorUniform();
  private readonly leafC = colorUniform();
  /** 1 = feuillage complet, 0 = arbres nus (hiver). */
  private readonly leafAmount = uniform(1);
  private readonly geos: Record<Kind, Array<THREE.BufferGeometry | null>>;
  private readonly mats: Record<'decid' | 'conif', THREE.MeshStandardNodeMaterial>;
  /** Arbres réels proches (cartes de feuillage) et haies / buissons. */
  private readonly realMat: THREE.MeshStandardNodeMaterial;
  private readonly shrubMat: THREE.MeshStandardNodeMaterial;
  private readonly chunks = new Map<string, Chunk>();
  /**
   * Végétation réelle lointaine : au-delà de REAL_MID, une tuile dessine tous ses arbres en un seul
   * appel (silhouettes) au lieu d'une soixantaine de blocs de 125 m ; ses blocs sont alors masqués.
   */
  private readonly realFar = new Map<string, { mesh: THREE.InstancedMesh; x0: number; z0: number; size: number; far: boolean }>();
  private q: QualitySettings;
  private readonly heightAt: (x: number, z: number) => number;
  /** Zones interdites (route principale). */
  private readonly avoid: (x: number, z: number) => boolean;
  /** Arbres réels : seulement la chaussée et son bord immédiat (les haies de bord de route restent). */
  private readonly avoidReal: (x: number, z: number) => boolean;
  private readonly focus = new THREE.Vector3(1e9, 0, 1e9);

  constructor(q: QualitySettings, season: Season, heightAt: (x: number, z: number) => number, avoid: (x: number, z: number) => boolean, avoidReal: (x: number, z: number) => boolean = avoid) {
    this.q = q;
    this.heightAt = heightAt;
    this.avoid = avoid;
    this.avoidReal = avoidReal;
    this.group.name = 'vegetation';
    const decid = [0, 1, 2].map(deciduousGeometry);
    const conif = [0, 1, 2].map(coniferGeometry);
    const real = broadleafVariants();
    const shrub = shrubGeometry();
    this.geos = {
      decid,
      conif,
      // trois feuillus détaillés ; au-delà de REAL_NEAR, la silhouette des feuillus semés
      real0: [real[0]!, decid[1]!, decid[2]!],
      real1: [real[1]!, decid[1]!, decid[2]!],
      real2: [real[2]!, decid[1]!, decid[2]!],
      shrub: [shrub, shrub, null],
    };
    this.mats = { decid: this.material(false), conif: this.material(true) };
    const colours = { a: this.leafA.node, b: this.leafB.node, c: this.leafC.node, amount: this.leafAmount, wind: this.windStrength };
    this.realMat = realTreeMaterial(colours, true);
    this.shrubMat = realTreeMaterial(colours, false);
    this.setSeason(season);
  }

  private materialFor(kind: Kind, lod: number): THREE.MeshStandardNodeMaterial {
    if (kind === 'shrub') return this.shrubMat;
    if (kind === 'conif') return this.mats.conif;
    if (kind === 'decid') return this.mats.decid;
    return lod === 0 ? this.realMat : this.mats.decid;
  }

  /** Géométrie et matériau d'un bloc selon le niveau de détail (null = masqué). */
  private applyLod(kind: Kind, mesh: THREE.InstancedMesh, lod: number): void {
    const geo = this.geos[kind][lod] ?? null;
    mesh.visible = geo !== null;
    if (geo) mesh.geometry = geo;
    mesh.material = this.materialFor(kind, lod);
    mesh.castShadow = lod === 0;
    mesh.receiveShadow = lod === 0;
    mesh.computeBoundingSphere();
  }

  setSeason(season: Season): void {
    const [a, b, c] = LEAVES[season];
    this.leafA.set(a);
    this.leafB.set(b);
    this.leafC.set(c);
    this.leafAmount.value = season === 'winter' ? 0 : 1;
  }

  setQuality(q: QualitySettings): void {
    this.q = q;
  }

  private material(conifer: boolean): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial();
    const leaf = attribute<'float'>('leaf');
    const shade = attribute<'float'>('shade');
    const h = hash(instanceIndex);
    const h2 = hash(instanceIndex.add(7));
    // Attention : dans un InstancedMesh, positionLocal contient déjà la transformation d'instance
    // (position monde de l'arbre). Les calculs « locaux » partent donc de l'attribut brut.
    const raw = attribute<'vec3'>('position');
    // Balancement : proportionnel au carré de la hauteur propre de l'arbre (0 au pied), phase
    // aléatoire par arbre, rafales lentes ; quelques centimètres en tête d'arbre.
    const y = raw.y.max(0);
    const gust = sin(time.mul(0.35).add(h.mul(6.28))).mul(0.5).add(0.5);
    const sway = sin(time.mul(float(1.3).add(h2.mul(0.6))).add(h.mul(40))).mul(this.windStrength).mul(y.mul(y).mul(0.0012)).mul(gust.mul(0.6).add(0.4));
    const flutter = sin(time.mul(7).add(raw.x.mul(3)).add(raw.z.mul(2))).mul(0.03).mul(leaf).mul(this.windStrength);
    let offset: THREE.Node<'vec3'> = vec3(sway.add(flutter), 0, sway.mul(0.6));
    if (!conifer) {
      // Hiver : le houppier se rétracte vers le tronc (vers le centre du houppier) et laisse les branches nues.
      const crownCenter = vec3(0, 7.5, 0);
      const k = mix(float(1), this.leafAmount, leaf);
      offset = offset.add(crownCenter.sub(raw).mul(leaf).mul(float(1).sub(k)));
    }
    m.positionNode = positionLocal.add(offset);
    const wood = color('#4a3a2c');
    const leafCol = conifer
      ? mix(color('#2f4a2c'), color('#3d5a33'), h)
      : mix(mix(this.leafA.node, this.leafB.node, smoothstep(0.2, 0.8, h)), this.leafC.node, smoothstep(0.65, 0.95, h2));
    const col = mix(wood, leafCol, leaf).mul(shade).mul(h2.mul(0.25).add(0.85));
    m.colorNode = varying(col);
    m.roughnessNode = float(0.9);
    m.metalnessNode = float(0);
    return m;
  }

  private lodFor(c: Pick<Chunk, 'cx' | 'cz' | 'size' | 'real'>): number {
    const x = (c.cx + 0.5) * c.size;
    const z = (c.cz + 0.5) * c.size;
    const d = Math.hypot(x - this.focus.x, z - this.focus.z) - c.size * 0.7;
    if (c.real) return d < REAL_NEAR ? 0 : d < REAL_MID ? 1 : 2;
    return d < LOD_NEAR ? 0 : d < LOD_MID ? 1 : 2;
  }

  /**
   * Végétation réelle (tuile enrichie au LiDAR HD) : un arbre par sommet mesuré, à sa hauteur et
   * à la largeur de son houppier, haies et buissons ; aucun semis aléatoire.
   */
  private addRealTile(tile: LoadedTile): void {
    const f = tile.features;
    const per = new Map<string, Map<Kind, THREE.Matrix4[]>>();
    const m = new THREE.Matrix4();
    const qn = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    const push = (kind: Kind, x: number, z: number) => {
      const key = `${Math.floor(x / REAL_CHUNK)}_${Math.floor(z / REAL_CHUNK)}`;
      let b = per.get(key);
      if (!b) per.set(key, (b = new Map()));
      let list = b.get(kind);
      if (!list) b.set(kind, (list = []));
      list.push(m.clone());
    };
    const farTrees: THREE.Matrix4[] = [];
    // pseudo-aléa stable par position (même arbre à chaque chargement)
    const seedAt = (x: number, z: number) => Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    const trees = f.trees ?? [];
    for (let i = 0; i + 3 < trees.length; i += 4) {
      const x = trees[i] as number;
      const z = trees[i + 1] as number;
      const h = trees[i + 2] as number;
      const cr = trees[i + 3] as number;
      if (this.avoidReal(x, z)) continue;
      const y = this.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      const seed = seedAt(x, z);
      // houppier mesuré ; un arbre élancé (peuplier, jeune arbre) reste un feuillus étroit, borné
      // pour ne pas devenir une aiguille
      const sxz = Math.max(cr, 0.8, h / SLENDER / 1.6) / TREE_R;
      p.set(x, y - 0.15, z);
      qn.setFromAxisAngle(up, seed * Math.PI * 2);
      sc.set(sxz, h / TREE_H, sxz);
      m.compose(p, qn, sc);
      push(seed < 0.34 ? 'real0' : seed < 0.67 ? 'real1' : 'real2', x, z);
      farTrees.push(m.clone());
    }
    const shrubs = f.shrubs ?? [];
    for (let i = 0; i + 2 < shrubs.length; i += 3) {
      const x = shrubs[i] as number;
      const z = shrubs[i + 1] as number;
      const h = shrubs[i + 2] as number;
      if (this.avoidReal(x, z)) continue;
      const y = this.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      const seed = seedAt(x + 0.37, z);
      p.set(x + (seed - 0.5) * 0.6, y - 0.05, z + (seed - 0.5) * 0.6);
      qn.setFromAxisAngle(up, seed * Math.PI * 2);
      const w = 0.95 + seed * 0.35;
      sc.set(w, h, w);
      m.compose(p, qn, sc);
      push('shrub', x, z);
    }
    for (const [key, bucket] of per) {
      const [cx, cz] = key.split('_').map(Number) as [number, number];
      const chunk: Chunk = { key: `${tile.id}:r${key}`, tileId: tile.id, cx, cz, size: REAL_CHUNK, real: true, meshes: [], lod: 0 };
      chunk.lod = this.lodFor(chunk);
      for (const [kind, list] of bucket) {
        const im = new THREE.InstancedMesh(this.geos[kind][0] as THREE.BufferGeometry, this.materialFor(kind, 0), list.length);
        list.forEach((mat, k) => im.setMatrixAt(k, mat));
        im.instanceMatrix.needsUpdate = true;
        this.applyLod(kind, im, chunk.lod);
        this.group.add(im);
        chunk.meshes.push({ kind, mesh: im });
      }
      this.chunks.set(chunk.key, chunk);
    }
    // silhouettes de toute la tuile, pour le lointain (un seul appel de dessin)
    if (farTrees.length) {
      const im = new THREE.InstancedMesh(this.geos.decid[2] as THREE.BufferGeometry, this.mats.decid, farTrees.length);
      farTrees.forEach((mat, k) => im.setMatrixAt(k, mat));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      this.group.add(im);
      this.realFar.set(tile.id, { mesh: im, x0: tile.x0, z0: tile.z0, size: tile.size, far: false });
      this.setTileFar(tile.id, this.isFar(tile.x0, tile.z0, tile.size));
    }
  }

  /** Tuile entièrement à plus de REAL_MID du coureur. */
  private isFar(x0: number, z0: number, size: number): boolean {
    const dx = Math.max(x0 - this.focus.x, 0, this.focus.x - (x0 + size));
    const dz = Math.max(z0 - this.focus.z, 0, this.focus.z - (z0 + size));
    return Math.hypot(dx, dz) > REAL_MID;
  }

  /** Bascule une tuile réelle entre silhouettes d'ensemble (loin) et blocs détaillés (près). */
  private setTileFar(tileId: string, far: boolean): void {
    const t = this.realFar.get(tileId);
    if (!t) return;
    t.far = far;
    t.mesh.visible = far;
    for (const c of this.chunks.values()) {
      if (c.tileId !== tileId) continue;
      for (const { kind, mesh } of c.meshes) {
        if (far) mesh.visible = false;
        else this.applyLod(kind, mesh, c.lod);
      }
    }
  }

  /** Place les arbres d'une tuile (déterministe) et crée ses blocs instanciés. */
  addTile(tile: LoadedTile): void {
    if (tile.features.realVegetation) {
      this.addRealTile(tile);
      return;
    }
    const r = rng(tile.tx * 73856093 + tile.tz * 19349663);
    const tries = Math.floor(((tile.size * tile.size) / 100) * this.q.treeDensity * 0.45);
    const per = new Map<string, { decid: THREE.Matrix4[]; conif: THREE.Matrix4[] }>();
    const m = new THREE.Matrix4();
    const qn = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < tries; i++) {
      const x = tile.x0 + r() * tile.size;
      const z = tile.z0 + r() * tile.size;
      const rr = r();
      const forest = splatAt(tile, 0, x, z);
      const field = splatAt(tile, 1, x, z);
      const meadow = splatAt(tile, 2, x, z);
      const water = splatAt(tile, 3, x, z);
      const urban = splatAt(tile, 4, x, z);
      const road = splatAt(tile, 5, x, z);
      if (water > 0.2 || road > 0.05) continue;
      // Forêt dense ; arbres isolés et haies (bruit filaire) dans les prés ; jardins en zone bâtie.
      const hedge = Math.abs(fbm(x / 90, z / 90, 3)) < 0.03 ? 0.5 : 0;
      const prob = forest + meadow * (0.012 + hedge) + field * hedge * 0.6 + urban * 0.05;
      if (rr > prob) continue;
      if (this.avoid(x, z)) continue;
      const y = this.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      const coniferBias = fbm(x / 1500 + 40, z / 1500, 3) + (x < -6000 ? 0.4 : 0);
      const isConifer = forest > 0.5 && r() < 0.15 + Math.max(0, coniferBias) * 0.8;
      const s = 0.85 + r() * 0.65;
      p.set(x, y - 0.2, z);
      qn.setFromAxisAngle(up, r() * Math.PI * 2);
      sc.set(s, s * (0.85 + r() * 0.35), s);
      m.compose(p, qn, sc);
      const key = `${Math.floor(x / CHUNK)}_${Math.floor(z / CHUNK)}`;
      let bucket = per.get(key);
      if (!bucket) per.set(key, (bucket = { decid: [], conif: [] }));
      (isConifer ? bucket.conif : bucket.decid).push(m.clone());
    }
    for (const [key, bucket] of per) {
      const [cx, cz] = key.split('_').map(Number) as [number, number];
      const lod = this.lodFor({ cx, cz, size: CHUNK, real: false });
      const chunk: Chunk = { key: `${tile.id}:${key}`, tileId: tile.id, cx, cz, size: CHUNK, real: false, meshes: [], lod };
      for (const kind of ['decid', 'conif'] as const) {
        const list = bucket[kind];
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(this.geos[kind][lod] as THREE.BufferGeometry, this.mats[kind], list.length);
        list.forEach((mat, k) => im.setMatrixAt(k, mat));
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = lod === 0;
        im.receiveShadow = lod === 0;
        im.computeBoundingSphere();
        this.group.add(im);
        chunk.meshes.push({ kind, mesh: im });
      }
      this.chunks.set(chunk.key, chunk);
    }
  }

  removeTile(tile: LoadedTile): void {
    const far = this.realFar.get(tile.id);
    if (far) {
      this.group.remove(far.mesh);
      far.mesh.dispose();
      this.realFar.delete(tile.id);
    }
    for (const [key, c] of this.chunks) {
      if (c.tileId !== tile.id) continue;
      c.meshes.forEach(({ mesh }) => {
        this.group.remove(mesh);
        mesh.dispose();
      });
      this.chunks.delete(key);
    }
  }

  /** Met à jour les niveaux de détail quand le coureur s'est déplacé de plus de 40 m. */
  update(focus: THREE.Vector3): void {
    if (Math.hypot(focus.x - this.focus.x, focus.z - this.focus.z) < 40) return;
    this.focus.copy(focus);
    for (const c of this.chunks.values()) {
      const lod = this.lodFor(c);
      if (lod === c.lod) continue;
      c.lod = lod;
      if (c.real && this.realFar.get(c.tileId)?.far) continue;
      for (const { kind, mesh } of c.meshes) this.applyLod(kind, mesh, lod);
    }
    for (const [id, t] of this.realFar) {
      const far = this.isFar(t.x0, t.z0, t.size);
      if (far !== t.far) this.setTileFar(id, far);
    }
  }
}
