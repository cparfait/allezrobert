/** Outils purs du client réseau (apps/client/src/net) : horloge, interpolation, réconciliation. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, type RiderSnapshot, type WorldSnapshotMsg } from '@allezrobert/shared';
import { ClockSync, SelfReconciler, SnapshotBuffer } from '../../client/src/net/index.ts';

const L = 1000;

function snap(t: number, distM: number, lap: number, speedMs = 10, id = 'a'): WorldSnapshotMsg {
  const r: RiderSnapshot = { id, name: id, distM, lateralM: 0, speedMs, watts: 200, cadence: 90, draftPct: 0, isAI: false, isGuest: false, lap, avatar: DEFAULT_LOOK, pose: 'seated' };
  return { tick: t / 100, t, riders: [r] };
}

describe('client réseau — outils purs', () => {
  it('horloge : décalage = trajet le plus rapide', () => {
    const c = new ClockSync();
    c.add(1000 + 50, 1_000_000); // 50 ms de trajet
    c.add(1100 + 20, 1_000_100); // 20 ms
    c.add(1200 + 80, 1_000_200);
    expect(c.offsetMs).toBe(1020 - 1_000_000);
    expect(c.toServer(1500)).toBe(1_000_480);
  });

  it('interpolation à travers la ligne de tour (distances dépliées)', () => {
    const b = new SnapshotBuffer(40, 150, 250);
    b.routeLengthM = L;
    b.loop = true;
    b.push(snap(0, 995, 0));
    b.push(snap(100, 5, 1)); // a franchi la ligne : 995 → 1005 en dépliée
    const mid = b.sample('a', 50 + 150)!;
    expect(mid.unwrappedM).toBeCloseTo(1000, 6);
    expect(mid.lap).toBe(1);
    expect(mid.distM).toBeCloseTo(0, 6);
    const before = b.sample('a', 25 + 150)!;
    expect(before.lap).toBe(0);
    expect(before.distM).toBeCloseTo(997.5, 6);
  });

  it('extrapolation bornée quand les instantanés manquent', () => {
    const b = new SnapshotBuffer(40, 150, 250);
    b.routeLengthM = L;
    b.push(snap(0, 100, 0, 10));
    const r = b.sample('a', 1000 + 150)!; // 1 s après : borné à 250 ms
    expect(r.extrapolated).toBe(true);
    expect(r.unwrappedM).toBeCloseTo(102.5, 6);
    expect(b.sample('inconnu', 200)).toBeNull();
  });

  it('réconciliation douce puis recalage au-delà de 25 m', () => {
    const rec = new SelfReconciler(0.6, 25);
    for (let t = 0; t <= 1000; t += 16) rec.record(t, 100 + t / 100); // 10 m/s
    rec.authoritative(500, 105 + 2); // serveur 2 m devant la prédiction à t = 500 ms
    let applied = 0;
    for (let i = 0; i < 120; i++) applied += rec.correction(1 / 60);
    expect(applied).toBeGreaterThan(1.9);
    expect(applied).toBeLessThanOrEqual(2 + 1e-9);
    rec.authoritative(992, 109.92 + 40); // dernier point enregistré
    // Historique déjà décalé de la correction appliquée : écart restant 40 − applied, recalé d'un coup.
    expect(rec.correction(1 / 60)).toBeCloseTo(40 - applied, 6);
    expect(rec.pendingErrorM).toBe(0);
  });
});
