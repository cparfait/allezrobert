import { describe, expect, it } from 'vitest';
import { pickArchetype, validateStyle } from '@allezrobert/shared';
import { profileBuildings, suggestStyle, type ProfiledBuilding } from '../src/style-profile.ts';

const many = (n: number, b: ProfiledBuilding) => Array.from({ length: n }, () => ({ ...b }));

describe('auto-profilage du bâti', () => {
  it('histogrammes : niveaux estimés, annexes à part', () => {
    const p = profileBuildings([
      ...many(6, { kind: 'apartments', height: 20, levels: 7, material: 'stone', roofMaterial: 'metal', source: 'bdtopo' }),
      ...many(2, { kind: 'apartments', height: 15 }),
      ...many(2, { kind: 'shed', height: 3 }),
    ]);
    expect(p.count).toBe(10);
    expect(p.housing).toBe(8);
    expect(p.material).toEqual({ stone: 6, unknown: 4 });
    expect(p.levels).toEqual({ '5-9': 8, '1-2': 2 });
    expect(p.materialByLevels.stone).toEqual({ '5-9': 6 });
    expect(p.medianLevels).toBe(7);
  });

  it('bâti dense → profil urbain valide (haussmannien pour la pierre haute)', () => {
    const p = profileBuildings([...many(8, { kind: 'apartments', height: 20, levels: 7, material: 'stone' }), ...many(2, { kind: 'house', height: 6, levels: 2 })]);
    const s = suggestStyle('test', p);
    expect(validateStyle(s)).toEqual([]);
    expect(pickArchetype(s, { kind: 'apartments', height: 20, levels: 7, material: 'stone' }, 0.1)).toBe('haussmann');
    expect(pickArchetype(s, { kind: 'house', height: 6, levels: 2 }, 0.1)).toBe('maison_faubourg');
  });

  it('bâti rural → meulière et enduit', () => {
    const p = profileBuildings([...many(5, { kind: 'house', height: 7, levels: 2, material: 'stone' }), ...many(5, { kind: 'house', height: 7, levels: 2 })]);
    const s = suggestStyle('test', p);
    expect(validateStyle(s)).toEqual([]);
    expect(pickArchetype(s, { kind: 'house', height: 7, material: 'stone' }, 0.5)).toBe('meuliere');
    expect(['enduit_idf', 'meuliere']).toContain(pickArchetype(s, { kind: 'house', height: 7 }, 0.5));
  });
});
