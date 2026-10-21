import * as THREE from 'three/webgpu';
import { uv, attribute, mix, smoothstep, step, fract, vec3, float, uniform, mx_noise_float, positionWorld, clamp, abs, max, time, sin, normalWorld, cameraPosition } from 'three/tsl';
import type { LoadedTile, TileRoad } from './types.ts';

/** Routes revêtues avec marquage axial (départementales et plus). */
const MARKED = new Set(['primary', 'secondary', 'tertiary', 'trunk', 'primary_link', 'secondary_link']);
const UNPAVED = new Set(['unpaved', 'gravel', 'dirt', 'ground', 'compacted', 'fine_gravel', 'grass', 'sand']);
const SKIP = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'pedestrian', 'corridor', 'platform']);

/**
 * Réseau routier OSM (hors itinéraire actif, déjà dessiné par RoadMesh) en rubans 3D posés
 * sur le profil lissé fourni par le pipeline, et plans d'eau (étangs, rivières).
 */
export class RoadNetwork {
  readonly group = new THREE.Group();
  readonly wetness = uniform(0);
  private readonly roadMat: THREE.MeshStandardNodeMaterial;
  private readonly waterMat: THREE.MeshStandardNodeMaterial;
  private readonly tiles = new Map<string, THREE.Object3D[]>();
  private readonly activeRoute: string;
  private readonly groundAt: (x: number, z: number) => number;

  constructor(activeRoute: string, groundAt: (x: number, z: number) => number) {
    this.activeRoute = activeRoute;
    this.groundAt = groundAt;
    this.group.name = 'network';
    this.roadMat = this.createRoadMaterial();
    this.waterMat = this.createWaterMaterial();
  }

  private createRoadMaterial(): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial();
    const info = attribute<'vec3'>('roadInfo'); // demi-largeur, marquage axial, non revêtu
    const across = uv().x; // mètres depuis l'axe (signé)
    const along = uv().y;
    const half = info.x;
    const ax = abs(across);
    const n = mx_noise_float(positionWorld.xz.mul(1.7)).mul(0.5).add(0.5);
    const n2 = mx_noise_float(positionWorld.xz.mul(0.08)).mul(0.5).add(0.5);
    const asphalt = vec3(0.24, 0.245, 0.26).mul(n.mul(0.18).add(0.86)).mul(n2.mul(0.2).add(0.9));
    const gravel = vec3(0.5, 0.46, 0.38).mul(n.mul(0.35).add(0.7));
    const edge = smoothstep(half.sub(0.35), half.sub(0.3), ax).mul(smoothstep(half.sub(0.1), half.sub(0.15), ax)).mul(info.y);
    const dash = step(fract(along.div(13)), float(3 / 13));
    const center = smoothstep(0.08, 0.06, ax).mul(dash).mul(info.y);
    const paint = max(edge, center).mul(n2.mul(0.25).add(0.75));
    let col = mix(asphalt, gravel, info.z);
    col = mix(col, vec3(0.9, 0.9, 0.86), paint);
    // Bords fondus dans le bas-côté (pas d'arête nette sur l'herbe).
    col = col.mul(float(1).sub(this.wetness.mul(0.4).mul(float(1).sub(info.z))));
    m.colorNode = col;
    m.roughnessNode = clamp(mix(float(0.8), float(0.97), info.z).sub(this.wetness.mul(0.55).mul(float(1).sub(info.z))), 0.06, 1);
    m.metalnessNode = float(0);
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    return m;
  }

  private createWaterMaterial(): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial();
    // Eau calme d'étang : ondulations légères (normales perturbées), reflets du ciel par l'environnement.
    const p = positionWorld.xz;
    const w1 = sin(p.x.mul(0.8).add(time.mul(0.9))).mul(sin(p.y.mul(0.6).sub(time.mul(0.7))));
    const w2 = mx_noise_float(vec3(p.mul(0.35), time.mul(0.15)));
    m.normalNode = normalWorld.add(vec3(w1.mul(0.03), 0, w2.mul(0.05))).normalize();
    const view = cameraPosition.sub(positionWorld).normalize();
    const fresnel = float(1).sub(view.y.abs()).pow(3);
    m.colorNode = mix(vec3(0.06, 0.1, 0.1), vec3(0.32, 0.42, 0.48), fresnel);
    m.roughnessNode = float(0.06);
    m.metalnessNode = float(0.15);
    return m;
  }

  addTile(tile: LoadedTile): void {
    if (this.tiles.has(tile.id)) return;
    const objs: THREE.Object3D[] = [];
    const roads = tile.features.roads.filter((r) => r.pts3 && !r.tunnel && !SKIP.has(r.kind) && r.route !== this.activeRoute);
    if (roads.length) {
      const geo = buildRoads(roads);
      if (geo) {
        const mesh = new THREE.Mesh(geo, this.roadMat);
        mesh.receiveShadow = true;
        mesh.name = `roads_${tile.id}`;
        objs.push(mesh);
      }
    }
    // Plans d'eau de la tuile fusionnés en un seul maillage (un appel de dessin).
    const waterPos: number[] = [];
    const waterIdx: number[] = [];
    for (const w of tile.features.water) {
      const outer = w.rings[0];
      if (!outer || outer.length < 6) continue;
      const level = w.level ?? lowestGround(outer, this.groundAt);
      if (!Number.isFinite(level)) continue;
      const toV2 = (r: number[]) => {
        const out: THREE.Vector2[] = [];
        for (let i = 0; i < r.length; i += 2) out.push(new THREE.Vector2(r[i] as number, r[i + 1] as number));
        return out;
      };
      const contour = toV2(outer);
      const holes = w.rings.slice(1).map(toV2);
      const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
      const all = [...contour, ...holes.flat()];
      const base = waterPos.length / 3;
      for (const v of all) waterPos.push(v.x, level + 0.05, v.y);
      for (const t of tris) {
        const [i0, i1, i2] = [t[0] as number, t[1] as number, t[2] as number];
        const p0 = all[i0] as THREE.Vector2;
        const p1 = all[i1] as THREE.Vector2;
        const p2 = all[i2] as THREE.Vector2;
        // Orientation vers le haut quel que soit le sens du contour : composante y de (u × v) > 0.
        const up = (p1.y - p0.y) * (p2.x - p0.x) - (p1.x - p0.x) * (p2.y - p0.y) > 0;
        if (up) waterIdx.push(base + i0, base + i1, base + i2);
        else waterIdx.push(base + i0, base + i2, base + i1);
      }
    }
    if (waterIdx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(waterPos, 3));
      g.setIndex(waterIdx);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, this.waterMat);
      mesh.receiveShadow = true;
      mesh.name = `water_${tile.id}`;
      objs.push(mesh);
    }
    objs.forEach((o) => this.group.add(o));
    this.tiles.set(tile.id, objs);
  }

  removeTile(tile: LoadedTile): void {
    const objs = this.tiles.get(tile.id);
    if (!objs) return;
    for (const o of objs) {
      this.group.remove(o);
      (o as THREE.Mesh).geometry.dispose();
    }
    this.tiles.delete(tile.id);
  }
}

function lowestGround(ring: number[], groundAt: (x: number, z: number) => number): number {
  let m = Infinity;
  for (let i = 0; i < ring.length; i += 2) m = Math.min(m, groundAt(ring[i] as number, ring[i + 1] as number));
  return m;
}

/** Rubans de toutes les routes d'une tuile, fusionnés (un seul appel de dessin). */
function buildRoads(roads: TileRoad[]): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const uvs: number[] = [];
  const info: number[] = [];
  const index: number[] = [];
  for (const r of roads) {
    const p = r.pts3 as number[];
    const n = p.length / 3;
    if (n < 2) continue;
    const half = Math.max(r.width, 2.5) / 2;
    const marked = MARKED.has(r.kind) && r.width >= 5 ? 1 : 0;
    const unpaved = UNPAVED.has(r.surface ?? '') || r.kind === 'track' ? 1 : 0;
    const base = pos.length / 3;
    let along = 0;
    for (let i = 0; i < n; i++) {
      const x = p[i * 3] as number;
      const y = p[i * 3 + 1] as number;
      const z = p[i * 3 + 2] as number;
      const ip = Math.max(i - 1, 0);
      const inx = Math.min(i + 1, n - 1);
      let dx = (p[inx * 3] as number) - (p[ip * 3] as number);
      let dz = (p[inx * 3 + 2] as number) - (p[ip * 3 + 2] as number);
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      if (i > 0) along += Math.hypot(x - (p[(i - 1) * 3] as number), z - (p[(i - 1) * 3 + 2] as number));
      // Normale droite (−dz, dx) ; bandes : bord gauche, axe, bord droit (+ 0,6 m de bas-côté fondu).
      const offsets = [-(half + 0.6), half + 0.6];
      for (const o of offsets) {
        pos.push(x - dz * o, y + 0.05, z + dx * o);
        uvs.push(o, along);
        info.push(half, marked, unpaved);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('roadInfo', new THREE.Float32BufferAttribute(info, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
