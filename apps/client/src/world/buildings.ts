import * as THREE from 'three/webgpu';
import { attribute, uv, fract, floor, step, mix, vec2, vec3, float, uniform, mx_noise_float, positionWorld, smoothstep, max, min, abs, hash, normalWorld, normalMap } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, polygonArea } from '../engine/noise.ts';
import type { LoadedTile, TileRoad } from './types.ts';
import { orientedBox, planRoof, roofBuffers, flatRoof } from './roofs.ts';
import { meuliere } from './meuliere.ts';
import { FootprintIndex } from './footprints.ts';
import { LazyTexture } from '../engine/textures.ts';

/** Textures photo CC0 (Poly Haven) des façades et toits, chargées une fois et partagées. */
function loadTex(dir: string, file: string, srgb: boolean): LazyTexture {
  return new LazyTexture(`/assets/textures/${dir}/${file}`, {
    wrap: THREE.RepeatWrapping,
    anisotropy: 8,
    ...(srgb ? { colorSpace: THREE.SRGBColorSpace } : {}),
  });
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
const TERRACOTTA = ['#a87a6a', '#9d7062', '#b18574', '#94695c', '#a67d6e', '#b38a78'];
/** Bac acier et fibrociment : gris clair à gris-vert, parfois vert ou brun. */
const METAL_ROOFS = ['#8d9294', '#9da1a0', '#7f8784', '#6f7a72', '#84776a'];
const SHUTTERS = ['#7d8f9b', '#5f7d66', '#e8e4da', '#8a5a3c', '#4b6a8a', '#a7b8a0'];
/**
 * Style local des bâtiments BD TOPO (Limagne, Livradois) : enduits à la chaux ocrés, rosés ou grège,
 * volets bois brun, vert de gris, bleu charrette, lie-de-vin.
 */
const RENDERS_LOCAL = ['#d9c4a0', '#d2b48c', '#cdb79e', '#e0cdb0', '#c9a882', '#d9b8a0', '#e3d6c2'];
const SHUTTERS_LOCAL = ['#6b4a35', '#7d8a7a', '#5d7380', '#7e3a33', '#d9d2c2', '#4f6b5a', '#8c6a4a'];

/** Façade d'un mur : style local, génoise sous l'égout, porte d'entrée dans une travée. */
interface WallStyle {
  /** Bâtiment BD TOPO : génoise, chaînes d'angle, encadrements de pierre, travées irrégulières. */
  local: boolean;
  /** Mur d'égout (parallèle au faîtage) d'après sa direction : génoise. */
  eave?: (dx: number, dz: number) => boolean;
  /** Milieu du mur qui reçoit la porte d'entrée (côté rue). */
  door?: [number, number];
  /** Tirage de la travée de la porte (0–1). */
  doorPick?: number;
}

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
  if (!geo.getAttribute('bstyle')) geo.setAttribute('bstyle', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
}

/**
 * Murs extrudés depuis l'emprise réelle. uv = (mètres le long du mur, hauteur au-dessus de la base) ;
 * attribut `facade` = (longueur du mur, nombre de travées de fenêtres) ; `bstyle` = (style local,
 * hauteur du mur, génoise, travée de la porte d'entrée + 1 ou 0).
 */
function walls(pts: number[], base: number, height: number, style?: WallStyle): THREE.BufferGeometry {
  const n = pts.length / 2;
  const ccw = polygonArea(pts) > 0;
  const pos: number[] = [];
  const uvs: number[] = [];
  const fac: number[] = [];
  const sty: number[] = [];
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
    const genoise = style?.local && style.eave?.(bx - ax, bz - az) ? 1 : 0;
    const isDoor = style?.door && bays > 0 && Math.hypot((ax + bx) / 2 - style.door[0], (az + bz) / 2 - style.door[1]) < 0.01;
    const doorBay = isDoor ? 1 + Math.min(bays - 1, Math.floor((style?.doorPick ?? 0.5) * bays)) : 0;
    for (let k = 0; k < 6; k++) {
      fac.push(len, bays);
      sty.push(style?.local ? 1 : 0, height, genoise, doorBay);
    }
    if (genoise) {
      // Génoise : trois rangs en encorbellement (10, 20, 30 cm du bas vers le haut), 14 cm chacun, sous
      // l'égout ; face avant (même uv que le mur : le shader y peint les bouts de tuiles) et sous-face.
      // Contour orienté dans le sens positif : l'extérieur est à droite du mur, normale (dz, −dx).
      const nx = (bz - az) / len;
      const nz = -(bx - ax) / len;
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      for (let row = 0; row < 3; row++) {
        const d = 0.1 * (row + 1);
        const y1 = top - 0.14 * (2 - row);
        const y0 = y1 - 0.14;
        // les rangs dépassent un peu aux extrémités pour se rejoindre aux angles
        const x0 = ax - ux * d + nx * d;
        const z0 = az - uz * d + nz * d;
        const x1 = bx + ux * d + nx * d;
        const z1 = bz + uz * d + nz * d;
        const L = len + 2 * d;
        const v0 = y0 - base;
        const v1 = y1 - base;
        // face avant
        pos.push(x0, y0, z0, x1, y0, z1, x0, y1, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0);
        uvs.push(-d, v0, L - d, v0, -d, v1, L - d, v0, L - d, v1, -d, v1);
        // sous-face (du mur à la face avant)
        const wx0 = ax - ux * d;
        const wz0 = az - uz * d;
        const wx1 = bx + ux * d;
        const wz1 = bz + uz * d;
        pos.push(wx0, y0, wz0, x1, y0, z1, x0, y0, z0, wx0, y0, wz0, wx1, y0, wz1, x1, y0, z1);
        uvs.push(-d, v0, L - d, v0, -d, v0, -d, v0, L - d, v0, L - d, v0);
        for (let k = 0; k < 12; k++) {
          fac.push(len, 0);
          sty.push(1, height, 1, 0);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('facade', new THREE.Float32BufferAttribute(fac, 2));
  g.setAttribute('bstyle', new THREE.Float32BufferAttribute(sty, 4));
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

/**
 * Milieu du mur d'au moins 3 m le plus proche d'une voie (porte d'entrée côté rue), ou null si
 * aucune voie à moins de 40 m.
 */
function streetWall(pts: number[], roads: TileRoad[]): [number, number] | null {
  let cx = 0;
  let cz = 0;
  const n = pts.length / 2;
  for (let i = 0; i < pts.length; i += 2) {
    cx += pts[i] as number;
    cz += pts[i + 1] as number;
  }
  cx /= n;
  cz /= n;
  const near: number[][] = [];
  for (const r of roads) {
    if (r.kind === 'footway' || r.kind === 'path' || r.kind === 'steps') continue;
    for (let i = 0; i < r.pts.length; i += 2)
      if (Math.abs((r.pts[i] as number) - cx) < 60 && Math.abs((r.pts[i + 1] as number) - cz) < 60) {
        near.push(r.pts);
        break;
      }
  }
  if (!near.length) return null;
  const dist = (x: number, z: number) => {
    let best = Infinity;
    for (const l of near)
      for (let i = 0; i + 3 < l.length; i += 2) {
        const ax = l[i] as number;
        const az = l[i + 1] as number;
        const dx = (l[i + 2] as number) - ax;
        const dz = (l[i + 3] as number) - az;
        const l2 = dx * dx + dz * dz;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
        best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
      }
    return best;
  };
  let best: [number, number] | null = null;
  let bestD = 40;
  for (let i = 0; i < n; i++) {
    const ax = pts[i * 2] as number;
    const az = pts[i * 2 + 1] as number;
    const bx = pts[((i + 1) % n) * 2] as number;
    const bz = pts[((i + 1) % n) * 2 + 1] as number;
    if (Math.hypot(bx - ax, bz - az) < 3) continue;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const d = dist(mx, mz);
    if (d < bestD) {
      bestD = d;
      best = [mx, mz];
    }
  }
  return best;
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
  /** Emprises des bâtiments chargés (collision de la caméra, sans lancer de rayon sur les triangles). */
  readonly footprints = new FootprintIndex();
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
    const bstyle = attribute<'vec4'>('bstyle'); // style local, hauteur du mur, génoise, travée de la porte + 1
    const isLocal = bstyle.x;
    const wallH = bstyle.y;
    const u = uv().x;
    const v = uv().y;
    const isWall = step(kind, float(0.5));
    const isTile = step(float(0.5), kind).mul(step(kind, float(1.5)));
    const isSlate = step(float(1.5), kind).mul(step(kind, float(2.5)));
    // 3 : bac acier / fibrociment (hangars, BD TOPO « zinc, aluminium » et « béton »)
    const isMetal = step(float(2.5), kind);

    // ── Murs : textures photo CC0 (Poly Haven), à l'échelle réelle (uv en mètres) ──
    // Type de mur (binfo.y) : 0 enduit, 1 meulière (procédurale), 2 brique, 3 enduit à pierres vues.
    const wallType = info.y;
    const isStone = step(float(0.5), wallType).mul(step(wallType, float(1.5)));
    const isBrick = step(float(1.5), wallType).mul(step(wallType, float(2.5)));
    const isRubble = step(float(2.5), wallType);
    const isRender = float(1).sub(isStone).sub(isBrick).sub(isRubble);
    const T = BUILDING_TEXTURES;
    const wallUv = (size: number) => vec2(u, v).div(size);
    const render = T.render.map.sample(wallUv(2.0)).rgb;
    const rubble = T.stone.map.sample(wallUv(2.3)).rgb;
    const brick = T.brick.map.sample(wallUv(2.0)).rgb;
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
    // Pierre claire du pays (arkose) : chaînes d'angle, encadrements, claveaux.
    const stoneLum = stone.dot(vec3(0.3, 0.59, 0.11)).div(0.3);
    const lightStone = vec3(0.6, 0.55, 0.46).mul(stoneLum.mul(0.35).add(0.7));
    // Chaînes d'angle (style local, murs enduits à fenêtres) : blocs alternés longs / courts aux extrémités.
    const course = floor(v.div(0.32));
    const qw = mix(float(0.45), float(0.27), fract(course.mul(0.5)).mul(2));
    const inQuoin = max(step(u, qw), step(facade.x.sub(qw), u)).mul(isLocal).mul(isRender).mul(isWall).mul(step(float(0.5), info.z));
    const quoinJoint = smoothstep(0.035, 0.0, fract(v.div(0.32))).add(smoothstep(0.04, 0.0, abs(u.sub(qw)))).add(smoothstep(0.04, 0.0, abs(u.sub(facade.x.sub(qw))))).min(1);
    wall = mix(wall, lightStone.mul(float(1).sub(quoinJoint.mul(0.35))), inQuoin);
    // Fenêtres : travées réparties sur la longueur, une par étage de 2,8 m, au-dessus de 0,9 m.
    const bays = max(facade.y, float(0.0001));
    const local = fract(u.div(facade.x).mul(bays));
    const bayW = facade.x.div(bays);
    const bayIdx = floor(u.div(facade.x).mul(bays));
    const wx = local.sub(0.5).mul(bayW); // mètres depuis l'axe de la travée
    const floorIdx = floor(v.sub(0.9).div(2.8));
    const floorY = fract(v.sub(0.9).div(2.8));
    const fy = floorY.mul(2.8); // mètres au-dessus de l'allège
    // Porte d'entrée (style local) : dans la travée tirée du mur côté rue, au rez-de-chaussée.
    const doorBay = bstyle.w;
    const isDoorBay = step(float(0.5), doorBay).mul(step(abs(bayIdx.add(1).sub(doorBay)), float(0.5)));
    // Style local : travées irrégulières (environ une baie sur cinq murée), fenêtres plus étroites sur la pierre.
    const skip = step(hash(bayIdx.mul(3.7).add(floorIdx.mul(11.3)).add(facade.x.mul(1.37))), float(0.2)).mul(isLocal);
    const halfW = mix(float(0.5), float(0.4), isLocal.mul(isStone));
    // binfo.z : 0 mur aveugle, 1 fenêtres, 2 annexe (grande porte en bois sur un mur sur deux)
    const hasWin = step(float(0.5), facade.y)
      .mul(step(float(0.5), info.z))
      .mul(step(info.z, float(1.5)))
      .mul(step(0.9, v))
      .mul(float(1).sub(skip))
      .mul(float(1).sub(isDoorBay.mul(step(floorIdx, float(0.5)))))
      // pas de fenêtre dans la génoise
      .mul(max(step(v, wallH.sub(bstyle.z.mul(0.5))), step(isLocal, float(0.5))));
    const inWin = step(abs(wx), halfW).mul(step(fy, float(1.35))).mul(hasWin);
    // Encadrements : 8 cm (Île-de-France) ou 16 cm de pierre claire (style local) ; appui saillant ombré dessous.
    const fm = mix(float(0.08), float(0.16), isLocal);
    const inFrame = step(abs(wx), halfW.add(fm)).mul(step(fy, float(1.35).add(fm))).mul(step(fm.negate(), fy)).mul(hasWin);
    const underSill = step(abs(wx), halfW.add(fm)).mul(step(fm.negate().sub(0.07), fy)).mul(step(fy, fm.negate())).mul(hasWin).mul(isLocal);
    const shutterX = abs(wx);
    const inShutter = step(halfW.add(fm).add(0.02), shutterX).mul(step(shutterX, halfW.mul(2).add(fm).add(0.02))).mul(step(fy, float(1.38))).mul(hasWin);
    // Lames des volets.
    const slats = fract(fy.mul(9)).mul(0.25).add(0.8);
    // Environ une fenêtre sur deux allumée la nuit (bruit par pièce).
    const lit = step(0.0, mx_noise_float(floor(positionWorld.mul(0.3)).add(0.37))).mul(this.night);
    const glass = mix(vec3(0.1, 0.12, 0.14).add(normalWorld.y.mul(0)), vec3(1.0, 0.74, 0.42), lit);
    // Reflet du ciel dans les vitres (haut plus clair).
    const glassSky = glass.add(vec3(0.12, 0.15, 0.18).mul(fy.div(1.35)).mul(float(1).sub(lit)));
    wall = mix(wall, accent.mul(slats), inShutter.mul(float(1).sub(inWin)));
    wall = mix(wall, mix(vec3(0.93, 0.92, 0.88), lightStone, isLocal), inFrame.mul(float(1).sub(inWin)));
    wall = mix(wall, wall.mul(0.55), underSill);
    wall = mix(wall, glassSky, inWin);
    // Embrasure : la vitre est en retrait de 15 cm ; le linteau et un tableau portent leur ombre sur
    // le haut et le côté de la baie, l'appui est éclairé.
    const reveal = max(step(float(1.35).sub(0.12), fy), step(wx, halfW.negate().add(0.09))).mul(inWin);
    wall = mix(wall, wall.mul(0.45), reveal.mul(isLocal.mul(0.6).add(0.4)));
    const outline = step(abs(wx), halfW.add(fm)).mul(step(halfW.add(fm).sub(0.025), abs(wx))).max(step(float(1.35).add(fm).sub(0.025), fy).mul(step(fy, float(1.35).add(fm))).mul(step(abs(wx), halfW.add(fm))));
    wall = mix(wall, wall.mul(0.7), outline.mul(inFrame).mul(isLocal));
    // Porte d'entrée : bois à panneaux (couleur des volets, plus sombre), imposte vitrée, encadrement de pierre.
    const fdW = float(0.55);
    const frontOk = isDoorBay.mul(isWall).mul(step(float(0.5), facade.y));
    const inFront = step(abs(wx), fdW).mul(step(v, float(2.25))).mul(frontOk);
    const inFrontFrame = step(abs(wx), fdW.add(0.16)).mul(step(v, float(2.41))).mul(frontOk).mul(float(1).sub(inFront));
    const panel = step(0.06, abs(fract(v.div(0.55)).sub(0.5))).mul(step(abs(abs(wx).sub(fdW.mul(0.5))), fdW.mul(0.38)));
    const transom = step(float(1.95), v);
    const frontWood = accent.mul(0.6).mul(mix(float(0.8), float(1), panel));
    wall = mix(wall, lightStone, inFrontFrame);
    wall = mix(wall, mix(frontWood, glassSky, transom), inFront);
    // Porte de grange / garage : planches verticales, encadrement sombre, position tirée par mur.
    const wallSeed = hash(floor(facade.x.mul(7.31)));
    const hasDoor = step(float(1.5), info.z).mul(step(float(3.2), facade.x)).mul(step(float(0.45), wallSeed));
    const doorW = mix(float(1.1), float(2.8), step(float(6), facade.x));
    const doorC = facade.x.mul(wallSeed.mul(0.4).add(0.3));
    const doorH = min(float(2.7), facade.x.mul(0.6));
    const dx = abs(u.sub(doorC));
    // Style local, pierre : porte charretière en anse de panier, claveaux de pierre claire.
    const arch = isLocal.mul(isStone);
    const rr = dx.div(doorW.mul(0.5)).min(1);
    const archTop = doorH.sub(arch.mul(0.55).mul(float(1).sub(float(1).sub(rr.mul(rr)).max(0).sqrt())));
    const inDoor = step(dx, doorW.mul(0.5)).mul(step(v, archTop)).mul(hasDoor);
    const inDoorFrame = step(dx, doorW.mul(0.5).add(mix(float(0.1), float(0.28), arch))).mul(step(v, archTop.add(mix(float(0.1), float(0.3), arch)))).mul(hasDoor);
    const planks = fract(u.div(0.16)).mul(0.25).add(0.75).mul(mx_noise_float(vec2(u.mul(3), v.mul(0.2))).mul(0.15).add(0.9));
    wall = mix(wall, mix(vec3(0.12, 0.09, 0.07), lightStone, arch), inDoorFrame);
    wall = mix(wall, accent.mul(0.55).add(vec3(0.12, 0.08, 0.04)).mul(planks), inDoor);
    // Génoise (style local, murs d'égout) : trois rangs de tuiles canal en encorbellement sous le toit,
    // bouts arrondis en terre cuite, mortier de chaux entre les rangs.
    const gz = bstyle.z.mul(isWall).mul(step(wallH.sub(0.45), v)).mul(step(v, wallH.add(0.05)));
    const gd = wallH.sub(v);
    const row = floor(gd.div(0.14));
    const gx = fract(u.div(0.2).add(row.mul(0.5)));
    const tileEnd = float(1).sub(gx.sub(0.5).mul(2).pow(2)).max(0).sqrt();
    const rowY = fract(gd.div(0.14));
    const inTileEnd = step(rowY, tileEnd.mul(0.75).add(0.12));
    const terracotta = vec3(0.5, 0.22, 0.11).mul(tileEnd.mul(0.4).add(0.65)).mul(rowY.mul(0.3).add(0.75));
    const genoise = mix(vec3(0.62, 0.58, 0.5).mul(0.7), terracotta, inTileEnd).mul(mix(float(0.55), float(1), smoothstep(0.0, 0.05, rowY)));
    wall = mix(wall, genoise, gz);

    // ── Toits : tuiles en terre cuite et ardoise (textures photo), mousse par endroits ──
    const roofUv = (size: number) => vec2(u, v).div(size);
    const moss = smoothstep(0.6, 0.9, mx_noise_float(positionWorld.mul(0.5))).mul(0.3);
    const tileTex = T.tiles.map.sample(roofUv(3.2)).rgb;
    // Tuile plate : chaque tuile (≈ 17 × 10,5 cm visibles, rangs décalés) a sa propre cuisson,
    // plus quelques plaques de tuiles de remplacement plus claires et des lichens jaunes.
    const tileRow = floor(v.div(0.105));
    const tcell = floor(vec2(u.div(0.17).add(tileRow.mul(0.5)), tileRow));
    const th = hash(tcell.x.add(5000).mul(1000).add(tcell.y.add(500)));
    const patch = smoothstep(0.55, 0.75, mx_noise_float(positionWorld.mul(0.22)));
    const lichenY = smoothstep(0.7, 0.85, mx_noise_float(positionWorld.mul(1.7))).mul(0.35);
    const tileVar = th.mul(0.24).add(0.88).mul(mix(float(1), float(1.12), patch));
    const tilesIdf = mix(tileTex.mul(base.div(vec3(0.33, 0.13, 0.08)).clamp(0.7, 1.3)).mul(tileVar), vec3(0.62, 0.58, 0.3), lichenY);
    // Tuiles vieillies (BD TOPO, binfo.y = 1 sur le toit) : seule la luminance de la photo (relief des
    // tuiles, moyenne 0,048 en linéaire) est gardée, teintée par une terre cuite passée mesurée sur
    // l'orthophoto (rose saumon peu saturé), avec lichens gris par plaques.
    const tileLum = tileTex.dot(vec3(0.2126, 0.7152, 0.0722)).div(0.048).clamp(0.45, 1.5);
    const lichen = smoothstep(0.45, 0.8, mx_noise_float(positionWorld.mul(0.9).add(3))).mul(0.25);
    const weathered = mix(base.mul(tileLum).mul(tileVar), vec3(0.32, 0.31, 0.28).mul(tileLum), lichen);
    const tiles = mix(mix(tilesIdf, weathered, step(float(0.5), info.y)), vec3(0.3, 0.33, 0.18), moss);
    const slate = T.slate.map.sample(roofUv(1.5)).rgb;
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
    const nrm = (t: LazyTexture, size: number) => t.sample(vec2(u, v).div(size)).rgb;
    const wallN = nrm(T.render.normal, 2.0)
      .mul(isRender)
      .add(meul.normalTS.mul(0.5).add(0.5).mul(isStone))
      .add(nrm(T.brick.normal, 2.0).mul(isBrick))
      .add(nrm(T.stone.normal, 2.3).mul(isRubble));
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
      // Sol affiché sous l'emprise : la hauteur des données part du point bas (`y`), mais en pente le
      // côté amont est plus haut et y enterrait les murs.
      let groundLo = Infinity;
      let groundHi = -Infinity;
      for (let i = 0; i < bld.pts.length; i += 2) {
        const g = this.groundAt(bld.pts[i] as number, bld.pts[i + 1] as number);
        if (!Number.isFinite(g)) continue;
        groundLo = Math.min(groundLo, g);
        groundHi = Math.max(groundHi, g);
      }
      let base = Math.min(bld.y ?? Infinity, groundLo);
      if (!Number.isFinite(base)) continue;
      const rise = Number.isFinite(groundHi) ? Math.min(groundHi - base, 8) : 0;
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
      // Égout au moins à hauteur d'étage au-dessus du sol amont : hauteurs LiDAR / BD TOPO souvent basses
      // (≈ 2 m pour un plain-pied) : 2,7 m au rez-de-chaussée, 2,6 m par niveau en plus, plafonné à trois niveaux et à 1,25 × la hauteur
      // mesurée (nombre d'étages parfois incohérent : « 11 étages » pour 14 m).
      const levels = Math.min(Math.max(Math.round(bld.levels ?? 1), 1), 3);
      const minEave = isUtility || isChurch ? 2.4 : Math.max(2.7, Math.min(2.7 + (levels - 1) * 2.6, total * 1.25));
      const wallH = Math.max(total - roofH, minEave + rise);
      const wallTop = base + wallH + 0.3;
      // Emprise pour la collision de la caméra (prisme toit compris ; le clocher dépasse, sans gêne).
      this.footprints.add(tile.id, bld.pts, base, wallTop + roofH);
      // Matériau de façade : connu (BD TOPO, OSM) sinon tiré au sort (meulière ≈ 45 % hors annexes), ou couleur OSM.
      const stones = !bld.colour && (bld.material === 'stone' || (!bld.material && !isUtility && r() < 0.45));
      const brick = bld.material === 'brick';
      const wallColour = osmColour(
        bld.colour,
        stones ? ((bld.bdtopo ? STONE_LOCAL : MEULIERE)[Math.floor(r() * (bld.bdtopo ? STONE_LOCAL : MEULIERE).length)] as string) : brick ? BRICK : bld.material === 'concrete' ? '#cfcac0' : bld.material === 'wood' ? '#7a5a3e' : ((bld.bdtopo ? RENDERS_LOCAL : RENDERS)[Math.floor(r() * (bld.bdtopo ? RENDERS_LOCAL : RENDERS).length)] as string),
      );
      acc.set((bld.bdtopo ? SHUTTERS_LOCAL : SHUTTERS)[Math.floor(r() * (bld.bdtopo ? SHUTTERS_LOCAL : SHUTTERS).length)] as string);
      // Monopente : haut des murs sur le plan du toit (pente selon la largeur, ou la longueur si faîtage court).
      const slopeU = !!bld.ridgeShort;
      const sx = slopeU ? box.ux : -box.uz;
      const sz = slopeU ? box.uz : box.ux;
      const half = slopeU ? box.hl : box.hw;
      const roofAt = (x: number, z: number) => wallTop + ((((x - box.cx) * sx + (z - box.cz) * sz) / half + 1) / 2) * roofH;
      // Style local (BD TOPO) : génoise sous les égouts des toits de tuiles, porte d'entrée côté rue.
      let style: WallStyle | undefined;
      if (bld.bdtopo) {
        style = { local: true, doorPick: r() };
        const housing = !isUtility && !isChurch;
        if (housing && plan && !metal && roofMat !== 'slate') {
          // croupes : tous les murs sont des égouts ; deux pans : seulement les murs parallèles au faîtage
          const rx = bld.ridgeShort ? -box.uz : box.ux;
          const rz = bld.ridgeShort ? box.ux : box.uz;
          const hipped = HIPPED.has(shape);
          style.eave = (dx, dz) => hipped || Math.abs(dx * rx + dz * rz) / Math.hypot(dx, dz) > 0.7;
        }
        if (housing) {
          const door = streetWall(bld.pts, tile.features.roads);
          if (door) style.door = door;
        }
      }
      const w = skillion ? slopedWalls(bld.pts, base, (x, z) => roofAt(x, z) - base) : walls(bld.pts, base, wallH + 0.3, style);
      // Granges, fermes et églises : enduit à pierres vues plutôt que meulière ou enduit lisse.
      const rubble = !stones && !brick && !bld.colour && (bld.kind === 'barn' || bld.kind === 'farm' || isChurch) && r() < 0.7;
      const wallType = stones ? 1 : rubble ? 3 : brick ? 2 : 0;
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
        paint(roof, c.set(roofColour), roofKind, acc, bld.bdtopo && roofKind === 1 ? 1 : 0, 0);
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
    this.footprints.removeTile(tile.id);
    const m = this.tiles.get(tile.id);
    if (!m) return;
    this.group.remove(m);
    m.geometry.dispose();
    this.tiles.delete(tile.id);
  }
}
