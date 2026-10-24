import { describe, expect, it } from 'vitest';
import { weatherAt, weatherSeed, type RideWeather } from '../src/index.ts';

const base: RideWeather = { hour: 9.5, clouds: 0.5, rain: 0, fog: 0.3, windMs: 4, evolving: true, seed: weatherSeed('salle-42') };

describe('météo partagée', () => {
  it('l’heure avance au rythme réel', () => {
    expect(weatherAt({ ...base, evolving: false }, 1800).hour).toBeCloseTo(10, 6);
    expect(weatherAt({ ...base, hour: 23.5, evolving: false }, 3600).hour).toBeCloseTo(0.5, 6);
  });
  it('fixe : ciel, pluie et brouillard ne bougent pas ; le vent garde sa force moyenne (rafales)', () => {
    const w = weatherAt({ ...base, evolving: false }, 5000);
    expect([w.clouds, w.rain, w.fog]).toEqual([0.5, 0, 0.3]);
    expect(w.windMs).toBeGreaterThan(4 * 0.6);
    expect(w.windMs).toBeLessThan(4 * 1.7);
  });
  it('évolutive : déterministe, continue, bornée, et le brouillard se lève', () => {
    const a = weatherAt(base, 2400);
    expect(weatherAt(base, 2400)).toEqual(a);
    const b = weatherAt(base, 2401);
    expect(Math.abs(a.clouds - b.clouds)).toBeLessThan(0.01);
    for (let t = 0; t < 4 * 3600; t += 97) {
      const w = weatherAt(base, t);
      for (const v of [w.clouds, w.rain, w.fog]) expect(v >= 0 && v <= 1).toBe(true);
      expect(w.windMs).toBeGreaterThanOrEqual(0);
    }
    expect(weatherAt(base, 3 * 3600).fog).toBeLessThan(0.1);
    // Graines différentes, météos différentes.
    expect(weatherAt({ ...base, seed: 7 }, 3000).clouds).not.toBeCloseTo(weatherAt({ ...base, seed: 8 }, 3000).clouds, 3);
  });
  it('il finit par pleuvoir quand le ciel se couvre', () => {
    let rained = false;
    for (let t = 0; t < 6 * 3600 && !rained; t += 60) rained = weatherAt({ ...base, clouds: 0.8 }, t).rain > 0.2;
    expect(rained).toBe(true);
  });
});
