import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, decodeFace, encodeFace } from '@allezrobert/shared';
import { HANDLE_INDICES, STIFFNESS, alignTo, fitSliders, moveLandmark, normalizedShape, pointWeights, tameSliders, type Landmark } from '../src/onboarding/likenessFit.ts';
import { withLikeness } from '../src/ui/faceEditorLogic.ts';
import { beardAmount, beardFromImage, patchStats } from '../src/onboarding/beard.ts';

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

describe('ressemblance : points posés à la main', () => {
  const n = 468;
  const ref = Array.from({ length: n * 3 }, (_, i) => Math.sin(i * 0.77) * 0.6);
  const cal = (jac: number[][], sliders: string[]) => ({
    step: 1,
    count: n,
    lambda: 1e-4,
    sliders,
    ref,
    pairs: [...Array(n).keys()],
    base: ref.map(() => 0),
    jacobian: jac,
  });

  it('poids : moyenne 1, plus fort près des points posés', () => {
    const c = cal([], []);
    const w = pointWeights(c);
    expect(w).toHaveLength(n);
    expect(w.reduce((a, b) => a + b, 0) / n).toBeCloseTo(1, 6);
    expect(w[HANDLE_INDICES[0]] as number).toBeCloseTo(Math.max(...w), 6);
    expect(Math.min(...w)).toBeLessThan(w[HANDLE_INDICES[0]] as number);
    expect(pointWeights(c)).toEqual(w);
  });

  it('barbe : le bas du visage perd son poids, le haut le gagne', () => {
    // Visage de référence : y croît vers le bas ; lèvre du bas (14) au milieu.
    const r = Array.from({ length: n * 3 }, (_, i) => (i % 3 === 1 ? ((i / 3) % 50) / 50 : Math.sin(i * 0.9) * 0.5));
    const c = cal([], []);
    c.ref = r;
    const w0 = pointWeights(c, 0);
    const w1 = pointWeights(c, 1);
    const lipY = r[14 * 3 + 1] as number;
    const low = [...Array(n).keys()].find((k) => (r[k * 3 + 1] as number) > lipY + 0.4) as number;
    const high = [...Array(n).keys()].find((k) => (r[k * 3 + 1] as number) < lipY - 0.2) as number;
    expect(w1[low] as number).toBeLessThan((w0[low] as number) * 0.5);
    expect(w1[high] as number).toBeGreaterThan(w0[high] as number);
    expect(w1.reduce((a, b) => a + b, 0) / n).toBeCloseTo(1, 6);
  });

  it('l’ajustement pondéré suit les repères fiables plutôt que les repères devinés', () => {
    const j = ref.map((_, i) => Math.cos(i * 1.3) * 0.05);
    const c = cal([j], ['a']);
    const w = pointWeights(c);
    // Cible : vraie valeur 0,5 sur les repères proches des points posés, valeur absurde ailleurs.
    const f = ref.map((_, i) => (w[Math.floor(i / 3)] as number) > 1 ? 0.5 * (j[i] as number) : -0.8 * (j[i] as number));
    const plain = fitSliders(f, c).a as number;
    const weighted = fitSliders(f, c, undefined, w).a as number;
    expect(Math.abs(weighted - 0.5)).toBeLessThan(Math.abs(plain - 0.5));
  });

  it('un curseur raide s’écarte moins de la tête de base', () => {
    const j = ref.map((_, i) => Math.cos(i * 1.3) * 0.02);
    const c = cal([j, j.map((v) => v * 0.9)], ['faceFat', 'other']);
    const f = j.map((v) => 0.5 * v);
    const soft = fitSliders(f, c, 1e-3);
    const stiff = fitSliders(f, c, 1e-3, undefined, { faceFat: 50 });
    expect(Math.abs(stiff.faceFat as number)).toBeLessThan(Math.abs(soft.faceFat as number));
    expect(STIFFNESS.faceFat).toBeGreaterThan(1);
  });

  it('déplacer un point entraîne ses voisins, jamais les autres points posés', () => {
    const lm: Landmark[] = Array.from({ length: n }, (_, i) => ({ x: (i % 30) * 0.03, y: Math.floor(i / 30) * 0.03, z: 0 }));
    const cur = lm.map((l) => ({ ...l }));
    const h = HANDLE_INDICES[0];
    moveLandmark(lm, cur, h, 0.1, 0, 0.05);
    expect((cur[h] as Landmark).x).toBeCloseTo((lm[h] as Landmark).x + 0.1, 6);
    const other = HANDLE_INDICES[1];
    expect((cur[other] as Landmark).x).toBe((lm[other] as Landmark).x);
    const free = lm.findIndex((l, i) => i !== h && !(HANDLE_INDICES as readonly number[]).includes(i) && Math.hypot(l.x - (lm[h] as Landmark).x, l.y - (lm[h] as Landmark).y) < 0.04);
    expect((cur[free] as Landmark).x).toBeGreaterThan((lm[free] as Landmark).x);
  });
});

describe('ressemblance : barbe', () => {
  const patch = (w: number, h: number, f: (x: number, y: number) => number) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) d.set([f(x, y), f(x, y) * 0.8, f(x, y) * 0.7, 255], (y * w + x) * 4);
    return d;
  };
  // Pseudo-aléa déterministe.
  const noise = (x: number, y: number) => ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1;

  it('granularité et luminance d’une zone', () => {
    const smooth = patchStats(patch(30, 30, () => 180), 30, 30);
    const hairy = patchStats(patch(30, 30, (x, y) => 120 + noise(x, y) * 80), 30, 30);
    expect(smooth.tex).toBeCloseTo(0, 6);
    expect(smooth.lum).toBeGreaterThan(hairy.lum);
    expect(hairy.tex).toBeGreaterThan(10);
  });

  it('rasé : 0 ; barbe sombre et granuleuse : pleine ; ombre lisse : 0', () => {
    const cheek = { lum: 170, tex: 1.2 };
    expect(beardAmount([{ lum: 168, tex: 1.3 }, { lum: 165, tex: 1.5 }], cheek)).toBe(0);
    expect(beardAmount([{ lum: 100, tex: 9 }, { lum: 105, tex: 8 }, { lum: 110, tex: 8 }], cheek)).toBeGreaterThan(0.85);
    expect(beardAmount([{ lum: 150, tex: 1.4 }], cheek)).toBe(0);
    expect(beardAmount([], cheek)).toBe(0);
  });

  it('depuis une image : visage lisse → 0, bas du visage poilu → barbe', () => {
    const W = 200;
    const H = 200;
    const lm: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    const set = (i: number, x: number, y: number) => (lm[i] = { x: x / W, y: y / H, z: 0 });
    set(33, 60, 70); set(263, 140, 70); set(50, 65, 100); set(280, 135, 100);
    set(14, 100, 140); set(152, 100, 180); set(172, 60, 150); set(61, 80, 135); set(397, 140, 150); set(291, 120, 135);
    const src = (f: (x: number, y: number) => number) => {
      const d = patch(W, H, f);
      return { getImageData: (x: number, y: number, w: number, h: number) => ({ width: w, height: h, data: Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => d[((y + Math.floor(i / 4 / w)) * W + x + ((i / 4) % w | 0)) * 4 + (i % 4)] as number) }) };
    };
    expect(beardFromImage(src(() => 180), lm, W, H)).toBe(0);
    expect(beardFromImage(src((x, y) => (y > 125 ? 100 + noise(x, y) * 80 : 180)), lm, W, H)).toBeGreaterThan(0.8);
  });

  it('appliqué à la tenue : barbe de la photo', () => {
    const r = withLikeness({ ...DEFAULT_LOOK }, { skin: '#aa8866', hair: '#221100', beard: 0.7 });
    expect(r.beard).toBe(0.7);
    expect(withLikeness({ ...DEFAULT_LOOK, beard: 0.4 }, { skin: '#aa8866', hair: '#221100' }).beard).toBe(0.4);
  });
});
