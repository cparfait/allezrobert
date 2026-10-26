import * as THREE from 'three/webgpu';
import { uv, attribute, mix, smoothstep, step, fract, floor, hash, min, vec3, float, uniform, mx_noise_float, positionWorld, clamp, abs, max } from 'three/tsl';
import type { LoadedTile, TileRoad } from './types.ts';
import { asphaltGrain } from './asphalt.ts';
import { isRouteTwin } from './splat.ts';
import { ribbonIndex, sideRoadStrips, type RouteFootprint } from './ribbon.ts';

/** Routes revêtues avec marquage axial (départementales et plus). */
const MARKED = new Set(['primary', 'secondary', 'tertiary', 'trunk', 'primary_link', 'secondary_link']);
const UNPAVED = new Set(['unpaved', 'gravel', 'dirt', 'ground', 'compacted', 'fine_gravel', 'grass', 'sand']);
/** Pavés (secteurs de Paris–Roubaix, vieilles rues) : mêmes valeurs OSM que la physique et le son. */
const COBBLES = new Set(['sett', 'cobblestone', 'unhewn_cobblestone', 'cobblestone:flattened', 'paving_stones:sett']);
const SKIP = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'pedestrian', 'corridor', 'platform']);

/**
 * Réseau routier OSM (hors itinéraire actif, déjà dessiné par RoadMesh) en rubans 3D posés
 * sur le profil lissé fourni par le pipeline (l'eau est dans water.ts).
 */
export class RoadNetwork {
  readonly group = new THREE.Group();
  readonly wetness = uniform(0);
  private readonly roadMat: THREE.MeshStandardNodeMaterial;
  private readonly tiles = new Map<string, THREE.Object3D[]>();
  private readonly activeRoute: string;
  private readonly footprint: RouteFootprint | null;

  /**
   * `footprint` : emprise de l'itinéraire actif ; les routes qui la recouvrent (même route tracée
   * par OSM ou par un autre itinéraire, bouts de carrefour) y sont découpées au bord de chaussée.
   */
  /** Monde ouvert : les pistes cyclables sont roulables, donc dessinées. */
  private readonly drawCycleways: boolean;

  constructor(activeRoute: string, groundAt: (x: number, z: number) => number, footprint: RouteFootprint | null = null, drawCycleways = false) {
    this.activeRoute = activeRoute;
    this.drawCycleways = drawCycleways;
    void groundAt;
    this.footprint = footprint;
    this.group.name = 'network';
    this.roadMat = this.createRoadMaterial();
  }

  private createRoadMaterial(): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial();
    const info = attribute<'vec3'>('roadInfo'); // demi-largeur, marquage axial, revêtement (0 enrobé, 1 non revêtu, 2 pavés)
    const across = uv().x; // mètres depuis l'axe (signé)
    const along = uv().y;
    const half = info.x;
    const ax = abs(across);
    const n = mx_noise_float(positionWorld.xz.mul(1.7)).mul(0.5).add(0.5);
    const n2 = mx_noise_float(positionWorld.xz.mul(0.08)).mul(0.5).add(0.5);
    const asphalt = vec3(0.24, 0.245, 0.26).mul(asphaltGrain()).mul(n2.mul(0.2).add(0.9));
    const gravel = vec3(0.5, 0.46, 0.38).mul(n.mul(0.35).add(0.7));
    const unpaved = clamp(info.z, 0, 1).mul(step(info.z, 1.5));
    const cobble = step(1.5, info.z);
    // Pavés : rangées de 14 cm décalées d'un demi-pavé, pavés de 17 cm, joints sombres, teinte par pavé.
    const rowF = along.div(0.14);
    const row = floor(rowF);
    const u = across.div(0.17).add(fract(row.mul(0.5)));
    const fu = fract(u);
    const fv = fract(rowF);
    const jointM = min(min(fu, float(1).sub(fu)).mul(0.17), min(fv, float(1).sub(fv)).mul(0.14));
    const inStone = smoothstep(0.01, 0.024, jointM);
    const shade = hash(floor(u).add(row.mul(57)));
    const stone = vec3(0.43, 0.41, 0.38).mul(shade.mul(0.4).add(0.72)).mul(n.mul(0.2).add(0.9));
    const cobbles = mix(vec3(0.13, 0.12, 0.1), stone, inStone);
    const edge = smoothstep(half.sub(0.35), half.sub(0.3), ax).mul(smoothstep(half.sub(0.1), half.sub(0.15), ax)).mul(info.y);
    const dash = step(fract(along.div(13)), float(3 / 13));
    const center = smoothstep(0.08, 0.06, ax).mul(dash).mul(info.y);
    const paint = max(edge, center).mul(n2.mul(0.25).add(0.75)).mul(float(1).sub(cobble));
    let col = mix(mix(asphalt, gravel, unpaved), cobbles, cobble);
    col = mix(col, vec3(0.9, 0.9, 0.86), paint);
    // Bords fondus dans le bas-côté (pas d'arête nette sur l'herbe).
    col = col.mul(float(1).sub(this.wetness.mul(0.4).mul(float(1).sub(unpaved))));
    m.colorNode = col;
    // pavés mouillés : brillants entre les joints (le « Enfer du Nord » sous la pluie)
    m.roughnessNode = clamp(mix(mix(float(0.8), float(0.97), unpaved), mix(float(0.62), float(0.9), float(1).sub(inStone)), cobble).sub(this.wetness.mul(0.55).mul(float(1).sub(unpaved))), 0.06, 1);
    m.metalnessNode = float(0);
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    return m;
  }

  addTile(tile: LoadedTile): void {
    if (this.tiles.has(tile.id)) return;
    const objs: THREE.Object3D[] = [];
    const roads = tile.features.roads.filter((r) => r.pts3 && !r.tunnel && (!SKIP.has(r.kind) || (this.drawCycleways && r.kind === 'cycleway')) && r.route !== this.activeRoute && !isRouteTwin(r, tile.features.roads, this.activeRoute));
    if (roads.length) {
      const geo = buildRoads(roads, this.footprint);
      if (geo) {
        const mesh = new THREE.Mesh(geo, this.roadMat);
        mesh.receiveShadow = true;
        mesh.name = `roads_${tile.id}`;
        objs.push(mesh);
      }
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

/** Rubans de toutes les routes d'une tuile, fusionnés (un seul appel de dessin). */
function buildRoads(roads: TileRoad[], footprint: RouteFootprint | null): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const uvs: number[] = [];
  const info: number[] = [];
  const index: number[] = [];
  for (const r of roads) {
    const p = r.pts3 as number[];
    if (p.length < 6) continue;
    const half = Math.max(r.width, 2.5) / 2;
    const marked = MARKED.has(r.kind) && r.width >= 5 ? 1 : 0;
    const unpaved = COBBLES.has(r.surface ?? '') ? 2 : UNPAVED.has(r.surface ?? '') || r.kind === 'track' ? 1 : 0;
    // Bords à demi-largeur + 0,6 m de bas-côté fondu ; découpe contre l'itinéraire actif.
    const o = half + 0.6;
    for (const s of sideRoadStrips(p, o, half, footprint, 0.05)) {
      const base = pos.length / 3;
      const n = s.along.length;
      for (let i = 0; i < n; i++) {
        pos.push(s.left[i * 3] as number, s.left[i * 3 + 1] as number, s.left[i * 3 + 2] as number);
        pos.push(s.right[i * 3] as number, s.right[i * 3 + 1] as number, s.right[i * 3 + 2] as number);
        uvs.push(-o, s.along[i] as number, o, s.along[i] as number);
        info.push(half, marked, unpaved, half, marked, unpaved);
      }
      for (const k of ribbonIndex(pos.slice(base * 3), 3, 2, n, true)) index.push(base + k);
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
