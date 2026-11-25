import { describe, expect, it } from 'vitest';
import { DirecteurSportif, dsTarget, type DsInput } from '../src/game/directeur.ts';

const base: DsInput = { watts3s: 200, ftpWatts: 280, gradePercent: 0, timeTrial: false, gapAheadM: 2, gapBehindM: 2, speedMs: 11, remainingM: null, attacks: [], cracks: [] };
const run = (ds: DirecteurSportif, s: Partial<DsInput>, seconds: number) => {
  const out = [];
  for (let t = 0; t < seconds; t += 0.5) out.push(...ds.update(0.5, { ...base, ...s }));
  return out;
};

describe('directeur sportif', () => {
  it('cible tirée de la FTP : plus haute en chrono et en côte', () => {
    expect(dsTarget(280, 0, false)).toBe(225);
    expect(dsTarget(280, 0, true)).toBe(265);
    expect(dsTarget(280, 6, true)).toBe(280);
    expect(dsTarget(280, 0, true, 330)).toBe(330);
    expect(dsTarget(280, 6, true, 330)).toBe(345);
  });
  it('« tu t’emballes » après 6 s au-dessus de la cible, puis « parfait » une fois revenu', () => {
    const ds = new DirecteurSportif();
    const hot = run(ds, { watts3s: 330 }, 10);
    expect(hot.some((l) => l.fr.includes('tu t’emballes, 330 watts') && l.fr.includes('225 watts'))).toBe(true);
    const ok = run(ds, { watts3s: 226 }, 40);
    expect(ok.some((l) => l.fr.startsWith('Parfait'))).toBe(true);
  });
  it('annonce une attaque tout de suite, une seule fois par délai', () => {
    const ds = new DirecteurSportif();
    expect(ds.update(0.1, { ...base, attacks: ['Steve'] })[0]?.fr).toContain('Attaque de Steve');
    expect(ds.update(0.1, { ...base, attacks: ['Léa'] })).toHaveLength(0);
  });
  it('200 m de la ligne : à fond', () => {
    const ds = new DirecteurSportif();
    expect(ds.update(0.1, { ...base, remainingM: 180 }).some((l) => l.fr.startsWith('200 mètres'))).toBe(true);
  });
  it('échappée : « tu es parti »', () => {
    const ds = new DirecteurSportif();
    expect(run(ds, { gapAheadM: null, gapBehindM: 60 }, 2).some((l) => l.fr.startsWith('Tu es parti'))).toBe(true);
  });
});
