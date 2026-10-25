import { describe, expect, it } from 'vitest';
import { bdTopoHeightFromLow } from '../src/enrich.ts';

describe('bdTopoHeightFromLow', () => {
  it('terrain plat : hauteur BD TOPO telle quelle, 1,5 m de tolérance pour le faîtage LiDAR', () => {
    expect(bdTopoHeightFromLow(6, 0)).toEqual({ height: 6, ridgeCap: 7.5 });
  });
  it('en pente, la hauteur (prise au sol amont) est ramenée au point bas de l’emprise', () => {
    // maison Billom : hauteur 5,5 m, 2 m de dénivelée, faîtage LiDAR 7,3 m depuis le point bas
    const r = bdTopoHeightFromLow(5.5, 2);
    expect(r.height).toBeCloseTo(7.5);
    expect(r.ridgeCap).toBeCloseTo(9);
    expect(7.3 <= r.ridgeCap).toBe(true); // la mesure LiDAR n'est plus écartée
  });
  it('sans hauteur BD TOPO : pas de plafond ; dénivelée invalide ou négative ignorée', () => {
    expect(bdTopoHeightFromLow(null, 3)).toEqual({ height: null, ridgeCap: Infinity });
    expect(bdTopoHeightFromLow(6, Number.NaN).height).toBe(6);
    expect(bdTopoHeightFromLow(6, -1).height).toBe(6);
  });
});
