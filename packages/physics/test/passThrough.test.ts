import { describe, expect, it } from 'vitest';
import { BIKE_WIDTH_M, separateRiders, type Body } from '../src/collision.ts';

const step = (bodies: Body[], n: number) => {
  for (let i = 0; i < n; i++) {
    for (const b of bodies) b.distM += b.speedMs / 60;
    separateRiders(bodies, 3, 1 / 60);
  }
};

describe('traverser le coureur qu’on rattrape', () => {
  it('le joueur plus rapide passe au travers : l’IA garde sa ligne, personne n’est retenu ni ne recule', () => {
    const me: Body = { distM: 8, lateral: 0, speedMs: 12, priority: true, passThrough: true };
    const ai: Body = { distM: 10, lateral: 0.1, speedMs: 9 };
    let aiPrev = ai.distM;
    for (let i = 0; i < 120; i++) {
      step([me, ai], 1);
      expect(ai.lateral).toBe(0.1);
      expect(ai.distM).toBeGreaterThan(aiPrev);
      aiPrev = ai.distM;
    }
    expect(me.speedMs).toBe(12);
    expect(me.distM).toBeGreaterThan(ai.distM + 2);
  });

  it('sans traversée (comportement d’avant), l’IA s’écarte d’un bond', () => {
    const me: Body = { distM: 8, lateral: 0, speedMs: 12, priority: true };
    const ai: Body = { distM: 10, lateral: 0.1, speedMs: 9 };
    step([me, ai], 120);
    expect(Math.abs(ai.lateral - 0.1)).toBeGreaterThan(0.3);
  });

  it('côte à côte à la même vitesse : la séparation latérale reprend', () => {
    const me: Body = { distM: 10, lateral: 0, speedMs: 9, priority: true, passThrough: true };
    const ai: Body = { distM: 10.1, lateral: 0.2, speedMs: 9 };
    step([me, ai], 40);
    expect(Math.abs(ai.lateral - me.lateral)).toBeGreaterThanOrEqual(BIKE_WIDTH_M - 0.05);
  });

  it('les autres paires ne changent pas', () => {
    const me: Body = { distM: 0, lateral: -2, speedMs: 9, priority: true, passThrough: true };
    const a: Body = { distM: 8, lateral: 1, speedMs: 12 };
    const b: Body = { distM: 10, lateral: 1, speedMs: 8 };
    step([me, a, b], 60);
    expect(Math.abs(a.lateral - b.lateral) >= BIKE_WIDTH_M - 0.06 || b.distM - a.distM >= 1.79).toBe(true);
  });
});
