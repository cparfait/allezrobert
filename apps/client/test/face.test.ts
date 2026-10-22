import { describe, expect, it } from 'vitest';
import { FaceAnimator, type FaceInputs } from '../src/rider/face.ts';

const run = (f: FaceAnimator, inp: FaceInputs, secs: number, dt = 1 / 60): number[] => {
  const blinks: number[] = [];
  for (let t = 0; t < secs; t += dt) blinks.push(f.update(dt, inp).eyeBlinkLeft);
  return blinks;
};

describe('visage en sortie', () => {
  it('au train : visage calme, quelques clignements brefs', () => {
    const f = new FaceAnimator(() => 0.5);
    const b = run(f, { ftpFrac: 0.6, cadence: 85, speed: 8, standing: false }, 20);
    const closed = b.filter((x) => x > 0.5).length;
    expect(closed).toBeGreaterThan(0);
    expect(closed / b.length).toBeLessThan(0.05);
    expect(f.weights.browDownLeft).toBeLessThan(0.05);
    expect(f.weights.jawOpen).toBeLessThan(0.2);
  });

  it('au-delà du seuil : grimace, bouche ouverte par la respiration', () => {
    const f = new FaceAnimator(() => 0.5);
    let maxJaw = 0;
    for (let t = 0; t < 20; t += 1 / 60) maxJaw = Math.max(maxJaw, f.update(1 / 60, { ftpFrac: 1.35, cadence: 95, speed: 9, standing: false }).jawOpen);
    expect(f.weights.browDownLeft).toBeGreaterThan(0.5);
    expect(f.weights.mouthStretchLeft).toBeGreaterThan(0.4);
    expect(maxJaw).toBeGreaterThan(0.25);
  });

  it('sprint en danseuse : joues gonflées ; descente en roue libre : sourire', () => {
    const f = new FaceAnimator(() => 0.5);
    let puff = 0;
    for (let t = 0; t < 15; t += 1 / 60) puff = Math.max(puff, f.update(1 / 60, { ftpFrac: 1.8, cadence: 110, speed: 15, standing: true }).cheekPuff);
    expect(puff).toBeGreaterThan(0.3);
    const g = new FaceAnimator(() => 0.5);
    run(g, { ftpFrac: 0, cadence: 0, speed: 16, standing: false }, 10);
    expect(g.weights.mouthSmileLeft).toBeGreaterThan(0.2);
    expect(g.weights.browDownLeft).toBeLessThan(0.05);
  });

  it('poids toujours entre 0 et 1', () => {
    const f = new FaceAnimator();
    for (let t = 0; t < 30; t += 1 / 30) {
      const w = f.update(1 / 30, { ftpFrac: 3 * Math.abs(Math.sin(t)), cadence: 90, speed: 10, standing: t % 4 < 2 });
      for (const v of Object.values(w)) expect(v >= 0 && v <= 1).toBe(true);
    }
  });
});
