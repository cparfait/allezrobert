import { describe, expect, it } from 'vitest';
import { DEFAULT_BIKE } from '@allezrobert/shared';
import { v3BikeEffect } from '../src/v3/physics.ts';
import { mountedWheel, wheelsFor, type V3Bike, type V3Wheel } from '../src/v3/visuals.ts';

const wheels: V3Wheel[] = [
  { id: 'zipp-808', name: 'Zipp 808', brand: 'Zipp', kind: 'route', weightG: 2495, cdaBias: -0.013 },
  { id: 'gravel', name: 'Zwift Gravel', brand: 'Zwift', kind: 'gravel', weightG: 2600, cdaBias: 0 },
  { id: 'mountain', name: 'Zwift Mountain', brand: 'Zwift', kind: 'vtt', weightG: 2800, cdaBias: 0.0008 },
];
const road: V3Bike = { id: 'route', name: 'Route', brand: 'Test', type: 'route', weightG: 7000, cdaBias: 0, wheels: { id: 'origine', weightG: 2500, cdaBias: 0 } };
const mtb: V3Bike = { id: 'vtt', name: 'VTT', brand: 'Test', type: 'vtt', weightG: 11000, wheels: { weightG: 2800, cdaBias: 0 } };

describe('roues du style V3', () => {
  it('propose route et gravel sur les vélos de route, rien sur un VTT', () => {
    expect(wheelsFor('route', wheels).map(wheel => wheel.id)).toEqual(['zipp-808', 'gravel']);
    expect(wheelsFor('vtt', wheels)).toEqual([]);
    expect(mountedWheel({ bike: 'vtt', color: 0, wheels: 'zipp-808' }, mtb, wheels)).toBeUndefined();
  });

  it('remplace le poids et la traînée des roues d’origine, pneus selon la roue', () => {
    const aero = v3BikeEffect({ bike: 'route', color: 0, wheels: 'zipp-808' }, [road], [], wheels);
    expect(aero.bikeKg).toBeCloseTo(6.995, 3);
    expect(aero.setup.cda).toBeCloseTo(DEFAULT_BIKE.cda - 0.013, 4);
    expect(aero.setup.tyre).toBe('road');
    expect(v3BikeEffect({ bike: 'route', color: 0, wheels: 'gravel' }, [road], [], wheels).setup.tyre).toBe('gravel');
    expect(v3BikeEffect({ bike: 'route', color: 0 }, [road], [], wheels).bikeKg).toBe(7);
  });
});
