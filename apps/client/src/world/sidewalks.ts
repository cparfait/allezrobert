import type { LoadedTile, TileRoad } from './types.ts';
import { insidePolygon } from './footprints.ts';

const CELL = 16;
const key = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

/** Murs à vitrine : [ax, az, bx, bz, hauteur du rez-de-chaussée] (Buildings.shopWalls). */
export const SHOP_WALL_STRIDE = 5;

/** Hauteur de la bordure (m) et largeur de sa pierre (m). */
export const CURB_H = 0.12;
export const CURB_W = 0.18;
/** Largeur maximale cherchée jusqu'au mur, et largeur d'un trottoir sans mur en face (m). */
const REACH_M = 5;
const OPEN_WIDTH_M = 2.2;
/**
 * Trottoir sans mur atteint : seulement s'il y a un bâtiment de ce côté-ci à moins de ce rayon (jardinet, cour).
 * Sinon (champ, talus, bâtiment seulement en face), pas de trottoir : il flottait en dalle au milieu des prés.
 */
const OPEN_REACH_M = 14;
/** Largeur maximale d'un trottoir depuis le bord du ruban (m) : jusqu'au mur, qu'il dépasse de 30 cm. Le terrain
 *  est remblayé jusque-là en ville (terrain.ts), sinon la dalle dominait le sol d'un village à flanc de pente. */
export const SIDEWALK_MAX_M = REACH_M + 0.5;

/** Cases de 16 m qui touchent un bâtiment (rectangle englobant) : « en ville » à une case près (`isBuiltUp`). */
export function builtCells(buildings: ReadonlyArray<{ pts: ArrayLike<number> }>): Set<number> {
  const out = new Set<number>();
  for (const b of buildings) {
    if (b.pts.length < 6) continue;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i + 1 < b.pts.length; i += 2) {
      minX = Math.min(minX, b.pts[i] as number);
      maxX = Math.max(maxX, b.pts[i] as number);
      minZ = Math.min(minZ, b.pts[i + 1] as number);
      maxZ = Math.max(maxZ, b.pts[i + 1] as number);
    }
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) out.add(key(cx, cz));
  }
  return out;
}

/** Bâtiment à moins de 16 à 32 m (même règle que `StreetIndex.urban`, qui décide des trottoirs). */
export function isBuiltUp(cells: ReadonlySet<number>, x: number, z: number): boolean {
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (cells.has(key(cx + dx, cz + dz))) return true;
  return false;
}

/** Marge au bord de chaussée d'une autre voie (m) : égale à l'accotement du ruban, moins un rien. */
const ROAD_MARGIN = 0.55;

interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
}

/**
 * Ce qui borde une rue dans une tuile : bâtiments et chaussées, dans une grille. Répond à « est-on en ville ? »,
 * « dans un bâtiment ? », « sur une chaussée ? ». Les voies des tuiles voisines ne sont pas connues : au bord
 * d'une tuile, un trottoir peut déborder un peu sur une voie qui n'y figure pas.
 */
export class StreetIndex {
  private readonly buildings = new Map<number, ArrayLike<number>[]>();
  private readonly segments = new Map<number, Seg[]>();
  private readonly shops = new Map<number, number[]>();
  /** Ce qui a arrêté le dernier `clearWidth` : un mur, une autre chaussée, rien (largeur par défaut) ou pas de place. */
  hit: 'wall' | 'road' | 'open' | 'none' = 'none';

  /** `shopWalls` : murs à vitrine de la tuile, SHOP_WALL_STRIDE nombres chacun (voir Buildings.shopWalls). */
  constructor(tile: LoadedTile, roads: readonly TileRoad[], shopWalls: readonly number[] = []) {
    for (let i = 0; i + SHOP_WALL_STRIDE - 1 < shopWalls.length; i += SHOP_WALL_STRIDE) {
      const ax = shopWalls[i] as number;
      const az = shopWalls[i + 1] as number;
      const bx = shopWalls[i + 2] as number;
      const bz = shopWalls[i + 3] as number;
      for (let cx = Math.floor((Math.min(ax, bx) - 1) / CELL); cx <= Math.floor((Math.max(ax, bx) + 1) / CELL); cx++)
        for (let cz = Math.floor((Math.min(az, bz) - 1) / CELL); cz <= Math.floor((Math.max(az, bz) + 1) / CELL); cz++) {
          const k = key(cx, cz);
          const list = this.shops.get(k);
          if (list) list.push(i);
          else this.shops.set(k, [i]);
        }
    }
    this.shopWalls = shopWalls;
    for (const b of tile.features.buildings) {
      if (b.pts.length < 6) continue;
      let minX = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i + 1 < b.pts.length; i += 2) {
        minX = Math.min(minX, b.pts[i] as number);
        maxX = Math.max(maxX, b.pts[i] as number);
        minZ = Math.min(minZ, b.pts[i + 1] as number);
        maxZ = Math.max(maxZ, b.pts[i + 1] as number);
      }
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
        for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
          const k = key(cx, cz);
          const list = this.buildings.get(k);
          if (list) list.push(b.pts);
          else this.buildings.set(k, [b.pts]);
        }
    }
    for (const r of roads) {
      const p = r.pts3;
      if (!p || p.length < 6) continue;
      const half = Math.max(r.width, 2.5) / 2;
      const reach = half + 1.5;
      for (let i = 0; i + 5 < p.length; i += 3) {
        const s: Seg = { ax: p[i] as number, az: p[i + 2] as number, bx: p[i + 3] as number, bz: p[i + 5] as number, half };
        for (let cx = Math.floor((Math.min(s.ax, s.bx) - reach) / CELL); cx <= Math.floor((Math.max(s.ax, s.bx) + reach) / CELL); cx++)
          for (let cz = Math.floor((Math.min(s.az, s.bz) - reach) / CELL); cz <= Math.floor((Math.max(s.az, s.bz) + reach) / CELL); cz++) {
            const k = key(cx, cz);
            const list = this.segments.get(k);
            if (list) list.push(s);
            else this.segments.set(k, [s]);
          }
      }
    }
  }

  /** Nombre de bâtiments dont l'emprise touche les 3 × 3 cases autour du point (48 m) : bourg dense ou non. */
  density(x: number, z: number): number {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const seen = new Set<ArrayLike<number>>();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const b of this.buildings.get(key(cx + dx, cz + dz)) ?? []) seen.add(b);
    return seen.size;
  }

  /** Bâtiment à moins de 16 à 32 m : on est en ville. Pas de trottoir ni de lampadaire en rase campagne. */
  urban(x: number, z: number): boolean {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (this.buildings.has(key(cx + dx, cz + dz))) return true;
    return false;
  }

  private readonly shopWalls: readonly number[];

  /** Mur à vitrine à moins de `r` m de (x, z). */
  shopNear(x: number, z: number, r = 0.8): boolean {
    const list = this.shops.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return false;
    const W = this.shopWalls;
    for (const i of list) {
      const ax = W[i] as number;
      const az = W[i + 1] as number;
      const dx = (W[i + 2] as number) - ax;
      const dz = (W[i + 3] as number) - az;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      if ((x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2 < r * r) return true;
    }
    return false;
  }

  inBuilding(x: number, z: number): boolean {
    const list = this.buildings.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    return !!list && list.some((p) => insidePolygon(p, x, z));
  }

  /**
   * Sur la chaussée d'une voie qui croise la direction (dx, dz) : carrefour. Les voies presque parallèles (la rue
   * elle-même, son prolongement, une chaussée jumelle) ne comptent pas.
   */
  crossRoad(x: number, z: number, dx: number, dz: number, margin = 0): boolean {
    const list = this.segments.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return false;
    const dl = Math.hypot(dx, dz) || 1;
    for (const s of list) {
      const sx = s.bx - s.ax;
      const sz = s.bz - s.az;
      const l2 = sx * sx + sz * sz;
      if (!(l2 > 0)) continue;
      if (Math.abs((sx * dx + sz * dz) / (Math.sqrt(l2) * dl)) > 0.8) continue;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * sx + (z - s.az) * sz) / l2));
      const ex = x - s.ax - t * sx;
      const ez = z - s.az - t * sz;
      if (ex * ex + ez * ez < (s.half + margin) ** 2) return true;
    }
    return false;
  }

  /** Sur la chaussée d'une voie (accotement compris, plus `margin`). */
  onRoad(x: number, z: number, margin = ROAD_MARGIN): boolean {
    const list = this.segments.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return false;
    for (const s of list) {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2)) : 0;
      const r = s.half + margin;
      const ex = x - s.ax - t * dx;
      const ez = z - s.az - t * dz;
      if (ex * ex + ez * ez < r * r) return true;
    }
    return false;
  }

  /**
   * Largeur de trottoir depuis (x, z), bord de chaussée, vers (ux, uz) : jusqu'au mur (qu'elle dépasse un peu pour
   * s'y raccorder sans fente), jusqu'à une autre chaussée, ou largeur par défaut si un bâtiment est un peu plus
   * loin de ce côté. 0 s'il n'y a pas la place ou rien de bâti de ce côté.
   */
  clearWidth(x: number, z: number, ux: number, uz: number): number {
    this.hit = 'none';
    if (!this.urban(x, z) || this.onRoad(x, z)) return 0;
    for (let t = 0.25; t <= REACH_M; t += 0.5) {
      const px = x + ux * t;
      const pz = z + uz * t;
      if (this.inBuilding(px, pz)) {
        if (t < 0.7) return 0;
        this.hit = 'wall';
        return t + 0.3;
      }
      if (this.onRoad(px, pz)) {
        if (t < 0.9) return 0;
        this.hit = 'road';
        return t - 0.3;
      }
    }
    for (let t = REACH_M; t <= OPEN_REACH_M; t += 1) {
      if (this.inBuilding(x + ux * t, z + uz * t)) {
        this.hit = 'open';
        return OPEN_WIDTH_M;
      }
    }
    return 0;
  }
}

/** Bords d'un tronçon rééchantillonnés tous les `step` m : largeur des trottoirs et état des lampadaires varient vite. */
export function resampleStrip(left: readonly number[], right: readonly number[], along: readonly number[], step: number): { left: number[]; right: number[]; along: number[] } {
  const L: number[] = [];
  const R: number[] = [];
  const A: number[] = [];
  const n = along.length;
  for (let i = 0; i + 1 < n; i++) {
    const a0 = along[i] as number;
    const a1 = along[i + 1] as number;
    const parts = Math.max(1, Math.ceil(Math.abs(a1 - a0) / step));
    for (let p = 0; p < parts; p++) {
      const f = p / parts;
      for (let c = 0; c < 3; c++) {
        L.push((left[i * 3 + c] as number) + ((left[(i + 1) * 3 + c] as number) - (left[i * 3 + c] as number)) * f);
        R.push((right[i * 3 + c] as number) + ((right[(i + 1) * 3 + c] as number) - (right[i * 3 + c] as number)) * f);
      }
      A.push(a0 + (a1 - a0) * f);
    }
  }
  for (let c = 0; c < 3; c++) {
    L.push(left[(n - 1) * 3 + c] as number);
    R.push(right[(n - 1) * 3 + c] as number);
  }
  A.push(along[n - 1] as number);
  return { left: L, right: R, along: A };
}

/** Sol plus bas que la chaussée de plus de ceci sous un trottoir : talus, le trottoir s'arrête avant (m). */
const BANK_DROP_M = 0.35;

/**
 * Raccourcit un trottoir de largeur `w` (depuis le bord de chaussée (x, y, z) vers (dx, dz)) au premier endroit où
 * le sol affiché passe sous la chaussée de plus de BANK_DROP_M : une dalle posée au niveau de la rue au-dessus d'un
 * talus (rue parallèle en contrebas, flanc de coteau) flottait dans le vide. 0 s'il ne reste pas 0,9 m. Sol inconnu
 * (tuile voisine pas encore chargée) : rien n'est retiré.
 */
export function trimOverBank(w: number, x: number, y: number, z: number, dx: number, dz: number, groundAt: (x: number, z: number) => number): number {
  if (!(w > 0)) return w;
  for (let t = 0.4; t < w + 0.2; t += 0.5) {
    const g = groundAt(x + dx * Math.min(t, w), z + dz * Math.min(t, w));
    if (Number.isFinite(g) && g < y - BANK_DROP_M) {
      const cut = t - 0.4;
      return cut >= 0.9 ? cut : 0;
    }
  }
  return w;
}

/**
 * Supprime les bouts de trottoir trop courts pour être une rue (largeurs mises à 0, en place) : un bâtiment isolé
 * en bord de route en semait quelques mètres, posés seuls dans l'herbe. Un bout qui touche une extrémité du
 * tronçon peut continuer sur le suivant (carrefour) : il garde sa place à partir de `minLen / 2`.
 */
export function dropShortRuns(widths: number[], along: readonly number[], minLen: number): void {
  const n = widths.length;
  let i = 0;
  while (i < n) {
    if (!((widths[i] as number) > 0)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && (widths[j + 1] as number) > 0) j++;
    const len = Math.abs((along[j] as number) - (along[i] as number));
    const atEnd = i === 0 || j === n - 1;
    if (len < (atEnd ? minLen / 2 : minLen)) for (let k = i; k <= j; k++) widths[k] = 0;
    i = j + 1;
  }
}

/** Sortie des trottoirs d'une tuile, ajoutée à la géométrie de la voirie (même matériau, même appel de dessin). */
export interface MeshSink {
  pos: number[];
  uvs: number[];
  info: number[];
  lit: number[];
  /** Décalques de chaussée (roadDecals.ts) : 0 hors décalque. */
  decal: number[];
  dsize: number[];
  /** Trottoir : distance au mur (m, 99 sans mur) et vitrine éclairée la nuit (0 ou 1). */
  side: number[];
  index: number[];
  /** Échantillons de la surface des trottoirs (x, z, y), pour poser les spectateurs dessus (RoadNetwork.walkHeightAt). */
  walk?: number[];
}

/** Ce qui borde un profil de trottoir : mur atteint (ombre à son pied) et vitrine (lumière la nuit). */
export interface EdgeKind {
  wall: boolean;
  shop: boolean;
}

/** Sommets par profil de trottoir : bordure (face, dessus), dalle, face extérieure. */
const STRIDE = 8;

/**
 * Trottoir d'un côté de la voie : face de la bordure, dessus de la bordure, dalle jusqu'au mur. Sommets propres à
 * chaque face (arêtes vives). Il s'arrête net (face verticale au bout) là où un profil n'a plus de largeur.
 * `sign` : −1 à gauche, +1 à droite ; `o` : abscisse transverse du bord de chaussée ; `lamp` : état par profil.
 */
export function pushSidewalk(sink: MeshSink, edge: readonly number[], along: readonly number[], widths: readonly number[], ux: readonly number[], uz: readonly number[], sign: number, o: number, half: number, lamp: readonly number[], groundAt: (x: number, z: number) => number, kinds: readonly EdgeKind[] = [], fall: readonly number[] = []): void {
  const n = along.length;
  const base = sink.pos.length / 3;
  for (let i = 0; i < n; i++) {
    const x = edge[i * 3] as number;
    const y = edge[i * 3 + 1] as number;
    const z = edge[i * 3 + 2] as number;
    const w = widths[i] as number;
    // Bout en biseau (bevelSidewalkEnds) : k = 1 en plein trottoir, près de 0 au bout, où il rejoint la chaussée.
    const k = fall[i] ?? 1;
    const h = w > 0 ? CURB_H * k : 0;
    const c = Math.min(CURB_W, w);
    const dx = (ux[i] as number) * sign;
    const dz = (uz[i] as number) * sign;
    const ox = x + dx * w;
    const oz = z + dz * w;
    // Dalle posée au-dessus du terrain, qui peut monter vers le mur (rue à flanc de butte) ; bornée si la hauteur est absente.
    const g = groundAt(ox, oz);
    const top = y + h;
    const yOuter0 = Number.isFinite(g) && g > top && g - top < 1.5 ? g + 0.02 : top;
    const yOuter = k < 1 ? y + (yOuter0 - y) * k : yOuter0;
    // Terrain plus bas que la dalle (talus, fossé) : une face verticale descend jusqu'à lui, sinon la dalle
    // flottait au-dessus de l'herbe. Bornée à 3 m (hauteur absente ou aberrante).
    const yFoot = Number.isFinite(g) && g < yOuter - 0.02 ? Math.max(g - 0.05, yOuter - 3) : yOuter;
    const a = along[i] as number;
    if (w > 0 && sink.walk) {
      const yc = top;
      sink.walk.push(x + dx * (c + 0.2), z + dz * (c + 0.2), yc + (yOuter - yc) * Math.min(0.2 / Math.max(w - c, 0.2), 1));
      sink.walk.push(x + dx * (c + w) * 0.5, z + dz * (c + w) * 0.5, (yc + yOuter) / 2);
      sink.walk.push(ox, oz, yOuter);
    }
    const profile: Array<[number, number, number, number]> = [
      [x, y, z, o],
      [x, top, z, o],
      [x, top, z, o],
      [x + dx * c, top, z + dz * c, o + c],
      [x + dx * c, top, z + dz * c, o + c],
      [ox, yOuter, oz, o + w],
      [ox, yOuter, oz, o + w],
      [ox, yFoot, oz, o + w],
    ];
    // Distance au pied du mur (le trottoir entre de 30 cm dans le mur pour s'y raccorder).
    const kind = kinds[i];
    const wallAt = o + w - 0.3;
    for (const [px, py, pz, across] of profile) {
      sink.pos.push(px, py, pz);
      sink.uvs.push(sign * across, a);
      sink.info.push(half, 0, 3);
      sink.lit.push(lamp[i] as number);
      sink.decal.push(0, 0, 0, 0);
      sink.dsize.push(0, 0);
      sink.side.push(kind?.wall ? wallAt - across : 99, kind?.shop ? 1 : 0);
    }
  }
  const P = sink.pos;
  // Trois bandes : face de bordure (tournée vers la chaussée), dessus de bordure et dalle (vers le haut).
  const quad = (a: number, b: number, c: number, d: number, wantX: number, wantY: number, wantZ: number) => {
    const ex = (P[b * 3] as number) - (P[a * 3] as number);
    const ey = (P[b * 3 + 1] as number) - (P[a * 3 + 1] as number);
    const ez = (P[b * 3 + 2] as number) - (P[a * 3 + 2] as number);
    const fx = (P[c * 3] as number) - (P[a * 3] as number);
    const fy = (P[c * 3 + 1] as number) - (P[a * 3 + 1] as number);
    const fz = (P[c * 3 + 2] as number) - (P[a * 3 + 2] as number);
    const nx = ey * fz - ez * fy;
    const ny = ez * fx - ex * fz;
    const nz = ex * fy - ey * fx;
    if (nx * wantX + ny * wantY + nz * wantZ >= 0) sink.index.push(a, b, c, b, d, c);
    else sink.index.push(a, c, b, b, c, d);
  };
  const has = (i: number) => (widths[i] as number) > 0;
  for (let i = 0; i + 1 < n; i++) {
    // Seulement entre deux profils qui ont un trottoir : plus de pointe qui mordait sur la chaussée voisine au
    // carrefour (refineSidewalkEnds pose le dernier profil au bord de cette chaussée).
    if (!has(i) || !has(i + 1)) continue;
    const p = base + i * STRIDE;
    const q = p + STRIDE;
    quad(p, p + 1, q, q + 1, -(ux[i] as number) * sign, 0, -(uz[i] as number) * sign);
    quad(p + 2, p + 3, q + 2, q + 3, 0, 1, 0);
    quad(p + 4, p + 5, q + 4, q + 5, 0, 1, 0);
    // Face extérieure (vers le terrain), seulement là où la dalle domine le terrain.
    const drop = (k: number) => (P[(k + 6) * 3 + 1] as number) - (P[(k + 7) * 3 + 1] as number);
    if (drop(p) > 0 || drop(q) > 0) quad(p + 6, p + 7, q + 6, q + 7, (ux[i] as number) * sign, 0, (uz[i] as number) * sign);
  }
  // Bout du trottoir : face verticale (bordure et dalle), tournée vers le carrefour.
  for (let i = 0; i < n; i++) {
    if (!has(i)) continue;
    const startEnd = i === 0 || !has(i - 1);
    const stopEnd = i === n - 1 || !has(i + 1);
    if (!startEnd && !stopEnd) continue;
    const j = startEnd ? Math.min(i + 1, n - 1) : Math.max(i - 1, 0);
    if (j === i) continue;
    // Sens vers l'extérieur du bout : du profil voisin vers celui-ci.
    const fx = (edge[i * 3] as number) - (edge[j * 3] as number);
    const fz = (edge[i * 3 + 2] as number) - (edge[j * 3 + 2] as number);
    const p = base + i * STRIDE;
    const cap = sink.pos.length / 3;
    const foot = Math.min(P[p * 3 + 1] as number, P[(p + 7) * 3 + 1] as number);
    // Copie des sommets de la bordure (pied et haut) et du bord extérieur de la dalle, plus son pied.
    ([0, 1, 5, 5] as const).forEach((k, m) => {
      const src = p + k;
      // Le dernier : bord extérieur de la dalle ramené au niveau de la chaussée (ou du terrain, s'il est plus bas).
      sink.pos.push(P[src * 3] as number, m === 3 ? foot : (P[src * 3 + 1] as number), P[src * 3 + 2] as number);
      sink.uvs.push(sink.uvs[src * 2] as number, sink.uvs[src * 2 + 1] as number);
      sink.info.push(half, 0, 3);
      sink.lit.push(sink.lit[src] as number);
      sink.decal.push(0, 0, 0, 0);
      sink.dsize.push(0, 0);
      sink.side.push(sink.side[src * 2] as number, sink.side[src * 2 + 1] as number);
    });
    quad(cap, cap + 1, cap + 3, cap + 2, fx, 0, fz);
  }
}

/** Trottoir d'un côté : profils, largeurs, bordures, état de la flaque de lumière, sens du travers. */
export interface SideProfiles {
  edge: number[];
  along: number[];
  widths: number[];
  kinds: EdgeKind[];
  lamp: number[];
  ux: number[];
  uz: number[];
  /** Hauteur relative du trottoir par profil (1 : entière, absent : 1), voir bevelSidewalkEnds. */
  fall?: number[];
}

/** Longueur (m) de la rampe d'un bout de trottoir et hauteur relative qui reste à son extrémité (≈ 2 cm de bordure). */
export const BEVEL_M = 0.7;
const BEVEL_END = 0.15;

/**
 * Biseaute les deux bouts de chaque tronçon de trottoir : un profil est ajouté BEVEL_M avant le bout (hauteur
 * entière) et le dernier retombe presque au niveau de la chaussée, au lieu d'une face verticale. Sur un tronçon
 * plus court que la rampe, la pente est simplement plus raide. À appeler après refineSidewalkEnds.
 */
export function bevelSidewalkEnds(sd: SideProfiles): SideProfiles {
  const n = sd.along.length;
  const out: SideProfiles = { edge: [], along: [], widths: [], kinds: [], lamp: [], ux: [], uz: [], fall: [] };
  const none: EdgeKind = { wall: false, shop: false };
  const has = (i: number) => i >= 0 && i < n && (sd.widths[i] as number) > 0;
  const push = (i: number, k: number) => {
    out.edge.push(sd.edge[i * 3] as number, sd.edge[i * 3 + 1] as number, sd.edge[i * 3 + 2] as number);
    out.along.push(sd.along[i] as number);
    out.widths.push(sd.widths[i] as number);
    out.kinds.push(sd.kinds[i] ?? none);
    out.lamp.push(sd.lamp[i] ?? 0);
    out.ux.push(sd.ux[i] as number);
    out.uz.push(sd.uz[i] as number);
    out.fall?.push(k);
  };
  /** Profil intermédiaire à la fraction f du tronçon a → b (largeur et direction interpolées, hauteur entière). */
  const between = (a: number, b: number, f: number) => {
    const lerp = (p: number, q: number) => p + (q - p) * f;
    for (let c = 0; c < 3; c++) out.edge.push(lerp(sd.edge[a * 3 + c] as number, sd.edge[b * 3 + c] as number));
    out.along.push(lerp(sd.along[a] as number, sd.along[b] as number));
    out.widths.push(lerp(sd.widths[a] as number, sd.widths[b] as number));
    out.kinds.push(sd.kinds[a] ?? none);
    out.lamp.push(sd.lamp[a] ?? 0);
    let ux = lerp(sd.ux[a] as number, sd.ux[b] as number);
    let uz = lerp(sd.uz[a] as number, sd.uz[b] as number);
    const l = Math.hypot(ux, uz) || 1;
    ux /= l;
    uz /= l;
    out.ux.push(ux);
    out.uz.push(uz);
    out.fall?.push(1);
  };
  const seg = (a: number, b: number) => Math.abs((sd.along[b] as number) - (sd.along[a] as number));
  for (let i = 0; i < n; i++) {
    const startEnd = has(i) && !has(i - 1) && has(i + 1);
    const stopEnd = has(i) && !has(i + 1) && has(i - 1);
    if (stopEnd && seg(i - 1, i) > BEVEL_M * 1.3) between(i - 1, i, 1 - BEVEL_M / seg(i - 1, i));
    push(i, startEnd || stopEnd ? BEVEL_END : 1);
    if (startEnd && seg(i, i + 1) > BEVEL_M * 1.3) between(i, i + 1, BEVEL_M / seg(i, i + 1));
  }
  return out;
}

/**
 * Ajoute, entre un profil avec trottoir et un profil sans (bord d'une autre chaussée, au carrefour), un profil
 * posé juste avant la limite (recherche par dichotomie, à 10 cm près), pour que le trottoir s'arrête net au bord
 * de la chaussée voisine au lieu de s'amincir en pointe par-dessus. `widthAt` : largeur et bordure en un point.
 */
export function refineSidewalkEnds(sd: SideProfiles, widthAt: (x: number, y: number, z: number, ux: number, uz: number) => { w: number; kind: EdgeKind }): SideProfiles {
  const n = sd.along.length;
  const out: SideProfiles = { edge: [], along: [], widths: [], kinds: [], lamp: [], ux: [], uz: [] };
  const push = (edge: readonly number[], along: number, w: number, kind: EdgeKind, lamp: number, ux: number, uz: number) => {
    out.edge.push(...edge);
    out.along.push(along);
    out.widths.push(w);
    out.kinds.push(kind);
    out.lamp.push(lamp);
    out.ux.push(ux);
    out.uz.push(uz);
  };
  const none: EdgeKind = { wall: false, shop: false };
  for (let i = 0; i < n; i++) {
    push(sd.edge.slice(i * 3, i * 3 + 3), sd.along[i] as number, sd.widths[i] as number, sd.kinds[i] ?? none, sd.lamp[i] ?? 0, sd.ux[i] as number, sd.uz[i] as number);
    if (i + 1 >= n) continue;
    const a = (sd.widths[i] as number) > 0;
    const b = (sd.widths[i + 1] as number) > 0;
    if (a === b) continue;
    const at = (f: number) => {
      const e = [0, 1, 2].map((c) => (sd.edge[i * 3 + c] as number) + ((sd.edge[(i + 1) * 3 + c] as number) - (sd.edge[i * 3 + c] as number)) * f);
      let ux = (sd.ux[i] as number) + ((sd.ux[i + 1] as number) - (sd.ux[i] as number)) * f;
      let uz = (sd.uz[i] as number) + ((sd.uz[i + 1] as number) - (sd.uz[i] as number)) * f;
      const l = Math.hypot(ux, uz) || 1;
      ux /= l;
      uz /= l;
      return { e, ux, uz, along: (sd.along[i] as number) + ((sd.along[i + 1] as number) - (sd.along[i] as number)) * f, ...widthAt(e[0] as number, e[1] as number, e[2] as number, ux, uz) };
    };
    // Dichotomie : `lo` côté trottoir, `hi` côté chaussée voisine.
    let lo = a ? 0 : 1;
    let hi = a ? 1 : 0;
    const len = Math.abs((sd.along[i + 1] as number) - (sd.along[i] as number));
    for (let k = 0; k < 6 && Math.abs(hi - lo) * len > 0.1; k++) {
      const mid = (lo + hi) / 2;
      if (at(mid).w > 0) lo = mid;
      else hi = mid;
    }
    if (lo === (a ? 0 : 1)) continue;
    const p = at(lo);
    if (!(p.w > 0)) continue;
    push(p.e, p.along, p.w, p.kind, (a ? sd.lamp[i] : sd.lamp[i + 1]) ?? 0, p.ux, p.uz);
  }
  return out;
}
