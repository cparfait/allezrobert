import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { FOOT_CRANK, FOOT_REACH, FOOT_SOLE_M, FootDown, crankToward, footGround, footPath, hipDrop } from '../src/rider/footDown.ts';

const run = (f: FootDown, s: number, cadence: number, speed: number): number => {
  let e = 0;
  for (let t = 0; t < s; t += 1 / 60) e = f.update(1 / 60, cadence, speed);
  return e;
};

describe('pied à terre', () => {
  it('jamais au garage ni dans les aperçus (non autorisé)', () => {
    expect(run(new FootDown(), 3, 0, 0)).toBe(0);
  });
  it('déjà posé à la première image sur la grille, repris au premier coup de pédale', () => {
    const f = new FootDown();
    f.enabled = true;
    expect(f.update(1 / 60, 0, 0)).toBe(1);
    const mid = run(f, 0.25, 60, 0.2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(run(f, 1, 60, 2)).toBe(0);
  });
  it('posé peu après l’arrêt, pas en roue libre ni au ralenti en pédalant', () => {
    const f = new FootDown();
    f.enabled = true;
    run(f, 1, 85, 8);
    expect(run(f, 2, 0, 8)).toBe(0);
    expect(run(f, 2, 40, 0.3)).toBe(0);
    expect(run(f, 2, 0, 0)).toBe(1);
  });
  it('hésitation entre les seuils : il ne change pas d’avis', () => {
    const f = new FootDown();
    f.enabled = true;
    run(f, 2, 0, 0);
    expect(run(f, 1, 8, 0.6)).toBe(1);
  });
  it('manivelle amenée par le plus court chemin', () => {
    expect(crankToward(0.1, Math.PI * 2 - 0.1, 1)).toBeCloseTo(-0.1);
    expect(crankToward(FOOT_CRANK + 0.4, FOOT_CRANK, 0.5)).toBeCloseTo(FOOT_CRANK + 0.2);
  });
  it('le pied part de la pédale, finit au sol, sort sur le côté entre les deux', () => {
    const pedal = new THREE.Vector3(0.12, 0.2, 0);
    const lean = -0.085;
    const ground = footGround(lean, 0, new THREE.Vector3());
    // Ramené dans le repère du sol, la semelle est bien à hauteur 0.
    expect(ground.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), lean).y).toBeCloseTo(-FOOT_SOLE_M);
    expect(footPath(pedal, ground, 0, new THREE.Vector3()).distanceTo(pedal)).toBeCloseTo(0);
    expect(footPath(pedal, ground, 1, new THREE.Vector3()).distanceTo(ground)).toBeCloseTo(0);
    expect(footPath(pedal, ground, 0.5, new THREE.Vector3()).x).toBeGreaterThan(Math.max(pedal.x, (pedal.x + ground.x) / 2));
  });
  it('bassin descendu juste assez pour que la jambe touche le sol', () => {
    const joint = new THREE.Vector3(0.09, 1.05, 0.1);
    const ankle = new THREE.Vector3(0.25, 0.08, 0.05);
    const leg = 0.86;
    const d = hipDrop(joint, ankle, leg);
    expect(joint.clone().setY(joint.y - d).distanceTo(ankle)).toBeLessThanOrEqual(leg * FOOT_REACH + 1e-6);
  });
});
