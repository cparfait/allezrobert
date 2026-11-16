import { describe, expect, it } from 'vitest';
import { bikeLevel, gearLevel, V3_MAX_LEVEL, V3_TOP_GEAR_LEVEL, wheelLevel } from '../src/v3/levels.ts';
import { V3_DEFAULT_BIKE, V3_DEFAULT_KIT, type V3Bike, type V3Gear, type V3Wheel } from '../src/v3/visuals.ts';

const bike = (id: string, weightG: number, cdaBias = 0, type = 'route'): V3Bike => ({ id, name: id, brand: 'Test', type, weightG, cdaBias });
describe('niveaux du style Beta', () => {
  it('classe les vélos d’un même type du plus lourd (niveau 1) au plus rapide', () => {
    const bikes = [bike('lourd', 8400), bike('moyen', 7000), bike('leger', 6200, -0.005), bike('chrono', 9000, -0.03, 'chrono'), bike(V3_DEFAULT_BIKE, 6500, -0.0047)];
    expect(bikeLevel(bikes[0]!, bikes)).toBe(1);
    expect(bikeLevel(bikes[2]!, bikes)).toBe(V3_TOP_GEAR_LEVEL);
    expect(bikeLevel(bikes[1]!, bikes)).toBeGreaterThan(1);
    expect(bikeLevel(bikes[1]!, bikes)).toBeLessThan(V3_TOP_GEAR_LEVEL);
    // Seul vélo de son type, et vélo de départ : libres.
    expect(bikeLevel(bikes[3]!, bikes)).toBe(1);
    expect(bikeLevel(bikes[4]!, bikes)).toBe(1);
  });

  it('classe les roues par famille', () => {
    const wheels: V3Wheel[] = [
      { id: 'a', name: 'a', brand: 'x', kind: 'route', weightG: 1900, cdaBias: 0 },
      { id: 'b', name: 'b', brand: 'x', kind: 'route', weightG: 1400, cdaBias: -0.01 },
      { id: 'g', name: 'g', brand: 'x', kind: 'gravel', weightG: 2600, cdaBias: 0 },
    ];
    expect(wheelLevel(wheels[0]!, wheels)).toBe(1);
    expect(wheelLevel(wheels[1]!, wheels)).toBe(V3_TOP_GEAR_LEVEL);
    expect(wheelLevel(wheels[2]!, wheels)).toBe(1);
  });

  it('laisse le personnage, les pièces retirées et la tenue de départ au niveau 1 ; répartit les tenues à parts égales de 1 à 50', () => {
    const item = (id: number, type: string, extra: Partial<V3Gear> = {}): V3Gear => ({
      id, type, category: type, name: 'Article ' + id, variant: 'V' + id, sex: 'tous', model: true, pair: false,
      offset: [0, 0, 0], rotation: [0, 0, 0], colors: [{ name: 'a' }], ...extra,
    });
    const items = [item(1, 'HAIR'), item(2, 'HEAD_GEAR', { variant: 'None' }), item(V3_DEFAULT_KIT.CYCLING_JERSEY!.id, 'CYCLING_JERSEY'),
      ...Array.from({ length: 400 }, (_, i) => item(3000 + i, 'CYCLING_JERSEY'))];
    expect(items.slice(0, 3).map(row => gearLevel(row, items))).toEqual([1, 1, 1]);
    const levels = items.slice(3).map(row => gearLevel(row, items));
    expect(Math.min(...levels)).toBe(1);
    expect(Math.max(...levels)).toBeLessThanOrEqual(V3_MAX_LEVEL);
    // À parts égales : chaque tranche de 10 niveaux reçoit environ un cinquième des tenues.
    for (let from = 0; from < 50; from += 10) expect(levels.filter(level => level > from && level <= from + 10).length).toBeGreaterThan(50);
    // Casques : selon leur effet.
    const helmets = [item(10, 'HEAD_GEAR', { weightG: 300 }), item(11, 'HEAD_GEAR', { weightG: 250, cdaBias: -0.004 })];
    expect(gearLevel(helmets[0]!, helmets)).toBe(1);
    expect(gearLevel(helmets[1]!, helmets)).toBe(V3_TOP_GEAR_LEVEL);
  });
});
