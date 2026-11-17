import { describe, expect, it } from 'vitest';
import { cadenceLabel, levelOfFtpWkg } from '../src/hud/riderLevel.ts';

describe('niveau et cadence dans « À proximité »', () => {
  it('classe la FTP en W/kg sur l’échelle des cyclistes croisés', () => {
    expect(levelOfFtpWkg(1.8)).toBe('loisir');
    expect(levelOfFtpWkg(2.8)).toBe('régulier');
    expect(levelOfFtpWkg(3.6)).toBe('sportif');
    expect(levelOfFtpWkg(4.8)).toBe('pro');
    expect(levelOfFtpWkg(Number.NaN)).toBe('');
  });
  it('affiche la cadence seulement quand on pédale', () => {
    expect(cadenceLabel(87.6, true)).toBe('88 tr/min');
    expect(cadenceLabel(90, false)).toBe('90 rpm');
    expect(cadenceLabel(0, true)).toBe('');
    expect(cadenceLabel(undefined, true)).toBe('');
  });
});
