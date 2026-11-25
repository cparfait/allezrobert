import { describe, expect, it, vi } from 'vitest';
import { RideSaver, withTimeout } from '../src/game/rideSave.ts';
import { MemoryDraftStore, pendingDrafts, type DraftMeta, type RideDraft } from '../src/game/rideDraft.ts';
import { forgetDraft } from '../src/ui/rideRecovery.ts';

describe('enregistrement de la sortie', () => {
  it('les écritures se suivent, jamais deux à la fois', async () => {
    const s = new RideSaver();
    const log: string[] = [];
    let release = (): void => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const first = s.save(async () => {
      log.push('début 1');
      await gate;
      log.push('fin 1');
    });
    const second = s.save(async () => void log.push('2'));
    await new Promise((r) => setTimeout(r, 5));
    expect(log).toEqual(['début 1']);
    release();
    expect(await first).toBe('saved');
    expect(await second).toBe('saved');
    expect(log).toEqual(['début 1', 'fin 1', '2']);
  });
  it('un échec est rendu comme un état, sans bloquer l’écriture suivante', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = new RideSaver();
    expect(await s.save(() => Promise.reject(new Error('disque plein')))).toBe('failed');
    expect(await s.settled(50)).toBe('failed');
    expect(await s.save(async () => 1)).toBe('saved');
    warn.mockRestore();
  });
  it('quitter n’attend pas sans fin', async () => {
    const s = new RideSaver();
    void s.save(() => new Promise(() => undefined));
    expect(await s.settled(10)).toBe('saving');
    expect(await withTimeout(Promise.reject(new Error('x')), 10, 'repli')).toBe('repli');
  });
  it('rien à enregistrer : rien à attendre', async () => {
    expect(await new RideSaver().settled(10)).toBe('too_short');
  });
});

describe('récupération enregistrée', () => {
  const now = Date.now();
  const meta: DraftMeta = { v: 1, startT: now - 600_000, savedAt: now, name: 'Billom', routeId: null, kind: 'free', ftpWatts: 250, massKg: 72, skipStrava: false, elapsedS: 600, distanceM: 5000, elevationM: 10, lapTimes: [], simulated: false, chunks: 1, count: 600 };
  const draft: RideDraft = { ...meta, records: [] };

  it('le brouillon est effacé', async () => {
    const store = new MemoryDraftStore();
    await store.putMeta(meta);
    expect(await forgetDraft(store, draft)).toBe(true);
    expect(store.meta.size).toBe(0);
  });
  it('effacement impossible : marqué « enregistré », il n’est plus proposé (pas de seconde XP)', async () => {
    const store = new MemoryDraftStore();
    await store.putMeta(meta);
    const remove = vi.spyOn(store, 'remove').mockRejectedValue(new Error('bloqué'));
    expect(await forgetDraft(store, draft)).toBe(true);
    remove.mockRestore();
    expect(await pendingDrafts(store)).toEqual([]);
  });
  it('ni effacé ni marqué : le dit, sans lever d’erreur', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new MemoryDraftStore();
    vi.spyOn(store, 'remove').mockRejectedValue(new Error('bloqué'));
    vi.spyOn(store, 'putMeta').mockRejectedValue(new Error('bloqué'));
    expect(await forgetDraft(store, draft)).toBe(false);
    warn.mockRestore();
  });
});
