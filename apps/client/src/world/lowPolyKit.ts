import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm } from '../engine/noise.ts';
import { SPLAT_CHANNELS, type LoadedTile } from './types.ts';
import { splatCell } from './splat.ts';

/**
 * Outils communs du décor « jeu vidéo » (style low poly) : gabarits de triangles à facettes, fusion
 * rapide par tronçon (sans objet three.js par instance), sondes d'occupation du sol, des bâtiments,
 * des arbres réels et des routes ou cours d'eau OSM proches d'un point.
 */

export const CH = Object.fromEntries(SPLAT_CHANNELS.map((c, i) => [c, i])) as Record<(typeof SPLAT_CHANNELS)[number], number>;

/**
 * Gabarit : triangles à plat (sans index). `col` : couleur propre de chaque sommet ; `tint` : 1 = la
 * couleur de l'objet multiplie la couleur propre (robe d'un animal, peinture d'un poteau), 0 = couleur
 * propre seule (sabots, museau) ; `head` : 1 = tête (s'abaisse pour brouter).
 */
export interface Template {
  pos: Float32Array;
  col: Float32Array;
  tint: Float32Array;
  head: Float32Array;
  count: number;
}

/** Pièce d'un gabarit : couleur propre, part teintée, tête. */
export function part(g: THREE.BufferGeometry, col: THREE.ColorRepresentation, tint = 0, head = 0): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (k !== 'position') ng.deleteAttribute(k);
  const n = ng.getAttribute('position').count;
  const c = new THREE.Color(col);
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(cols, i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  ng.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
  ng.setAttribute('head', new THREE.BufferAttribute(new Float32Array(n).fill(head), 1));
  return ng;
}

/** Fusionne des pièces (voir `part`) en un gabarit. */
export function template(parts: THREE.BufferGeometry[]): Template {
  const g = mergeGeometries(parts, false) as THREE.BufferGeometry;
  const arr = (k: string) => (g.getAttribute(k) as THREE.BufferAttribute).array as Float32Array;
  return { pos: arr('position'), col: arr('color'), tint: arr('tint'), head: arr('head'), count: g.getAttribute('position').count };
}

export const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
/** Prisme à `sides` pans, de y0 à y1, rayons r0 (bas) et r1 (haut). */
export const prism = (r0: number, r1: number, y0: number, y1: number, sides = 6, x = 0, z = 0): THREE.BufferGeometry => new THREE.CylinderGeometry(r1, r0, y1 - y0, sides, 1).translate(x, (y0 + y1) / 2, z);

/**
 * Tampon de fusion d'un tronçon : positions (repère monde), couleurs finales et, au besoin, `extra`
 * flottants par sommet (animation). Grandit à la demande ; `geometry()` copie la partie utile.
 */
export class MeshBuilder {
  pos: Float32Array;
  col: Float32Array;
  extra: Float32Array;
  n = 0;
  readonly stride: number;

  constructor(cap = 4096, extraStride = 0) {
    this.stride = extraStride;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.extra = new Float32Array(cap * Math.max(extraStride, 0));
  }

  private reserve(add: number): void {
    const need = this.n + add;
    if (need * 3 <= this.pos.length) return;
    const cap = Math.max(need, Math.ceil((this.pos.length / 3) * 1.6));
    const grow = (a: Float32Array, k: number) => {
      const b = new Float32Array(cap * k);
      b.set(a);
      return b;
    };
    this.pos = grow(this.pos, 3);
    this.col = grow(this.col, 3);
    if (this.stride) this.extra = grow(this.extra, this.stride);
  }

  /**
   * Gabarit transformé par une base quelconque : p' = o + x·A + y·B + z·C (A, B, C : axes déjà mis à
   * l'échelle). Couleur : propre × (r, g, b) sur les parts teintées. `ex` : flottants d'animation
   * (la tête du gabarit est ajoutée au premier).
   */
  putBasis(t: Template, ox: number, oy: number, oz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, r: number, g: number, b: number, ex?: ArrayLike<number>): void {
    this.reserve(t.count);
    const P = this.pos;
    const C = this.col;
    const tp = t.pos;
    const tc = t.col;
    let o = this.n * 3;
    for (let v = 0, i = 0; v < t.count; v++, i += 3) {
      const x = tp[i] as number;
      const y = tp[i + 1] as number;
      const z = tp[i + 2] as number;
      P[o] = ox + x * ax + y * bx + z * cx;
      P[o + 1] = oy + x * ay + y * by + z * cy;
      P[o + 2] = oz + x * az + y * bz + z * cz;
      const k = t.tint[v] as number;
      C[o] = (tc[i] as number) * (1 - k + k * r);
      C[o + 1] = (tc[i + 1] as number) * (1 - k + k * g);
      C[o + 2] = (tc[i + 2] as number) * (1 - k + k * b);
      o += 3;
    }
    if (this.stride && ex) {
      const E = this.extra;
      let e = this.n * this.stride;
      for (let v = 0; v < t.count; v++) {
        for (let j = 0; j < this.stride; j++) E[e + j] = (ex[j] as number) + (j === 0 ? (t.head[v] as number) : 0);
        e += this.stride;
      }
    }
    this.n += t.count;
  }

  /** Gabarit tourné de `yaw` autour de la verticale (l'axe x local suit (cos yaw, −sin yaw)), mis à l'échelle et posé en (x, y, z). */
  put(t: Template, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, c: THREE.Color, ex?: ArrayLike<number>): void {
    const co = Math.cos(yaw);
    const si = Math.sin(yaw);
    this.putBasis(t, x, y, z, co * sx, 0, -si * sx, 0, sy, 0, si * sz, 0, co * sz, c.r, c.g, c.b, ex);
  }

  /** Triangle à couleur unie, retourné au besoin pour faire face au ciel (sols, plans d'eau). */
  triUp(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, c: THREE.Color): void {
    // normale (b − a) × (c − a) : composante y = (bz − az)(cx − ax) − (bx − ax)(cz − az)
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (ny < 0) this.tri(ax, ay, az, cx, cy, cz, bx, by, bz, c);
    else this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, c);
  }

  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, c: THREE.Color): void {
    this.reserve(3);
    const P = this.pos;
    const C = this.col;
    const o = this.n * 3;
    P[o] = ax;
    P[o + 1] = ay;
    P[o + 2] = az;
    P[o + 3] = bx;
    P[o + 4] = by;
    P[o + 5] = bz;
    P[o + 6] = cx;
    P[o + 7] = cy;
    P[o + 8] = cz;
    for (let k = 0; k < 9; k += 3) {
      C[o + k] = c.r;
      C[o + k + 1] = c.g;
      C[o + k + 2] = c.b;
    }
    if (this.stride) this.extra.fill(0, this.n * this.stride, (this.n + 3) * this.stride);
    this.n += 3;
  }

  /** Quadrilatère vertical ou quelconque (a, b, c, d dans l'ordre), visible des deux faces. */
  quad2(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, c: THREE.Color): void {
    this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, c);
    this.tri(ax, ay, az, cx, cy, cz, dx, dy, dz, c);
    this.tri(ax, ay, az, cx, cy, cz, bx, by, bz, c);
    this.tri(ax, ay, az, dx, dy, dz, cx, cy, cz, c);
  }

  /** Géométrie (copie) ; null si vide. */
  geometry(extraName = 'anim'): THREE.BufferGeometry | null {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.n * 3), 3));
    if (this.stride) g.setAttribute(extraName, new THREE.BufferAttribute(this.extra.slice(0, this.n * this.stride), this.stride));
    g.computeBoundingSphere();
    return g;
  }

  reset(): void {
    this.n = 0;
  }
}

/** Matériau à facettes et couleurs par sommet (aplats). */
export function flatVertexMaterial(roughness = 0.9): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ roughness, metalness: 0 });
  m.vertexColors = true;
  m.flatShading = true;
  return m;
}

// ————————————————————————————————————————————— Sondes

interface BuildingIndex {
  /** Boîtes [minX, minZ, maxX, maxZ] par bâtiment. */
  bb: Float32Array;
  /** Case de 32 m → indices des bâtiments qui la touchent. */
  cells: Map<number, number[]>;
}

interface PointIndex {
  cells: Map<number, number[]>;
}

const CELL = 32;
const cellKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);
const buildingIndexes = new WeakMap<LoadedTile, BuildingIndex>();
const treeIndexes = new WeakMap<LoadedTile, PointIndex>();

function buildingIndex(tile: LoadedTile): BuildingIndex {
  let idx = buildingIndexes.get(tile);
  if (idx) return idx;
  const list = tile.features.buildings;
  const bb = new Float32Array(list.length * 4);
  const cells = new Map<number, number[]>();
  list.forEach((b, i) => {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let k = 0; k + 1 < b.pts.length; k += 2) {
      const x = b.pts[k] as number;
      const z = b.pts[k + 1] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    bb.set([minX, minZ, maxX, maxZ], i * 4);
    if (!Number.isFinite(minX)) return;
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = cellKey(cx, cz);
        let c = cells.get(k);
        if (!c) cells.set(k, (c = []));
        c.push(i);
      }
  });
  idx = { bb, cells };
  buildingIndexes.set(tile, idx);
  return idx;
}

function treeIndex(tile: LoadedTile): PointIndex {
  let idx = treeIndexes.get(tile);
  if (idx) return idx;
  const cells = new Map<number, number[]>();
  const t = tile.features.trees ?? [];
  for (let i = 0; i + 3 < t.length; i += 4) {
    const k = cellKey(Math.floor((t[i] as number) / CELL), Math.floor((t[i + 1] as number) / CELL));
    let c = cells.get(k);
    if (!c) cells.set(k, (c = []));
    c.push(i);
  }
  idx = { cells };
  treeIndexes.set(tile, idx);
  return idx;
}

/** Distance au carré d'un point au segment [a, b]. */
export function dist2Seg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const L = dx * dx + dz * dz;
  let t = L > 0 ? ((px - ax) * dx + (pz - az) * dz) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - px;
  const ez = az + t * dz - pz;
  return ex * ex + ez * ez;
}

/** Point dans un polygone plat ou à moins de `r` de son contour. */
function nearPolygon(pts: ArrayLike<number>, x: number, z: number, r: number): boolean {
  let inside = false;
  const n = pts.length >> 1;
  const r2 = r * r;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2] as number;
    const zi = pts[i * 2 + 1] as number;
    const xj = pts[j * 2] as number;
    const zj = pts[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    if (r > 0 && dist2Seg(x, z, xi, zi, xj, zj) < r2) return true;
  }
  return inside;
}

/**
 * Sonde du sol : occupation (raster des tuiles), bâtiments, arbres réels, routes et cours d'eau OSM.
 * Les champs `forest`… sont remplis par `read` (pas d'allocation).
 */
export class LandProbe {
  forest = 0;
  field = 0;
  meadow = 0;
  water = 0;
  urban = 0;
  road = 0;
  private readonly tiles: LoadedTile[] = [];
  /** Dernière tuile lue (la plupart des requêtes d'un tronçon tombent dans la même). */
  private last: LoadedTile | undefined;

  constructor(
    private readonly tileAtRaw: (x: number, z: number) => LoadedTile | undefined,
    readonly heightAt: (x: number, z: number) => number,
  ) {}

  /** Arbres déjà plantés par la végétation autour du tronçon en cours : (x, z, rayon) et leur grille. */
  private extra: number[] = [];
  private readonly extraCells = new Map<number, number[]>();

  /** Oublie la tuile en cache (à appeler avant chaque tronçon : des tuiles ont pu être déchargées). */
  forget(): void {
    this.last = undefined;
  }

  /** Arbres plantés (x, z, rayon du tronc et des basses branches) à éviter pour le tronçon en cours. */
  setTrees(list: number[]): void {
    this.extra = list;
    this.extraCells.clear();
    for (let i = 0; i + 2 < list.length; i += 3) {
      const k = cellKey(Math.floor((list[i] as number) / CELL), Math.floor((list[i + 1] as number) / CELL));
      let c = this.extraCells.get(k);
      if (!c) this.extraCells.set(k, (c = []));
      c.push(i);
    }
  }

  tileAt(x: number, z: number): LoadedTile | undefined {
    const l = this.last;
    if (l && x >= l.x0 && z >= l.z0 && x < l.x0 + l.size && z < l.z0 + l.size) return l;
    const t = this.tileAtRaw(x, z);
    if (t) this.last = t;
    return t;
  }

  /** Lit l'occupation du sol sous (x, z) ; false si la tuile (ou son raster) manque. */
  read(x: number, z: number): boolean {
    const t = this.tileAt(x, z);
    const c = t ? splatCell(t, x, z) : -1;
    if (!t || c < 0) return false;
    const d = (t.splat as { data: Uint8Array }).data;
    this.forest = (d[c + CH.forest] as number) / 255;
    this.field = (d[c + CH.field] as number) / 255;
    this.meadow = (d[c + CH.meadow] as number) / 255;
    this.water = (d[c + CH.water] as number) / 255;
    this.urban = (d[c + CH.urban] as number) / 255;
    this.road = (d[c + CH.road] as number) / 255;
    return true;
  }

  /** Terre ouverte : ni bourg, ni bois, ni eau, ni route (les terres sans occupation comptent comme prés). */
  open(x: number, z: number, urbanMax = 0.3): boolean {
    return this.read(x, z) && this.urban < urbanMax && this.forest < 0.4 && this.water < 0.2 && this.road < 0.25;
  }

  /**
   * Pré dégagé pour un animal, un caillou ou une mare : terre ouverte, lisière de bois à plus de
   * `margin` m (quatre points autour), ni haie (même bruit que la végétation), ni arbre réel, ni bâtiment.
   */
  clear(x: number, z: number, margin: number): boolean {
    if (!this.open(x, z) || this.forest > 0.05) return false;
    for (const [dx, dz] of RING4) {
      if (!this.read(x + dx * margin, z + dz * margin)) return false;
      if (this.forest > 0.15 || this.water > 0.3) return false;
    }
    // Haies des prés (vegetation.ts : |fbm(x/90, z/90)| < 0,03), avec une marge.
    if (Math.abs(fbm(x / 90, z / 90, 3)) < 0.05) return false;
    return !this.treeNear(x, z, margin * 0.6) && !this.buildingNear(x, z, margin * 0.6);
  }

  /** Tuiles distinctes qui couvrent un rectangle (au plus quatre en pratique). */
  tilesIn(minX: number, minZ: number, maxX: number, maxZ: number): LoadedTile[] {
    const out = this.tiles;
    out.length = 0;
    const c = this.tileAt((minX + maxX) / 2, (minZ + maxZ) / 2);
    // cas courant : le rectangle tient dans une tuile
    if (c && minX >= c.x0 && minZ >= c.z0 && maxX < c.x0 + c.size && maxZ < c.z0 + c.size) {
      out.push(c);
      return out;
    }
    if (c) out.push(c);
    for (const x of [minX, (minX + maxX) / 2, maxX])
      for (const z of [minZ, (minZ + maxZ) / 2, maxZ]) {
        const t = this.tileAt(x, z);
        if (t && !out.includes(t)) out.push(t);
      }
    return out;
  }

  /** Un bâtiment à moins de `r` m (ou dessous). */
  buildingNear(x: number, z: number, r: number): boolean {
    for (const t of this.tilesIn(x - r, z - r, x + r, z + r)) {
      const idx = buildingIndex(t);
      for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
        for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
          const list = idx.cells.get(cellKey(cx, cz));
          if (!list) continue;
          for (const i of list) {
            const o = i * 4;
            if (x < (idx.bb[o] as number) - r || x > (idx.bb[o + 2] as number) + r || z < (idx.bb[o + 1] as number) - r || z > (idx.bb[o + 3] as number) + r) continue;
            if (nearPolygon((t.features.buildings[i] as { pts: number[] }).pts, x, z, r)) return true;
          }
        }
    }
    return false;
  }

  /** Bâtiments dont la boîte touche le rectangle (indices dans `tile.features.buildings`). */
  buildingsIn(minX: number, minZ: number, maxX: number, maxZ: number, out: Array<{ tile: LoadedTile; i: number }>): void {
    out.length = 0;
    for (const t of this.tilesIn(minX, minZ, maxX, maxZ)) {
      const idx = buildingIndex(t);
      const seen = new Set<number>();
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
        for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
          for (const i of idx.cells.get(cellKey(cx, cz)) ?? []) {
            if (seen.has(i)) continue;
            seen.add(i);
            const o = i * 4;
            if ((idx.bb[o + 2] as number) < minX || (idx.bb[o] as number) > maxX || (idx.bb[o + 3] as number) < minZ || (idx.bb[o + 1] as number) > maxZ) continue;
            out.push({ tile: t, i });
          }
        }
    }
  }

  /** Un arbre réel (LiDAR) dont le houppier passe à moins de `r` m, ou un arbre planté par la végétation. */
  treeNear(x: number, z: number, r: number): boolean {
    if (this.extra.length) {
      const e = this.extra;
      for (let cx = Math.floor((x - r - 6) / CELL); cx <= Math.floor((x + r + 6) / CELL); cx++)
        for (let cz = Math.floor((z - r - 6) / CELL); cz <= Math.floor((z + r + 6) / CELL); cz++) {
          for (const i of this.extraCells.get(cellKey(cx, cz)) ?? []) {
            const dx = (e[i] as number) - x;
            const dz = (e[i + 1] as number) - z;
            const rr = r + (e[i + 2] as number);
            if (dx * dx + dz * dz < rr * rr) return true;
          }
        }
    }
    for (const t of this.tilesIn(x - r - 8, z - r - 8, x + r + 8, z + r + 8)) {
      const trees = t.features.trees;
      if (!trees?.length) continue;
      const idx = treeIndex(t);
      for (let cx = Math.floor((x - r - 8) / CELL); cx <= Math.floor((x + r + 8) / CELL); cx++)
        for (let cz = Math.floor((z - r - 8) / CELL); cz <= Math.floor((z + r + 8) / CELL); cz++) {
          for (const i of idx.cells.get(cellKey(cx, cz)) ?? []) {
            const dx = (trees[i] as number) - x;
            const dz = (trees[i + 1] as number) - z;
            const rr = r + (trees[i + 3] as number);
            if (dx * dx + dz * dz < rr * rr) return true;
          }
        }
    }
    return false;
  }
}

const RING4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Segments (ax, az, bx, bz, demi-largeur) des routes OSM ou des cours d'eau qui passent dans un
 * rectangle, pour les tests de proximité d'un tronçon (portails dans les clôtures, ponts). Routes en
 * tunnel ignorées ; cours d'eau busés (tunnel) gardés avec une demi-largeur négative.
 */
export function segmentsIn(probe: LandProbe, minX: number, minZ: number, maxX: number, maxZ: number, what: 'roads' | 'waterways', skip?: (r: { route?: string; id?: string }) => boolean): number[] {
  const out: number[] = [];
  for (const t of probe.tilesIn(minX, minZ, maxX, maxZ)) {
    const list = what === 'roads' ? t.features.roads : t.features.waterways;
    for (const r of list) {
      if (r.tunnel && what === 'roads') continue;
      if (what === 'roads' && skip?.(r as { route?: string; id?: string })) continue;
      const p = r.pts;
      const half = Math.max(r.width, what === 'roads' ? 2.5 : 1) / 2;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i] as number;
        const az = p[i + 1] as number;
        const bx = p[i + 2] as number;
        const bz = p[i + 3] as number;
        if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX || Math.max(az, bz) < minZ || Math.min(az, bz) > maxZ) continue;
        out.push(ax, az, bx, bz, r.tunnel ? -half : half);
      }
    }
  }
  return out;
}
