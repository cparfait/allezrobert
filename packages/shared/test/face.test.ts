import { describe, expect, it } from 'vitest';
import { FACE_CODE_LENGTH, FACE_CODE_RE, FACE_SLIDERS, decodeFace, encodeFace } from '../src/face.ts';

describe('curseurs de forme', () => {
  it('42 curseurs, identifiants uniques, code de 56 caractères', () => {
    expect(FACE_SLIDERS).toHaveLength(42);
    expect(new Set(FACE_SLIDERS.map((s) => s.id)).size).toBe(42);
    expect(FACE_CODE_LENGTH).toBe(56);
  });

  it('aller-retour à 1/127 près', () => {
    const shape = { jawWidth: 1, noseTip: -1, age: 0.5, originAfrican: 0.33, mouthCorners: -0.02 };
    const code = encodeFace(shape);
    expect(code).toMatch(FACE_CODE_RE);
    const back = decodeFace(code);
    for (const [k, v] of Object.entries(shape)) expect(back[k as keyof typeof back]).toBeCloseTo(v, 2);
    expect(Object.keys(back)).toHaveLength(Object.keys(shape).length);
  });

  it('tête de base : code neutre, décodage vide ; valeurs hors bornes ramenées à ±1', () => {
    expect(decodeFace(encodeFace({}))).toEqual({});
    expect(decodeFace(encodeFace({ eyeSize: 7, cheekbones: Number.NaN }))).toEqual({ eyeSize: 1 });
  });

  it('code invalide ignoré', () => {
    expect(decodeFace('abc')).toEqual({});
    expect(decodeFace(`${'A'.repeat(55)}!`)).toEqual({});
    expect(decodeFace(undefined)).toEqual({});
  });
});

describe('profils de base', () => {
  it('9 profils, tenues valides, âges cohérents', async () => {
    const { BASE_PROFILES, profileLook, ageSlider } = await import('../src/profiles.ts');
    expect(BASE_PROFILES).toHaveLength(9);
    expect(ageSlider(25)).toBe(0);
    expect(ageSlider(77)).toBeCloseTo(1);
    expect(ageSlider(19)).toBeCloseTo(-1);
    for (const p of BASE_PROFILES) {
      const look = profileLook(p);
      expect(look.face).toMatch(FACE_CODE_RE);
      expect(decodeFace(look.face).age ?? 0).toBeCloseTo(ageSlider(p.ageYears), 1);
      expect(look.skin).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
