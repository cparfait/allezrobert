import { describe, expect, it } from 'vitest';
import { DOOR_FLOOR, eaveHeight } from '../src/world/eaveHeight.ts';

describe('hauteur des murs (égout)', () => {
  it('mesurée au LiDAR : gardée, même pour un « R+1 » sous combles', () => {
    // faîtage 7,5 m, toit 4,2 m : égout 3,3 m, alors que 2 niveaux en imposaient 5,3
    expect(eaveHeight({ total: 7.5, roofH: 4.2, rise: 0, levels: 2, utility: false, measured: true })).toBeCloseTo(3.3);
  });

  it('mesurée mais trop basse : de quoi passer une porte au-dessus du sol amont', () => {
    expect(eaveHeight({ total: 4, roofH: 2.2, rise: 0, levels: 1, utility: false, measured: true })).toBeCloseTo(DOOR_FLOOR);
    // en pente : 2,5 m au-dessus du sol amont, 3 m plus haut que le point bas
    expect(eaveHeight({ total: 7, roofH: 3, rise: 3, levels: 1, utility: false, measured: true })).toBeCloseTo(DOOR_FLOOR + 3);
    // maison bâtie dans la pente, égout mesuré assez haut côté amont : inchangé
    expect(eaveHeight({ total: 9, roofH: 3, rise: 3, levels: 2, utility: false, measured: true })).toBeCloseTo(6);
  });

  it('sans mesure (OSM) : un étage par niveau, plafonné à trois niveaux et à 1,25 × la hauteur', () => {
    expect(eaveHeight({ total: 8.8, roofH: 4.5, rise: 0, levels: 2, utility: false, measured: false })).toBeCloseTo(5.3);
    expect(eaveHeight({ total: 14, roofH: 3, rise: 0, levels: 11, utility: false, measured: false })).toBeCloseTo(11);
    expect(eaveHeight({ total: 3.5, roofH: 2, rise: 0, levels: 3, utility: false, measured: false })).toBeCloseTo(4.375);
  });

  it('annexes et édifices : 2,4 m au-dessus du sol amont', () => {
    expect(eaveHeight({ total: 3, roofH: 1.5, rise: 1, utility: true, measured: true })).toBeCloseTo(3.4);
  });
});
