import { describe, expect, it } from 'vitest';
import { flatRoofKind, leanSide } from '../src/world/flatRoofs.ts';

describe('toits sans pente mesurée', () => {
  it('petite annexe en tuiles : appentis ; bac acier : métal ; le reste : terrasse', () => {
    expect(flatRoofKind('tiles', 'shed', 17)).toBe('lean');
    expect(flatRoofKind('tiles', 'house', 56)).toBe('lean');
    expect(flatRoofKind('tiles', 'house', 140)).toBe('terrace');
    expect(flatRoofKind('tiles', 'apartments', 60)).toBe('terrace');
    expect(flatRoofKind('metal', 'barn', 450)).toBe('steel');
    expect(flatRoofKind('metal', 'shed', 20)).toBe('steel');
    expect(flatRoofKind('concrete', 'house', 40)).toBe('terrace');
    expect(flatRoofKind(undefined, 'house', 40)).toBe('terrace');
    expect(flatRoofKind('slate', 'house', 40)).toBe('terrace');
  });

  it('appentis adossé au plus proche bâtiment plus grand que lui', () => {
    // appentis en (0, 0), pente selon +x ; maison de 120 m² à l'ouest, abri de 8 m² à l'est (plus proche)
    const others = [-8, 0, 120, 4, 0, 8, 0, 0, 20];
    expect(leanSide(0, 0, 1, 0, 20, others)).toBe(-1);
    // maison à l'est : côté haut vers +x
    expect(leanSide(0, 0, 1, 0, 20, [9, 1, 150])).toBe(1);
    // personne autour (au-delà de 25 m) : sens par défaut
    expect(leanSide(0, 0, 1, 0, 20, [-40, 0, 300])).toBe(1);
  });
});
