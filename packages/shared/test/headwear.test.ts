import { describe, expect, it } from 'vitest';
import { COSMETICS, DEFAULT_LOOK, glassesLookOf, helmetLookOf } from '../src/index.ts';

const item = (id: string) => COSMETICS.find((c) => c.id === id)!;

describe('sans casque / sans lunettes', () => {
  it('disponibles dès le niveau 1, avec une paire de lunettes pour revenir en arrière', () => {
    for (const id of ['helmet-aucun', 'glasses-aucunes', 'glasses-sport', 'helmet-blanc']) expect(item(id).level, id).toBe(1);
  });

  it('« Sans casque » retire casque et casquette, un casque les remet', () => {
    const capped = helmetLookOf(item('cap-noire'), DEFAULT_LOOK);
    const bare = helmetLookOf(item('helmet-aucun'), capped);
    expect(bare.noHelmet).toBe(true);
    expect(bare.cap).toBeUndefined();
    expect(bare.helmet).toBe(capped.helmet);
    const back = helmetLookOf(item('helmet-blanc'), bare);
    expect(back.noHelmet).toBeUndefined();
    expect(helmetLookOf(item('cap-blanche'), bare).cap).toBeDefined();
  });

  it('« Sans lunettes » les retire, toute autre paire les remet', () => {
    const bare = glassesLookOf(item('glasses-aucunes'), DEFAULT_LOOK);
    expect(bare.noGlasses).toBe(true);
    expect(glassesLookOf(item('glasses-sport'), bare).noGlasses).toBeUndefined();
  });
});
