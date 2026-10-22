import { describe, expect, it } from 'vitest';
import { RouteFootprint, ribbonEdges, ribbonIndex, roundCorners, sideRoadStrips, type AxisPoint3 } from '../src/world/ribbon.ts';

const HALF = 3.25;
const SHOULDER = 1.2;
const OFFSETS = [-(HALF + SHOULDER), -HALF, HALF, HALF + SHOULDER];

/** Axe : polyligne échantillonnée tous les `step` m (x, z), y = 100, d cumulée. */
function axis(path: Array<[number, number]>, step = 1): AxisPoint3[] {
  const out: AxisPoint3[] = [];
  let d = 0;
  for (let s = 0; s < path.length - 1; s++) {
    const [ax, az] = path[s] as [number, number];
    const [bx, bz] = path[s + 1] as [number, number];
    const L = Math.hypot(bx - ax, bz - az);
    const k = Math.max(1, Math.round(L / step));
    for (let i = 0; i < k; i++) {
      const t = i / k;
      if (out.length) {
        const p = out[out.length - 1] as AxisPoint3;
        d += Math.hypot(ax + (bx - ax) * t - p.x, az + (bz - az) * t - p.z);
      }
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, y: 100, d });
    }
  }
  const [lx, lz] = path[path.length - 1] as [number, number];
  const p = out[out.length - 1] as AxisPoint3;
  out.push({ x: lx, z: lz, y: 100, d: d + Math.hypot(lx - p.x, lz - p.z) });
  return out;
}

/** Épingle : montée le long de +x, demi-cercle de rayon r, redescente le long de −x. */
function hairpin(r: number, leg = 40, step = 1): AxisPoint3[] {
  const path: Array<[number, number]> = [[-leg, 0]];
  const k = Math.max(4, Math.ceil((Math.PI * r) / step));
  for (let i = 0; i <= k; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / k;
    path.push([Math.cos(a) * r, r + Math.sin(a) * r]);
  }
  path.push([-leg, 2 * r]);
  return axis(path, step);
}

function segIntersect(a: number[], b: number[], c: number[], d: number[]): boolean {
  const o = (p: number[], q: number[], r: number[]) => ((q[0] as number) - (p[0] as number)) * ((r[1] as number) - (p[1] as number)) - ((q[1] as number) - (p[1] as number)) * ((r[0] as number) - (p[0] as number));
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

/** Vérifie un ruban : bords qui avancent, sans auto-intersection, triangles jamais retournés. */
function checkRibbon(axisPts: AxisPoint3[], loop = false): { clamped: number; cols: Float64Array[]; pts: AxisPoint3[] } {
  // comme RoadMesh : virages vifs démultipliés, puis bords sans repli
  const { pts, normals } = roundCorners(axisPts, loop);
  const cols = ribbonEdges(pts, OFFSETS, loop, normals);
  const n = pts.length;
  let clamped = 0;
  for (let c = 0; c < cols.length; c++) {
    const e = cols[c] as Float64Array;
    const P = (i: number) => [e[i * 2] as number, e[i * 2 + 1] as number];
    for (let i = 0; i < (loop ? n : n - 1); i++) {
      const j = (i + 1) % n;
      const ax = (pts[j] as AxisPoint3).x - (pts[i] as AxisPoint3).x;
      const az = (pts[j] as AxisPoint3).z - (pts[i] as AxisPoint3).z;
      const dot = ((P(j)[0] as number) - (P(i)[0] as number)) * ax + ((P(j)[1] as number) - (P(i)[1] as number)) * az;
      expect(dot, `colonne ${c}, segment ${i} à rebours`).toBeGreaterThanOrEqual(-1e-6);
    }
    // segments non dégénérés, sans croisement entre eux
    const segs: Array<[number[], number[]]> = [];
    for (let i = 0; i < n - 1; i++) if (Math.hypot((P(i + 1)[0] as number) - (P(i)[0] as number), (P(i + 1)[1] as number) - (P(i)[1] as number)) > 1e-6) segs.push([P(i), P(i + 1)]);
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 2; j < segs.length; j++) {
        const [a, b] = segs[i] as [number[], number[]];
        const [cc, d] = segs[j] as [number[], number[]];
        expect(segIntersect(a, b, cc, d), `colonne ${c} : segments ${i} et ${j} se croisent`).toBe(false);
      }
    for (let i = 0; i < n; i++) {
      const p = pts[i] as AxisPoint3;
      if (Math.abs(Math.hypot((P(i)[0] as number) - p.x, (P(i)[1] as number) - p.z) - Math.abs(OFFSETS[c] as number)) > 1e-6) clamped++;
    }
  }
  // Triangles du maillage (même découpage que RoadMesh, profil de fermeture compris) : tous à
  // l'endroit (aire signée xz négative, voir ribbonIndex), dégénérés tolérés.
  const rows = loop ? n + 1 : n;
  const pos: number[] = [];
  for (let k = 0; k < rows; k++) for (const e of cols) pos.push(e[(k % n) * 2] as number, 0, e[(k % n) * 2 + 1] as number);
  const index = ribbonIndex(pos, 3, cols.length, rows);
  expect(index.length).toBe((rows - 1) * (cols.length - 1) * 6);
  for (let t = 0; t < index.length; t += 3) {
    const [i, j, k] = [index[t] as number, index[t + 1] as number, index[t + 2] as number];
    const ar = ((pos[j * 3] as number) - (pos[i * 3] as number)) * ((pos[k * 3 + 2] as number) - (pos[i * 3 + 2] as number)) - ((pos[j * 3 + 2] as number) - (pos[i * 3 + 2] as number)) * ((pos[k * 3] as number) - (pos[i * 3] as number));
    expect(ar, `triangle ${t / 3} retourné`).toBeLessThanOrEqual(1e-6);
  }
  return { clamped, cols, pts };
}

describe('ruban de l’itinéraire', () => {
  it('épingle large (rayon 12 m) : décalage exact, rien à corriger', () => {
    expect(checkRibbon(hairpin(12)).clamped).toBe(0);
  });

  it('épingle serrée (rayon 3 m < décalage 4,45 m) : bord intérieur sans repli', () => {
    expect(checkRibbon(hairpin(3)).clamped).toBeGreaterThan(0);
  });

  it('épingle de 5,5 m (Alpe d’Huez, virage 2) échantillonnée tous les 2 m', () => {
    checkRibbon(hairpin(5.5, 60, 2));
  });

  it('demi-tour en deux points (aller-retour à 3,4 m d’écart, données GPS)', () => {
    const pts = axis(
      [
        [-40, 0],
        [0, 0],
        [1.5, 1.7],
        [0, 3.4],
        [-40, 3.4],
      ],
      2,
    );
    checkRibbon(pts);
  });

  it('angle droit de carrefour (rayon ≈ 1 m) dans une boucle', () => {
    const pts = axis(
      [
        [0, 0],
        [60, 0],
        [61, 1],
        [61, 60],
        [0, 60],
        [0, 2],
      ],
      2,
    );
    checkRibbon(pts, true);
  });

  it('angle droit : bord extérieur arrondi (arc au décalage), pas de pan coupé', () => {
    const { cols, pts } = checkRibbon(
      axis(
        [
          [-30, 0],
          [0, 0],
          [0, 30],
        ],
        2,
      ),
    );
    // virage à droite (vers +z) : extérieur = gauche (colonne 0, gravier)
    const o = Math.abs(OFFSETS[0] as number);
    const e = cols[0] as Float64Array;
    let maxGap = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i] as AxisPoint3;
      if (Math.hypot(p.x, p.z) > 0.01) continue;
      // profils au coin : sur l'arc de rayon o autour du sommet
      expect(Math.hypot((e[i * 2] as number) - p.x, (e[i * 2 + 1] as number) - p.z)).toBeCloseTo(o, 6);
      if (i > 0 && Math.hypot((pts[i - 1] as AxisPoint3).x, (pts[i - 1] as AxisPoint3).z) < 0.01) maxGap = Math.max(maxGap, Math.hypot((e[i * 2] as number) - (e[i * 2 - 2] as number), (e[i * 2 + 1] as number) - (e[i * 2 - 1] as number)));
    }
    expect(maxGap).toBeGreaterThan(0);
    expect(maxGap).toBeLessThan(o * 0.27);
    // coin intérieur exact (onglet) : à (o, −o) pour l'accotement droit
    const inner = cols[3] as Float64Array;
    const k = pts.findIndex((p) => Math.hypot(p.x, p.z) < 0.01);
    expect(inner[k * 2]).toBeCloseTo(-o, 3);
    expect(inner[k * 2 + 1]).toBeCloseTo(o, 3);
  });
});

describe('réseau secondaire contre l’itinéraire', () => {
  const route = axis(
    [
      [-200, 0],
      [200, 0],
    ],
    2,
  );
  const fp = new RouteFootprint(route, false, HALF, SHOULDER);
  const HW = 3 + 0.6;
  const flat = (pts: Array<[number, number, number]>) => pts.flat();
  const dist = (x: number, z: number) => (fp.nearest(x, z, 50)?.dist ?? 50);

  it('carrefour en L : la route secondaire s’arrête sur la ligne de rive', () => {
    const strips = sideRoadStrips(
      flat([
        [10, 100.3, 40],
        [10, 100.1, 0],
      ]),
      HW,
      3,
      fp,
      0.05,
    );
    expect(strips).toHaveLength(1);
    const s = strips[0]!;
    const n = s.along.length;
    for (const e of [s.left, s.right])
      for (let i = 0; i < n; i++) expect(dist(e[i * 3]!, e[i * 3 + 2]!)).toBeGreaterThanOrEqual(HALF - 1e-6);
    // profil terminal posé sur le bord, à l'altitude de l'itinéraire (+ surélévation)
    expect(dist(s.left[(n - 1) * 3]!, s.left[(n - 1) * 3 + 2]!)).toBeCloseTo(HALF, 2);
    expect(dist(s.right[(n - 1) * 3]!, s.right[(n - 1) * 3 + 2]!)).toBeCloseTo(HALF, 2);
    expect(s.left[(n - 1) * 3 + 1]).toBeCloseTo(100.07, 3);
  });

  it('carrefour oblique (30°) : extrémité oblique sur le bord, sans pointe dans la chaussée', () => {
    const a = (30 * Math.PI) / 180;
    const strips = sideRoadStrips(
      flat([
        [-40 * Math.cos(a), 100, 40 * Math.sin(a)],
        [0, 100, 0],
        [40 * Math.cos(a), 100, -40 * Math.sin(a)],
      ]),
      HW,
      3,
      fp,
      0.05,
    );
    // traverse l'itinéraire : deux morceaux, un de chaque côté
    expect(strips).toHaveLength(2);
    for (const s of strips) {
      const n = s.along.length;
      for (const e of [s.left, s.right]) for (let i = 0; i < n; i++) expect(dist(e[i * 3]!, e[i * 3 + 2]!)).toBeGreaterThanOrEqual(HALF - 1e-6);
    }
    const s = strips[0]!;
    const n = s.along.length;
    expect(dist(s.left[(n - 1) * 3]!, s.left[(n - 1) * 3 + 2]!)).toBeCloseTo(HALF, 2);
    expect(dist(s.right[(n - 1) * 3]!, s.right[(n - 1) * 3 + 2]!)).toBeCloseTo(HALF, 2);
  });

  it('même route tracée par OSM à 1,8 m de l’axe GPS : doublon supprimé', () => {
    const strips = sideRoadStrips(
      flat([
        [-150, 100, 1.8],
        [150, 100, 1.8],
      ]),
      HW,
      3,
      fp,
      0.05,
    );
    expect(strips).toHaveLength(0);
  });

  it('route parallèle distincte (contre-allée à 10 m) et pont au-dessus : intactes', () => {
    const side = sideRoadStrips(
      flat([
        [-150, 100, 10],
        [150, 100, 10],
      ]),
      HW,
      3,
      fp,
      0.05,
    );
    expect(side).toHaveLength(1);
    expect(side[0]!.along[side[0]!.along.length - 1]).toBeCloseTo(300, 3);
    const bridge = sideRoadStrips(
      flat([
        [0, 107, 40],
        [0, 107, -40],
      ]),
      HW,
      3,
      fp,
      0.05,
    );
    expect(bridge).toHaveLength(1);
  });

  it('terrain : abaissé sous le ruban et sa frange, intact au loin et au-dessus d’un tunnel', () => {
    expect(fp.clampTerrain(0, 4, 101.2, 4.5)).toBeLessThan(100);
    expect(fp.clampTerrain(0, 8.5, 101.2, 4.5)).toBeLessThan(100);
    expect(fp.clampTerrain(0, 12, 101.2, 4.5)).toBe(101.2);
    expect(fp.clampTerrain(0, 0, 99, 4.5)).toBe(99);
    expect(fp.clampTerrain(0, 0, 112, 4.5)).toBe(112);
  });
});
