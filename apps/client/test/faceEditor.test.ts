import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, decodeFace, withSex } from '@allezrobert/shared';
import { withBaseHead, withProfile, withRandomFace, withSlider } from '../src/ui/faceEditorLogic.ts';

describe('éditeur de visage', () => {
  it('curseur : seule la forme change ; morphologie féminine stockée en sex négatif', () => {
    const a = withSlider(DEFAULT_LOOK, 'jawWidth', 0.6);
    expect(decodeFace(a.face).jawWidth).toBeCloseTo(0.6, 1);
    const b = withSlider(a, 'sex', 1);
    expect(decodeFace(b.face).sex).toBeCloseTo(-1, 1);
    expect(b.jersey).toBe(DEFAULT_LOOK.jersey);
  });

  it('profil : visage, peau et coiffure du profil, maillot et vélo gardés', () => {
    const look = { ...DEFAULT_LOOK, jersey: '#123456', bikeModel: 's26-04-cervelo-s5' };
    const r = withProfile(look, 'robert');
    expect(r.moustache).toBe(true);
    expect(r.jersey).toBe('#123456');
    expect(r.bikeModel).toBe('s26-04-cervelo-s5');
    expect(decodeFace(r.face).age ?? 0).toBeGreaterThan(0.8);
  });

  it('aléatoire contrôlé (corps inchangé) ; tête de base', () => {
    const base = withProfile(DEFAULT_LOOK, 'julie');
    let i = 0;
    const r = withRandomFace(base, () => [0, 1][i++ % 2] as number);
    const before = decodeFace(base.face);
    const after = decodeFace(r.face);
    expect(after.muscle).toBeCloseTo(before.muscle ?? 0, 1);
    expect(Math.abs((after.noseLength ?? 0) - (before.noseLength ?? 0))).toBeLessThanOrEqual(0.36);
    const z = withBaseHead(r);
    expect(z.face).toBeUndefined();
    expect(z.moustache).toBeUndefined();
  });
});

describe('pilosité selon le sexe', () => {
  it('pas de barbe ni de moustache pour une femme (aléatoire, profil, photo)', () => {
    const woman = withSex(DEFAULT_LOOK, 'female');
    const r = withRandomFace({ ...woman, beard: 0.5, moustache: true });
    expect(r.beard).toBe(0);
    expect(r.moustache).toBe(false);
    // Un homme garde sa barbe et sa moustache.
    const man = withRandomFace({ ...DEFAULT_LOOK, beard: 0.5, moustache: true });
    expect(man.beard).toBe(0.5);
    expect(man.moustache).toBe(true);
  });
});
