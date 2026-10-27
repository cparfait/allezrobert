import { describe, expect, it } from 'vitest';
import { reverbWet } from '../src/audio/soundscape.ts';
import { roomImpulse, seeded } from '../src/audio/buffers.ts';

describe('réverbération', () => {
  it('nulle en plaine, douce en forêt, plus forte en village, bornée', () => {
    expect(reverbWet({ forest: 0, urban: 0 })).toBe(0);
    expect(reverbWet({ forest: 1, urban: 0 })).toBeLessThan(reverbWet({ forest: 0, urban: 1 }));
    expect(reverbWet({ forest: 1, urban: 1 })).toBeLessThanOrEqual(0.35);
  });

  it('réponse impulsionnelle stéréo qui décroît de 60 dB sur sa durée', () => {
    const [l, r] = roomImpulse(8000, 1, seeded(1));
    expect(l).toHaveLength(8000);
    expect(r).toHaveLength(8000);
    const rms = (a: Float32Array, from: number, to: number) => Math.sqrt(a.slice(from, to).reduce((s, x) => s + x * x, 0) / (to - from));
    const head = rms(l as Float32Array, 100, 900);
    const tail = rms(l as Float32Array, 7200, 8000);
    expect(tail / head).toBeLessThan(0.01);
  });
});
