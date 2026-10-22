import * as THREE from 'three/webgpu';
import { attribute, uv, fract, floor, step, mix, vec2, vec3, float, uniform, mx_noise_float, positionWorld, smoothstep, max, abs, normalWorld, texture, normalMap, hash } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, polygonArea } from '../engine/noise.ts';
import type { LoadedTile } from './types.ts';
import { orientedBox, planRoof, roofBuffers, flatRoof } from './roofs.ts';
import { meuliere } from './meuliere.ts';

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

/** Géométrie Three.js depuis des tableaux position/uv (triangles non indexés). */
function toGeometry(pos: number[], uvs: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Détails de toit d'une maison : faîtage en tuiles rondes (toit à deux pans) et souche de cheminée
 * en meulière ou brique avec son chapeau, posée sur le faîtage. Seulement sur les emprises
 * presque rectangulaires (le faîtage est alors l'axe du rectangle orienté).
 */
function houseDetails(pts: number[], box: ReturnType<typeof orientedBox>, plan: NonNullable<ReturnType<typeof planRoof>>, wallTop: number, pitch: number, roofColour: string, slate: boolean, r: () => number, density: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const rectangular = Math.abs(polygonArea(pts)) / (4 * box.hl * box.hw) > 0.88;
  if (!rectangular || box.hw < 2) return out;
  const tan = Math.tan((pitch * Math.PI) / 180);
  const ridgeY = wallTop + (plan.tEnd - plan.overhang) * tan;
  const vx = -box.uz;
  const vz = box.ux;
  const gabled = plan.gables.length > 0;
  // Demi-longueur du faîtage : tout le rectangle (deux pans) ou réduite par les croupes.
  const ridgeHalf = gabled ? box.hl + 0.25 : Math.max(box.hl - (plan.tEnd - plan.overhang), 0);
  const c = new THREE.Color();
  const acc = new THREE.Color('#000000');
  if (gabled && ridgeHalf > 0.5 && !slate) {
    const pos: number[] = [];
    const uvs: number[] = [];
    const a = [box.cx - box.ux * ridgeHalf, box.cz - box.uz * ridgeHalf];
    const b = [box.cx + box.ux * ridgeHalf, box.cz + box.uz * ridgeHalf];
    const top = ridgeY + 0.13;
    const low = ridgeY - 0.04;
    for (const side of [1, -1]) {
      const ox = vx * 0.19 * side;
      const oz = vz * 0.19 * side;
      const q = [
        [a[0]! + ox, low, a[1]! + oz, 0, 0],
        [b[0]! + ox, low, b[1]! + oz, ridgeHalf * 2, 0],
        [b[0]!, top, b[1]!, ridgeHalf * 2, 0.25],
        [a[0]!, top, a[1]!, 0, 0.25],
      ];
      for (const k of side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
        const v = q[k]!;
        pos.push(v[0]!, v[1]!, v[2]!);
        uvs.push(v[3]!, v[4]!);
      }
    }
    const g = toGeometry(pos, uvs);
    paint(g, c.set(roofColour).multiplyScalar(0.82), 1, acc, 0, 0);
    out.push(g);
  }
  if (r() < 0.8 * density) {
    // Souche de cheminée sur le faîtage (au tiers ou au pignon), 0,8 × 0,55 m, 0,9 m au-dessus.
    const t = (r() < 0.5 ? -1 : 1) * Math.min(ridgeHalf * (0.35 + r() * 0.4), Math.max(ridgeHalf - 0.6, 0));
    const cx = box.cx + box.ux * t;
    const cz = box.cz + box.uz * t;
    const hw = 0.4;
    const hd = 0.28;
    const ring = (e: number) => [
      cx - box.ux * (hw + e) - vx * (hd + e), cz - box.uz * (hw + e) - vz * (hd + e),
      cx + box.ux * (hw + e) - vx * (hd + e), cz + box.uz * (hw + e) - vz * (hd + e),
      cx + box.ux * (hw + e) + vx * (hd + e), cz + box.uz * (hw + e) + vz * (hd + e),
      cx - box.ux * (hw + e) + vx * (hd + e), cz - box.uz * (hw + e) + vz * (hd + e),
    ];
    const topY = ridgeY + 0.9;
    const stack = walls(ring(0), wallTop - 0.2, topY - (wallTop - 0.2));
    const brick = r() < 0.4;
    paint(stack, c.set(brick ? BRICK : (MEULIERE[Math.floor(r() * MEULIERE.length)] as string)), 0, acc, brick ? 2 : 1, 0);
    out.push(stack);
    const capRing = ring(0.06);
    const cap = walls(capRing, topY, 0.12);
    paint(cap, c.set('#8d8a82'), 0, acc, 0, 0);
    out.push(cap);
    const lid = flatRoof(capRing, topY + 0.12);
    const lidG = toGeometry(lid.pos, lid.uv);
    paint(lidG, c.set('#5d5a55'), 2, acc, 0, 0);
    out.push(lidG);
  }
  return out;
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
  /** Détails des maisons (cheminées, faîtières) : 0 = aucun, 1 = toutes les maisons qui s'y prêtent. */
  props = 1;

  constructor(groundAt: (x: number, z: number) => number, props = 1) {
    this.groundAt = groundAt;
    this.props = props;
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
    // Type de mur (binfo.y) : 0 enduit, 1 meulière (procédurale), 2 brique, 3 enduit à pierres vues.
    const wallType = info.y;
    const isStone = step(float(0.5), wallType).mul(step(wallType, float(1.5)));
    const isBrick = step(float(1.5), wallType).mul(step(wallType, float(2.5)));
    const isRubble = step(float(2.5), wallType);
    const isRender = float(1).sub(isStone).sub(isBrick).sub(isRubble);
    const T = BUILDING_TEXTURES;
    const wallUv = (size: number) => vec2(u, v).div(size);
    const render = texture(T.render.map, wallUv(2.0)).rgb;
    const rubble = texture(T.stone.map, wallUv(2.3)).rgb;
    const brick = texture(T.brick.map, wallUv(2.0)).rgb;
    // Meulière : moellons procéduraux, teinte de la maison (ocre plus ou moins rouge) en multiplicateur.
    const meul = meuliere(vec2(u, v));
    const stone = meul.color.mul(base.div(vec3(0.68, 0.53, 0.37)).clamp(0.8, 1.2));
    // L'enduit (photo grise tachée) prend la teinte de chaque maison : couleur de base × variations de la photo.
    const renderTinted = render.mul(base.div(vec3(0.31, 0.29, 0.28))).clamp(0, 1.5);
    let wall = renderTinted.mul(isRender).add(stone.mul(isStone)).add(brick.mul(isBrick)).add(rubble.mul(isRubble));
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
    // Tuile plate : chaque tuile (≈ 17 × 10,5 cm visibles, rangs décalés) a sa propre cuisson,
    // plus quelques plaques de tuiles de remplacement plus claires et des lichens jaunes.
    const row = floor(v.div(0.105));
    const tcell = floor(vec2(u.div(0.17).add(row.mul(0.5)), row));
    const th = hash(tcell.x.add(5000).mul(1000).add(tcell.y.add(500)));
    const patch = smoothstep(0.55, 0.75, mx_noise_float(positionWorld.mul(0.22)));
    const lichen = smoothstep(0.7, 0.85, mx_noise_float(positionWorld.mul(1.7))).mul(0.35);
    const tileVar = th.mul(0.24).add(0.88).mul(mix(float(1), float(1.12), patch));
    const tiles = mix(mix(tileTex.mul(base.div(vec3(0.33, 0.13, 0.08)).clamp(0.7, 1.3)).mul(tileVar), vec3(0.3, 0.33, 0.18), moss), vec3(0.62, 0.58, 0.3), lichen);
    const slate = texture(T.slate.map, roofUv(1.5)).rgb;
    let col = mix(wall, tiles, isTile);
    col = mix(col, slate, isSlate);
    m.colorNode = col;
    m.emissiveNode = vec3(1.0, 0.62, 0.3).mul(inWin.mul(lit).mul(isWall).mul(2.2));
    m.roughnessNode = mix(mix(float(0.93), float(0.15), inWin.mul(isWall)), float(0.75), isTile.add(isSlate).min(1)).sub(isSlate.mul(0.2));
    // Relief : cartes de normales de la texture correspondante (sauf sur les vitres).
    const nrm = (t: THREE.Texture, size: number) => texture(t, vec2(u, v).div(size)).rgb;
    const wallN = nrm(T.render.normal, 2.0)
      .mul(isRender)
      .add(meul.normalTS.mul(0.5).add(0.5).mul(isStone))
      .add(nrm(T.brick.normal, 2.0).mul(isBrick))
      .add(nrm(T.stone.normal, 2.3).mul(isRubble));
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
      const total = isChurch ? Math.max(bld.height, 14) : Math.max(bld.height || (bld.levels ?? 1.6) * 2.9 + 3, 3.5);
      // Toit sur l'emprise réelle (squelette droit) : deux pans si elle est presque rectangulaire, croupes sinon.
      const plan = shape === 'flat' || box.hw > 20 || bld.roofHeight === 0 ? null : planRoof(bld.pts, { overhang: 0.4, gableOverhang: 0.25, gabled: !HIPPED.has(shape), maxInset: 15 });
      // Pente : hauteur de toit OSM sur la demi-largeur effective (là où les pans se rejoignent), bornée.
      const halfW = plan ? Math.max(plan.tEnd - plan.overhang, 0.5) : 0;
      const wantH = Math.min(bld.roofHeight ?? Math.tan((42 * Math.PI) / 180) * halfW, total * 0.6);
      const pitch = plan ? Math.min(Math.max((Math.atan(wantH / halfW) * 180) / Math.PI, 15), 55) : 0;
      const roofH = plan ? Math.tan((pitch * Math.PI) / 180) * halfW : 0;
      const wallH = Math.max(total - roofH, 2.4);
      const wallTop = base + wallH + 0.3;
      // Matériau de façade : meulière (≈ 30 %), enduit clair, ou couleur OSM.
      const stones = !isUtility && !bld.colour && (bld.material === 'stone' || r() < 0.45);
      const wallColour = osmColour(bld.colour, stones ? (MEULIERE[Math.floor(r() * MEULIERE.length)] as string) : bld.material === 'brick' ? BRICK : (RENDERS[Math.floor(r() * RENDERS.length)] as string));
      acc.set(SHUTTERS[Math.floor(r() * SHUTTERS.length)] as string);
      const w = walls(bld.pts, base, wallH + 0.3);
      // Granges, fermes et églises : enduit à pierres vues plutôt que meulière ou enduit lisse.
      const rubble = !stones && !bld.colour && (bld.kind === 'barn' || bld.kind === 'farm' || isChurch) && r() < 0.7;
      const wallType = stones ? 1 : rubble ? 3 : wallColour === BRICK ? 2 : 0;
      paint(w, c.set(wallColour), 0, acc, wallType, isUtility ? 0 : 1);
      parts.push(w);
      const slate = bld.material === 'slate' || shape === 'mansard' || isChurch;
      const roofColour = slate ? SLATE : !plan ? '#6f6c66' : (ROOFS[Math.floor(r() * ROOFS.length)] as string);
      const buf = plan ? roofBuffers(plan, wallTop, pitch) : null;
      const roofPart = buf ? buf.roof : flatRoof(bld.pts, wallTop);
      if (roofPart.pos.length) {
        const roof = toGeometry(roofPart.pos, roofPart.uv);
        paint(roof, c.set(roofColour), slate || !plan ? 2 : 1, acc, 0, 0);
        parts.push(roof);
      }
      if (buf && buf.gables.pos.length) {
        // Pignons (murs triangulaires) : même enduit que les murs.
        const gables = toGeometry(buf.gables.pos, buf.gables.uv);
        paint(gables, c.set(wallColour), 0, acc, wallType, 0);
        parts.push(gables);
      }
      if (plan && buf && !isChurch && !isUtility && this.props > 0) parts.push(...houseDetails(bld.pts, box, plan, wallTop, pitch, roofColour, slate, r, this.props));
      if (isChurch) {
        // Clocher : tour carrée en pierre et flèche d'ardoise à une extrémité.
        const tx = box.cx + box.ux * (box.hl - 2.5);
        const tz = box.cz + box.uz * (box.hl - 2.5);
        const th = wallH + 9;
        const tower = walls([tx - 2.25, tz - 2.25, tx + 2.25, tz - 2.25, tx + 2.25, tz + 2.25, tx - 2.25, tz + 2.25], base, th);
        paint(tower, c.set(MEULIERE[1] as string), 0, acc.set('#5b5f66'), 3, 0);
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
