import { describe, expect, it } from 'vitest';
import { COSMETICS, JERSEY_PACKS, jerseyLookOf } from '../src/index.ts';

const jerseys = COSMETICS.filter((c) => c.slot === 'jersey');
const STYLES = ['uni', 'bandes', 'pois', 'manches', 'moitie', 'degrade', 'chevrons'];
const HEX = /^#[0-9a-f]{6}$/i;

describe('maillots du catalogue', () => {
  it('identifiants uniques, packs connus, couleurs valides', () => {
    expect(new Set(COSMETICS.map((c) => c.id)).size).toBe(COSMETICS.length);
    for (const c of jerseys) {
      if (c.pack) expect(JERSEY_PACKS.map((p) => p.id), c.id).toContain(c.pack);
      expect(c.color, c.id).toMatch(HEX);
      if (c.jersey?.style) expect(STYLES, c.id).toContain(c.jersey.style);
      if (c.jersey?.accent) expect(c.jersey.accent, c.id).toMatch(HEX);
      for (const b of c.jersey?.bands ?? []) expect(b, c.id).toMatch(HEX);
    }
  });

  it('pack Tour de France : jaune, vert, pois rouges sur blanc, blanc', () => {
    const tour = jerseys.filter((c) => c.pack === 'tour').map((c) => c.id);
    expect(tour.sort()).toEqual(['jersey-leader-blanc', 'jersey-leader-jaune', 'jersey-leader-vert', 'jersey-pois']);
    const pois = jerseyLookOf(jerseys.find((c) => c.id === 'jersey-pois')!);
    expect(pois).toMatchObject({ jersey: '#ffffff', jerseyStyle: 'pois' });
    expect(pois.jerseyAccent).toMatch(HEX);
  });

  it('styles à deux couleurs : seconde couleur donnée (accent) ; bandes : liste de bandes', () => {
    for (const c of jerseys) {
      const s = c.jersey?.style;
      if (s && ['pois', 'manches', 'moitie', 'degrade', 'chevrons'].includes(s)) expect(c.jersey?.accent, c.id).toBeTruthy();
      if (s === 'bandes') expect(c.jersey?.bands?.length, c.id).toBeGreaterThan(0);
    }
  });

  it('pack Équipes pro : une vingtaine de maillots', () => {
    expect(jerseys.filter((c) => c.pack === 'pro').length).toBeGreaterThanOrEqual(20);
  });
});
