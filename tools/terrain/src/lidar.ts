/**
 * LiDAR HD dérivé (IGN, Licence Ouverte Etalab 2.0) via le WMS-R de la Géoplateforme, à 50 cm :
 * MNH (hauteur au-dessus du sol = MNS − MNT) pour la végétation, MNS (surface) pour les toits.
 * Format image/x-bil;bits=32 (float32 petit-boutiste, ligne 0 = nord), blocs de 500 m en cache.
 *
 * - Arbres : maxima locaux du MNH lissé dans une fenêtre qui grandit avec la hauteur, rayon du
 *   houppier mesuré dans 8 directions (jusqu'à 55 % de la hauteur du sommet ou un creux).
 * - Haies et buissons : cellules de 1,5 m où le MNH reste entre 0,6 et 2,5 m, hors houppiers.
 * - Toits : profils du MNS dans le rectangle orienté de l'emprise → plat, deux pans, croupes ou
 *   monopente, sens du faîtage, hauteurs d'égout et de faîtage.
 */
import { cachePath, fetchCached } from './net.ts';

export const LAYER_MNH = 'IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93';
export const LAYER_MNS = 'IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93';
export const ATTRIBUTION_LIDAR = '© IGN — LiDAR HD MNS / MNH (Licence Ouverte Etalab 2.0)';

const WMS = 'https://data.geopf.fr/wms-r';
const BLOCK_M = 500;
export const LIDAR_RES = 0.5;

/** Raster Lambert-93 : pixel (i, j) centré en (e0 + (i + ½)·res, n0 − (j + ½)·res). */
export interface Raster {
  e0: number;
  n0: number;
  res: number;
  w: number;
  h: number;
  data: Float32Array;
  /** Part des pixels couverts par le LiDAR HD (0–1) : le reste n'est pas encore publié par l'IGN. */
  coverage: number;
}

async function fetchBlock(layer: string, be: number, bn: number): Promise<Float32Array> {
  const px = BLOCK_M / LIDAR_RES;
  const e = be * BLOCK_M;
  const n = bn * BLOCK_M;
  const url = `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=&CRS=EPSG:2154&BBOX=${e},${n},${e + BLOCK_M},${n + BLOCK_M}&WIDTH=${px}&HEIGHT=${px}&FORMAT=image/x-bil;bits=32`;
  const kind = layer === LAYER_MNH ? 'lidar-mnh' : 'lidar-mns';
  const buf = await fetchCached(url, cachePath(kind, `${be}_${bn}`, '.bil'), {
    timeoutMs: 120000,
    retries: 4,
    validate: (b) => (b.length === px * px * 4 ? null : `taille ${b.length} (attendu ${px * px * 4}) : ${b.subarray(0, 120).toString()}`),
  });
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
}

/** Raster d'un rectangle Lambert-93 aligné sur les blocs de 500 m (assemblé depuis le cache). */
export async function fetchRaster(layer: string, eMin: number, nMin: number, eMax: number, nMax: number): Promise<Raster> {
  const b0 = Math.floor(eMin / BLOCK_M);
  const b1 = Math.ceil(eMax / BLOCK_M) - 1;
  const c0 = Math.floor(nMin / BLOCK_M);
  const c1 = Math.ceil(nMax / BLOCK_M) - 1;
  const px = BLOCK_M / LIDAR_RES;
  const w = (b1 - b0 + 1) * px;
  const h = (c1 - c0 + 1) * px;
  const data = new Float32Array(w * h);
  for (let bn = c0; bn <= c1; bn++)
    for (let be = b0; be <= b1; be++) {
      const blk = await fetchBlock(layer, be, bn);
      const ox = (be - b0) * px;
      const oy = (c1 - bn) * px; // ligne 0 = nord
      for (let j = 0; j < px; j++) data.set(blk.subarray(j * px, (j + 1) * px), (oy + j) * w + ox);
    }
  // valeurs d'absence (−99999…) : 0 pour le MNH, NaN pour le MNS
  const empty = layer === LAYER_MNH ? 0 : NaN;
  let missing = 0;
  for (let i = 0; i < data.length; i++)
    if (!(data[i]! > -50 && data[i]! < 5000)) {
      data[i] = empty;
      missing++;
    }
  return { e0: b0 * BLOCK_M, n0: (c1 + 1) * BLOCK_M, res: LIDAR_RES, w, h, data, coverage: 1 - missing / Math.max(1, data.length) };
}

/** Valeur au plus proche pixel (NaN hors raster). */
export function rasterAt(r: Raster, e: number, n: number): number {
  const i = Math.floor((e - r.e0) / r.res);
  const j = Math.floor((r.n0 - n) / r.res);
  if (i < 0 || j < 0 || i >= r.w || j >= r.h) return NaN;
  return r.data[j * r.w + i]!;
}

/** Lissage gaussien séparable [1 4 6 4 1]/16 (σ ≈ 0,5 m à 50 cm). */
function smooth(src: Float32Array, w: number, h: number): Float32Array {
  const k = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let s = 0;
      for (let d = -2; d <= 2; d++) s += k[d + 2]! * src[j * w + Math.min(w - 1, Math.max(0, i + d))]!;
      tmp[j * w + i] = s;
    }
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let s = 0;
      for (let d = -2; d <= 2; d++) s += k[d + 2]! * tmp[Math.min(h - 1, Math.max(0, j + d)) * w + i]!;
      out[j * w + i] = s;
    }
  return out;
}

export interface TreeTop {
  e: number;
  n: number;
  /** Hauteur au-dessus du sol (m). */
  h: number;
  /** Rayon moyen du houppier (m). */
  r: number;
}

export interface Shrub {
  e: number;
  n: number;
  h: number;
}

export interface VegetationResult {
  trees: TreeTop[];
  shrubs: Shrub[];
}

/** Hauteur minimale d'un arbre (m) ; en dessous : haie ou buisson. */
const TREE_MIN_H = 2.5;
const SHRUB_MIN_H = 0.6;
const SHRUB_CELL_M = 1.5;

/**
 * Arbres et buissons d'un MNH, sur le rectangle [eMin, eMax] × [nMin, nMax]. `exclude(e, n)` écarte
 * bâtiments et chaussées (voitures, murs, toits ne deviennent pas des arbres).
 */
export function detectVegetation(mnh: Raster, rect: { eMin: number; nMin: number; eMax: number; nMax: number }, exclude: (e: number, n: number) => boolean): VegetationResult {
  const { w, h, res } = mnh;
  const s = smooth(mnh.data, w, h);
  const i0 = Math.max(0, Math.floor((rect.eMin - mnh.e0) / res));
  const i1 = Math.min(w - 1, Math.ceil((rect.eMax - mnh.e0) / res) - 1);
  const j0 = Math.max(0, Math.floor((mnh.n0 - rect.nMax) / res));
  const j1 = Math.min(h - 1, Math.ceil((mnh.n0 - rect.nMin) / res) - 1);
  const trees: TreeTop[] = [];
  const dirs: Array<[number, number]> = [];
  for (let k = 0; k < 8; k++) dirs.push([Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const v = s[j * w + i]!;
      if (v < TREE_MIN_H) continue;
      // fenêtre de recherche : 1,2 m + 7 % de la hauteur (houppiers plus larges en haut)
      const rad = Math.min(4, Math.max(1.5, 1.2 + 0.07 * v));
      const rp = Math.round(rad / res);
      let top = true;
      for (let dj = -rp; dj <= rp && top; dj++)
        for (let di = -rp; di <= rp; di++) {
          if (di * di + dj * dj > rp * rp || (di === 0 && dj === 0)) continue;
          const x = i + di;
          const y = j + dj;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const u = s[y * w + x]!;
          // égalités : le premier pixel (ordre de balayage) gagne
          if (u > v || (u === v && (dj < 0 || (dj === 0 && di < 0)))) {
            top = false;
            break;
          }
        }
      if (!top) continue;
      const e = mnh.e0 + (i + 0.5) * res;
      const n = mnh.n0 - (j + 0.5) * res;
      if (exclude(e, n)) continue;
      // rayon du houppier : marche dans 8 directions jusqu'à 55 % de la hauteur ou un creux
      let sum = 0;
      for (const [dx, dy] of dirs) {
        let prev = v;
        let dist = 0;
        for (let t = 1; t * res <= 9; t++) {
          const x = Math.round(i + dx * t);
          const y = Math.round(j - dy * t);
          if (x < 0 || y < 0 || x >= w || y >= h) break;
          const u = s[y * w + x]!;
          if (u < 0.55 * v || u > prev + 0.4) break;
          prev = u;
          dist = t * res;
        }
        sum += dist;
      }
      const r = Math.max(0.8, Math.min(9, sum / 8 + res / 2));
      // poteaux, lignes, lampadaires : très haut et très étroit
      if (r < 1.1 && v > 6) continue;
      trees.push({ e, n, h: v, r });
    }
  // cellules de 1,5 m : hauteur max et part couverte de végétation basse (≤ 3,2 m : maïs compris)
  const cell = SHRUB_CELL_M;
  const cw = Math.ceil((rect.eMax - rect.eMin) / cell);
  const ch = Math.ceil((rect.nMax - rect.nMin) / cell);
  const per = Math.round(cell / res);
  const cellMax = new Float32Array(cw * ch);
  const low = new Uint8Array(cw * ch);
  for (let cj = 0; cj < ch; cj++)
    for (let ci = 0; ci < cw; ci++) {
      const pi = Math.floor((rect.eMin + ci * cell - mnh.e0) / res);
      const pj = Math.floor((mnh.n0 - (rect.nMax - cj * cell)) / res);
      let mx = 0;
      let cnt = 0;
      for (let dj = 0; dj < per; dj++)
        for (let di = 0; di < per; di++) {
          const x = pi + di;
          const y = pj + dj;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const u = s[y * w + x]!;
          if (u >= SHRUB_MIN_H) cnt++;
          mx = Math.max(mx, u);
        }
      cellMax[cj * cw + ci] = mx;
      // au moins la moitié de la cellule couverte : végétation basse continue (pas un piquet)
      if (mx >= SHRUB_MIN_H && mx < CROP_MAX_H && cnt >= (per * per) / 2) low[cj * cw + ci] = 1;
    }
  const crop = cropMask(low, cw, ch);
  // maïs, tournesol : des « sommets » de 2,5 à 4 m au milieu d'une culture ne sont pas des arbres
  const inCrop = (t: TreeTop) => {
    const ci = Math.floor((t.e - rect.eMin) / cell);
    const cj = Math.floor((rect.nMax - t.n) / cell);
    return ci >= 0 && cj >= 0 && ci < cw && cj < ch && crop[cj * cw + ci] === 1;
  };
  for (let k = trees.length - 1; k >= 0; k--) if (trees[k]!.h < 4.5 && inCrop(trees[k]!)) trees.splice(k, 1);
  // couverture des houppiers (pour ne pas doubler les arbres par des buissons)
  const covered = new Uint8Array(cw * ch);
  for (const t of trees) {
    const cr = Math.ceil(t.r / cell);
    const ci = Math.floor((t.e - rect.eMin) / cell);
    const cj = Math.floor((rect.nMax - t.n) / cell);
    for (let dj = -cr; dj <= cr; dj++)
      for (let di = -cr; di <= cr; di++) {
        const x = ci + di;
        const y = cj + dj;
        if (x < 0 || y < 0 || x >= cw || y >= ch) continue;
        if ((di * cell) ** 2 + (dj * cell) ** 2 <= t.r * t.r) covered[y * cw + x] = 1;
      }
  }
  const shrubs: Shrub[] = [];
  for (let cj = 0; cj < ch; cj++)
    for (let ci = 0; ci < cw; ci++) {
      const k = cj * cw + ci;
      if (covered[k] || crop[k] || !low[k] || cellMax[k]! >= TREE_MIN_H) continue;
      const e = rect.eMin + (ci + 0.5) * cell;
      const n = rect.nMax - (cj + 0.5) * cell;
      if (exclude(e, n)) continue;
      shrubs.push({ e, n, h: cellMax[k]! });
    }
  return { trees, shrubs };
}

/** Hauteur maximale d'une culture haute (maïs) : au-delà, ce n'est plus une culture. */
const CROP_MAX_H = 3.2;

/**
 * Cultures hautes (maïs, tournesol, colza en fleur) : grandes plages compactes de végétation basse.
 * Une composante connexe de plus de 400 cellules (900 m²) dont plus de 40 % des cellules sont
 * « intérieures » (carré de 5 × 5 cellules entièrement couvert) est une culture ; une haie, longue
 * et étroite, n'a presque pas de cellules intérieures.
 */
function cropMask(low: Uint8Array, cw: number, ch: number): Uint8Array {
  const interior = new Uint8Array(cw * ch);
  for (let j = 2; j < ch - 2; j++)
    for (let i = 2; i < cw - 2; i++) {
      if (!low[j * cw + i]) continue;
      let full = true;
      for (let dj = -2; dj <= 2 && full; dj++) for (let di = -2; di <= 2; di++) if (!low[(j + dj) * cw + i + di]) full = false;
      if (full) interior[j * cw + i] = 1;
    }
  const out = new Uint8Array(cw * ch);
  const seen = new Uint8Array(cw * ch);
  const stack: number[] = [];
  for (let start = 0; start < cw * ch; start++) {
    if (!low[start] || seen[start]) continue;
    const comp: number[] = [];
    let inner = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(k);
      inner += interior[k]!;
      const i = k % cw;
      const j = (k - i) / cw;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const x = i + di;
        const y = j + dj;
        if (x < 0 || y < 0 || x >= cw || y >= ch) continue;
        const kk = y * cw + x;
        if (low[kk] && !seen[kk]) {
          seen[kk] = 1;
          stack.push(kk);
        }
      }
    }
    if (comp.length > 400 && inner / comp.length > 0.4) for (const k of comp) out[k] = 1;
  }
  return out;
}

export type RoofShape = 'flat' | 'gabled' | 'hipped' | 'skillion';

export interface RoofMeasure {
  shape: RoofShape;
  /** Hauteur du faîtage au-dessus du sol (m). */
  ridgeH: number;
  /** Hauteur de l'égout au-dessus du sol (m). */
  eaveH: number;
  /** Faîtage parallèle au grand côté du rectangle orienté (sinon : au petit côté). */
  ridgeAlongLong: boolean;
  /** Échantillons du MNS dans l'emprise. */
  samples: number;
}

/** Rectangle orienté minimal d'une emprise (calipers sur ses arêtes), u selon la grande dimension. */
export function orientedRect(pts: Array<[number, number]>): { cx: number; cy: number; ux: number; uy: number; hl: number; hw: number } {
  let best = { area: Infinity, cx: 0, cy: 0, ux: 1, uy: 0, hl: 0, hw: 0 };
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const a = pts[k]!;
    const b = pts[(k + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of pts) {
      const u = p[0] * ux + p[1] * uy;
      const v = -p[0] * uy + p[1] * ux;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) {
      const um = (u0 + u1) / 2;
      const vm = (v0 + v1) / 2;
      best = { area, cx: um * ux - vm * uy, cy: um * uy + vm * ux, ux, uy, hl: (u1 - u0) / 2, hw: (v1 - v0) / 2 };
    }
  }
  // u selon la grande dimension
  if (best.hw > best.hl) return { cx: best.cx, cy: best.cy, ux: -best.uy, uy: best.ux, hl: best.hw, hw: best.hl };
  return { cx: best.cx, cy: best.cy, ux: best.ux, uy: best.uy, hl: best.hl, hw: best.hw };
}

function pointInRing(e: number, n: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > n !== b[1] > n && e < ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1]!;
};
const quantile = (a: number[], q: number) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

/**
 * Forme du toit mesurée dans le MNS. `ring` : emprise Lambert-93 ; `ground` : altitude du sol.
 * Renvoie null si le LiDAR ne couvre pas assez l'emprise (bâtiment récent, petite annexe).
 */
export function measureRoof(mns: Raster, ring: Array<[number, number]>, ground: number): RoofMeasure | null {
  const ob = orientedRect(ring);
  if (ob.hw < 1.2 || ob.hl < 1.5) return null;
  // échantillons à l'intérieur de l'emprise, à plus de 0,4 m des murs (bord du toit bruité)
  const pts: Array<{ u: number; v: number; z: number }> = [];
  let eMin = Infinity;
  let eMax = -Infinity;
  let nMin = Infinity;
  let nMax = -Infinity;
  for (const p of ring) {
    eMin = Math.min(eMin, p[0]);
    eMax = Math.max(eMax, p[0]);
    nMin = Math.min(nMin, p[1]);
    nMax = Math.max(nMax, p[1]);
  }
  for (let n = nMin + mns.res / 2; n < nMax; n += mns.res)
    for (let e = eMin + mns.res / 2; e < eMax; e += mns.res) {
      if (!pointInRing(e, n, ring)) continue;
      const du = (e - ob.cx) * ob.ux + (n - ob.cy) * ob.uy;
      const dv = -(e - ob.cx) * ob.uy + (n - ob.cy) * ob.ux;
      if (Math.abs(du) > ob.hl - 0.4 || Math.abs(dv) > ob.hw - 0.4) continue;
      const z = rasterAt(mns, e, n);
      if (!Number.isFinite(z)) continue;
      pts.push({ u: du, v: dv, z: z - ground });
    }
  if (pts.length < 12) return null;
  const zs = pts.map((p) => p.z);
  const ridgeH = quantile(zs, 0.95);
  const eaveH = quantile(zs, 0.08);
  if (!(ridgeH > 1.5)) return null;
  const base = { ridgeH, eaveH, samples: pts.length };
  if (ridgeH - eaveH < 0.7) return { shape: 'flat', ...base, ridgeH: median(zs), eaveH: median(zs), ridgeAlongLong: true };
  // pente moyenne |dz/d(axe)| par régression des hauteurs en fonction de la distance à l'axe
  const slopeAcross = (key: 'u' | 'v', half: number, other: 'u' | 'v', otherHalf: number) => {
    // ne garder que la partie centrale dans l'autre direction (loin des croupes éventuelles)
    const sel = pts.filter((p) => Math.abs(p[other]) < otherHalf * 0.5);
    if (sel.length < 8) return 0;
    const xs = sel.map((p) => Math.abs(p[key]) / Math.max(half, 0.1));
    const ys = sel.map((p) => p.z);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxy = 0;
    let sxx = 0;
    for (let k = 0; k < xs.length; k++) {
      sxy += (xs[k]! - mx) * (ys[k]! - my);
      sxx += (xs[k]! - mx) ** 2;
    }
    return sxx > 0 ? -sxy / sxx : 0; // > 0 : le toit descend en s'éloignant de l'axe
  };
  // le toit descend vers les grands côtés (faîtage selon u) ou vers les petits côtés (selon v)
  const dropV = slopeAcross('v', ob.hw, 'u', ob.hl);
  const dropU = slopeAcross('u', ob.hl, 'v', ob.hw);
  const ridgeAlongLong = dropV >= dropU * 0.8;
  // monopente : un côté nettement plus haut que l'autre (corrélation signée, pas |v|)
  const key = ridgeAlongLong ? 'v' : 'u';
  const pos = pts.filter((p) => p[key] > 0.5).map((p) => p.z);
  const neg = pts.filter((p) => p[key] < -0.5).map((p) => p.z);
  const skew = Math.abs(median(pos) - median(neg));
  if (skew > 0.45 * (ridgeH - eaveH)) return { shape: 'skillion', ...base, ridgeAlongLong };
  // croupes : aux extrémités du faîtage, le toit retombe vers l'égout ; pignons : il y reste haut
  const endKey = ridgeAlongLong ? 'u' : 'v';
  const endHalf = ridgeAlongLong ? ob.hl : ob.hw;
  const sideKey = ridgeAlongLong ? 'v' : 'u';
  const ends = pts.filter((p) => Math.abs(p[endKey]) > endHalf - 1.4 && Math.abs(p[sideKey]) < 1.2).map((p) => p.z);
  if (ends.length < 3) return { shape: 'gabled', ...base, ridgeAlongLong };
  const q = (median(ends) - eaveH) / (ridgeH - eaveH);
  return { shape: q > 0.62 ? 'gabled' : 'hipped', ...base, ridgeAlongLong };
}
