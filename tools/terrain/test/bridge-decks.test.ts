import { describe, expect, it } from 'vitest';
import { approachOk, bridgeChains, chainVerdict, deckVerdict, pruneLifts, type ChainEdge, type DeckStation } from '../src/bridge-decks.ts';

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

/** Tronçon de pont de `len` m entre les nœuds a et b, tablier plat à `h`, berges `drop` m plus bas. */
function piece(a: number, b: number, len: number, h: number, drop = 6, bdOff: number | null = 0.3): ChainEdge {
  return { a, b, len, st: bridge(len, h, h, drop, bdOff) };
}

describe('ponts en plusieurs tronçons (ouvrages)', () => {
  it('regroupe les tronçons de pont qui se touchent, pas les autres', () => {
    const edges = [
      { a: 0, b: 1 }, // route
      { a: 1, b: 2 }, // pont
      { a: 2, b: 3 }, // pont
      { a: 3, b: 4 }, // pont
      { a: 4, b: 5 }, // route
      { a: 5, b: 6 }, // autre pont
    ];
    const chains = bridgeChains(edges, (i) => [1, 2, 3, 5].includes(i)).map((c) => c.sort());
    expect(chains).toEqual([[1, 2, 3], [5]]);
  });

  it('relève tout le Pont d’Issy : deux tronçons centraux et deux bouts de 4 m sans bords mesurables', () => {
    // tablier à 37 m, MNT à 27 m (la Seine) ; les bouts de 4 m n'ont pas de bords nets
    const edges = [piece(1, 2, 4, 37, 0), piece(2, 3, 63, 37), piece(3, 4, 63, 37), piece(4, 5, 4, 37, 0)];
    const v = chainVerdict(edges, () => 27);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect([...v.heights.keys()].sort()).toEqual([1, 2, 3, 4, 5]);
    for (const h of v.heights.values()) expect(h).toBeCloseTo(37.3, 0);
    // chacun de ces bouts, jugé seul, aurait été refusé
    expect(deckVerdict(edges[0]!.st, 27, 27).ok).toBe(false);
  });

  it('ne relève que les nœuds sous le tablier (bout de pont déjà sur la berge)', () => {
    const v = chainVerdict([piece(1, 2, 40, 37), piece(2, 3, 40, 37)], (nd) => (nd === 1 ? 37 : 27));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect([...v.heights.keys()].sort()).toEqual([2, 3]);
  });

  it('refuse un ouvrage dont la BD TOPO n’est pas d’accord', () => {
    expect(chainVerdict([piece(1, 2, 40, 37, 6, 6), piece(2, 3, 40, 37, 6, 6)], () => 27)).toEqual({ ok: false, reason: 'bdtopo en désaccord' });
  });

  it('garde un ouvrage relevé entier quand ses accès sont assez longs', () => {
    // route 120 m — pont 4 m — pont 63 m — pont 4 m — route 120 m, tous les nœuds du pont à 37 m
    const { edges, adj } = line([120, 4, 63, 4, 120], [1, 2, 3]);
    const cands = new Map([[1, 37], [2, 37], [3, 37], [4, 37]]);
    const r = pruneLifts(cands, [[1, 2], [2, 3], [3, 4]], edges, adj, () => 27);
    expect(r.nodeHeights.size).toBe(4);
  });

  it('ne laisse pas un bout de trottoir de 4 m bloquer le pont, mais garde le contrôle pour une route', () => {
    // pont 63 m entre 1 et 2, accès de 120 m ; nœud 3 au sol relié au nœud 1 par une voie de 4 m
    const mk = (kind: string) => {
      const edges = [
        { a: 0, b: 1, len: 120, road: { bridge: false, kind: 'primary' } },
        { a: 1, b: 2, len: 63, road: { bridge: true, kind: 'primary' } },
        { a: 2, b: 4, len: 120, road: { bridge: false, kind: 'primary' } },
        { a: 1, b: 3, len: 4, road: { bridge: false, kind } },
      ];
      const adj = (nd: number) => edges.flatMap((e, i) => (e.a === nd || e.b === nd ? [i] : []));
      return pruneLifts(new Map([[1, 37], [2, 37]]), [[1, 2]], edges, adj, () => 27).nodeHeights.size;
    };
    expect(mk('footway')).toBe(2);
    expect(mk('residential')).toBe(0);
  });
});

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
