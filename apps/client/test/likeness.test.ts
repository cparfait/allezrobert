import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, decodeFace, encodeFace } from '@allezrobert/shared';
import { alignTo, fitSliders, normalizedShape, tameSliders, type Landmark } from '../src/onboarding/likenessFit.ts';
import { withLikeness } from '../src/ui/faceEditorLogic.ts';

describe('ressemblance : ajustement', () => {
  const pts = (n: number, f: (i: number) => [number, number, number]): Landmark[] => Array.from({ length: n }, (_, i) => {
    const [x, y, z] = f(i);
    return { x, y, z };
  });
  const face = pts(478, (i) => [0.5 + Math.sin(i * 1.7) * 0.2, 0.5 + Math.cos(i * 0.9) * 0.25, Math.sin(i * 0.37) * 0.06]);

  it('forme invariante à l’échelle, à la position et à la rotation', () => {
    const ref = normalizedShape(face, 1);
    const a = 0.4;
    const moved = face.map((p) => {
      const x = p.x - 0.5;
      const z = p.z;
      return { x: 0.3 + 0.6 * (x * Math.cos(a) + z * Math.sin(a)), y: 0.2 + 0.6 * (p.y - 0.5), z: 0.6 * (-x * Math.sin(a) + z * Math.cos(a)) };
    });
    const back = alignTo(normalizedShape(moved, 1), ref);
    back.forEach((v, i) => expect(v).toBeCloseTo(ref[i] as number, 4));
  });

  it('retrouve les curseurs d’un étalonnage linéaire', () => {
    const base = normalizedShape(face, 1);
    const jacobian = [0, 1, 2].map((k) => base.map((_, i) => (i % 3 === k ? 0.01 * Math.sin(i * (k + 1)) : 0.002 * Math.cos(i * (k + 2)))));
    const cal = { step: 1, count: 468, lambda: 1e-6, sliders: ['a', 'b', 'c'], ref: base, pairs: [...Array(468).keys()], base, jacobian };
    const truth = [0.6, -0.4, 0.3];
    const f = base.map((b, i) => b + truth.reduce((s, t, k) => s + t * (jacobian[k]?.[i] ?? 0), 0));
    const fit = fitSliders(f, cal);
    ['a', 'b', 'c'].forEach((s, k) => expect(fit[s]).toBeCloseTo(truth[k] as number, 1));
    // Bornes.
    const far = base.map((b, i) => b + 3 * (jacobian[0]?.[i] ?? 0));
    expect(fitSliders(far, cal).a).toBe(1);
  });

  it('appliqué à la tenue : visage, teint et cheveux ; corps gardé', () => {
    const look = { ...DEFAULT_LOOK, face: encodeFace({ muscle: 0.5, jawWidth: -0.5 }) };
    const r = withLikeness(look, { skin: '#aa8866', hair: '#221100', face: { jawWidth: 0.4, noseLength: -0.3 } });
    const s = decodeFace(r.face);
    expect(s.muscle).toBeCloseTo(0.5, 1);
    expect(s.jawWidth).toBeCloseTo(0.4, 1);
    expect(s.noseLength).toBeCloseTo(-0.3, 1);
    expect(r.skin).toBe('#aa8866');
  });
});

describe('ressemblance : pas de tête déformée', () => {
  it('plafonne et ramène les curseurs vers la tête de base', () => {
    const t = tameSliders({ headWidth: 1, headLength: -1, faceFat: 1, noseLength: -1, eyeSize: 0.2 });
    expect(Math.abs(t.headWidth as number)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(t.headLength as number)).toBeLessThanOrEqual(0.3);
    expect(t.faceFat).toBeLessThanOrEqual(0.45);
    expect(Math.abs(t.noseLength as number)).toBeLessThanOrEqual(0.7);
    expect(t.eyeSize).toBeCloseTo(0.16, 2);
  });
});
