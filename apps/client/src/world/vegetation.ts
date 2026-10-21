import * as THREE from 'three/webgpu';
import { attribute, positionLocal, time, sin, vec3, float, uniform, mix, instanceIndex, hash, color, smoothstep, varying } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { QualitySettings } from '../engine/quality.ts';
import { colorUniform } from '../engine/tsl.ts';
import { fbm, rng } from '../engine/noise.ts';
import type { LoadedTile } from './types.ts';
import { splatAt } from './splat.ts';
import type { Season } from './environment.ts';

/** Couleurs de feuillage par saison (feuillus) — palettes de ART_DIRECTION.md. */
const LEAVES: Record<Season, [string, string, string]> = {
  spring: ['#7fb24a', '#a9cf6a', '#6e9e3f'],
  summer: ['#4f7a32', '#6b8e3a', '#3f6a2b'],
  autumn: ['#c8762c', '#e0a33a', '#9b3d1f'],
  winter: ['#6e5d4f', '#6e5d4f', '#6e5d4f'],
};

/** Taille des blocs d'instanciation (m) : compromis entre appels de dessin et élimination hors champ. */
const CHUNK = 250;
/** Distances de bascule des niveaux de détail (m). */
const LOD_NEAR = 280;
const LOD_MID = 1100;

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
  meshes: Array<{ kind: 'decid' | 'conif'; mesh: THREE.InstancedMesh }>;
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
  private readonly geos: Record<'decid' | 'conif', THREE.BufferGeometry[]>;
  private readonly mats: Record<'decid' | 'conif', THREE.MeshStandardNodeMaterial>;
  private readonly chunks = new Map<string, Chunk>();
  private q: QualitySettings;
  private readonly heightAt: (x: number, z: number) => number;
  /** Zones interdites (route principale). */
  private readonly avoid: (x: number, z: number) => boolean;
  private readonly focus = new THREE.Vector3(1e9, 0, 1e9);

  constructor(q: QualitySettings, season: Season, heightAt: (x: number, z: number) => number, avoid: (x: number, z: number) => boolean) {
    this.q = q;
    this.heightAt = heightAt;
    this.avoid = avoid;
    this.group.name = 'vegetation';
    this.geos = { decid: [0, 1, 2].map(deciduousGeometry), conif: [0, 1, 2].map(coniferGeometry) };
    this.mats = { decid: this.material(false), conif: this.material(true) };
    this.setSeason(season);
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
    // Balancement : proportionnel au carré de la hauteur, phase aléatoire par arbre, rafales lentes.
    const y = positionLocal.y;
    const gust = sin(time.mul(0.35).add(h.mul(6.28))).mul(0.5).add(0.5);
    const sway = sin(time.mul(float(1.3).add(h2.mul(0.6))).add(h.mul(40))).mul(this.windStrength).mul(y.mul(y).mul(0.0035)).mul(gust.mul(0.6).add(0.4));
    const flutter = sin(time.mul(7).add(positionLocal.x.mul(3)).add(positionLocal.z.mul(2))).mul(0.05).mul(leaf).mul(this.windStrength);
    let pos = positionLocal.add(vec3(sway.add(flutter), 0, sway.mul(0.6)));
    if (!conifer) {
      // Hiver : le houppier se rétracte vers le tronc et laisse les branches nues.
      const crownCenter = vec3(0, 7.5, 0);
      const k = mix(float(1), this.leafAmount, leaf);
      pos = mix(crownCenter.mul(leaf), pos, k.max(0.001));
    }
    m.positionNode = pos;
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

  private lodFor(cx: number, cz: number): number {
    const x = (cx + 0.5) * CHUNK;
    const z = (cz + 0.5) * CHUNK;
    const d = Math.hypot(x - this.focus.x, z - this.focus.z) - CHUNK * 0.7;
    return d < LOD_NEAR ? 0 : d < LOD_MID ? 1 : 2;
  }

  /** Place les arbres d'une tuile (déterministe) et crée ses blocs instanciés. */
  addTile(tile: LoadedTile): void {
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
      const lod = this.lodFor(cx, cz);
      const chunk: Chunk = { key: `${tile.id}:${key}`, tileId: tile.id, cx, cz, meshes: [], lod };
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
      const lod = this.lodFor(c.cx, c.cz);
      if (lod === c.lod) continue;
      c.lod = lod;
      for (const { kind, mesh } of c.meshes) {
        mesh.geometry = this.geos[kind][lod] as THREE.BufferGeometry;
        mesh.castShadow = lod === 0;
        mesh.receiveShadow = lod === 0;
        mesh.computeBoundingSphere();
      }
    }
  }
}
