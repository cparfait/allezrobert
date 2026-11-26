/**
 * Générateur du Désert rouge (voir docs/DESERT_ROUGE.md), monde du mode Poly tiré du générateur du Pays de Robert
 * (tools/massif) : écrit un monde au format des mondes réels (world.json, tiles/*.json + .lo/.hi.u16,
 * routes/*.json, graph.json, places.json) dans apps/client/public/worlds/desert-rouge, puis lance les
 * contrôles automatiques (verify.ts).
 *
 *   node node_modules/tsx/dist/cli.mjs tools/desert-rouge/src/build.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RouteData, WorldMeta, WorldTile } from '../../../packages/shared/src/route.ts';
import { ANNEAU, BIKEPARK, CHOTT, CROSS, ERG, HARBOURS, ISLAND, LAKES, MASSIF, MESAS, OASES, PISTE, PLATEAU, TOWNS, anneauLoop, chainAt, coastPoint, inHarbour, inLake, inRiver, mesaShare, riverBeds, shoreDist, terrain, type Vec2 } from './design.ts';
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
  const anneau = makeRoad({ id: 'anneau', name: 'Circuit du Chott', kind: 'tertiary', width: ANNEAU.widthM, pts: anneauLoop(2), loop: true, designed: true, gmax: 0.01 });
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
  // Col des Vents : montée en lacets depuis Les Cairns, descente en lacets vers Port-Vent, route de l'Observatoire.
  const wet = (x: number, z: number) => inLake(x, z, 1.5) || inRiver(x, z, 25) || shoreDist(x, z) < 150;
  const col = saddle();
  const colY = terrain(col[0], col[1]);
  const lc = gates.filter((g) => g.town === 'les-cairns').sort((a, b) => Math.hypot(a.p[0] - col[0], a.p[1] - col[1]) - Math.hypot(b.p[0] - col[0], b.p[1] - col[1]))[0]!;
  lc.town = 'les-cairns-montee'; // porte réservée à la montée (le réseau passe par les autres)
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
  // trois routes : montée sud depuis Les Cairns, descente nord vers la vallée de Port-Vent, route de l'Observatoire.
  // Pied nord : point de la vallée de l'Oued du Vent (hors du lit), ≥ 380 m sous le col, le plus proche du col.
  const vent = riverBeds().find((b) => b.river.id === 'oued-du-vent')!;
  let foot: Vec2 = vent.pts[Math.floor(vent.pts.length / 2)]!;
  for (let k = 0; k < vent.pts.length; k += 5) {
    const [x, z] = vent.pts[k]!;
    const a = vent.pts[Math.max(0, k - 1)]!;
    const b = vent.pts[Math.min(vent.pts.length - 1, k + 1)]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    // Rive côté col.
    const nx = -(b[1] - a[1]) / l;
    const nz = (b[0] - a[0]) / l;
    const s = (col[0] - x) * nx + (col[1] - z) * nz > 0 ? 1 : -1;
    const q: Vec2 = [x + nx * s * (vent.chan[k]! + 45), z + nz * s * (vent.chan[k]! + 45)];
    if (terrain(q[0], q[1]) < colY - 560 && shoreDist(q[0], q[1]) > 500) {
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
  // Versant nord : part du col même (au bout de la montée sud) ; s'il recoupe la montée sud, il part du dernier croisement.
  const nord0 = fillet([col, ...northPts.slice(1)], 16);
  const nordCut = fromLastCross(nord0, sudPath);
  const nordPath = nordCut === nord0 ? nord0 : nordCut;
  const nordY0 = nordCut === nord0 ? colY : undefined;
  if (process.env.ISLAND_DEBUG) console.log(`   · versant nord : ${nordCut === nord0 ? 'depuis le col' : 'depuis un croisement'}`);
  const sudRoad = makeRoad({ id: 'col-sud', name: 'Route du Col des Vents', kind: 'tertiary', width: 6, pts: sudPath, designed: true, gmax: 0.12, smooth: 0, y0: lc.y, y1: colY });
  const ySud = (p: Vec2) => nearestOn(sudRoad, p[0], p[1]).y;
  const colRoads = [sudRoad, makeRoad({ id: 'col-nord', name: 'Route du Col des Vents', kind: 'tertiary', width: 6, pts: nordPath, designed: true, gmax: 0.12, smooth: 0, y0: nordY0 ?? ySud(nordPath[0]!) })];
  // Route de l'Observatoire : bifurque de la montée sud vers 720 m et monte en lacets sur le versant sud du Pic
  // (depuis le col, elle suivrait l'arête, bien trop raide).
  const sud = sudRoad;
  let bi = 0;
  sud.pts.forEach((p, i) => {
    const score = (q: Vec3) => Math.abs(q[1] - 720) + Math.hypot(q[0] - MASSIF.phare[0], q[2] - MASSIF.phare[1]) * 0.04;
    if (i > 20 && i < sud.pts.length - 20 && score(p) < score(sud.pts[bi]!)) bi = i;
  });
  const branch = sud.pts[bi]!;
  // Départ à angle droit de la montée (pas de raccord en biseau), du côté du Pic.
  const bn = sud.pts[Math.min(sud.pts.length - 1, bi + 4)]!;
  const bp = sud.pts[Math.max(0, bi - 4)]!;
  const tl0 = Math.hypot(bn[0] - bp[0], bn[2] - bp[2]) || 1;
  let nx = -(bn[2] - bp[2]) / tl0;
  let nz = (bn[0] - bp[0]) / tl0;
  if (nx * (MASSIF.phare[0] - branch[0]) + nz * (MASSIF.phare[1] - branch[2]) < 0) {
    nx = -nx;
    nz = -nz;
  }
  const stub: Vec2 = [branch[0] + nx * 45, branch[2] + nz * 45];
  const phareUp = lacets(stub, phareEnd, 0.068, 300);
  const obsPath = fromLastCross(fillet([[branch[0], branch[2]], ...phareUp], 14), sudPath);
  colRoads.push(makeRoad({ id: 'col-observatoire', name: "Route de l'Observatoire", kind: 'unclassified', width: 4.5, pts: obsPath, designed: true, gmax: 0.12, smooth: 0, y0: ySud(obsPath[0]!) }));
  const top: Vec3 = colRoads[0]!.pts[colRoads[0]!.pts.length - 1]!;
  const footEnd: Vec3 = colRoads[1]!.pts[colRoads[1]!.pts.length - 1]!;
  const fp = colRoads[1]!.pts[Math.max(0, colRoads[1]!.pts.length - 8)]!;
  roads.push(...colRoads);
  gates.push({ p: [footEnd[0], footEnd[2]], y: footEnd[1], dir: [footEnd[0] - fp[0], footEnd[2] - fp[2]], town: 'col-nord' });
  gates.push({ p: [top[0], top[2]], y: top[1], dir: [axis[0] / al, axis[1] / al], town: 'col' });
  // Route de la Grande Mesa : du pied de la rampe à Mesa-Haute, en lacets sur la rampe.
  const mesaBas = mesaFoot();
  const pg = gates.filter((g) => g.town === 'mesa-haute').sort((a, b) => Math.hypot(a.p[0] - mesaBas[0], a.p[1] - mesaBas[1]) - Math.hypot(b.p[0] - mesaBas[0], b.p[1] - mesaBas[1]))[0]!;
  pg.town = 'mesa-haute-montee';
  const climb = simplifyPath(switchbacks(mesaBas, pg.p, { grade: 0.058, halfWidth: 420, turn: 30, blocked: wet }), 3);
  const station = makeRoad({ id: 'route-de-la-mesa', name: 'Route de la Grande Mesa', kind: 'tertiary', width: 6, pts: fillet(climb, 18), designed: true, gmax: 0.12, smooth: 0, y0: terrain(mesaBas[0], mesaBas[1]), y1: pg.y });
  roads.push(station);
  const s0 = station.pts[0]!;
  const s1 = station.pts[Math.min(6, station.pts.length - 1)]!;
  gates.push({ p: [s0[0], s0[2]], y: s0[1], dir: [s0[0] - s1[0], s0[2] - s1[2]], town: 'mesa-bas' });
  // La Piste Droite : 7 km en ligne droite, à plat, deux carrefours au milieu (vers le chott et vers l'erg).
  const [pa, pb] = [PISTE.a, PISTE.b];
  const N = Math.round(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / 50);
  const line = Array.from({ length: N + 1 }, (_, i) => [pa[0] + ((pb[0] - pa[0]) * i) / N, pa[1] + ((pb[1] - pa[1]) * i) / N] as Vec2);
  const piste = makeRoad({ id: 'piste-droite', name: 'La Piste Droite', kind: 'secondary', width: 7, pts: line, designed: true, gmax: 0.02, smooth: 0 });
  roads.push(piste);
  const pd: Vec2 = [(pb[0] - pa[0]) / Math.hypot(pb[0] - pa[0], pb[1] - pa[1]), (pb[1] - pa[1]) / Math.hypot(pb[0] - pa[0], pb[1] - pa[1])];
  const onPiste = (s: number) => {
    const k = Math.round(s * (piste.pts.length - 1));
    return piste.pts[k]!;
  };
  const e0 = piste.pts[0]!;
  const e1 = piste.pts[piste.pts.length - 1]!;
  gates.push({ p: [e0[0], e0[2]], y: e0[1], dir: [-pd[0], -pd[1]], town: 'piste-est' });
  gates.push({ p: [e1[0], e1[2]], y: e1[1], dir: pd, town: 'piste-ouest' });
  const mn = onPiste(0.42);
  const ms = onPiste(0.58);
  gates.push({ p: [mn[0], mn[2]], y: mn[1], dir: [pd[1], -pd[0]], town: 'piste-nord' });
  gates.push({ p: [ms[0], ms[2]], y: ms[1], dir: [-pd[1], pd[0]], town: 'piste-sud' });
  // Petites boucles dessinées : cyclo-cross dans le sable de l'erg, bike park entre les Buttes Rouges (virages relevés).
  for (const [id, name, c, R, surface, width, town, gateAng] of [
    ['cyclo-cross', 'Cyclo-cross des Sables', CROSS, 150, 'sand', 3, 'cross', -Math.PI / 2],
    ['bike-park', 'Bike park des Buttes', BIKEPARK, 165, 'dirt', 2.6, 'bikepark', Math.PI / 2],
    ['mesa-loop', 'Chemin de la Mesa', [MESAS[0]!.x + 60, MESAS[0]!.z + 40] as Vec2, 560, 'fine_gravel', 3.4, 'mesaloop', Math.PI * 0.75],
  ] as const) {
    const n = 90;
    const shape = (a: number) => R * (1 + 0.22 * Math.sin(3 * a + 0.7) + 0.09 * Math.sin(7 * a + 1.3));
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [c[0] + Math.cos(a) * shape(a) * 1.25, c[1] + Math.sin(a) * shape(a)] as Vec2;
    });
    const lp = makeRoad({ id, name, kind: 'track', width, surface, pts, loop: true, designed: true, gmax: 0.16, smooth: 0 });
    roads.push(lp);
    const g: Vec2 = [c[0] + Math.cos(gateAng) * shape(gateAng) * 1.25, c[1] + Math.sin(gateAng) * shape(gateAng)];
    let best = lp.pts[0]!;
    for (const p of lp.pts) if (Math.hypot(p[0] - g[0], p[2] - g[1]) < Math.hypot(best[0] - g[0], best[2] - g[1])) best = p;
    gates.push({ p: [best[0], best[2]], y: best[1], dir: [best[0] - c[0], best[2] - c[1]], town });
  }
  for (const g of ANNEAU_GATES) {
    let best = anneau.pts[0]!;
    for (const p of anneau.pts) if (Math.hypot(p[0] - g[0], p[2] - g[1]) < Math.hypot(best[0] - g[0], best[2] - g[1])) best = p;
    const out: Vec2 = [g[0] - ANNEAU.cx - Math.sign(g[0] - ANNEAU.cx) * Math.min(Math.abs(g[0] - ANNEAU.cx), ANNEAU.half), g[1] - ANNEAU.cz];
    gates.push({ p: [best[0], best[2]], y: best[1], dir: out, town: 'anneau' });
  }
  return { roads, layouts, anneau, gates };
}

/** Pied de la rampe de la Grande Mesa (là où la rampe rejoint la plaine). */
export function mesaFoot(): Vec2 {
  const m = MESAS[0]!;
  const r = m.ramp!;
  const dir: Vec2 = [Math.cos(r.ang), Math.sin(r.ang)];
  // Premier point, en s'éloignant du centre, où la mesa ne relève plus le sol.
  for (let d = 900; d < 5000; d += 25) {
    const p: Vec2 = [m.x + dir[0] * d, m.z + dir[1] * d];
    if (mesaShare(m, p[0], p[1]) < 0.01) return [m.x + dir[0] * (d + 60), m.z + dir[1] * (d + 60)];
  }
  return [m.x + dir[0] * 3000, m.z + dir[1] * 3000];
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
      if (sd < 60 || inLake(x, z, 1.25) || inHarbour(x, z, 25)) grid.water[c] = 1;
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
  { name: 'Chemin du Plateau', at: [10800, 400], r: 1600, n: 9 },
  { name: 'Chemin de la Palmeraie', at: [3700, 6500], r: 1250, n: 8 },
  { name: 'Piste des Dunes', at: [ERG.x + 200, ERG.z - 100], r: 2000, n: 11, seed: 2 },
  { name: 'Chemin des Buttes', at: [-900, -2800], r: 1300, n: 9 },
  { name: 'Chemin des Falaises', line: shorePath(0.52, 0.95, 7, 210) },
  { name: 'Chemin de la Pointe', line: shorePath(2.12, 2.5, 6, 280) },
  { name: 'Chemin de la Grande Traversée', line: [[-12000, 2600], [-8600, 6100], [-5200, 6200], [-2200, 6300], [1200, 7300]] },
  { name: 'Sentier de Braise', mtb: true, at: [-6800, -5600], r: 900, n: 8 },
  { name: 'Sentier de la Dent Rouge', mtb: true, at: [6300, -3600], r: 900, n: 8 },
  { name: 'Descente du Vautour', mtb: true, line: [saddle(), [3100, -5300], [2700, -4200], [2200, -3300]] },
  { name: 'Sentier du Canyon', mtb: true, at: [8300, -700], r: 750, n: 8 },
  { name: 'Sentier des Falaises', mtb: true, at: [9300, 7500], r: 850, n: 8 },
  { name: 'Sentier des Arches', mtb: true, at: [-3200, -4100], r: 800, n: 8 },
];

/**
 * Matière et largeur des chemins, tronçon après tronçon (jamais deux pareils à la suite) : stabilisé (gravel), pierre
 * (pebblestone), gravier fin (fine_gravel), terre (dirt), argile rouge (earth), sable (sand), roche (rock), pavés
 * (cobblestone, dans les palmeraies). Les sentiers restent étroits, quelques pistes s'ouvrent à 4,4 m.
 */
const SKIN: Record<string, Array<[surface: string, width: number]>> = {
  'Chemin de la Mesa': [['fine_gravel', 3.4], ['gravel', 3], ['pebblestone', 2.8]],
  'Chemin du Plateau': [['gravel', 4.2], ['fine_gravel', 3.2], ['pebblestone', 3.4]],
  'Chemin de la Palmeraie': [['fine_gravel', 3.6], ['cobblestone', 3], ['gravel', 3.2]],
  'Piste des Dunes': [['fine_gravel', 4.4], ['gravel', 3.6], ['fine_gravel', 3], ['pebblestone', 3.4]],
  'Chemin des Buttes': [['earth', 3.2], ['dirt', 3.4], ['earth', 3.8]],
  'Chemin des Salines': [['fine_gravel', 3.6], ['gravel', 2.8]],
  'Chemin des Falaises': [['pebblestone', 2.8], ['fine_gravel', 3.2], ['gravel', 3.6]],
  'Chemin de la Pointe': [['fine_gravel', 3], ['gravel', 2.6], ['pebblestone', 3.4]],
  'Chemin de la Grande Traversée': [['gravel', 3.6], ['fine_gravel', 4.4], ['pebblestone', 2.8], ['gravel', 2.6]],
  'Sentier de Braise': [['rock', 2.4], ['earth', 2], ['dirt', 2.2]],
  'Sentier de la Dent Rouge': [['rock', 2.4], ['dirt', 2], ['earth', 2.6], ['rock', 2]],
  'Descente du Vautour': [['dirt', 2.2], ['rock', 2.6], ['earth', 2]],
  'Sentier du Canyon': [['earth', 2], ['rock', 2.4], ['dirt', 2.2]],
  'Sentier des Falaises': [['rock', 2.2], ['earth', 2], ['sand', 2.4]],
  'Sentier des Arches': [['earth', 2.2], ['sand', 1.9], ['rock', 2.4]],
  'Cyclo-cross des Sables': [['sand', 3], ['dirt', 2.8], ['sand', 2.6], ['earth', 3.2]],
  'Bike park des Buttes': [['dirt', 2.4], ['earth', 2.2], ['rock', 2.4]],
};

const LANE_NAMES = ['des Tamaris', 'du Vieux Puits', 'des Quatre Vents', 'de la Pierre Blanche', 'des Acacias', 'des Gazelles', 'de la Source', 'de la Butte', 'des Cailloux', 'du Grand Reg', 'de la Fontaine', 'des Dattiers', 'du Four Brûlé', 'des Fennecs', 'des Amandiers', 'du Cairn', 'de la Caravane', 'des Cigales', 'du Gué Neuf', 'de la Forge', 'des Jardins', 'du Coteau', 'des Étoiles', 'des Ajoncs', 'du Figuier', 'de la Mare', 'des Scorpions', 'du Berger'];

const MESH_NAMES = new Set(LANE_NAMES.map((n) => `Route ${n}`));

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

/** Points du canyon de l'Oued Rouge (sur le plateau) : fond (à côté du lit) et corniche (au bord, côté est). */
export function canyonPoints(): { floor: Vec2[]; rim: Vec2[]; mouthN: Vec2; mouthS: Vec2 } {
  const b = riverBeds().find((q) => q.river.id === 'oued-rouge')!;
  const pe = (x: number, z: number) => Math.hypot((x - PLATEAU.x) / PLATEAU.rx, (z - PLATEAU.z) / PLATEAU.rz);
  const inside = b.pts.map(([x, z]) => pe(x, z) < 0.92);
  const i0 = inside.indexOf(true);
  const i1 = inside.lastIndexOf(true);
  const floor: Vec2[] = [];
  const rim: Vec2[] = [];
  const at = (k: number, off: number, east: boolean): Vec2 => {
    const a = b.pts[Math.max(0, k - 3)]!;
    const c = b.pts[Math.min(b.pts.length - 1, k + 3)]!;
    const l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    let nx = -(c[1] - a[1]) / l;
    let nz = (c[0] - a[0]) / l;
    if ((nx > 0) !== east) {
      nx = -nx;
      nz = -nz;
    }
    const [x, z] = b.pts[k]!;
    return [x + nx * off, z + nz * off];
  };
  // Entrée nord : là où le lit a rejoint le niveau du bas pays (en amont, l'oued dévale en cascades).
  const m0 = Math.max(i0, b.bed.findIndex((y) => y < 265));
  for (let k = m0 + 40; k <= i1; k += 40) floor.push(at(k, b.chan[k]! + 20, false));
  for (let k = i0 + 20; k <= i1 - 20; k += 50) rim.push(at(k, b.width[k]! + 130, true));
  return { floor, rim, mouthN: at(m0, b.chan[m0]! + 20, false), mouthS: at(Math.min(b.pts.length - 1, i1 + 60), b.chan[Math.min(b.pts.length - 1, i1 + 60)]! + 20, false) };
}

export function planNetwork(P: Plan, gates: Array<{ p: Vec2; town?: string }>, farms: Array<{ gate: Vec2 }>): { ring: Vec2[]; bois: Vec2[]; mtb: Vec2[]; col: Vec2; foot: Vec2; lake: Vec2[] } {
  const C = CLASSES;
  const town = (id: string) => TOWNS.find((t) => t.id === id)!;
  const G = (id: string, toward: Vec2 | string) => nearestGate(gates, id, typeof toward === 'string' ? [town(toward).x, town(toward).z] : toward);
  const gate = (id: string) => gates.find((g) => g.town === id)!.p;
  // a. Route du tour du désert : points le long de la côte, villes côtières traversées par leurs rues.
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
    // Massif du Vautour : pas de point imposé, la route le contourne d'elle-même.
    if (Math.min(Math.hypot(p[0] - MASSIF.phare[0], p[1] - MASSIF.phare[1]), Math.hypot(p[0] - MASSIF.mont[0], p[1] - MASSIF.mont[1])) < 3600 || inset >= 3600) continue;
    ring.push({ p, ang });
  }
  for (const id of ['port-corail', 'cap-brique', 'port-vent', 'les-salines']) {
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
    connect(P, a.p, b.p, [C.tertiary, C.lane, steep], 'Route du Tour du Désert', 220);
  }
  // b. Grands axes depuis Rocherouge ; la Piste Droite vers Sablons ; route de l'Oasis.
  for (const to of ['port-corail', 'puits-sale', 'l-oasis']) connect(P, G('rocherouge', to), G(to, 'rocherouge'), [C.secondary, C.tertiary, C.lane], `Route de ${town(to).name}`);
  connect(P, gate('piste-est'), G('rocherouge', gate('piste-est')), [C.secondary, C.tertiary, C.lane], 'La Piste Droite');
  connect(P, gate('piste-ouest'), G('sablons', gate('piste-ouest')), [C.secondary, C.tertiary, C.lane], 'La Piste Droite');
  connect(P, G('l-oasis', 'le-gue'), G('le-gue', 'l-oasis'), [C.tertiary, C.lane], "Route de l'Oasis");
  // Route du Canyon : des Cairns à l'entrée nord du canyon, puis au fond, le long de l'oued, jusqu'au Gué.
  const cy = canyonPoints();
  const canyonCls = [C.tertiary, C.lane, steep];
  if (!connect(P, G('les-cairns', cy.mouthN), cy.mouthN, canyonCls, 'Route du Canyon', 320)) {
    P.failed.pop();
    spur(P, cy.mouthN, steep, 5, 'Route du Canyon', 300);
  }
  const fl = [cy.mouthN, ...cy.floor, cy.mouthS];
  for (let k = 0; k + 1 < fl.length; k++) connect(P, fl[k]!, fl[k + 1]!, canyonCls, 'Route du Canyon', 90);
  connect(P, cy.mouthS, G('le-gue', cy.mouthS), canyonCls, 'Route du Canyon', 200);
  // Route de la Corniche : au bord du canyon, côté est, raccordée à Ksar-Rouge.
  for (let k = 0; k + 1 < cy.rim.length; k++) connect(P, cy.rim[k]!, cy.rim[k + 1]!, [C.tertiary, C.lane, steep], 'Route de la Corniche', 120);
  if (cy.rim.length) {
    spur(P, cy.rim[0]!, C.lane, 5, 'Route de la Corniche', 200);
    spur(P, cy.rim[cy.rim.length - 1]!, C.lane, 5, 'Route de la Corniche', 200);
    const mid = cy.rim[Math.floor(cy.rim.length / 2)]!;
    connect(P, mid, G('ksar-rouge', mid), [C.tertiary, C.lane, steep], 'Route de la Corniche', 200);
  }
  // c. Routes communales.
  const tert: Array<[string, string]> = [
    ['les-cairns', 'rocherouge'], ['les-cairns', 'puits-sale'], ['puits-sale', 'sablons'], ['l-oasis', 'port-corail'], ['cap-brique', 'le-gue'],
    ['ksar-rouge', 'le-gue'], ['ksar-rouge', 'cap-brique'], ['sablons', 'les-salines'], ['rocherouge', 'le-gue'],
  ];
  for (const [a, b] of tert) connect(P, G(a, b), G(b, a), [C.tertiary, C.lane, steep], `Route de ${town(b).name}`, 200);
  // Grande Mesa : la route de la rampe (lacets dessinés) descend jusqu'au pied, raccordé à Puits-Salé et Sablons.
  const pb = gate('mesa-bas');
  connect(P, pb, G('puits-sale', pb), [C.tertiary, C.lane, steep], 'Route de la Grande Mesa', 200);
  connect(P, pb, G('sablons', pb), [C.tertiary, C.lane, steep], 'Route de la Grande Mesa', 200);
  // Piste Droite, carrefours du milieu : vers Puits-Salé (nord), vers l'Oasis des Dunes et Port-Corail (sud).
  connect(P, gate('piste-nord'), G('puits-sale', gate('piste-nord')), [C.tertiary, C.lane, steep], 'Route du Chott', 200);
  const dunes: Vec2 = [OASES[1]!.x + 380, OASES[1]!.z - 260];
  connect(P, gate('piste-sud'), dunes, [C.tertiary, C.lane, steep], 'Route des Dunes', 220);
  connect(P, dunes, G('port-corail', dunes), [C.tertiary, C.lane, steep], 'Route des Dunes', 240);
  // Circuit du Chott : raccords aux villages voisins.
  const lake: Vec2[] = [];
  const anneauGate = (k: number) => gates.filter((g) => g.town === 'anneau')[k]!.p;
  connect(P, anneauGate(0), G('rocherouge', anneauGate(0)), [C.tertiary, C.lane, steep], 'Route du Circuit');
  connect(P, anneauGate(3), G('puits-sale', anneauGate(3)), [C.tertiary, C.lane, steep], 'Route du Circuit');
  connect(P, anneauGate(1), pb, [C.tertiary, C.lane, steep], 'Route du Circuit');
  // d. Col des Vents (routes dessinées en lacets) : le pied du versant nord rejoint le réseau.
  const col = gates.find((g) => g.town === 'col')!.p;
  const foot = gates.find((g) => g.town === 'col-nord')!.p;
  if (!connect(P, foot, G('port-vent', foot), [{ ...C.tertiary, gmax: 0.1 }, { ...C.lane, gmax: 0.12 }, steep], 'Route du Col des Vents', 400)) {
    console.log(`   · pied du col : ${P.failed.pop()}`);
    spur(P, foot, steep, 5, 'Route du Col des Vents', 300);
  }
  // e. Pistes cyclables.
  const cyc = [C.cycleway, { ...C.cycleway, gmax: 0.06 }];
  connect(P, G('rocherouge', anneauGate(2)), anneauGate(2), cyc, 'La Piste du Chott');
  connect(P, G('sablons', 'les-salines'), G('les-salines', 'sablons'), cyc, 'Voie verte des Sablons');
  connect(P, G('puits-sale', 'rocherouge'), G('rocherouge', 'puits-sale'), cyc, 'Voie verte du Chott');
  connect(P, G('port-corail', 'l-oasis'), G('l-oasis', 'port-corail'), cyc, 'La Vélo du Golfe');
  // Accès au cyclo-cross et au bike park.
  if (!connect(P, gate('cross'), G('rocherouge', gate('cross')), [C.track, { ...C.track, gmax: 0.17 }], 'Accès au cyclo-cross', 200)) {
    P.failed.pop();
    spur(P, gate('cross'), C.track, 5, 'Accès au cyclo-cross', 200);
  }
  spur(P, gate('bikepark'), C.track, 5, 'Accès au bike park', 200);
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
  const loopConnect = (pts: Vec2[], cls: RoadClass[], label: string, town?: string) => {
    const good = pts.filter(okPt);
    for (let k = 0; k < good.length; k++) connect(P, good[k]!, good[(k + 1) % good.length]!, cls, label);
    // Raccords : au plus proche, ou aux portes d'un village (chemin du sommet d'une mesa).
    const attach = (p: Vec2) => (town ? connect(P, p, G(town, p), cls, label) : spur(P, p, cls[0]!, 5, label));
    if (good[0]) attach(good[0]);
    if (good.length > 3) attach(good[Math.floor(good.length / 2)]!);
    return good;
  };
  // g. Gravel : chemin de la Mesa, sur le sommet de la Grande Mesa.
  const gm = MESAS[0]!;
  void gm;
  const bois: Vec2[] = [];
  if (!connect(P, gate('mesaloop'), G('mesa-haute', gate('mesaloop')), [C.track], 'Chemin de la Mesa', 200)) {
    P.failed.pop();
    spur(P, gate('mesaloop'), C.track, 5, 'Chemin de la Mesa', 200);
  }
  // h. VTT : sentiers de chaque région (TRAILS).
  let mtb: Vec2[] = [];
  for (const [k0, t] of TRAILS.entries()) {
    const cls = t.mtb ? [C.mtb, { ...C.mtb, gmax: 0.24 }] : [C.track, { ...C.track, gmax: 0.16 }];
    if ('r' in t) {
      const good = loopConnect(loopPts(t.at[0], t.at[1], t.r, t.n, t.mtb ? 0.65 : 0.45, rng(7100 + k0 + (t.seed ?? 0))), cls, t.name);
      if (t.name === 'Sentier de Braise') mtb = good;
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
      const cap = Math.min(cls.kind === 'track' ? 0.24 : 0.14, Math.max(cls.gmax + 0.005, steepest * 1.05));
      const y = profile(xz, false, cls.id === 'track' ? 24 : cls.id === 'mtb' ? 40 : 30, cap, endY(xz[0]!), endY(xz[xz.length - 1]!));
      const skins = cls.kind === 'track' ? SKIN[e.label ?? ''] : undefined;
      const nth = counts.get(`·${e.label}`) ?? 0;
      if (skins) counts.set(`·${e.label}`, nth + 1);
      const [surface, width] = skins ? skins[nth % skins.length]! : [cls.surface, cls.width];
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

function routeSpecs(net: { ring: Vec2[]; bois: Vec2[]; mtb: Vec2[]; col: Vec2; foot: Vec2; lake: Vec2[]; mesaBas: Vec2; obs: Vec2 }): RouteSpec[] {
  const t = (id: string): Vec2 => {
    const q = TOWNS.find((x) => x.id === id)!;
    return [q.x, q.z];
  };
  const L = (name: string, p: Vec2) => ({ name, x: p[0], z: p[1] });
  const pa = TOWNS.find((x) => x.id === 'port-corail')!;
  const ang = Math.atan2(pa.z, pa.x);
  const east = ang - 0.055;
  const west = ang + 0.145;
  // Rues de derrière de Rocherouge (critérium).
  const vr = TOWNS.find((x) => x.id === 'rocherouge')!;
  const u: Vec2 = [Math.cos(vr.angle), Math.sin(vr.angle)];
  const v: Vec2 = [-u[1], u[0]];
  const V = (a: number, b: number): Vec2 => [vr.x + (a * u[0] + b * v[0]) * vr.r, vr.z + (a * u[1] + b * v[1]) * vr.r];
  const cy = canyonPoints();
  const mid = (pts: Vec2[]) => pts[Math.floor(pts.length / 2)]!;
  const gm = MESAS[0]!;
  const lion = MESAS.find((m) => m.id === 'mesa-du-lion')!;
  const pist = (s: number): Vec2 => [PISTE.a[0] + (PISTE.b[0] - PISTE.a[0]) * s, PISTE.a[1] + (PISTE.b[1] - PISTE.a[1]) * s];
  return [
    // Route : découverte, classiques, chrono, montées.
    { id: 'decouverte-du-desert', name: 'La découverte du Désert', nameEn: 'Desert discovery', loop: true, mode: 'road', waypoints: [t('rocherouge'), pist(0.05), [t('rocherouge')[0] - 1500, t('rocherouge')[1] - 1500]], sprints: [{ name: 'Sprint de la Piste', x: pist(0.05)[0], z: pist(0.05)[1], lengthM: 300 }], landmarks: [L('Rocherouge', t('rocherouge')), L('La Piste Droite', pist(0.06)), L('Les Buttes Rouges', [-600, -3200])] },
    { id: 'classique-des-canyons', name: 'La classique des Canyons', nameEn: 'Canyons classic', loop: true, mode: 'road', waypoints: [t('le-gue'), mid(cy.floor), t('les-cairns'), mid(cy.rim), t('ksar-rouge')], sprints: [{ name: 'Sprint du Gué', x: t('le-gue')[0], z: t('le-gue')[1] }, { name: 'Sprint de Ksar-Rouge', x: t('ksar-rouge')[0], z: t('ksar-rouge')[1] }], landmarks: [L('Le Gué', t('le-gue')), L("Canyon de l'Oued Rouge", mid(cy.floor)), L('Les Cairns', t('les-cairns')), L('La Corniche', mid(cy.rim)), L('Ksar-Rouge', t('ksar-rouge'))] },
    { id: 'chrono-de-la-piste-droite', name: 'Le chrono de la Piste Droite', nameEn: 'Straight road time trial', loop: false, mode: 'road', waypoints: [pist(0.01), pist(0.99)], landmarks: [L('La Piste Droite', pist(0.5)), L('Sablons', t('sablons'))] },
    { id: 'mesa-de-nuit', name: 'La Grande Mesa de nuit', nameEn: 'Great Mesa by night', loop: false, mode: 'road', waypoints: [net.mesaBas, t('mesa-haute')], hairpins: true, climbNames: ['Montée de la Grande Mesa'], landmarks: [L('Pied de la Grande Mesa', net.mesaBas), L('Mesa-Haute', t('mesa-haute'))] },
    { id: 'montee-de-la-grande-mesa', name: 'La montée de la Grande Mesa', nameEn: 'Great Mesa climb', loop: false, mode: 'road', waypoints: [t('puits-sale'), net.mesaBas, t('mesa-haute')], hairpins: true, climbNames: ['Montée de la Grande Mesa'], landmarks: [L('Puits-Salé', t('puits-sale')), L('Mesa-Haute', t('mesa-haute'))] },
    { id: 'criterium-de-rocherouge', name: 'Le critérium de Rocherouge', nameEn: 'Rocherouge criterium', loop: true, mode: 'road', waypoints: [V(-0.55, -0.36), V(0.55, -0.36), V(0.55, 0.36), V(-0.55, 0.36)], sprints: [{ name: 'Sprint de la Grand-Rue', x: V(0.3, 0)[0], z: V(0.3, 0)[1] }], landmarks: [L('Place de Rocherouge', t('rocherouge'))] },
    { id: 'col-des-vents', name: 'La traversée du Col des Vents', nameEn: 'Wind pass traverse', loop: false, mode: 'road', waypoints: [t('les-cairns'), net.col, net.foot], hairpins: true, climbNames: ['Col des Vents, versant sud'], landmarks: [L('Les Cairns', t('les-cairns')), L('Col des Vents', net.col), L('Versant nord', net.foot)] },
    { id: 'pic-du-vautour', name: 'La montée du Pic du Vautour', nameEn: 'Vulture peak climb', loop: false, mode: 'road', waypoints: [t('les-cairns'), net.obs, MASSIF.phare], hairpins: true, climbNames: ['Pic du Vautour'], landmarks: [L('Observatoire du Pic du Vautour', MASSIF.phare)] },
    { id: 'col-par-port-vent', name: 'Le Col des Vents par Port-Vent', nameEn: 'Wind pass from the north', loop: false, mode: 'road', waypoints: [net.foot, net.col, t('les-cairns')], hairpins: true, climbNames: ['Col des Vents, versant nord'], landmarks: [L("Vallée de l'Oued du Vent", net.foot), L('Col des Vents', net.col), L('Les Cairns', t('les-cairns'))] },
    { id: 'route-du-canyon', name: 'La route du Canyon', nameEn: 'Canyon floor road', loop: false, mode: 'road', waypoints: [t('le-gue'), mid(cy.floor), t('les-cairns')], landmarks: [L('Le Gué', t('le-gue')), L("Canyon de l'Oued Rouge", mid(cy.floor)), L('Les Cairns', t('les-cairns'))] },
    { id: 'corniche-du-canyon', name: 'La corniche du Canyon', nameEn: 'Canyon rim road', loop: false, mode: 'road', waypoints: [cy.rim[0]!, mid(cy.rim), cy.rim[cy.rim.length - 1]!], landmarks: [L('La Corniche', mid(cy.rim)), L('Ksar-Rouge', t('ksar-rouge'))] },
    { id: 'tour-du-desert', name: 'Le Tour du Désert', nameEn: 'Round the desert', loop: true, mode: 'road', waypoints: [t('port-corail'), t('l-oasis'), t('cap-brique'), t('ksar-rouge'), t('port-vent'), t('mesa-haute'), t('sablons'), t('les-salines')], sprints: [{ name: 'Sprint de Port-Vent', x: t('port-vent')[0], z: t('port-vent')[1] }, { name: 'Sprint de Port-Corail', x: t('port-corail')[0], z: t('port-corail')[1] }], landmarks: TOWNS.filter((x) => shoreDist(x.x, x.z) < 1500).map((x) => L(x.name, [x.x, x.z])) },
    { id: 'corniche-des-falaises', name: 'La corniche des Falaises Rouges', nameEn: 'Red cliffs corniche', loop: true, mode: 'road', waypoints: [t('port-corail'), t('cap-brique'), t('l-oasis')], sprints: [{ name: 'Sprint de Cap-Brique', x: t('cap-brique')[0], z: t('cap-brique')[1] }], landmarks: [L('Port-Corail', t('port-corail')), L('Cap-Brique', t('cap-brique')), L("L'Oasis", t('l-oasis'))] },
    { id: 'plateau-du-ksar', name: 'Le plateau du Ksar', nameEn: 'Ksar plateau', loop: true, mode: 'road', waypoints: [t('ksar-rouge'), t('cap-brique'), t('le-gue')], landmarks: [L('Ksar-Rouge', t('ksar-rouge')), L('La Citadelle Rouge', [12300, -1300]), L('Le Gué', t('le-gue'))] },
    { id: 'golfe-et-oasis', name: "Le golfe et l'Oasis", nameEn: 'Gulf and oasis', loop: true, mode: 'road', waypoints: [t('port-corail'), t('l-oasis'), t('rocherouge')], sprints: [{ name: 'Sprint des Palmiers', x: coastPoint(ang, 800)[0], z: coastPoint(ang, 800)[1] }], landmarks: [L('Port-Corail', t('port-corail')), L("Source de l'Oasis", [OASES[0]!.x, OASES[0]!.z]), L('La Mesa du Lion', [lion.x, lion.z])] },
    { id: 'lagune-et-salines', name: 'La lagune et les Salines', nameEn: 'Lagoon and salt pans', loop: true, mode: 'road', waypoints: [t('sablons'), t('les-salines'), coastPoint(2.5, 1100)], landmarks: [L('Sablons', t('sablons')), L('Lagune des Flamants', [LAKES[0]!.x, LAKES[0]!.z]), L('Les Salines', t('les-salines'))] },
    { id: 'tour-du-chott', name: 'Le tour du Chott Blanc', nameEn: 'White salt lake loop', loop: true, mode: 'road', waypoints: [t('puits-sale'), net.mesaBas, ANNEAU_GATES[1]!, ANNEAU_GATES[0]!], landmarks: [L('Puits-Salé', t('puits-sale')), L(CHOTT.name, [CHOTT.x, CHOTT.z]), L('Caravansérail du Chott', [-3300, -1500])] },
    { id: 'boucle-de-rocherouge', name: 'La boucle de Rocherouge', nameEn: 'Rocherouge loop', loop: true, mode: 'road', waypoints: [t('rocherouge'), t('les-cairns'), t('le-gue'), t('l-oasis')], sprints: [{ name: "Sprint de l'Oasis", x: t('l-oasis')[0], z: t('l-oasis')[1] }], landmarks: [L('Rocherouge', t('rocherouge')), L('Les Cairns', t('les-cairns')), L('Le Gué', t('le-gue')), L("L'Oasis", t('l-oasis'))] },
    { id: 'route-des-dunes', name: 'La route des Dunes', nameEn: 'Dunes road', loop: false, mode: 'road', waypoints: [pist(0.58), [OASES[1]!.x + 380, OASES[1]!.z - 260], t('port-corail')], landmarks: [L('Oasis des Dunes', [OASES[1]!.x, OASES[1]!.z]), L('Port-Corail', t('port-corail'))] },
    // Pistes cyclables.
    { id: 'promenade-de-port-corail', name: 'La promenade de Port-Corail', nameEn: 'Port-Corail promenade', loop: true, mode: 'cycle', waypoints: [coastPoint(east + 0.006, 185), coastPoint(east + 0.006, 125), coastPoint(west - 0.006, 125), coastPoint(west - 0.006, 185), coastPoint(ang, 480)], sprints: [{ name: 'Sprint de la Promenade', x: coastPoint(ang + 0.1, 125)[0], z: coastPoint(ang + 0.1, 125)[1], lengthM: 400 }], landmarks: [L('La Promenade', coastPoint(ang, 125)), L('Halle aux poissons', coastPoint(ang + 0.018, 230))] },
    { id: 'piste-du-chott', name: 'La piste du Chott', nameEn: 'Salt lake cycleway', loop: true, mode: 'cycle', waypoints: [t('rocherouge'), ANNEAU_GATES[2]!, ANNEAU_GATES[0]!], landmarks: [L('Circuit du Chott', [ANNEAU.cx, ANNEAU.cz]), L('Rocherouge', t('rocherouge'))] },
    { id: 'voie-verte-des-sablons', name: 'La voie verte des Sablons', nameEn: 'Sablons greenway', loop: false, mode: 'cycle', waypoints: [t('sablons'), t('les-salines')], landmarks: [L('Les Salines', t('les-salines'))] },
    { id: 'voie-verte-du-chott', name: 'La voie verte du Chott', nameEn: 'Salt lake greenway', loop: false, mode: 'cycle', waypoints: [t('rocherouge'), t('puits-sale')], landmarks: [L('Puits-Salé', t('puits-sale'))] },
    { id: 'velo-du-golfe', name: 'La Vélo du Golfe', nameEn: 'Gulf greenway', loop: false, mode: 'cycle', waypoints: [t('port-corail'), t('l-oasis')], landmarks: [L("L'Oasis", t('l-oasis'))] },
    // Gravel.
    { id: 'classique-des-dunes', name: 'La classique des Dunes', nameEn: 'Dunes classic', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Piste des Dunes', landmarks: [L('Le Grand Erg', [ERG.x, ERG.z]), L('Oasis des Dunes', [OASES[1]!.x, OASES[1]!.z])] },
    { id: 'gravel-du-plateau', name: 'Gravel du Plateau', nameEn: 'Plateau gravel', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Chemin du Plateau', landmarks: [L('Plateau des Canyons', [10800, 400])] },
    { id: 'gravel-de-la-palmeraie', name: 'Gravel de la Palmeraie', nameEn: 'Palm grove gravel', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Chemin de la Palmeraie', landmarks: [L("Source de l'Oasis", [OASES[0]!.x, OASES[0]!.z])] },
    { id: 'gravel-des-buttes', name: 'Gravel des Buttes Rouges', nameEn: 'Red buttes gravel', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Chemin des Buttes', landmarks: [L('Les Buttes Rouges', [-600, -3200])] },
    { id: 'chemin-des-falaises', name: 'Le chemin des Falaises Rouges', nameEn: 'Red cliffs path', loop: false, mode: 'gravel', bike: 'gravel', waypoints: [coastPoint(0.52, 210), coastPoint(0.74, 210), coastPoint(0.95, 210)], landmarks: [L('Cap-Brique', t('cap-brique'))] },
    { id: 'chemin-de-la-pointe', name: 'Le chemin de la Pointe', nameEn: 'Sand spit path', loop: false, mode: 'gravel', bike: 'gravel', waypoints: [coastPoint(2.12, 280), coastPoint(2.5, 280)], landmarks: [L('Pointe des Sables', coastPoint(2.32, 300))] },
    { id: 'grande-traversee', name: 'La Grande Traversée', nameEn: 'Great gravel traverse', loop: false, mode: 'gravel', bike: 'gravel', waypoints: [[-12000, 2600], [-8600, 6100], [-5200, 6200], [-2200, 6300], [1200, 7300]], landmarks: [L('Sablons', t('sablons')), L("L'Oasis", t('l-oasis'))] },
    // VTT.
    { id: 'vtt-des-monts-de-braise', name: 'VTT des Monts de Braise', nameEn: 'Ember Mountains MTB trail', loop: true, mode: 'mtb', bike: 'mtb', waypoints: net.mtb, along: 'Sentier de Braise', landmarks: [L('Les Monts de Braise', [-6800, -5600])] },
    { id: 'vtt-de-la-dent-rouge', name: 'VTT de la Dent Rouge', nameEn: 'Red Tooth MTB loop', loop: true, mode: 'mtb', bike: 'mtb', waypoints: [], along: 'Sentier de la Dent Rouge', landmarks: [L('La Dent Rouge', MASSIF.mont)] },
    { id: 'descente-du-vautour', name: 'La descente du Vautour', nameEn: 'Vulture downhill', loop: false, mode: 'mtb', bike: 'mtb', waypoints: [[2700, -4200], [2200, -3300]], sprints: [{ name: 'Chrono de la descente', x: 2200, z: -3300, lengthM: 1500 }], landmarks: [L('Balcon du Vautour', [3100, -5300]), L('Les Cairns', t('les-cairns'))] },
    { id: 'vtt-du-canyon', name: 'VTT du Canyon', nameEn: 'Canyon MTB trail', loop: true, mode: 'mtb', bike: 'mtb', waypoints: [], along: 'Sentier du Canyon', landmarks: [L('Le Canyon', mid(cy.rim))] },
    { id: 'vtt-des-falaises', name: 'VTT des Falaises', nameEn: 'Cliffs MTB trail', loop: true, mode: 'mtb', bike: 'mtb', waypoints: [], along: 'Sentier des Falaises', landmarks: [L('Les Falaises Rouges', [9300, 7500])] },
    { id: 'vtt-des-arches', name: 'VTT des Arches', nameEn: 'Stone arches MTB trail', loop: true, mode: 'mtb', bike: 'mtb', waypoints: [], along: 'Sentier des Arches', landmarks: [L('Les Arches', [-3200, -4100])] },
  ];
}

/** Défaut d'un itinéraire selon les règles de verify.ts (marche, pente sur 10 m, demi-tour) ; null s'il est bon. */
function routeFlaw(r: RouteData): string | null {
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
  const farms = farmSites(70, (x, z) => forestMask(x, z, ctx0));
  log(`${farms.length} fermes`);
  const grid = await planningGrid(D.roads, D.gates, farms);
  log(`grille de tracé ${grid.n} × ${grid.m}`);
  const P: Plan = { grid, failed: [] };
  const net = planNetwork(P, D.gates, farms);
  log(`réseau tracé (${grid.links.size} liens)${P.failed.length ? `, ${P.failed.length} tracés impossibles` : ''}`);
  for (const f of P.failed) console.log(`   · impossible : ${f}`);
  const netRoads = networkRoads(grid, D.roads, D.gates);
  const dbgCol = (stage: string, list: Road[]) => {
    if (!process.env.ISLAND_DEBUG) return;
    for (const r of list) if (r.id === 'col-nord' || r.id === 'col-sud') console.log(`      [${stage}] ${r.id} ${r.pts.length} pts début ${r.pts.slice(0, 6).map((p) => p[1].toFixed(1)).join(' ')} … fin ${r.pts.slice(-6).map((p) => p[1].toFixed(1)).join(' ')} (${r.pts[0]!.map(Math.round).join(',')})`);
  };
  dbgCol('dessin', D.roads);
  const quays = portRoads([...D.roads, ...netRoads]);
  const kept = pruneMesh([...D.roads, ...netRoads, ...quays], false);
  joinCrossings(kept);
  dbgCol('croisements 1', kept);
  const roads0 = pruneMesh(kept, true);
  // Morceaux détachés du réseau principal (chemin de ferme resté seul) : retirés.
  const roads = (() => {
    const key = (p: Vec3) => `${Math.round(p[0] * 2)},${Math.round(p[2] * 2)}`;
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      const q = parent.get(k) ?? k;
      if (q === k) return k;
      const r = find(q);
      parent.set(k, r);
      return r;
    };
    for (const r of roads0) {
      const a = find(key(r.pts[0]!));
      for (const p of r.pts) {
        const b = find(key(p));
        if (a !== b) parent.set(b, a);
      }
    }
    const size = new Map<string, number>();
    for (const r of roads0) size.set(find(key(r.pts[0]!)), (size.get(find(key(r.pts[0]!))) ?? 0) + r.pts.length);
    const main = [...size].sort((a, b) => b[1] - a[1])[0]![0];
    const out = roads0.filter((r) => find(key(r.pts[0]!)) === main);
    if (out.length < roads0.length) log(`${roads0.length - out.length} tronçons détachés retirés`);
    return out;
  })();
  log(`maillage : ${D.roads.length + netRoads.length + quays.length - roads.length} tronçons écartés`);
  const nx = joinCrossings(roads);
  dbgCol('croisements 2', roads);
  for (const r of roads) if (r.pts.some((p) => !p.every(Number.isFinite))) console.log(`   · altitudes invalides : ${r.id} ${r.name} (${r.pts.length} points, ${r.pts.filter((p) => !p.every(Number.isFinite)).length} faux) ${r.pts[0]!.map(Math.round).join(',')}`);
  for (let pass = 0; pass < 3; pass++) {
    if (pass) smoothProfiles(roads);
    const xs = joinCrossings(roads);
    for (const r of roads) if (r.pts.length >= 2 && r.pts.some((p) => !p.every(Number.isFinite))) console.log(`   · altitudes invalides : ${r.id} ${r.name} (${r.pts.length} points) ${r.pts[0]!.map(Math.round).join(',')}`);
    for (let k = roads.length - 1; k >= 0; k--) if (roads[k]!.pts.length < 2) console.log(`   · tronçon vide retiré : ${roads.splice(k, 1)[0]!.name}`);
    log(`${xs} croisements, ${unifyEnds(roads)} raccords mis au même niveau, ${cleanRoads(roads)} points retirés`);
    // Tronçons réduits à un point (deux bouts confondus) : retirés.
    for (let k = roads.length - 1; k >= 0; k--) if (roads[k]!.pts.length < 2) console.log(`   · tronçon vide retiré : ${roads.splice(k, 1)[0]!.name}`);
  }
  if (process.env.ISLAND_DEBUG) {
    // Contrôles rapides (comme verify.ts) : terrassements, pentes sur 10 m.
    const bad = new Map<string, number>();
    for (const r of roads) {
      const lim = r.kind === 'track' ? 0.27 : r.kind === 'cycleway' ? 0.07 : 0.16;
      for (let i = 0; i < r.pts.length; i += 3) {
        const p = r.pts[i]!;
        const e = p[1] - terrain(p[0], p[2]);
        const q = r.pts[Math.min(r.pts.length - 1, i + 5)]!;
        const dd = Math.hypot(q[0] - p[0], q[2] - p[2]);
        const g = dd > 8 ? Math.abs(q[1] - p[1]) / dd : 0;
        if (Math.abs(e) > 50 || g > lim + 0.005) {
          const k = `${r.name} ${Math.abs(e) > 50 ? 'terrassement' : 'pente'} ${Math.round(p[0] / 500) * 500},${Math.round(p[2] / 500) * 500}`;
          bad.set(k, Math.max(bad.get(k) ?? 0, Math.abs(e) > 50 ? Math.abs(e) : g * 100));
        }
      }
    }
    for (const [k, v] of bad) console.log(`   · défaut : ${k} (${v.toFixed(0)})`);
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
    const palette = t.seaside ? 'villa' : t.port ? 'breton' : t.id === 'mesa-haute' ? 'chalet' : ['ksar-rouge', 'le-gue', 'l-oasis'].includes(t.id) ? 'provence' : 'village';
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
  const areas: Area[] = [...B.areas, ...fields, ...shore];
  const water = lakes();
  const ways = waterways((x, z) => idx.edgeDist(x, z) < 8);
  log(`${fields.length} parcelles, ${shore.length} morceaux de plage, ${water.length} plans d'eau, ${ways.length} cours d'eau`);

  // Raccords au carrefour : chaque route rejoint l'altitude du nœud du graphe (ramp de 30 m), puis creux relevés et
  // pentes plafonnées, carrefours tenus (contrôles de verify.ts sur les arêtes du graphe).
  {
    const g0 = buildGraph(roads);
    const N = g0.nodes.length / 3;
    const cells = new Map<string, number[]>();
    for (let k = 0; k < N; k++) {
      const key = `${Math.floor(g0.nodes[k * 3]! / 10)},${Math.floor(g0.nodes[k * 3 + 2]! / 10)}`;
      (cells.get(key) ?? cells.set(key, []).get(key)!).push(k);
    }
    let ramps = 0;
    let sags = 0;
    for (const r of roads) {
      if (r.designed && r.loop) continue;
      const nearest = () => {
        const out = new Map<number, { i: number; d: number }>();
        for (let i = 0; i < r.pts.length; i++) {
          const p = r.pts[i]!;
          const ci = Math.floor(p[0] / 10);
          const cj = Math.floor(p[2] / 10);
          for (let di = -1; di <= 1; di++)
            for (let dj = -1; dj <= 1; dj++)
              for (const k of cells.get(`${ci + di},${cj + dj}`) ?? []) {
                const d = Math.hypot(g0.nodes[k * 3]! - p[0], g0.nodes[k * 3 + 2]! - p[2]);
                if (d < 4.5 && (!out.has(k) || d < out.get(k)!.d)) out.set(k, { i, d });
              }
        }
        return out;
      };
      const n = r.pts.length;
      const pin = new Uint8Array(n);
      const best = nearest();
      for (let i = 0; i < 0; i++) {
        const p = r.pts[i]!;
        const ci = Math.floor(p[0] / 10);
        const cj = Math.floor(p[2] / 10);
        for (let di = -1; di <= 1; di++)
          for (let dj = -1; dj <= 1; dj++)
            for (const k of cells.get(`${ci + di},${cj + dj}`) ?? []) {
              const d = Math.hypot(g0.nodes[k * 3]! - p[0], g0.nodes[k * 3 + 2]! - p[2]);
              if (d < 4.5) {
                const b0 = best.get(k);
                if (!b0 || d < b0.d) best.set(k, { i, d });
              }
            }
      }
      for (const { i } of best.values()) pin[i] = 1;
      for (const [k, { i }] of r.designed ? [] : best) {
        const delta = g0.nodes[k * 3 + 1]! - r.pts[i]![1];
        if (Math.abs(delta) < 0.02) continue;
        ramps++;
        const span = Math.max(15, Math.ceil(Math.abs(delta) * 12));
        for (let o = -span; o <= span; o++) {
          const j = i + o;
          if (j < 0 || j >= n) continue;
          const t = 1 - Math.abs(o) / (span + 1);
          r.pts[j]![1] += delta * t * t * (3 - 2 * t);
        }
      }
      if (n < 12 || (r.designed && /^col-|route-de-la-mesa|piste-droite/.test(r.id))) continue;
      const lim = (r.kind === 'track' ? (GRAVELLY.has(r.surface) ? 0.19 : 0.25) : r.kind === 'cycleway' ? 0.065 : 0.155) * 2;
      for (let pass = 0; pass < 30; pass++) {
        let any = false;
        for (let i = 1; i < n; i++) {
          if (pin[i]) continue;
          const d = Math.hypot(r.pts[i]![0] - r.pts[i - 1]![0], r.pts[i]![2] - r.pts[i - 1]![2]) / 2;
          const y = r.pts[i]![1];
          const yy = Math.min(r.pts[i - 1]![1] + lim * d, Math.max(r.pts[i - 1]![1] - lim * d, y));
          if (Math.abs(yy - y) > 1e-4 && !pin[i - 1]) {
            r.pts[i]![1] = yy;
            any = true;
          }
        }
        for (let i = n - 2; i >= 0; i--) {
          if (pin[i]) continue;
          const d = Math.hypot(r.pts[i]![0] - r.pts[i + 1]![0], r.pts[i]![2] - r.pts[i + 1]![2]) / 2;
          const y = r.pts[i]![1];
          const yy = Math.min(r.pts[i + 1]![1] + lim * d, Math.max(r.pts[i + 1]![1] - lim * d, y));
          if (Math.abs(yy - y) > 1e-4) {
            r.pts[i]![1] = yy;
            any = true;
          }
        }
        for (let i = 4; i + 4 < n; i++) {
          const sag = (r.pts[i - 4]![1] + r.pts[i + 4]![1]) / 2 - r.pts[i]![1];
          if (sag > 0.07) {
            // Creux au carrefour même (point tenu) : les abords s'abaissent ; sinon le fond se relève.
            if (pin[i]) for (let k = -4; k <= 4; k++) { if (k && !pin[i + k]) r.pts[i + k]![1] -= (sag - 0.05) * (Math.abs(k) / 4); }
            else for (let k = -3; k <= 3; k++) if (!pin[i + k]) r.pts[i + k]![1] += (sag - 0.05) * (1 - Math.abs(k) / 4);
            any = true;
            sags++;
          }
        }
        if (!any) break;
      }
    }
    log(`${ramps} raccords aux carrefours, ${sags} creux relevés`);
  }
  // Graphe et itinéraires.
  const graph = buildGraph(roads);
  // Derniers creux aux abords des carrefours (le graphe remplace le bout de chaque tronçon par le nœud) : relevés de
  // quelques centimètres sur l'arête même, bouts inchangés.
  let gsags = 0;
  for (const e of graph.edges) {
    const m = e.pts.length / 3;
    for (let pass = 0; pass < 40; pass++) {
      let any = false;
      for (let i = 4; i + 4 < m; i++) {
        const sag = (e.pts[(i - 4) * 3 + 1]! + e.pts[(i + 4) * 3 + 1]!) / 2 - e.pts[i * 3 + 1]!;
        if (sag > 0.1) {
          for (let k = -3; k <= 3; k++) if (i + k > 0 && i + k < m - 1) e.pts[(i + k) * 3 + 1] = r2(e.pts[(i + k) * 3 + 1]! + (sag - 0.08) * (1 - Math.abs(k) / 4));
          any = true;
          gsags++;
        }
      }
      if (!any) break;
    }
  }
  if (gsags) log(`${gsags} creux relevés sur le graphe`);
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
  routes.push({ id: 'circuit-du-chott', name: 'Le Circuit du Chott', nameEn: 'Salt lake circuit', loop: true, lengthM: r2(anLen), elevationGainM: 0, points: anPoints, segments: timedSegments({ id: 'circuit-du-chott', sprints: [{ name: 'Sprint de la ligne opposée', x: ANNEAU.cx + 60, z: ANNEAU.cz - ANNEAU.radius, lengthM: 400 }, { name: 'Sprint des Tribunes', x: ANNEAU.cx + 30, z: ANNEAU.cz + ANNEAU.radius, lengthM: 400 }] }, { points: anPoints, lengthM: r2(anLen) } as RouteData), roadWidthM: ANNEAU.widthM, attribution: ATTRIBUTION, roadWidths: [{ startM: 0, endM: r2(anLen), widthM: ANNEAU.widthM }], surfaces: [{ startM: 0, endM: r2(anLen), surface: 'asphalt' }], landmarks: [{ name: 'Tribunes', d: 0 }], stepM: 2, minElevationM: ANNEAU.level, maxElevationM: ANNEAU.level, maxGradePct: 0, markings: 'full' });
  // Cyclo-cross et bike park : la boucle dessinée elle-même, départ à son raccord.
  const loopRoute = (roadId: string, id: string, name: string, nameEn: string, bike: 'gravel' | 'mtb', place: string, sprint: string): RouteData | null => {
    const lp = roads.find((r) => r.id === roadId);
    const g = D.gates.find((q) => q.town === ({ 'cyclo-cross': 'cross', 'bike-park': 'bikepark', 'mesa-loop': 'mesaloop' } as Record<string, string>)[roadId]);
    if (!lp || !g) return null;
    const k0 = lp.pts.reduce((bi, p, i) => (Math.hypot(p[0] - g.p[0], p[2] - g.p[1]) < Math.hypot(lp.pts[bi]![0] - g.p[0], lp.pts[bi]![2] - g.p[1]) ? i : bi), 0);
    const pts = [...lp.pts.slice(k0), ...lp.pts.slice(0, k0)].filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1]![0], p[2] - a[i - 1]![2]) > 1);
    let acc = 0;
    const points = pts.map((p, i) => {
      if (i) acc += Math.hypot(p[0] - pts[i - 1]![0], p[2] - pts[i - 1]![2]);
      return { x: r2(p[0]), y: r2(p[1]), z: r2(p[2]), d: r2(acc) };
    });
    const lengthM = r2(acc + Math.hypot(pts[0]![0] - pts[pts.length - 1]![0], pts[0]![2] - pts[pts.length - 1]![2]));
    let gain = 0;
    let gmax = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      gain += Math.max(0, b.y - a.y);
      const c = points[(i + 5) % points.length]!;
      const dd = Math.hypot(c.x - a.x, c.z - a.z);
      if (dd > 8) gmax = Math.max(gmax, Math.abs(c.y - a.y) / dd);
    }
    const ys = points.map((p) => p.y);
    const base = { points, lengthM } as RouteData;
    const half = points[Math.floor(points.length / 2)]!;
    return { id, name, nameEn, loop: true, lengthM, elevationGainM: r2(gain), points, segments: timedSegments({ id, sprints: [{ name: sprint, x: half.x, z: half.z, lengthM: 200 }] }, base), roadWidthM: lp.width, attribution: ATTRIBUTION, roadWidths: [{ startM: 0, endM: lengthM, widthM: lp.width }], surfaces: [{ startM: 0, endM: lengthM, surface: lp.surface }], landmarks: [{ name: place, d: 0 }], stepM: 2, minElevationM: Math.min(...ys), maxElevationM: Math.max(...ys), maxGradePct: Math.round(gmax * 1000) / 10, markings: 'none', bike };
  };
  for (const r of [loopRoute('cyclo-cross', 'cyclo-cross-des-sables', 'Le cyclo-cross des Sables', 'Sand cyclocross', 'gravel', 'Cyclo-cross des Sables', 'Sprint du sable'), loopRoute('bike-park', 'bike-park-des-buttes', 'Le bike park des Buttes', 'Buttes bike park', 'mtb', 'Bike park des Buttes', 'Chrono du bike park'), loopRoute('mesa-loop', 'gravel-de-la-mesa', 'Gravel de la Grande Mesa', 'Great Mesa gravel', 'gravel', 'Mesa-Haute', 'Sprint du belvédère')]) {
    if (!r) continue;
    const why = routeFlaw(r);
    if (why) console.log(`   · itinéraire écarté : ${r.id} (${why})`);
    else routes.push(r);
  }
  const obs0 = D.roads.find((r) => r.id === 'col-observatoire')!.pts[40]!;
  for (const spec of routeSpecs({ ...net, mesaBas: D.gates.find((g) => g.town === 'mesa-bas')!.p, obs: [obs0[0], obs0[2]] })) {
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
      if (process.env.ISLAND_DEBUG) {
        const m = /à (-?\d+), (-?\d+)/.exec(flaw);
        if (m) {
          const [fx, fz] = [Number(m[1]), Number(m[2])];
          graph.edges.forEach((e) => {
            const n = e.pts.length / 3;
            for (const k of [0, n - 1]) if (Math.hypot(e.pts[k * 3]! - fx, e.pts[k * 3 + 2]! - fz) < 6) console.log(`      ${e.name} (${e.kind}) bout ${k ? 'fin' : 'début'} y ${e.pts[k * 3 + 1]!.toFixed(2)} voisin y ${e.pts[(k ? k - 3 : 3) * 3 + 1]?.toFixed(2)}`);
          });
        }
      }
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
  const res = await runPool<{ min: number; max: number; baseM: number; stepM: number; hi: boolean; bytes: number; forests: Array<{ kind: string; rings: Vec2[][] }>; heath: Vec2[][]; rock: Vec2[][]; sand: Vec2[][] }>(
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
    if (h.sand.length) tile.fields.push({ id: `sable-${t.id}`, kind: 'sand', rings: h.sand.map(flatRing) });
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
  const sr = TOWNS.find((t) => t.id === 'rocherouge')!;
  const meta: WorldMeta = {
    formatVersion: 1,
    id: ISLAND.id,
    name: ISLAND.name,
    crs: 'EPSG:2154',
    // Repère fictif, en Méditerranée au sud-est de la Corse : ne recouvre aucune zone réelle ni un autre monde Poly.
    originL93: { x: 1330000, y: 5700000 },
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
    mainRoute: 'circuit-du-chott',
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
