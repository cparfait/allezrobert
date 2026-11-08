import { describe, expect, it } from 'vitest';
import { ROAD_FEEL, ROAD_FEEL_TEXT, clampRoadFeel, roadFeelLevel } from '@allezrobert/shared';
import { TACX_ROAD_FEEL_MAX_PERCENT } from '@allezrobert/protocols';
import { ROAD_FEEL_MIN_PERCENT, ROAD_FEEL_MIN_SPEED_MS, roadFeelFor, tacxSurfaceFromOsm } from '../src/game/roadFeel.ts';

describe('ressenti route', () => {
  it('pavés, gravier et terre vibrent ; enrobé et tronçons sans tag restent calmes', () => {
    expect(tacxSurfaceFromOsm('sett')).toBe('cobblestonesHard');
    expect(tacxSurfaceFromOsm(' Cobblestone ')).toBe('cobblestonesHard');
    expect(tacxSurfaceFromOsm('paving_stones')).toBe('cobblestonesSoft');
    expect(tacxSurfaceFromOsm('bricks')).toBe('brickRoad');
    expect(tacxSurfaceFromOsm('concrete:plates')).toBe('concretePlates');
    expect(tacxSurfaceFromOsm('wood')).toBe('woodenBoards');
    expect(tacxSurfaceFromOsm('gravel')).toBe('gravel');
    expect(tacxSurfaceFromOsm('compacted')).toBe('offRoad');
    expect(tacxSurfaceFromOsm('dirt')).toBe('offRoad');
    for (const s of ['asphalt', 'paved', 'concrete', 'chipseal', '', undefined, 'inconnu']) expect(tacxSurfaceFromOsm(s)).toBe('off');
  });

  it('coupé en pause, à l\'arrêt, à 0 %, et intensité plafonnée', () => {
    const base = { osmSurface: 'sett', percent: 30, riding: true, speedMs: 8 };
    expect(roadFeelFor(base)).toEqual({ surface: 'cobblestonesHard', intensityPercent: 30 });
    expect(roadFeelFor({ ...base, riding: false })).toEqual({ surface: 'off', intensityPercent: 0 });
    expect(roadFeelFor({ ...base, speedMs: ROAD_FEEL_MIN_SPEED_MS - 0.1 })).toEqual({ surface: 'off', intensityPercent: 0 });
    expect(roadFeelFor({ ...base, percent: 0 })).toEqual({ surface: 'off', intensityPercent: 0 });
    expect(roadFeelFor({ ...base, osmSurface: 'asphalt' })).toEqual({ surface: 'off', intensityPercent: 0 });
    expect(roadFeelFor({ ...base, percent: 100 }).intensityPercent).toBe(ROAD_FEEL.maxPercent);
  });

  it('intensité adaptée au revêtement : pavés à fond, terre et gravier moins', () => {
    const at = (osmSurface: string, percent = 40) => roadFeelFor({ osmSurface, percent, riding: true, speedMs: 8 }).intensityPercent;
    expect(at('sett')).toBe(40);
    expect(at('paving_stones')).toBe(32);
    expect(at('gravel')).toBe(26);
    expect(at('ground')).toBe(20);
    // Jamais sous le minimum perceptible tant que le ressenti est actif.
    expect(at('ground', 5)).toBe(ROAD_FEEL_MIN_PERCENT);
  });

  it('plafond du jeu = plafond du protocole, et niveaux d\'alerte', () => {
    expect(ROAD_FEEL.maxPercent).toBe(TACX_ROAD_FEEL_MAX_PERCENT);
    expect(clampRoadFeel(Number.NaN)).toBe(0);
    expect(clampRoadFeel(-3)).toBe(0);
    expect(roadFeelLevel(0)).toBe('off');
    expect(roadFeelLevel(ROAD_FEEL.defaultPercent)).toBe('soft');
    expect(roadFeelLevel(ROAD_FEEL.strongPercent)).toBe('strong');
    expect(roadFeelLevel(ROAD_FEEL.extremePercent)).toBe('extreme');
    expect(roadFeelLevel(ROAD_FEEL.maxPercent)).toBe('extreme');
    for (const lang of ['fr', 'en'] as const) for (const k of ['off', 'soft', 'strong', 'extreme', 'unsupported', 'confirm'] as const) expect(ROAD_FEEL_TEXT[lang][k].length).toBeGreaterThan(10);
  });
});
