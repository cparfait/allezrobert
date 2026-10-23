import { describe, expect, it } from 'vitest';
import { RouteTimer } from '../src/game/efforts.ts';

describe('temps du parcours entier', () => {
  it('aller simple : du départ à l’arrivée', () => {
    const t = new RouteTimer(true);
    expect(t.bestS).toBeNull();
    t.finish(3605);
    expect(t.bestS).toBe(3605);
  });

  it('parti en cours de route : pas de temps du parcours', () => {
    const t = new RouteTimer(false);
    t.finish(1200);
    expect(t.bestS).toBeNull();
    // une boucle commencée ailleurs : le premier tour est incomplet, le deuxième compte
    t.lap(800);
    t.lap(2600);
    expect(t.bestS).toBe(1800);
  });

  it('boucle : meilleur tour complet', () => {
    const t = new RouteTimer(true);
    t.lap(1900);
    t.lap(3700); // 1 800 s
    t.lap(5600); // 1 900 s
    expect(t.bestS).toBe(1800);
    expect(t.times).toEqual([1900, 1800, 1900]);
  });

  it('boucle : chaque tour rend son temps, et s’il bat les précédents', () => {
    const t = new RouteTimer(false);
    expect(t.lap(300)).toBeNull(); // tour commencé en cours de route
    expect(t.lap(500)).toEqual({ timeS: 200, best: false });
    expect(t.lap(690)).toEqual({ timeS: 190, best: true });
    expect(t.lap(900)).toEqual({ timeS: 210, best: false });
  });
});
