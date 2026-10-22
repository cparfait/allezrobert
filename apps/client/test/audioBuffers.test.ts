import { describe, expect, it } from 'vitest';
import { COBBLE_BUFFER_RATE, cobbles, crackle, cricketChorus, hubClick, noise, seeded } from '../src/audio/buffers.ts';

const SR = 8000;
const peak = (d: Float32Array) => d.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
const finite = (d: Float32Array) => d.every((x) => Number.isFinite(x));

describe('tampons audio synthétisés', () => {
  it('reproductibles (même graine, même son)', () => {
    expect(noise(SR, 0.5, true, seeded(1))).toEqual(noise(SR, 0.5, true, seeded(1)));
    expect(crackle(SR, 0.5, 300, seeded(2))).not.toEqual(crackle(SR, 0.5, 300, seeded(3)));
  });

  it('sous ±1, sans NaN', () => {
    const rnd = seeded(7);
    for (const d of [noise(SR, 1, true, rnd), noise(SR, 1, false, rnd), crackle(SR, 1, 400, rnd), cobbles(SR, 1, rnd), hubClick(SR, 0, rnd), ...cricketChorus(SR, 2, 5, rnd)]) {
      expect(finite(d)).toBe(true);
      expect(peak(d)).toBeLessThanOrEqual(0.9 + 1e-6);
      expect(peak(d)).toBeGreaterThan(0.05);
    }
  });

  it('bruit bouclé sans saut au raccord', () => {
    const d = noise(SR, 1, true, seeded(4));
    const jump = Math.abs((d[0] as number) - (d[d.length - 1] as number));
    expect(jump).toBeLessThan(0.1);
  });

  it('crépitement : grains clairsemés (fort facteur de crête)', () => {
    const d = crackle(SR, 2, 400, seeded(5));
    const rms = Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
    expect(peak(d) / rms).toBeGreaterThan(5);
  });

  it('pavés : ~40 impacts par seconde', () => {
    const d = cobbles(SR, 2, seeded(6));
    // Enveloppe par fenêtres de 5 ms : on compte les montées au-dessus de 30 % de la crête.
    const win = Math.floor(SR * 0.005);
    const env: number[] = [];
    for (let i = 0; i + win <= d.length; i += win) env.push(peak(d.subarray(i, i + win)));
    const thr = Math.max(...env) * 0.3;
    let hits = 0;
    for (let i = 1; i < env.length; i++) if ((env[i] as number) > thr && (env[i - 1] as number) <= thr) hits++;
    expect(hits / 2).toBeGreaterThan(COBBLE_BUFFER_RATE * 0.6);
    expect(hits / 2).toBeLessThan(COBBLE_BUFFER_RATE * 1.3);
  });

  it('grillons : stéréo, silences entre les trilles', () => {
    const [L, R] = cricketChorus(SR, 2, 3, seeded(8));
    expect(L).not.toEqual(R);
    const quiet = L.filter((x) => Math.abs(x) < 1e-3).length / L.length;
    expect(quiet).toBeGreaterThan(0.3);
  });
});
