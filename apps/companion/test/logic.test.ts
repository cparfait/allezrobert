import { describe, expect, it } from 'vitest';
import { STRINGS } from '../src/i18n.ts';
import { bandKind, neighbour, readTab, roadStep, stepValue, swipeDir, tabsFor, targetTone } from '../src/logic.ts';

describe('pages', () => {
  it('Groupe seulement s’il y a quelqu’un', () => {
    expect(tabsFor(null)).toEqual(['dash', 'music']);
    expect(tabsFor({ phase: 'menu', team: true })).toEqual(['dash', 'music']);
    expect(tabsFor({ phase: 'ride' })).toEqual(['dash', 'map', 'act', 'music']);
    expect(tabsFor({ phase: 'paused', team: true })).toContain('grp');
    expect(tabsFor({ phase: 'ride', multiplayer: true })).toContain('grp');
  });
  it('anciens onglets repris', () => {
    expect(readTab('ctrl')).toBe('act');
    expect(readTab('chat')).toBe('grp');
    expect(readTab('map')).toBe('map');
    expect(readTab('bidon')).toBe('dash');
    expect(readTab(null)).toBe('dash');
  });
  it('balayage : franc, horizontal, pas trop lent ; arrêt aux bouts', () => {
    expect(swipeDir(-120, 10, 200)).toBe(1);
    expect(swipeDir(120, -20, 200)).toBe(-1);
    expect(swipeDir(-40, 0, 200)).toBe(0);
    expect(swipeDir(-100, 80, 200)).toBe(0);
    expect(swipeDir(-200, 0, 1500)).toBe(0);
    const tabs = tabsFor({ phase: 'ride' });
    expect(neighbour(tabs, 'dash', -1)).toBe('dash');
    expect(neighbour(tabs, 'dash', 1)).toBe('map');
    expect(neighbour(tabs, 'music', 1)).toBe('music');
  });
});

describe('chiffres', () => {
  it('bandeau : séance, puis montée, sinon l’essentiel', () => {
    const w = { name: 's', targetWatts: 200, stepRemainingS: 10, remainingS: 10 };
    expect(bandKind({ workout: w }, true)).toBe('workout');
    expect(bandKind({ workout: { ...w, targetWatts: null } }, true)).toBe('climb');
    expect(bandKind({ workout: null }, false)).toBe('base');
  });
  it('cible de séance à ±5 %', () => {
    expect(targetTone(200, 200)).toBe('ok');
    expect(targetTone(189, 200)).toBe('low');
    expect(targetTone(211, 200)).toBe('high');
    expect(targetTone(46, 50)).toBe('ok');
  });
});

describe('réglages au − et au +', () => {
  it('calés sur le pas et bornés', () => {
    expect(stepValue(40, 1, 10)).toBe(50);
    expect(stepValue(43, 1, 10)).toBe(50);
    expect(stepValue(43, -1, 10)).toBe(40);
    expect(stepValue(0, -1, 10)).toBe(0);
    expect(stepValue(100, 1, 10)).toBe(100);
    // Volume venu du jeu en décimal (0,6 × 100 = 60,000…) : pas d'appui sans effet.
    expect(stepValue(0.1 * 3 * 100, 1, 10)).toBe(40);
    expect(stepValue(0.57 * 100, -1, 10)).toBe(50);
  });
  it('ressenti route : « très fort » demande un second appui', () => {
    expect(roadStep(50, 1, false)).toEqual({ value: 55, needsConfirm: false });
    expect(roadStep(55, 1, false)).toEqual({ value: 55, needsConfirm: true });
    expect(roadStep(55, 1, true)).toEqual({ value: 60, needsConfirm: false });
    expect(roadStep(60, 1, false)).toEqual({ value: 65, needsConfirm: false });
    expect(roadStep(80, 1, false).value).toBe(80);
    expect(roadStep(60, -1, false)).toEqual({ value: 55, needsConfirm: false });
  });
});

describe('textes', () => {
  it('mêmes clés en français et en anglais', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.fr).sort());
  });
});
