import * as THREE from 'three/webgpu';
import {
  attribute,
  positionWorld,
  cameraPosition,
  time,
  vec2,
  vec3,
  float,
  uniform,
  mix,
  smoothstep,
  mx_noise_float,
  mx_noise_vec3,
  transformNormalToView,
  reflect,
  floor,
  fract,
  hash,
  instanceIndex,
  positionLocal,
  sin,
  varying,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { QualitySettings } from '../engine/quality.ts';
import { colorUniform } from '../engine/tsl.ts';
import { rng } from '../engine/noise.ts';
import type { Season } from './environment.ts';
import type { LoadedTile } from './types.ts';
import { streamMesh, streamProfile, streamWidth, subdivideFlat } from './watergeom.ts';

/** Couleurs des roseaux par saison (tige, épi). */
const REEDS: Record<Season, [string, string]> = {
  spring: ['#5e7f34', '#8aa65a'],
  summer: ['#55752f', '#9a8a4e'],
  autumn: ['#8a7a45', '#a8784a'],
  winter: ['#8c7d5c', '#a89a78'],
};

/** Touffe de roseaux : 7 tiges effilées légèrement inclinées (≈ 14 triangles), hauteur 1. */
function reedGeometry(): THREE.BufferGeometry {
  const r = rng(91);
  const pos: number[] = [];
  const tip: number[] = [];
  for (let k = 0; k < 7; k++) {
    const a = r() * Math.PI * 2;
    const ox = Math.cos(a) * r() * 0.25;
    const oz = Math.sin(a) * r() * 0.25;
    const lean = 0.12 + r() * 0.15;
    const h = 0.7 + r() * 0.3;
    const w = 0.02 + r() * 0.015;
    const px = ox + Math.cos(a) * lean;
    const pz = oz + Math.sin(a) * lean;
    // Deux triangles croisés par tige : visibles sous tous les angles.
    pos.push(ox - w, 0, oz, ox + w, 0, oz, px, h, pz, ox, 0, oz - w, ox, 0, oz + w, px, h, pz);
    tip.push(0, 0, 1, 0, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('tip', new THREE.Float32BufferAttribute(tip, 1));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

interface TileWater {
  objects: THREE.Object3D[];
}

/** Teintes du corps de l'eau (profond, hauts-fonds) et amplitude des vaguelettes. */
interface WaterPalette {
  deep: [number, number, number];
  shallow: [number, number, number];
  ripple: number;
}

/** Étangs et rivières de la vallée : vert-brun, plus clair et plus brun sur les hauts-fonds. */
const POND: WaterPalette = { deep: [0.035, 0.07, 0.065], shallow: [0.2, 0.19, 0.12], ripple: 1 };
/** Mer : bleu-vert profond, turquoise sur les hauts-fonds, houle plus marquée. */
const SEA: WaterPalette = { deep: [0.02, 0.075, 0.11], shallow: [0.09, 0.3, 0.29], ripple: 2.2 };
/** Maille de la surface de la mer sur une tuile (m) et profondeur au-delà de laquelle elle est « profonde ». */
const SEA_CELL_M = 10;
const SEA_DEEP_M = 4;
/** Mer lointaine (au-delà des tuiles) : marge autour du monde (m), juste sous la mer des tuiles. */
const SEA_FAR_MARGIN_M = 40000;
const SEA_FAR_DROP_M = 0.15;

/**
 * Eau de la vallée (étangs, rivières, ruisseaux OSM) : plans d'eau subdivisés (profondeur par
 * sommet), rubans de rivière qui suivent la pente sans jamais remonter, matériau TSL commun —
 * reflet du ciel selon Fresnel, vaguelettes poussées par le vent et le courant, gouttes de pluie,
 * hauts-fonds et liseré d'écume sur les berges — et roseaux instanciés sur les rives.
 * Un appel de dessin pour l'eau et un pour les roseaux par tuile.
 */
export class WaterSystem {
  readonly group = new THREE.Group();
  /** Direction (x, z) vers laquelle souffle le vent et sa vitesse (m/s). */
  readonly windDir = uniform(new THREE.Vector2(0.6, 0.8));
  readonly windMs = uniform(3);
  readonly rain = uniform(0);
  /** Couleurs reflétées : zénith et horizon (suivent le ciel et la brume). */
  readonly skyColor = colorUniform('#8fb6e0');
  readonly horizonColor = colorUniform('#dfe8ef');
  /** Part du reflet simulé dans la couleur : 1 sans carte d'environnement, faible avec (le vrai reflet du ciel s'en charge). */
  readonly fakeSky = uniform(1);
  private readonly reedBase = colorUniform();
  private readonly reedTip = colorUniform();
  private readonly material: THREE.MeshStandardNodeMaterial;
  /** Monde côtier : niveau de la mer, matériau et plan de la mer lointaine. */
  private sea: { levelM: number; material: THREE.MeshStandardNodeMaterial; far: THREE.Mesh } | null = null;
  private readonly reedMaterial: THREE.MeshStandardNodeMaterial;
  private readonly reedGeo = reedGeometry();
  private readonly tiles = new Map<string, TileWater>();
  private q: QualitySettings;
  private readonly groundAt: (x: number, z: number) => number;
  private readonly avoid: (x: number, z: number) => boolean;

  constructor(q: QualitySettings, season: Season, groundAt: (x: number, z: number) => number, avoid: (x: number, z: number) => boolean) {
    this.q = q;
    this.groundAt = groundAt;
    this.avoid = avoid;
    this.group.name = 'water';
    this.material = this.createMaterial(q.waterDetail);
    this.reedMaterial = this.createReedMaterial();
    this.setSeason(season);
  }

  setSeason(season: Season): void {
    const [a, b] = REEDS[season];
    this.reedBase.set(a);
    this.reedTip.set(b);
  }

  setQuality(q: QualitySettings): void {
    this.q = q;
  }

  private createMaterial(detail: boolean, palette: WaterPalette = POND): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial();
    const depth = attribute<'float'>('wdepth');
    const flow = attribute<'vec2'>('wflow'); // vitesse du courant (m/s), nulle sur les étangs
    const p = positionWorld.xz;
    const wind = this.windDir;
    // Vaguelettes : bruit dérivé (vecteur) déplacé par le courant et dérivant sous le vent.
    const ripple = this.windMs.mul(0.035).add(0.015).min(0.22).mul(palette.ripple);
    const drift = flow.add(wind.mul(this.windMs.mul(0.05).add(0.05)));
    const p1 = p.sub(drift.mul(time)).mul(0.45);
    let pert: THREE.Node<'vec2'> = mx_noise_vec3(vec3(p1.x, p1.y, time.mul(0.25))).xz.mul(ripple);
    if (detail) {
      const p2 = p.sub(drift.mul(time.mul(1.6))).mul(1.7);
      pert = pert.add(mx_noise_vec3(vec3(p2.x, p2.y, time.mul(0.6))).xz.mul(ripple.mul(0.45)));
      // Gouttes de pluie : anneaux qui s'élargissent dans une grille de cellules de 0,5 m.
      const cellP = p.mul(2);
      const cell = floor(cellP);
      const h = hash(cell.x.add(cell.y.mul(157)));
      const local = fract(cellP).sub(0.5).sub(vec2(h.sub(0.5), fract(h.mul(13)).sub(0.5)).mul(0.5));
      const r = local.length();
      const t = fract(time.mul(1.3).add(h.mul(7)));
      const ring = smoothstep(0.06, 0.0, r.sub(t.mul(0.45)).abs()).mul(float(1).sub(t)).mul(this.rain).mul(step01(h, this.rain));
      pert = pert.add(local.normalize().mul(ring.mul(0.35)));
    }
    const nWorld = vec3(pert.x.negate(), 1, pert.y.negate()).normalize();
    m.normalNode = transformNormalToView(nWorld);
    // Reflet du ciel (Fresnel de Schlick, eau n = 1,33 → F0 ≈ 0,02).
    const view = cameraPosition.sub(positionWorld).normalize();
    const cosT = view.dot(nWorld).max(0);
    const fresnel = float(0.02).add(float(0.98).mul(float(1).sub(cosT).pow(5)));
    const refl = reflect(view.negate(), nWorld);
    const sky = mix(this.horizonColor.node, this.skyColor.node, smoothstep(0.0, 0.5, refl.y));
    // Corps de l'eau : teinte profonde, plus claire sur les hauts-fonds (palette étang ou mer).
    const deep = vec3(...palette.deep);
    const shallow = vec3(...palette.shallow);
    const body = mix(shallow, deep, smoothstep(0.05, 1.6, depth));
    // Écume et liseré clair au bord, irrégulier.
    const foamNoise = mx_noise_float(vec3(p.mul(1.3), time.mul(0.3))).mul(0.5).add(0.5);
    const foam = smoothstep(0.14, 0.0, depth.add(foamNoise.mul(0.06))).mul(0.55);
    const col = mix(mix(body, sky, fresnel.min(0.85).mul(this.fakeSky)), vec3(0.72, 0.74, 0.7), foam);
    m.colorNode = col;
    m.roughnessNode = mix(float(0.04), float(0.35), foam).add(this.rain.mul(0.08));
    m.metalnessNode = float(0);
    return m;
  }

  private createReedMaterial(): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
    const tip = attribute<'float'>('tip');
    const h = hash(instanceIndex);
    const raw = attribute<'vec3'>('position');
    const bend = this.windMs.mul(0.02).add(0.03).mul(raw.y.mul(raw.y)).mul(sin(time.mul(float(1.4).add(h.mul(0.7))).add(h.mul(30))).mul(0.4).add(0.7));
    m.positionNode = positionLocal.add(vec3(this.windDir.x.mul(bend), 0, this.windDir.y.mul(bend)));
    m.colorNode = varying(mix(this.reedBase.node, this.reedTip.node, tip.mul(h.mul(0.5).add(0.5))).mul(h.mul(0.3).add(0.75)));
    m.roughnessNode = float(0.8);
    m.normalNode = transformNormalToView(vec3(0, 1, 0));
    return m;
  }

  /**
   * Monde côtier : la mer est une surface plane au niveau `levelM`. Chaque tuile qui descend
   * sous ce niveau reçoit sa nappe maillée (profondeur par sommet : hauts-fonds, écume au rivage) ;
   * au-delà, un grand plan à peine plus bas prolonge la mer jusqu'à l'horizon.
   */
  setSea(levelM: number, bounds: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
    if (this.sea) return;
    const material = this.createMaterial(this.q.waterDetail, SEA);
    const w = bounds.maxX - bounds.minX + 2 * SEA_FAR_MARGIN_M;
    const h = bounds.maxZ - bounds.minZ + 2 * SEA_FAR_MARGIN_M;
    const g = new THREE.PlaneGeometry(w, h, 64, 64);
    g.rotateX(-Math.PI / 2);
    g.translate((bounds.minX + bounds.maxX) / 2, levelM - SEA_FAR_DROP_M, (bounds.minZ + bounds.maxZ) / 2);
    const nv = g.attributes.position!.count;
    g.setAttribute('wdepth', new THREE.BufferAttribute(new Float32Array(nv).fill(SEA_DEEP_M), 1));
    g.setAttribute('wflow', new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
    const far = new THREE.Mesh(g, material);
    far.name = 'sea_far';
    far.receiveShadow = true;
    this.group.add(far);
    this.sea = { levelM, material, far };
  }

  /** Nappe de mer d'une tuile : mailles dont un sommet au moins est sous le niveau de la mer. */
  private seaMesh(tile: LoadedTile): THREE.Mesh | null {
    const sea = this.sea;
    if (!sea) return null;
    let min = Infinity;
    for (const v of tile.heights) if (v < min) min = v;
    if (!(min < sea.levelM)) return null;
    const n = Math.round(tile.size / SEA_CELL_M);
    const step = tile.size / n;
    const N = n + 1;
    const pos = new Float32Array(N * N * 3);
    const dep = new Float32Array(N * N);
    const wet = new Uint8Array(N * N);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        const x = tile.x0 + i * step;
        const z = tile.z0 + j * step;
        const g = this.groundAt(x, z);
        pos[k * 3] = x;
        pos[k * 3 + 1] = sea.levelM;
        pos[k * 3 + 2] = z;
        dep[k] = Number.isFinite(g) ? Math.min(Math.max(sea.levelM - g, 0), SEA_DEEP_M) : SEA_DEEP_M;
        wet[k] = !Number.isFinite(g) || g < sea.levelM ? 1 : 0;
      }
    const idx: number[] = [];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = j * N + i;
        const b = a + 1;
        const c = a + N;
        const d = c + 1;
        if (wet[a]! | wet[b]! | wet[c]! | wet[d]!) idx.push(a, c, b, b, c, d);
      }
    if (!idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('wdepth', new THREE.BufferAttribute(dep, 1));
    geo.setAttribute('wflow', new THREE.BufferAttribute(new Float32Array(N * N * 2), 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, sea.material);
    mesh.receiveShadow = true;
    mesh.name = `sea_${tile.id}`;
    return mesh;
  }

  addTile(tile: LoadedTile): void {
    if (this.tiles.has(tile.id)) return;
    const parts: THREE.BufferGeometry[] = [];
    const reeds: number[] = []; // x, y, z, échelle
    const r = rng(tile.tx * 4129 + tile.tz * 7151);
    const reedStep = this.q.reedDensity > 0 ? 10 / this.q.reedDensity : Infinity;
    const addReedsAlong = (pts: number[], level: (i: number) => number, offset: number, closed: boolean) => {
      if (!Number.isFinite(reedStep)) return;
      const n = pts.length / 2;
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const ax = pts[i * 2] as number;
        const az = pts[i * 2 + 1] as number;
        const j = (i + 1) % n;
        const bx = pts[j * 2] as number;
        const bz = pts[j * 2 + 1] as number;
        const len = Math.hypot(bx - ax, bz - az);
        let acc = r() * reedStep;
        while (acc < len) {
          const t = acc / len;
          // Roselières en îlots : on saute des portions de rive (bruit par position).
          if (Math.sin(ax * 0.05 + az * 0.07 + acc * 0.13) > -0.2) {
            const side = offset * (r() < 0.5 ? -1 : 1) * (0.3 + r() * 0.9);
            const nx = -(bz - az) / len;
            const nz = (bx - ax) / len;
            const x = ax + (bx - ax) * t + nx * side;
            const z = az + (bz - az) * t + nz * side;
            const y = Math.min(this.groundAt(x, z), level(i) + 0.15);
            if (Number.isFinite(y) && !this.avoid(x, z)) reeds.push(x, y - 0.05, z, 1.2 + r() * 0.9);
          }
          acc += reedStep * (0.5 + r());
        }
      }
    };

    // Étangs, lacs, bassins : polygones triangulés puis subdivisés, profondeur par sommet.
    for (const w of tile.features.water) {
      const outer = w.rings[0];
      if (!outer || outer.length < 6) continue;
      let level = w.level ?? Infinity;
      if (!Number.isFinite(level)) for (let i = 0; i < outer.length; i += 2) level = Math.min(level, this.groundAt(outer[i] as number, outer[i + 1] as number));
      if (!Number.isFinite(level)) continue;
      const toV2 = (ring: number[]) => {
        const out: THREE.Vector2[] = [];
        for (let i = 0; i < ring.length; i += 2) out.push(new THREE.Vector2(ring[i] as number, ring[i + 1] as number));
        return out;
      };
      const contour = toV2(outer);
      const holes = w.rings.slice(1).map(toV2);
      const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
      const flat: number[] = [];
      for (const v of [...contour, ...holes.flat()]) flat.push(v.x, v.y);
      const idx: number[] = [];
      for (const t of tris) {
        const [i0, i1, i2] = [t[0] as number, t[1] as number, t[2] as number];
        // Orientation vers le haut quel que soit le sens du contour.
        const cross = ((flat[i1 * 2 + 1] as number) - (flat[i0 * 2 + 1] as number)) * ((flat[i2 * 2] as number) - (flat[i0 * 2] as number)) - ((flat[i1 * 2] as number) - (flat[i0 * 2] as number)) * ((flat[i2 * 2 + 1] as number) - (flat[i0 * 2 + 1] as number));
        if (cross > 0) idx.push(i0, i1, i2);
        else idx.push(i0, i2, i1);
      }
      const sub = subdivideFlat(flat, idx, this.q.waterMeshM, 12000);
      const nv = sub.pts.length / 2;
      const pos = new Float32Array(nv * 3);
      const dep = new Float32Array(nv);
      for (let i = 0; i < nv; i++) {
        const x = sub.pts[i * 2] as number;
        const z = sub.pts[i * 2 + 1] as number;
        pos[i * 3] = x;
        pos[i * 3 + 1] = level + 0.05;
        pos[i * 3 + 2] = z;
        const g = this.groundAt(x, z);
        dep[i] = Number.isFinite(g) ? Math.min(Math.max(level - g, 0), 4) : 1;
      }
      // Les sommets du contour sont la rive : profondeur nulle (liseré).
      for (let i = 0; i < flat.length / 2; i++) dep[i] = 0;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('wdepth', new THREE.BufferAttribute(dep, 1));
      g.setAttribute('wflow', new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
      g.setIndex(sub.tris);
      g.computeVertexNormals();
      parts.push(g);
      addReedsAlong(outer, () => level, 1.5, true);
    }

    // Rivières et ruisseaux : rubans au fil de l'eau, courant le long du tracé.
    for (const w of tile.features.waterways) {
      if (w.tunnel || w.pts.length < 4) continue;
      const width = streamWidth(w.kind, w.width);
      if (!width) continue;
      const ys = streamProfile(w.pts, width + 1, this.groundAt);
      const dmax = Math.min(0.25 + width * 0.12, 2.5);
      const mesh = streamMesh(w.pts, ys, width, dmax, w.kind === 'river' ? 0.5 : 0.8);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(mesh.pos, 3));
      g.setAttribute('wdepth', new THREE.Float32BufferAttribute(mesh.depth, 1));
      g.setAttribute('wflow', new THREE.Float32BufferAttribute(mesh.flow, 2));
      g.setIndex(mesh.index);
      g.computeVertexNormals();
      parts.push(g);
      if (width >= 1.2) addReedsAlong(w.pts, (i) => ys[i] as number, width / 2 + 0.6, false);
    }

    const objects: THREE.Object3D[] = [];
    const seaMesh = this.seaMesh(tile);
    if (seaMesh) objects.push(seaMesh);
    if (parts.length) {
      const merged = mergeGeometries(parts, false);
      if (merged) {
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, this.material);
        mesh.receiveShadow = true;
        mesh.name = `water_${tile.id}`;
        objects.push(mesh);
      }
    }
    const count = Math.min(reeds.length / 4, 4000);
    if (count) {
      const im = new THREE.InstancedMesh(this.reedGeo, this.reedMaterial, count);
      const mat = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < count; i++) {
        const s = reeds[i * 4 + 3] as number;
        q.setFromAxisAngle(up, r() * Math.PI * 2);
        mat.compose(new THREE.Vector3(reeds[i * 4] as number, reeds[i * 4 + 1] as number, reeds[i * 4 + 2] as number), q, new THREE.Vector3(s * 0.9, s, s * 0.9));
        im.setMatrixAt(i, mat);
      }
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.receiveShadow = true;
      im.name = `reeds_${tile.id}`;
      objects.push(im);
    }
    for (const o of objects) this.group.add(o);
    this.tiles.set(tile.id, { objects });
  }

  removeTile(tile: LoadedTile): void {
    const t = this.tiles.get(tile.id);
    if (!t) return;
    for (const o of t.objects) {
      this.group.remove(o);
      if (o instanceof THREE.InstancedMesh) o.dispose();
      else (o as THREE.Mesh).geometry.dispose();
    }
    this.tiles.delete(tile.id);
  }

  /** Nombre d'objets dessinés (statistiques de coût). */
  stats(): { meshes: number; reeds: number } {
    let meshes = 0;
    let reeds = 0;
    for (const t of this.tiles.values())
      for (const o of t.objects) {
        if (o instanceof THREE.InstancedMesh) reeds += o.count;
        else meshes++;
      }
    return { meshes, reeds };
  }
}

/** 1 si h < seuil (gouttes actives proportionnelles à l'intensité de pluie), sinon 0. */
function step01(h: THREE.Node<'float'>, threshold: THREE.Node<'float'>): THREE.Node<'float'> {
  return smoothstep(threshold.add(0.001), threshold, h);
}
