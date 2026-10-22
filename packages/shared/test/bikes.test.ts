import { describe, expect, it } from 'vitest';
import { BIKE_BRANDS, BIKE_FAMILIES, BIKE_GROUPS, BIKES, COSMETICS, DEFAULT_BIKE_MODEL, DEFAULT_LOOK, MAX_LEVEL, bikeById, bikeOfLook, migrateBikeId, migrateCosmeticId } from '../src/index.ts';

const WHEELS = ['box', 'c35', 'c50', 'c65', 'disc', 'tri'];
const HEX = /^#[0-9a-f]{6}$/i;

describe('catalogue de vélos', () => {
  it('chaque modèle est cohérent (famille, roues, livrée, niveau, marque, groupe)', () => {
    const ids = new Set<string>();
    for (const b of BIKES) {
      expect(ids.has(b.id), b.id).toBe(false);
      ids.add(b.id);
      expect(b.id).toMatch(/^[a-z0-9-]{1,64}$/);
      expect(BIKE_FAMILIES).toContain(b.family);
      expect(b.params.wheels).toHaveLength(2);
      for (const w of b.params.wheels) expect(WHEELS).toContain(w);
      expect(['disc', 'rim', 'none']).toContain(b.params.brakes);
      expect(b.livery.colors.length).toBeGreaterThan(0);
      for (const c of [...b.livery.colors, ...(b.livery.extra ?? []), b.livery.rim, b.livery.tape].filter(Boolean)) expect(c).toMatch(HEX);
      for (const ci of Object.values(b.livery.zones ?? {})) expect(ci).toBeLessThan(b.livery.colors.length);
      expect(b.level).toBeGreaterThanOrEqual(1);
      expect(b.level).toBeLessThanOrEqual(MAX_LEVEL);
      expect(BIKE_BRANDS.some((x) => x.id === b.brand), b.brand).toBe(true);
    }
    expect(BIKES.some((b) => b.level === 1)).toBe(true);
    expect(BIKE_GROUPS.length).toBeGreaterThan(0);
  });

  it('les anciens vélos du garage pointent vers des modèles existants', () => {
    for (const old of ['bike-alu', 'bike-carbone', 'bike-acier-vintage', 'bike-grimpeur']) {
      expect(bikeById(old), old).toBeDefined();
      expect(migrateCosmeticId('bike', old)).toBe(migrateBikeId(old));
    }
    expect(migrateCosmeticId('jersey', 'bike-alu')).toBe('bike-alu');
    expect(DEFAULT_BIKE_MODEL.level).toBe(1);
  });

  it('les vélos font partie des cosmétiques (emplacement « bike »)', () => {
    const bikes = COSMETICS.filter((c) => c.slot === 'bike');
    // Tout le catalogue, plus le VTT et le gravel (types de pneus, hors catalogue).
    expect(bikes.filter((c) => BIKES.some((b) => b.id === c.id))).toHaveLength(BIKES.length);
    expect(bikes.map((c) => c.id).filter((id) => !BIKES.some((b) => b.id === id)).sort()).toEqual(['bike-gravel', 'bike-vtt']);
    expect(new Set(COSMETICS.map((c) => c.id)).size).toBe(COSMETICS.length);
  });

  it('bikeOfLook : modèle choisi, sinon vélo de base de la couleur du look', () => {
    expect(bikeOfLook({ ...DEFAULT_LOOK, bikeModel: 's26-01-uae-y1rs' }).family).toBe('aero');
    const plain = bikeOfLook({ ...DEFAULT_LOOK, bike: '#123456' });
    expect(plain.livery).toEqual({ colors: ['#123456'], pattern: 'solid' });
    expect(bikeOfLook({ ...DEFAULT_LOOK, bikeModel: 'inconnu' }).livery.colors).toEqual([DEFAULT_LOOK.bike]);
  });
});
