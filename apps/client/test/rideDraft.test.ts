import { describe, expect, it } from 'vitest';
import type { ActivityRecord } from '@allezrobert/shared';
import { DRAFT_MAX_AGE_MS, DraftWriter, MemoryDraftStore, draftWorth, loadDraft, pendingDrafts, type DraftSnapshot } from '../src/game/rideDraft.ts';

const rec = (i: number): ActivityRecord => ({ t: 1_000_000 + i * 1000, distanceM: i * 8, speedMs: 8, altitudeM: 400, watts: 200 + (i % 7), cadence: 90 });

function ride(startT = 1_000_000) {
  const records: ActivityRecord[] = [];
  const snap = (): DraftSnapshot => ({
    startT,
    name: 'Boucle de Billom',
    routeId: 'billom-1',
    kind: 'free',
    ftpWatts: 250,
    massKg: 72,
    skipStrava: false,
    elapsedS: records.length,
    distanceM: records.length * 8,
    elevationM: 12,
    lapTimes: [],
    simulated: false,
    records,
  });
  return { records, snap };
}

describe('brouillon de sortie', () => {
  it('écrit seulement les mesures nouvelles, par morceaux, et les relit dans l’ordre', async () => {
    const store = new MemoryDraftStore();
    const r = ride();
    const w = new DraftWriter(store, r.snap, 1e9);
    for (let i = 0; i < 70; i++) r.records.push(rec(i));
    await w.flush();
    for (let i = 70; i < 130; i++) r.records.push(rec(i));
    await w.flush();
    await w.flush(); // rien de nouveau : pas de morceau vide
    expect(store.parts.size).toBe(2);
    const [meta] = await pendingDrafts(store);
    expect(meta).toBeDefined();
    expect(meta!.count).toBe(130);
    const draft = await loadDraft(store, meta!);
    expect(draft.records.map((x) => x.t)).toEqual(r.records.map((x) => x.t));
    expect(draft.name).toBe('Boucle de Billom');
  });

  it('n’écrit rien avant la première mesure et efface le brouillon d’une sortie quittée', async () => {
    const store = new MemoryDraftStore();
    const r = ride();
    const w = new DraftWriter(store, r.snap, 1e9);
    await w.flush();
    expect(store.meta.size).toBe(0);
    for (let i = 0; i < 90; i++) r.records.push(rec(i));
    await w.flush();
    expect(store.meta.size).toBe(1);
    await w.discard(1_000_000);
    expect(store.meta.size).toBe(0);
    expect(store.parts.size).toBe(0);
    r.records.push(rec(90));
    await w.flush(); // arrêté : plus rien n'est écrit
    expect(store.meta.size).toBe(0);
  });

  it('ne propose ni une sortie trop courte, ni un vieux brouillon, ni une sortie enregistrée sans suite', () => {
    const now = 10 * DRAFT_MAX_AGE_MS;
    expect(draftWorth({ count: 59, savedAt: now }, now)).toBe(false);
    expect(draftWorth({ count: 600, savedAt: now - DRAFT_MAX_AGE_MS - 1 }, now)).toBe(false);
    expect(draftWorth({ count: 600, savedAt: now, recordedCount: 600 }, now)).toBe(false);
    expect(draftWorth({ count: 660, savedAt: now, recordedCount: 600 }, now)).toBe(true);
    expect(draftWorth({ count: 60, savedAt: now }, now)).toBe(true);
  });

  it('efface au passage les brouillons sans intérêt et range les autres du plus récent au plus ancien', async () => {
    const store = new MemoryDraftStore();
    for (const startT of [1_000_000, 3_000_000, 2_000_000]) {
      const r = ride(startT);
      for (let i = 0; i < (startT === 2_000_000 ? 10 : 80); i++) r.records.push(rec(i));
      await new DraftWriter(store, r.snap, 1e9).flush();
    }
    const list = await pendingDrafts(store);
    expect(list.map((m) => m.startT)).toEqual([3_000_000, 1_000_000]);
    expect(store.meta.has(2_000_000)).toBe(false);
  });
});
