import { describe, expect, it } from 'vitest';
import { AI_NATIONS, COUNTRIES, COUNTRY_CODE_RE, aiIdentity, countryName, flagEmoji } from '../src/index.ts';

describe('nationalités', () => {
  it('drapeau émoji et nom du pays', () => {
    expect(flagEmoji('FR')).toBe('\u{1F1EB}\u{1F1F7}');
    expect(flagEmoji('xx')).toBe('');
    expect(flagEmoji(undefined)).toBe('');
    expect(countryName('ES', 'fr')).toBe('Espagne');
    expect(countryName('ES', 'en')).toBe('Spain');
    expect(COUNTRIES.every((c) => COUNTRY_CODE_RE.test(c.code))).toBe(true);
  });

  it('noms des IA : « Prénom NOM » de leur nationalité, genre respecté, sans doublon dans une salle', () => {
    const ids = Array.from({ length: 19 }, (_, k) => aiIdentity(k, k % 2 === 1));
    for (const id of ids) {
      expect(AI_NATIONS).toContain(id.nationality);
      expect(id.name).toMatch(/^\S+ \S/);
      const last = id.name.split(' ').slice(1).join(' ');
      expect(last).toBe(last.toLocaleUpperCase('fr'));
    }
    expect(new Set(ids.map((i) => i.name)).size).toBe(ids.length);
    expect(aiIdentity(0, false).nationality).toBe('FR');
    expect(aiIdentity(1, true).nationality).toBe('ES');
    // Mêmes entrées, mêmes noms.
    expect(aiIdentity(7, true)).toEqual(aiIdentity(7, true));
  });
});
