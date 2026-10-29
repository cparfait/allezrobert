/**
 * Générateur de l'île de Robert (voir docs/ILE_DE_ROBERT.md) : écrit un monde au format des mondes réels
 * (world.json, tiles/*.json + .lo/.hi.u16, routes/*.json, graph.json, places.json) dans
 * apps/client/public/worlds/ile-de-robert, puis lance les contrôles automatiques (verify.ts).
 *
 *   npx tsx tools/island/src/build.ts
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RouteData, WorldMeta, WorldTile } from '../../../packages/shared/src/route.ts';
import { ANNEAU, ISLAND, LAKES, MASSIF, TOWNS, anneauLoop, coastPoint, inHarbour, inLake, inRiver, shoreDist, terrain, type Vec2 } from './design.ts';
import { chaikin, clipPolygon, clipPolyline, polygonArea, resample, type Vec3 } from './geom.ts';
import { forestMask, lakes, parcels, shoreAreas, waterways, type LandCtx } from './land.ts';
import { fbm, rng } from './noise.ts';
import { CELL, CLASSES, CLASS_BY_RANK, Grid, type RoadClass } from './planner.ts';
import { runPool } from './pool.ts';
import { ATTRIBUTION, RoadIndex, buildGraph, joinCrossings, makeRoad, nodeHeight, profile, r2, snapEnds, type Road, type RoadSpec } from './roads.ts';
import { planRoute, type RouteSpec } from './routes.ts';
import { ANNEAU_GATES, Builder, farmBuildings, farmSites, landmarks, roadsideHouses, seasideBuildings, townCentre, townLayout, type TownLayout } from './settle.ts';
import type { Area } from './types.ts';
import { verifyWorld } from './verify.ts';
import { switchbacks } from './climb.ts';

const OUT = resolve(import.meta.dirname, '../../../apps/client/public/worlds', ISLAND.id);
const T = ISLAND.tileSizeM;
const log = (s: string) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s] ${s}`);
const T0 = Date.now();

// ── 1. Routes dessinées : Anneau, rues des villes, front de mer ──

export function designedRoads(): { roads: Road[]; layouts: TownLayout[]; anneau: Road; gates: Array<{ p: Vec2; y: number; dir: Vec2; town?: string }> } {
  const anneau = makeRoad({ id: 'anneau', name: "L'Anneau", kind: 'tertiary', width: ANNEAU.widthM, pts: anneauLoop(2), loop: true, designed: true, gmax: 0.01 });
  for (const p of anneau.pts) p[1] = ANNEAU.level;
  const layouts = TOWNS.map((t, k) => townLayout(t, k));
  const roads: Road[] = [anneau];
  const gates: Array<{ p: Vec2; y: number; dir: Vec2; town?: string }> = [];
  for (const lay of layouts) {
    const rs = lay.specs.map((s) => makeRoad(s));
    // Rues secondaires posées sur les rues principales (raccords en T).
    // (sur la rue principale, le boulevard ou les planches en priorité, sinon sur la rue la plus proche).
    const main = rs.filter((r) => /-(main|boulevard|planches)$/.test(r.id));
    for (const r of rs) if (!main.includes(r)) snapEnds(r, main, rs.filter((o) => o !== r));
    roads.push(...rs);
    for (const g of lay.gates) {
      // Altitude de la rue à la porte.
      let best: Vec3 | null = null;
      let inner: Vec3 | null = null;
      for (const r of rs)
        for (const [p, q] of [[r.pts[0]!, r.pts[Math.min(5, r.pts.length - 1)]!], [r.pts[r.pts.length - 1]!, r.pts[Math.max(0, r.pts.length - 6)]!]] as const)
          if (!best || Math.hypot(p[0] - g[0], p[2] - g[1]) < Math.hypot(best[0] - g[0], best[2] - g[1])) {
            best = p;
            inner = q;
          }
      gates.push({ p: [best![0], best![2]], y: best![1], dir: [best![0] - inner![0], best![2] - inner![2]], town: lay.town.id });
    }
  }
  // Col du Phare : montée en lacets depuis le Hameau du Col, descente en lacets vers le nord, route du phare.
  const col = saddle();
  const colY = terrain(col[0], col[1]);
  const lc = gates.filter((g) => g.town === 'le-col').sort((a, b) => Math.hypot(a.p[0] - col[0], a.p[1] - col[1]) - Math.hypot(b.p[0] - col[0], b.p[1] - col[1]))[0]!;
  lc.town = 'le-col-montee'; // porte réservée à la montée (le réseau passe par les autres)
  const axis: Vec2 = [MASSIF.mont[0] - MASSIF.phare[0], MASSIF.mont[1] - MASSIF.phare[1]];
  const al = Math.hypot(axis[0], axis[1]);
  let out: Vec2 = [-axis[1] / al, axis[0] / al];
  // Versant nord : du côté opposé au Hameau du Col.
  if ((lc.p[0] - col[0]) * out[0] + (lc.p[1] - col[1]) * out[1] > 0) out = [-out[0], -out[1]];
  let foot: Vec2 = [col[0] + out[0] * 2600, col[1] + out[1] * 2600];
  for (let d = 2600; d > 900; d -= 100) {
    const q: Vec2 = [col[0] + out[0] * d, col[1] + out[1] * d];
    if (shoreDist(q[0], q[1]) > 450 && terrain(q[0], q[1]) < colY - 120) {
      foot = q;
      break;
    }
  }
  const toPhare: Vec2 = [MASSIF.phare[0] - col[0], MASSIF.phare[1] - col[1]];
  const tl = Math.hypot(toPhare[0], toPhare[1]);
  const phareEnd: Vec2 = [MASSIF.phare[0] - (toPhare[0] / tl) * 45, MASSIF.phare[1] - (toPhare[1] / tl) * 45];
  const lacets = (a: Vec2, b: Vec2, grade: number, firstSide?: number) => fillet(simplifyPath(switchbacks(a, b, { grade, halfWidth: 230, turn: 50, ...(firstSide ? { firstSide } : {}) }), 3), 13);
  const south = makeRoad({ id: 'col-sud', name: 'Route du Col du Phare', kind: 'tertiary', width: 6, pts: lacets(lc.p, col, 0.072), designed: true, gmax: 0.095, smooth: 0, y0: lc.y });
  // Le col : un seul point, une seule altitude pour les trois routes.
  const top = south.pts[south.pts.length - 1]!;
  const fromTop = (pts: Vec2[]): Vec2[] => [[top[0], top[2]], ...pts.slice(1)];
  const north = makeRoad({ id: 'col-nord', name: 'Route du Col du Phare', kind: 'tertiary', width: 6, pts: fromTop(lacets(foot, col, 0.075).reverse()), designed: true, gmax: 0.095, smooth: 0, y0: top[1] });
  // Route du phare : premier lacet dans le prolongement de la montée (pas d'épingle au col).
  const arr = south.pts[south.pts.length - 6]!;
  const dS: Vec2 = [top[0] - arr[0], top[2] - arr[2]];
  const lat: Vec2 = [-(phareEnd[1] - col[1]), phareEnd[0] - col[0]];
  const phare = makeRoad({ id: 'route-du-phare', name: 'Route du Phare', kind: 'unclassified', width: 4.5, pts: fromTop(lacets(col, phareEnd, 0.08, dS[0] * lat[0] + dS[1] * lat[1] > 0 ? 1 : -1)), designed: true, gmax: 0.105, smooth: 0, y0: top[1] });
  roads.push(south, north, phare);
  // Route du Hameau : de Vallon-sur-Robe au Hameau du Col, en écharpe sur le flanc du massif.
  const vg = gates.filter((g) => g.town === 'vallon').sort((a, b) => Math.hypot(a.p[0] - lc.p[0], a.p[1] - lc.p[1]) - Math.hypot(b.p[0] - lc.p[0], b.p[1] - lc.p[1]))[0]!;
  const hg = gates.filter((g) => g.town === 'le-col').sort((a, b) => Math.hypot(a.p[0] - vg.p[0], a.p[1] - vg.p[1]) - Math.hypot(b.p[0] - vg.p[0], b.p[1] - vg.p[1]))[0]!;
  vg.town = 'vallon-hameau';
  hg.town = 'le-col-hameau';
  roads.push(makeRoad({ id: 'route-du-hameau', name: 'Route du Hameau du Col', kind: 'tertiary', width: 6, pts: fillet(simplifyPath(switchbacks(vg.p, hg.p, { grade: 0.065, halfWidth: 300, turn: 50 }), 3), 18), designed: true, gmax: 0.09, smooth: 0, y0: vg.y, y1: hg.y }));
  gates.push({ p: [north.pts[north.pts.length - 1]![0], north.pts[north.pts.length - 1]![2]], y: north.pts[north.pts.length - 1]![1], dir: out, town: 'col-nord' });
  gates.push({ p: [top[0], top[2]], y: top[1], dir: [axis[0] / al, axis[1] / al], town: 'col' });
  for (const g of ANNEAU_GATES) {
    let best = anneau.pts[0]!;
    for (const p of anneau.pts) if (Math.hypot(p[0] - g[0], p[2] - g[1]) < Math.hypot(best[0] - g[0], best[2] - g[1])) best = p;
    const out: Vec2 = [g[0] - ANNEAU.cx - Math.sign(g[0] - ANNEAU.cx) * Math.min(Math.abs(g[0] - ANNEAU.cx), ANNEAU.half), g[1] - ANNEAU.cz];
    gates.push({ p: [best[0], best[2]], y: best[1], dir: out, town: 'anneau' });
  }
  return { roads, layouts, anneau, gates };
}

// ── 2. Grille de tracé ──

export async function planningGrid(designed: Road[], gates: Array<{ p: Vec2; dir: Vec2 }>, farms: Array<{ x: number; z: number; gate: Vec2 }>): Promise<Grid> {
  const grid = new Grid(ISLAND.minX, ISLAND.minZ, ISLAND.maxX - ISLAND.minX, ISLAND.maxZ - ISLAND.minZ);
  const bands = 48;
  const rows = Math.ceil(grid.m / bands);
  const parts = await runPool<Float32Array>(
    null,
    Array.from({ length: Math.ceil(grid.m / rows) }, (_, b) => ({ type: 'grid', x0: grid.x0, z0: grid.z0, n: grid.n, j0: b * rows, j1: Math.min(grid.m, (b + 1) * rows), cell: CELL })),
  );
  parts.forEach((p, b) => grid.h.set(p, b * rows * grid.n));
  for (let j = 0; j < grid.m; j++)
    for (let i = 0; i < grid.n; i++) {
      const c = j * grid.n + i;
      const x = grid.x0 + (i + 0.5) * CELL;
      const z = grid.z0 + (j + 0.5) * CELL;
      const sd = shoreDist(x, z);
      if (sd < 60 || inLake(x, z, 1.25) || inHarbour(x, z, 25)) grid.water[c] = 1;
      else if (inRiver(x, z, 4)) grid.water[c] = 2;
      grid.wob[c] = 0.8 + 0.4 * (0.5 + 0.5 * fbm(x / 700, z / 700, 2, 61));
    }
  // Villes, Anneau et cours de ferme réservés : on n'y passe que par les rues dessinées.
  const reserve = (x: number, z: number, r: number) => {
    const c0 = grid.cellAt(x - r, z - r);
    const c1 = grid.cellAt(x + r, z + r);
    for (let j = Math.floor(c0 / grid.n); j <= Math.floor(c1 / grid.n); j++)
      for (let i = c0 % grid.n; i <= c1 % grid.n; i++) {
        const cx = grid.x0 + (i + 0.5) * CELL;
        const cz = grid.z0 + (j + 0.5) * CELL;
        if (Math.hypot(cx - x, cz - z) <= r) grid.block[j * grid.n + i] = 1;
      }
  };
  for (const t of TOWNS) {
    if (t.seaside) {
      const ang = Math.atan2(t.z, t.x);
      for (let a = ang - 0.045; a <= ang + 0.14; a += 0.002) for (let inset = 0; inset <= 1320; inset += 15) reserve(...coastPoint(a, inset), 12);
    } else reserve(t.x, t.z, t.r * 1.05);
  }
  for (let x = ANNEAU.cx - ANNEAU.half; x <= ANNEAU.cx + ANNEAU.half; x += 20) reserve(x, ANNEAU.cz, ANNEAU.radius + 30);
  for (const f of farms) reserve(f.x, f.z, 42);
  for (const r of designed) for (let k = 0; k < r.pts.length; k += 4) reserve(r.pts[k]![0], r.pts[k]![2], r.width / 2 + 14);
  // Portes libres ; coordonnées exactes ; couloir de sortie dans le prolongement de la rue (≤ 500 m).
  const all = [...gates.map((q) => ({ p: q.p, dir: q.dir })), ...farms.map((f) => ({ p: f.gate, dir: [f.gate[0] - f.x, f.gate[1] - f.z] as Vec2 }))];
  const reserved = grid.block.slice();
  for (const { p: g, dir } of all) {
    const c = grid.cellAt(g[0], g[1]);
    grid.block[c] = 0;
    grid.exact.set(c, g);
    grid.forced.add(c);
    const l = Math.hypot(dir[0], dir[1]) || 1;
    for (let s = CELL / 2; s <= 600; s += CELL / 2) {
      const k = grid.cellAt(g[0] + (dir[0] / l) * s, g[1] + (dir[1] / l) * s);
      if (!reserved[k] && s > 2 * CELL) break;
      grid.block[k] = 0;
    }
  }
  return grid;
}

// ── 3. Réseau tracé ──

export interface Plan {
  grid: Grid;
  failed: string[];
}

export function connect(P: Plan, a: Vec2, b: Vec2, classes: RoadClass[], label: string, box = 160): boolean {
  const s = P.grid.cellAt(a[0], a[1]);
  const g = P.grid.cellAt(b[0], b[1]);
  if (s === g) return true;
  // Arrivée déjà prise par une route : on rejoint celle-ci à moins de 500 m, en T (jamais en biseau).
  const grid = P.grid;
  const [gx, gz] = grid.center(g);
  const goal = grid.occ[g] ? (c: number) => grid.occ[c]! > 0 && Math.hypot(grid.center(c)[0] - gx, grid.center(c)[1] - gz) < 500 : g;
  for (const cls of classes) {
    const path = P.grid.search(s, goal, cls, { box, toward: g });
    if (path) {
      P.grid.commit(path, cls, label);
      return true;
    }
  }
  // Diagnostic : la contrainte qui bloque (raccords francs, pente, emprise de recherche).
  const c0 = classes[classes.length - 1]!;
  const why = [
    P.grid.search(s, goal, c0, { box, loose: true, toward: g }) ? 'raccords' : '',
    P.grid.search(s, goal, { ...c0, gmax: c0.gmax * 2 }, { box, toward: g }) ? 'pente' : '',
    P.grid.search(s, goal, c0, { box: box * 2, toward: g }) ? 'emprise' : '',
  ].filter(Boolean);
  P.failed.push(`${label} ${a.map(Math.round).join(',')} → ${b.map(Math.round).join(',')} (${why.join(', ') || '?'})`);
  return false;
}

/** Rejoint la route la plus proche (de rang ≥ `minRank`). */
export function spur(P: Plan, a: Vec2, cls: RoadClass, minRank: number, label: string, box = 150): boolean {
  const s = P.grid.cellAt(a[0], a[1]);
  const grid = P.grid;
  const path = grid.search(s, (c) => grid.occ[c]! >= minRank, cls, { box, maxExp: 3_000_000 });
  if (!path) {
    P.failed.push(`${label} ${a.map(Math.round).join(',')}`);
    return false;
  }
  grid.commit(path, cls, label);
  return true;
}

function nearestGate(gates: Array<{ p: Vec2; town?: string }>, town: string, toward: Vec2): Vec2 {
  let best: Vec2 | null = null;
  let bd = Infinity;
  for (const g of gates) {
    if (g.town !== town) continue;
    const d = Math.hypot(g.p[0] - toward[0], g.p[1] - toward[1]);
    if (d < bd) {
      bd = d;
      best = g.p;
    }
  }
  return best!;
}

/** Point de la vallée du col : le plus bas sur la ligne entre les deux sommets. */
export function saddle(): Vec2 {
  const [ax, az] = MASSIF.phare;
  const [bx, bz] = MASSIF.mont;
  let best: Vec2 = [ax, az];
  let bh = Infinity;
  for (let t = 0.15; t <= 0.85; t += 0.01) {
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const h = terrain(x, z);
    if (h < bh) {
      bh = h;
      best = [x, z];
    }
  }
  return best;
}

export function planNetwork(P: Plan, gates: Array<{ p: Vec2; town?: string }>, farms: Array<{ gate: Vec2 }>): { ring: Vec2[]; bois: Vec2[]; mtb: Vec2[]; col: Vec2 } {
  const C = CLASSES;
  const town = (id: string) => TOWNS.find((t) => t.id === id)!;
  const G = (id: string, toward: Vec2 | string) => nearestGate(gates, id, typeof toward === 'string' ? [town(toward).x, town(toward).z] : toward);
  // a. Route du tour de l'île : points le long de la côte, villes côtières traversées par leurs rues.
  const ring: Array<{ p: Vec2; ang: number }> = [];
  for (let k = 0; k < 30; k++) {
    const ang = -Math.PI + (k / 30) * 2 * Math.PI;
    let inset = 520;
    let p = coastPoint(ang, inset);
    const steepAt = (q: Vec2) => {
      const h = terrain(q[0], q[1]);
      return Math.max(...[[60, 0], [-60, 0], [0, 60], [0, -60]].map(([dx, dz]) => Math.abs(terrain(q[0] + dx!, q[1] + dz!) - h))) > 4;
    };
    while (inset < 2500 && (P.grid.block[P.grid.cellAt(p[0], p[1])] || P.grid.water[P.grid.cellAt(p[0], p[1])] || steepAt(p) || TOWNS.some((t) => Math.hypot(t.x - p[0], t.z - p[1]) < t.r * 1.6))) {
      inset += 120;
      p = coastPoint(ang, inset);
    }
    // Massif du Phare : pas de point imposé, la route le contourne d'elle-même.
    if (Math.min(Math.hypot(p[0] - MASSIF.phare[0], p[1] - MASSIF.phare[1]), Math.hypot(p[0] - MASSIF.mont[0], p[1] - MASSIF.mont[1])) < 4200 || inset >= 2500) continue;
    ring.push({ p, ang });
  }
  for (const id of ['robertville', 'kerbrou', 'port-sable', 'la-pointe', 'saint-pierre']) {
    const t = town(id);
    const ang = Math.atan2(t.z, t.x);
    const tg = gates.filter((g) => g.town === id);
    const ga = tg.map((g) => ({ p: g.p, ang: Math.atan2(g.p[1], g.p[0]) }));
    // Les deux portes les plus écartées le long de la côte.
    ga.sort((a, b) => a.ang - b.ang);
    const first = ga[0]!;
    const last = ga[ga.length - 1]!;
    for (let k = ring.length - 1; k >= 0; k--) if (Math.abs(angle(ring[k]!.ang - ang)) < 0.12) ring.splice(k, 1);
    ring.push({ p: first.p, ang: first.ang - 1e-4 }, { p: last.p, ang: last.ang + 1e-4 });
  }
  ring.sort((a, b) => a.ang - b.ang);
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k]!;
    const b = ring[(k + 1) % ring.length]!;
    // Entre les deux portes d'une même ville : la ville elle-même.
    const sameTown = gates.find((g) => g.p === a.p)?.town && gates.find((g) => g.p === a.p)?.town === gates.find((g) => g.p === b.p)?.town;
    if (sameTown) continue;
    connect(P, a.p, b.p, [C.secondary, C.tertiary, C.lane], "Route du Tour de l'Île");
  }
  // b. Grands axes depuis Saint-Robert.
  for (const to of ['kerbrou', 'robertville', 'saint-pierre', 'vallon']) connect(P, G('saint-robert', to), G(to, 'saint-robert'), [C.secondary, C.tertiary, C.lane], `Route de ${town(to).name}`);
  connect(P, G('vallon', 'les-granges'), G('les-granges', 'vallon'), [C.secondary, C.tertiary, C.lane], 'Route des Granges');
  // c. Routes communales.
  const tert: Array<[string, string]> = [
    ['les-vignes', 'saint-robert'], ['les-vignes', 'robertville'], ['bois-joli', 'saint-robert'], ['bois-joli', 'saint-pierre'], ['bois-joli', 'kerbrou'],
['les-granges', 'port-sable'], ['vallon', 'port-sable'], ['robertville', 'vallon'], ['la-pointe', 'les-vignes'], ['les-granges', 'saint-robert'],
  ];
  const steep = { ...C.lane, gmax: 0.14 };
  for (const [a, b] of tert) connect(P, G(a, b), G(b, a), [C.tertiary, C.lane, steep], `Route de ${town(b).name}`);
  const anneauGate = (k: number) => gates.filter((g) => g.town === 'anneau')[k]!.p;
  connect(P, anneauGate(0), G('saint-robert', anneauGate(0)), [C.tertiary, C.lane, { ...C.lane, gmax: 0.14 }], "Route de l'Anneau");
  connect(P, anneauGate(3), G('les-vignes', anneauGate(3)), [C.tertiary, C.lane, { ...C.lane, gmax: 0.14 }], "Route de l'Anneau");
  connect(P, anneauGate(1), G('saint-pierre', anneauGate(1)), [C.tertiary, C.lane, { ...C.lane, gmax: 0.14 }], "Route de l'Anneau");
  // d. Col du Phare (routes dessinées en lacets) : le pied du versant nord rejoint le réseau.
  const col = gates.find((g) => g.town === 'col')!.p;
  void col;
  const foot = gates.find((g) => g.town === 'col-nord')!.p;
  if (!spur(P, foot, { ...C.tertiary, gmax: 0.1 }, 5, 'Route du Col du Phare', 250)) {
    P.failed.pop();
    spur(P, foot, { ...C.lane, gmax: 0.14 }, 5, 'Route du Col du Phare', 300);
  }
  // e. Pistes cyclables : Piste verte (Saint-Robert → Anneau → Saint-Pierre), voie verte de la Robe.
  connect(P, G('saint-robert', anneauGate(2)), anneauGate(2), [C.cycleway, { ...C.cycleway, gmax: 0.06 }], 'La Piste verte');
  connect(P, anneauGate(1), G('saint-pierre', anneauGate(1)), [C.cycleway, { ...C.cycleway, gmax: 0.06 }], 'La Piste verte');
  connect(P, G('vallon', 'port-sable'), G('port-sable', 'vallon'), [C.cycleway, { ...C.cycleway, gmax: 0.06 }], 'Voie verte de la Robe');
  connect(P, G('robertville', 'la-pointe'), G('la-pointe', 'robertville'), [C.cycleway, { ...C.cycleway, gmax: 0.06 }], 'La Vélomaritime');
  // f. Chemins des fermes.
  for (const f of farms) spur(P, f.gate, C.lane, 5, 'Chemin rural');
  // g. Gravel : boucle des Bois, chemins des vignes et du plateau.
  const r = rng(31337);
  const loopPts = (cx: number, cz: number, R: number, n: number, jit: number): Vec2[] =>
    Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2;
      const rr = R * (1 + (r() - 0.5) * jit);
      return [cx + Math.cos(a) * rr * 1.3, cz + Math.sin(a) * rr] as Vec2;
    });
  const bois = loopPts(-10300, -5000, 2300, 12, 0.5);
  const okPt = (p: Vec2) => {
    const c = P.grid.cellAt(p[0], p[1]);
    return !P.grid.water[c] && !P.grid.block[c];
  };
  const loopConnect = (pts: Vec2[], cls: RoadClass[], label: string) => {
    const good = pts.filter(okPt);
    for (let k = 0; k < good.length; k++) connect(P, good[k]!, good[(k + 1) % good.length]!, cls, label);
    // Toujours relié aux routes (deux accès).
    if (good[0]) spur(P, good[0], cls[0]!, 5, label);
    if (good.length > 3) spur(P, good[Math.floor(good.length / 2)]!, cls[0]!, 5, label);
    return good;
  };
  const boisOk = loopConnect(bois, [C.track, { ...C.track, gmax: 0.17 }], 'Chemin des Bois');
  loopConnect(loopPts(-1500, 5500, 1300, 7, 0.4), [C.track], 'Chemin des Vignes');
  loopConnect(loopPts(12300, 1200, 2200, 8, 0.4), [C.track], 'Chemin du Plateau');
  loopConnect(loopPts(LAKES[0]!.x, LAKES[0]!.z, 1500, 7, 0.3), [C.track], 'Chemin de la Lagune');
  // h. VTT : sentiers des Bois et du massif.
  const mtb = loopConnect(loopPts(-10600, -5400, 1300, 10, 0.6), [C.mtb, { ...C.mtb, gmax: 0.26 }], 'Sentier VTT des Bois');
  return { ring: ring.map((q) => q.p), bois: boisOk, mtb, col };
}

const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Virages arrondis : chaque angle remplacé par un arc de rayon `R` (réduit si les côtés sont trop courts). */
function fillet(pts: Vec2[], R: number): Vec2[] {
  if (pts.length < 3) return pts;
  const out: Vec2[] = [pts[0]!];
  for (let k = 1; k < pts.length - 1; k++) {
    const [px, pz] = out[out.length - 1]!;
    const [bx, bz] = pts[k]!;
    const [nx, nz] = pts[k + 1]!;
    const l1 = Math.hypot(bx - px, bz - pz);
    const l2 = Math.hypot(nx - bx, nz - bz);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const u1: Vec2 = [(bx - px) / l1, (bz - pz) / l1];
    const u2: Vec2 = [(nx - bx) / l2, (nz - bz) / l2];
    const cos = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
    const phi = Math.acos(cos);
    if (phi < 0.05) {
      out.push(pts[k]!);
      continue;
    }
    const tanHalf = Math.tan(phi / 2);
    const t = Math.min(R * tanHalf, l1 * 0.48, l2 * 0.48);
    const r = t / tanHalf;
    const a: Vec2 = [bx - u1[0] * t, bz - u1[1] * t];
    const cross = u1[0] * u2[1] - u1[1] * u2[0];
    const side = cross > 0 ? 1 : -1;
    const cx = a[0] - u1[1] * r * side;
    const cz = a[1] + u1[0] * r * side;
    const a0 = Math.atan2(a[1] - cz, a[0] - cx);
    const steps = Math.max(2, Math.ceil((phi * r) / 3));
    for (let i = 0; i <= steps; i++) {
      const ang = a0 + side * phi * (i / steps);
      out.push([cx + Math.cos(ang) * r, cz + Math.sin(ang) * r]);
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** Douglas-Peucker : retire les marches de la grille (écart toléré `tol` m), extrémités gardées. */
function simplifyPath(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, az] = pts[a]!;
    const [bx, bz] = pts[b]!;
    const L = Math.hypot(bx - ax, bz - az) || 1;
    let worst = -1;
    let wd = tol;
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((pts[k]![0] - ax) * (bz - az) - (pts[k]![1] - az) * (bx - ax)) / L;
      if (d > wd) {
        wd = d;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/**
 * Tronçons du réseau tracé → routes lissées avec profil. Aux carrefours, la route qui continue (même rang,
 * la plus droite) est lissée d'un seul tenant : pas de cassure au droit d'un raccord ; les branches viennent
 * ensuite se poser sur sa courbe.
 */
export function networkRoads(grid: Grid, designed: Road[], gates: Array<{ p: Vec2; y: number }>): Road[] {
  const gateY = new Map<string, number>();
  for (const g of gates) gateY.set(`${g.p[0].toFixed(2)},${g.p[1].toFixed(2)}`, g.y);
  const edges = grid.edges().filter((e) => e.cells.length >= 2);
  const R_OF: Record<string, number> = { secondary: 30, tertiary: 18, lane: 14, cycleway: 15, track: 9, mtb: 7 };
  // Arêtes par nœud (case d'extrémité).
  const atNode = new Map<number, number[]>();
  edges.forEach((e, k) => {
    for (const c of [e.cells[0]!, e.cells[e.cells.length - 1]!]) (atNode.get(c) ?? atNode.set(c, []).get(c)!).push(k);
  });
  const dirFrom = (k: number, c: number): Vec2 => {
    const cells = edges[k]!.cells;
    const fwd = cells[0] === c;
    const far = cells[fwd ? Math.min(3, cells.length - 1) : Math.max(0, cells.length - 4)]!;
    const p = grid.center(c);
    const q = grid.center(far);
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    return [(q[0] - p[0]) / l, (q[1] - p[1]) / l];
  };
  // Paires « qui continuent » à chaque nœud (jamais aux portes des rues dessinées).
  const pair = new Map<string, number>();
  for (const [c, list] of atNode) {
    if (grid.exact.has(c) || list.length < 2) continue;
    const cand: Array<{ i: number; j: number; score: number }> = [];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const ki = list[i]!;
        const kj = list[j]!;
        if (ki === kj) continue;
        const di = dirFrom(ki, c);
        const dj = dirFrom(kj, c);
        const cos = di[0] * dj[0] + di[1] * dj[1];
        if (cos > -0.5) continue; // moins de 120° entre les deux : ce n'est pas une continuation
        cand.push({ i: ki, j: kj, score: (edges[ki]!.rank === edges[kj]!.rank ? 10 : 0) + edges[ki]!.rank + edges[kj]!.rank - cos * 3 });
      }
    cand.sort((p, q) => q.score - p.score);
    const used = new Set<number>();
    for (const cnd of cand) {
      if (used.has(cnd.i) || used.has(cnd.j)) continue;
      used.add(cnd.i);
      used.add(cnd.j);
      pair.set(`${cnd.i}@${c}`, cnd.j);
      pair.set(`${cnd.j}@${c}`, cnd.i);
    }
  }
  // Chaînes d'arêtes.
  interface Chain {
    edges: Array<{ k: number; fwd: boolean }>;
    cells: number[];
    /** Indice (dans `cells`) de chaque nœud intérieur. */
    inner: Array<{ c: number; at: number }>;
  }
  const seen = new Set<number>();
  const chains: Chain[] = [];
  for (let k0 = 0; k0 < edges.length; k0++) {
    if (seen.has(k0)) continue;
    // Remonte jusqu'au début de la chaîne.
    let k = k0;
    let startNode = edges[k]!.cells[0]!;
    const guard = new Set<number>([k]);
    for (;;) {
      const prev = pair.get(`${k}@${startNode}`);
      if (prev === undefined || guard.has(prev)) break;
      guard.add(prev);
      const pe = edges[prev]!;
      startNode = pe.cells[0] === startNode ? pe.cells[pe.cells.length - 1]! : pe.cells[0]!;
      k = prev;
    }
    const ch: Chain = { edges: [], cells: [], inner: [] };
    let node = startNode;
    for (;;) {
      if (seen.has(k)) break;
      seen.add(k);
      const e = edges[k]!;
      const fwd = e.cells[0] === node;
      const cells = fwd ? e.cells : [...e.cells].reverse();
      if (ch.cells.length) ch.inner.push({ c: node, at: ch.cells.length - 1 });
      ch.edges.push({ k, fwd });
      ch.cells.push(...(ch.cells.length ? cells.slice(1) : cells));
      node = cells[cells.length - 1]!;
      const nx = pair.get(`${k}@${node}`);
      if (nx === undefined || seen.has(nx)) break;
      k = nx;
    }
    chains.push(ch);
  }
  // Lissage d'une chaîne : marches retirées, virages arrondis, puis points tous les 2 m ; position finale
  // des nœuds intérieurs (point le plus proche de la courbe).
  const moved = new Map<number, Vec2>();
  /**
   * Courbe d'une chaîne. `fixed` : nœuds intérieurs dont la position est déjà arrêtée (croisement d'une
   * route plus importante) : la courbe y passe exactement (lissage par morceaux entre ces points).
   */
  const shape = (ch: Chain, fixed: Map<number, Vec2> = new Map()) => {
    const pts = ch.cells.map((c) => fixed.get(c) ?? moved.get(c) ?? grid.center(c));
    const R = Math.max(...ch.edges.map(({ k }) => R_OF[CLASS_BY_RANK[edges[k]!.rank]!.id] ?? 12));
    // Tolérance de simplification : plus large pour les grandes routes (côtés plus longs, virages plus amples).
    const tol = Math.max(...ch.edges.map(({ k }) => ({ secondary: 10, tertiary: 9, lane: 8, cycleway: 8, track: 6, mtb: 5 })[CLASS_BY_RANK[edges[k]!.rank]!.id] ?? 7));
    const hard = [0, ...ch.inner.filter((n) => fixed.has(n.c)).map((n) => n.at), pts.length - 1];
    const dense: Vec2[] = [];
    const hardAt = new Map<number, number>();
    for (let t = 0; t + 1 < hard.length; t++) {
      const seg = pts.slice(hard[t]!, hard[t + 1]! + 1);
      const d = seg.length >= 2 ? resample(chaikin(fillet(simplifyPath(seg, tol), R), 2), 2) : seg;
      for (let i = dense.length ? 1 : 0; i < d.length; i++) dense.push(d[i]!);
      hardAt.set(hard[t + 1]!, dense.length - 1);
    }
    // Position de chaque nœud intérieur : imposée, ou point de la courbe le plus proche.
    const at: number[] = [];
    let from = 0;
    for (const n of ch.inner) {
      const h = hardAt.get(n.at);
      if (h !== undefined && fixed.has(n.c)) {
        at.push(h);
        from = h;
        continue;
      }
      const p = pts[n.at]!;
      let best = from;
      let bd = Infinity;
      for (let i = from; i < dense.length; i++) {
        const dd = Math.hypot(dense[i]![0] - p[0], dense[i]![1] - p[1]);
        if (dd < bd) {
          bd = dd;
          best = i;
        }
        if (dd > bd + 60) break;
      }
      at.push(best);
      from = best;
    }
    return { dense, at };
  };
  // Passe 1 : positions provisoires des nœuds intérieurs.
  for (const ch of chains) {
    const { dense, at } = shape(ch);
    ch.inner.forEach((n, i) => moved.set(n.c, dense[at[i]!]!));
  }
  // Passe 2, des routes les plus importantes aux plus petites : un nœud déjà arrêté par une route plus
  // importante (croisement) est imposé aux suivantes.
  const final = new Map<number, Vec2>();
  const rankOf = (ch: Chain) => Math.max(...ch.edges.map(({ k }) => edges[k]!.rank));
  chains.sort((p, q) => rankOf(q) - rankOf(p));
  const out: Road[] = [];
  const counts = new Map<string, number>();
  const endY = (p: Vec2) => gateY.get(`${p[0].toFixed(2)},${p[1].toFixed(2)}`) ?? nodeHeight(p[0], p[1]);
  for (const ch of chains) {
    const fixed = new Map<number, Vec2>();
    for (const n of ch.inner) if (final.has(n.c)) fixed.set(n.c, final.get(n.c)!);
    // Extrémités : position arrêtée si elle l'est, sinon provisoire.
    for (const c of [ch.cells[0]!, ch.cells[ch.cells.length - 1]!]) if (final.has(c)) fixed.set(c, final.get(c)!);
    const own = new Map(ch.inner.map((n) => [n.c, moved.get(n.c)!]));
    for (const n of ch.inner) if (!fixed.has(n.c)) moved.delete(n.c);
    const { dense, at } = shape(ch, fixed);
    for (const [c, p] of own) moved.set(c, p);
    ch.inner.forEach((n, i) => {
      if (!final.has(n.c)) final.set(n.c, dense[at[i]!]!);
    });
    // Extrémités arrêtées elles aussi : la route qui passera plus tard par ce carrefour y passera exactement.
    if (!final.has(ch.cells[0]!)) final.set(ch.cells[0]!, dense[0]!);
    if (!final.has(ch.cells[ch.cells.length - 1]!)) final.set(ch.cells[ch.cells.length - 1]!, dense[dense.length - 1]!);
    const bounds = [0, ...at, dense.length - 1];
    ch.edges.forEach(({ k }, i) => {
      const e = edges[k]!;
      const cls = CLASS_BY_RANK[e.rank]!;
      const xz = dense.slice(bounds[i]!, bounds[i + 1]! + 1);
      if (xz.length < 2) return;
      const y = profile(xz, false, cls.kind === 'track' ? 16 : 30, cls.gmax + 0.005, endY(xz[0]!), endY(xz[xz.length - 1]!));
      const n = (counts.get(cls.id) ?? 0) + 1;
      counts.set(cls.id, n);
      out.push({
        id: `${cls.id}-${n}`,
        name: e.label || cls.id,
        kind: cls.kind,
        width: cls.width,
        surface: cls.surface,
        loop: false,
        pts: xz.map(([x, z], j) => [x, y[j]!, z]),
        flat: cls.width / 2 + (cls.kind === 'track' ? 0.8 : 1.5),
        blend: cls.kind === 'track' ? 5 : 7,
        gmax: cls.gmax,
      });
    });
  }
  // Extrémités posées exactement sur la route qu'elles rejoignent (écart résiduel du lissage).
  // (sauf deux extrémités déjà confondues : nœud commun, rien à recoller).
  const ends = out.flatMap((r) => [r.pts[0]!, r.pts[r.pts.length - 1]!]);
  const shared = (p: Vec3) => ends.filter((q) => Math.hypot(q[0] - p[0], q[2] - p[2]) < 0.05).length > 1;
  for (const r of out) {
    const a = shared(r.pts[0]!);
    const b = shared(r.pts[r.pts.length - 1]!);
    if (a && b) continue;
    const keep0: Vec3 = [...r.pts[0]!];
    const keep1: Vec3 = [...r.pts[r.pts.length - 1]!];
    snapEnds(r, out.filter((o) => o !== r), [], 10);
    if (a) r.pts[0] = keep0;
    if (b) r.pts[r.pts.length - 1] = keep1;
  }
  void designed;
  return out;
}

// ── 4. Itinéraires ──

function routeSpecs(net: { ring: Vec2[]; bois: Vec2[]; mtb: Vec2[]; col: Vec2 }): RouteSpec[] {
  const t = (id: string): Vec2 => {
    const q = TOWNS.find((x) => x.id === id)!;
    return [q.x, q.z];
  };
  const rv = TOWNS.find((x) => x.id === 'robertville')!;
  const ang = Math.atan2(rv.z, rv.x);
  const east = ang - 0.055;
  const west = ang + 0.145;
  return [
    { id: 'boucle-de-saint-robert', name: 'La boucle de Saint-Robert', nameEn: 'Saint-Robert loop', loop: true, mode: 'road', waypoints: [t('saint-robert'), ANNEAU_GATES[0]!, ANNEAU_GATES[3]!, t('les-vignes')], landmarks: [{ name: 'Saint-Robert', x: t('saint-robert')[0], z: t('saint-robert')[1] }, { name: "L'Anneau", x: ANNEAU.cx, z: ANNEAU.cz }, { name: 'Les Vignes', x: t('les-vignes')[0], z: t('les-vignes')[1] }] },
    { id: 'robertville-plage', name: 'Robertville par les Coteaux', nameEn: 'Robertville via the hills', loop: true, mode: 'road', waypoints: [t('saint-robert'), t('les-vignes'), coastPoint(west + 0.06, 500), coastPoint(east, 185), t('vallon')], landmarks: [{ name: 'Les Coteaux', x: -1500, z: 5300 }, { name: 'Front de mer', x: rv.x, z: rv.z }, { name: 'Vallon-sur-Robe', x: t('vallon')[0], z: t('vallon')[1] }] },
    { id: 'front-de-mer', name: 'Le front de mer de Robertville', nameEn: 'Robertville seafront', loop: true, mode: 'cycle', waypoints: [coastPoint(east + 0.006, 185), coastPoint(east + 0.006, 125), coastPoint(west - 0.006, 125), coastPoint(west - 0.006, 185), coastPoint(ang, 480)], landmarks: [{ name: 'Les Planches', x: coastPoint(ang, 125)[0], z: coastPoint(ang, 125)[1] }, { name: 'Casino', x: coastPoint(ang + 0.018, 230)[0], z: coastPoint(ang + 0.018, 230)[1] }] },
    { id: 'col-du-phare', name: 'Le Col du Phare', nameEn: 'Lighthouse pass', loop: false, mode: 'road', waypoints: [t('le-col'), net.col, MASSIF.phare], hairpins: true, landmarks: [{ name: 'Col du Phare', x: net.col[0], z: net.col[1] }, { name: 'Phare de Robert', x: MASSIF.phare[0], z: MASSIF.phare[1] }] },
    { id: 'tour-de-l-ile', name: "Le Tour de l'Île", nameEn: 'Round the island', loop: true, mode: 'road', waypoints: net.ring.filter((_, k) => k % 3 === 0), landmarks: TOWNS.filter((x) => shoreDist(x.x, x.z) < 1500).map((x) => ({ name: x.name, x: x.x, z: x.z })) },
    { id: 'piste-verte', name: 'La Piste verte', nameEn: 'The green way', loop: false, mode: 'cycle', waypoints: [t('saint-robert'), ANNEAU_GATES[2]!, ANNEAU_GATES[1]!, t('saint-pierre')], landmarks: [{ name: "L'Anneau", x: ANNEAU.cx, z: ANNEAU.cz }] },
    { id: 'gravel-des-bois', name: 'Gravel des Bois', nameEn: 'Woods gravel loop', loop: true, mode: 'gravel', bike: 'gravel', waypoints: net.bois, landmarks: [{ name: 'Les Bois', x: -10300, z: -5000 }, { name: 'Étang des Bois', x: -9400, z: -4600 }] },
    { id: 'vtt-des-bois', name: 'VTT des Bois', nameEn: 'Woods MTB loop', loop: true, mode: 'mtb', bike: 'mtb', waypoints: net.mtb, landmarks: [{ name: 'Chapelle en ruine', x: -10600, z: -5600 }] },
  ];
}

// ── 5. Écriture ──

function clipPolyline2(pts: Vec2[], b: { minX: number; minZ: number; maxX: number; maxZ: number }): Vec2[][] {
  return clipPolyline(
    pts.map(([x, z]) => [x, 0, z] as Vec3),
    b,
  ).map((p) => p.map((q) => [q[0], q[2]] as Vec2));
}

async function main(): Promise<void> {
  rmSync(join(OUT, 'tiles'), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  mkdirSync(join(OUT, 'tiles'), { recursive: true });
  rmSync(join(OUT, 'routes'), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  mkdirSync(join(OUT, 'routes'), { recursive: true });
  writeFileSync(join(OUT, '.gitignore'), 'tiles/\n');
  terrain(0, 0);
  log('relief prêt');

  const D = designedRoads();
  log(`${D.roads.length} rues dessinées, ${D.gates.length} portes`);
  const ctx0: LandCtx = { farms: [] };
  const farms = farmSites(150, (x, z) => forestMask(x, z, ctx0));
  log(`${farms.length} fermes`);
  const grid = await planningGrid(D.roads, D.gates, farms);
  log(`grille de tracé ${grid.n} × ${grid.m}`);
  const P: Plan = { grid, failed: [] };
  const net = planNetwork(P, D.gates, farms);
  log(`réseau tracé (${grid.links.size} liens)${P.failed.length ? `, ${P.failed.length} tracés impossibles` : ''}`);
  for (const f of P.failed) console.log(`   · impossible : ${f}`);
  const netRoads = networkRoads(grid, D.roads, D.gates);
  const roads = [...D.roads, ...netRoads];
  const nx = joinCrossings(roads);
  log(`${roads.length} routes (${netRoads.length} tracées), ${(roads.reduce((s, r) => s + r.pts.length * 2, 0) / 1000).toFixed(0)} km, ${nx} croisements`);

  const idx = new RoadIndex(roads);
  const B = new Builder(idx);
  D.layouts.forEach((lay, k) => {
    townCentre(B, lay, k);
    if (lay.town.seaside) seasideBuildings(B, lay);
  });
  landmarks(B);
  // Maisons des rues.
  const byTown = new Map(D.layouts.map((l) => [l.town.id, l]));
  for (const r of D.roads) {
    const tid = TOWNS.find((t) => r.id.startsWith(`${t.id}-`));
    if (!tid) continue;
    const lay = byTown.get(tid.id)!;
    const t = lay.town;
    if (r.kind === 'cycleway') continue;
    const inside = (x: number, z: number) => Math.hypot(x - t.x, z - t.z) < t.r * (t.seaside ? 2 : 1.15);
    const palette = t.seaside ? 'villa' : t.port ? 'breton' : 'village';
    const core = t.size === 'ville' || t.size === 'bourg';
    B.street(r, { spacing: core ? 13 : 16, setback: core ? 3 : 4.5, depth: [8, 12], len: [8, 13], levels: core ? [2, 3] : [1, 2], palette, inside, seed: r.id.length * 131 + Math.round(t.x), apartments: core ? 0.15 : 0, ...(r.id.endsWith('boulevard') ? { sides: [1] } : {}) });
  }
  farmBuildings(B, farms);
  roadsideHouses(B, netRoads);
  log(`${B.out.length} bâtiments`);

  // Sols : parcelles, plages, eau.
  const ctx: LandCtx = { farms: farms.map((f) => [f.x, f.z]) };
  const rv = TOWNS.find((t) => t.seaside)!;
  const rvAng = Math.atan2(rv.z, rv.x);
  const nearSeaside = (x: number, z: number) => Math.abs(angle(Math.atan2(z, x) - rvAng - 0.045)) < 0.12 && shoreDist(x, z) < 2200;
  const fields = parcels(ctx, nearSeaside);
  const shore = shoreAreas((x, z) => Math.abs(angle(Math.atan2(z, x) - rvAng - 0.045)) < 0.11);
  const areas: Area[] = [...B.areas, ...fields, ...shore];
  const water = lakes();
  const ways = waterways((x, z) => idx.edgeDist(x, z) < 8);
  log(`${fields.length} parcelles, ${shore.length} morceaux de plage, ${water.length} plans d'eau, ${ways.length} cours d'eau`);

  // Graphe et itinéraires.
  const graph = buildGraph(roads);
  writeFileSync(join(OUT, 'graph.json'), JSON.stringify(graph));
  log(`graphe : ${graph.nodes.length / 3} nœuds, ${graph.edges.length} arêtes`);
  const routes: RouteData[] = [];
  // L'Anneau : la boucle elle-même, départ devant les tribunes.
  const an = D.anneau;
  const start = an.pts.reduce((bi, p, i) => (Math.hypot(p[0] - ANNEAU.cx, p[2] - (ANNEAU.cz + ANNEAU.radius)) < Math.hypot(an.pts[bi]![0] - ANNEAU.cx, an.pts[bi]![2] - (ANNEAU.cz + ANNEAU.radius)) ? i : bi), 0);
  const ringPts = [...an.pts.slice(start), ...an.pts.slice(0, start)];
  let dd = 0;
  const anPoints = ringPts.map((p, i) => {
    if (i) dd += Math.hypot(p[0] - ringPts[i - 1]![0], p[2] - ringPts[i - 1]![2]);
    return { x: r2(p[0]), y: r2(p[1]), z: r2(p[2]), d: 0 };
  });
  let acc = 0;
  anPoints.forEach((p, i) => {
    if (i) acc += Math.hypot(p.x - anPoints[i - 1]!.x, p.z - anPoints[i - 1]!.z);
    p.d = r2(acc);
  });
  const anLen = acc + Math.hypot(anPoints[0]!.x - anPoints[anPoints.length - 1]!.x, anPoints[0]!.z - anPoints[anPoints.length - 1]!.z);
  void dd;
  routes.push({ id: 'anneau', name: "L'Anneau", nameEn: 'The Ring', loop: true, lengthM: r2(anLen), elevationGainM: 0, points: anPoints, segments: [], roadWidthM: ANNEAU.widthM, attribution: ATTRIBUTION, roadWidths: [{ startM: 0, endM: r2(anLen), widthM: ANNEAU.widthM }], surfaces: [{ startM: 0, endM: r2(anLen), surface: 'asphalt' }], landmarks: [{ name: 'Tribunes', d: 0 }], stepM: 2, minElevationM: ANNEAU.level, maxElevationM: ANNEAU.level, maxGradePct: 0, markings: 'full' });
  for (const spec of routeSpecs(net)) {
    const r = planRoute(graph, spec);
    if (!r) {
      console.log(`   · itinéraire impossible : ${spec.id}`);
      continue;
    }
    routes.push(r);
  }
  for (const r of routes) writeFileSync(join(OUT, 'routes', `${r.id}.json`), JSON.stringify(r));
  for (const r of routes) log(`  ${r.id} : ${(r.lengthM / 1000).toFixed(1)} km, D+ ${r.elevationGainM.toFixed(0)} m, pente max ${r.maxGradePct} %${r.hairpins?.length ? `, ${r.hairpins.length} lacets` : ''}`);

  // Tuiles : altitudes et bois en parallèle, entités ici.
  const tiles: Array<{ id: string; tx: number; tz: number }> = [];
  for (let tx = Math.floor(ISLAND.minX / T); tx < Math.ceil(ISLAND.maxX / T); tx++) for (let tz = Math.floor(ISLAND.minZ / T); tz < Math.ceil(ISLAND.maxZ / T); tz++) tiles.push({ id: `${tx}_${tz}`, tx, tz });
  const serial = roads.map((r) => ({ pts: r.pts.flat(), loop: r.loop, flat: r.flat, blend: r.blend, width: r.width, kind: r.kind }));
  let lastPct = -1;
  const res = await runPool<{ min: number; max: number; baseM: number; hi: boolean; bytes: number; forests: Array<{ kind: string; rings: Vec2[][] }>; heath: Vec2[][]; rock: Vec2[][] }>(
    { type: 'init', roads: serial, farms: ctx.farms },
    tiles.map((t) => ({ type: 'tile', id: t.id, minX: t.tx * T, minZ: t.tz * T, size: T, dir: join(OUT, 'tiles') })),
    (done, total) => {
      const pct = Math.floor((done / total) * 10);
      if (pct !== lastPct) {
        lastPct = pct;
        log(`tuiles ${done}/${total}`);
      }
    },
  );
  const index: WorldMeta['tiles'] = [];
  const flatRing = (ring: Vec2[]) => ring.flatMap((p) => [r2(p[0]), r2(p[1])]);
  tiles.forEach((t, k) => {
    const h = res[k]!;
    const bounds = { minX: t.tx * T, minZ: t.tz * T, maxX: (t.tx + 1) * T, maxZ: (t.tz + 1) * T };
    const tile: WorldTile = {
      id: t.id,
      tx: t.tx,
      tz: t.tz,
      bounds,
      heights: { baseM: h.baseM, stepM: 0.01, encoding: 'uint16le', delta: true, lo: { n: 125, resolutionM: 8, file: `${t.id}.lo.u16` }, ...(h.hi ? { hi: { n: 500, resolutionM: 2, file: `${t.id}.hi.u16` } } : {}) },
      roads: [],
      buildings: [],
      forests: h.forests.map((f, i) => ({ id: `bois-${t.id}-${i}`, kind: f.kind as 'deciduous', rings: f.rings.map(flatRing) })),
      fields: [],
      landuse: [],
      water: [],
      waterways: [],
      railways: [],
      pois: [],
    };
    if (h.heath.length) tile.fields.push({ id: `lande-${t.id}`, kind: 'heath', rings: h.heath.map(flatRing) });
    if (h.rock.length) tile.fields.push({ id: `roche-${t.id}`, kind: 'bare', rings: h.rock.map(flatRing) });
    for (const r of roads) {
      if (!r.pts.some((p) => p[0] >= bounds.minX - 2 && p[0] <= bounds.maxX + 2 && p[2] >= bounds.minZ - 2 && p[2] <= bounds.maxZ + 2)) continue;
      const pts = r.loop ? [...r.pts, r.pts[0]!] : r.pts;
      const parts = clipPolyline(pts, bounds);
      if (r.loop && parts.length > 1) {
        const first = parts[0]!;
        const last = parts[parts.length - 1]!;
        const a = last[last.length - 1]!;
        if (Math.hypot(a[0] - first[0]![0], a[2] - first[0]![2]) < 1e-6) {
          parts[0] = [...last, ...first.slice(1)];
          parts.pop();
        }
      }
      parts.forEach((piece, i) => tile.roads.push({ id: `${r.id}-${i}`, kind: r.kind, name: r.name, width: r.width, surface: r.surface, flatten: [r.flat, r.flat + r.blend], pts: piece.flatMap((p) => [r2(p[0]), r2(p[1]), r2(p[2])]) }));
    }
    for (const b of B.out) {
      const cx = b.pts.reduce((s, p) => s + p[0], 0) / b.pts.length;
      const cz = b.pts.reduce((s, p) => s + p[1], 0) / b.pts.length;
      if (cx < bounds.minX || cx >= bounds.maxX || cz < bounds.minZ || cz >= bounds.maxZ) continue;
      tile.buildings.push({ id: b.id, kind: b.kind, height: b.height, levels: b.levels, roof: b.roof, y: r2(b.y), pts: b.pts.flatMap((p) => [r2(p[0]), r2(p[1])]), ...(b.name ? { name: b.name } : {}), ...(b.colour ? { colour: b.colour } : {}), ...(b.material ? { material: b.material } : {}) });
    }
    for (const a of areas) {
      const c = clipPolygon(a.ring, bounds);
      if (c.length < 3 || Math.abs(polygonArea(c)) < 1) continue;
      const entry = { id: a.id, kind: a.kind, ...(a.name ? { name: a.name } : {}), rings: [flatRing(c)] };
      if (a.layer === 'forests') tile.forests.push(entry as WorldTile['forests'][number]);
      else tile[a.layer].push(entry);
    }
    for (const w of water) {
      const c = clipPolygon(w.ring, bounds);
      if (c.length >= 3 && Math.abs(polygonArea(c)) > 1) tile.water.push({ id: w.id, kind: w.kind, ...(w.name ? { name: w.name } : {}), level: w.level, rings: [flatRing(c)] });
    }
    for (const w of ways) for (const piece of clipPolyline2(w.pts, bounds)) if (piece.length >= 2) tile.waterways.push({ id: w.id, kind: w.kind, width: w.width, name: w.name, pts: piece.flatMap((p) => [r2(p[0]), r2(p[1])]) });
    const json = JSON.stringify(tile);
    writeFileSync(join(OUT, 'tiles', `${t.id}.json`), json);
    index.push({ id: t.id, tx: t.tx, tz: t.tz, baseM: h.baseM, minM: r2(h.min), maxM: r2(h.max), lods: h.hi ? ['lo', 'hi'] : ['lo'], bytes: h.bytes + Buffer.byteLength(json) });
  });
  log('tuiles écrites');

  writeFileSync(join(OUT, 'places.json'), JSON.stringify(B.places));
  const sr = TOWNS.find((t) => t.id === 'saint-robert')!;
  const meta: WorldMeta = {
    formatVersion: 1,
    id: ISLAND.id,
    name: ISLAND.name,
    crs: 'EPSG:2154',
    // Repère fictif, en pleine mer au large de la Bretagne : ne recouvre aucune zone réelle.
    originL93: { x: 60000, y: 6800000 },
    bounds: { minX: ISLAND.minX, minZ: ISLAND.minZ, maxX: ISLAND.maxX, maxZ: ISLAND.maxZ },
    tileSizeM: T,
    heightResolutionM: 2,
    heightEncoding: { type: 'uint16le', stepM: 0.01, rowOrder: 'north-to-south', colOrder: 'west-to-east' },
    lods: [
      { id: 'lo', resolutionM: 8, n: 125, suffix: '.lo.u16' },
      { id: 'hi', resolutionM: 2, n: 500, suffix: '.hi.u16' },
    ],
    tiles: index,
    routes: routes.map((r, i) => ({ id: r.id, file: `routes/${r.id}.json`, name: r.name, nameEn: r.nameEn ?? r.name, lengthM: r.lengthM, elevationGainM: r.elevationGainM, loop: r.loop, main: i === 0, ...(r.bike ? { bike: r.bike } : {}) })),
    mainRoute: 'anneau',
    attribution: ATTRIBUTION,
    open: { graph: 'graph.json', start: { x: sr.x + 3, z: sr.z }, places: 'places.json' },
    sea: { levelM: 0 },
  };
  writeFileSync(join(OUT, 'world.json'), JSON.stringify(meta, null, 1));
  log('monde écrit, contrôles…');
  const report = verifyWorld(OUT);
  for (const line of report.lines) console.log(line);
  log(report.ok ? 'contrôles au vert' : 'contrôles en échec');
  if (!report.ok) process.exitCode = 1;
}

// Lancement direct seulement (les fonctions servent aussi aux scripts de mise au point).
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) void main();
