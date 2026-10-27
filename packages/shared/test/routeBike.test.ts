import { describe, expect, it } from 'vitest';
import { routeBike, routesForBike, type RouteBike } from '../src/route.ts';

describe('parcours par vélo', () => {
  const routes = [{ id: 'a' }, { id: 'b', bike: 'gravel' as const }, { id: 'c', bike: 'mtb' as const }, { id: 'd', bike: 'mtb' as const }];
  it('sans champ : route', () => expect(routeBike({})).toBe('road'));
  it('ne propose que les parcours du vélo équipé', () => {
    expect(routesForBike(routes, 'road').map((r) => r.id)).toEqual(['a']);
    expect(routesForBike(routes, undefined).map((r) => r.id)).toEqual(['a']);
    expect(routesForBike(routes, 'gravel').map((r) => r.id)).toEqual(['b']);
    expect(routesForBike(routes, 'mtb').map((r) => r.id)).toEqual(['c', 'd']);
  });
  it('zone sans parcours de ce type : tous, pour rester jouable', () => {
    // Type explicite : `{ id }` seul n'a aucune propriété commune avec la contrainte `{ bike? }` (type « faible »).
    const roadOnly: Array<{ id: string; bike?: RouteBike }> = [{ id: 'a' }];
    expect(routesForBike(roadOnly, 'mtb').map((r) => r.id)).toEqual(['a']);
  });
});
