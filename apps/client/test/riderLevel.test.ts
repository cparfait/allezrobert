import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getLang, setLang, type Lang } from '../src/i18n/index.ts';
import { cadenceLabel, levelOfFtpWkg } from '../src/hud/riderLevel.ts';

describe('niveau et cadence dans « À proximité »', () => {
  let before: Lang;
  beforeAll(() => {
    vi.stubGlobal('document', { documentElement: {} });
    before = getLang();
    setLang('fr');
  });
  afterAll(() => {
    setLang(before);
    vi.unstubAllGlobals();
  });
  it('classe la FTP en W/kg sur l’échelle des cyclistes croisés', () => {
    expect(levelOfFtpWkg(1.8)).toBe('loisir');
    expect(levelOfFtpWkg(2.8)).toBe('régulier');
    expect(levelOfFtpWkg(3.6)).toBe('sportif');
    expect(levelOfFtpWkg(4.8)).toBe('pro');
    expect(levelOfFtpWkg(Number.NaN)).toBe('');
  });
  it('affiche la cadence seulement quand on pédale, dans la langue choisie', () => {
    expect(cadenceLabel(87.6)).toBe('88 tr/min');
    expect(cadenceLabel(0)).toBe('');
    expect(cadenceLabel(undefined)).toBe('');
    setLang('en');
    expect(cadenceLabel(90)).toBe('90 rpm');
    expect(levelOfFtpWkg(1.8)).toBe('leisure');
    setLang('fr');
  });
});
