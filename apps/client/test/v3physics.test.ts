import { describe, expect, it } from 'vitest';
import { DEFAULT_BIKE } from '@allezrobert/shared';
import { v3BikeEffect } from '../src/v3/physics.ts';
import type { V3Bike, V3Gear } from '../src/v3/visuals.ts';

const bike = (id: string, type: string, weightG?: number, cdaBias?: number): V3Bike => ({ id, name: id, brand: 'Test', type, weightG, cdaBias });
const gear = (id: number, type: string, weightG?: number, cdaBias?: number): V3Gear => ({
  id, type, category: type, name: String(id), variant: String(id), sex: 'tous', model: true, pair: false,
  offset: [0, 0, 0], rotation: [0, 0, 0], colors: [], weightG, cdaBias,
});

describe('vélo roulé du style V3', () => {
  const bikes = [bike('route', 'route', 6500, -0.0047), bike('chrono', 'chrono', 8500, -0.038), bike('vtt', 'vtt', 11000, 0.01),
    bike('plume', 'route', 3040, 0), bike('gravel', 'gravel')];
  const items = [gear(1, 'HEAD_GEAR', 300, -0.05), gear(2, 'GLASSES', 25), gear(3, 'CYCLING_SHOES', 400), gear(4, 'SOCKS', undefined, -0.003)];

  it('additionne le vélo et les accessoires portés', () => {
    const effect = v3BikeEffect({ bike: 'route', color: 0, kit: { GLASSES: { id: 2, color: 0 }, CYCLING_SHOES: { id: 3, color: 0 } } }, bikes, items);
    expect(effect.setup.massKg).toBeCloseTo(6.925, 2);
    expect(effect.setup.cda).toBeCloseTo(DEFAULT_BIKE.cda - 0.0047, 4);
    expect(effect.setup.tyre).toBe('road');
    expect(effect.dragPct).toBeLessThan(0);
  });

  it('borne le gain de traînée cumulé et la masse', () => {
    const effect = v3BikeEffect({ bike: 'chrono', color: 0, kit: { HEAD_GEAR: { id: 1, color: 0 }, SOCKS: { id: 4, color: 0 } } }, bikes, items);
    expect(effect.cdaDelta).toBe(-0.06);
    expect(v3BikeEffect({ bike: 'plume', color: 0 }, bikes, items).setup.massKg).toBe(5.5);
  });

  it('choisit les pneus selon le type de vélo et garde le vélo par défaut sans données', () => {
    expect(v3BikeEffect({ bike: 'vtt', color: 0 }, bikes, items).setup.tyre).toBe('mtb');
    const gravel = v3BikeEffect({ bike: 'gravel', color: 0 }, bikes, items).setup;
    expect(gravel.tyre).toBe('gravel');
    expect(gravel.massKg).toBe(DEFAULT_BIKE.massKg);
    expect(v3BikeEffect({ bike: 'inconnu', color: 0 }, bikes, items).setup.cda).toBe(DEFAULT_BIKE.cda);
  });
});
