import { describe, expect, it } from 'vitest';
import { COSMETICS, DEFAULT_BIKE, DEFAULT_TRAINER, bikeSetupFor, trainerOf } from '../src/index.ts';

describe('home trainers du garage', () => {
  const trainers = COSMETICS.filter((c) => c.slot === 'trainer');

  it('NEO 2T de départ, trois autres à débloquer', () => {
    expect(trainers.map((t) => t.id).sort()).toEqual(['trainer-kickr', 'trainer-kickr-core-2', 'trainer-neo-2t', 'trainer-neo-3m']);
    expect(trainers.find((t) => t.id === DEFAULT_TRAINER)?.level).toBe(1);
    expect(trainers.filter((t) => t.level > 1)).toHaveLength(3);
  });

  it('purement visuels : aucun effet sur le vélo roulé', () => {
    for (const t of trainers) {
      expect(t.physics).toBeUndefined();
      expect(bikeSetupFor({ trainer: t.id })).toEqual(DEFAULT_BIKE);
    }
  });

  it('home trainer monté : celui équipé, sinon le NEO 2T', () => {
    expect(trainerOf({})).toBe('trainer-neo-2t');
    expect(trainerOf({ trainer: 'trainer-kickr' })).toBe('trainer-kickr');
    expect(trainerOf({ trainer: 'jersey-robert' })).toBe('trainer-neo-2t');
    expect(trainerOf({ trainer: 'inconnu' })).toBe('trainer-neo-2t');
  });
});
