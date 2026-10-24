import { describe, expect, it } from 'vitest';
import { BASE_PROFILES, decodeFace, lookSex, profileLook, withSex } from '../src/index.ts';


describe('withSex', () => {
  it('passe un homme en femme et retour sans toucher aux autres curseurs', () => {
    const robert = BASE_PROFILES.find((p) => p.id === 'robert');
    if (!robert) throw new Error('robert');
    const man = profileLook(robert);
    const woman = withSex(man, 'female');
    expect(lookSex(man)).toBe('male');
    expect(lookSex(woman)).toBe('female');
    expect(woman.moustache).toBe(false);
    expect(woman.hairStyle).toBe(1);
    const back = decodeFace(withSex(woman, 'male').face);
    const orig = decodeFace(man.face);
    for (const k of Object.keys(orig) as Array<keyof typeof orig>) expect(back[k] ?? 0).toBeCloseTo(orig[k] ?? 0, 1);
  });
});
