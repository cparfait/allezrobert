import { describe, expect, it } from 'vitest';
import { bodyForBmi, resolvedBody } from '../src/v3/visuals.ts';

describe('corps V3 selon l’IMC', () => {
  it('mince, standard ou fort selon l’IMC', () => {
    expect(bodyForBmi(19.5, 'male')).toBe('skinny');
    expect(bodyForBmi(24.4, 'male')).toBe('standard');
    expect(bodyForBmi(29, 'male')).toBe('big');
    expect(bodyForBmi(29, 'female')).toBe('standard');
    expect(bodyForBmi(undefined, 'male')).toBe('standard');
  });

  it('le corps choisi passe avant l’IMC, jamais fort pour la coureuse', () => {
    expect(resolvedBody({ bike: 'x', color: 0, body: 'skinny' }, 'male')).toBe('skinny');
    expect(resolvedBody({ bike: 'x', color: 0, body: 'big' }, 'female')).toBe('standard');
  });
});
