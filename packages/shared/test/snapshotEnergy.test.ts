import { describe, expect, it } from 'vitest';
import { decodeSnapshot, encodeSnapshot, type RosterEntry, type SnapshotRow } from '../src/net.ts';

const roster = new Map<number, RosterEntry>([[1, { n: 1, id: 'ai-1', name: 'Steve', isAI: true, isGuest: false } as unknown as RosterEntry]]);
const row: SnapshotRow = { n: 1, distM: 10, lateralM: 0.5, speedMs: 11, watts: 320, cadence: 95, draftPct: 20, lap: 0, pose: 'standing', dir: -1, energy: 47, effort: 'attack' };

describe('instantané compact : énergie des IA', () => {
  it('aller-retour de l’énergie et de l’état, posture et sens intacts', () => {
    const snap = decodeSnapshot(encodeSnapshot(1, 0, [row]), roster).riders[0]!;
    expect(snap).toMatchObject({ pose: 'standing', dir: -1, energy: 47, effort: 'attack' });
  });
  it('un ancien client (bits 0 à 2 seulement) lit toujours la bonne posture et le bon sens', () => {
    const flags = encodeSnapshot(1, 0, [row]).r[9]!;
    expect(flags & 3).toBe(1);
    expect((flags & 4) !== 0).toBe(true);
  });
  it('un ancien serveur (sans énergie) : rien de lu', () => {
    const snap = decodeSnapshot(encodeSnapshot(1, 0, [{ ...row, energy: undefined, effort: undefined } as SnapshotRow]), roster).riders[0]!;
    expect(snap.energy).toBeUndefined();
    expect(snap.effort).toBeUndefined();
  });
});
