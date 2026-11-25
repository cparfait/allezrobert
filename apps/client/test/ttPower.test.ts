import { describe, expect, it } from 'vitest';
import { ttPowerW } from '../src/game/peloton.ts';

describe('puissance de contre-la-montre des IA', () => {
  it('dépend de la durée : bien au-dessus de la FTP sur 5 min, proche d’elle sur une heure', () => {
    const short = ttPowerW(3600, 250, 72, 80) / 250;
    const long = ttPowerW(40000, 250, 72, 80) / 250;
    expect(short).toBeGreaterThan(1.15);
    expect(short).toBeLessThanOrEqual(1.3);
    expect(long).toBeGreaterThan(0.95);
    expect(long).toBeLessThan(1.05);
  });
  it('plus de W′ (puncheur) : plus de puissance sur un chrono court', () => {
    expect(ttPowerW(3600, 250, 72, 110)).toBeGreaterThan(ttPowerW(3600, 250, 72, 60));
  });
});
