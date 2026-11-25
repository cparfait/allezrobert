import type { RouteData } from '@allezrobert/shared';
import { describe, expect, it } from 'vitest';
import { findRoute } from '../src/game/direction.ts';
import { loopCuts, loopRef, parseStageRouteId, planStages, sliceRoute, stagePlan, stageRouteId, type TourOptions, type TourRouteRef } from '../src/game/tourPlan.ts';
import { createRouteStore, loadRouteForKey } from '../src/world/routeStore.ts';

/** Boucle de 40 km (un point tous les 10 m), une côte, un sprint, deux villages. */
function loop(): RouteData {
  const L = 40_000;
  const n = L / 10;
  return {
    id: 'grande-boucle',
    name: 'Grande boucle',
    loop: true,
    lengthM: L,
    elevationGainM: 400,
    points: Array.from({ length: n }, (_, i) => ({ x: Math.cos((i / n) * 2 * Math.PI) * 6000, y: 50 + 25 * Math.sin((i / n) * 8 * Math.PI), z: Math.sin((i / n) * 2 * Math.PI) * 6000, d: i * 10 })),
    segments: [
      { id: 'kom-1', kind: 'kom', name: 'Côte', startM: 19_000, endM: 21_000, avgGrade: 5 },
      { id: 'sprint-1', kind: 'sprint', name: 'Sprint', startM: 30_000, endM: 30_300, avgGrade: 0 },
    ],
    roadWidthM: 6,
    attribution: [],
    roadWidths: [{ startM: 0, endM: 25_000, widthM: 6 }, { startM: 25_000, endM: L, widthM: 7 }],
    landmarks: [{ name: 'Kerbrou', d: 10_400 }, { name: 'Robertville', d: 0 }],
  };
}

const opts = (o: Partial<TourOptions> = {}): TourOptions => ({ track: 'loop', stages: 4, tt: 'prologue', length: 'medium', ...o });
const ref = (id: string, lengthM: number, elevationGainM: number, isLoop = true, bike?: string): TourRouteRef => ({ id, name: id, lengthM, elevationGainM, loop: isLoop, ...(bike ? { bike } : {}) });

describe('étapes du tour', () => {
  it('genre des étapes selon les chronos choisis', () => {
    expect(stagePlan(3)).toEqual(['tt', 'road', 'road']);
    expect(stagePlan(3, 'none')).toEqual(['road', 'road', 'road']);
    expect(stagePlan(3, 'two')).toEqual(['tt', 'road', 'tt']);
    expect(stagePlan(5, 'two')).toEqual(['tt', 'road', 'road', 'tt', 'road']);
    expect(stagePlan(2, 'two')).toEqual(['tt', 'road']);
    expect(stagePlan(12, 'none')).toHaveLength(7);
  });

  it('la boucle découpée est couverte en entier, sans trou ni recouvrement', () => {
    const r = loop();
    for (let n = 2; n <= 7; n++)
      for (const tt of ['none', 'prologue', 'two'] as const) {
        const stages = planStages(opts({ stages: n, tt }), [ref(r.id, r.lengthM, 400)], r);
        expect(stages).toHaveLength(n);
        let at = 0;
        for (const st of stages ?? []) {
          const c = parseStageRouteId(st.routeId);
          expect(c?.fromM).toBe(at);
          expect(st.lengthM).toBeGreaterThan(1000);
          at = c?.toM ?? -1;
        }
        expect(at).toBe(r.lengthM);
        // Jamais de bout d'étape dans une côte ou un sprint.
        for (const d of loopCuts(r, stagePlan(n, tt))) for (const s of r.segments) expect(d > s.startM && d < s.endM).toBe(false);
      }
  });

  it('arrivée dans le village proche, chrono plus court que les étapes en ligne', () => {
    const r = loop();
    expect(loopCuts(r, stagePlan(4, 'none'))[1]).toBe(10_400);
    const st = planStages(opts(), [ref(r.id, r.lengthM, 400)], r) ?? [];
    expect(st[0]?.kind).toBe('tt');
    expect(st[0]?.lengthM).toBeLessThan((st[1]?.lengthM ?? 0) / 2);
    expect(st.reduce((a, s) => a + s.gainM, 0)).toBeGreaterThan(380);
  });

  it('étape découpée : aller simple, côtes et largeurs recalées, boucle refermée', () => {
    const r = loop();
    const s = sliceRoute(r, 18_000, 40_000) as RouteData;
    expect(s.loop).toBe(false);
    expect(s.lengthM).toBe(22_000);
    expect(s.points[0]?.d).toBe(0);
    expect(s.points.at(-1)).toMatchObject({ x: r.points[0]?.x, z: r.points[0]?.z, d: 22_000 });
    expect(s.segments.map((x) => [x.id, x.startM])).toEqual([['kom-1', 1000], ['sprint-1', 12_000]]);
    expect(s.roadWidths).toEqual([{ startM: 0, endM: 7000, widthM: 6 }, { startM: 7000, endM: 22_000, widthM: 7 }]);
    expect(s.points.every((p, i) => i === 0 || p.d > (s.points[i - 1]?.d ?? 0))).toBe(true);
  });

  it('une étape se retrouve par son identifiant, même parcours pas encore chargé', async () => {
    const r = loop();
    const id = stageRouteId(r.id, 10_400, 21_080);
    expect(parseStageRouteId(id)).toEqual({ baseId: 'grande-boucle', fromM: 10_400, toM: 21_080 });
    expect(parseStageRouteId('itineraire-lx2k')).toBeNull();
    const store = createRouteStore([{ id: r.id, name: r.name, lengthM: r.lengthM, elevationGainM: 400, loop: true }], async () => r);
    expect(findRoute(store.loaded(), id)).toBeUndefined();
    await loadRouteForKey(store, id);
    expect(findRoute(store.loaded(), id)?.id).toBe(id);
  });

  it('île : le Tour de l’Île est la boucle du tour ; zone sans boucle : parcours variés', () => {
    const island = [ref('kerbrou', 60_000, 10), ref('tour-de-l-ile', 93_000, 700), ref('gravel', 120_000, 10, true, 'gravel')];
    expect(loopRef(island)?.id).toBe('tour-de-l-ile');
    expect(planStages(opts(), island, undefined)).toBeNull();
    expect(loopRef([ref('petit', 8000, 30)])).toBeUndefined();
    expect(planStages(opts({ stages: 3 }), [ref('petit', 8000, 30)], undefined)).toHaveLength(3);
    expect(planStages(opts(), [ref('vtt', 8000, 30, true, 'mtb')], undefined)).toEqual([]);
  });

  it('parcours variés : chrono court et plat, étape reine à l’avant-dernière, tours selon la longueur voulue', () => {
    const refs = [ref('front', 4600, 8), ref('chrono', 7800, 42, false), ref('boucle', 17_600, 148), ref('coteaux', 21_000, 239), ref('phare', 9700, 630, false), ref('piste-verte', 19_600, 90, false), ref('petite', 5500, 20)];
    const st = planStages(opts({ track: 'cities', stages: 5, tt: 'prologue' }), refs, undefined) ?? [];
    expect(st.map((s) => s.kind)).toEqual(['tt', 'road', 'road', 'road', 'road']);
    expect(['front', 'chrono', 'petite']).toContain(st[0]?.routeId);
    expect(st[3]?.routeId).toBe('phare');
    expect(st.some((s) => s.routeId === 'piste-verte')).toBe(false);
    expect(new Set(st.map((s) => s.routeId)).size).toBe(5);
    const petite = planStages(opts({ track: 'cities', stages: 2, tt: 'none' }), [ref('petite', 5500, 20)], undefined)?.[0];
    expect(petite).toMatchObject({ laps: 4, lengthM: 22_000, gainM: 80 });
  });
});
