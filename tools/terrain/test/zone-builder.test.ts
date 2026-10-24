import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, allWorlds } from '../src/config.ts';
import { estimate, frameFromRect, readWorldLine, rectFromWorld, upsertSpotLine, upsertWorldLine, validate, zoneJson, type ZoneDraft } from '../src/zone-builder-lib.ts';

const draft = (over: Partial<ZoneDraft> = {}): ZoneDraft => ({
  id: 'ma-zone', nameFr: 'Ma zone', nameEn: 'My zone', regionFr: 'Var', regionEn: 'Var', hintFr: 'a', hintEn: 'b', sea: true, orthoPx: 1024,
  rect: { minE: 346000, maxE: 360000, minN: 6573000, maxN: 6584000 },
  tours: [{ routeId: 'tour', nameFr: 'T', nameEn: 'T', points: [{ lon: -1.5158, lat: 46.2081 }, { lon: -1.54, lat: 46.23 }] }],
  ...over,
});

describe('zone-builder', () => {
  it('retrouve le cadre de l’Île de Ré (origine au km, tuiles, centre)', () => {
    const re = allWorlds().re!;
    if (re.kind !== 'open') throw new Error('re doit être open');
    const f = frameFromRect(rectFromWorld(re.originL93, re.corridorTiles));
    expect(f.corridorTiles).toEqual(re.corridorTiles);
    expect(f.originL93).toEqual(re.originL93);
    expect(f.tiles).toBe(14 * 11);
  });

  it('estime tuiles, temps et cache, et signale les emprises trop grandes', () => {
    const f = frameFromRect({ minE: 0, maxE: 20000, minN: 0, maxN: 10000 });
    expect(f.tiles).toBe(200);
    expect(estimate(f, true).warnings.length).toBeGreaterThan(0);
    expect(estimate(f, true).minutes).toBe(40);
  });

  it('refuse un identifiant ou des tours invalides', () => {
    expect(validate(draft({ id: 'Ma Zone' }))).not.toEqual([]);
    expect(validate(draft({ tours: [] }))).not.toEqual([]);
    expect(validate(draft())).toEqual([]);
  });

  it('produit un JSON de zone et garde les champs inconnus de l’existant', () => {
    const f = frameFromRect(draft().rect);
    const raw = { horizon: { halfSizeM: 1, resM: 2 }, tours: [{ routeId: 'tour', koms: [1], allowTracks: true }] };
    const j = zoneJson(draft(), f, raw) as { sea: boolean; horizon: unknown; tours: Array<Record<string, unknown>> };
    expect(j.sea).toBe(true);
    expect(j.horizon).toEqual({ halfSizeM: 1, resM: 2 });
    expect(j.tours[0]!.allowTracks).toBe(true);
    expect(j.tours[0]!.via).toEqual([{ lon: -1.54, lat: 46.23 }]);
  });

  it('ajoute les lignes de menu une seule fois, avant les montées, et sans toucher aux fins de ligne', () => {
    const f = frameFromRect(draft().rect);
    const worlds = "export const WORLD_LIST = [\r\n  { id: 'a', name: { fr: 'A', en: 'A' }, hint: { fr: 'x', en: 'y' } },\r\n  { id: 'alpe-dhuez', name: { fr: 'B', en: 'B' }, hint: { fr: 'x', en: 'y' } },\r\n];\r\n";
    const out = upsertWorldLine(worlds, draft())!;
    expect(out.split('\r\n').findIndex((l) => l.includes("'ma-zone'"))).toBe(2);
    expect(out.includes('\r\n')).toBe(true);
    expect(upsertWorldLine(out, draft())).toBeNull();
    const spots = "export const ZONE_SPOTS = [\n  { id: 'alpe-dhuez', x: 1, y: 2, open: false },\n];\n";
    const s1 = upsertSpotLine(spots, draft(), f)!;
    expect(s1).toContain("{ id: 'ma-zone', x: 353000, y: 6578500");
    const s2 = upsertSpotLine(s1, draft({ rect: { minE: 0, maxE: 20000, minN: 0, maxN: 10000 } }), frameFromRect({ minE: 0, maxE: 20000, minN: 0, maxN: 10000 }))!;
    expect(s2).toContain("{ id: 'ma-zone', x: 10000, y: 5000");
    expect(readWorldLine(out, 'ma-zone')).toMatchObject({ nameEn: 'My zone', hintFr: 'a', hintEn: 'b' });
  });

  it('chaque zone « open » déclarée figure dans le menu et sur la carte', () => {
    const w = fs.readFileSync(path.join(REPO_ROOT, 'apps/client/src/world/worlds.ts'), 'utf8');
    const m = fs.readFileSync(path.join(REPO_ROOT, 'apps/client/src/world/zoneMap.ts'), 'utf8');
    for (const z of Object.values(allWorlds())) {
      if (z.private) continue;
      expect(w, `worlds.ts : ${z.id}`).toContain(`id: '${z.id}'`);
      expect(m, `zoneMap.ts : ${z.id}`).toContain(`id: '${z.id}'`);
    }
  });
});
