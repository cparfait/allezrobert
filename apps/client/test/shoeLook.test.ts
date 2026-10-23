import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, SHOE_MARKS } from '@allezrobert/shared';
import { luminance, shoeAccentOf, shoeColorOf, shoeDialOf, shoeMarkText } from '../src/rider/shoeLook.ts';

describe('couleurs dérivées des chaussures', () => {
  it('molettes blanches sur chaussure claire, noires sur chaussure rouge ou noire', () => {
    expect(shoeDialOf({ ...DEFAULT_LOOK, shoes: '#f2f2f2' })).toBe('#f4f4f4');
    expect(shoeDialOf({ ...DEFAULT_LOOK, shoes: '#c8102e' })).toBe('#16171a');
    expect(shoeDialOf({ ...DEFAULT_LOOK, shoes: '#111111' })).toBe('#16171a');
  });

  it('accent : choisi, sinon gris sur chaussure claire et blanc sur chaussure foncée', () => {
    expect(shoeAccentOf({ ...DEFAULT_LOOK, shoes: '#f2f2f2', shoeAccent: '#ff5fa2' })).toBe('#ff5fa2');
    expect(shoeAccentOf({ ...DEFAULT_LOOK, shoes: '#f2f2f2' })).toBe('#8a9099');
    expect(shoeAccentOf({ ...DEFAULT_LOOK, shoes: '#111111' })).toBe('#f2f2f2');
  });

  it('profil ancien sans chaussures : blanc par défaut, sans marquage', () => {
    const { shoes: _s, ...old } = DEFAULT_LOOK;
    expect(shoeColorOf(old)).toBe('#f2f2f2');
    expect(shoeMarkText(old)).toBeNull();
  });

  it('marquages connus', () => {
    for (const m of SHOE_MARKS) expect(shoeMarkText({ ...DEFAULT_LOOK, shoeMark: m.id })).toBe(m.text);
  });

  it('luminance', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBe(0);
    expect(luminance('pas une couleur')).toBe(1);
  });
});
