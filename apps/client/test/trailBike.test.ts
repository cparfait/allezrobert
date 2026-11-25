import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK } from '@allezrobert/shared';
import { trailBike, withTrailBike } from '../src/game/trailBike.ts';

const route = (bike: 'gravel' | 'mtb' | undefined, dirtM: number) => ({
  ...(bike ? { bike } : {}),
  lengthM: 1000,
  surfaces: [{ startM: 0, endM: dirtM, surface: 'earth' }, { startM: dirtM, endM: 1000, surface: 'asphalt' }],
});

describe('vélo des autres cyclistes', () => {
  it('VTT seuls sur un parcours VTT, gravel et VTT sur un parcours gravel', () => {
    for (let i = 0; i < 12; i++) {
      expect(trailBike(route('mtb', 100), i)).toBe('mtb');
      expect(['gravel', 'mtb']).toContain(trailBike(route('gravel', 300), i));
    }
    expect(trailBike(route('gravel', 300), 0)).toBe('gravel');
  });

  it('parcours sans vélo déclaré : selon la part de chemins', () => {
    expect(trailBike(route(undefined, 100), 0)).toBe('road');
    expect(trailBike(route(undefined, 800), 0)).toBe('gravel');
    expect(trailBike({ lengthM: 1000 }, 0)).toBe('road');
  });

  it('remplace le vélo de route, sans toucher à la tenue sur route', () => {
    const look = { ...DEFAULT_LOOK, bikeModel: 's26-04-cervelo-s5' };
    expect(withTrailBike(look, route(undefined, 0), 0)).toBe(look);
    const mtb = withTrailBike(look, route('mtb', 900), 0);
    expect(mtb.bikeType).toBe('mtb');
    expect(mtb.bikeModel).toBeUndefined();
    expect(mtb.jersey).toBe(look.jersey);
  });
});
