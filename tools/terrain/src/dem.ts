/**
 * Modèle numérique de terrain IGN via le WMS-R de la Géoplateforme (format image/x-bil;bits=32 :
 * float32 petit-boutiste, ligne 0 = nord). Source principale : MNT LiDAR HD (50 cm natif),
 * repli RGE ALTI 1 m (ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES) là où le LiDAR n'a pas de valeur.
 *
 * La grille est découpée en blocs alignés sur le quadrillage Lambert-93 : un bloc de côté S
 * à la résolution r contient (S/r + 1)² échantillons, situés exactement aux coordonnées
 * (bx·S + i·r, (by+1)·S − j·r) — les bords sont partagés entre blocs voisins.
 */
import fs from 'node:fs';
import { cachePath, fetchWithRetry } from './net.ts';
import { writeAtomic } from './safe-fs.ts';

/** État d'un bloc fusionné du cache : `n` × `n` altitudes en float32. Un fichier d'une autre taille est tronqué. */
export function cachedBlockState(file: string, n: number): 'ok' | 'missing' | 'truncated' {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return 'missing';
  }
  return size === n * n * 4 ? 'ok' : 'truncated';
}

export const LAYER_LIDAR = 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93';
export const LAYER_RGEALTI = 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES';
const WMS = 'https://data.geopf.fr/wms-r';

/** Altitudes plausibles dans le corridor (le reste = absence de donnée ou bord contaminé). */
const VALID_MIN = -50;
const VALID_MAX = 5000;
/** Fond marin des mondes côtiers (m) : sous la surface de la mer (0 m NGF) que dessine le client. */
export const SEA_FLOOR_M = -6;

let seaMode = false;
/**
 * Monde côtier : un pixel sans valeur ni dans le LiDAR ni dans le RGE ALTI est la mer (fond à
 * SEA_FLOOR_M) au lieu d'être bouché par les terres voisines (falaises prolongées au large).
 */
export function setSeaMode(on: boolean): void {
  seaMode = on;
}

const isValid = (v: number) => v > VALID_MIN && v < VALID_MAX;

/**
 * Masque des pixels invalides : hors plage, puis dilaté de 2 pixels — le service rééchantillonne
 * au bord des zones sans donnée en mélangeant la valeur -99999, d'où des pixels « intermédiaires ».
 */
export function invalidMask(a: Float32Array, n: number): Uint8Array {
  const bad = new Uint8Array(a.length);
  let any = false;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!;
    if (!(v > VALID_MIN && v < VALID_MAX)) {
      bad[i] = 1;
      any = true;
    }
  }
  if (!any) return bad;
  const out = bad.slice();
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      if (!bad[j * n + i]) continue;
      for (let dj = -2; dj <= 2; dj++)
        for (let di = -2; di <= 2; di++) {
          const x = i + di;
          const y = j + dj;
          if (x >= 0 && y >= 0 && x < n && y < n) out[y * n + x] = 1;
        }
    }
  return out;
}

/** Bouche les pixels masqués restants par moyennes successives des voisins valides. */
export function inpaint(a: Float32Array, mask: Uint8Array, n: number): void {
  let remaining = 0;
  for (const m of mask) remaining += m;
  for (let pass = 0; remaining > 0 && pass < 4 * n; pass++) {
    const fill: Array<[number, number]> = [];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        if (!mask[k]) continue;
        let s = 0;
        let c = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const x = i + di;
          const y = j + dj;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const kk = y * n + x;
          if (!mask[kk]) {
            s += a[kk]!;
            c++;
          }
        }
        if (c) fill.push([k, s / c]);
      }
    if (!fill.length) break;
    for (const [k, v] of fill) {
      a[k] = v;
      mask[k] = 0;
    }
    remaining -= fill.length;
  }
}

/** Fondu du recalage du RGE ALTI sur le LiDAR HD, depuis la limite de couverture (m). */
export const SEAM_FADE_M = 150;
/** Marge lue autour d'un bloc pour le recalage (m) : fondu + lissages, pour que deux blocs voisins donnent la même valeur sur leur bord commun. */
export const SEAM_MARGIN_M = 200;

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Moyenne glissante (carré de côté 2r + 1) de `v` là où `w` = 1, NaN là où aucun pixel ne compte. */
function boxMean(v: Float32Array, w: Uint8Array, W: number, r: number): Float32Array {
  const S = new Float64Array((W + 1) * (W + 1));
  const C = new Float64Array((W + 1) * (W + 1));
  for (let j = 0; j < W; j++) {
    let rs = 0;
    let rc = 0;
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (w[k]) {
        rs += v[k]!;
        rc++;
      }
      const o = (j + 1) * (W + 1) + i + 1;
      S[o] = S[o - W - 1]! + rs;
      C[o] = C[o - W - 1]! + rc;
    }
  }
  const out = new Float32Array(W * W);
  for (let j = 0; j < W; j++) {
    const j0 = Math.max(0, j - r);
    const j1 = Math.min(W, j + r + 1);
    for (let i = 0; i < W; i++) {
      const i0 = Math.max(0, i - r);
      const i1 = Math.min(W, i + r + 1);
      const a = j1 * (W + 1) + i1;
      const b = j0 * (W + 1) + i1;
      const c = j1 * (W + 1) + i0;
      const d = j0 * (W + 1) + i0;
      const n = C[a]! - C[b]! - C[c]! + C[d]!;
      out[j * W + i] = n > 0 ? (S[a]! - S[b]! - S[c]! + S[d]!) / n : Number.NaN;
    }
  }
  return out;
}

/**
 * Fusion LiDAR HD + RGE ALTI sans marche à la limite de couverture. Le RGE ALTI diffère du LiDAR de quelques
 * décimètres (jusqu'à 1 à 2 m) : bouché tel quel, il laissait une marche le long de la limite, à travers champs et
 * routes. Ici, l'écart LiDAR − RGE ALTI est mesuré le long de la limite (moyenne locale), reporté sur les pixels
 * bouchés depuis le pixel LiDAR le plus proche, puis effacé en fondu sur `fadeM` mètres, et lissé.
 * `lidar` et `alti` : fenêtre carrée de `W` pixels de `res` mètres. Renvoie la fusion et le masque des pixels
 * restés sans valeur (ni LiDAR ni RGE ALTI) ; `lidar` n'est pas modifié.
 */
export function seamBlend(
  lidar: Float32Array,
  alti: Float32Array,
  W: number,
  res: number,
  fadeM = SEAM_FADE_M,
): { merged: Float32Array; mask: Uint8Array; filled: number; corrected: number; medianOffset: number } {
  const N = W * W;
  const maskL = invalidMask(lidar, W);
  const maskA = invalidMask(alti, W);
  const merged = new Float32Array(lidar);
  const mask = new Uint8Array(N);
  // 1. écart LiDAR − RGE ALTI, moyenné sur ~12 m (bruit, haies, fossés)
  const both = new Uint8Array(N);
  const diff = new Float32Array(N);
  const offs: number[] = [];
  for (let k = 0; k < N; k++)
    if (!maskL[k] && !maskA[k]) {
      both[k] = 1;
      diff[k] = lidar[k]! - alti[k]!;
    }
  const oS = boxMean(diff, both, W, Math.max(2, Math.round(12 / res)));
  // 2. écart du pixel LiDAR le plus proche (chanfrein 1 / √2, deux passes), distance en pixels
  const dist = new Float32Array(N).fill(Infinity);
  const near = new Float32Array(N);
  for (let k = 0; k < N; k++)
    if (!maskL[k] && Number.isFinite(oS[k]!)) {
      dist[k] = 0;
      near[k] = oS[k]!;
    }
  const D2 = Math.SQRT2;
  const relax = (k: number, kk: number, w: number) => {
    const d = dist[kk]! + w;
    if (d < dist[k]!) {
      dist[k] = d;
      near[k] = near[kk]!;
    }
  };
  for (let j = 0; j < W; j++)
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (i > 0) relax(k, k - 1, 1);
      if (j > 0) {
        relax(k, k - W, 1);
        if (i > 0) relax(k, k - W - 1, D2);
        if (i < W - 1) relax(k, k - W + 1, D2);
      }
    }
  for (let j = W - 1; j >= 0; j--)
    for (let i = W - 1; i >= 0; i--) {
      const k = j * W + i;
      if (i < W - 1) relax(k, k + 1, 1);
      if (j < W - 1) {
        relax(k, k + W, 1);
        if (i < W - 1) relax(k, k + W + 1, D2);
        if (i > 0) relax(k, k + W - 1, D2);
      }
    }
  // 3. correction : écart mesuré côté LiDAR, écart du plus proche en fondu côté RGE ALTI ; lissée sur ~10 m
  const corr = new Float32Array(N);
  const any = new Uint8Array(N).fill(1);
  for (let k = 0; k < N; k++) {
    if (!maskL[k]) corr[k] = Number.isFinite(oS[k]!) ? oS[k]! : 0;
    else if (Number.isFinite(dist[k]!)) corr[k] = near[k]! * (1 - smoothstep01((dist[k]! * res) / fadeM));
  }
  const r2 = Math.max(1, Math.round(10 / res));
  const smooth = boxMean(boxMean(corr, any, W, r2), any, W, r2);
  let filled = 0;
  let corrected = 0;
  for (let k = 0; k < N; k++) {
    if (!maskL[k]) continue;
    if (!maskA[k]) {
      const c = smooth[k]!;
      merged[k] = alti[k]! + c;
      filled++;
      if (Math.abs(c) > 0.02) corrected++;
    } else mask[k] = 1;
  }
  for (let k = 0; k < N; k++) if (both[k] && dist[k] === 0 && (k % 97 === 0)) offs.push(diff[k]!);
  offs.sort((a, b) => a - b);
  return { merged, mask, filled, corrected, medianOffset: offs.length ? offs[offs.length >> 1]! : 0 };
}

function wmsUrl(layer: string, xmin: number, ymin: number, xmax: number, ymax: number, w: number, h: number): string {
  return (
    `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&STYLES=&CRS=EPSG:2154` +
    `&BBOX=${xmin},${ymin},${xmax},${ymax}&WIDTH=${w}&HEIGHT=${h}&FORMAT=image/x-bil;bits=32`
  );
}

interface Block {
  data: Float32Array;
  lastUse: number;
}

export class Dem {
  readonly res: number;
  readonly blockSize: number;
  readonly samples: number; // échantillons par côté de bloc
  readonly label: string;
  private blocks = new Map<string, Block>();
  private missing = new Set<string>();
  private maxBlocks: number;
  private useCounter = 0;
  stats = { downloaded: 0, fromCache: 0, filledFromRgeAlti: 0, seamBlocks: 0, seamUniform: 0 };

  constructor(label: string, res: number, blockSize: number, maxBlocks = 220) {
    this.label = label;
    this.res = res;
    this.blockSize = blockSize;
    this.samples = Math.round(blockSize / res) + 1;
    this.maxBlocks = maxBlocks;
  }

  /** Fichier fusionné (LiDAR + repli) d'un bloc. */
  private mergedFile(bx: number, by: number): string {
    return cachePath(`dem/${this.label}-${this.res}m${seaMode ? '-sea' : ''}`, `${bx}_${by}`, '.f32');
  }

  /**
   * Recalage du RGE ALTI sur le LiDAR (`seamBlend`), actif par défaut (TERRAIN_DEM_SEAM=0 pour s'en passer) : blocs refaits dans un dossier à part
   * (`…-seam`), l'ancien cache n'est ni lu pour eux ni modifié. Un bloc dont la fenêtre est entièrement LiDAR (ou
   * entièrement RGE ALTI) n'a pas de limite : un simple marqueur `.same` renvoie à l'ancien fichier.
   */
  readonly seam = process.env.TERRAIN_DEM_SEAM !== '0';

  private seamFile(bx: number, by: number): string {
    return cachePath(`dem/${this.label}-${this.res}m${seaMode ? '-sea' : ''}-seam`, `${bx}_${by}`, '.f32');
  }

  /** Fichier à lire pour un bloc : le bloc recalé s'il existe, sinon l'ancien bloc fusionné. */
  private blockFile(bx: number, by: number): string {
    if (this.seam) {
      const s = this.seamFile(bx, by);
      if (cachedBlockState(s, this.samples) === 'ok') return s;
    }
    return this.mergedFile(bx, by);
  }

  /**
   * Fenêtre de la couche autour du bloc : `margin` pixels de plus de chaque côté, pas de `step` pixels (même treillis
   * que les blocs : deux blocs voisins lisent les mêmes échantillons sur leur partie commune).
   */
  private async fetchWindow(layer: string, bx: number, by: number, margin = 0, step = 1): Promise<{ data: Float32Array; w: number }> {
    const r = this.res;
    const rs = r * step;
    const w = Math.ceil((this.samples - 1 + 2 * margin) / step) + 1;
    const xs = bx * this.blockSize - margin * r;
    const yTop = (by + 1) * this.blockSize + margin * r;
    const url = wmsUrl(layer, xs - rs / 2, yTop - (w - 0.5) * rs, xs + (w - 0.5) * rs, yTop + rs / 2, w, w);
    // seul le bloc fusionné est conservé en cache (évite de doubler l'espace disque)
    const buf = await fetchWithRetry(url, {
      timeoutMs: 180000,
      validate: (b, ct) => (b.length === w * w * 4 ? null : `taille ${b.length} (${ct}) : ${b.subarray(0, 120).toString()}`),
    });
    const data = new Float32Array(w * w);
    for (let i = 0; i < w * w; i++) data[i] = buf.readFloatLE(i * 4);
    return { data, w };
  }

  private async fetchLayer(layer: string, bx: number, by: number): Promise<Float32Array> {
    return (await this.fetchWindow(layer, bx, by)).data;
  }

  /** Bloc recalé (par défaut ; TERRAIN_DEM_SEAM=0 pour l'ancien bloc fusionné). */
  private async ensureSeamBlock(bx: number, by: number): Promise<void> {
    const n = this.samples;
    const sf = this.seamFile(bx, by);
    const marker = sf.replace(/\.f32$/, '.same');
    const merged = this.mergedFile(bx, by);
    if (cachedBlockState(sf, n) === 'ok' || (fs.existsSync(marker) && cachedBlockState(merged, n) === 'ok')) {
      this.stats.fromCache++;
      return;
    }
    const m = Math.ceil(SEAM_MARGIN_M / this.res);
    // Sonde grossière (8 m) de la couverture LiDAR sur la fenêtre : uniforme → pas de limite, ancien bloc gardé.
    const probe = await this.fetchWindow(LAYER_LIDAR, bx, by, m, Math.max(1, Math.round(8 / this.res)));
    let valid = 0;
    for (const v of probe.data) if (isValid(v)) valid++;
    if (valid === 0 || valid === probe.data.length) {
      if (cachedBlockState(merged, n) !== 'ok') await this.ensureMergedBlock(bx, by);
      writeAtomic(marker, Buffer.from('même bloc que sans recalage\n'));
      this.stats.seamUniform++;
      return;
    }
    const L = await this.fetchWindow(LAYER_LIDAR, bx, by, m);
    const A = await this.fetchWindow(LAYER_RGEALTI, bx, by, m);
    const W = L.w;
    const res = seamBlend(L.data, A.data, W, this.res);
    const out = new Float32Array(n * n);
    const mask = new Uint8Array(n * n);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const k = (j + m) * W + i + m;
        let v = res.merged[k]!;
        let bad = res.mask[k]!;
        // vraie absence dans les deux sources : la mer (mondes côtiers)
        if (bad && seaMode && !isValid(L.data[k]!) && !isValid(A.data[k]!)) {
          v = SEA_FLOOR_M;
          bad = 0;
        }
        out[j * n + i] = v;
        mask[j * n + i] = bad;
      }
    inpaint(out, mask, n);
    writeAtomic(sf, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
    this.blocks.delete(`${bx}_${by}`);
    this.stats.downloaded++;
    this.stats.seamBlocks++;
    this.stats.filledFromRgeAlti += res.filled;
    this.missing.delete(`${bx}_${by}`);
  }

  /** Télécharge si besoin les blocs couvrant l'emprise L93 donnée. */
  async ensure(xmin: number, ymin: number, xmax: number, ymax: number): Promise<void> {
    const S = this.blockSize;
    const keys: Array<[number, number]> = [];
    for (let bx = Math.floor(xmin / S); bx <= Math.floor(xmax / S); bx++)
      for (let by = Math.floor(ymin / S); by <= Math.floor(ymax / S); by++) keys.push([bx, by]);
    let done = 0;
    for (const [bx, by] of keys) {
      await this.ensureBlock(bx, by);
      done++;
      if (keys.length > 8 && done % 10 === 0) console.log(`    MNT ${this.label} ${done}/${keys.length}`);
    }
  }

  async ensureBlock(bx: number, by: number): Promise<void> {
    if (this.seam) return this.ensureSeamBlock(bx, by);
    return this.ensureMergedBlock(bx, by);
  }

  private async ensureMergedBlock(bx: number, by: number): Promise<void> {
    const merged = this.mergedFile(bx, by);
    const n = this.samples;
    const state = cachedBlockState(merged, n);
    if (state === 'ok') {
      this.stats.fromCache++;
      return;
    }
    // Bloc tronqué (écriture interrompue, disque plein) : il serait relu comme valide. On le refait.
    if (state === 'truncated') {
      console.log(`    MNT ${this.label} : bloc ${bx}_${by} tronqué dans le cache, retéléchargé`);
      fs.rmSync(merged, { force: true });
      this.blocks.delete(`${bx}_${by}`);
    }
    const lidar = await this.fetchLayer(LAYER_LIDAR, bx, by);
    const mask = invalidMask(lidar, n);
    let nodata = 0;
    for (const m of mask) nodata += m;
    if (nodata > 0) {
      const alti = await this.fetchLayer(LAYER_RGEALTI, bx, by);
      const altiMask = invalidMask(alti, n);
      for (let i = 0; i < lidar.length; i++) {
        if (mask[i] && !altiMask[i]) {
          lidar[i] = alti[i]!;
          mask[i] = 0;
        } else if (mask[i] && seaMode && !isValid(lidar[i]!) && !isValid(alti[i]!)) {
          // vraie absence dans les deux sources (pas un pixel de bord dilaté) : la mer
          lidar[i] = SEA_FLOOR_M;
          mask[i] = 0;
        }
      }
      this.stats.filledFromRgeAlti += nodata;
      inpaint(lidar, mask, n);
    }
    writeAtomic(merged, Buffer.from(lidar.buffer, lidar.byteOffset, lidar.byteLength));
    this.stats.downloaded++;
    this.missing.delete(`${bx}_${by}`);
  }

  hasBlock(bx: number, by: number): boolean {
    const k = `${bx}_${by}`;
    if (this.blocks.has(k)) return true;
    if (this.missing.has(k)) return false;
    const ok = cachedBlockState(this.blockFile(bx, by), this.samples) === 'ok';
    if (!ok) this.missing.add(k);
    return ok;
  }

  private block(bx: number, by: number): Float32Array | null {
    const k = `${bx}_${by}`;
    const b = this.blocks.get(k);
    if (b) {
      b.lastUse = ++this.useCounter;
      return b.data;
    }
    if (!this.hasBlock(bx, by)) return null;
    const buf = fs.readFileSync(this.blockFile(bx, by));
    const data = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    if (this.blocks.size >= this.maxBlocks) {
      let oldK = '';
      let oldU = Infinity;
      for (const [kk, v] of this.blocks) if (v.lastUse < oldU) {
        oldU = v.lastUse;
        oldK = kk;
      }
      this.blocks.delete(oldK);
    }
    this.blocks.set(k, { data, lastUse: ++this.useCounter });
    return data;
  }

  /** Altitude bilinéaire en (E, N) Lambert-93 ; NaN si le bloc n'est pas disponible. */
  sample(e: number, n: number): number {
    const S = this.blockSize;
    let bx = Math.floor(e / S);
    let by = Math.floor(n / S);
    let data = this.block(bx, by);
    if (!data) {
      // point exactement sur un bord partagé : le bloc voisin le contient aussi
      const onX = Math.abs(e - bx * S) < 1e-6;
      const onY = Math.abs(n - by * S) < 1e-6;
      if (onX && (data = this.block(bx - 1, by))) bx -= 1;
      else if (onY && (data = this.block(bx, by - 1))) by -= 1;
      else if (onX && onY && (data = this.block(bx - 1, by - 1))) {
        bx -= 1;
        by -= 1;
      }
      if (!data) return NaN;
    }
    const N = this.samples;
    const fx = (e - bx * S) / this.res;
    const fy = ((by + 1) * S - n) / this.res;
    let i = Math.floor(fx);
    let j = Math.floor(fy);
    if (i >= N - 1) i = N - 2;
    if (j >= N - 1) j = N - 2;
    if (i < 0) i = 0;
    if (j < 0) j = 0;
    const tx = fx - i;
    const ty = fy - j;
    const a = data[j * N + i] ?? NaN;
    const b = data[j * N + i + 1] ?? NaN;
    const c = data[(j + 1) * N + i] ?? NaN;
    const d = data[(j + 1) * N + i + 1] ?? NaN;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }
}

/** Échantillonne le MNT le plus fin disponible (hi puis lo). */
export class DemStack {
  constructor(readonly layers: Dem[]) {}
  sample(e: number, n: number): number {
    for (const d of this.layers) {
      const v = d.sample(e, n);
      if (Number.isFinite(v)) return v;
    }
    return NaN;
  }
}
