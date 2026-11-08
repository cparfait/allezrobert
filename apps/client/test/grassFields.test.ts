import { describe, expect, it } from 'vitest';
import { FIELD_GRASS_MIN, VERGE_FADE_M, VERGE_KEEP_M, fieldGrassDensity, fieldGrassPatch, generateGrassBlock, grassTriesPerBlock, type GrassEnv } from '../src/world/grassPlacement.ts';
import { emptyFeatures, SPLAT_CHANNELS, type LoadedTile } from '../src/world/types.ts';

/** P2.1c : herbe des champs cultivés (stratégie B), à l'essai derrière `?grassfields=1`. */

const SIZE = 1000;
const ROAD_Z = 500;
/** Route est-ouest de 6 m : bord dessiné = demi-largeur + accotement de 0,6 m (roadAvoid.drawnRoads). */
const ROAD_EDGE = 3 + 0.6;

/** Tuile de 1 km : champ au nord de x = 500, pré au sud-ouest… selon `kind`, route est-ouest à z = 500. */
function tile(kind: 'field' | 'meadow' | 'mixed'): LoadedTile {
  const res = 256;
  const data = new Uint8Array(res * res * SPLAT_CHANNELS.length);
  for (let j = 0; j < res; j++)
    for (let i = 0; i < res; i++) {
      const o = (j * res + i) * SPLAT_CHANNELS.length;
      const isField = kind === 'field' || (kind === 'mixed' && i < res / 2);
      data[o + 1] = isField ? 255 : 0;
      data[o + 2] = isField ? 0 : 255;
    }
  const features = emptyFeatures();
  features.roads.push({ kind: 'secondary', width: 6, pts: [0, ROAD_Z, SIZE, ROAD_Z] });
  return { id: `t_${kind}`, tx: 0, tz: 0, x0: 0, z0: 0, size: SIZE, n: 1, heights: new Float32Array(4), features, splat: { res, data } };
}

function env(t: LoadedTile, grassFields: boolean | undefined): GrassEnv {
  return {
    season: 'summer',
    tileAt: (x, z) => (x >= 0 && x < SIZE && z >= 0 && z < SIZE ? t : undefined),
    heightAt: () => 300,
    // chaussée elle-même (comme `onAsphalt`) : pas de touffe sur l'enrobé
    avoid: (_x, z) => Math.abs(z - ROAD_Z) < 3,
    ...(grassFields === undefined ? {} : { grassFields }),
  };
}

/** Touffes (x, z) des blocs couvrant une bande de 60 m de part et d'autre de la route. */
function tufts(e: GrassEnv): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const tries = grassTriesPerBlock(48000);
  for (let bx = 30; bx < 40; bx++)
    for (let bz = Math.floor((ROAD_Z - 60) / 12); bz <= Math.floor((ROAD_Z + 60) / 12); bz++) {
      const b = generateGrassBlock(bx, bz, tries, e);
      for (let i = 0; i < b.count; i++) out.push([b.xz[i * 2] as number, b.xz[i * 2 + 1] as number]);
    }
  return out;
}

describe('fieldGrassDensity', () => {
  it('ne change rien hors des champs, sur une densité nulle', () => {
    expect(fieldGrassDensity(1, 0, 0, 0, Infinity)).toBe(1);
    expect(fieldGrassDensity(0.35, 0.04, 0, 0, Infinity)).toBe(0.35);
    expect(fieldGrassDensity(0, 1, 1, 1, Infinity)).toBe(0);
  });
  it('descend au plancher dans un champ pur, loin de la route, sans tache ni lisière', () => {
    expect(fieldGrassDensity(0.45, 1, 0, 0, Infinity)).toBeCloseTo(FIELD_GRASS_MIN, 6);
  });
  it('ne dépasse jamais la densité d’origine', () => {
    for (const patch of [0, 0.5, 1]) for (const edge of [0, 1]) for (const d of [0, 2, 4, 20]) expect(fieldGrassDensity(0.45, 1, patch, edge, d)).toBeLessThanOrEqual(0.45 + 1e-12);
  });
  it('garde la densité d’origine sur le bas-côté puis la fond sur 2 m', () => {
    expect(fieldGrassDensity(0.45, 1, 0, 0, 0)).toBe(0.45);
    expect(fieldGrassDensity(0.45, 1, 0, 0, VERGE_KEEP_M)).toBe(0.45);
    expect(fieldGrassDensity(0.45, 1, 0, 0, VERGE_KEEP_M + VERGE_FADE_M)).toBeCloseTo(FIELD_GRASS_MIN, 6);
    let prev = Infinity;
    for (let d = VERGE_KEEP_M; d <= VERGE_KEEP_M + VERGE_FADE_M; d += 0.25) {
      const v = fieldGrassDensity(0.45, 1, 0, 0, d);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
  });
  it('mélange selon la part de champ du pixel (pas de marche champ / pré)', () => {
    const half = fieldGrassDensity(0.7, 0.5, 0, 0, Infinity);
    expect(half).toBeCloseTo(0.7 + (FIELD_GRASS_MIN - 0.7) * 0.5, 6);
  });
});

describe('fieldGrassPatch', () => {
  it('est déterministe, dans 0–1, ni toujours nul ni toujours plein', () => {
    let on = 0;
    for (let i = 0; i < 4000; i++) {
      const x = (i % 63) * 9.7, z = Math.floor(i / 63) * 11.3;
      const p = fieldGrassPatch(x, z);
      expect(p).toBe(fieldGrassPatch(x, z));
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      if (p > 0.5) on++;
    }
    expect(on / 4000).toBeGreaterThan(0.05);
    expect(on / 4000).toBeLessThan(0.45);
  });
});

describe('generateGrassBlock avec grassFields', () => {
  it('coupé (absent ou false) : placement identique à l’origine', () => {
    const t = tile('field');
    expect(tufts(env(t, false))).toEqual(tufts(env(t, undefined)));
  });
  it('est stable d’une génération à l’autre', () => {
    const t = tile('field');
    expect(tufts(env(t, true))).toEqual(tufts(env(t, true)));
  });
  it('ne garde que des touffes déjà présentes (aucune nouvelle position)', () => {
    const t = tile('field');
    const before = new Set(tufts(env(t, false)).map(([x, z]) => `${x},${z}`));
    for (const [x, z] of tufts(env(t, true))) expect(before.has(`${x},${z}`)).toBe(true);
  });
  it('éclaircit fortement le champ loin de la route, garde tout le bas-côté (mesuré depuis le bord)', () => {
    const t = tile('field');
    const off = tufts(env(t, false));
    const on = tufts(env(t, true));
    const edgeDist = ([, z]: [number, number]) => Math.abs(z - ROAD_Z) - ROAD_EDGE;
    const band = (a: Array<[number, number]>, lo: number, hi: number) => a.filter((p) => edgeDist(p) >= lo && edgeDist(p) < hi).length;
    // bas-côté : de 0 à 3 m du bord de chaussée (et non de l'axe), rien n'est retiré
    expect(band(on, 0, VERGE_KEEP_M)).toBe(band(off, 0, VERGE_KEEP_M));
    expect(band(off, 0, VERGE_KEEP_M)).toBeGreaterThan(50);
    // au-delà de 5 m : au moins 70 % de touffes en moins
    expect(band(on, 5, 60)).toBeLessThan(band(off, 5, 60) * 0.3);
    expect(band(on, 5, 60)).toBeGreaterThan(0);
  });
  it('ne touche pas aux prés', () => {
    const t = tile('meadow');
    expect(tufts(env(t, true))).toEqual(tufts(env(t, false)));
  });
});
