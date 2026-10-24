import { describe, expect, it } from 'vitest';
import { weatherAt, windDirection } from '../src/index.ts';

const base = { hour: 10, clouds: 0.3, rain: 0, fog: 0, windMs: 5, evolving: false };

describe('vent réaliste', () => {
  it('direction tirée de la graine, surtout d’ouest à sud-ouest', () => {
    let west = 0;
    for (let seed = 0; seed < 400; seed++) {
      const deg = ((windDirection(seed) * 180) / Math.PI + 360) % 360;
      if (deg >= 200 && deg <= 300) west++;
    }
    expect(west / 400).toBeGreaterThan(0.45);
    expect(west / 400).toBeLessThan(0.8);
  });

  it('rafales autour de la force choisie, même météo fixe, identiques pour tout le groupe', () => {
    const w = { ...base, seed: 1234 };
    const speeds = Array.from({ length: 600 }, (_, i) => weatherAt(w, i).windMs);
    const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    expect(avg).toBeGreaterThan(4);
    expect(avg).toBeLessThan(6.5);
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeGreaterThan(1);
    expect(Math.max(...speeds)).toBeLessThan(5 * 2);
    expect(weatherAt(w, 321).windMs).toBe(weatherAt({ ...w }, 321).windMs);
  });

  it('la direction tourne lentement', () => {
    const w = { ...base, seed: 77 };
    const a = weatherAt(w, 0).windFrom;
    const b = weatherAt(w, 5).windFrom;
    expect(Math.abs(b - a)).toBeLessThan(0.05);
  });
});
