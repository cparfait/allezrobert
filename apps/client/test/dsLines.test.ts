import { describe, expect, it } from 'vitest';
import { aiIdentity } from '@allezrobert/shared';
import { coachLines } from '../src/audio/coachLines.ts';
import { dsLines, dsNumberKeys, nameKeys, ordinalEn, ordinalFr, secondsKeys } from '../src/audio/dsLines.ts';
import { DirecteurSportif, type DsInput, type DsLine } from '../src/game/directeur.ts';

const recorded = (lang: 'fr' | 'en') => ({ ...coachLines(lang), ...dsLines(lang) });
const missing = (l: DsLine) =>
  (['fr', 'en'] as const).flatMap((lang) => {
    const bank = recorded(lang);
    const keys = l.keys?.[lang] ?? [];
    return keys.length ? keys.filter((k) => !(k in bank)) : ['(aucun morceau)'];
  });
const base: DsInput = { watts3s: 200, ftpWatts: 280, gradePercent: 0, timeTrial: false, gapAheadM: 2, gapBehindM: 2, speedMs: 11, remainingM: null, attacks: [], cracks: [] };

describe('voix enregistrée du directeur sportif', () => {
  it('ordinaux en toutes lettres', () => {
    expect([2, 5, 9, 21, 71, 80, 81, 99].map(ordinalFr)).toEqual(['deuxième', 'cinquième', 'neuvième', 'vingt et unième', 'soixante et onzième', 'quatre-vingtième', 'quatre-vingt-unième', 'quatre-vingt-dix-neuvième']);
    expect([2, 3, 12, 20, 21, 40, 99].map(ordinalEn)).toEqual(['second', 'third', 'twelfth', 'twentieth', 'twenty-first', 'fortieth', 'ninety-ninth']);
  });

  it('nombres jusqu’à 1 999 watts, secondes au singulier', () => {
    expect(dsNumberKeys(1240)).toEqual(['k1', 'c2', 'n40']);
    expect(dsNumberKeys(1000)).toEqual(['k1']);
    expect(secondsKeys(1, 'fr')).toEqual(['uneSeconde']);
    expect(secondsKeys(0, 'fr')).toEqual(['n0', 'seconde']);
    expect(secondsKeys(45, 'en')).toEqual(['n45', 'secondes']);
  });

  it('tous les noms des coureurs IA sont dans la banque, avec leur genre', () => {
    for (let k = 0; k < 4096; k++)
      for (const female of [false, true]) {
        const n = nameKeys(aiIdentity(k, female).name);
        expect(n?.female).toBe(female);
      }
    expect(nameKeys('Steve')).toBeNull();
    expect(dsLines('fr')[nameKeys('Bram SMIT')?.keys[1] as string]).toBe('Smit');
  });

  it('chaque phrase possible n’utilise que des morceaux enregistrés', () => {
    const lines: DsLine[] = [];
    const names = [aiIdentity(3, false).name, aiIdentity(8, true).name, 'Steve'];
    for (let i = 0; i < 40; i++) {
      const ds = new DirecteurSportif();
      lines.push(...ds.update(0.1, { ...base, attacks: [names[i % 3] as string] }));
      lines.push(...new DirecteurSportif().update(0.1, { ...base, gapAheadM: i % 2 ? null : 5, attacks: [names[i % 3] as string] }));
      lines.push(...new DirecteurSportif().update(0.1, { ...base, cracks: [names[i % 3] as string] }));
    }
    const ds = new DirecteurSportif();
    for (let t = 0; t < 400; t += 0.5) {
      const w = t < 100 ? 1300 : t < 200 ? 226 : t < 300 ? 90 : 225;
      lines.push(...ds.update(0.5, { ...base, timeTrial: t >= 200, watts3s: w, gapAheadM: t > 150 ? null : 2, gapBehindM: t > 150 ? 400 : 2, remainingM: 2000 - t * 5 }));
    }
    lines.push(DirecteurSportif.checkpoint(null, null), DirecteurSportif.checkpoint(-1, names[0] as string), DirecteurSportif.checkpoint(12, 'Steve'), DirecteurSportif.checkpoint(0, null));
    lines.push(DirecteurSportif.ttFinish(1, 0, 14, undefined), DirecteurSportif.ttFinish(7, 33, 0, names[1]), DirecteurSportif.ttFinish(41, 1, 0, 'Steve'));
    expect(lines.length).toBeGreaterThan(130);
    for (const l of lines) expect(missing(l), l.fr).toEqual([]);
  });
});
