import * as THREE from 'three/webgpu';
import { attribute, uv, fract, floor, step, mix, vec2, vec3, float, uniform, mx_noise_float, positionWorld, smoothstep, max, abs, normalWorld, texture, normalMap } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, polygonArea } from '../engine/noise.ts';
import type { LoadedTile } from './types.ts';

/** Textures photo CC0 (Poly Haven) des façades et toits, chargées une fois et partagées. */
function loadTex(dir: string, file: string, srgb: boolean): THREE.Texture {
  const t = new THREE.TextureLoader().load(`/assets/textures/${dir}/${file}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const pbr = (dir: string) => ({ map: loadTex(dir, 'diffuse.jpg', true), normal: loadTex(dir, 'nor_gl.jpg', false) });
const BUILDING_TEXTURES = {
  render: pbr('painted_plaster_wall'),
  stone: pbr('plaster_stone_wall_01'),
  brick: pbr('brick_wall_09'),
  tiles: pbr('clay_roof_tiles'),
  slate: pbr('grey_roof_tiles_02'),
};

/**
 * Bâti d'Île-de-France rurale (voir ART_DIRECTION.md) : enduits clairs et meulière ocre,
 * soubassement plus sombre, fenêtres à encadrement clair et volets colorés, tuile plate
 * brun-rouge en rangs serrés, ardoise pour les églises et les toits à la Mansart.
 */
const RENDERS = ['#e8dfcf', '#e2d6c0', '#d9ccb2', '#efe7d8', '#d6c3a0'];
const MEULIERE = ['#b8936a', '#a98660', '#c29f74'];
const BRICK = '#a8624a';
const ROOFS = ['#8a4a35', '#7d4331', '#94553d', '#6f3f30', '#86513c', '#7a4a3a'];
const SLATE = '#4f565f';
const SHUTTERS = ['#7d8f9b', '#5f7d66', '#e8e4da', '#8a5a3c', '#4b6a8a', '#a7b8a0'];

interface Obb {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  hl: number; // demi-longueur selon u
  hw: number; // demi-largeur selon v
}

/** Couleur OSM (« brick », « #c0a080 »…) avec repli si elle n'est pas reconnue. */
function osmColour(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const named: Record<string, string> = { brick: BRICK, stone: MEULIERE[0] as string, white: '#efe7d8', beige: '#d9ccb2', yellow: '#dccb92', grey: '#a3a39e', gray: '#a3a39e', red: BRICK, brown: '#8a6a4a' };
  if (named[value]) return named[value] as string;
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
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
  if (best && best.hl < best.hw) best = { cx: best.cx, cz: best.cz, ux: -best.uz, uz: best.ux, hl: best.hw, hw: best.hl };
  return best ?? { cx: pts[0] as number, cz: pts[1] as number, ux: 1, uz: 0, hl: 3, hw: 3 };
}

/** Attributs par sommet : couleur de base, type (0 mur, 1 tuile, 2 ardoise), couleur des volets, ornements. */
function paint(geo: THREE.BufferGeometry, base: THREE.Color, kind: number, accent: THREE.Color, stones: number, windows: number): void {
  const n = geo.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const acc = new Float32Array(n * 3);
  const info = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col.set([base.r, base.g, base.b], i * 3);
    acc.set([accent.r, accent.g, accent.b], i * 3);
    info.set([kind, stones, windows], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('accent', new THREE.BufferAttribute(acc, 3));
  geo.setAttribute('binfo', new THREE.BufferAttribute(info, 3));
  if (!geo.getAttribute('facade')) geo.setAttribute('facade', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
}

/**
 * Murs extrudés depuis l'emprise réelle. uv = (mètres le long du mur, hauteur au-dessus de la base) ;
 * attribut `facade` = (longueur du mur, nombre de travées de fenêtres).
 */
function walls(pts: number[], base: number, height: number): THREE.BufferGeometry {
  const n = pts.length / 2;
  const ccw = polygonArea(pts) > 0;
  const pos: number[] = [];
  const uvs: number[] = [];
  const fac: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ccw ? i : n - 1 - i;
    const b = ccw ? (i + 1) % n : (n - 2 - i + n) % n;
    const ax = pts[a * 2] as number;
    const az = pts[a * 2 + 1] as number;
    const bx = pts[b * 2] as number;
    const bz = pts[b * 2 + 1] as number;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const top = base + height;
    const bays = len >= 2.6 ? Math.max(1, Math.floor((len - 0.6) / 3.1)) : 0;
    pos.push(ax, base, az, ax, top, az, bx, base, bz, bx, base, bz, ax, top, az, bx, top, bz);
    uvs.push(0, 0, 0, height, len, 0, len, 0, 0, height, len, height);
    for (let k = 0; k < 6; k++) fac.push(len, bays);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('facade', new THREE.Float32BufferAttribute(fac, 2));
  g.computeVertexNormals();
  return g;
}

/** Toit à quatre pans (ou à deux pans + pignons) sur le rectangle orienté, avec débord de 40 cm. */
function roofGeometry(b: Obb, eave: number, pitchDeg: number, hip: boolean): { roof: THREE.BufferGeometry; gables: THREE.BufferGeometry | null } {
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
  const roofTris: Array<[number, number, number][]> = [
    [c1, r1, c2],
    [c2, r1, r2],
    [c3, r2, c4],
    [c4, r2, r1],
  ];
  if (hip) roofTris.push([c2, r2, c3], [c4, r1, c1]);
  const build = (tris: Array<[number, number, number][]>, uvFor: (p: [number, number, number]) => [number, number]) => {
    const pos: number[] = [];
    const uvs: number[] = [];
    for (const t0 of tris) {
      // Contrôle automatique : un pan de toit doit regarder vers le haut (sinon « toit inversé »).
      const [a, b, c] = t0 as [[number, number, number], [number, number, number], [number, number, number]];
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      const t = ny < 0 ? [a, c, b] : t0;
      for (const p of t) {
        pos.push(...p);
        uvs.push(...uvFor(p));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    return g;
  };
  // uv du toit : (le long du faîtage, distance horizontale au faîtage) → rangs de tuiles parallèles à l'égout.
  const roof = build(roofTris, (p) => {
    const du = (p[0] - b.cx) * b.ux + (p[2] - b.cz) * b.uz;
    const dv = -(p[0] - b.cx) * b.uz + (p[2] - b.cz) * b.ux;
    return [du, Math.abs(dv) / Math.cos((pitchDeg * Math.PI) / 180)];
  });
  // Pignons (murs triangulaires) : même enduit que les murs.
  const gables = hip
    ? null
    : build(
        [
          [c2, r2, c3],
          [c4, r1, c1],
        ],
        (p) => [(-(p[0] - b.cx) * b.uz + (p[2] - b.cz) * b.ux) + hw, p[1] - eave + 3],
      );
  return { roof, gables };
}

/**
 * Bâtiments d'une tuile fusionnés en un seul maillage, matériau procédural unique (TSL).
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
    const info = attribute<'vec3'>('binfo'); // type, pierres apparentes, fenêtres
    const kind = info.x;
    const base = attribute<'vec3'>('color');
    const accent = attribute<'vec3'>('accent');
    const facade = attribute<'vec2'>('facade'); // longueur du mur, travées
    const u = uv().x;
    const v = uv().y;
    const isWall = step(kind, float(0.5));
    const isTile = step(float(0.5), kind).mul(step(kind, float(1.5)));
    const isSlate = step(float(1.5), kind);

    // ── Murs : textures photo CC0 (Poly Haven), à l'échelle réelle (uv en mètres) ──
    // Type de mur (binfo.y) : 0 enduit, 1 pierres apparentes (proche de la meulière), 2 brique.
    const wallType = info.y;
    const isStone = step(float(0.5), wallType).mul(step(wallType, float(1.5)));
    const isBrick = step(float(1.5), wallType);
    const isRender = float(1).sub(isStone).sub(isBrick);
    const T = BUILDING_TEXTURES;
    const wallUv = (size: number) => vec2(u, v).div(size);
    const render = texture(T.render.map, wallUv(2.0)).rgb;
    const stone = texture(T.stone.map, wallUv(2.3)).rgb;
    const brick = texture(T.brick.map, wallUv(2.0)).rgb;
    // L'enduit (photo grise tachée) prend la teinte de chaque maison : couleur de base × variations de la photo.
    const renderTinted = render.mul(base.div(vec3(0.31, 0.29, 0.28))).clamp(0, 1.5);
    let wall = renderTinted.mul(isRender).add(stone.mul(isStone)).add(brick.mul(isBrick));
    const nBig = mx_noise_float(positionWorld.mul(0.35)).mul(0.5).add(0.5);
    wall = wall.mul(nBig.mul(0.1).add(0.95));
    // Soubassement plus sombre (0,6 m) et salissures en pied de mur.
    wall = wall.mul(mix(float(0.72), float(1), smoothstep(0.55, 0.65, v))).mul(mix(float(0.85), float(1), smoothstep(0.0, 2.0, v)));
    // Fenêtres : travées réparties sur la longueur, une par étage de 2,8 m, au-dessus de 0,9 m.
    const bays = max(facade.y, float(0.0001));
    const local = fract(u.div(facade.x).mul(bays));
    const bayW = facade.x.div(bays);
    const wx = local.sub(0.5).mul(bayW); // mètres depuis l'axe de la travée
    const floorY = fract(v.sub(0.9).div(2.8));
    const fy = floorY.mul(2.8); // mètres au-dessus de l'allège
    const hasWin = step(float(0.5), facade.y).mul(info.z).mul(step(0.9, v));
    const inWin = step(abs(wx), float(0.5)).mul(step(fy, float(1.35))).mul(hasWin);
    const inFrame = step(abs(wx), float(0.58)).mul(step(fy, float(1.43))).mul(step(float(-0.08), fy.sub(0.0))).mul(hasWin);
    const shutterX = abs(wx);
    const inShutter = step(float(0.6), shutterX).mul(step(shutterX, float(1.08))).mul(step(fy, float(1.38))).mul(hasWin);
    // Lames des volets.
    const slats = fract(fy.mul(9)).mul(0.25).add(0.8);
    // Environ une fenêtre sur deux allumée la nuit (bruit par pièce).
    const lit = step(0.0, mx_noise_float(floor(positionWorld.mul(0.3)).add(0.37))).mul(this.night);
    const glass = mix(vec3(0.1, 0.12, 0.14).add(normalWorld.y.mul(0)), vec3(1.0, 0.74, 0.42), lit);
    // Reflet du ciel dans les vitres (haut plus clair).
    const glassSky = glass.add(vec3(0.12, 0.15, 0.18).mul(fy.div(1.35)).mul(float(1).sub(lit)));
    wall = mix(wall, accent.mul(slats), inShutter.mul(float(1).sub(inWin)));
    wall = mix(wall, vec3(0.93, 0.92, 0.88), inFrame.mul(float(1).sub(inWin)));
    wall = mix(wall, glassSky, inWin);

    // ── Toits : tuiles en terre cuite et ardoise (textures photo), mousse par endroits ──
    const roofUv = (size: number) => vec2(u, v).div(size);
    const moss = smoothstep(0.6, 0.9, mx_noise_float(positionWorld.mul(0.5))).mul(0.3);
    const tileTex = texture(T.tiles.map, roofUv(3.2)).rgb;
    const tiles = mix(tileTex.mul(base.div(vec3(0.33, 0.13, 0.08)).clamp(0.7, 1.3)), vec3(0.3, 0.33, 0.18), moss);
    const slate = texture(T.slate.map, roofUv(1.5)).rgb;
    let col = mix(wall, tiles, isTile);
    col = mix(col, slate, isSlate);
    m.colorNode = col;
    m.emissiveNode = vec3(1.0, 0.62, 0.3).mul(inWin.mul(lit).mul(isWall).mul(2.2));
    m.roughnessNode = mix(mix(float(0.93), float(0.15), inWin.mul(isWall)), float(0.75), isTile.add(isSlate).min(1)).sub(isSlate.mul(0.2));
    // Relief : cartes de normales de la texture correspondante (sauf sur les vitres).
    const nrm = (t: THREE.Texture, size: number) => texture(t, vec2(u, v).div(size)).rgb;
    const wallN = nrm(T.render.normal, 2.0).mul(isRender).add(nrm(T.stone.normal, 2.3).mul(isStone)).add(nrm(T.brick.normal, 2.0).mul(isBrick));
    const roofN = nrm(T.tiles.normal, 3.2).mul(isTile).add(nrm(T.slate.normal, 1.5).mul(isSlate));
    const flatN = vec3(0.5, 0.5, 1);
    const nCol = mix(mix(wallN, flatN, inWin.max(inFrame).max(inShutter)), roofN, isTile.add(isSlate).min(1));
    m.normalNode = normalMap(nCol, vec2(0.8, 0.8));
    m.metalnessNode = float(0);
    // Les emprises OSM n'ont pas d'orientation garantie : on rend les deux faces.
    m.side = THREE.DoubleSide;
    return m;
  }

  addTile(tile: LoadedTile): void {
    if (this.tiles.has(tile.id) || !tile.features.buildings.length) return;
    const r = rng(tile.tx * 92821 + tile.tz * 68917);
    const parts: THREE.BufferGeometry[] = [];
    const c = new THREE.Color();
    const acc = new THREE.Color();
    for (const bld of tile.features.buildings) {
      if (bld.pts.length < 6) continue;
      let base = bld.y ?? Infinity;
      if (!Number.isFinite(base)) for (let i = 0; i < bld.pts.length; i += 2) base = Math.min(base, this.groundAt(bld.pts[i] as number, bld.pts[i + 1] as number));
      if (!Number.isFinite(base)) continue;
      base -= 0.3;
      const isChurch = bld.kind === 'church' || bld.kind === 'chapel';
      const isUtility = ['shed', 'garage', 'garages', 'barn', 'greenhouse', 'roof', 'industrial', 'ruins'].includes(bld.kind);
      const box = orientedBox(bld.pts);
      const shape = bld.roof ?? 'gabled';
      const flat = shape === 'flat' || box.hw > 20;
      const total = isChurch ? Math.max(bld.height, 14) : Math.max(bld.height || (bld.levels ?? 1.6) * 2.9 + 3, 3.5);
      const roofH = flat ? 0.4 : Math.min(bld.roofHeight ?? Math.tan((42 * Math.PI) / 180) * box.hw, total * 0.6);
      const wallH = Math.max(total - roofH, 2.4);
      // Matériau de façade : meulière (≈ 30 %), enduit clair, ou couleur OSM.
      const stones = !isUtility && !bld.colour && (bld.material === 'stone' || r() < 0.45);
      const wallColour = osmColour(bld.colour, stones ? (MEULIERE[Math.floor(r() * MEULIERE.length)] as string) : bld.material === 'brick' ? BRICK : (RENDERS[Math.floor(r() * RENDERS.length)] as string));
      acc.set(SHUTTERS[Math.floor(r() * SHUTTERS.length)] as string);
      const w = walls(bld.pts, base, wallH + 0.3);
      const wallType = stones ? 1 : wallColour === BRICK ? 2 : 0;
      paint(w, c.set(wallColour), 0, acc, wallType, isUtility ? 0 : 1);
      parts.push(w);
      const pitch = flat ? 3 : (Math.atan(roofH / Math.max(box.hw + 0.4, 0.5)) * 180) / Math.PI;
      const hip = shape === 'hipped' || shape === 'pyramidal' || shape === 'half-hipped';
      const { roof, gables } = roofGeometry(box, base + wallH + 0.3, pitch, hip);
      const slate = bld.material === 'slate' || shape === 'mansard' || isChurch;
      paint(roof, c.set(slate ? SLATE : flat ? '#6f6c66' : (osmColour(undefined, ROOFS[Math.floor(r() * ROOFS.length)] as string))), slate || flat ? 2 : 1, acc, 0, 0);
      parts.push(roof);
      if (gables) {
        paint(gables, c.set(wallColour), 0, acc, wallType, 0);
        parts.push(gables);
      }
      if (isChurch) {
        // Clocher : tour carrée en pierre et flèche d'ardoise à une extrémité.
        const tx = box.cx + box.ux * (box.hl - 2.5);
        const tz = box.cz + box.uz * (box.hl - 2.5);
        const th = wallH + 9;
        const tower = walls([tx - 2.25, tz - 2.25, tx + 2.25, tz - 2.25, tx + 2.25, tz + 2.25, tx - 2.25, tz + 2.25], base, th);
        paint(tower, c.set(MEULIERE[1] as string), 0, acc.set('#5b5f66'), 1, 0);
        parts.push(tower);
        const spire = new THREE.ConeGeometry(3.4, 11, 8).translate(tx, base + th + 5.5, tz).toNonIndexed();
        spire.deleteAttribute('uv');
        spire.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(spire.getAttribute('position').count * 2), 2));
        paint(spire, c.set(SLATE), 2, acc, 0, 0);
        parts.push(spire);
      }
    }
    if (!parts.length) return;
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
