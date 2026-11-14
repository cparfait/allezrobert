import { describe, expect, it } from 'vitest';
import { bikeById, type BikeBuild } from '@allezrobert/shared';
import { DECALS, MARKS, frameMarks } from '../src/rider/wordmarks.ts';

describe('emplacements des inscriptions', () => {
  it('ordre des lignes de texture : les six historiques puis les haubans', () => {
    expect(MARKS).toEqual(['dt', 'tt', 'st', 'fork', 'cs', 'ttf', 'ss']);
    expect(DECALS).toEqual(['decal_dt', 'decal_tt', 'decal_st', 'decal_fork', 'decal_cs', 'decal_ttf', 'decal_ss']);
  });

  it('vélo du catalogue sans graphisme : six premiers emplacements inchangés, haubans vides', () => {
    const b = bikeById('s26-59-lidl-madone-gen8-pedersen') as BikeBuild;
    const m = frameMarks(b);
    expect(m.slice(0, 6)).toEqual(['dt', 'tt', 'st', 'fork', 'cs', 'ttf'].map((k) => (b.livery.marks as Record<string, unknown>)[k] ?? null));
    expect(m[6]).toBeNull();
  });

  it('graphismes : couleur imposée, le texte l’emporte au même emplacement, affichés même sans marque', () => {
    const base = bikeById('div-specialized-roubaix-sport-2020') as BikeBuild;
    const b: BikeBuild = { ...base, livery: { ...base.livery, marks: { dt: { text: 'SPECIALIZED', color: '#d7262e' }, ss: { text: 'ROUBAIX', color: '#d7262e' } }, graphics: { ttf: { shape: 'stripes', color: '#4a4d53' }, fork: { shape: 'stripes', color: '#4a4d53' }, ss: { shape: 'stripes', color: '#000000' } } } };
    const m = frameMarks(b);
    expect(m[MARKS.indexOf('ttf')]).toEqual({ shape: 'stripes', color: '#4a4d53' });
    expect(m[MARKS.indexOf('fork')]).toEqual({ shape: 'stripes', color: '#4a4d53' });
    expect(m[MARKS.indexOf('ss')]).toEqual({ text: 'ROUBAIX', color: '#d7262e' });
    const sansMarque = frameMarks({ ...b, brand: undefined });
    expect(sansMarque[MARKS.indexOf('dt')]).toBeNull();
    expect(sansMarque[MARKS.indexOf('ttf')]).toEqual({ shape: 'stripes', color: '#4a4d53' });
  });
});
