import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cityOf, foldName, parseCommunes, searchCommunes } from '../src/game/communes.ts';

const index = parseCommunes(readFileSync(resolve(import.meta.dirname, '../public/geo/communes-fr.txt'), 'utf8'));
const names = (q: string) => searchCommunes(index, q).map((c) => c.name);

describe('communes françaises', () => {
  it('contient toutes les communes, outre-mer compris, avec des centres plausibles', () => {
    expect(index.list.length).toBeGreaterThan(34_800);
    for (const c of index.list) {
      expect(Math.abs(c.lat)).toBeLessThan(80);
      expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
      expect(c.codes.length).toBeGreaterThan(0);
    }
    expect(names('Saint-Denis').length).toBeGreaterThan(1);
    expect(names('Papeete')).toContain('Papeete');
  });

  it('trouve sans accents, sans tirets et avec « st »', () => {
    expect(foldName('Saint-Étienne')).toBe('st etienne');
    expect(names('st etienne')[0]).toBe('Saint-Étienne');
    expect(names('PARIS')[0]).toBe('Paris');
    expect(names("l'hay les")[0]).toBe("L'Haÿ-les-Roses");
    expect(names('clermont f')[0]).toBe('Clermont-Ferrand');
  });

  it('trouve par code postal et garde celui saisi', () => {
    const paris = searchCommunes(index, '75011')[0]!;
    expect(paris.name).toBe('Paris');
    expect(cityOf(paris, '75011')).toMatchObject({ name: 'Paris', code: '75011' });
    expect(cityOf(paris).code).toBe('75001');
    expect(names('63000')[0]).toBe('Clermont-Ferrand');
  });

  it('ne propose rien pour une saisie trop courte ou inconnue', () => {
    expect(names('p')).toEqual([]);
    expect(names('zzzzqq')).toEqual([]);
  });
});
