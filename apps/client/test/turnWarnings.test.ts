import { describe, expect, it } from 'vitest';
import { armsAt } from '../src/game/turnWarnings.ts';

const road = (pts: number[], kind = 'tertiary') => ({ kind, width: 5, pts });

describe('armsAt', () => {
  it('compte deux bras dans un simple virage (tronçon continu ou coupé au sommet)', () => {
    expect(armsAt(0, 0, [road([-50, 0, 0, 0, 0, 50])])).toBe(2);
    expect(armsAt(0, 0, [road([-50, 0, 0, 0]), road([0, 0, 0, 50])])).toBe(2);
  });
  it("compte trois bras à un carrefour en T, même si la route principale n'est pas coupée", () => {
    expect(armsAt(0, 0, [road([-50, 0, 50, 0]), road([0, 0, 0, 50], 'unclassified')])).toBe(3);
  });
  it('ignore chemins et voies de service', () => {
    expect(armsAt(0, 0, [road([-50, 0, 0, 0, 0, 50]), road([0, 0, 0, -40], 'track'), road([0, 0, 30, -30], 'service')])).toBe(2);
  });
});
