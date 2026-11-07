import { describe, expect, it } from 'vitest';
import { StreetIndex, dropShortRuns, pushSidewalk, trimOverBank, refineSidewalkEnds, resampleStrip, type MeshSink } from '../src/world/sidewalks.ts';
import { FootprintIndex } from '../src/world/footprints.ts';
import type { LoadedTile, TileRoad } from '../src/world/types.ts';

/** Bâtiment carré de `size` m, coin bas-gauche en (x, z). */
const square = (x: number, z: number, size: number) => ({ pts: [x, z, x + size, z, x + size, z + size, x, z + size] });
const road = (pts3: number[], width = 8) => ({ pts3, width }) as unknown as TileRoad;
const tile = (buildings: Array<{ pts: number[] }>) => ({ features: { buildings } }) as unknown as LoadedTile;

describe('StreetIndex', () => {
  // Voie nord-sud en x = 0 (demi-chaussée 4 m), bâtiment dont le mur est en x = 9.
  const main = road([0, 0, -100, 0, 0, 100]);
  const index = new StreetIndex(tile([square(9, -10, 20)]), [main]);

  it('sait où est la chaussée et où sont les bâtiments', () => {
    expect(index.onRoad(3, 0)).toBe(true);
    expect(index.onRoad(6, 0)).toBe(false);
    expect(index.inBuilding(12, 0)).toBe(true);
    expect(index.inBuilding(7, 0)).toBe(false);
  });

  it('pose le trottoir jusqu au mur, en y entrant un peu', () => {
    const w = index.clearWidth(4.6, 0, 1, 0);
    expect(4.6 + w).toBeGreaterThan(9);
    expect(4.6 + w).toBeLessThan(10);
  });

  it('ne pose pas de trottoir contre un mur trop proche', () => {
    expect(new StreetIndex(tile([square(4.8, -10, 20)]), [main]).clearWidth(4.6, 0, 1, 0)).toBe(0);
  });

  it('arrête le trottoir avant la chaussée d une autre voie', () => {
    const cross = road([-100, 0, 8, 100, 0, 8]);
    const x = new StreetIndex(tile([square(10, -6, 4)]), [cross]);
    // Depuis z = 1 vers z croissant : la chaussée de la voie transversale commence vers z = 3,5.
    const w = x.clearWidth(0, 1, 0, 1);
    expect(w).toBeGreaterThan(0);
    expect(1 + w).toBeLessThan(4);
    // Déjà sur la chaussée : aucun trottoir.
    expect(x.clearWidth(0, 8, 0, 1)).toBe(0);
  });

  it('ne pose rien en rase campagne', () => {
    expect(new StreetIndex(tile([square(500, 500, 10)]), [main]).clearWidth(4.6, 0, 1, 0)).toBe(0);
  });

  it('ne pose rien côté champ quand le seul bâtiment est en face', () => {
    // Bâtiment à l'est (mur en x = 9) : le trottoir ouest ne donnerait que sur un pré.
    expect(index.clearWidth(-4.6, 0, -1, 0)).toBe(0);
  });

  it('pose un trottoir de largeur par défaut devant un bâtiment en retrait (jardinet)', () => {
    const w = new StreetIndex(tile([square(14, -10, 20)]), [main]).clearWidth(4.6, 0, 1, 0);
    expect(w).toBeCloseTo(2.2);
  });
});

describe('dropShortRuns', () => {
  const along = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30];
  it('supprime un bout isolé, garde une vraie rue', () => {
    const w = [0, 0, 2, 2, 0, 2, 2, 2, 2, 2, 0];
    dropShortRuns(w, along, 10);
    expect(w).toEqual([0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 0]);
  });
  it('tolère un bout plus court contre une extrémité (il continue au-delà du carrefour)', () => {
    const w = [2, 2, 2, 0, 0, 0, 0, 0, 0, 2, 2];
    dropShortRuns(w, along, 10);
    expect(w).toEqual([2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('trimOverBank', () => {
  it('arrête le trottoir avant le talus, le garde sur sol plat, ignore un sol inconnu', () => {
    // Bord de chaussée en x = 4, y = 100 ; le sol tombe de 1 m à partir de x = 6.
    const bank = (x: number) => (x < 6 ? 99.95 : 99);
    const w = trimOverBank(4, 4, 100, 0, 1, 0, bank);
    expect(w).toBeGreaterThanOrEqual(0.9);
    expect(4 + w).toBeLessThanOrEqual(6);
    expect(trimOverBank(4, 4, 100, 0, 1, 0, () => 99.95)).toBe(4);
    expect(trimOverBank(4, 4, 100, 0, 1, 0, () => Number.NaN)).toBe(4);
    // Talus dès la bordure : plus de trottoir.
    expect(trimOverBank(4, 4, 100, 0, 1, 0, () => 99)).toBe(0);
  });
});

describe('resampleStrip', () => {
  it('garde les extrémités et respecte le pas', () => {
    const r = resampleStrip([0, 0, 0, 0, 0, 10], [8, 0, 0, 8, 0, 10], [0, 10], 3);
    expect(r.along[0]).toBe(0);
    expect(r.along[r.along.length - 1]).toBe(10);
    expect(r.along.length).toBe(5);
    expect(r.left.length).toBe(15);
    expect(r.right[3]).toBe(8);
  });
});

describe('pushSidewalk', () => {
  const sink = (): MeshSink => ({ pos: [], uvs: [], info: [], lit: [], decal: [], dsize: [], side: [], index: [] });

  it('tourne le dessus vers le haut des deux côtés de la voie', () => {
    for (const sign of [-1, 1]) {
      const s = sink();
      const x = sign * 4.6;
      pushSidewalk(s, [x, 0, 0, x, 0, 3], [0, 3], [2, 2], [1, 1], [0, 0], sign, 4.6, 4, [0, 0], () => 0);
      // Troisième bande (dalle) du premier tronçon : deux triangles, normale vers +y (les bouts viennent après).
      const [a, b, c] = s.index.slice(12, 18) as [number, number, number];
      const v = (i: number) => [s.pos[i * 3] as number, s.pos[i * 3 + 1] as number, s.pos[i * 3 + 2] as number] as const;
      const [ax, ay, az] = v(a);
      const [bx, by, bz] = v(b);
      const [cx, cy, cz] = v(c);
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      expect(by).toBeGreaterThanOrEqual(ay);
      expect(cy).toBeGreaterThanOrEqual(ay);
      expect(ny).toBeGreaterThan(0);
    }
  });

  it('n ajoute aucun triangle sans largeur', () => {
    const s = sink();
    pushSidewalk(s, [4.6, 0, 0, 4.6, 0, 3], [0, 3], [0, 0], [1, 1], [0, 0], 1, 4.6, 4, [0, 0], () => 0);
    expect(s.index.length).toBe(0);
  });

  it('descend une face jusqu au terrain quand il est plus bas que la dalle (plus de dalle qui flotte)', () => {
    const s = sink();
    pushSidewalk(s, [4.6, 0, 0, 4.6, 0, 3], [0, 3], [2, 2], [1, 1], [0, 0], 1, 4.6, 4, [0, 0], () => -0.6);
    // Pied de la face extérieure du premier profil : au terrain (−0,6), un peu dessous.
    expect(s.pos[7 * 3 + 1]).toBeCloseTo(-0.65);
    // Bordure, dessus, dalle, puis la face extérieure : quatre bandes.
    expect(s.index.length).toBeGreaterThanOrEqual(24);
    const flat = sink();
    pushSidewalk(flat, [4.6, 0, 0, 4.6, 0, 3], [0, 3], [2, 2], [1, 1], [0, 0], 1, 4.6, 4, [0, 0], () => 0.2);
    expect(flat.index.length).toBe(s.index.length - 6);
  });

  it('remonte la dalle sur un terrain plus haut, mais pas au-delà d un écart aberrant', () => {
    const s = sink();
    pushSidewalk(s, [4.6, 0, 0], [0], [2], [1], [0], 1, 4.6, 4, [0], () => 0.8);
    expect(s.pos[5 * 3 + 1]).toBeCloseTo(0.82);
    const t = sink();
    pushSidewalk(t, [4.6, 0, 0], [0], [2], [1], [0], 1, 4.6, 4, [0], () => 9);
    expect(t.pos[5 * 3 + 1]).toBeCloseTo(0.12);
  });
});

describe('bouts de trottoir au carrefour', () => {
  const sink = (): MeshSink => ({ pos: [], uvs: [], info: [], lit: [], decal: [], dsize: [], side: [], index: [] });

  it('ne dessine rien entre un profil avec trottoir et un profil sans (plus de pointe sur la chaussée voisine)', () => {
    const s = sink();
    pushSidewalk(s, [4.6, 0, 0, 4.6, 0, 3], [0, 3], [2, 0], [1, 1], [0, 0], 1, 4.6, 4, [0, 0], () => 0);
    // Rien que la face verticale du bout (deux triangles).
    expect(s.index.length).toBe(6);
  });

  it('pose un dernier profil juste avant la chaussée voisine', () => {
    // Bord droit d'une voie le long de z ; une autre chaussée commence à z = 7,3.
    const sd = { edge: [4.6, 0, 0, 4.6, 0, 3, 4.6, 0, 6, 4.6, 0, 9], along: [0, 3, 6, 9], widths: [2, 2, 2, 0], kinds: [], lamp: [0, 0, 0, 0], ux: [1, 1, 1, 1], uz: [0, 0, 0, 0] };
    const r = refineSidewalkEnds(sd, (_x, _y, z) => ({ w: z < 7.3 ? 2 : 0, kind: { wall: false, shop: false } }));
    expect(r.along.length).toBe(5);
    expect(r.along[3]).toBeGreaterThan(7.1);
    expect(r.along[3]).toBeLessThan(7.3);
    expect(r.widths[3]).toBe(2);
    expect(r.widths[4]).toBe(0);
  });
});

describe('StreetIndex.crossRoad', () => {
  it('voit la chaussée qui croise, pas la rue elle-même', () => {
    const ns = road([0, 0, -100, 0, 0, 100]);
    const ew = road([-100, 0, 0, 100, 0, 0]);
    const idx = new StreetIndex(tile([]), [ns, ew]);
    // Sur l'axe de la rue nord-sud, en dehors du carrefour : seulement la rue elle-même.
    expect(idx.crossRoad(0, 30, 0, 1)).toBe(false);
    // Dans le carrefour : la rue est-ouest croise.
    expect(idx.crossRoad(2, 1, 0, 1)).toBe(true);
  });
});

describe('FootprintIndex.countNear', () => {
  it('compte chaque bâtiment une fois, à la distance de son emprise', () => {
    const f = new FootprintIndex();
    // À cheval sur plusieurs cases de la grille.
    f.add('t', [0, 0, 40, 0, 40, 40, 0, 40], 0, 10);
    f.add('t', [200, 0, 210, 0, 210, 10, 200, 10], 0, 10);
    expect(f.countNear(20, 20, 5)).toBe(1);
    expect(f.countNear(50, 20, 15)).toBe(1);
    expect(f.countNear(50, 20, 5)).toBe(0);
    expect(f.countNear(100, 5, 110)).toBe(2);
  });
});
