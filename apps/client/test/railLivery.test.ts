import { describe, expect, it } from 'vitest';
import { DEFAULT_RAIL_COLOR, railColor, railService, SERVICE_COLORS } from '../src/world/railLivery.ts';

describe('railLivery', () => {
  it('reconnaît les noms OSM des voies franciliennes', () => {
    expect(railService('Ligne des Invalides à Versailles-Rive-Gauche')).toBe('C');
    expect(railService('Ligne de Sceaux')).toBe('B');
    expect(railService('Ligne de Sceaux (RER B4)')).toBe('B');
    expect(railService('RER A')).toBe('A');
    expect(railService('RER B (B6)')).toBe('B');
    expect(railService('RER B - Ligne de Sceaux;RER D - Ligne de Gare du Nord à Gare de Lyon')).toBe('B');
    expect(railService('Voie de Garage des trains de la ligne B du RER à Massy-Palaiseau')).toBe('B');
    expect(railService('Ligne de Paris-Est à Pont-Cardinet (EOLE)')).toBe('E');
    expect(railService('Ligne de Paris-Lyon à Marseille-Saint-Charles')).toBe('D');
    expect(railService('Ligne de Paris-Montparnasse à Brest')).toBe('N');
    expect(railService('Ligne de Paris-Saint-Lazare à Versailles-Rive-Droite')).toBe('L');
    expect(railService('Ligne de Paris-Saint-Lazare à Mantes-Station par Conflans-Sainte-Honorine')).toBe('J');
    expect(railService('Ligne de Paris à Saint-Germain-en-Laye')).toBe('A');
    expect(railService('Ligne de Paris-Saint-Lazare à Saint-Germain-en-Laye')).toBe('L');
  });

  it('laisse la couleur neutre aux LGV, voies de service et voies sans nom', () => {
    expect(railService('Ligne de Paris-Montparnasse à Monts (LGV)')).toBeNull();
    expect(railService('Voie 4')).toBeNull();
    expect(railService(undefined)).toBeNull();
    expect(railColor(undefined)).toBe(DEFAULT_RAIL_COLOR);
  });

  it('donne les couleurs officielles IDFM', () => {
    expect(railColor('Ligne des Invalides à Versailles-Rive-Gauche')).toBe(SERVICE_COLORS.C);
    expect(SERVICE_COLORS.A).toBe(0xeb2132);
  });
});
