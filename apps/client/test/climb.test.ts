import { describe, expect, it } from 'vitest';
import type { RouteHairpin } from '@allezrobert/shared';
import { HairpinWatcher, hairpinAltitude, hairpinShortName, hairpinToast, plaqueLines, reachedFinish, summitStats, vam } from '../src/game/climb.ts';
import { alpineProfile, coniferBiasAt, larchShareAt, snowCoverAt, treeDensityAt } from '../src/world/alpine.ts';

const h = (number: number, d: number, extra: Partial<RouteHairpin> = {}): RouteHairpin => ({ number, d, turnDeg: 180, radiusM: 8, altitudeM: 1000 + d / 10, ...extra });

describe('plaques des lacets', () => {
  it('raccourcit le nom du virage', () => {
    expect(hairpinShortName(h(21, 0, { name: 'Virage de la Savoyâte' }))).toBe('La Savoyâte');
    expect(hairpinShortName(h(20, 0, { name: 'Virage du Gêne Vignon' }))).toBe('Le Gêne Vignon');
    expect(hairpinShortName(h(19, 0, { name: 'Virage des Grangettes' }))).toBe('Les Grangettes');
    expect(hairpinShortName(h(7, 0, { name: 'Virage de Saint-Ferréol' }))).toBe('Saint-Ferréol');
    expect(hairpinShortName(h(9, 0, { name: 'Virage Celeste' }))).toBe('Celeste');
    expect(hairpinShortName(h(9, 0))).toBe('');
  });

  it('découpe les vainqueurs de l’inscription', () => {
    expect(plaqueLines('1952 Fausto Coppi (Italie) - 2001 Lance Armstrong (U.S.A)')).toEqual(['1952 Fausto Coppi (Italie)', '2001 Lance Armstrong (U.S.A)']);
    expect(plaqueLines('1988 - Steven Rooks (Pays-Bas)')).toEqual(['1988 Steven Rooks (Pays-Bas)']);
    expect(plaqueLines(undefined)).toEqual([]);
  });

  it('annonce le virage avec l’altitude du panneau', () => {
    const v = h(7, 8611, { signAltitudeM: 1390 });
    expect(hairpinAltitude(v)).toBe(1390);
    expect(hairpinToast(v, true)).toBe('Virage 7 · 1 390 m');
    expect(hairpinToast(v, false)).toBe('Hairpin 7 · 1,390 m');
    expect(hairpinToast(h(21, 1945, { altitudeM: 807.1 }), true)).toBe('Virage 21 · 807 m');
  });
});

describe('passage des lacets', () => {
  it('signale chaque virage franchi une seule fois, en montant', () => {
    const w = new HairpinWatcher([h(20, 2635), h(21, 1945), { d: 3000, turnDeg: 170, radiusM: 9, altitudeM: 950 }]);
    expect(w.update(1900, 1940)).toBeNull();
    expect(w.update(1940, 1950)?.number).toBe(21);
    expect(w.update(1950, 1940)).toBeNull();
    expect(w.update(1940, 1950)).toBeNull();
    // saut de plusieurs virages : un par appel, dans l'ordre
    expect(w.update(2600, 3100)?.number).toBe(20);
    expect(w.update(3100, 3200)).toBeNull();
  });
});

describe('arrivée au sommet', () => {
  it('ne vaut que pour un aller simple, dans le sens de marche', () => {
    expect(reachedFinish(false, 1, 15010.5, 15010.87)).toBe(true);
    expect(reachedFinish(false, 1, 14000, 15010.87)).toBe(false);
    expect(reachedFinish(true, 1, 16000, 15010.87)).toBe(false);
    expect(reachedFinish(false, -1, 15010.87, 15010.87)).toBe(false);
  });

  it('calcule W/kg et VAM, montée comprise', () => {
    expect(vam(1000, 3600)).toBe(1000);
    expect(vam(-5, 100)).toBe(0);
    const s = summitStats({ elapsedS: 3000, distanceM: 15000, elevationGainM: 1150, avgWatts: 240, massKg: 75, kom: { name: 'Alpe', timeS: 2880, avgWatts: 250, climbM: 1080, recordS: null } });
    expect(s.wkg).toBeCloseTo(3.2, 5);
    expect(s.vam).toBeCloseTo(1380, 5);
    expect(s.kom?.wkg).toBeCloseTo(250 / 75, 5);
    expect(s.kom?.vam).toBeCloseTo(1350, 5);
  });
});

describe('étagement montagnard', () => {
  it('éclaircit la forêt à la limite des arbres', () => {
    const tl = alpineProfile('alpe-dhuez').treelineM;
    expect(treeDensityAt(1500, tl)).toBe(1);
    expect(treeDensityAt(2150, tl)).toBeGreaterThan(0);
    expect(treeDensityAt(2150, tl)).toBeLessThan(1);
    expect(treeDensityAt(2300, tl)).toBe(0);
    expect(alpineProfile('mont-ventoux').treelineM).toBeLessThan(tl);
  });

  it('passe aux conifères puis aux mélèzes en altitude', () => {
    expect(coniferBiasAt(200)).toBe(0);
    expect(coniferBiasAt(1400)).toBeGreaterThan(1);
    expect(larchShareAt(1000, 2150)).toBe(0);
    expect(larchShareAt(2050, 2150)).toBeGreaterThan(0.5);
  });

  it('enneige selon la saison', () => {
    expect(snowCoverAt(1850, 'summer')).toBe(0);
    expect(snowCoverAt(1850, 'winter')).toBe(1);
    expect(snowCoverAt(3300, 'summer')).toBe(1);
    expect(snowCoverAt(150, 'winter')).toBe(0);
  });
});
