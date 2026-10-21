import * as THREE from 'three/webgpu';
import { attribute, uv, fract, step, mix, vec3, float, uniform, mx_noise_float, positionWorld, smoothstep } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, polygonArea } from '../engine/noise.ts';
import type { LoadedTile } from './types.ts';

/** Matériaux d'Île-de-France rurale : meulière, enduit clair, tuile plate brun-rouge, ardoise. */
const WALLS = ['#a8835a', '#9c7b55', '#e6dccb', '#d9cdb6', '#b89a74'];
const ROOFS = ['#9c4a2f', '#8a3f28', '#7a3825', '#a5583a', '#5b5f66'];

interface Obb {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  hl: number; // demi-longueur selon u
  hw: number; // demi-largeur selon v
}

/** Rectangle orienté minimal (calipers sur les arêtes du polygone). */
function orientedBox(pts: number[]): Obb {
  let best: Obb | null = null;
  let bestArea = Infinity;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ux = (pts[j * 2] as number) - (pts[i * 2] as number);
    let uz = (pts[j * 2 + 1] as number) - (pts[i * 2 + 1] as number);
    const len = Math.hypot(ux, uz);
    if (len < 0.5) continue;
    ux /= len;
    uz /= len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = pts[k * 2] as number;
      const z = pts[k * 2 + 1] as number;
      const u = x * ux + z * uz;
      const v = -x * uz + z * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = { cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, ux, uz, hl: (maxU - minU) / 2, hw: (maxV - minV) / 2 };
    }
  }
  if (best && best.hl < best.hw) {
    // Faîtage selon le grand côté.
    best = { cx: best.cx, cz: best.cz, ux: -best.uz, uz: best.ux, hl: best.hw, hw: best.hl };
  }
  return best ?? { cx: pts[0] as number, cz: pts[1] as number, ux: 1, uz: 0, hl: 3, hw: 3 };
}

function colorAttr(geo: THREE.BufferGeometry, c: THREE.Color, kind: number): void {
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const k = new Float32Array(n).fill(kind);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('kind', new THREE.BufferAttribute(k, 1));
}

/** Murs extrudés depuis l'emprise réelle ; uv = (mètres le long du mur, hauteur en m). */
function walls(pts: number[], base: number, height: number): THREE.BufferGeometry {
  const n = pts.length / 2;
  const ccw = polygonArea(pts) > 0;
  const pos: number[] = [];
  const uvs: number[] = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    const a = ccw ? i : n - 1 - i;
    const b = ccw ? (i + 1) % n : (n - 2 - i + n) % n;
    const ax = pts[a * 2] as number;
    const az = pts[a * 2 + 1] as number;
    const bx = pts[b * 2] as number;
    const bz = pts[b * 2 + 1] as number;
    const len = Math.hypot(bx - ax, bz - az);
    const top = base + height;
    // Deux triangles par façade, orientés vers l'extérieur.
    pos.push(ax, base, az, ax, top, az, bx, base, bz, bx, base, bz, ax, top, az, bx, top, bz);
    uvs.push(run, 0, run, height, run + len, 0, run + len, 0, run, height, run + len, height);
    run += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/** Toit à quatre pans (ou à deux pans) sur le rectangle orienté, avec débord de 40 cm. */
function hippedRoof(b: Obb, eave: number, pitchDeg: number, hip: boolean): THREE.BufferGeometry {
  const o = 0.4;
  const hl = b.hl + o;
  const hw = b.hw + o;
  const rise = Math.tan((pitchDeg * Math.PI) / 180) * hw;
  const ridgeHalf = hip ? Math.max(hl - hw, 0.2) : hl;
  const P = (u: number, v: number, y: number): [number, number, number] => [b.cx + u * b.ux - v * b.uz, y, b.cz + u * b.uz + v * b.ux];
  const c1 = P(-hl, -hw, eave);
  const c2 = P(hl, -hw, eave);
  const c3 = P(hl, hw, eave);
  const c4 = P(-hl, hw, eave);
  const r1 = P(-ridgeHalf, 0, eave + rise);
  const r2 = P(ridgeHalf, 0, eave + rise);
  const tris: Array<[number, number, number][]> = [
    [c1, r1, c2],
    [c2, r1, r2],
    [c3, r2, c4],
    [c4, r2, r1],
    [c2, r2, c3],
    [c4, r1, c1],
  ];
  if (!hip) {
    // Pignons : les extrémités deviennent des triangles verticaux.
    tris[4] = [c2, r2, c3];
    tris[5] = [c4, r1, c1];
  }
  const pos: number[] = [];
  const uvs: number[] = [];
  for (const t of tris) {
    for (const p of t) {
      pos.push(...p);
      // uv : coordonnées monde pour le motif de tuiles.
      uvs.push(p[0] * b.ux + p[2] * b.uz, p[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Bâtiments d'une tuile fusionnés en un seul maillage : murs en meulière ou enduit
 * (motif procédural, fenêtres éclairées la nuit), toits de tuiles plates ou d'ardoise,
 * clochers pour les églises.
 */
export class Buildings {
  readonly group = new THREE.Group();
  /** 0 = jour, 1 = nuit (fenêtres allumées). */
  readonly night = uniform(0);
  private readonly material: THREE.MeshStandardNodeMaterial;
  private readonly tiles = new Map<string, THREE.Mesh>();
  private readonly groundAt: (x: number, z: number) => number;

  constructor(groundAt: (x: number, z: number) => number) {
    this.groundAt = groundAt;
    this.group.name = 'buildings';
    this.material = this.createMaterial();
  }

  private createMaterial(): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
    const kind = attribute<'float'>('kind'); // 0 = mur, 1 = toit, 2 = clocher
    const base = attribute<'vec3'>('color');
    const u = uv().x;
    const v = uv().y;
    const n = mx_noise_float(positionWorld.mul(1.6)).mul(0.5).add(0.5);
    const n2 = mx_noise_float(positionWorld.mul(0.25)).mul(0.5).add(0.5);
    // Meulière : pierres irrégulières, joints clairs.
    const stones = smoothstep(0.42, 0.5, mx_noise_float(positionWorld.mul(2.6)).mul(0.5).add(0.5));
    const wallCol = mix(base.mul(n.mul(0.25).add(0.8)), base.mul(1.25), stones.mul(0.35));
    // Fenêtres : 1,1 m × 1,4 m tous les 3,2 m, par étage de 2,8 m, au-dessus de 0,9 m.
    const wx = fract(u.div(3.2));
    const wy = fract(v.sub(0.9).div(2.8));
    const isWin = step(0.33, wx).mul(step(wx, 0.67)).mul(step(0.1, wy)).mul(step(wy, 0.6)).mul(step(0.9, v));
    const lit = step(0.45, n2).mul(this.night);
    const winCol = mix(vec3(0.08, 0.09, 0.1), vec3(1.0, 0.72, 0.38), lit);
    // Tuiles : rangs de 17 cm, décalés.
    const rows = fract(v.mul(5.8));
    const tilesPattern = smoothstep(0.0, 0.12, rows).mul(0.25).add(0.75);
    const roofCol = base.mul(tilesPattern).mul(n.mul(0.35).add(0.7));
    const isWall = float(1).sub(kind.min(1));
    const isRoof = kind.min(1);
    let col = mix(wallCol, roofCol, isRoof);
    col = mix(col, winCol, isWin.mul(isWall));
    m.colorNode = col;
    m.emissiveNode = vec3(1.0, 0.62, 0.3).mul(isWin.mul(isWall).mul(lit).mul(2.2));
    m.roughnessNode = mix(float(0.92), float(0.25), isWin.mul(isWall));
    // Les emprises OSM n'ont pas d'orientation garantie : on rend les deux faces.
    m.side = THREE.DoubleSide;
    m.metalnessNode = float(0);
    return m;
  }

  addTile(tile: LoadedTile): void {
    if (this.tiles.has(tile.id) || !tile.features.buildings.length) return;
    const r = rng(tile.tx * 92821 + tile.tz * 68917);
    const parts: THREE.BufferGeometry[] = [];
    const c = new THREE.Color();
    for (const bld of tile.features.buildings) {
      if (bld.pts.length < 6) continue;
      // Base posée au point le plus bas de l'emprise (pas de bâtiment qui flotte).
      let base = Infinity;
      for (let i = 0; i < bld.pts.length; i += 2) base = Math.min(base, this.groundAt(bld.pts[i] as number, bld.pts[i + 1] as number));
      if (!Number.isFinite(base)) continue;
      base -= 0.3;
      const isChurch = bld.kind === 'church' || bld.kind === 'chapel';
      const height = isChurch ? Math.max(bld.height, 11) : Math.max(bld.height || (bld.levels ?? 1.6) * 2.9, 3);
      const w = walls(bld.pts, base, height + 0.3);
      colorAttr(w, c.set(WALLS[Math.floor(r() * WALLS.length)] as string), 0);
      parts.push(w);
      const box = orientedBox(bld.pts);
      const flat = bld.roof === 'flat' || box.hw > 18;
      const roof = hippedRoof(box, base + height + 0.3, flat ? 4 : isChurch ? 50 : 38 + r() * 12, !isChurch && r() < 0.6);
      colorAttr(roof, c.set(ROOFS[isChurch ? 4 : Math.floor(r() * (ROOFS.length - 1))] as string), 1);
      parts.push(roof);
      if (isChurch) {
        // Clocher : tour carrée et flèche d'ardoise à une extrémité.
        const tx = box.cx + box.ux * (box.hl - 2.5);
        const tz = box.cz + box.uz * (box.hl - 2.5);
        const tower = new THREE.BoxGeometry(4.5, height + 9, 4.5).translate(tx, base + (height + 9) / 2, tz);
        const twr = tower.toNonIndexed();
        const tuv = twr.getAttribute('uv');
        for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) * 4.5, tuv.getY(i) * (height + 9));
        colorAttr(twr, c.set('#a8835a'), 0);
        parts.push(twr);
        const spire = new THREE.ConeGeometry(3.4, 11, 8).translate(tx, base + height + 9 + 5.5, tz).toNonIndexed();
        colorAttr(spire, c.set('#4f545c'), 2);
        parts.push(spire);
      }
    }
    if (!parts.length) return;
    for (const p of parts) {
      if (!p.getAttribute('uv')) p.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.getAttribute('position').count * 2), 2));
      if (p.getAttribute('normal') === undefined) p.computeVertexNormals();
    }
    const merged = mergeGeometries(
      parts.map((p) => (p.index ? p.toNonIndexed() : p)),
      false,
    );
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `buildings_${tile.id}`;
    this.group.add(mesh);
    this.tiles.set(tile.id, mesh);
  }

  removeTile(tile: LoadedTile): void {
    const m = this.tiles.get(tile.id);
    if (!m) return;
    this.group.remove(m);
    m.geometry.dispose();
    this.tiles.delete(tile.id);
  }
}

