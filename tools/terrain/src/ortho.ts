/**
 * Orthophotographies IGN (BD ORTHO®, Licence Ouverte Etalab 2.0) : une image JPEG par tuile, indice de
 * couleur du sol pour le client, et une mosaïque grossière pour le relief lointain. Téléchargées une
 * fois (cache) ; les images publiées sont harmonisées entre tuiles voisines (voir `harmonizeOrthos`).
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { ORIGIN_L93, TILE_SIZE_M, WORLD_ID } from './config.ts';
import { cachePath, fetchCached } from './net.ts';

export const ORTHO_LAYER = 'ORTHOIMAGERY.ORTHOPHOTOS';

/** Monde des requêtes : celui en construction par défaut (config), un autre pour la régénération. */
export interface OrthoWorld {
  id: string;
  originL93: { x: number; y: number };
}
const CURRENT: OrthoWorld = { id: WORLD_ID, originL93: ORIGIN_L93 };

function wmsUrl(xmin: number, ymin: number, xmax: number, ymax: number, px: number): string {
  return (
    `https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${ORTHO_LAYER}&STYLES=&CRS=EPSG:2154` +
    `&BBOX=${xmin},${ymin},${xmax},${ymax}&WIDTH=${px}&HEIGHT=${px}&FORMAT=image/jpeg`
  );
}

const fetchJpeg = (url: string, file: string): Promise<Buffer> =>
  fetchCached(url, file, {
    timeoutMs: 60000,
    retries: 3,
    validate: (b) => (b[0] === 0xff && b[1] === 0xd8 ? null : `pas un JPEG : ${b.subarray(0, 100).toString()}`),
  });

/** Image brute d'une tuile dans le cache (« chevreuse » garde l'emplacement historique). */
export function orthoCacheFile(tx: number, tz: number, px: number, w: OrthoWorld = CURRENT): string {
  return cachePath(w.id === 'chevreuse' ? `ortho-${px}` : `ortho-${px}-${w.id}`, `${tx}_${tz}`, '.jpg');
}

/**
 * Hors de la couverture de l'IGN (pleine mer), le service renvoie une image blanche : la tuile n'a
 * alors pas d'orthophoto (le client y garde l'eau et le sol procédural, sans aplat blanc).
 */
export async function isBlankOrtho(buf: Buffer): Promise<boolean> {
  const { data } = await sharp(buf).greyscale().resize(64, 64, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let white = 0;
  for (const v of data) if (v >= 250) white++;
  return white / data.length > 0.98;
}

export type OrthoResult = 'ok' | 'sea' | 'error';

/** Orthophoto brute d'une tuile, copiée dans `outFile` ; une tuile blanche (mer) n'est pas écrite. */
export async function fetchOrtho(tx: number, tz: number, px: number, outFile: string, w: OrthoWorld = CURRENT): Promise<OrthoResult> {
  const xmin = w.originL93.x + tx * TILE_SIZE_M;
  const ymax = w.originL93.y - tz * TILE_SIZE_M;
  try {
    const buf = await fetchJpeg(wmsUrl(xmin, ymax - TILE_SIZE_M, xmin + TILE_SIZE_M, ymax, px), orthoCacheFile(tx, tz, px, w));
    if (await isBlankOrtho(buf)) {
      fs.rmSync(outFile, { force: true });
      return 'sea';
    }
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, buf);
    return 'ok';
  } catch (err) {
    console.warn(`  ! orthophoto ${tx}_${tz} : ${(err as Error).message.slice(0, 120)}`);
    return 'error';
  }
}

/** Côté (px) de la mosaïque du relief lointain : 4 requêtes de 1 024 px (≈ 30 m/px sur ±30 km). */
const HORIZON_PX = 2048;

/**
 * Mosaïque du relief lointain (grille `writeHorizon`, carré de ±`halfSizeM` autour de l'origine), ligne 0
 * au nord comme les tuiles. Écrite dans `outFile` ; false si une partie manque.
 */
export async function fetchHorizonOrtho(halfSizeM: number, outFile: string, w: OrthoWorld = CURRENT): Promise<boolean> {
  const half = HORIZON_PX / 2;
  const span = halfSizeM;
  const parts: OverlayOptions[] = [];
  try {
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        const xmin = w.originL93.x - halfSizeM + i * span;
        const ymax = w.originL93.y + halfSizeM - j * span;
        const file = cachePath(`ortho-horizon-${w.id}`, `${halfSizeM}_${i}_${j}`, '.jpg');
        const buf = await fetchJpeg(wmsUrl(xmin, ymax - span, xmin + span, ymax, half), file);
        parts.push({ input: buf, left: i * half, top: j * half });
      }
  } catch (err) {
    console.warn(`  ! orthophoto du relief lointain : ${(err as Error).message.slice(0, 120)}`);
    return false;
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await sharp({ create: { width: HORIZON_PX, height: HORIZON_PX, channels: 3, background: '#ffffff' } })
    .composite(parts)
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(outFile);
  return true;
}

// ── Harmonisation entre tuiles voisines ─────────────────────────────────────────────────────────────
//
// L'IGN assemble des campagnes de prises de vue de dates et de lumières différentes (par département,
// par année) : deux tuiles voisines peuvent différer franchement de teinte ou de luminosité. Chaque
// tuile reçoit un gain par canal à chacun de ses quatre coins, interpolé dans la tuile, choisi pour que
// les bandes de part et d'autre de chaque bord se rejoignent. Les écarts très forts (vrai changement de
// paysage le long du bord) comptent peu ; les gains restent proches de 1 en moyenne sur le monde.

/** Largeur (px, à 1 024 px) des bandes de bord comparées. */
const BAND = 16;
/** Gains extrêmes (par canal). */
const GAIN_MIN = 0.75;
const GAIN_MAX = 1.33;

type Rgb = [number, number, number];
/** Coins : nord-ouest, nord-est, sud-ouest, sud-est. */
type Corner = 0 | 1 | 2 | 3;
/** Moyennes des demi-bords : [côté][moitié] ; moitié 0 = côté ouest (N, S) ou nord (E, O). */
interface BorderStats {
  N: [Rgb, Rgb];
  S: [Rgb, Rgb];
  W: [Rgb, Rgb];
  E: [Rgb, Rgb];
}

async function borderStats(file: string): Promise<BorderStats> {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const b = Math.max(2, Math.round((BAND * W) / 1024));
  const mean = (x0: number, y0: number, x1: number, y1: number): Rgb => {
    const s: Rgb = [0, 0, 0];
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const k = (y * W + x) * 3;
        s[0] += data[k] as number;
        s[1] += data[k + 1] as number;
        s[2] += data[k + 2] as number;
      }
    const n = Math.max(1, (x1 - x0) * (y1 - y0));
    return [s[0] / n + 1, s[1] / n + 1, s[2] / n + 1];
  };
  const hw = W >> 1;
  const hh = H >> 1;
  return {
    N: [mean(0, 0, hw, b), mean(hw, 0, W, b)],
    S: [mean(0, H - b, hw, H), mean(hw, H - b, W, H)],
    W: [mean(0, 0, b, hh), mean(0, hh, b, H)],
    E: [mean(W - b, 0, W, hh), mean(W - b, hh, W, H)],
  };
}

/** Contrainte : couleur `a` du coin `ca` de la tuile `ta` ≈ couleur `b` du coin `cb` de `tb`. */
interface Link {
  ta: number;
  ca: Corner;
  tb: number;
  cb: Corner;
  /** log(b) − log(a) par canal. */
  d: Rgb;
  w: number;
}

/** Gains (log, par canal) aux coins de chaque tuile ; tableau [tuile][coin][canal]. */
function solveGains(n: number, links: Link[]): Float64Array {
  const L = new Float64Array(n * 12);
  const idx = (t: number, c: number, ch: number) => t * 12 + c * 3 + ch;
  const byVar: Array<Array<{ link: Link; side: 'a' | 'b' }>> = Array.from({ length: n * 4 }, () => []);
  for (const link of links) {
    byVar[link.ta * 4 + link.ca]?.push({ link, side: 'a' });
    byVar[link.tb * 4 + link.cb]?.push({ link, side: 'b' });
  }
  // Rappel vers 1 (log 0) et cohésion des coins d'une même tuile (pas de dégradé brutal dans la tuile).
  const LAMBDA = 0.05;
  const MU = 0.3;
  const NEIGH: Record<Corner, Corner[]> = { 0: [1, 2], 1: [0, 3], 2: [0, 3], 3: [1, 2] };
  for (let it = 0; it < 300; it++)
    for (let t = 0; t < n; t++)
      for (let c = 0 as Corner; c < 4; c = (c + 1) as Corner)
        for (let ch = 0; ch < 3; ch++) {
          let num = 0;
          let den = LAMBDA;
          for (const { link, side } of byVar[t * 4 + c] as Array<{ link: Link; side: 'a' | 'b' }>) {
            // a·ga = b·gb  ⇔  la = d + lb (a)  ou  lb = la − d (b)
            const other = side === 'a' ? L[idx(link.tb, link.cb, ch)]! + link.d[ch]! : L[idx(link.ta, link.ca, ch)]! - link.d[ch]!;
            num += link.w * other;
            den += link.w;
          }
          for (const k of NEIGH[c]) {
            num += MU * L[idx(t, k, ch)]!;
            den += MU;
          }
          L[idx(t, c, ch)] = num / den;
        }
  // Luminosité d'ensemble inchangée : gain moyen 1 par canal.
  for (let ch = 0; ch < 3; ch++) {
    let s = 0;
    for (let t = 0; t < n; t++) for (let c = 0; c < 4; c++) s += L[idx(t, c, ch)]!;
    const m = s / (n * 4);
    for (let t = 0; t < n; t++) for (let c = 0; c < 4; c++) L[idx(t, c, ch)]! -= m;
  }
  return L;
}

export interface HarmonizeTile {
  id: string;
  tx: number;
  tz: number;
  /** Image brute (cache). */
  raw: string;
  /** Image publiée (réécrite). */
  out: string;
}

/**
 * Harmonise les orthophotos d'un monde : lit les images brutes (`raw`), écrit les images corrigées
 * (`out`). Renvoie l'écart moyen aux bords (0–255) avant et après.
 */
export async function harmonizeOrthos(tiles: HarmonizeTile[], log: (s: string) => void): Promise<{ before: number; after: number }> {
  if (tiles.length < 2) {
    for (const t of tiles) if (t.raw !== t.out) fs.copyFileSync(t.raw, t.out);
    return { before: 0, after: 0 };
  }
  const stats: BorderStats[] = [];
  for (const t of tiles) stats.push(await borderStats(t.raw));
  const at = new Map(tiles.map((t, i) => [`${t.tx}_${t.tz}`, i]));
  const links: Link[] = [];
  const edges: Array<[Rgb, Rgb, number, Corner, number, Corner]> = [];
  const add = (ta: number, ca: Corner, a: Rgb, tb: number, cb: Corner, b: Rgb) => {
    const d: Rgb = [Math.log(b[0] / a[0]), Math.log(b[1] / a[1]), Math.log(b[2] / a[2])];
    // Écart fort (≥ 40 %) : probablement un vrai changement de paysage le long du bord.
    const dm = (Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2])) / 3;
    links.push({ ta, ca, tb, cb, d, w: 1 / (1 + (dm / 0.35) ** 2) });
    edges.push([a, b, ta, ca, tb, cb]);
  };
  tiles.forEach((t, i) => {
    const s = stats[i] as BorderStats;
    const east = at.get(`${t.tx + 1}_${t.tz}`);
    if (east !== undefined) {
      const e = stats[east] as BorderStats;
      add(i, 1, s.E[0], east, 0, e.W[0]);
      add(i, 3, s.E[1], east, 2, e.W[1]);
    }
    // z croît vers le sud : la tuile (tx, tz + 1) est sous celle-ci
    const south = at.get(`${t.tx}_${t.tz + 1}`);
    if (south !== undefined) {
      const so = stats[south] as BorderStats;
      add(i, 2, s.S[0], south, 0, so.N[0]);
      add(i, 3, s.S[1], south, 1, so.N[1]);
    }
  });
  const L = solveGains(tiles.length, links);
  const gain = (t: number, c: number, ch: number) => Math.min(GAIN_MAX, Math.max(GAIN_MIN, Math.exp(L[t * 12 + c * 3 + ch]!)));
  let before = 0;
  let after = 0;
  for (const [a, b, ta, ca, tb, cb] of edges)
    for (let ch = 0; ch < 3; ch++) {
      before += Math.abs(a[ch]! - b[ch]!);
      after += Math.abs(a[ch]! * gain(ta, ca, ch) - b[ch]! * gain(tb, cb, ch));
    }
  const k = Math.max(1, edges.length * 3);

  let rewritten = 0;
  for (let t = 0; t < tiles.length; t++) {
    const tile = tiles[t] as HarmonizeTile;
    let flat = true;
    for (let c = 0; c < 4; c++) for (let ch = 0; ch < 3; ch++) if (Math.abs(gain(t, c, ch) - 1) > 0.01) flat = false;
    if (flat) {
      if (tile.raw !== tile.out) fs.copyFileSync(tile.raw, tile.out);
      continue;
    }
    const { data, info } = await sharp(tile.raw).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width;
    const H = info.height;
    const g = [0, 1, 2, 3].map((c) => [0, 1, 2].map((ch) => gain(t, c, ch))) as number[][];
    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H;
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W;
        const p = (y * W + x) * 3;
        for (let ch = 0; ch < 3; ch++) {
          const top = g[0]![ch]! * (1 - u) + g[1]![ch]! * u;
          const bot = g[2]![ch]! * (1 - u) + g[3]![ch]! * u;
          data[p + ch] = Math.min(255, Math.round((data[p + ch] as number) * (top * (1 - v) + bot * v)));
        }
      }
    }
    await sharp(data, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 88, mozjpeg: true }).toFile(tile.out);
    rewritten++;
  }
  log(`   orthophotos harmonisées : écart moyen aux bords ${(before / k).toFixed(1)} → ${(after / k).toFixed(1)} (${rewritten}/${tiles.length} images corrigées)`);
  return { before: before / k, after: after / k };
}
