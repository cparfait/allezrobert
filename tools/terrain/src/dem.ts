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

export const LAYER_LIDAR = 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93';
export const LAYER_RGEALTI = 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES';
const WMS = 'https://data.geopf.fr/wms-r';

const NODATA_BELOW = -1000;

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
  stats = { downloaded: 0, fromCache: 0, filledFromRgeAlti: 0 };

  constructor(label: string, res: number, blockSize: number, maxBlocks = 220) {
    this.label = label;
    this.res = res;
    this.blockSize = blockSize;
    this.samples = Math.round(blockSize / res) + 1;
    this.maxBlocks = maxBlocks;
  }

  /** Fichier fusionné (LiDAR + repli) d'un bloc. */
  private mergedFile(bx: number, by: number): string {
    return cachePath(`dem/${this.label}-${this.res}m`, `${bx}_${by}`, '.f32');
  }

  private async fetchLayer(layer: string, bx: number, by: number): Promise<Float32Array> {
    const n = this.samples;
    const r = this.res;
    const x0 = bx * this.blockSize;
    const yTop = (by + 1) * this.blockSize;
    const url = wmsUrl(layer, x0 - r / 2, yTop - (n - 0.5) * r, x0 + (n - 0.5) * r, yTop + r / 2, n, n);
    // seul le bloc fusionné est conservé en cache (évite de doubler l'espace disque)
    const buf = await fetchWithRetry(url, {
      timeoutMs: 180000,
      validate: (b, ct) => (b.length === n * n * 4 ? null : `taille ${b.length} (${ct}) : ${b.subarray(0, 120).toString()}`),
    });
    const out = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) out[i] = buf.readFloatLE(i * 4);
    return out;
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
    const merged = this.mergedFile(bx, by);
    if (fs.existsSync(merged)) {
      this.stats.fromCache++;
      return;
    }
    const lidar = await this.fetchLayer(LAYER_LIDAR, bx, by);
    let nodata = 0;
    for (const v of lidar) if (!(v > NODATA_BELOW)) nodata++;
    if (nodata > 0) {
      const alti = await this.fetchLayer(LAYER_RGEALTI, bx, by);
      for (let i = 0; i < lidar.length; i++) if (!((lidar[i] ?? NaN) > NODATA_BELOW)) lidar[i] = alti[i] ?? NaN;
      this.stats.filledFromRgeAlti += nodata;
    }
    fs.writeFileSync(merged, Buffer.from(lidar.buffer, lidar.byteOffset, lidar.byteLength));
    this.stats.downloaded++;
    this.missing.delete(`${bx}_${by}`);
  }

  hasBlock(bx: number, by: number): boolean {
    const k = `${bx}_${by}`;
    if (this.blocks.has(k)) return true;
    if (this.missing.has(k)) return false;
    const ok = fs.existsSync(this.mergedFile(bx, by));
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
    const buf = fs.readFileSync(this.mergedFile(bx, by));
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
    const bx = Math.floor(e / S);
    const by = Math.floor(n / S);
    const data = this.block(bx, by);
    if (!data) return NaN;
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
