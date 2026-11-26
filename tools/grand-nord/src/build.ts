/**
 * Générateur du Grand Nord robertien (voir docs/GRAND_NORD.md), monde du mode Poly tiré du générateur du Pays de
 * Robert (tools/massif) : écrit un monde au format des mondes réels (world.json, tiles/*.json + .lo/.hi.u16,
 * routes/*.json, graph.json, places.json) dans le dossier ISLAND_OUT (obligatoire pour un essai), puis lance les
 * contrôles automatiques (verify.ts).
 *
 *   ISLAND_OUT=D:/zzCACHE_ALLEZROBERT/zones-travail/grand-nord node node_modules/tsx/dist/cli.mjs tools/grand-nord/src/build.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RouteData, WorldMeta, WorldTile } from '../../../packages/shared/src/route.ts';
import { ANNEAU, GLACIER, HARBOURS, ISLAND, LAKES, MASSIF, TOWNS, anneauLoop, chainAt, coastPoint, inGlacier, inHarbour, inLake, inRiver, riverBeds, shoreDist, terrain, type Vec2 } from './design.ts';
import { chaikin, clipPolygon, clipPolyline, polygonArea, resample, type Vec3 } from './geom.ts';
import { forestMask, lakes, parcels, shoreAreas, waterways, type LandCtx } from './land.ts';
import { fbm, rng } from './noise.ts';
import { CELL, CLASSES, CLASS_BY_RANK, Grid, type RoadClass } from './planner.ts';
import { runPool } from './pool.ts';
import { ATTRIBUTION, RoadIndex, buildGraph, cleanRoads, joinCrossings, nearestOn, smoothProfiles, unifyEnds, makeRoad, nodeHeight, profile, r2, snapEnds, type Road, type RoadSpec } from './roads.ts';
import { GRAVELLY, planRoute, timedSegments, type RouteSpec } from './routes.ts';
import { harbourPoint, portRoads } from './ports.ts';
import { encodeRoute } from '../../../packages/shared/src/routeCodec.ts';
import { ANNEAU_GATES, Builder, farmBuildings, farmSites, landmarks, roadsideHouses, seasideBuildings, townCentre, townLayout, type TownLayout } from './settle.ts';
import type { Area } from './types.ts';
import { verifyWorld } from './verify.ts';
import { switchbacks } from './climb.ts';
import { publishIsland } from './catalogue.ts';

/** Dossier du monde ; ISLAND_OUT : essai ailleurs (catalogue et cartes du jeu laissés tels quels). */
const TRIAL = process.env.ISLAND_OUT;
const OUT = TRIAL ? resolve(TRIAL) : resolve(import.meta.dirname, '../../../apps/client/public/worlds', ISLAND.id);
const T = ISLAND.tileSizeM;
const log = (s: string) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s] ${s}`);
const T0 = Date.now();

// ── 1. Routes dessinées : Anneau, rues des villes, front de mer ──

export function designedRoads(): { roads: Road[]; layouts: TownLayout[]; anneau: Road; gates: Array<{ p: Vec2; y: number; dir: Vec2; town?: string }> } {
  const anneau = makeRoad({ id: 'anneau', name: 'Circuit du Grand Nord', kind: 'tertiary', width: ANNEAU.widthM, pts: anneauLoop(2), loop: true, designed: true, gmax: 0.01 });
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
  // Col de l'Aigle : montée en lacets depuis Le Planay, descente en lacets vers l'Aber, route de l'Observatoire.
  const wet = (x: number, z: number) => inLake(x, z, 1.5) || inRiver(x, z, 25) || shoreDist(x, z) < 150;
  const col = saddle();
  const colY = terrain(col[0], col[1]);
  const lc = gates.filter((g) => g.town === 'rennesby').sort((a, b) => Math.hypot(a.p[0] - col[0], a.p[1] - col[1]) - Math.hypot(b.p[0] - col[0], b.p[1] - col[1]))[0]!;
  lc.town = 'rennesby-montee'; // porte réservée à la montée (le réseau passe par les autres)
  const axis: Vec2 = [MASSIF.mont[0] - MASSIF.phare[0], MASSIF.mont[1] - MASSIF.phare[1]];
  const al = Math.hypot(axis[0], axis[1]);
  const toPhare: Vec2 = [MASSIF.phare[0] - col[0], MASSIF.phare[1] - col[1]];
  const tl = Math.hypot(toPhare[0], toPhare[1]);
  const phareEnd: Vec2 = [MASSIF.phare[0] - (toPhare[0] / tl) * 45, MASSIF.phare[1] - (toPhare[1] / tl) * 45];
  // Départ dans le prolongement d'une rue (pas d'épingle au raccord).
  const ahead = (g: { p: Vec2; dir: Vec2 }, m: number): Vec2 => {
    const l = Math.hypot(g.dir[0], g.dir[1]) || 1;
    return [g.p[0] + (g.dir[0] / l) * m, g.p[1] + (g.dir[1] / l) * m];
  };
  // Routes du col en lacets (climb.ts) : pente régulière d'environ 6,5 %, épingles arrondies. Au col, carrefour des
  // trois routes : montée sud depuis Le Planay, descente nord vers la vallée de l'Aber, route de l'Observatoire.
  // Pied nord : point de la vallée de l'Aber (hors du lit), ≥ 380 m sous le col, le plus proche du col.
  const aber = riverBeds().find((b) => b.river.id === 'la-vik')!;
  let foot: Vec2 = aber.pts[Math.floor(aber.pts.length / 2)]!;
  for (let k = 0; k < aber.pts.length; k += 5) {
    const [x, z] = aber.pts[k]!;
    const a = aber.pts[Math.max(0, k - 1)]!;
    const b = aber.pts[Math.min(aber.pts.length - 1, k + 1)]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // Rive côté col.
    const nx = -(b[1] - a[1]) / l;
    const nz = (b[0] - a[0]) / l;
    const s = (col[0] - x) * nx + (col[1] - z) * nz > 0 ? 1 : -1;
    const q: Vec2 = [x + nx * s * (aber.chan[k]! + 45), z + nz * s * (aber.chan[k]! + 45)];
    if (terrain(q[0], q[1]) < colY - 450 && shoreDist(q[0], q[1]) > 500) {
      foot = q;
      break;
    }
  }
  const lacets = (from: Vec2, to: Vec2, grade: number, half: number): Vec2[] => simplifyPath(switchbacks(from, to, { grade, halfWidth: half, turn: 30, blocked: wet }), 3);
  const southPts = [lc.p, ...lacets(ahead(lc, 60), col, 0.062, 420)];
  const northPts = lacets(foot, col, 0.062, 240).reverse();
  /** Dernier point où `a` coupe `b` : la route `a` part de là (carrefour en T), sans recroiser `b` ensuite. */
  const fromLastCross = (a: Vec2[], b: Vec2[]): Vec2[] => {
    let cut = -1;
    let at: Vec2 | null = null;
    for (let i = 0; i + 1 < a.length; i++)
      for (let j = 0; j + 1 < b.length; j++) {
        const [p, q, u, v] = [a[i]!, a[i + 1]!, b[j]!, b[j + 1]!];
        const d = (q[0] - p[0]) * (v[1] - u[1]) - (q[1] - p[1]) * (v[0] - u[0]);
        if (Math.abs(d) < 1e-9) continue;
        const t = ((u[0] - p[0]) * (v[1] - u[1]) - (u[1] - p[1]) * (v[0] - u[0])) / d;
        const s2 = ((u[0] - p[0]) * (q[1] - p[1]) - (u[1] - p[1]) * (q[0] - p[0])) / d;
        if (t > 1e-6 && t < 1 && s2 >= 0 && s2 <= 1 && i >= cut) {
          cut = i;
          at = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        }
      }
    return at && cut > 0 ? [at, ...a.slice(cut + 1)] : a;
  };
  const sudPath = fillet(southPts, 16);
  const nordPath = fromLastCross(fillet([col, ...northPts.slice(1)], 16), sudPath);
  const sudRoad = makeRoad({ id: 'col-sud', name: "Route du Col du Renne", kind: 'tertiary', width: 6, pts: sudPath, designed: true, gmax: 0.12, smooth: 0, y0: lc.y, y1: colY });
  const ySud = (p: Vec2) => nearestOn(sudRoad, p[0], p[1]).y;
  const colRoads = [sudRoad, makeRoad({ id: 'col-nord', name: "Route du Col du Renne", kind: 'tertiary', width: 6, pts: nordPath, designed: true, gmax: 0.12, smooth: 0, y0: ySud(nordPath[0]!) })];
  // Route de l'Observatoire : bifurque de la montée sud vers 650 m et monte en lacets sur le versant sud du Pic
  // (depuis le col, elle suivrait l'arête, bien trop raide).
  const sud = sudRoad;
  let bi = 0;
  sud.pts.forEach((p, i) => {
    const score = (q: Vec3) => Math.abs(q[1] - (colY - 140)) + Math.hypot(q[0] - MASSIF.phare[0], q[2] - MASSIF.phare[1]) * 0.04;
    if (i > 20 && i < sud.pts.length - 20 && score(p) < score(sud.pts[bi]!)) bi = i;
  });
  const branch = sud.pts[bi]!;
  const phareUp = lacets([branch[0], branch[2]], phareEnd, 0.068, 300);
  const obsPath = fromLastCross(fillet([[branch[0], branch[2]], ...phareUp.slice(1)], 14), sudPath);
  colRoads.push(makeRoad({ id: 'col-observatoire', name: 'Route du Belvédère', kind: 'unclassified', width: 4.5, pts: obsPath, designed: true, gmax: 0.12, smooth: 0, y0: ySud(obsPath[0]!) }));
  const top: Vec3 = colRoads[0]!.pts[colRoads[0]!.pts.length - 1]!;
  const footEnd: Vec3 = colRoads[1]!.pts[colRoads[1]!.pts.length - 1]!;
  const fp = colRoads[1]!.pts[Math.max(0, colRoads[1]!.pts.length - 8)]!;
  roads.push(...colRoads);
  gates.push({ p: [footEnd[0], footEnd[2]], y: footEnd[1], dir: [footEnd[0] - fp[0], footEnd[2] - fp[2]], town: 'col-nord' });
  gates.push({ p: [top[0], top[2]], y: top[1], dir: [axis[0] / al, axis[1] / al], town: 'col' });
  // Route de Pralong : de son pied (ouest du lac) à la station, en lacets.
  const pralongBas: Vec2 = [-9100, -3100];
  const pg = gates.filter((g) => g.town === 'fjellheim').sort((a, b) => Math.hypot(a.p[0] - pralongBas[0], a.p[1] - pralongBas[1]) - Math.hypot(b.p[0] - pralongBas[0], b.p[1] - pralongBas[1]))[0]!;
  pg.town = 'fjellheim-station';
  const pgAhead = ((): Vec2 => {
    const l = Math.hypot(pg.dir[0], pg.dir[1]) || 1;
    return [pg.p[0] + (pg.dir[0] / l) * 50, pg.p[1] + (pg.dir[1] / l) * 50];
  })();
  const climb = [...simplifyPath(switchbacks(pralongBas, pgAhead, { grade: 0.06, halfWidth: 320, turn: 30, blocked: wet }), 3), pg.p];
  const station = makeRoad({ id: 'route-de-pralong', name: 'Route de Fjellheim', kind: 'tertiary', width: 6, pts: fillet(climb, 18), designed: true, gmax: 0.09, smooth: 0, y0: terrain(pralongBas[0], pralongBas[1]), y1: pg.y });
  roads.push(station);
  const s0 = station.pts[0]!;
  const s1 = station.pts[Math.min(6, station.pts.length - 1)]!;
  gates.push({ p: [s0[0], s0[2]], y: s0[1], dir: [s0[0] - s1[0], s0[2] - s1[2]], town: 'fjellheim-bas' });
  for (const g of ANNEAU_GATES) {
    let best = anneau.pts[0]!;
    for (const p of anneau.pts) if (Math.hypot(p[0] - g[0], p[2] - g[1]) < Math.hypot(best[0] - g[0], best[2] - g[1])) best = p;
    const out: Vec2 = [g[0] - ANNEAU.cx - Math.sign(g[0] - ANNEAU.cx) * Math.min(Math.abs(g[0] - ANNEAU.cx), ANNEAU.half), g[1] - ANNEAU.cz];
    gates.push({ p: [best[0], best[2]], y: best[1], dir: out, town: 'anneau' });
  }
  return { roads, layouts, anneau, gates };
}

// ── 2. Grille de tracé ──

/** Méandres et petites routes : 1 = valeurs du jeu. */
const MEANDER_K = Number(process.env.ISLAND_MEANDER ?? 1);
/** Écart (m) d'une courbe à sa corde sous lequel elle peut devenir une ligne droite ; 0 : aucune. */
const STRAIGHT_M = Number(process.env.ISLAND_STRAIGHT ?? 24);
const MESH_M = Number(process.env.ISLAND_MESH ?? 2100);
const TRACK_WOB = Number(process.env.ISLAND_TRACK_WOB ?? 0.4);
/** Coût qui varie d'un endroit à l'autre : les routes serpentent au lieu de filer droit (amplitude, taille en m). */
const WOB = Number(process.env.ISLAND_WOB ?? 0.38);
const WOB_M = Number(process.env.ISLAND_WOB_M ?? 440);

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
      if (sd < 60 || inLake(x, z, 1.25) || inHarbour(x, z, 25) || inGlacier(x, z, 60)) grid.water[c] = 1;
      else if (inRiver(x, z, 4)) grid.water[c] = 2;
      grid.wob[c] = 1 + WOB * Math.max(-0.75, Math.min(1.6, 2.2 * fbm(x / WOB_M, z / WOB_M, 2, 61)));
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

type Trail = { name: string; mtb?: boolean; seed?: number } & ({ at: Vec2; r: number; n: number } | { line: Vec2[] });
const shorePath = (from: number, to: number, n: number, inset: number): Vec2[] => Array.from({ length: n + 1 }, (_, k) => coastPoint(from + ((to - from) * k) / n, inset));

/** Pistes gravel et sentiers VTT : boucles (centre, rayon) et traversées (points de passage). */
const TRAILS: Trail[] = [
  { name: 'Chemin de Vidda', at: [11000, 600], r: 1700, n: 9 },
  { name: 'Chemin des Mille-Lacs', at: [3600, 6700], r: 1300, n: 8 },
  { name: 'Chemin de la Saumonée', at: [-13300, 2600], r: 1200, n: 8 },
  { name: 'Sentier des Bouleaux', mtb: true, at: [-900, -4200], r: 1200, n: 8 },
  { name: 'Chemin des Pêcheurs', line: shorePath(0.52, 0.95, 7, 210) },
  { name: 'Chemin des Galets', line: shorePath(2.12, 2.5, 6, 280) },
  { name: 'Chemin de la Toundra', line: [[-10600, 3600], [-8200, 5600], [-5200, 6000], [-2200, 6300], [1200, 7300]] },
  { name: 'Sentier des Lemmings', mtb: true, at: [-7600, -6300], r: 900, n: 8 },
  { name: 'Sentier de la Dent du Renne', mtb: true, at: [6300, -3500], r: 900, n: 8 },
  { name: 'Descente du Renne', mtb: true, line: [[3150, -5900], [3100, -5300], [2700, -4200], [2200, -3300]] },
  { name: 'Sentier des Gorges', mtb: true, at: [9200, -2400], r: 800, n: 8 },
  { name: 'Sentier de Skarvik', mtb: true, at: [9300, 7500], r: 850, n: 8 },
  { name: 'Sentier du Grand Lac', mtb: true, at: [-2500, -3900], r: 700, n: 8 },
  // Petites boucles : cyclo-cross sur la toundra des Mille-Lacs (mousses, sable, terre) et bike park de Fjellheim.
  { name: 'Cyclo-cross de la Toundra', at: [5000, 4300], r: 340, n: 6 },
  { name: 'Bike park de Fjellheim', mtb: true, at: [-7650, -4750], r: 380, n: 7, seed: 3 },
];

/**
 * Matière et largeur des chemins, tronçon après tronçon (jamais deux pareils à la suite) : stabilisé (gravel), pierre
 * (pebblestone), gravier fin (fine_gravel), pavés (cobblestone), terre (dirt), tourbe (earth), sable (sand),
 * mousses (grass), roche (rock). Les sentiers restent étroits, quelques chemins s'ouvrent à 4,4 m.
 */
const SKIN: Record<string, Array<[surface: string, width: number]>> = {
  'Chemin des Rennes': [['pebblestone', 3], ['gravel', 3.4], ['fine_gravel', 2.8]],
  'Chemin de Vidda': [['fine_gravel', 4.2], ['gravel', 3.2], ['pebblestone', 3.4]],
  'Chemin des Mille-Lacs': [['fine_gravel', 3.6], ['pebblestone', 2.8], ['gravel', 3.2]],
  'Chemin de la Saumonée': [['fine_gravel', 4.4], ['gravel', 3.4], ['fine_gravel', 2.8]],
  'Sentier des Bouleaux': [['dirt', 2.4], ['earth', 2.2], ['grass', 2.6]],
  'Chemin des Marais': [['fine_gravel', 3.6], ['gravel', 2.8]],
  'Chemin des Pêcheurs': [['pebblestone', 2.8], ['fine_gravel', 3.2], ['gravel', 3.6]],
  'Chemin des Galets': [['pebblestone', 3], ['gravel', 2.6], ['fine_gravel', 3.4]],
  'Chemin de la Toundra': [['gravel', 3.6], ['fine_gravel', 4.4], ['pebblestone', 2.8], ['gravel', 2.6]],
  'Sentier des Lemmings': [['grass', 2.6], ['rock', 2.2], ['dirt', 2]],
  'Sentier de la Dent du Renne': [['rock', 2.4], ['dirt', 2], ['grass', 2.6], ['rock', 2]],
  'Descente du Renne': [['dirt', 2.2], ['rock', 2.6], ['earth', 2]],
  'Sentier des Gorges': [['earth', 2], ['rock', 2.4], ['dirt', 2.2]],
  'Sentier de Skarvik': [['rock', 2.2], ['earth', 2], ['grass', 2.4]],
  'Sentier du Grand Lac': [['dirt', 2.2], ['earth', 1.9], ['grass', 2.6]],
  'Cyclo-cross de la Toundra': [['grass', 3], ['sand', 2.8], ['earth', 2.6], ['grass', 3.2]],
  'Bike park de Fjellheim': [['dirt', 2.4], ['earth', 2.2], ['rock', 2.4]],
};

const LANE_NAMES = ['des Bouleaux', 'du Vieux Fumoir', 'des Quatre Vents', 'de la Croix Blanche', 'des Épicéas', 'des Lagopèdes', 'du Lavoir', 'de la Butte', 'des Airelles', 'du Grand Pré', 'de la Source', 'des Sorbiers', 'du Moulin Brûlé', 'des Élans', 'des Myrtilles', 'du Cairn', 'de la Tourbière', 'des Plongeons', 'du Pont Neuf', 'de la Forge', 'des Lichens', 'du Coteau', 'des Mousses', 'des Bruyères', 'du Pin Creux', 'de la Mare', 'des Linaigrettes', 'du Berger'];

const MESH_NAMES = new Set([...LANE_NAMES.map((n) => `Route ${n}`), 'Chemin rural']);

/**
 * Petites routes du maillage qui ne tiennent pas les contrôles (verify.ts) : raccord en biseau, croisement sans carrefour,
 * creux ou pente trop forts, bout isolé. Elles sont retirées ; les autres routes ne bougent pas.
 */
export function pruneMesh(roads: Road[], profiles: boolean): Road[] {
  let list = roads;
  const mesh = (r: Road) => MESH_NAMES.has(r.name);
  for (let pass = 0; pass < 12; pass++) {
    const graph = buildGraph(list);
    const bad = new Set<Road>();
    const near = (r: Road, x: number, z: number) => r.pts.some((p) => Math.hypot(p[0] - x, p[2] - z) < 2.5);
    const drop = (name: string, x: number, z: number) => {
      if (!MESH_NAMES.has(name)) return false;
      const r = list.find((q) => q.name === name && !bad.has(q) && near(q, x, z));
      if (r) bad.add(r);
      return !!r;
    };
    const node = (n: number): [number, number] => [graph.nodes[n * 3]!, graph.nodes[n * 3 + 2]!];
    // Biseaux.
    const dirs = new Map<number, Array<{ a: number; e: number }>>();
    graph.edges.forEach((e, ei) => {
      const m = e.pts.length / 3;
      const away = (from: number, step: number) => {
        let k = from;
        let L = 0;
        while (k + step >= 0 && k + step < m && L < 8) {
          L += Math.hypot(e.pts[(k + step) * 3]! - e.pts[k * 3]!, e.pts[(k + step) * 3 + 2]! - e.pts[k * 3 + 2]!);
          k += step;
        }
        return Math.atan2(e.pts[k * 3 + 2]! - e.pts[from * 3 + 2]!, e.pts[k * 3]! - e.pts[from * 3]!);
      };
      (dirs.get(e.a) ?? dirs.set(e.a, []).get(e.a)!).push({ a: away(0, 1), e: ei });
      (dirs.get(e.b) ?? dirs.set(e.b, []).get(e.b)!).push({ a: away(m - 1, -1), e: ei });
    });
    for (const [n, l] of dirs)
      for (let i = 0; i < l.length; i++)
        for (let j = i + 1; j < l.length; j++) {
          let t = Math.abs(l[i]!.a - l[j]!.a);
          if (t > Math.PI) t = 2 * Math.PI - t;
          if (t > (24 * Math.PI) / 180) continue;
          const [x, z] = node(n);
          const A = graph.edges[l[i]!.e]!;
          const B = graph.edges[l[j]!.e]!;
          const [short, long] = A.len < B.len ? [A, B] : [B, A];
          if (!drop(short.name ?? '', x, z)) drop(long.name ?? '', x, z);
        }
    // Croisements sans carrefour et routes qui se longent de trop près.
    const seg = new Map<string, Array<{ e: number; k: number }>>();
    const cellOf = (x: number, z: number) => `${Math.floor(x / 20)}_${Math.floor(z / 20)}`;
    graph.edges.forEach((e, ei) => {
      for (let k = 0; k + 5 < e.pts.length; k += 3) {
        const c = cellOf(e.pts[k]!, e.pts[k + 2]!);
        (seg.get(c) ?? seg.set(c, []).get(c)!).push({ e: ei, k });
      }
    });
    graph.edges.forEach((e, ei) => {
      if (!MESH_NAMES.has(e.name ?? '')) return;
      for (let k = 6; k + 8 < e.pts.length; k += 3) {
        const x = e.pts[k]!;
        const z = e.pts[k + 2]!;
        if ([e.a, e.b].some((n) => Math.hypot(node(n)[0] - x, node(n)[1] - z) < 26)) continue;
        for (let dx = -20; dx <= 20; dx += 20)
          for (let dz = -20; dz <= 20; dz += 20)
            for (const q of seg.get(cellOf(x + dx, z + dz)) ?? []) {
              if (q.e === ei) continue;
              const o = graph.edges[q.e]!;
              if (Math.hypot(o.pts[q.k]! - x, o.pts[q.k + 2]! - z) < (e.width + o.width) / 2 + 2.5) {
                drop(e.name ?? '', x, z);
                return;
              }
            }
      }
      if (!profiles) return;
      for (let i = 4; i + 4 < e.pts.length / 3; i++) {
        const sag = (e.pts[(i - 4) * 3 + 1]! + e.pts[(i + 4) * 3 + 1]!) / 2 - e.pts[i * 3 + 1]!;
        const rise = Math.abs(e.pts[(i + 4) * 3 + 1]! - e.pts[(i - 4) * 3 + 1]!) / 16;
        if (sag > 0.11 || rise > 0.13) {
          drop(e.name ?? '', e.pts[i * 3]!, e.pts[i * 3 + 2]!);
          return;
        }
      }
    });
    // Bouts isolés : morceaux détachés du réseau principal, petits culs-de-sac.
    const parent = Array.from({ length: graph.nodes.length / 3 }, (_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    const deg = new Map<number, number>();
    for (const e of graph.edges) {
      parent[find(e.a)] = find(e.b);
      deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
      deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
    }
    const size = new Map<number, number>();
    for (let i = 0; i < parent.length; i++) size.set(find(i), (size.get(find(i)) ?? 0) + 1);
    const main = [...size].sort((a, b) => b[1] - a[1])[0]![0];
    for (const e of graph.edges) {
      if (!MESH_NAMES.has(e.name ?? '')) continue;
      const mid = Math.floor(e.pts.length / 6) * 3;
      if (find(e.a) !== main || ((deg.get(e.a) === 1 || deg.get(e.b) === 1) && e.len < 320)) drop(e.name ?? '', e.pts[mid]!, e.pts[mid + 2]!);
    }
    if (!bad.size) break;
    list = list.filter((r) => !bad.has(r) || !mesh(r));
  }
  return list;
}

/** Petites routes sur toute l'île : semis irrégulier de carrefours, reliés à leurs plus proches voisins. */
function meshRoads(P: Plan): void {
  if (!(MESH_M > 0)) return;
  const r = rng(90210);
  const pts: Vec2[] = [];
  const steepAt = (x: number, z: number) => {
    const h = terrain(x, z);
    return Math.max(...[[80, 0], [-80, 0], [0, 80], [0, -80]].map(([dx, dz]) => Math.abs(terrain(x + dx!, z + dz!) - h))) / 80;
  };
  for (let z = ISLAND.minZ; z < ISLAND.maxZ; z += MESH_M * 0.87)
    for (let x = ISLAND.minX; x < ISLAND.maxX; x += MESH_M) {
      const px = x + (r() - 0.5) * MESH_M * 0.7;
      const pz = z + (r() - 0.5) * MESH_M * 0.6;
      const c = P.grid.cellAt(px, pz);
      if (shoreDist(px, pz) < 550 || P.grid.water[c] || P.grid.block[c] || P.grid.occ[c] || inRiver(px, pz, 60) || inLake(px, pz, 1.6)) continue;
      if (TOWNS.some((t) => Math.hypot(t.x - px, t.z - pz) < t.r * 1.5) || steepAt(px, pz) > 0.13) continue;
      if (Math.hypot(px - ANNEAU.cx, pz - ANNEAU.cz) < 1250) continue;
      pts.push([px, pz]);
    }
  const links = new Set<string>();
  const before = P.failed.length;
  let made = 0;
  pts.forEach((a, i) => {
    const near = pts.map((b, j) => ({ j, d: Math.hypot(a[0] - b[0], a[1] - b[1]) })).filter((q) => q.j !== i && q.d < MESH_M * 1.9).sort((p, q) => p.d - q.d);
    for (const { j } of near.slice(0, 2 + (r() < 0.45 ? 1 : 0))) {
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      if (links.has(key)) continue;
      links.add(key);
      const name = `Route ${LANE_NAMES[(i * 7 + j * 3) % LANE_NAMES.length]}`;
      const s = P.grid.cellAt(a[0], a[1]);
      const g = P.grid.cellAt(pts[j]![0], pts[j]![1]);
      if (P.grid.water[g] || P.grid.block[g] || s === g) continue;
      const [gx, gz] = P.grid.center(g);
      const goal = P.grid.occ[g] ? (c: number) => P.grid.occ[c]! > 0 && Math.hypot(P.grid.center(c)[0] - gx, P.grid.center(c)[1] - gz) < 300 : g;
      const path = P.grid.search(s, goal, CLASSES.lane, { box: 60, toward: g, maxExp: 400_000 });
      if (!path) continue;
      P.grid.commit(path, CLASSES.lane, name);
      made++;
    }
    // Aucun cul-de-sac isolé : chaque carrefour touche le reste du réseau.
    if (P.grid.occ[P.grid.cellAt(a[0], a[1])]) spur(P, a, CLASSES.lane, 5, `Route ${LANE_NAMES[(i * 7) % LANE_NAMES.length]}`, 90);
  });
  P.failed.length = before;
  log(`maillage : ${pts.length} carrefours, ${made} petites routes`);
}

/** Tour du lac de Robert : points sur une ellipse autour de la rive (à `k` × les demi-axes). */
export function lakeRing(k: number, n: number): Vec2[] {
  const l = LAKES.find((q) => q.id === 'lac-de-robert')!;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const ex = Math.cos(a) * (l.rx * k + 160);
    const ez = Math.sin(a) * (l.rz * k + 260);
    return [l.x + ex * Math.cos(l.rot) - ez * Math.sin(l.rot), l.z + ex * Math.sin(l.rot) + ez * Math.cos(l.rot)] as Vec2;
  });
}

export function planNetwork(P: Plan, gates: Array<{ p: Vec2; town?: string }>, farms: Array<{ gate: Vec2 }>): { ring: Vec2[]; bois: Vec2[]; mtb: Vec2[]; col: Vec2; foot: Vec2; lake: Vec2[] } {
  // Grand Nord : pas de grandes routes (« secondary ») ; en terrain accidenté, leurs virages restent trop serrés.
  const C = { ...CLASSES, secondary: CLASSES.tertiary };
  const town = (id: string) => TOWNS.find((t) => t.id === id)!;
  const G = (id: string, toward: Vec2 | string) => nearestGate(gates, id, typeof toward === 'string' ? [town(toward).x, town(toward).z] : toward);
  // a. Route du tour du pays : points le long de la côte, villes côtières traversées par leurs rues.
  const ring: Array<{ p: Vec2; ang: number }> = [];
  for (let k = 0; k < 30; k++) {
    const ang = -Math.PI + (k / 30) * 2 * Math.PI;
    let inset = 520;
    let p = coastPoint(ang, inset);
    const steepAt = (q: Vec2) => {
      const h = terrain(q[0], q[1]);
      return Math.max(...[[60, 0], [-60, 0], [0, 60], [0, -60]].map(([dx, dz]) => Math.abs(terrain(q[0] + dx!, q[1] + dz!) - h))) > 4.5;
    };
    while (inset < 3600 && (P.grid.block[P.grid.cellAt(p[0], p[1])] || P.grid.water[P.grid.cellAt(p[0], p[1])] || steepAt(p) || TOWNS.some((t) => Math.hypot(t.x - p[0], t.z - p[1]) < t.r * 1.6))) {
      inset += 120;
      p = coastPoint(ang, inset);
    }
    // Massif de l'Aigle : pas de point imposé, la route le contourne d'elle-même.
    if (Math.min(Math.hypot(p[0] - MASSIF.phare[0], p[1] - MASSIF.phare[1]), Math.hypot(p[0] - MASSIF.mont[0], p[1] - MASSIF.mont[1])) < 3600 || inset >= 3600) continue;
    ring.push({ p, ang });
  }
  for (const id of ['port-boreal', 'skarvik', 'nordvik', 'myrbu', 'isbrevik', 'ferjeby', 'utnes']) {
    const t = town(id);
    const ang = Math.atan2(t.z, t.x);
    const tg = gates.filter((g) => g.town === id);
    const ga = tg.map((g) => ({ p: g.p, ang: Math.atan2(g.p[1], g.p[0]) }));
    ga.sort((a, b) => a.ang - b.ang);
    const first = ga[0]!;
    const last = ga[ga.length - 1]!;
    for (let k = ring.length - 1; k >= 0; k--) if (Math.abs(angle(ring[k]!.ang - ang)) < 0.12) ring.splice(k, 1);
    ring.push({ p: first.p, ang: first.ang - 1e-4 }, { p: last.p, ang: last.ang + 1e-4 });
  }
  ring.sort((a, b) => a.ang - b.ang);
  const steep = { ...C.lane, gmax: 0.14 };
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k]!;
    const b = ring[(k + 1) % ring.length]!;
    const sameTown = gates.find((g) => g.p === a.p)?.town && gates.find((g) => g.p === a.p)?.town === gates.find((g) => g.p === b.p)?.town;
    if (sameTown) continue;
    // En montagne, route de rang inférieur : ses lacets peuvent être serrés (rayon de 2,5 m admis, 7,5 m pour les grandes routes).
    const high = [a.p, b.p].some((p) => terrain(p[0], p[1]) > 140 || chainAt(p[0], p[1]).d < 5000);
    connect(P, a.p, b.p, high ? [C.tertiary, C.lane, steep] : [C.secondary, C.tertiary, C.lane, steep], 'Route du Tour du Grand Nord', 220);
  }
  // b. Grands axes depuis Valrobert, route des Gorges (Pont-de-Robine → Le Planay, au fond de la Robine).
  for (const to of ['port-boreal', 'vatnby', 'granlia', 'mille-lacs']) connect(P, G('nordrobert', to), G(to, 'nordrobert'), [C.secondary, C.tertiary, C.lane], routeTo(town(to).name));
  connect(P, G('mille-lacs', 'fossbru'), G('fossbru', 'mille-lacs'), [C.secondary, C.tertiary, C.lane], 'Route des Mille-Lacs');
  connect(P, G('fossbru', 'rennesby'), G('rennesby', 'fossbru'), [C.secondary, C.tertiary, C.lane, steep], 'Route des Gorges', 240);
  // c. Routes communales.
  const tert: Array<[string, string]> = [
    ['rennesby', 'nordrobert'], ['rennesby', 'vatnby'], ['vatnby', 'granlia'], ['skarvik', 'fossbru'],
    ['vidda', 'fossbru'], ['vidda', 'skarvik'], ['granlia', 'myrbu'],
  ];
  tert.push(['ferjeby', 'vidda'], ['utnes', 'vidda']);
  for (const [a, b] of tert) connect(P, G(a, b), G(b, a), [C.tertiary, C.lane, steep], routeTo(town(b).name), 200);
  // Pralong : la route de la station (lacets dessinés) descend jusqu'au pied, raccordé à Bellerive et Sainte-Marthe.
  const pb = gates.find((g) => g.town === 'fjellheim-bas')!.p;
  connect(P, pb, G('vatnby', pb), [C.tertiary, C.lane, steep], 'Route de Fjellheim', 200);
  connect(P, pb, G('granlia', pb), [C.tertiary, C.lane, steep], 'Route de Fjellheim', 200);
  // Lac de Robert : pas de tour complet (la rive nord, au pied de la chaîne, est trop raide) ; voie verte et routes au sud.
  const lake: Vec2[] = [];
  const anneauGate = (k: number) => gates.filter((g) => g.town === 'anneau')[k]!.p;
  connect(P, anneauGate(0), G('nordrobert', anneauGate(0)), [C.tertiary, C.lane, steep], 'Route du Circuit');
  connect(P, anneauGate(3), G('port-boreal', anneauGate(3)), [C.tertiary, C.lane, steep], 'Route du Circuit');
  connect(P, anneauGate(1), G('granlia', anneauGate(1)), [C.tertiary, C.lane, steep], 'Route du Circuit');
  // d. Col de l'Aigle (routes dessinées en lacets) : le pied du versant nord rejoint le réseau.
  const col = gates.find((g) => g.town === 'col')!.p;
  const foot = gates.find((g) => g.town === 'col-nord')!.p;
  if (!connect(P, foot, G('nordvik', foot), [{ ...C.tertiary, gmax: 0.1 }, steep], "Route du Col du Renne", 250)) {
    P.failed.pop();
    spur(P, foot, steep, 5, "Route du Col du Renne", 300);
  }
  // e. Pistes cyclables.
  const cyc = [C.cycleway, { ...C.cycleway, gmax: 0.06 }];
  connect(P, G('nordrobert', anneauGate(2)), anneauGate(2), cyc, 'La Piste du Circuit');
  connect(P, G('granlia', 'myrbu'), G('myrbu', 'granlia'), cyc, 'Voie verte de la Saumonée');
  connect(P, G('vatnby', 'nordrobert'), G('nordrobert', 'vatnby'), cyc, 'Voie verte du Grand Lac');
  // f. Chemins des fermes, puis maillage de petites routes.
  for (const f of farms) spur(P, f.gate, C.lane, 5, 'Chemin rural');
  meshRoads(P);
  for (let c = 0; c < P.grid.N; c++) P.grid.wob[c] = 1 + (P.grid.wob[c]! - 1) * TRACK_WOB;
  const r = rng(31337);
  const loopPts = (cx: number, cz: number, R: number, n: number, jit: number, r0 = r): Vec2[] =>
    Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2;
      const rr = R * (1 + (r0() - 0.5) * jit);
      return [cx + Math.cos(a) * rr * 1.3, cz + Math.sin(a) * rr] as Vec2;
    });
  const okPt = (p: Vec2) => {
    const c = P.grid.cellAt(p[0], p[1]);
    return !P.grid.water[c] && !P.grid.block[c];
  };
  const loopConnect = (pts: Vec2[], cls: RoadClass[], label: string) => {
    const good = pts.filter(okPt);
    for (let k = 0; k < good.length; k++) connect(P, good[k]!, good[(k + 1) % good.length]!, cls, label);
    if (good[0]) spur(P, good[0], cls[0]!, 5, label);
    if (good.length > 3) spur(P, good[Math.floor(good.length / 2)]!, cls[0]!, 5, label);
    return good;
  };
  // g. Gravel : chemin des Alpages (au-dessus de Pralong), chemin des Salins (autour de l'étang).
  const bois: Vec2[] = [];
  loopConnect(loopPts(LAKES[0]!.x, LAKES[0]!.z, 1500, 7, 0.3), [C.track], 'Chemin des Marais');
  // h. VTT : sentiers de chaque région (TRAILS).
  let mtb: Vec2[] = [];
  for (const [k0, t] of TRAILS.entries()) {
    const cls = t.mtb ? [C.mtb, { ...C.mtb, gmax: 0.24 }] : [C.track, { ...C.track, gmax: 0.16 }];
    if ('r' in t) {
      const good = loopConnect(loopPts(t.at[0], t.at[1], t.r, t.n, t.mtb ? 0.65 : 0.45, rng(7100 + k0 + (t.seed ?? 0))), cls, t.name);
      if (t.name === 'Sentier des Lemmings') mtb = good;
    } else {
      const pts = t.line.filter(okPt);
      const occ0 = new Set(pts.filter((p) => P.grid.occ[P.grid.cellAt(p[0], p[1])]! >= 5));
      for (let k = 0; k + 1 < pts.length; k++) connect(P, pts[k]!, pts[k + 1]!, cls, t.name);
      for (const p of [pts[0], pts[pts.length - 1]]) if (p && !occ0.has(p)) spur(P, p, cls[0]!, 5, t.name);
    }
  }
  return { ring: ring.map((q) => q.p), bois, mtb, col, foot, lake };
}

const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** « Route de Vidda », « Route des Mille-Lacs ». */
const routeTo = (name: string) => (name.startsWith('Les ') ? `Route des ${name.slice(4)}` : `Route de ${name}`);

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
export function networkRoads(grid: Grid, designed: Road[], gates: Array<{ p: Vec2; y: number }>, opts: { prefix?: string; rMax?: number; tol?: number; designed?: boolean } = {}): Road[] {
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
      const e = edges[k]!;
      // Tronçon qui ne touche pas le nœud courant (paire incohérente) : la chaîne s'arrête là, il en commencera une
      // autre (sinon la courbe sauterait d'un bout à l'autre, en ligne droite par-dessus le relief).
      if (ch.cells.length && e.cells[0] !== node && e.cells[e.cells.length - 1] !== node) break;
      seen.add(k);
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
  /**
   * Méandres : la courbe ondule de part et d'autre de son tracé (amplitude et longueur d'onde selon la catégorie), sans
   * bouger aux carrefours, près d'une autre route, de l'eau ou d'une emprise réservée, et moins à flanc de pente raide.
   */
  const meander = (d: Vec2[], own: ReadonlySet<number>, pins: ReadonlyArray<Vec2>, A: number, L: number, held?: Uint8Array): Vec2[] => {
    const n = d.length;
    if (n < 60 || A <= 0) return d;
    const free = new Float32Array(n).fill(1);
    const reach = Math.ceil((A + 26) / grid.cs);
    for (let i = 0; i < n; i++) {
      const c = grid.cellAt(d[i]![0], d[i]![1]);
      const ci = c % grid.n;
      const cj = Math.floor(c / grid.n);
      for (let dj = -reach; dj <= reach && free[i]; dj++)
        for (let di = -reach; di <= reach; di++) {
          const q = (cj + dj) * grid.n + ci + di;
          if (ci + di < 0 || cj + dj < 0 || ci + di >= grid.n || cj + dj >= grid.m) continue;
          if (grid.water[q] || grid.block[q] || (grid.occ[q] && !own.has(q))) {
            free[i] = 0;
            break;
          }
        }
      if (free[i] && i % 4 === 0) {
        const a = d[Math.max(0, i - 1)]!;
        const b = d[Math.min(n - 1, i + 1)]!;
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nx = -(b[1] - a[1]) / l;
        const nz = (b[0] - a[0]) / l;
        const cross = Math.abs(terrain(d[i]![0] + nx * A, d[i]![1] + nz * A) - terrain(d[i]![0] - nx * A, d[i]![1] - nz * A)) / (2 * A);
        if (cross > 0.16) for (let k = i; k < Math.min(n, i + 4); k++) free[k] = Math.min(free[k]!, 0.35);
      }
    }
    // Virage déjà marqué : il garde son dessin.
    for (let i = 12; i < n - 12; i++) {
      const t = Math.abs(Math.atan2(d[i + 12]![1] - d[i]![1], d[i + 12]![0] - d[i]![0]) - Math.atan2(d[i]![1] - d[i - 12]![1], d[i]![0] - d[i - 12]![0]));
      if (Math.min(t, 2 * Math.PI - t) > 0.4) for (let k = i - 10; k <= i + 10; k++) free[k] = Math.min(free[k]!, 0.1);
    }
    for (const p of pins) {
      let best = 0;
      for (let i = 1; i < n; i++) if (Math.hypot(d[i]![0] - p[0], d[i]![1] - p[1]) < Math.hypot(d[best]![0] - p[0], d[best]![1] - p[1])) best = i;
      for (let i = Math.max(0, best - 8); i <= Math.min(n - 1, best + 8); i++) free[i] = 0;
    }
    free[0] = free[n - 1] = 0;
    if (held) for (let i = 0; i < n; i++) if (held[i]) free[i] = 0;
    // Retour progressif (70 m) vers les points tenus, puis lissage.
    const ramp = 2 / 70;
    for (let i = 1; i < n; i++) free[i] = Math.min(free[i]!, free[i - 1]! + ramp);
    for (let i = n - 2; i >= 0; i--) free[i] = Math.min(free[i]!, free[i + 1]! + ramp);
    const smooth = (v: number) => v * v * (3 - 2 * v);
    const ph = (Math.abs(Math.round(d[0]![0] * 13 + d[0]![1] * 7)) % 628) / 100;
    return d.map(([x, z], i) => {
      const a = d[Math.max(0, i - 3)]!;
      const b = d[Math.min(n - 1, i + 3)]!;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const s = i * 2;
      const o = A * smooth(free[i]!) * (0.8 * Math.sin((2 * Math.PI * s) / L + ph + 1.1 * Math.sin((2 * Math.PI * s) / (L * 3.1) + ph * 2)) + 0.35 * Math.sin((2 * Math.PI * s) / (L * 1.9) + ph * 3));
      return [x - ((b[1] - a[1]) / l) * o, z + ((b[0] - a[0]) / l) * o] as Vec2;
    });
  };
  /**
   * Lignes droites : de loin en loin, 240 à 900 m d'une courbe qui s'écarte peu de sa corde deviennent droits, avec 70 m de
   * raccord à chaque bout (des virages partout donnaient le tournis). Jamais à travers un carrefour.
   */
  const straighten = (d: Vec2[], pins: ReadonlyArray<Vec2>): { pts: Vec2[]; held: Uint8Array } => {
    const n = d.length;
    const held = new Uint8Array(n);
    if (STRAIGHT_M <= 0 || n < 150) return { pts: d, held };
    // Versants du Phare : les lacets suivent la pente.
    if (d.some((p) => chainAt(p[0], p[1]).d < 2500 || Math.hypot(p[0] - MASSIF.mont[0], p[1] - MASSIF.mont[1]) < 4500 || Math.hypot(p[0] - MASSIF.phare[0], p[1] - MASSIF.phare[1]) < 4500)) return { pts: d, held };
    const busy = new Uint8Array(n);
    for (const p of pins) {
      let best = 0;
      for (let i = 1; i < n; i++) if (Math.hypot(d[i]![0] - p[0], d[i]![1] - p[1]) < Math.hypot(d[best]![0] - p[0], d[best]![1] - p[1])) best = i;
      for (let i = Math.max(0, best - 12); i <= Math.min(n - 1, best + 12); i++) busy[i] = 1;
    }
    const out = d.map((p) => [p[0], p[1]] as Vec2);
    const pick = rng(Math.abs(Math.round(d[0]![0] * 11 + d[0]![1] * 5)) % 100003);
    const R = 35;
    let i = 8 + Math.floor(pick() * 60);
    while (i + 120 < n) {
      let made = 0;
      for (let len = Math.min(n - 9 - i, Math.floor((300 + pick() * 600) / 2)); len >= 120 && !made; len -= 20) {
        const a = d[i]!;
        const b = d[i + len]!;
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        let ok = true;
        for (let k = i; ok && k <= i + len; k++) {
          const off = Math.abs((d[k]![0] - a[0]) * (b[1] - a[1]) - (d[k]![1] - a[1]) * (b[0] - a[0])) / L;
          if (busy[k] || off > STRAIGHT_M) ok = false;
          // Jamais en taillant dans une pente : la ligne droite reste à 3 m du relief de la courbe.
          if (ok && k % 5 === 0) {
            const t = (k - i) / len;
            if (Math.abs(terrain(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) - terrain(d[k]![0], d[k]![1])) > 3) ok = false;
          }
        }
        if (!ok) continue;
        for (let k = 1; k < len; k++) {
          const u = Math.min(1, k / R, (len - k) / R);
          const w = u * u * (3 - 2 * u);
          const t = k / len;
          const p = d[i + k]!;
          held[i + k] = 1;
          out[i + k] = [p[0] + (a[0] + (b[0] - a[0]) * t - p[0]) * w, p[1] + (a[1] + (b[1] - a[1]) * t - p[1]) * w];
        }
        made = len;
      }
      i += made ? made + 50 + Math.floor(pick() * 220) : 15;
    }
    return { pts: out, held };
  };
  const MEANDER: Record<string, [number, number]> = { secondary: [20, 400], tertiary: [20, 320], lane: [18, 240], cycleway: [11, 230], track: [13, 170], mtb: [8, 110] };
  // Lissage d'une chaîne : marches retirées, virages arrondis, puis points tous les 2 m ; position finale
  // des nœuds intérieurs (point le plus proche de la courbe).
  const moved = new Map<number, Vec2>();
  /**
   * Courbe d'une chaîne. `fixed` : nœuds intérieurs dont la position est déjà arrêtée (croisement d'une
   * route plus importante) : la courbe y passe exactement (lissage par morceaux entre ces points).
   */
  const shape = (ch: Chain, fixed: Map<number, Vec2> = new Map()) => {
    // Position arrêtée ou provisoire d'un carrefour, seulement si elle reste près de sa case (en montagne, la recherche
    // du point le plus proche sur une courbe repliée peut renvoyer un point lointain : ligne droite par-dessus le relief).
    const placed = (c: number): Vec2 => {
      const o = grid.center(c);
      const q = fixed.get(c) ?? moved.get(c);
      return q && Math.hypot(q[0] - o[0], q[1] - o[1]) < 45 ? q : o;
    };
    const pts = ch.cells.map(placed);
    if (process.env.ISLAND_DEBUG) for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]) > 80) console.log(`   · saut de ${Math.round(Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]))} m dans une chaîne à ${pts[i - 1]!.map(Math.round).join(',')} → ${pts[i]!.map(Math.round).join(',')} (fixé ${fixed.has(ch.cells[i]!)}, déplacé ${moved.has(ch.cells[i]!)}) ; arêtes ${ch.edges.map(({ k, fwd }) => `${fwd ? '→' : '←'}[${grid.center(edges[k]!.cells[0]!).map(Math.round)}…${grid.center(edges[k]!.cells[edges[k]!.cells.length - 1]!).map(Math.round)} n=${edges[k]!.cells.length}]`).join(' ')} ; i=${i}/${pts.length}`);
    const R = Math.min(opts.rMax ?? Infinity, Math.max(...ch.edges.map(({ k }) => R_OF[CLASS_BY_RANK[edges[k]!.rank]!.id] ?? 12)));
    // Tolérance de simplification : plus large pour les grandes routes (côtés plus longs, virages plus amples).
    const tol = opts.tol ?? Math.max(...ch.edges.map(({ k }) => ({ secondary: 10, tertiary: 9, lane: 8, cycleway: 8, track: 6, mtb: 5 })[CLASS_BY_RANK[edges[k]!.rank]!.id] ?? 7));
    const hard = [0, ...ch.inner.filter((n) => fixed.has(n.c)).map((n) => n.at), pts.length - 1];
    const own = new Set(ch.cells);
    const [amp, wave] = opts.designed ? [0, 1] : MEANDER[CLASS_BY_RANK[Math.max(...ch.edges.map(({ k }) => edges[k]!.rank))]!.id] ?? [0, 1];
    const pins = ch.inner.map((n) => pts[n.at]!);
    const dense: Vec2[] = [];
    const hardAt = new Map<number, number>();
    for (let t = 0; t + 1 < hard.length; t++) {
      const seg = pts.slice(hard[t]!, hard[t + 1]! + 1);
      const curved = (b: Vec2[]) => {
        const s = straighten(b, pins);
        return meander(s.pts, own, pins, amp * MEANDER_K, wave, s.held);
      };
      const base = seg.length >= 2 ? resample(chaikin(fillet(simplifyPath(seg, tol), R), 2), 2) : seg;
      const d = seg.length >= 2 ? resample(opts.designed ? base : curved(base), 2) : seg;
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
  // Bout posé sur une route dessinée (col, station : en déblai ou en remblai) : à son altitude, pas à celle du terrain.
  const onDesigned = (p: Vec2): number | undefined => {
    let best: number | undefined;
    let bd = 6;
    for (const r of designed) {
      for (const q of r.pts) {
        const d = Math.hypot(q[0] - p[0], q[2] - p[1]);
        if (d < bd) {
          bd = d;
          best = q[1];
        }
      }
    }
    return best;
  };
  const endY = (p: Vec2) => {
    const y = gateY.get(`${p[0].toFixed(2)},${p[1].toFixed(2)}`) ?? onDesigned(p) ?? nodeHeight(p[0], p[1]);
    if (!Number.isFinite(y)) console.log(`   · altitude invalide au bout ${p.map(Math.round).join(',')} (gate ${gateY.get(`${p[0].toFixed(2)},${p[1].toFixed(2)}`)}, route ${onDesigned(p)}, sol ${nodeHeight(p[0], p[1])})`);
    return y;
  };
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
      // Pente plafond : celle de la catégorie, ou celle du relief le long du tracé s'il est plus raide (une route qui
      // franchit une épaule de montagne la suit au lieu de passer dessous), 16 % au plus.
      let steepest = 0;
      for (let i = 0; i + 15 < xz.length; i += 5) steepest = Math.max(steepest, Math.abs(terrain(xz[i + 15]![0], xz[i + 15]![1]) - terrain(xz[i]![0], xz[i]![1])) / 30);
      const skins = cls.kind === 'track' ? SKIN[e.label ?? ''] : undefined;
      const nth = counts.get(`·${e.label}`) ?? 0;
      if (skins) counts.set(`·${e.label}`, nth + 1);
      const [surface, width] = skins ? skins[nth % skins.length]! : [cls.surface, cls.width];
      // Plafond un peu sous les limites des contrôles (route 17 %, chemin gravel 20 %, sentier 27 %, mesurées sur 10 m).
      const cap = Math.min(cls.kind === 'track' ? (GRAVELLY.has(surface) ? 0.185 : 0.26) : cls.kind === 'cycleway' ? 0.05 : 0.145, Math.max(cls.gmax + 0.005, steepest * 1.05));
      const y = profile(xz, false, cls.id === 'track' ? 24 : cls.id === 'mtb' ? 40 : 30, cap, endY(xz[0]!), endY(xz[xz.length - 1]!));
      const n = (counts.get(cls.id) ?? 0) + 1;
      counts.set(cls.id, n);
      out.push({
        id: `${opts.prefix ?? ''}${cls.id}-${n}`,
        ...(opts.designed ? { designed: true } : {}),
        name: e.label || cls.id,
        kind: cls.kind,
        width,
        surface,
        loop: false,
        pts: xz.map(([x, z], j) => [x, y[j]!, z]),
        flat: width / 2 + (cls.kind === 'track' ? 0.8 : 1.5),
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
  return out;
}

// ── 4. Itinéraires ──

export function routeSpecs(net: { ring: Vec2[]; bois: Vec2[]; mtb: Vec2[]; col: Vec2; foot: Vec2; lake: Vec2[]; pralongBas: Vec2 }): RouteSpec[] {
  const t = (id: string): Vec2 => {
    const q = TOWNS.find((x) => x.id === id)!;
    return [q.x, q.z];
  };
  const L = (name: string, p: Vec2) => ({ name, x: p[0], z: p[1] });
  const pa = TOWNS.find((x) => x.id === 'port-boreal')!;
  const ang = Math.atan2(pa.z, pa.x);
  const east = ang - 0.055;
  const west = ang + 0.145;
  // Rues de derrière de Nordrobert (critérium).
  const vr = TOWNS.find((x) => x.id === 'nordrobert')!;
  const u: Vec2 = [Math.cos(vr.angle), Math.sin(vr.angle)];
  const v: Vec2 = [-u[1], u[0]];
  const V = (a: number, b: number): Vec2 => [vr.x + (a * u[0] + b * v[0]) * vr.r, vr.z + (a * u[1] + b * v[1]) * vr.r];
  const lake = LAKES.find((l) => l.id === 'lac-de-robert')!;
  const glacierFront: Vec2 = [(GLACIER.to[0] + GLACIER.head[0]) / 2, (GLACIER.to[1] + GLACIER.head[1]) / 2];
  return [
    // Découverte (≈ 8 km, en tête de liste) : de Nordrobert au Circuit par la piste et la route du Circuit.
    { id: 'decouverte-du-grand-nord', name: 'Découverte du Grand Nord', nameEn: 'Far North discovery ride', loop: true, mode: 'road', waypoints: [t('nordrobert'), [-4200, 1800], [-3600, 2900]], landmarks: [L('Nordrobert', t('nordrobert')), L('Église de Nordrobert', V(0.1, -0.1))] },
    // Classiques et chrono.
    { id: 'classique-des-fjords', name: 'La Classique des Fjords', nameEn: 'Fjords Classic', loop: false, mode: 'road', waypoints: [t('port-boreal'), t('mille-lacs'), t('nordrobert'), t('vatnby'), t('rennesby'), net.col, t('isbrevik')], hairpins: true, climbNames: ['Col du Renne'], sprints: [{ name: 'Sprint des Mille-Lacs', x: t('mille-lacs')[0], z: t('mille-lacs')[1] }, { name: 'Sprint de Vatnby', x: t('vatnby')[0], z: t('vatnby')[1] }], landmarks: [L('Port-Boréal', t('port-boreal')), L('Les Mille-Lacs', t('mille-lacs')), L('Nordrobert', t('nordrobert')), L('Le Grand Lac', [lake.x, lake.z]), L('Col du Renne', net.col), L('Fjord du Glacier', glacierFront), L('Isbrevik', t('isbrevik'))] },
    { id: 'chrono-du-fjord', name: 'Le chrono du Fjord', nameEn: 'Fjord time trial', loop: false, mode: 'road', waypoints: [t('nordvik'), t('isbrevik')], landmarks: [L('Nordvik', t('nordvik')), L('Isbrevik', t('isbrevik')), L('Fjord du Glacier', glacierFront)] },
    { id: 'aurores-de-nuit', name: 'Les Aurores de nuit', nameEn: 'Northern lights night climb', loop: false, mode: 'road', waypoints: [t('rennesby'), MASSIF.phare], hairpins: true, climbNames: ['Montée du Belvédère des Aurores'], landmarks: [L('Rennesby', t('rennesby')), L('Belvédère des Aurores', MASSIF.phare)] },
    // Route.
    { id: 'col-du-renne', name: 'La traversée du Col du Renne', nameEn: 'Reindeer pass traverse', loop: false, mode: 'road', waypoints: [t('rennesby'), net.col, net.foot], hairpins: true, climbNames: ['Col du Renne, versant sud'], landmarks: [L('Rennesby', t('rennesby')), L('Col du Renne', net.col), L('Vallée de la Vik', net.foot)] },
    { id: 'col-du-renne-par-nordvik', name: 'Le Col du Renne par Nordvik', nameEn: 'Reindeer pass from the north', loop: false, mode: 'road', waypoints: [net.foot, net.col, t('rennesby')], hairpins: true, climbNames: ['Col du Renne, versant nord'], landmarks: [L('Vallée de la Vik', net.foot), L('Col du Renne', net.col), L('Rennesby', t('rennesby'))] },
    { id: 'montee-de-fjellheim', name: 'La montée de Fjellheim', nameEn: 'Fjellheim climb', loop: false, mode: 'road', waypoints: [net.pralongBas, [-8469, -5096]], hairpins: true, climbNames: ['Montée de Fjellheim'], landmarks: [L('Fjellheim', t('fjellheim')), L('Lac de Fjellheim', [-8950, -5850])] },
    { id: 'gorges-de-la-renne', name: 'Les gorges de la Renne', nameEn: 'Renne gorges', loop: false, mode: 'road', waypoints: [t('fossbru'), [6900, -300], t('rennesby')], landmarks: [L('Fossbru', t('fossbru')), L('Les Gorges', [6900, -300]), L('Rennesby', t('rennesby'))] },
    { id: 'tour-du-grand-nord', name: 'Le Tour du Grand Nord', nameEn: 'Round the Far North', loop: true, mode: 'road', waypoints: [t('port-boreal'), t('myrbu'), t('granlia'), t('vatnby'), t('rennesby'), t('fossbru'), t('vidda'), t('utnes'), t('skarvik')], sprints: [{ name: 'Sprint de Granlia', x: t('granlia')[0], z: t('granlia')[1] }, { name: 'Sprint de Port-Boréal', x: t('port-boreal')[0], z: t('port-boreal')[1] }], landmarks: TOWNS.filter((x) => ['port-boreal', 'myrbu', 'granlia', 'vatnby', 'rennesby', 'vidda', 'utnes', 'skarvik'].includes(x.id)).map((x) => L(x.name, [x.x, x.z])) },
    { id: 'grand-tour-du-col', name: 'De Nordrobert à Nordvik par le col', nameEn: 'Nordrobert to Nordvik over the pass', loop: false, mode: 'road', waypoints: [t('nordrobert'), t('rennesby'), net.col, t('nordvik')], hairpins: true, climbNames: ['Col du Renne'], landmarks: [L('Nordrobert', t('nordrobert')), L('Col du Renne', net.col), L('Nordvik', t('nordvik'))] },
    { id: 'criterium-de-nordrobert', name: 'Le critérium de Nordrobert', nameEn: 'Nordrobert criterium', loop: true, mode: 'road', waypoints: [V(-0.55, -0.36), V(0.55, -0.36), V(0.55, 0.36), V(-0.55, 0.36)], sprints: [{ name: 'Sprint de la Grand-Rue', x: V(0.3, 0)[0], z: V(0.3, 0)[1] }], landmarks: [L('Place de Nordrobert', t('nordrobert'))] },
    { id: 'boucle-de-nordrobert', name: 'La boucle de Nordrobert', nameEn: 'Nordrobert loop', loop: true, mode: 'road', waypoints: [t('nordrobert'), ANNEAU_GATES[0]!, ANNEAU_GATES[3]!, t('mille-lacs')], sprints: [{ name: 'Sprint des Mille-Lacs', x: t('mille-lacs')[0], z: t('mille-lacs')[1] }], landmarks: [L('Nordrobert', t('nordrobert')), L('Circuit du Grand Nord', [ANNEAU.cx, ANNEAU.cz]), L('Les Mille-Lacs', t('mille-lacs'))] },
    { id: 'route-des-pecheurs', name: 'La route des Pêcheurs', nameEn: 'Fishermen’s road', loop: true, mode: 'road', waypoints: [t('port-boreal'), t('skarvik'), t('mille-lacs')], sprints: [{ name: 'Sprint de Skarvik', x: t('skarvik')[0], z: t('skarvik')[1] }], landmarks: [L('Port-Boréal', t('port-boreal')), L('Skarvik', t('skarvik')), L('Les Mille-Lacs', t('mille-lacs'))] },
    { id: 'haut-plateau-de-vidda', name: 'Le haut-plateau de Vidda', nameEn: 'Vidda high plateau', loop: true, mode: 'road', waypoints: [t('vidda'), t('skarvik'), t('fossbru')], landmarks: [L('Vidda', t('vidda')), L('Station météo de Vidda', [12700, -1700]), L('Fossbru', t('fossbru'))] },
    { id: 'baie-et-mille-lacs', name: 'La baie et les Mille-Lacs', nameEn: 'Bay and thousand lakes', loop: true, mode: 'road', waypoints: [t('port-boreal'), t('mille-lacs'), t('nordrobert')], sprints: [{ name: 'Sprint des Bouleaux', x: coastPoint(ang, 800)[0], z: coastPoint(ang, 800)[1] }], landmarks: [L('Port-Boréal', t('port-boreal')), L('Cabane des Mille-Lacs', [4700, 4800])] },
    { id: 'marais-de-myrbu', name: 'Les marais de Myrbu', nameEn: 'Myrbu marshes', loop: true, mode: 'road', waypoints: [t('granlia'), t('myrbu'), ANNEAU_GATES[1]!], landmarks: [L('Granlia', t('granlia')), L('Lagune des Cygnes', [LAKES[0]!.x, LAKES[0]!.z]), L('Myrbu', t('myrbu'))] },
    { id: 'route-du-bac', name: 'La route du Bac', nameEn: 'Ferry road', loop: false, mode: 'road', waypoints: [t('vidda'), t('utnes')], landmarks: [L('Vidda', t('vidda')), L('Embarcadère d’Utnes', t('utnes'))] },
    { id: 'chrono-de-la-saumonee', name: 'Le chrono de la Saumonée', nameEn: 'Salmon river time trial', loop: false, mode: 'road', waypoints: [t('nordrobert'), t('granlia')], landmarks: [L('Nordrobert', t('nordrobert')), L('Granlia', t('granlia'))] },
    // Pistes cyclables et voies vertes.
    { id: 'promenade-de-port-boreal', name: 'La promenade de Port-Boréal', nameEn: 'Port-Boréal boardwalk', loop: true, mode: 'cycle', waypoints: [coastPoint(east + 0.006, 185), coastPoint(east + 0.006, 125), coastPoint(west - 0.006, 125), coastPoint(west - 0.006, 185), coastPoint(ang, 480)], sprints: [{ name: 'Sprint de la Promenade', x: coastPoint(ang + 0.1, 125)[0], z: coastPoint(ang + 0.1, 125)[1], lengthM: 400 }], landmarks: [L('La Promenade', coastPoint(ang, 125)), L('Halle aux poissons', coastPoint(ang + 0.018, 230))] },
    { id: 'piste-du-circuit', name: 'La piste du Circuit', nameEn: 'Circuit cycleway', loop: true, mode: 'cycle', waypoints: [t('nordrobert'), ANNEAU_GATES[2]!, ANNEAU_GATES[0]!], landmarks: [L('Circuit du Grand Nord', [ANNEAU.cx, ANNEAU.cz]), L('Nordrobert', t('nordrobert'))] },
    { id: 'voie-verte-de-la-saumonee', name: 'La voie verte de la Saumonée', nameEn: 'Salmon river greenway', loop: false, mode: 'cycle', waypoints: [t('granlia'), t('myrbu')], landmarks: [L('Myrbu', t('myrbu'))] },
    { id: 'voie-verte-du-grand-lac', name: 'La voie verte du Grand Lac', nameEn: 'Great lake greenway', loop: false, mode: 'cycle', waypoints: [t('nordrobert'), t('vatnby')], landmarks: [L('Vatnby', t('vatnby')), L('Le Grand Lac', [lake.x, lake.z])] },
    { id: 'velo-de-la-baie', name: 'La Vélo de la Baie', nameEn: 'Bay greenway', loop: false, mode: 'cycle', waypoints: [t('port-boreal'), t('mille-lacs')], landmarks: [L('Les Mille-Lacs', t('mille-lacs'))] },
    // Gravel.
    { id: 'classique-de-la-toundra', name: 'La Classique de la Toundra', nameEn: 'Tundra Classic', loop: false, mode: 'gravel', bike: 'gravel', waypoints: [[-10600, 3600], [-8200, 5600], [-5200, 6000], [-2200, 6300], [1200, 7300], t('mille-lacs')], sprints: [{ name: 'Sprint de la Toundra', x: -5200, z: 6000 }], landmarks: [L('Granlia', t('granlia')), L('La Toundra', [-5200, 6000]), L('Les Mille-Lacs', t('mille-lacs'))] },
    { id: 'gravel-de-vidda', name: 'Gravel de Vidda', nameEn: 'Vidda gravel', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Chemin de Vidda', landmarks: [L('Haut-plateau de Vidda', [11000, 600])] },
    { id: 'gravel-des-mille-lacs', name: 'Gravel des Mille-Lacs', nameEn: 'Thousand lakes gravel', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Chemin des Mille-Lacs', landmarks: [L('Cabane des Mille-Lacs', [4700, 4800])] },
    { id: 'gravel-de-la-saumonee', name: 'Gravel de la Saumonée', nameEn: 'Salmon river gravel', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Chemin de la Saumonée', landmarks: [L('Delta de la Saumonée', [-13300, 2600])] },
    { id: 'vtt-des-bouleaux', name: 'VTT des Bouleaux', nameEn: 'Birch MTB trail', loop: true, mode: 'mtb', bike: 'mtb', waypoints: [], along: 'Sentier des Bouleaux', landmarks: [L('Les Bouleaux', [-900, -4200])] },
    { id: 'gravel-des-marais', name: 'Gravel des Marais', nameEn: 'Marsh gravel', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Chemin des Marais', landmarks: [L('Lagune des Cygnes', [LAKES[0]!.x, LAKES[0]!.z])] },
    { id: 'chemin-des-pecheurs', name: 'Le chemin des Pêcheurs', nameEn: 'Fishermen’s path', loop: false, mode: 'gravel', bike: 'gravel', waypoints: [coastPoint(0.52, 210), coastPoint(0.74, 210), coastPoint(0.95, 210)], landmarks: [L('Skarvik', t('skarvik'))] },
    { id: 'chemin-des-galets', name: 'Le chemin des Galets', nameEn: 'Pebble point path', loop: false, mode: 'gravel', bike: 'gravel', waypoints: [coastPoint(2.12, 280), coastPoint(2.5, 280)], landmarks: [L('Pointe des Galets', coastPoint(2.32, 300))] },
    { id: 'cyclo-cross-de-la-toundra', name: 'Le cyclo-cross de la Toundra', nameEn: 'Tundra cyclocross', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Cyclo-cross de la Toundra', landmarks: [L('Cyclo-cross', [5000, 4300])] },
    // VTT.
    { id: 'vtt-des-lemmings', name: 'VTT des Lemmings', nameEn: 'Lemming MTB trail', loop: false, mode: 'mtb', bike: 'mtb', waypoints: [[-7590, -7130], [-8413, -6849], [-8450, -6310], [-7708, -5550], [-7910, -4989]], landmarks: [L('Les Lemmings', [-7600, -6300])] },
    { id: 'vtt-de-la-dent-du-renne', name: 'VTT de la Dent du Renne', nameEn: 'Reindeer tooth MTB loop', loop: true, mode: 'mtb', bike: 'mtb', waypoints: [], along: 'Sentier de la Dent du Renne', landmarks: [L('Dent du Renne', MASSIF.mont)] },
    { id: 'descente-du-renne', name: 'La descente du Renne', nameEn: 'Reindeer downhill', loop: false, mode: 'mtb', bike: 'mtb', waypoints: [[3100, -5300], [2200, -3300]], sprints: [{ name: 'Chrono de la descente', x: 2200, z: -3300, lengthM: 1500 }], landmarks: [L('Balcon du Renne', [3100, -5300]), L('Rennesby', t('rennesby'))] },
    { id: 'vtt-des-gorges', name: 'VTT des Gorges', nameEn: 'Gorges MTB trail', loop: true, mode: 'mtb', bike: 'mtb', waypoints: [], along: 'Sentier des Gorges', landmarks: [L('Les Gorges', [7000, -300])] },
    { id: 'vtt-de-skarvik', name: 'VTT de Skarvik', nameEn: 'Skarvik MTB trail', loop: true, mode: 'mtb', bike: 'mtb', waypoints: [], along: 'Sentier de Skarvik', landmarks: [L('Landes de Skarvik', [9300, 7500])] },
    { id: 'vtt-du-grand-lac', name: 'VTT du Grand Lac', nameEn: 'Great lake MTB trail', loop: true, mode: 'mtb', bike: 'mtb', waypoints: [], along: 'Sentier du Grand Lac', landmarks: [L('Le Grand Lac', [lake.x, lake.z])] },
    { id: 'bike-park-de-fjellheim', name: 'Le bike park de Fjellheim', nameEn: 'Fjellheim bike park', loop: false, mode: 'mtb', bike: 'mtb', waypoints: [[-7270, -5110], [-7830, -5170], [-7910, -4989], [-7148, -4687]], landmarks: [L('Bike park', [-7650, -4750])] },
  ];
}

/** Défaut d'un itinéraire selon les règles de verify.ts (marche, pente sur 10 m, demi-tour) ; null s'il est bon. */
export function routeFlaw(r: RouteData): string | null {
  const P = r.points;
  const n = P.length;
  const stepLim = r.bike === 'mtb' ? 1.0 : r.bike === 'gravel' ? 0.8 : 0.65;
  for (let i = 1; i < n; i++) if (Math.abs(P[i]!.y - P[i - 1]!.y) > stepLim) return `marche de ${Math.round(Math.abs(P[i]!.y - P[i - 1]!.y) * 100)} cm à ${Math.round(P[i]!.x)}, ${Math.round(P[i]!.z)}`;
  const lim = r.bike === 'mtb' ? 0.3 : r.bike === 'gravel' ? 0.23 : 0.17;
  for (let i = 0; i < n; i++) {
    let j = i;
    while (j < n - 1 && P[j]!.d - P[i]!.d < 10) j++;
    const dd = P[j]!.d - P[i]!.d;
    if (dd < 8) break;
    const g = Math.abs(P[j]!.y - P[i]!.y) / dd;
    if (g > lim) return `pente ${(g * 100).toFixed(1)} % à ${Math.round(P[i]!.x)}, ${Math.round(P[i]!.z)}`;
  }
  const get = (i: number) => P[r.loop ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))]!;
  for (let i = 0; i < n; i++) {
    const a = get(i - 3);
    const b = get(i);
    const c = get(i + 3);
    if (a === b || b === c) continue;
    let t = Math.abs(Math.atan2(c.z - b.z, c.x - b.x) - Math.atan2(b.z - a.z, b.x - a.x));
    if (t > Math.PI) t = 2 * Math.PI - t;
    if (t > (150 * Math.PI) / 180) return `demi-tour à ${Math.round(b.x)}, ${Math.round(b.z)}`;
  }
  return null;
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
  const quays = portRoads([...D.roads, ...netRoads]);
  const kept = pruneMesh([...D.roads, ...netRoads, ...quays], false);
  joinCrossings(kept);
  const roads = pruneMesh(kept, true);
  log(`maillage : ${D.roads.length + netRoads.length + quays.length - roads.length} tronçons écartés`);
  const nx = joinCrossings(roads);
  for (let pass = 0; pass < 3; pass++) {
    if (pass) smoothProfiles(roads);
    const xs = joinCrossings(roads);
    log(`${xs} croisements, ${unifyEnds(roads)} raccords mis au même niveau, ${cleanRoads(roads)} points retirés`);
  }
  {
    // Creux de plus de 10 cm sur 16 m (contrôle à 12 cm) : le point bas est remonté, jamais aux carrefours ni aux bouts.
    const count = new Map<string, number>();
    const key = (p: Vec3) => `${Math.round(p[0] * 20)}_${Math.round(p[2] * 20)}`;
    for (const r of roads) for (const p of r.pts) count.set(key(p), (count.get(key(p)) ?? 0) + 1);
    let lifted = 0;
    for (const r of roads) {
      if (r.loop || r.id === 'anneau') continue;
      const n = r.pts.length;
      const locked = r.pts.map((p, i) => i < 2 || i >= n - 2 || (count.get(key(p)) ?? 0) > 1);
      for (let it = 0; it < 30; it++) {
        let ch = false;
        for (let i = 4; i < n - 4; i++) {
          const sag = (r.pts[i - 4]![1] + r.pts[i + 4]![1]) / 2 - r.pts[i]![1];
          if (sag <= 0.07) continue;
          if (!locked[i]) r.pts[i]![1] += sag - 0.06;
          else {
            // Point bas tenu (carrefour) : ce sont ses voisins qui descendent un peu.
            for (const j of [i - 4, i + 4]) if (!locked[j]) r.pts[j]![1] -= sag - 0.06;
            for (const j of [i - 3, i - 2, i - 1, i + 1, i + 2, i + 3]) if (!locked[j]) r.pts[j]![1] = Math.min(r.pts[j]![1], r.pts[i]![1] + ((r.pts[j < i ? i - 4 : i + 4]![1] - r.pts[i]![1]) * Math.abs(j - i)) / 4 + 0.03);
          }
          ch = true;
          lifted++;
        }
        if (!ch) break;
      }
    }
    // Bouts libres des chemins (culs-de-sac) : 4 cm plus haut, le sol arrondi du bout ne dépasse pas la chaussée.
    for (const r of roads) {
      if (r.kind !== 'track' || r.loop) continue;
      for (const [i, j] of [[0, 1], [r.pts.length - 1, r.pts.length - 2]] as const) if ((count.get(key(r.pts[i]!)) ?? 0) === 1) {
        r.pts[i]![1] += 0.04;
        r.pts[j]![1] += 0.02;
      }
    }
    log(`${lifted} points remontés (creux)`);
    if (process.env.ISLAND_DEBUG_SAG) for (const r of roads) for (let i = 4; i + 4 < r.pts.length; i++) {
      const sag = (r.pts[i - 4]![1] + r.pts[i + 4]![1]) / 2 - r.pts[i]![1];
      if (sag > 0.11) console.log(`   · creux ${r.name} ${Math.round(r.pts[i]![0])},${Math.round(r.pts[i]![2])} ${(sag * 100).toFixed(0)} cm i=${i}/${r.pts.length} verrou=${count.get(key(r.pts[i]!))}`);
    }
  }
  log(`${roads.length} routes (${netRoads.length} tracées), ${(roads.reduce((s, r) => s + r.pts.length * 2, 0) / 1000).toFixed(0)} km, ${nx} croisements`);

  const idx = new RoadIndex(roads);
  const B = new Builder(idx);
  D.layouts.forEach((lay, k) => {
    townCentre(B, lay, k);
    if (lay.town.seaside) seasideBuildings(B, lay);
  });
  landmarks(B);
  for (const h of HARBOURS) B.places.push({ name: h.name, kind: 'locality', x: h.x, z: h.z });
  // Maisons des rues.
  const byTown = new Map(D.layouts.map((l) => [l.town.id, l]));
  for (const r of [...D.roads, ...quays]) {
    const tid = TOWNS.find((t) => r.id.startsWith(`${t.id}-`));
    if (!tid) continue;
    const lay = byTown.get(tid.id)!;
    const t = lay.town;
    if (r.kind === 'cycleway') continue;
    const inside = (x: number, z: number) => Math.hypot(x - t.x, z - t.z) < t.r * (t.seaside ? 2 : 1.15);
    const palette = t.seaside ? 'villa' : t.level > 300 ? 'chalet' : t.id === 'nordvik' ? 'breton' : t.z > 0 || t.x > 6000 ? 'provence' : 'village';
    const core = t.size === 'ville' || t.size === 'bourg';
    B.street(r, { spacing: core ? 13 : 16, setback: core ? 3 : 4.5, depth: [8, 12], len: [8, 13], levels: core ? [2, 3] : [1, 2], palette, inside, seed: r.id.length * 131 + Math.round(t.x), apartments: core ? 0.15 : 0, ...(r.id.endsWith('boulevard') ? { sides: [1] } : r.id.endsWith('-quai') ? { sides: [-1] } : {}) });
  }
  farmBuildings(B, farms);
  roadsideHouses(B, netRoads.filter((r) => roads.includes(r)));
  log(`${B.out.length} bâtiments`);

  // Sols : parcelles, plages, eau.
  const ctx: LandCtx = { farms: farms.map((f) => [f.x, f.z]) };
  const rv = TOWNS.find((t) => t.seaside)!;
  const rvAng = Math.atan2(rv.z, rv.x);
  const nearSeaside = (x: number, z: number) => Math.abs(angle(Math.atan2(z, x) - rvAng - 0.045)) < 0.12 && shoreDist(x, z) < 2200;
  const fields = parcels(ctx, nearSeaside);
  const shore = shoreAreas((x, z) => Math.abs(angle(Math.atan2(z, x) - rvAng - 0.045)) < 0.11);
  // Glacier de Robert : langue de glace (carte et sol), sans arbres ni parcelles.
  const ice: Vec2[] = [];
  {
    const [ax, az] = GLACIER.from;
    const [bx, bz] = GLACIER.to;
    const L = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / L;
    const uz = (bz - az) / L;
    const n = 24;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const w = GLACIER.half * (1 - 0.35 * t);
      ice.push([ax + (bx - ax) * t - uz * w, az + (bz - az) * t + ux * w]);
    }
    for (let k = n; k >= 0; k--) {
      const t = k / n;
      const w = GLACIER.half * (1 - 0.35 * t);
      ice.push([ax + (bx - ax) * t + uz * w, az + (bz - az) * t - ux * w]);
    }
  }
  const areas: Area[] = [...B.areas, ...fields.filter((a) => !a.ring.some(([x, z]) => inGlacier(x, z, 30))), ...shore, { id: 'glacier', kind: 'glacier', layer: 'fields', ring: ice, name: 'Glacier de Robert' }];
  const water = lakes();
  const ways = waterways((x, z) => idx.edgeDist(x, z) < 8);
  log(`${fields.length} parcelles, ${shore.length} morceaux de plage, ${water.length} plans d'eau, ${ways.length} cours d'eau`);

  // Graphe et itinéraires.
  const graph = buildGraph(roads);
  writeFileSync(join(OUT, 'graph.json'), JSON.stringify(graph));
  if (process.env.ISLAND_DEBUG_SAG)
    for (const e of graph.edges)
      for (let i = 4; i + 4 < e.pts.length / 3; i++) {
        const sag = (e.pts[(i - 4) * 3 + 1]! + e.pts[(i + 4) * 3 + 1]!) / 2 - e.pts[i * 3 + 1]!;
        if (sag > 0.12) console.log(`   · creux du graphe ${e.name} ${Math.round(e.pts[i * 3]!)},${Math.round(e.pts[i * 3 + 2]!)} ${(sag * 100).toFixed(0)} cm`);
      }
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
  routes.push({ id: 'anneau', name: 'Le Circuit du Grand Nord', nameEn: 'Far North circuit', loop: true, lengthM: r2(anLen), elevationGainM: 0, points: anPoints, segments: timedSegments({ id: 'anneau', sprints: [{ name: 'Sprint de la ligne opposée', x: ANNEAU.cx + 60, z: ANNEAU.cz - ANNEAU.radius, lengthM: 400 }, { name: 'Sprint des Tribunes', x: ANNEAU.cx + 30, z: ANNEAU.cz + ANNEAU.radius, lengthM: 400 }] }, { points: anPoints, lengthM: r2(anLen) } as RouteData), roadWidthM: ANNEAU.widthM, attribution: ATTRIBUTION, roadWidths: [{ startM: 0, endM: r2(anLen), widthM: ANNEAU.widthM }], surfaces: [{ startM: 0, endM: r2(anLen), surface: 'asphalt' }], landmarks: [{ name: 'Tribunes', d: 0 }], stepM: 2, minElevationM: ANNEAU.level, maxElevationM: ANNEAU.level, maxGradePct: 0, markings: 'full' });
  const netPts = { ...net, pralongBas: D.gates.find((g) => g.town === 'fjellheim-bas')!.p };
  // Tracé seul : points du réseau gardés pour la mise au point des itinéraires (sans refaire le tracé).
  if (process.env.ISLAND_PLAN) writeFileSync(join(OUT, 'net.json'), JSON.stringify(netPts));
  for (const spec of routeSpecs(netPts)) {
    // Longue boucle : si un point de passage oblige à un demi-tour, un point sur deux, puis sur trois.
    // Point de passage qui oblige à un demi-tour : un point sur deux, sur trois, ou l'un des points retiré.
    const tries: RouteSpec[] = [spec, ...[2, 3].filter(() => spec.waypoints.length > 6).map((step) => ({ ...spec, waypoints: spec.waypoints.filter((_, k) => k % step === 0) })), ...spec.waypoints.slice(1).map((_, i) => ({ ...spec, waypoints: spec.waypoints.filter((__, k) => k !== i + 1) }))];
    let r: RouteData | null = null;
    let flaw: string | null = 'impossible';
    for (const t of tries) {
      const got = planRoute(graph, t);
      if (!got) continue;
      const why = routeFlaw(got);
      if (!r || (flaw && !why)) {
        r = got;
        flaw = why;
      }
      if (!why) break;
    }
    if (!r) {
      console.log(`   · itinéraire impossible : ${spec.id}`);
      continue;
    }
    if (flaw) {
      console.log(`   · itinéraire écarté : ${spec.id} (${flaw})`);
      continue;
    }
    routes.push(r);
  }
  for (const r of routes) writeFileSync(join(OUT, 'routes', `${r.id}.json`), JSON.stringify(encodeRoute(r)));
  for (const r of routes) log(`  ${r.id} : ${(r.lengthM / 1000).toFixed(1)} km, D+ ${r.elevationGainM.toFixed(0)} m, pente max ${r.maxGradePct} %, ${r.segments.map((s) => `${s.kind} « ${s.name} » ${(s.endM - s.startM).toFixed(0)} m`).join(', ') || 'aucun segment'}${r.hairpins?.length ? `, ${r.hairpins.length} lacets` : ''}`);

  // Réglage du relief : ISLAND_PLAN=1 s'arrête au tracé (30 s).
  if (process.env.ISLAND_PLAN) return log('tracé seul');
  // Tuiles : altitudes et bois en parallèle, entités ici.
  const tiles: Array<{ id: string; tx: number; tz: number }> = [];
  for (let tx = Math.floor(ISLAND.minX / T); tx < Math.ceil(ISLAND.maxX / T); tx++) for (let tz = Math.floor(ISLAND.minZ / T); tz < Math.ceil(ISLAND.maxZ / T); tz++) tiles.push({ id: `${tx}_${tz}`, tx, tz });
  const serial = roads.map((r) => ({ pts: r.pts.flat(), loop: r.loop, flat: r.flat, blend: r.blend, width: r.width, kind: r.kind }));
  let lastPct = -1;
  const res = await runPool<{ min: number; max: number; baseM: number; stepM: number; hi: boolean; bytes: number; forests: Array<{ kind: string; rings: Vec2[][] }>; heath: Vec2[][]; rock: Vec2[][] }>(
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
      heights: { baseM: h.baseM, stepM: h.stepM, encoding: 'uint16le', delta: true, lo: { n: 125, resolutionM: 8, file: `${t.id}.lo.u16` }, ...(h.hi ? { hi: { n: 500, resolutionM: 2, file: `${t.id}.hi.u16` } } : {}) },
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
    index.push({ id: t.id, tx: t.tx, tz: t.tz, baseM: h.baseM, minM: r2(h.min), maxM: r2(h.max), lods: h.hi ? ['lo', 'hi'] : ['lo'], bytes: h.bytes + Buffer.byteLength(json), ...(h.stepM !== 0.01 ? { stepM: h.stepM } : {}) });
  });
  log('tuiles écrites');

  writeFileSync(join(OUT, 'places.json'), JSON.stringify(B.places));
  const sr = TOWNS.find((t) => t.id === 'nordrobert')!;
  const meta: WorldMeta = {
    formatVersion: 1,
    id: ISLAND.id,
    name: ISLAND.name,
    crs: 'EPSG:2154',
    // Repère fictif, en mer au large de la Corse : ne recouvre aucune zone réelle ni un autre monde Poly.
    originL93: { x: 1330000, y: 5800000 },
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
    open: { graph: 'graph.json', start: { x: sr.x + 3, z: sr.z }, places: 'places.json', map: 'carte.png' },
    sea: { levelM: 0 },
  };
  writeFileSync(join(OUT, 'world.json'), JSON.stringify(meta, null, 1));
  log('monde écrit, contrôles…');
  const report = verifyWorld(OUT);
  for (const line of report.lines) console.log(line);
  log(report.ok ? 'contrôles au vert' : 'contrôles en échec');
  if (!report.ok) process.exitCode = 1;
  // Menu du jeu : catalogue des zones et pack de tuiles ; carte de l'île (menu, mini-carte, carte complète).
  else if (!TRIAL) {
    publishIsland(OUT);
    execFileSync('npx', ['tsx', join(import.meta.dirname, 'map.ts'), '--px', '25', '--out', join(OUT, 'carte.png')], { stdio: 'inherit', shell: true });
    execFileSync('npx', ['tsx', join(import.meta.dirname, 'map.ts'), '--px', '40', '--style', 'flat', '--out', join(OUT, 'vignette.png')], { stdio: 'inherit', shell: true });
  }
}

// Lancement direct seulement (les fonctions servent aussi aux scripts de mise au point).
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) void main();
