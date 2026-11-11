import { describe, expect, it } from 'vitest';
import { approachOk, deckVerdict, pruneLifts, type DeckStation } from '../src/bridge-decks.ts';

/** Graphe en ligne : nœuds 0…n, arête i = (i, i+1) de longueur lens[i], `bridges` : indices des arêtes pont. */
function line(lens: number[], bridges: number[]) {
  const edges = lens.map((len, i) => ({ a: i, b: i + 1, len, road: { bridge: bridges.includes(i) } }));
  const adj = (nd: number) => edges.flatMap((e, i) => (e.a === nd || e.b === nd ? [i] : []));
  return { edges, adj };
}

describe('cohérence des relèvements', () => {
  it('relève les deux bouts d’un pont dont les accès sont assez longs', () => {
    const { edges, adj } = line([100, 30, 100], [1]);
    const r = pruneLifts(new Map([[1, 108], [2, 108]]), [[1, 2]], edges, adj, () => 100);
    expect([...r.nodeHeights]).toEqual([[1, 108], [2, 108]]);
  });

  it('abandonne tout le pont si un seul bout peut être relevé', () => {
    // accès de gauche 100 m (8 % : accepté), accès de droite 30 m (27 % : refusé) → aucun des deux
    const { edges, adj } = line([100, 28, 30], [1]);
    const r = pruneLifts(new Map([[1, 108], [2, 108]]), [[1, 2]], edges, adj, () => 100);
    expect(r.nodeHeights.size).toBe(0);
    expect(r.rejected).toBe(2);
  });

  it('refuse un pont qui deviendrait une rampe', () => {
    const { edges, adj } = line([200, 20, 200], [1]);
    const r = pruneLifts(new Map([[1, 105]]), [[1]], edges, adj, () => 100);
    expect(r.nodeHeights.size).toBe(0);
  });

  it('additionne les relèvements des deux bouts d’un accès court', () => {
    // accès de 31 m entre deux ponts : l'un relevé de 2,9 m, l'autre abaissé de rien → 9,4 % : accepté ;
    // relevé à un bout de 2,9 m alors que l'autre bout descend déjà de 1,5 m → refusé
    const { edges, adj } = line([20, 31, 20], [0, 2]);
    const ok = pruneLifts(new Map([[1, 102.9]]), [[1]], edges, adj, (nd) => (nd === 0 ? 102.9 : 100));
    expect(ok.nodeHeights.size).toBe(1);
    const ko = pruneLifts(new Map([[1, 102.9]]), [[1]], edges, adj, (nd) => (nd === 2 ? 98.5 : nd === 0 ? 102.9 : 100));
    expect(ko.nodeHeights.size).toBe(0);
  });
});

/** Pont de `len` m, tablier de `h0` à `h1`, berges `drop` m plus bas, BD TOPO décalée de `bdOff`. */
function bridge(len: number, h0: number, h1: number, drop = 6, bdOff: number | null = 0.3): DeckStation[] {
  const st: DeckStation[] = [];
  for (let s = 0; s <= len; s += 2) {
    const mns = h0 + ((h1 - h0) * s) / len;
    st.push({ s, mns, left: mns - drop, right: mns - drop, bd: bdOff === null ? NaN : mns + bdOff });
  }
  return st;
}

describe('altitude des extrémités de ponts', () => {
  it('relève un bout de pont posé sur la berge (cas du Pont du Bateau)', () => {
    const v = deckVerdict(bridge(134, 335.9, 336.2), 335.8, 329.3);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.hb).toBeCloseTo(336.2, 0);
    expect(v.liftB).toBeGreaterThan(6);
    expect(v.liftA).toBeLessThan(1);
  });

  it('ne touche pas un pont déjà au niveau', () => {
    expect(deckVerdict(bridge(60, 320, 321), 320.2, 320.8)).toEqual({ ok: false, reason: 'déjà au niveau' });
  });

  it('refuse sans accord de la BD TOPO', () => {
    expect(deckVerdict(bridge(60, 326, 326, 6, 6), 314, 314)).toEqual({ ok: false, reason: 'bdtopo en désaccord' });
    expect(deckVerdict(bridge(60, 326, 326, 6, null), 314, 314)).toEqual({ ok: false, reason: 'bdtopo absente' });
  });

  it('refuse une surface sans bords (ouvrage au-dessus, dalle large)', () => {
    expect(deckVerdict(bridge(28, 348.1, 348.1, 0), 339.8, 340.6)).toEqual({ ok: false, reason: 'sans bords' });
  });

  it('refuse un MNS irrégulier ou trop pentu', () => {
    const bumpy = bridge(60, 320, 320).map((p, i) => ({ ...p, mns: p.mns + (i % 2 ? 3 : -3) }));
    expect(deckVerdict(bumpy, 310, 310)).toEqual({ ok: false, reason: 'pas un tablier' });
    expect(deckVerdict(bridge(40, 300, 320), 290, 310)).toEqual({ ok: false, reason: 'pas un tablier' });
  });

  it('écarte un relèvement qui rendrait une voie d’accès trop raide', () => {
    expect(approachOk(7, [81, 120])).toBe(true);
    expect(approachOk(8, [81, 30])).toBe(false);
    expect(approachOk(2, [])).toBe(true);
  });

  it('refuse un MNS absent ou un pont trop court', () => {
    const holes = bridge(60, 320, 320).map((p, i) => (i % 2 ? { ...p, mns: NaN } : p));
    expect(deckVerdict(holes, 310, 310)).toEqual({ ok: false, reason: 'mns absent' });
    expect(deckVerdict(bridge(2, 320, 320), 310, 310)).toEqual({ ok: false, reason: 'court' });
  });
});
