import { describe, expect, it } from 'vitest';
import { buzzLevel, buzzOffset } from '../src/game/roadBuzz.ts';

describe('vibration de la caméra sur le revêtement', () => {
  it('pavés > gravier > terre > enrobé de campagne > enrobé lisse', () => {
    expect(buzzLevel('sett')).toBe(1);
    expect(buzzLevel('cobblestone')).toBe(1);
    expect(buzzLevel('gravel')).toBeLessThan(1);
    expect(buzzLevel('gravel')).toBeGreaterThan(buzzLevel('dirt'));
    expect(buzzLevel('dirt')).toBeGreaterThan(buzzLevel('asphalt'));
    expect(buzzLevel('asphalt')).toBeLessThan(0.2);
    expect(buzzLevel('concrete')).toBe(0);
  });

  it('nulle à l’arrêt et sans vibration', () => {
    expect(buzzOffset(1.234, 0, 1)).toEqual({ dy: 0, pitch: 0 });
    expect(buzzOffset(1.234, 10, 0)).toEqual({ dy: 0, pitch: 0 });
  });

  it('bornée, croissante avec la vitesse, et agitée dans le temps', () => {
    let maxDy = 0;
    let maxSlow = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 600; i++) {
      const t = i / 60;
      const a = buzzOffset(t, 10, 1);
      maxDy = Math.max(maxDy, Math.abs(a.dy));
      maxSlow = Math.max(maxSlow, Math.abs(buzzOffset(t, 2, 1).dy));
      expect(Math.abs(a.dy)).toBeLessThanOrEqual(0.016 + 1e-9);
      expect(Math.abs(a.pitch)).toBeLessThanOrEqual(0.0055 + 1e-9);
      seen.add(Math.round(a.dy * 1e5));
    }
    expect(maxDy).toBeGreaterThan(0.01);
    expect(maxSlow).toBeLessThan(maxDy * 0.4);
    expect(seen.size).toBeGreaterThan(300);
  });
});
