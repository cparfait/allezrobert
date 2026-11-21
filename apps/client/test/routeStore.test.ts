import { describe, expect, it } from 'vitest';
import { reversedRouteId, type RouteData } from '@allezrobert/shared';
import { createRouteStore, loadRouteForKey, loadedRouteStore, type WorldRouteRef } from '../src/world/routeStore.ts';

const ref = (id: string): WorldRouteRef => ({ id, name: id.toUpperCase(), lengthM: 1000, elevationGainM: 10, loop: true });
const data = (id: string): RouteData => ({
  id,
  name: id.toUpperCase(),
  loop: true,
  lengthM: 400,
  elevationGainM: 0,
  points: [
    { x: 0, y: 0, z: 0, d: 0 },
    { x: 100, y: 0, z: 0, d: 100 },
    { x: 100, y: 0, z: 100, d: 200 },
    { x: 0, y: 0, z: 100, d: 300 },
  ],
  segments: [],
  roadWidthM: 6,
  attribution: [],
});

function store(ids: string[], fail: Set<string> = new Set()) {
  const calls: string[] = [];
  const s = createRouteStore(ids.map(ref), async (id) => {
    calls.push(id);
    if (fail.has(id)) throw new Error(`Itinéraire ${id} introuvable`);
    return data(id);
  });
  return { s, calls };
}

describe('itinéraires chargés à la demande', () => {
  it('ne demande rien tant qu’on ne lit que l’index', () => {
    const { s, calls } = store(['a', 'b', 'c']);
    expect(s.index.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(s.loaded()).toEqual([]);
    expect(s.get('a')).toBeUndefined();
    expect(s.complete).toBe(false);
    expect(calls).toEqual([]);
  });

  it('une seule requête par itinéraire, même demandé plusieurs fois en même temps', async () => {
    const { s, calls } = store(['a', 'b']);
    const [x, y] = await Promise.all([s.load('a'), s.load('a')]);
    expect(x).toBe(y);
    expect(await s.load('a')).toBe(x);
    expect(calls).toEqual(['a']);
    expect(s.get('a')).toBe(x);
    expect(s.loaded().map((r) => r.id)).toEqual(['a']);
    expect(s.complete).toBe(false);
  });

  it('rejette un itinéraire inconnu sans requête', async () => {
    const { s, calls } = store(['a']);
    await expect(s.load('zzz')).rejects.toThrow(/inconnu/);
    expect(calls).toEqual([]);
  });

  it('propage une erreur de chargement, puis réessaie à la demande suivante', async () => {
    const fail = new Set(['b']);
    const { s, calls } = store(['a', 'b'], fail);
    await expect(s.load('b')).rejects.toThrow(/introuvable/);
    expect(s.get('b')).toBeUndefined();
    await expect(s.loadAll()).rejects.toThrow(/introuvable/);
    // l'itinéraire lisible est quand même arrivé
    expect(s.loaded().map((r) => r.id)).toEqual(['a']);
    fail.clear();
    expect((await s.loadAll()).map((r) => r.id)).toEqual(['a', 'b']);
    expect(s.complete).toBe(true);
    expect(calls).toEqual(['b', 'a', 'b', 'b']);
  });

  it('garde l’ordre de l’index, tracés ajoutés à la fin', async () => {
    const { s } = store(['a', 'b', 'c']);
    await s.load('c');
    await s.load('a');
    s.add(data('trace-1'));
    expect(s.loaded().map((r) => r.id)).toEqual(['a', 'c', 'trace-1']);
    expect(s.index.map((r) => r.id)).toEqual(['a', 'b', 'c', 'trace-1']);
    expect(await s.load('trace-1')).toBe(s.get('trace-1'));
    s.remove('trace-1');
    expect(s.get('trace-1')).toBeUndefined();
    expect(s.index.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('monde déjà en mémoire : tout est là, sans requête', () => {
    const s = loadedRouteStore([data('a'), data('b')]);
    expect(s.complete).toBe(true);
    expect(s.loaded().map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('démarrage : seul l’itinéraire choisi est lu', () => {
  it('clé simple', async () => {
    const { s, calls } = store(['a', 'b', 'c']);
    await loadRouteForKey(s, 'b');
    expect(calls).toEqual(['b']);
    expect(s.loaded().map((r) => r.id)).toEqual(['b']);
  });

  it('sens inverse et départ déplacé : l’itinéraire de base seulement', async () => {
    const { s, calls } = store(['a', 'b', 'c']);
    // même forme que routeKey() : sens inverse, puis départ déplacé
    const key = `${reversedRouteId('b')}-depart-200`;
    expect(key).not.toBe('b');
    await loadRouteForKey(s, key);
    expect(calls).toEqual(['b']);
    expect(s.loaded().map((r) => r.id)).toEqual(['b']);
    await loadRouteForKey(s, reversedRouteId('c'));
    await loadRouteForKey(s, 'a-depart-50');
    expect(calls).toEqual(['b', 'c', 'a']);
  });

  it('clé inconnue : aucune requête', async () => {
    const { s, calls } = store(['a']);
    await loadRouteForKey(s, 'ailleurs');
    await loadRouteForKey(s, '');
    expect(calls).toEqual([]);
  });
});
