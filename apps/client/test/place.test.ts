import { describe, expect, it } from 'vitest';
import parisPlaces from '../public/worlds/idf-paris/places.json';
import { PlaceFinder } from '../src/game/place.ts';

const parisOrigin = { x: 648000, y: 6868000 };

describe('Commune affichée dans le HUD', () => {
  it('affiche Paris au départ et à l’arrivée du test sur les Champs-Élysées', () => {
    const places = new PlaceFinder(parisPlaces, undefined, 1228, false, parisOrigin);
    expect(places.at(512, 4127, 0)).toBe('Paris');
    expect(places.at(1293, 4512, 1228)).toBe('Paris');
  });

  it('ne réutilise pas le nom de Levallois en franchissant la limite communale', () => {
    const places = new PlaceFinder(parisPlaces, undefined, 100, false, parisOrigin);
    expect(places.at(-200, 2450, 0)).toBe('Levallois-Perret');
    expect(places.at(-200, 2470, 20)).toBe('Paris');
    expect(places.at(-200, 2450, 40)).toBe('Levallois-Perret');
  });

  it('détecte Paris depuis un monde voisin avec une autre origine', () => {
    const places = new PlaceFinder(undefined, undefined, 1228, false, { x: 649000, y: 6870000 });
    expect(places.at(-488, 6127, 0)).toBe('Paris');
  });

  it('conserve les repères d’itinéraire sur un monde sans coordonnées géographiques', () => {
    const places = new PlaceFinder(undefined, [{ name: 'Hameau', d: 500 }], 1000, false);
    expect(places.at(0, 0, 510)).toBe('Hameau');
  });
});
