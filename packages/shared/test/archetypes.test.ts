import { describe, expect, it } from 'vitest';
import { ARCHETYPES, estimatedLevels, pickArchetype, validateStyle, worldStyle, worldStyleIds, type WorldStyle } from '../src/index.ts';

const HEX = /^#[0-9a-f]{6}$/i;

describe('archétypes de bâti', () => {
  it('chaque archétype a des palettes et une façade plausibles', () => {
    expect(Object.keys(ARCHETYPES).length).toBeGreaterThanOrEqual(8);
    for (const [id, a] of Object.entries(ARCHETYPES)) {
      expect(a.walls.length, id).toBeGreaterThan(0);
      for (const c of [...a.walls, ...a.shutters, ...a.roof.colours]) expect(c, id).toMatch(HEX);
      const f = a.facade;
      expect(f.bayM, id).toBeGreaterThanOrEqual(2);
      expect(f.floorM, id).toBeGreaterThanOrEqual(2.5);
      expect(f.floorM, id).toBeLessThanOrEqual(3.8);
      // la fenêtre tient dans la travée et dans l'étage
      expect(f.window[0], id).toBeLessThan(f.bayM);
      expect(f.sillM + f.window[1], id).toBeLessThan(f.floorM);
      expect(f.shopfronts, id).toBeGreaterThanOrEqual(0);
      expect(f.shopfronts, id).toBeLessThanOrEqual(1);
      if (f.shopfronts > 0) expect(f.groundFloorM, id).toBeGreaterThanOrEqual(3);
    }
  });

  it('les profils de monde versionnés sont valides', () => {
    expect(worldStyleIds()).toContain('montmartre');
    for (const id of worldStyleIds()) {
      const s = worldStyle(id) as WorldStyle;
      expect(s.world).toBe(id);
      expect(validateStyle(s)).toEqual([]);
      // la dernière règle attrape tout bâtiment non exclu
      expect(s.rules[s.rules.length - 1]!.when).toEqual({});
    }
  });

  it('sans profil, aucun archétype (rendu historique)', () => {
    expect(worldStyle('chevreuse')).toBeNull();
  });
});

describe('choix de l’archétype (Montmartre)', () => {
  const s = worldStyle('montmartre') as WorldStyle;

  it('pierre de taille haute → haussmannien le plus souvent', () => {
    const t = { kind: 'apartments', height: 20, levels: 7, material: 'stone' };
    const picks = Array.from({ length: 100 }, (_, i) => pickArchetype(s, t, i / 100));
    expect(picks.filter((p) => p === 'haussmann').length).toBe(85);
    expect(picks.filter((p) => p === 'faubourien').length).toBe(15);
  });

  it('matériau et hauteur décident avant le tirage', () => {
    expect(pickArchetype(s, { kind: 'apartments', height: 18, levels: 6, material: 'brick' }, 0.5)).toBe('brique');
    expect(pickArchetype(s, { kind: 'apartments', height: 18, levels: 6, material: 'concrete' }, 0.5)).toBe('moderne');
    expect(pickArchetype(s, { kind: 'apartments', height: 36, levels: 12 }, 0.5)).toBe('moderne');
    expect(pickArchetype(s, { kind: 'house', height: 6, levels: 2 }, 0.5)).toBe('maison_faubourg');
    expect(pickArchetype(s, { kind: 'apartments', height: 11, levels: 4 }, 0.5)).toBe('faubourien');
  });

  it('annexes et édifices gardent le rendu historique', () => {
    expect(pickArchetype(s, { kind: 'shed', height: 3 }, 0.5)).toBeNull();
    expect(pickArchetype(s, { kind: 'church', height: 30 }, 0.5)).toBeNull();
  });

  it('niveaux estimés depuis la hauteur quand ils manquent ou sont aberrants', () => {
    expect(estimatedLevels({ kind: 'apartments', height: 19 })).toBe(6);
    expect(estimatedLevels({ kind: 'apartments', height: 19, levels: 0 })).toBe(6);
    expect(estimatedLevels({ kind: 'apartments', height: 19, levels: 7 })).toBe(7);
  });

  it('un profil incohérent est signalé', () => {
    expect(validateStyle({ world: 'x', rules: [{ when: {}, pick: { inconnu: 1 } }] }).length).toBe(1);
  });
});
