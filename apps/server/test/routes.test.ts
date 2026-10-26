import { describe, expect, it } from 'vitest';
import { FALLBACK_ROUTE_ID, RouteStore } from '../src/ride/routes.ts';

describe('itinéraires du serveur : sens inverse et départ choisi', () => {
  it('reconnaît une boucle partie d’un autre point, dans les deux sens', async () => {
    const store = await RouteStore.load(undefined);
    const base = store.get(FALLBACK_ROUTE_ID)!;
    const p = base.data.points[400]!;
    const id = `${FALLBACK_ROUTE_ID}-depart-${Math.round(p.d)}`;
    const r = store.get(id);
    expect(r?.data.id).toBe(id);
    expect(r?.data.points[0]).toMatchObject({ x: p.x, z: p.z, d: 0 });
    expect(r?.track.length).toBeCloseTo(base.track.length, 6);
    const rev = store.get(`${FALLBACK_ROUTE_ID}-inverse`)!;
    const q = rev.data.points[300]!;
    expect(store.get(`${FALLBACK_ROUTE_ID}-inverse-depart-${Math.round(q.d)}`)?.data.points[0]).toMatchObject({ x: q.x, z: q.z });
    // pas dans la liste des parcours ; résolu pour une sortie de groupe
    expect(store.list().map((x) => x.id)).toEqual([FALLBACK_ROUTE_ID]);
    expect(store.resolve(id).data.id).toBe(id);
  });

  it('refuse un départ qui ne tombe pas sur un point ou le départ d’origine', async () => {
    const store = await RouteStore.load(undefined);
    expect(store.get(`${FALLBACK_ROUTE_ID}-depart-0`)).toBeUndefined();
    expect(store.get('inconnu-depart-200')).toBeUndefined();
  });
});
