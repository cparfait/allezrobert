import { describe, expect, it } from 'vitest';
import { signDesigns, signMessages, signName } from '../src/world/crowdSigns.ts';

function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('pancartes de la foule', () => {
  it('prénom propre, court, sans caractères parasites', () => {
    expect(signName('  gilberte  dupont')).toBe('Gilberte');
    expect(signName('<b>Jo</b>')).toBe('BJob');
    expect(signName('Maximilien-Alexandre')).toHaveLength(14);
    expect(signName('')).toBe('Robert');
  });

  it('messages en français : prénom, « Allez Robert ! », spécifiques au KOM ou au sprint', () => {
    const kom = signMessages('Gilberte', 'kom').map((l) => l.join(' '));
    expect(kom).toContain('ALLEZ ROBERT !');
    expect(kom).toContain('ALLEZ GILBERTE !');
    expect(kom.some((m) => m.includes('MONTE'))).toBe(true);
    const sprint = signMessages('Gilberte', 'sprint').map((l) => l.join(' '));
    expect(sprint.some((m) => m.includes('SPRINTE GILBERTE'))).toBe(true);
    expect(sprint.some((m) => m.includes('MONTE'))).toBe(false);
    // Chaque ligne tient sur une pancarte.
    for (const lines of signMessages('Maximilien-Alexandre', 'kom')) {
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.length).toBeLessThanOrEqual(3);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(22);
    }
  });

  it('tirage déterministe, varié, prénom et clin d’œil garantis', () => {
    const a = signDesigns('Robert', 'kom', 10, seeded(1));
    const b = signDesigns('Robert', 'kom', 10, seeded(1));
    expect(a).toEqual(b);
    const texts = a.map((d) => d.lines.join(' '));
    expect(texts[0]).toBe('ALLEZ ROBERT !');
    expect(texts[2]).toBe('VAS-Y ROBERT !');
    expect(new Set(texts.slice(2)).size).toBe(8);
    for (const d of a) {
      expect(d.bg).toMatch(/^#[0-9a-f]{6}$/i);
      expect(d.ink).not.toBe(d.bg);
    }
    // Plus de pancartes que de messages : on recommence le tirage sans planter.
    expect(signDesigns('Lulu', 'sprint', 40, seeded(3))).toHaveLength(40);
  });
});
