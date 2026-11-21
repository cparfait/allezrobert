import { describe, expect, it } from 'vitest';
import { airDensity, bodyCdaFactor, headwindAlong, paramsFromBike, rideParams, rideStepConditions, riderWind, surfaceCrr, wetCrrFactor, RIDE_AIR_TEMP_C, type Environment } from '../src/index.ts';

/** Ancienne formule du client (ride.ts avant le module partagé), recopiée : la sortie en solo ne doit pas bouger. */
function oldHeadwind(w: { ms: number; from: number } | undefined, dirX: number, dirZ: number): number {
  if (!w || w.ms <= 0) return 0;
  const blowX = -Math.sin(w.from);
  const blowZ = Math.cos(w.from);
  return -(blowX * dirX + blowZ * dirZ) * w.ms;
}

describe('conditions partagées du pas de physique', () => {
  it('solo : identiques au bit près aux anciennes formules du client', () => {
    const env: Environment = { airDensity: 0, windSpeedMs: 0 };
    let n = 0;
    for (const massKg of [52, 75, 96]) {
      for (const heightCm of [155, 178, 197]) {
        const base = paramsFromBike(massKg);
        for (const inertia of [0.6, 1]) {
          const p = rideParams(base, heightCm, massKg, inertia);
          const old = { ...base, cda: base.cda * bodyCdaFactor(heightCm, massKg), inertiaFactor: inertia };
          expect(p).toEqual(old);
          expect(Object.is(p.cda, old.cda)).toBe(true);
          for (const altitudeM of [-20, 0, 340, 1800, 2700]) {
            for (const wind of [undefined, { ms: 0, from: 1 }, { ms: 4.5, from: 0.3 }, { ms: 11, from: 4.4 }]) {
              for (const [dirX, dirZ] of [[1, 0], [0, -1], [-0.6, 0.8]] as const) {
                for (const shelter of [0, 0.4, 1]) {
                  for (const rain of [0, 0.35, 1]) {
                    for (const surface of [undefined, 'asphalt', 'gravel', 'sett', 'dirt']) {
                      for (const tyre of ['road', 'gravel', 'mtb'] as const) {
                        const head = wind ? headwindAlong(wind.ms, wind.from, dirX, dirZ) : 0;
                        const oldHead = oldHeadwind(wind, dirX, dirZ);
                        const crr = rideStepConditions(env, p, { altitudeM, headwindMs: head, shelter, rain, surface, tyre });
                        if (
                          !Object.is(head, oldHead) ||
                          !Object.is(env.airDensity, airDensity(altitudeM, 14)) ||
                          !Object.is(env.windSpeedMs, riderWind(oldHead, shelter)) ||
                          !Object.is(crr, surfaceCrr(surface, old.crr, tyre) * wetCrrFactor(rain))
                        ) {
                          throw new Error(`écart : ${JSON.stringify({ massKg, heightCm, altitudeM, wind, dirX, dirZ, shelter, rain, surface, tyre })}`);
                        }
                        n++;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    expect(n).toBeGreaterThan(10_000);
    expect(RIDE_AIR_TEMP_C).toBe(14);
  });

  it('salle : atmosphère standard, taille inconnue sans effet', () => {
    const env: Environment = { airDensity: 0, windSpeedMs: 0 };
    const base = paramsFromBike(75);
    rideStepConditions(env, base, { altitudeM: 1200, headwindMs: 0, rain: 0, surface: undefined, standardAtmosphere: true });
    expect(Object.is(env.airDensity, airDensity(1200))).toBe(true);
    expect(rideParams(base, undefined, 75).cda).toBe(base.cda);
    expect(rideParams(base, 178, 75).cda).toBeCloseTo(base.cda, 12);
  });
});
