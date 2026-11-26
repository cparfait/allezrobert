import { describe, expect, it } from 'vitest';
import { activityTitle, weatherPoint } from '../src/game/virtualRide.ts';

const ISLAND = { x: 95000, y: 6815000 };
const REAL = { x: 646000, y: 6861500 };

describe("sorties de l'île", () => {
  it('sont annoncées comme virtuelles, une seule fois', () => {
    expect(activityTitle('Le front de mer', ISLAND)).toBe('Allez Robert ! — Le front de mer (sortie virtuelle)');
    expect(activityTitle(activityTitle('Le front de mer', ISLAND), ISLAND)).toBe('Allez Robert ! — Le front de mer (sortie virtuelle)');
    expect(activityTitle("L'anneau de Longchamp", REAL)).toBe("Allez Robert ! — L'anneau de Longchamp");
  });

  it('prennent la météo de la ville du joueur, Paris sans ville', () => {
    const lyon = { name: 'Lyon', code: '69001', lat: 45.758, lon: 4.835 };
    expect(weatherPoint(ISLAND, () => ({ lat: 48, lon: -8 }), lyon)).toEqual({ lat: 45.758, lon: 4.835, city: 'Lyon' });
    expect(weatherPoint(REAL, () => ({ lat: 48.86, lon: 2.23 }), lyon)).toEqual({ lat: 48.86, lon: 2.23 });
    expect(weatherPoint(ISLAND, () => ({ lat: 48, lon: -8 }))).toEqual({ lat: 48.8566, lon: 2.3522, city: 'Paris' });
    expect(weatherPoint(REAL, () => ({ lat: 48.86, lon: 2.23 }))).toEqual({ lat: 48.86, lon: 2.23 });
  });

  it('valent aussi pour le Pays de Robert (second monde Poly)', () => {
    const LAND = { x: 1330000, y: 6000000 };
    expect(activityTitle('Le col de l’Aigle', LAND)).toBe('Allez Robert ! — Le col de l’Aigle (sortie virtuelle)');
    expect(weatherPoint(LAND, () => ({ lat: 42, lon: 9 }))).toEqual({ lat: 48.8566, lon: 2.3522, city: 'Paris' });
  });
});

