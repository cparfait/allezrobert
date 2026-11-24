import { describe, expect, it } from 'vitest';
import { DEFAULT_BIKE, RouteTrack, type RiderProfile } from '@allezrobert/shared';
import { RideSession } from '../src/game/ride.ts';
import type { InputSource } from '../src/game/inputs.ts';

/** Itinéraire droit de 3 km, chaussée de 5 m. */
const track = new RouteTrack({
  id: 't',
  name: 't',
  loop: false,
  lengthM: 3000,
  elevationGainM: 0,
  points: Array.from({ length: 301 }, (_, i) => ({ x: i * 10, y: 0, z: 0, d: i * 10 })),
  segments: [],
  roadWidthM: 5,
  attribution: [],
});
const profile = { id: 'p', displayName: 'P', massKg: 75, heightCm: 178, ftpWatts: 250, bike: DEFAULT_BIKE } as RiderProfile;
const source = { read: () => ({ watts: 200, cadence: 90, steer: 0 }), sendTrainer: () => {} } as unknown as InputSource;

function session(): RideSession {
  return new RideSession({ profile, track, trainerDifficulty: 0.5, startDistM: 1000 });
}

describe('joueur : sa moitié de chaussée quand quelqu’un arrive en face', () => {
  it('sans personne en face, la direction mène sur la moitié de gauche (pour doubler)', () => {
    const ride = session();
    for (let i = 0; i < 60; i++) ride.update(0.05, source, -1);
    expect(ride.facing).toBe(false);
    expect(ride.lateral).toBeLessThan(-0.5);
  });

  it('quelqu’un arrive en face : borné à droite de l’axe (0,5 m), et ramené s’il était à gauche', () => {
    const ride = session();
    for (let i = 0; i < 60; i++) ride.update(0.05, source, -1);
    expect(ride.lateral).toBeLessThan(-0.5);
    let asked: [number, number, number] | null = null;
    ride.oncoming = (d, dir, range) => ((asked = [d, dir, range]), true);
    // Retour à la vitesse de la direction (1,8 m/s), sans saut.
    let prev = ride.lateral;
    for (let i = 0; i < 40; i++) {
      ride.update(0.05, source, -1);
      expect(Math.abs(ride.lateral - prev)).toBeLessThanOrEqual(1.8 * 0.05 + 1e-9);
      prev = ride.lateral;
    }
    expect(ride.facing).toBe(true);
    expect(ride.lateral).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(asked![1]).toBe(1);
    expect(asked![2]).toBeGreaterThanOrEqual(40);
    // Il passe : la direction n'est plus bornée, mais la consigne a été ramenée (pas de retour tout seul à gauche).
    ride.oncoming = () => false;
    ride.update(0.05, source, 0);
    expect(ride.lateral).toBeGreaterThanOrEqual(0.5 - 1e-9);
  });

  it('à contresens après un demi-tour, sa moitié est de l’autre côté de l’axe', () => {
    const ride = session();
    ride.uturn();
    ride.oncoming = (_d, dir) => dir === -1;
    for (let i = 0; i < 80; i++) ride.update(0.05, source, -1);
    expect(ride.dir).toBe(-1);
    expect(ride.lateral).toBeLessThanOrEqual(-0.5 + 1e-9);
  });
});
