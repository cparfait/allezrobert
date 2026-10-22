import * as THREE from 'three/webgpu';
import { attribute, uv, fract, floor, step, mix, vec2, vec3, float, uniform, mx_noise_float, positionWorld, smoothstep, max, min, abs, hash, normalWorld, texture, normalMap } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, polygonArea } from '../engine/noise.ts';
import type { LoadedTile } from './types.ts';
import { orientedBox, planRoof, roofBuffers, flatRoof } from './roofs.ts';

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
/** Pierre locale des bâtiments BD TOPO hors Île-de-France (arkose, granite) : gris-beige. */
const STONE_LOCAL = ['#b3a68f', '#a89a84', '#bcae95', '#9f937f'];
const BRICK = '#a8624a';
const ROOFS = ['#8a4a35', '#7d4331', '#94553d', '#6f3f30', '#86513c', '#7a4a3a'];
const SLATE = '#4f565f';
/** Tuiles mécaniques et canal (BD TOPO « tuiles », hors Île-de-France) : orangé à rouge brique. */
const TERRACOTTA = ['#c4733f', '#b9683d', '#c97d4a', '#b0603a', '#be7650', '#a85f3c'];
/** Bac acier et fibrociment : gris clair à gris-vert, parfois vert ou brun. */
const METAL_ROOFS = ['#8d9294', '#9da1a0', '#7f8784', '#6f7a72', '#84776a'];
const SHUTTERS = ['#7d8f9b', '#5f7d66', '#e8e4da', '#8a5a3c', '#4b6a8a', '#a7b8a0'];

/** Couleur OSM (« brick », « #c0a080 »…) avec repli si elle n'est pas reconnue. */
function osmColour(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const named: Record<string, string> = { brick: BRICK, stone: MEULIERE[0] as string, white: '#efe7d8', beige: '#d9ccb2', yellow: '#dccb92', grey: '#a3a39e', gray: '#a3a39e', red: BRICK, brown: '#8a6a4a' };
  if (named[value]) return named[value] as string;
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
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

/** Murs dont le haut suit une hauteur variable (`heightAt` au-dessus de la base), pour les monopentes. */
function slopedWalls(pts: number[], base: number, heightAt: (x: number, z: number) => number): THREE.BufferGeometry {
  const g = walls(pts, base, 1);
  const pos = g.getAttribute('position');
  const uvA = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) <= base + 1e-6) continue;
    const h = heightAt(pos.getX(i), pos.getZ(i));
    pos.setY(i, base + h);
    uvA.setY(i, h);
  }
  g.computeVertexNormals();
  return g;
}

/** Géométrie Three.js depuis des tableaux position/uv (triangles non indexés). */
function toGeometry(pos: number[], uvs: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/** Formes OSM traitées en croupes (les autres, hors terrasse, en deux pans si l'emprise s'y prête). */
const HIPPED = new Set(['hipped', 'pyramidal', 'half-hipped', 'mansard', 'dome', 'round', 'onion', 'cone']);

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
    const isSlate = step(float(1.5), kind).mul(step(kind, float(2.5)));
    // 3 : bac acier / fibrociment (hangars, BD TOPO « zinc, aluminium » et « béton »)
    const isMetal = step(float(2.5), kind);

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
    // Pierre : la photo (≈ meulière) prend la teinte de la pierre locale (arkose gris-beige en Auvergne).
    const stoneTinted = stone.mul(base.div(vec3(0.48, 0.29, 0.14))).clamp(0, 1.4);
    let wall = renderTinted.mul(isRender).add(stoneTinted.mul(isStone)).add(brick.mul(isBrick));
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
    // binfo.z : 0 mur aveugle, 1 fenêtres, 2 annexe (grande porte en bois sur un mur sur deux)
    const hasWin = step(float(0.5), facade.y).mul(step(float(0.5), info.z)).mul(step(info.z, float(1.5))).mul(step(0.9, v));
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
    // Porte de grange / garage : planches verticales, encadrement sombre, position tirée par mur.
    const wallSeed = hash(floor(facade.x.mul(7.31)));
    const hasDoor = step(float(1.5), info.z).mul(step(float(3.2), facade.x)).mul(step(float(0.45), wallSeed));
    const doorW = mix(float(1.1), float(2.8), step(float(6), facade.x));
    const doorC = facade.x.mul(wallSeed.mul(0.4).add(0.3));
    const doorH = min(float(2.7), facade.x.mul(0.6));
    const dx = abs(u.sub(doorC));
    const inDoor = step(dx, doorW.mul(0.5)).mul(step(v, doorH)).mul(hasDoor);
    const inDoorFrame = step(dx, doorW.mul(0.5).add(0.1)).mul(step(v, doorH.add(0.1))).mul(hasDoor);
    const planks = fract(u.div(0.16)).mul(0.25).add(0.75).mul(mx_noise_float(vec2(u.mul(3), v.mul(0.2))).mul(0.15).add(0.9));
    wall = mix(wall, vec3(0.12, 0.09, 0.07), inDoorFrame);
    wall = mix(wall, accent.mul(0.55).add(vec3(0.12, 0.08, 0.04)).mul(planks), inDoor);

    // ── Toits : tuiles en terre cuite et ardoise (textures photo), mousse par endroits ──
    const roofUv = (size: number) => vec2(u, v).div(size);
    const moss = smoothstep(0.6, 0.9, mx_noise_float(positionWorld.mul(0.5))).mul(0.3);
    const tileTex = texture(T.tiles.map, roofUv(3.2)).rgb;
    const tiles = mix(tileTex.mul(base.div(vec3(0.33, 0.13, 0.08)).clamp(0.7, 1.8)), vec3(0.3, 0.33, 0.18), moss);
    const slate = texture(T.slate.map, roofUv(1.5)).rgb;
    // Bac acier : ondes de 25 cm dans la pente, coulures et rouille légère par plaques.
    const rib = abs(fract(u.div(0.25)).sub(0.5)).mul(2);
    const rust = smoothstep(0.55, 0.85, mx_noise_float(positionWorld.mul(0.25))).mul(0.35);
    const metal = mix(base.mul(rib.mul(0.25).add(0.8)), vec3(0.42, 0.27, 0.17), rust).mul(nBig.mul(0.15).add(0.9));
    let col = mix(wall, tiles, isTile);
    col = mix(col, slate, isSlate);
    col = mix(col, metal, isMetal);
    m.colorNode = col;
    m.emissiveNode = vec3(1.0, 0.62, 0.3).mul(inWin.mul(lit).mul(isWall).mul(2.2));
    m.roughnessNode = mix(mix(mix(float(0.93), float(0.15), inWin.mul(isWall)), float(0.75), isTile.add(isSlate).min(1)).sub(isSlate.mul(0.2)), float(0.55), isMetal);
    // Relief : cartes de normales de la texture correspondante (sauf sur les vitres).
    const nrm = (t: THREE.Texture, size: number) => texture(t, vec2(u, v).div(size)).rgb;
    const wallN = nrm(T.render.normal, 2.0).mul(isRender).add(nrm(T.stone.normal, 2.3).mul(isStone)).add(nrm(T.brick.normal, 2.0).mul(isBrick));
    const roofN = nrm(T.tiles.normal, 3.2).mul(isTile).add(nrm(T.slate.normal, 1.5).mul(isSlate)).add(vec3(0.5, 0.5, 1).mul(isMetal));
    const flatN = vec3(0.5, 0.5, 1);
    const nCol = mix(mix(wallN, flatN, inWin.max(inFrame).max(inShutter)), roofN, isTile.add(isSlate).add(isMetal).min(1));
    m.normalNode = normalMap(nCol, vec2(0.8, 0.8));
    m.metalnessNode = isMetal.mul(0.25);
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
      const total = isChurch ? Math.max(bld.height, 14) : Math.max(bld.height || (bld.levels ?? 1.6) * 2.9 + 3, 3.5);
      // BD TOPO : matériau du toit connu (le bac acier a une pente plus faible que la tuile).
      const roofMat = bld.roofMaterial ?? (bld.material === 'slate' || shape === 'mansard' || isChurch ? 'slate' : undefined);
      const metal = roofMat === 'metal' || roofMat === 'concrete';
      const minPitch = metal ? 6 : 15;
      // Monopente (annexes, hangars) : un seul pan sur le rectangle orienté, murs montés jusqu'au pan.
      const skillion = shape === 'skillion' && box.hw <= 20 && (bld.roofHeight ?? 0) > 0.3;
      // Toit sur l'emprise réelle (squelette droit) : deux pans si elle est presque rectangulaire, croupes sinon.
      const plan =
        skillion || shape === 'flat' || box.hw > 20 || bld.roofHeight === 0
          ? null
          : planRoof(bld.pts, { overhang: 0.4, gableOverhang: 0.25, gabled: !HIPPED.has(shape), maxInset: 15, ...(bld.ridgeShort ? { ridgeShort: true } : {}) });
      // Pente : hauteur de toit (OSM, ou mesurée au LiDAR) sur la demi-largeur effective (là où les pans se rejoignent), bornée.
      const halfW = plan ? Math.max(plan.tEnd - plan.overhang, 0.5) : 0;
      const wantH = Math.min(bld.roofHeight ?? Math.tan((42 * Math.PI) / 180) * halfW, total * 0.6);
      const pitch = plan ? Math.min(Math.max((Math.atan(wantH / halfW) * 180) / Math.PI, minPitch), 55) : 0;
      const roofH = plan ? Math.tan((pitch * Math.PI) / 180) * halfW : skillion ? Math.min(bld.roofHeight as number, total * 0.5) : 0;
      const wallH = Math.max(total - roofH, 2.4);
      const wallTop = base + wallH + 0.3;
      // Matériau de façade : connu (BD TOPO, OSM) sinon tiré au sort (meulière ≈ 45 % hors annexes), ou couleur OSM.
      const stones = !bld.colour && (bld.material === 'stone' || (!bld.material && !isUtility && r() < 0.45));
      const brick = bld.material === 'brick';
      const wallColour = osmColour(
        bld.colour,
        stones ? ((bld.bdtopo ? STONE_LOCAL : MEULIERE)[Math.floor(r() * (bld.bdtopo ? STONE_LOCAL : MEULIERE).length)] as string) : brick ? BRICK : bld.material === 'concrete' ? '#cfcac0' : bld.material === 'wood' ? '#7a5a3e' : (RENDERS[Math.floor(r() * RENDERS.length)] as string),
      );
      acc.set(SHUTTERS[Math.floor(r() * SHUTTERS.length)] as string);
      // Monopente : haut des murs sur le plan du toit (pente selon la largeur, ou la longueur si faîtage court).
      const slopeU = !!bld.ridgeShort;
      const sx = slopeU ? box.ux : -box.uz;
      const sz = slopeU ? box.uz : box.ux;
      const half = slopeU ? box.hl : box.hw;
      const roofAt = (x: number, z: number) => wallTop + ((((x - box.cx) * sx + (z - box.cz) * sz) / half + 1) / 2) * roofH;
      const w = skillion ? slopedWalls(bld.pts, base, (x, z) => roofAt(x, z) - base) : walls(bld.pts, base, wallH + 0.3);
      const wallType = stones ? 1 : brick ? 2 : 0;
      paint(w, c.set(wallColour), 0, acc, wallType, isUtility ? 2 : 1);
      parts.push(w);
      const slate = roofMat === 'slate';
      // Tuiles : brun-rouge (tuile plate d'Île-de-France) ou orangé (tuile mécanique / canal, BD TOPO).
      const roofColour = metal
        ? (METAL_ROOFS[Math.floor(r() * METAL_ROOFS.length)] as string)
        : slate
          ? SLATE
          : !plan && !skillion
            ? '#6f6c66'
            : ((roofMat === 'tiles' ? TERRACOTTA : ROOFS)[Math.floor(r() * (roofMat === 'tiles' ? TERRACOTTA : ROOFS).length)] as string);
      const roofKind = metal ? 3 : slate || (!plan && !skillion) ? 2 : 1;
      const buf = plan ? roofBuffers(plan, wallTop, pitch) : null;
      const roofPart = buf ? buf.roof : flatRoof(bld.pts, wallTop);
      if (skillion) for (let i = 0; i < roofPart.pos.length; i += 3) roofPart.pos[i + 1] = roofAt(roofPart.pos[i] as number, roofPart.pos[i + 2] as number);
      if (roofPart.pos.length) {
        const roof = toGeometry(roofPart.pos, roofPart.uv);
        paint(roof, c.set(roofColour), roofKind, acc, 0, 0);
        parts.push(roof);
      }
      if (buf && buf.gables.pos.length) {
        // Pignons (murs triangulaires) : même enduit que les murs.
        const gables = toGeometry(buf.gables.pos, buf.gables.uv);
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
