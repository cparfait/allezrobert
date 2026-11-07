import { describe, expect, it } from 'vitest';
import { nearRouteAxis, routeAxis } from '../src/world/buildings.ts';

describe('bâtiments et ruban de l’itinéraire', () => {
  // Itinéraire droit le long de x, ruban de 5 m (demi-chaussée 2,5 m), tolérance de 20 cm.
  const route = routeAxis([-100, 0, 0, 0, 100, 0], 2.5);
  const clear = 2.3;
  const square = (x: number, z: number, s: number) => [x, z, x + s, z, x + s, z + s, x, z + s];

  it('écarte une tour dont un coin mord sur la chaussée (Les Couloux, coin à 1,6 m de l’axe)', () => {
    expect(nearRouteAxis(square(10, 1.6, 4), route, clear)).toBe(true);
  });

  it('écarte un mur en travers de la route, coins de part et d’autre', () => {
    expect(nearRouteAxis([20, -8, 21, -8, 21, 8, 20, 8], route, clear)).toBe(true);
  });

  it('garde une maison alignée au bord de la chaussée', () => {
    expect(nearRouteAxis(square(10, 2.6, 8), route, clear)).toBe(false);
    expect(nearRouteAxis(square(10, -10.6, 8), route, clear)).toBe(false);
  });
});
