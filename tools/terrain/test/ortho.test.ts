import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { harmonizeOrthos, isBlankOrtho, type HarmonizeTile } from '../src/ortho.ts';

const solid = (rgb: [number, number, number], px = 128) =>
  sharp({ create: { width: px, height: px, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).jpeg({ quality: 95 }).toBuffer();

async function meanOf(file: string, x0: number, x1: number): Promise<number> {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let s = 0;
  let n = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = x0; x < x1; x++) {
      s += data[(y * info.width + x) * 3 + 1] as number;
      n++;
    }
  return s / n;
}

describe('orthophotos', () => {
  it('reconnaît une tuile blanche (pleine mer, hors couverture IGN)', async () => {
    expect(await isBlankOrtho(await solid([255, 255, 255]))).toBe(true);
    expect(await isBlankOrtho(await solid([90, 110, 70]))).toBe(false);
  });

  it('rapproche deux tuiles voisines de luminosités différentes, sans changer la moyenne', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ortho-'));
    const tiles: HarmonizeTile[] = [];
    for (const [tx, rgb] of [
      [0, [100, 120, 90]],
      [1, [130, 150, 115]],
    ] as const) {
      const raw = path.join(dir, `${tx}_0.raw.jpg`);
      fs.writeFileSync(raw, await solid([...rgb]));
      tiles.push({ id: `${tx}_0`, tx, tz: 0, raw, out: path.join(dir, `${tx}_0.jpg`) });
    }
    const { before, after } = await harmonizeOrthos(tiles, () => undefined);
    expect(after).toBeLessThan(before * 0.5);
    // au bord commun (colonnes voisines), l'écart a fondu
    const a = await meanOf(tiles[0]!.out, 120, 128);
    const b = await meanOf(tiles[1]!.out, 0, 8);
    expect(Math.abs(a - b)).toBeLessThan(10);
    // luminosité d'ensemble à peu près conservée
    const all = ((await meanOf(tiles[0]!.out, 0, 128)) + (await meanOf(tiles[1]!.out, 0, 128))) / 2;
    expect(all).toBeGreaterThan(125);
    expect(all).toBeLessThan(145);
  });
});
