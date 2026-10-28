import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { rng } from '../src/engine/noise.ts';
import { snowCoverAt } from '../src/world/alpine.ts';
import { GRASS_BLOCK, GRASS_RADIUS, appendGrassBlock, generateGrassBlock, grassBlocksAround, grassTriesPerBlock, type GrassBlock, type GrassEnv } from '../src/world/grassPlacement.ts';
import { splatAt } from '../src/world/splat.ts';
import { emptyFeatures, SPLAT_CHANNELS, type LoadedTile } from '../src/world/types.ts';

const SIZE = 1000;

/** Tuile de 1 km avec un raster d'occupation du sol aléatoire mais déterministe (prés, champs, forêts, route, eau, roche). */
function tile(tx: number, tz: number, seed: number): LoadedTile {
  const res = 32;
  const data = new Uint8Array(res * res * SPLAT_CHANNELS.length);
  const r = rng(seed);
  for (let i = 0; i < res * res; i++) {
    const kind = r();
    const o = i * SPLAT_CHANNELS.length;
    data[o + 2] = kind < 0.5 ? 255 : 0; // prairie
    data[o + 1] = kind >= 0.5 && kind < 0.7 ? 200 : 0; // champ
    data[o] = kind >= 0.7 && kind < 0.85 ? 255 : 0; // forêt
    data[o + 5] = kind >= 0.85 && kind < 0.9 ? 255 : 0; // route
    data[o + 3] = kind >= 0.9 && kind < 0.93 ? 255 : 0; // eau
    data[o + 6] = Math.floor(r() * 120); // bas-côté
    data[o + 7] = kind >= 0.97 ? 255 : 0; // roche
  }
  return { id: `${tx}_${tz}`, tx, tz, x0: tx * SIZE, z0: tz * SIZE, size: SIZE, n: 1, heights: new Float32Array(4), features: emptyFeatures(), splat: { res, data } };
}

/** Monde de 2 × 2 tuiles ; au-delà, pas de tuile. L'altitude monte vers l'est (neige en hiver). */
function makeEnv(season: GrassEnv['season'], loaded: (tx: number, tz: number) => boolean = () => true): GrassEnv {
  const tiles = new Map<string, LoadedTile>();
  for (let tx = -1; tx <= 2; tx++) for (let tz = -1; tz <= 2; tz++) tiles.set(`${tx}_${tz}`, tile(tx, tz, 1000 + tx * 17 + tz * 31));
  const tileAt = (x: number, z: number) => {
    const tx = Math.floor(x / SIZE);
    const tz = Math.floor(z / SIZE);
    return loaded(tx, tz) ? tiles.get(`${tx}_${tz}`) : undefined;
  };
  return {
    season,
    tileAt,
    heightAt: (x, z) => (tileAt(x, z) ? 200 + 0.9 * x + 20 * Math.sin(z / 40) : Number.NaN),
    // une route est-ouest à z = 500, large de 6 m
    avoid: (_x, z) => Math.abs(z - 500) < 3,
  };
}

/** Algorithme d'origine (grass.ts avant la mémorisation par bloc), regénération complète d'un coup. */
function reference(env: GrassEnv, fx: number, fz: number, max: number): Float32Array {
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  const up = new Vector3(0, 1, 0);
  const staging = new Float32Array(max * 16);
  const blocks = grassBlocksAround(fx, fz);
  const triesPerBlock = grassTriesPerBlock(max);
  let n = 0;
  for (const blk of blocks) {
    if (n >= max) break;
    const r = rng(((blk.bx * 73856093) ^ (blk.bz * 19349663)) | 0);
    for (let t = 0; t < triesPerBlock && n < max; t++) {
      const ux = r();
      const uz = r();
      const uDensity = r();
      const uSnow = r();
      const uSize = r();
      const uTurn = r();
      const uHeight = r();
      const x = (blk.bx + ux) * GRASS_BLOCK;
      const z = (blk.bz + uz) * GRASS_BLOCK;
      if (Math.hypot(x - fx, z - fz) > GRASS_RADIUS) continue;
      const tl = env.tileAt(x, z);
      if (!tl) continue;
      const meadow = splatAt(tl, 2, x, z);
      const field = splatAt(tl, 1, x, z);
      const forest = splatAt(tl, 0, x, z);
      const road = splatAt(tl, 5, x, z);
      const water = splatAt(tl, 3, x, z);
      const verge = splatAt(tl, 6, x, z);
      const rock = splatAt(tl, 7, x, z);
      const density = road > 0.3 || water > 0.3 || rock > 0.2 ? 0 : 0.35 + meadow * 0.65 - forest * 0.25 + field * 0.1 + verge * 0.8;
      if (uDensity > density) continue;
      if (env.avoid(x, z)) continue;
      const y = env.heightAt(x, z);
      if (!Number.isFinite(y)) continue;
      const snow = snowCoverAt(y, env.season);
      if (snow > 0 && uSnow < snow) continue;
      const k = (0.6 + uSize * 0.7) * (1 + verge * 0.6);
      p.set(x, y - 0.02, z);
      q.setFromAxisAngle(up, uTurn * Math.PI);
      s.set(k, k * (0.8 + uHeight * 0.6), k);
      m.compose(p, q, s);
      m.toArray(staging, n++ * 16);
    }
  }
  return staging.subarray(0, n * 16);
}

/** Nouvel algorithme avec cache de blocs partagé d'une regénération à l'autre. */
function cached(env: GrassEnv, cache: Map<number, GrassBlock>, fx: number, fz: number, max: number): Float32Array {
  const staging = new Float32Array(max * 16);
  const tries = grassTriesPerBlock(max);
  let n = 0;
  for (const { bx, bz } of grassBlocksAround(fx, fz)) {
    if (n >= max) break;
    const key = bx * 1_048_576 + bz;
    let block = cache.get(key);
    if (!block) {
      block = generateGrassBlock(bx, bz, tries, env);
      if (block.complete) cache.set(key, block);
    }
    n = appendGrassBlock(block, fx, fz, staging, n, max);
  }
  return staging.subarray(0, n * 16);
}

/** Égalité numérique (0 et -0 identiques). */
function same(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('placement de l\'herbe par blocs', () => {
  for (const season of ['summer', 'winter'] as const) {
    for (const max of [4000, 60000]) {
      it(`reproduit l'algorithme d'origine en avançant par pas de 12 m (${season}, plafond ${max})`, () => {
        const env = makeEnv(season);
        const cache = new Map<number, GrassBlock>();
        // départ près de la route, puis déplacement est-ouest et nord-sud, y compris à cheval sur deux tuiles
        const steps: Array<[number, number]> = [];
        for (let i = 0; i < 12; i++) steps.push([940 + i * 12, 480 + i * 3]);
        for (let i = 0; i < 6; i++) steps.push([1072 - i * 5, 560 + i * 12]);
        let total = 0;
        for (const [fx, fz] of steps) {
          const expected = reference(env, fx, fz, max);
          const got = cached(env, cache, fx, fz, max);
          expect(got.length).toBe(expected.length);
          expect(same(got, expected)).toBe(true);
          total += expected.length / 16;
        }
        expect(total).toBeGreaterThan(1000);
      });
    }
  }

  it('ne garde pas un bloc écarté faute de tuile, et le refait quand la tuile arrive', () => {
    let eastLoaded = false;
    const env = makeEnv('summer', (tx) => tx <= 0 || eastLoaded);
    const tries = grassTriesPerBlock(20000);
    // bloc à cheval sur la frontière entre les tuiles 0 et 1 (x = 1000 tombe dans le bloc 83 : 996 à 1008 m)
    const bx = Math.floor(1000 / GRASS_BLOCK);
    const before = generateGrassBlock(bx, 40, tries, env);
    expect(before.complete).toBe(false);
    eastLoaded = true;
    const after = generateGrassBlock(bx, 40, tries, env);
    expect(after.complete).toBe(true);
    expect(after.count).toBeGreaterThan(before.count);
  });
});
