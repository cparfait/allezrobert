import { beforeEach, describe, expect, it } from 'vitest';

// localStorage minimal pour les tests (Node).
const store = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

const { readKomRecord, setKomZone } = await import('../src/game/challenge.ts');

describe('records KOM rangés par zone', () => {
  beforeEach(() => {
    store.clear();
    setKomZone('');
  });

  it('un record d’une zone ne vaut pas pour la même côte d’une autre zone', () => {
    store.set('ar.kom.idf-ablis.boucle-30-km.boucle-30-km-kom-1', JSON.stringify({ timeS: 100, dist: [0, 1000], date: '' }));
    expect(readKomRecord('boucle-30-km', 'boucle-30-km-kom-1', { zone: 'idf-ablis', lenM: 1000 })?.timeS).toBe(100);
    expect(readKomRecord('boucle-30-km', 'boucle-30-km-kom-1', { zone: 'idf-angerville', lenM: 1000 })).toBeNull();
    setKomZone('idf-ablis');
    expect(readKomRecord('boucle-30-km', 'boucle-30-km-kom-1', { lenM: 1000 })?.timeS).toBe(100);
  });

  it('un ancien record (sans zone) revient à la zone dont la côte a sa longueur, et y est recopié', () => {
    store.set('ar.kom.boucle-30-km.boucle-30-km-kom-1', JSON.stringify({ timeS: 90, dist: [0, 500, 1203.4], date: '' }));
    expect(readKomRecord('boucle-30-km', 'boucle-30-km-kom-1', { zone: 'idf-angerville', lenM: 1180 })).toBeNull();
    expect(readKomRecord('boucle-30-km', 'boucle-30-km-kom-1', { zone: 'idf-ablis', lenM: 1203.4 })?.timeS).toBe(90);
    expect(store.has('ar.kom.idf-ablis.boucle-30-km.boucle-30-km-kom-1')).toBe(true);
    expect(store.has('ar.kom.idf-angerville.boucle-30-km.boucle-30-km-kom-1')).toBe(false);
  });
});
