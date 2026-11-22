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

const { readZonedTime, writeZonedTime, readSegmentPr } = await import('../src/game/sequences.ts');

describe('meilleurs temps de segments rangés par zone', () => {
  beforeEach(() => {
    store.clear();
    setKomZone('');
  });

  it('un temps d’une zone ne vaut pas pour le même segment d’une autre zone', () => {
    setKomZone('idf-ablis');
    writeZonedTime('ar.segbest', 'boucle-30-km', 'boucle-30-km-kom-1', 120);
    expect(readZonedTime('ar.segbest', 'boucle-30-km', 'boucle-30-km-kom-1')).toBe(120);
    setKomZone('idf-angerville');
    expect(readZonedTime('ar.segbest', 'boucle-30-km', 'boucle-30-km-kom-1')).toBeNull();
  });

  it('un ancien temps sans zone est repris pour un itinéraire propre à une zone, écarté pour un itinéraire commun', () => {
    store.set('ar.pr.cote-de-la-madeleine.kom-hautvilliers', '200');
    store.set('ar.pr.boucle-30-km.boucle-30-km-kom-1', '150');
    setKomZone('chevreuse');
    expect(readSegmentPr('cote-de-la-madeleine', 'kom-hautvilliers')).toBe(200);
    expect(store.get('ar.pr.chevreuse.cote-de-la-madeleine.kom-hautvilliers')).toBe('200');
    setKomZone('idf-ablis');
    expect(readSegmentPr('boucle-30-km', 'boucle-30-km-kom-1')).toBeNull();
  });
});
