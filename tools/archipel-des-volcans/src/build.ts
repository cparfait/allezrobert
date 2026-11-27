/**
 * Générateur de l'Archipel des volcans (voir docs/ARCHIPEL_DES_VOLCANS.md), monde du mode Poly, tiré du générateur
 * du Pays de Robert (tools/massif) : écrit un monde au format des mondes réels (world.json, tiles/*.json +
 * .lo/.hi.u16, routes/*.json, graph.json, places.json) dans apps/client/public/worlds/archipel-des-volcans (ou
 * ISLAND_OUT), puis lance les contrôles automatiques (verify.ts).
 *
 *   ISLAND_OUT=D:/zzCACHE_ALLEZROBERT/zones-travail/archipel-des-volcans node node_modules/tsx/dist/cli.mjs tools/archipel-des-volcans/src/build.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RouteData, WorldMeta, WorldTile } from '../../../packages/shared/src/route.ts';
import { ANNEAU, CINDER, HARBOURS, ISLAND, ISLES, LAKES, SEA_LINKS, TOWNS, VOLCANO, anneauLoop, cliffiness, coastPoint, inHarbour, inLake, inRiver, rimPoint, shoreDist, terrain, type Vec2 } from './design.ts';
import { chaikin, clipPolygon, clipPolyline, polygonArea, resample, type Vec3 } from './geom.ts';
import { forestMask, lakes, parcels, shoreAreas, waterways, type LandCtx } from './land.ts';
import { fbm, rng, smoothstep } from './noise.ts';
import { CELL, CLASSES, CLASS_BY_RANK, Grid, type RoadClass } from './planner.ts';
import { runPool } from './pool.ts';
import { ATTRIBUTION, RoadIndex, buildGraph, cleanRoads, joinCrossings, nearestOn, smoothProfiles, unifyEnds, makeRoad, nodeHeight, profile, r2, snapEnds, type Road, type RoadSpec } from './roads.ts';
import { planRoute, timedSegments, type RouteSpec } from './routes.ts';
import { harbourPoint, portRoads } from './ports.ts';
import { encodeRoute } from '../../../packages/shared/src/routeCodec.ts';
import { ANNEAU_GATES, Builder, LIGHTHOUSE, OBSERVATORY, farmBuildings, farmSites, landmarks, roadsideHouses, seasideBuildings, townCentre, townLayout, type TownLayout } from './settle.ts';
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

// ── 1. Routes dessinées : Circuit, rues des villes, front de mer, route du Cratère, pont et chaussée ──

export function designedRoads(): { roads: Road[]; layouts: TownLayout[]; anneau: Road; cross: Road; gates: Array<{ p: Vec2; y: number; dir: Vec2; town?: string }> } {
  const anneau = makeRoad({ id: 'anneau', name: 'Circuit des Laves', kind: 'tertiary', width: ANNEAU.widthM, pts: anneauLoop(2), loop: true, designed: true, gmax: 0.01 });
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
  // Route du Cratère : d'Aigues-Chaudes à la brèche du rebord, en lacets ; route de l'Observatoire en bifurque.
  const wet = (x: number, z: number) => inLake(x, z, 1.5) || inRiver(x, z, 25) || shoreDist(x, z) < 150;
  const rim = rimPoint(28);
  const rimY = terrain(rim[0], rim[1]);
  const ac = gates.filter((g) => g.town === 'aigues-chaudes').sort((a, b) => Math.hypot(a.p[0] - rim[0], a.p[1] - rim[1]) - Math.hypot(b.p[0] - rim[0], b.p[1] - rim[1]))[0]!;
  ac.town = 'cratere-pied'; // porte réservée à la montée (le réseau passe par les autres)
  // Départ dans le prolongement d'une rue (pas d'épingle au raccord).
  const ahead = (g: { p: Vec2; dir: Vec2 }, m: number): Vec2 => {
    const l = Math.hypot(g.dir[0], g.dir[1]) || 1;
    return [g.p[0] + (g.dir[0] / l) * m, g.p[1] + (g.dir[1] / l) * m];
  };
  const lacets = (from: Vec2, to: Vec2, grade: number, half: number): Vec2[] => simplifyPath(switchbacks(from, to, { grade, halfWidth: half, turn: 30, blocked: wet }), 3);
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
  const upPts = [ac.p, ...lacets(ahead(ac, 60), rim, 0.066, 460)];
  const upPath = fillet(upPts, 16);
  const crater = makeRoad({ id: 'route-du-cratere', name: 'Route du Cratère', kind: 'tertiary', width: 6, pts: upPath, designed: true, gmax: 0.12, smooth: 0, y0: ac.y, y1: rimY });
  const yUp = (p: Vec2) => nearestOn(crater, p[0], p[1]).y;
  roads.push(crater);
  // Route de l'Observatoire : bifurque de la montée vers 820 m et monte en lacets sur l'épaule est.
  let bi = 0;
  crater.pts.forEach((p, i) => {
    const score = (q: Vec3) => Math.abs(q[1] - 820) + Math.hypot(q[0] - OBSERVATORY[0], q[2] - OBSERVATORY[1]) * 0.05;
    if (i > 20 && i < crater.pts.length - 20 && score(p) < score(crater.pts[bi]!)) bi = i;
  });
  const branch = crater.pts[bi]!;
  const toObs: Vec2 = [OBSERVATORY[0] - branch[0], OBSERVATORY[1] - branch[2]];
  const tl = Math.hypot(toObs[0], toObs[1]);
  const obsEnd: Vec2 = [OBSERVATORY[0] - (toObs[0] / tl) * 40, OBSERVATORY[1] - (toObs[1] / tl) * 40];
  const obsUp = lacets([branch[0], branch[2]], obsEnd, 0.07, 300);
  const obsPath = fromLastCross(fillet([[branch[0], branch[2]], ...obsUp.slice(1)], 14), upPath);
  const obs = makeRoad({ id: 'route-de-l-observatoire', name: "Route de l'Observatoire", kind: 'unclassified', width: 4.5, pts: obsPath, designed: true, gmax: 0.12, smooth: 0, y0: yUp(obsPath[0]!) });
  roads.push(obs);
  const top: Vec3 = crater.pts[crater.pts.length - 1]!;
  const tp = crater.pts[Math.max(0, crater.pts.length - 8)]!;
  gates.push({ p: [top[0], top[2]], y: top[1], dir: [top[0] - tp[0], top[2] - tp[2]], town: 'cratere' });
  const oe: Vec3 = obs.pts[obs.pts.length - 1]!;
  const op = obs.pts[Math.max(0, obs.pts.length - 8)]!;
  gates.push({ p: [oe[0], oe[2]], y: oe[1], dir: [oe[0] - op[0], oe[2] - op[2]], town: 'observatoire' });
  // Pont des Orgues et Chaussée : routes sur la mer, de culée à culée (portes aux deux bouts).
  for (const l of SEA_LINKS) {
    const dx = l.b[0] - l.a[0];
    const dz = l.b[1] - l.a[1];
    const L = Math.hypot(dx, dz);
    // Légère courbe (le tracé n'est pas une règle) et 120 m droits aux deux bouts.
    const nx = -dz / L;
    const nz = dx / L;
    const pts: Vec2[] = Array.from({ length: 41 }, (_, k) => {
      const t = k / 40;
      const o = l.bridge ? 35 * Math.sin(Math.PI * t) : 0;
      return [l.a[0] + dx * t + nx * o, l.a[1] + dz * t + nz * o];
    });
    const ya = terrain(l.a[0], l.a[1]);
    const yb = terrain(l.b[0], l.b[1]);
    const road = makeRoad({ id: l.id, name: l.name, kind: 'tertiary', width: l.bridge ? 7 : 6.5, pts, designed: true, gmax: 0.04, smooth: 0, y0: ya, y1: yb });
    // Profil imposé : tablier en dos d'âne (pont) ou chaussée à niveau constant, raccord doux aux culées.
    const n = road.pts.length;
    road.pts.forEach((p, i) => {
      const t = i / (n - 1);
      const base = ya + (yb - ya) * t;
      const lift = l.bridge ? 1 - (2 * t - 1) ** 4 : smoothstep(0, 0.12, t) * smoothstep(1, 0.88, t);
      p[1] = base + (l.deck - (l.bridge ? (ya + yb) / 2 : base)) * lift;
    });
    if (l.bridge) road.bridge = true;
    roads.push(road);
    for (const [end, inner, tag] of [[road.pts[0]!, road.pts[6]!, `${l.id}-a`], [road.pts[n - 1]!, road.pts[n - 7]!, `${l.id}-b`]] as const) gates.push({ p: [end[0], end[2]], y: end[1], dir: [end[0] - inner[0], end[2] - inner[2]], town: tag });
  }
  for (const g of ANNEAU_GATES) {
    let best = anneau.pts[0]!;
    for (const p of anneau.pts) if (Math.hypot(p[0] - g[0], p[2] - g[1]) < Math.hypot(best[0] - g[0], best[2] - g[1])) best = p;
    const out: Vec2 = [g[0] - ANNEAU.cx - Math.sign(g[0] - ANNEAU.cx) * Math.min(Math.abs(g[0] - ANNEAU.cx), ANNEAU.half), g[1] - ANNEAU.cz];
    gates.push({ p: [best[0], best[2]], y: best[1], dir: out, town: 'anneau' });
  }
  // Circuit de cyclo-cross des Cendres : petite boucle dessinée (prés, sable, cendre), une porte vers le réseau.
  const cross = makeRoad({ id: 'cyclo-cross', name: 'Circuit de cyclo-cross', kind: 'track', width: 3, surface: 'grass', pts: crossLoop(), loop: true, designed: true, gmax: 0.12 });
  roads.push(cross);
  let ce = 0;
  cross.pts.forEach((p, i) => {
    if (p[0] > cross.pts[ce]![0]) ce = i;
  });
  const cg = cross.pts[ce]!;
  gates.push({ p: [cg[0], cg[2]], y: cg[1], dir: [1, 0], town: 'cyclo-cross' });
  return { roads, layouts, anneau, gates, cross };
}

/** Cyclo-cross des Cendres : boucle sinueuse d'≈ 1,9 km dans la plaine de l'ouest. */
export const CROSS = { x: -10600, z: 3600 };
function crossLoop(): Vec2[] {
  return Array.from({ length: 120 }, (_, k) => {
    const a = (k / 120) * Math.PI * 2;
    const r = 1 + 0.2 * Math.sin(3 * a) + 0.1 * Math.sin(5 * a + 1);
    return [CROSS.x + Math.cos(a) * 300 * r, CROSS.z + Math.sin(a) * 210 * r] as Vec2;
  });
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

type Trail = { name: string; mtb?: boolean; seed?: number } & ({ at: Vec2; r: number; n: number } | { line: Vec2[] });
const shorePath = (from: number, to: number, n: number, inset: number, isle = 0): Vec2[] => Array.from({ length: n + 1 }, (_, k) => coastPoint(from + ((to - from) * k) / n, inset, isle));

/** Pistes gravel et sentiers VTT : boucles (centre, rayon) et traversées (points de passage). */
const TRAILS: Trail[] = [
  { name: 'Chemin des Cendres', at: [-7200, -3100], r: 750, n: 8 },
  { name: 'Chemin des Vignes', at: [-9600, -2000], r: 1000, n: 8 },
  { name: 'Chemin de la Forêt', at: [5600, -4700], r: 1100, n: 8 },
  { name: 'Chemin des Terrasses', at: [6300, 2500], r: 1000, n: 8 },
  { name: 'Chemin des Orgues', at: [16000, -4400], r: 950, n: 8 },
  { name: 'Chemin de Sable-Noir', at: [14000, 8500], r: 1000, n: 8, seed: 2 },
  { name: 'Chemin des Fumerolles', at: [1700, 1300], r: 700, n: 7 },
  { name: 'Chemin de la Coulée', at: [-5700, 2900], r: 900, n: 8, seed: 5 },
  { name: 'Chemin du Littoral', line: shorePath(1.95, 2.45, 6, 300) },
  { name: 'Sentier de la Lande', mtb: true, at: [-4300, -5300], r: 800, n: 8 },
  { name: 'Descente du Volcan', mtb: true, line: [[OBSERVATORY[0] + 140, OBSERVATORY[1] + 120], [2600, -1500], [4400, -1000], [6100, -1400]] },
  { name: 'Sentier de la Forêt', mtb: true, at: [3600, -6400], r: 800, n: 8 },
  { name: 'Sentier des Orgues', mtb: true, at: [16400, -2700], r: 600, n: 7 },
  { name: 'Sentier de la Coulée', mtb: true, at: [-10300, 700], r: 750, n: 8 },
  { name: 'Sentier de la Ravine', mtb: true, at: [7400, -5700], r: 700, n: 8 },
  // Petites boucles : cyclo-cross sur la cendre près de Sainte-Iris, bike park sur les pentes du Mont Cendre.
  { name: 'Bike park du Mont Cendre', mtb: true, at: [CINDER.x - 250, CINDER.z + 120], r: 380, n: 7, seed: 3 },
];

/**
 * Matière et largeur des chemins, tronçon après tronçon (jamais deux pareils à la suite) : stabilisé (gravel), pierre
 * (pebblestone), gravier fin (fine_gravel), pavés (cobblestone), terre (dirt), terre brune (earth), sable et cendre
 * (sand), herbe (grass), roche (rock). Les sentiers restent étroits, quelques chemins s'ouvrent à 4,4 m.
 */
const SKIN: Record<string, Array<[surface: string, width: number]>> = {
  'Chemin des Cendres': [['fine_gravel', 3.6], ['gravel', 3.2], ['pebblestone', 3]],
  'Chemin des Vignes': [['gravel', 3.2], ['cobblestone', 3.4], ['fine_gravel', 4]],
  'Chemin de la Forêt': [['gravel', 3.4], ['fine_gravel', 3], ['pebblestone', 3.2]],
  'Chemin des Terrasses': [['fine_gravel', 3.6], ['pebblestone', 2.8], ['gravel', 3.2]],
  'Chemin des Orgues': [['pebblestone', 3], ['gravel', 3.4], ['fine_gravel', 2.8]],
  'Chemin de Sable-Noir': [['fine_gravel', 4.4], ['gravel', 3.4], ['fine_gravel', 2.8]],
  'Chemin des Fumerolles': [['gravel', 3], ['fine_gravel', 3.8], ['pebblestone', 3.2]],
  'Chemin de la Coulée': [['pebblestone', 3.2], ['gravel', 3.6], ['fine_gravel', 4.4], ['gravel', 2.8]],
  'Chemin du Littoral': [['fine_gravel', 3], ['gravel', 2.6], ['pebblestone', 3.4]],
  'Sentier de la Lande': [['grass', 2.6], ['rock', 2.2], ['sand', 2]],
  'Descente du Volcan': [['dirt', 2.2], ['rock', 2.6], ['earth', 2]],
  'Sentier de la Forêt': [['earth', 2], ['dirt', 2.2], ['grass', 2.4]],
  'Sentier des Orgues': [['rock', 2.4], ['grass', 2.2], ['dirt', 2]],
  'Sentier de la Coulée': [['rock', 2.2], ['earth', 2], ['rock', 2.6]],
  'Sentier de la Ravine': [['dirt', 2.2], ['earth', 1.9], ['grass', 2.6]],
  'Bike park du Mont Cendre': [['sand', 2.4], ['dirt', 2.2], ['earth', 2.4]],
};

const LANE_NAMES = ['des Fougères', 'du Vieux Cratère', 'des Quatre Vents', 'de la Croix Noire', 'des Basaltes', 'des Alizés', 'du Lavoir', 'de la Butte', 'des Hibiscus', 'du Grand Pré', 'de la Source', 'des Flamboyants', 'du Moulin Brûlé', 'des Cendres', 'des Bananiers', 'du Calvaire', 'de la Scorie', 'des Colibris', 'du Pont Neuf', 'de la Forge', 'des Vergers', 'du Coteau', 'des Lianes', 'des Bruyères', 'du Morne', 'de la Mare', 'des Orchidées', 'du Berger'];

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

export interface Net {
  ring: Vec2[];
  cendres: Vec2[];
  crater: Vec2;
  observatory: Vec2;
}

export function planNetwork(P: Plan, gates: Array<{ p: Vec2; town?: string }>, farms: Array<{ gate: Vec2 }>): Net {
  const C = CLASSES;
  const town = (id: string) => TOWNS.find((t) => t.id === id)!;
  const G = (id: string, toward: Vec2 | string) => nearestGate(gates, id, typeof toward === 'string' ? [town(toward).x, town(toward).z] : toward);
  const gate = (tag: string) => gates.find((g) => g.town === tag)!.p;
  // a. Route du tour de la Grande Île : points le long de la côte, villes côtières traversées par leurs rues.
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
    // Secteur en falaise : le haut de la paroi est déjà raide et bosselé ; un point repoussé loin dans les terres y
    // ferait faire un aller-retour serré à la route du Tour. On le saute, la route relie ses voisins.
    if (inset >= 3600 || (inset > 1000 && cliffiness(ang, 0) > 0.3)) continue;
    ring.push({ p, ang });
  }
  for (const id of ['sainte-iris', 'port-lave', 'le-pont', 'la-chaussee']) {
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
    connect(P, a.p, b.p, [C.secondary, C.tertiary, C.lane, steep], 'Route du Tour de l’Île', 220);
  }
  // b. Grands axes depuis La Plaine, routes communales.
  for (const to of ['sainte-iris', 'port-lave', 'aigues-chaudes', 'vigne-noire']) connect(P, G('la-plaine', to), G(to, 'la-plaine'), [C.secondary, C.tertiary, C.lane], `Route de ${town(to).name}`);
  const tert: Array<[string, string]> = [
    ['aigues-chaudes', 'les-terrasses'], ['aigues-chaudes', 'sainte-iris'], ['les-terrasses', 'sainte-iris'], ['les-terrasses', 'la-chaussee'],
    ['rocheverte', 'le-pont'], ['rocheverte', 'les-terrasses'], ['vigne-noire', 'port-lave'], ['rocheverte', 'aigues-chaudes'],
  ];
  for (const [a, b] of tert) connect(P, G(a, b), G(b, a), [C.tertiary, C.lane, steep], `Route de ${town(b).name}`, 200);
  // c. Le Pont des Orgues et la Chaussée : raccordés aux hameaux du Pont et de la Chaussée, et aux villages d'en face.
  connect(P, gate('pont-des-orgues-a'), G('le-pont', gate('pont-des-orgues-a')), [C.tertiary, C.lane, steep], 'Route du Pont', 200);
  connect(P, gate('pont-des-orgues-b'), G('les-orgues', gate('pont-des-orgues-b')), [C.tertiary, C.lane, steep], 'Route du Pont', 200);
  connect(P, gate('la-chaussee-a'), G('la-chaussee', gate('la-chaussee-a')), [C.tertiary, C.lane, steep], 'Route de la Chaussée', 200);
  connect(P, gate('la-chaussee-b'), G('sable-noir', gate('la-chaussee-b')), [C.tertiary, C.lane, steep], 'Route de la Chaussée', 200);
  // Île des Orgues : route du Phare ; Île de Sable-Noir : tour de l'île.
  connect(P, G('les-orgues', LIGHTHOUSE), coastPoint(0.05, 160, 1), [C.tertiary, C.lane, steep], 'Route du Phare', 220);
  const sn = ISLES[2]!;
  const snLoop = [0.6, 1.6, 2.6, -2.2, -1.2, -0.3].map((a) => coastPoint(a, 420, 2));
  for (let k = 0; k < snLoop.length; k++) connect(P, snLoop[k]!, snLoop[(k + 1) % snLoop.length]!, [C.tertiary, C.lane, steep], 'Route du Tour de Sable-Noir', 200);
  void sn;
  spur(P, snLoop[3]!, C.tertiary, 5, 'Route du Tour de Sable-Noir', 150);
  const og = ISLES[1]!;
  const ogLoop = [2.4, -2.3, -1.3, -0.4, 0.6, 1.5].map((a) => coastPoint(a, 480, 1));
  for (let k = 0; k < ogLoop.length; k++) connect(P, ogLoop[k]!, ogLoop[(k + 1) % ogLoop.length]!, [C.tertiary, C.lane, steep], 'Route du Plateau des Orgues', 200);
  void og;
  spur(P, ogLoop[0]!, C.tertiary, 5, 'Route du Plateau des Orgues', 150);
  // d. Circuit des Laves.
  const anneauGate = (k: number) => gates.filter((g) => g.town === 'anneau')[k]!.p;
  connect(P, anneauGate(0), G('la-plaine', anneauGate(0)), [C.tertiary, C.lane, steep], 'Route du Circuit');
  connect(P, anneauGate(3), G('port-lave', anneauGate(3)), [C.tertiary, C.lane, steep], 'Route du Circuit');
  connect(P, anneauGate(1), G('port-lave', anneauGate(1)), [C.tertiary, C.lane, steep], 'Route du Circuit');
  spur(P, gate('cyclo-cross'), C.track, 5, 'Chemin du cyclo-cross', 150);
  // e. Pistes cyclables et voies vertes.
  const cyc = [C.cycleway, { ...C.cycleway, gmax: 0.06 }];
  connect(P, G('la-plaine', anneauGate(2)), anneauGate(2), cyc, 'La Piste du Circuit');
  connect(P, G('la-plaine', 'port-lave'), G('port-lave', 'la-plaine'), cyc, 'Voie verte des Laves');
  connect(P, G('sainte-iris', coastPoint(1.3, 800)), G('les-terrasses', 'sainte-iris'), cyc, 'Voie verte de la Baie');
  connect(P, G('sainte-iris', 'la-plaine'), G('la-plaine', 'sainte-iris'), cyc, 'Voie verte des Cendres');
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
  // g. Gravel et VTT : chemins et sentiers de chaque région (TRAILS).
  let cendres: Vec2[] = [];
  for (const [k0, t] of TRAILS.entries()) {
    const cls = t.mtb ? [C.mtb, { ...C.mtb, gmax: 0.24 }] : [C.track, { ...C.track, gmax: 0.16 }];
    if ('r' in t) {
      const good = loopConnect(loopPts(t.at[0], t.at[1], t.r, t.n, t.mtb ? 0.65 : 0.45, rng(7100 + k0 + (t.seed ?? 0))), cls, t.name);
      if (t.name === 'Chemin des Cendres') cendres = good;
    } else {
      const pts = t.line.filter(okPt);
      const occ0 = new Set(pts.filter((p) => P.grid.occ[P.grid.cellAt(p[0], p[1])]! >= 5));
      for (let k = 0; k + 1 < pts.length; k++) connect(P, pts[k]!, pts[k + 1]!, cls, t.name);
      for (const p of [pts[0], pts[pts.length - 1]]) if (p && !occ0.has(p)) spur(P, p, cls[0]!, 5, t.name);
    }
  }
  return { ring: ring.map((q) => q.p), cendres, crater: gate('cratere'), observatory: gate('observatoire') };
}

const angle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Rayon (m) du cercle passant par trois points (Infinity s'ils sont alignés). */
function circum(a: Vec2, b: Vec2, c: Vec2): number {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return cross < 1e-9 ? Infinity : (ab * bc * ca) / (2 * cross);
}

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
    // Flancs du volcan : les routes suivent la pente.
    if (d.some((p) => Math.hypot(p[0] - VOLCANO.x, p[1] - VOLCANO.z) < 5200)) return { pts: d, held };
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
    // Grandes routes : un coude resté trop serré (raccord de deux morceaux au pied d'une falaise, méandre) est
    // adouci par lissage local, nœuds imposés et extrémités tenus. Seulement sous ≈ 9 m de rayon (contrôle à 7,5 m).
    if (!opts.designed && CLASS_BY_RANK[Math.max(...ch.edges.map(({ k }) => edges[k]!.rank))]!.id === 'secondary') {
      const held = new Set<number>([0, dense.length - 1, ...hardAt.values()]);
      const tight = (i: number) => i >= 3 && i + 3 < dense.length && circum(dense[i - 3]!, dense[i]!, dense[i + 3]!) < 9;
      for (let pass = 0; pass < 40; pass++) {
        const hot = new Set<number>();
        for (let i = 3; i + 3 < dense.length; i++) if (tight(i)) for (let j = i - 8; j <= i + 8; j++) if (j > 0 && j < dense.length - 1 && !held.has(j)) hot.add(j);
        if (!hot.size) break;
        const prev = dense.map((p) => [p[0], p[1]] as Vec2);
        for (const j of hot) dense[j] = [prev[j]![0] + 0.5 * ((prev[j - 1]![0] + prev[j + 1]![0]) / 2 - prev[j]![0]), prev[j]![1] + 0.5 * ((prev[j - 1]![1] + prev[j + 1]![1]) / 2 - prev[j]![1])];
      }
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
      const cap = Math.min(cls.kind === 'track' ? 0.27 : 0.16, Math.max(cls.gmax + 0.005, steepest * 1.05));
      const y = profile(xz, false, cls.id === 'track' ? 24 : cls.id === 'mtb' ? 40 : 30, cap, endY(xz[0]!), endY(xz[xz.length - 1]!));
      const skins = cls.kind === 'track' ? SKIN[e.label ?? ''] : undefined;
      const nth = counts.get(`·${e.label}`) ?? 0;
      if (skins) counts.set(`·${e.label}`, nth + 1);
      const [surface, width0] = skins ? skins[nth % skins.length]! : [cls.surface, cls.width];
      // Flancs du volcan : les grands axes deviennent des routes de montagne (virages plus serrés permis).
      const mountain = cls.id === 'secondary' && xz.some(([x, z]) => Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < 9500);
      const kind = mountain ? CLASSES.tertiary.kind : cls.kind;
      const width = mountain ? CLASSES.tertiary.width : width0;
      const n = (counts.get(cls.id) ?? 0) + 1;
      counts.set(cls.id, n);
      out.push({
        id: `${opts.prefix ?? ''}${cls.id}-${n}`,
        ...(opts.designed ? { designed: true } : {}),
        name: e.label || cls.id,
        kind,
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

function routeSpecs(net: Net): RouteSpec[] {
  const t = (id: string): Vec2 => {
    const q = TOWNS.find((x) => x.id === id)!;
    return [q.x, q.z];
  };
  const L = (name: string, p: Vec2) => ({ name, x: p[0], z: p[1] });
  const si = TOWNS.find((x) => x.id === 'sainte-iris')!;
  const ang = Math.atan2(si.z, si.x);
  const east = ang - 0.055;
  const west = ang + 0.145;
  // Rues de derrière de La Plaine (critérium).
  const vr = TOWNS.find((x) => x.id === 'la-plaine')!;
  const u: Vec2 = [Math.cos(vr.angle), Math.sin(vr.angle)];
  const v: Vec2 = [-u[1], u[0]];
  const V = (a: number, b: number): Vec2 => [vr.x + (a * u[0] + b * v[0]) * vr.r, vr.z + (a * u[1] + b * v[1]) * vr.r];
  const sn = (a: number) => coastPoint(a, 420, 2);
  const og = (a: number) => coastPoint(a, 480, 1);
  const pont: Vec2 = [(SEA_LINKS[0]!.a[0] + SEA_LINKS[0]!.b[0]) / 2, (SEA_LINKS[0]!.a[1] + SEA_LINKS[0]!.b[1]) / 2];
  const chaussee: Vec2 = [(SEA_LINKS[1]!.a[0] + SEA_LINKS[1]!.b[0]) / 2, (SEA_LINKS[1]!.a[1] + SEA_LINKS[1]!.b[1]) / 2];
  const lac = LAKES.find((l) => l.id === 'etang-des-laves')!;
  return [
    // Route.
    { id: 'decouverte-de-l-archipel', name: 'Découverte de l’Archipel', nameEn: 'Archipelago discovery ride', loop: true, mode: 'road', waypoints: [t('la-plaine'), ANNEAU_GATES[3]!, ANNEAU_GATES[0]!], landmarks: [L('La Plaine', t('la-plaine')), L('Circuit des Laves', [ANNEAU.cx, ANNEAU.cz]), L('Étang des Laves', [lac.x, lac.z])] },
    { id: 'classique-des-trois-iles', name: 'La Classique des Trois Îles', nameEn: 'Three Islands Classic', loop: false, mode: 'road', waypoints: [t('les-orgues'), t('le-pont'), t('rocheverte'), t('les-terrasses'), t('la-chaussee'), t('sable-noir')], sprints: [{ name: 'Sprint de Rocheverte', x: t('rocheverte')[0], z: t('rocheverte')[1] }, { name: 'Sprint de la Chaussée', x: chaussee[0], z: chaussee[1], lengthM: 500 }], landmarks: [L('Les Orgues', t('les-orgues')), L('Pont des Orgues', pont), L('Rocheverte', t('rocheverte')), L('Les Terrasses', t('les-terrasses')), L('La Chaussée', chaussee), L('Sable-Noir', t('sable-noir'))] },
    { id: 'chrono-de-la-chaussee', name: 'Le chrono de la Chaussée', nameEn: 'Causeway time trial', loop: false, mode: 'road', waypoints: [t('la-chaussee'), sn(-0.3), t('sable-noir')], landmarks: [L('La Chaussée', chaussee), L('Sable-Noir', t('sable-noir'))] },
    { id: 'cratere-de-nuit', name: 'Le Cratère de nuit', nameEn: 'Crater by night', loop: false, mode: 'road', waypoints: [t('aigues-chaudes'), net.crater], hairpins: true, climbNames: ['Le Volcan'], landmarks: [L('Aigues-Chaudes', t('aigues-chaudes')), L('La Brèche du Cratère', net.crater)] },
    { id: 'montee-du-volcan', name: 'La montée du Volcan', nameEn: 'Volcano climb', loop: false, mode: 'road', waypoints: [t('sainte-iris'), t('aigues-chaudes'), net.crater], hairpins: true, climbNames: ['Côte d’Aigues-Chaudes', 'Le Volcan'], landmarks: [L('Sainte-Iris', t('sainte-iris')), L('Aigues-Chaudes', t('aigues-chaudes')), L('Lac du Cratère', [VOLCANO.x, VOLCANO.z])] },
    { id: 'route-de-l-observatoire', name: "La route de l'Observatoire", nameEn: 'Observatory climb', loop: false, mode: 'road', waypoints: [t('aigues-chaudes'), net.observatory], hairpins: true, climbNames: ["L'Observatoire"], landmarks: [L('Observatoire du volcan', OBSERVATORY)] },
    { id: 'tour-de-l-ile', name: 'Le Tour de la Grande Île', nameEn: 'Round the Great Island', loop: true, mode: 'road', waypoints: net.ring.filter((_, k) => k % 2 === 0), sprints: [{ name: 'Sprint de Port-Lave', x: t('port-lave')[0], z: t('port-lave')[1] }, { name: 'Sprint de Sainte-Iris', x: t('sainte-iris')[0], z: t('sainte-iris')[1] }], landmarks: TOWNS.filter((x) => x.isle === 0 && shoreDist(x.x, x.z) < 1500).map((x) => L(x.name, [x.x, x.z])) },
    { id: 'criterium-de-la-plaine', name: 'Le critérium de La Plaine', nameEn: 'La Plaine criterium', loop: true, mode: 'road', waypoints: [V(-0.55, -0.36), V(0.55, -0.36), V(0.55, 0.36), V(-0.55, 0.36)], sprints: [{ name: 'Sprint de la Grand-Rue', x: V(0.3, 0)[0], z: V(0.3, 0)[1] }], landmarks: [L('Place de La Plaine', t('la-plaine'))] },
    { id: 'boucle-de-la-plaine', name: 'La boucle de La Plaine', nameEn: 'La Plaine loop', loop: true, mode: 'road', waypoints: [t('la-plaine'), ANNEAU_GATES[0]!, t('port-lave')], sprints: [{ name: 'Sprint de Port-Lave', x: t('port-lave')[0], z: t('port-lave')[1] }], landmarks: [L('La Plaine', t('la-plaine')), L('Circuit des Laves', [ANNEAU.cx, ANNEAU.cz]), L('Port-Lave', t('port-lave'))] },
    { id: 'route-des-vignes', name: 'La route des Vignes', nameEn: 'Vineyard road', loop: true, mode: 'road', waypoints: [t('la-plaine'), t('vigne-noire'), t('port-lave')], landmarks: [L('Vigne-Noire', t('vigne-noire')), L('Cave de la Vigne-Noire', [-8400, -3300]), L('Port-Lave', t('port-lave'))] },
    { id: 'route-de-la-foret', name: 'La route de la Forêt', nameEn: 'Rainforest road', loop: true, mode: 'road', waypoints: [t('rocheverte'), t('le-pont'), t('les-terrasses')], landmarks: [L('Rocheverte', t('rocheverte')), L('Chapelle de la Forêt', [8200, -1700]), L('Le Pont', t('le-pont'))] },
    { id: 'boucle-des-terrasses', name: 'La boucle des Terrasses', nameEn: 'Terraces loop', loop: true, mode: 'road', waypoints: [t('sainte-iris'), t('les-terrasses'), t('aigues-chaudes')], sprints: [{ name: 'Sprint des Terrasses', x: t('les-terrasses')[0], z: t('les-terrasses')[1] }], landmarks: [L('Sainte-Iris', t('sainte-iris')), L('Moulin des Terrasses', [6400, 3500]), L('Aigues-Chaudes', t('aigues-chaudes'))] },
    { id: 'tour-des-orgues', name: "Le tour de l'Île des Orgues", nameEn: 'Organ Isle loop', loop: true, mode: 'road', waypoints: [og(2.4), og(-1.3), og(0.6)], landmarks: [L('Les Orgues', t('les-orgues')), L('Phare des Orgues', LIGHTHOUSE)] },
    { id: 'phare-des-orgues', name: 'Le Phare des Orgues', nameEn: 'Organ lighthouse', loop: false, mode: 'road', waypoints: [t('le-pont'), t('les-orgues'), coastPoint(0.05, 160, 1)], landmarks: [L('Pont des Orgues', pont), L('Phare des Orgues', LIGHTHOUSE)] },
    { id: 'tour-de-sable-noir', name: 'Le tour de Sable-Noir', nameEn: 'Black Sand isle loop', loop: true, mode: 'road', waypoints: [sn(-2.2), sn(-0.3), sn(1.6)], landmarks: [L('Sable-Noir', t('sable-noir')), L('Mont Cendre', [CINDER.x, CINDER.z])] },
    // Pistes cyclables.
    { id: 'promenade-de-sainte-iris', name: 'La promenade de Sainte-Iris', nameEn: 'Sainte-Iris promenade', loop: true, mode: 'cycle', waypoints: [coastPoint(east + 0.006, 185), coastPoint(east + 0.006, 125), coastPoint(west - 0.006, 125), coastPoint(west - 0.006, 185), coastPoint(ang, 480)], sprints: [{ name: 'Sprint de la Promenade', x: coastPoint(ang + 0.1, 125)[0], z: coastPoint(ang + 0.1, 125)[1], lengthM: 400 }], landmarks: [L('La Promenade', coastPoint(ang, 125)), L('Marché couvert', coastPoint(ang + 0.018, 230))] },
    { id: 'piste-du-circuit', name: 'La piste du Circuit', nameEn: 'Circuit cycleway', loop: true, mode: 'cycle', waypoints: [t('la-plaine'), ANNEAU_GATES[2]!, ANNEAU_GATES[0]!], landmarks: [L('Circuit des Laves', [ANNEAU.cx, ANNEAU.cz]), L('La Plaine', t('la-plaine'))] },
    { id: 'voie-verte-des-laves', name: 'La voie verte des Laves', nameEn: 'Lava greenway', loop: false, mode: 'cycle', waypoints: [t('la-plaine'), t('port-lave')], landmarks: [L('Port-Lave', t('port-lave'))] },
    { id: 'voie-verte-de-la-baie', name: 'La voie verte de la Baie', nameEn: 'Bay greenway', loop: false, mode: 'cycle', waypoints: [t('sainte-iris'), t('les-terrasses')], landmarks: [L('Les Terrasses', t('les-terrasses'))] },
    { id: 'voie-verte-des-cendres', name: 'La voie verte des Cendres', nameEn: 'Ash greenway', loop: false, mode: 'cycle', waypoints: [t('la-plaine'), t('sainte-iris')], landmarks: [L('Sainte-Iris', t('sainte-iris'))] },
    // Gravel.
    { id: 'classique-des-cendres', name: 'La Classique des Cendres', nameEn: 'Ash Classic', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [t('port-lave'), [-9600, -2000], net.cendres[0] ?? [-7200, -3100], [-5700, 2900]], landmarks: [L('Chemin de la Coulée', [-5700, 2900]), L('Chemin des Cendres', [-7200, -3100]), L('Vigne-Noire', t('vigne-noire')), L('Port-Lave', t('port-lave'))] },
    { id: 'gravel-des-cendres', name: 'Gravel des Cendres', nameEn: 'Ash gravel', loop: true, mode: 'gravel', bike: 'gravel', waypoints: net.cendres, along: 'Chemin des Cendres', landmarks: [L('Les Cendres', [-7200, -3100])] },
    { id: 'gravel-des-vignes', name: 'Gravel des Vignes', nameEn: 'Vineyard gravel', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Chemin des Vignes', landmarks: [L('Vigne-Noire', t('vigne-noire'))] },
    { id: 'gravel-de-la-foret', name: 'Gravel de la Forêt', nameEn: 'Rainforest gravel', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Chemin de la Forêt', landmarks: [L('La Forêt humide', [5600, -4700])] },
    { id: 'gravel-des-terrasses', name: 'Gravel des Terrasses', nameEn: 'Terraces gravel', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Chemin des Terrasses', landmarks: [L('Les Terrasses', t('les-terrasses'))] },
    { id: 'gravel-des-orgues', name: 'Gravel des Orgues', nameEn: 'Basalt organs gravel', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Chemin des Orgues', landmarks: [L('Les Orgues', t('les-orgues'))] },
    { id: 'gravel-de-sable-noir', name: 'Gravel de Sable-Noir', nameEn: 'Black Sand gravel', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Chemin de Sable-Noir', landmarks: [L('Sable-Noir', t('sable-noir'))] },
    { id: 'gravel-des-fumerolles', name: 'Gravel des Fumerolles', nameEn: 'Fumaroles gravel', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Chemin des Fumerolles', landmarks: [L('Fumerolles', [1700, 1300])] },
    { id: 'gravel-de-la-coulee', name: 'Gravel de la Coulée', nameEn: 'Lava flow gravel', loop: true, mode: 'gravel', bike: 'gravel', waypoints: [], along: 'Chemin de la Coulée', landmarks: [L('La Coulée du Sud', [-5700, 2900])] },
    { id: 'chemin-du-littoral', name: 'Le chemin du Littoral', nameEn: 'Coastal path', loop: false, mode: 'gravel', bike: 'gravel', waypoints: [coastPoint(1.95, 300), coastPoint(2.45, 300)], landmarks: [L('Pointe de la Coulée', coastPoint(2.15, 300))] },
    // VTT.
    { id: 'vtt-de-la-lande', name: 'VTT de la Lande', nameEn: 'Upland heath MTB', loop: true, mode: 'mtb', bike: 'mtb', waypoints: [], along: 'Sentier de la Lande', landmarks: [L('La Lande', [-4300, -5300])] },
    { id: 'descente-du-volcan', name: 'La descente du Volcan', nameEn: 'Volcano downhill', loop: false, mode: 'mtb', bike: 'mtb', waypoints: [[OBSERVATORY[0] + 140, OBSERVATORY[1] + 120], [6100, -1400]], sprints: [{ name: 'Chrono de la descente', x: 4400, z: -1000, lengthM: 1500 }], landmarks: [L('Observatoire du volcan', OBSERVATORY), L('Rocheverte', t('rocheverte'))] },
    { id: 'vtt-de-la-foret', name: 'VTT de la Forêt', nameEn: 'Rainforest MTB', loop: true, mode: 'mtb', bike: 'mtb', waypoints: [], along: 'Sentier de la Forêt', landmarks: [L('La Forêt humide', [3600, -6400])] },
    { id: 'vtt-des-orgues', name: 'VTT des Orgues', nameEn: 'Basalt organs MTB', loop: true, mode: 'mtb', bike: 'mtb', waypoints: [], along: 'Sentier des Orgues', landmarks: [L('Orgues du sud', [16400, -2700])] },
    { id: 'vtt-de-la-coulee', name: 'VTT de la Coulée', nameEn: 'Lava field MTB', loop: true, mode: 'mtb', bike: 'mtb', waypoints: [], along: 'Sentier de la Coulée', landmarks: [L('La Grande Coulée', [-10300, 700])] },
    { id: 'vtt-de-la-ravine', name: 'VTT de la Ravine', nameEn: 'Ravine MTB', loop: true, mode: 'mtb', bike: 'mtb', waypoints: [], along: 'Sentier de la Ravine', landmarks: [L('La Ravine des Pluies', [7400, -5700])] },
    { id: 'bike-park-du-mont-cendre', name: 'Le bike park du Mont Cendre', nameEn: 'Mont Cendre bike park', loop: true, mode: 'mtb', bike: 'mtb', waypoints: [], along: 'Bike park du Mont Cendre', landmarks: [L('Bike park', [CINDER.x, CINDER.z])] },
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
    if (g > lim) return `pente ${(g * 100).toFixed(1)} %`;
  }
  const get = (i: number) => P[r.loop ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))]!;
  for (let i = 0; i < n; i++) {
    const a = get(i - 3);
    const b = get(i);
    const c = get(i + 3);
    if (a === b || b === c) continue;
    let t = Math.abs(Math.atan2(c.z - b.z, c.x - b.x) - Math.atan2(b.z - a.z, b.x - a.x));
    if (t > Math.PI) t = 2 * Math.PI - t;
    if (t > (150 * Math.PI) / 180) return 'demi-tour';
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
    const palette = t.seaside || t.id === 'port-lave' ? 'colore' : t.id === 'aigues-chaudes' ? 'thermal' : t.id === 'les-orgues' || t.id === 'vigne-noire' ? 'basalte' : 'village';
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
  routes.push({ id: 'anneau', name: 'Le Circuit des Laves', nameEn: 'Lava circuit', loop: true, lengthM: r2(anLen), elevationGainM: 0, points: anPoints, segments: timedSegments({ id: 'anneau', sprints: [{ name: 'Sprint de la ligne opposée', x: ANNEAU.cx + 60, z: ANNEAU.cz - ANNEAU.radius, lengthM: 400 }, { name: 'Sprint des Tribunes', x: ANNEAU.cx + 30, z: ANNEAU.cz + ANNEAU.radius, lengthM: 400 }] }, { points: anPoints, lengthM: r2(anLen) } as RouteData), roadWidthM: ANNEAU.widthM, attribution: ATTRIBUTION, roadWidths: [{ startM: 0, endM: r2(anLen), widthM: ANNEAU.widthM }], surfaces: [{ startM: 0, endM: r2(anLen), surface: 'asphalt' }], landmarks: [{ name: 'Tribunes', d: 0 }], stepM: 2, minElevationM: ANNEAU.level, maxElevationM: ANNEAU.level, maxGradePct: 0, markings: 'full' });
  // Cyclo-cross des Cendres : la boucle elle-même, départ à sa porte.
  {
    const c = D.cross;
    const s0 = c.pts.reduce((bi, p, i) => (p[0] > c.pts[bi]![0] ? i : bi), 0);
    // Points à moins de 0,5 m du précédent retirés (reste d'un raccord du lissage).
    const loopPts = [...c.pts.slice(s0), ...c.pts.slice(0, s0)].filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1]![0], p[2] - a[i - 1]![2]) >= 0.5);
    while (loopPts.length > 2 && Math.hypot(loopPts[0]![0] - loopPts[loopPts.length - 1]![0], loopPts[0]![2] - loopPts[loopPts.length - 1]![2]) < 0.5) loopPts.pop();
    let acc2 = 0;
    const pts = loopPts.map((p, i) => {
      if (i) acc2 += Math.hypot(p[0] - loopPts[i - 1]![0], p[2] - loopPts[i - 1]![2]);
      return { x: r2(p[0]), y: r2(p[1]), z: r2(p[2]), d: r2(acc2) };
    });
    const len = r2(acc2 + Math.hypot(pts[0]!.x - pts[pts.length - 1]!.x, pts[0]!.z - pts[pts.length - 1]!.z));
    let gain = 0;
    let gmax = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      gain += Math.max(0, b.y - a.y);
      const j = (i + 5) % pts.length;
      gmax = Math.max(gmax, Math.abs(pts[j]!.y - a.y) / 10);
    }
    const ys = pts.map((p) => p.y);
    // Matières par quarts : herbe, sable (cendre), terre, herbe.
    const q = [0, 0.25, 0.5, 0.75, 1].map((t) => r2(len * t));
    const surf = ['grass', 'sand', 'dirt', 'grass'];
    routes.push({ id: 'cyclo-cross-des-cendres', name: 'Le cyclo-cross des Cendres', nameEn: 'Ash cyclocross', loop: true, bike: 'gravel', lengthM: len, elevationGainM: r2(gain), points: pts, segments: timedSegments({ id: 'cyclo-cross-des-cendres', sprints: [] }, { points: pts, lengthM: len } as RouteData), roadWidthM: 3, attribution: ATTRIBUTION, roadWidths: [{ startM: 0, endM: len, widthM: 3 }], surfaces: surf.map((surface, k) => ({ startM: q[k]!, endM: q[k + 1]!, surface })), landmarks: [{ name: 'Cyclo-cross des Cendres', d: 0 }], stepM: 2, minElevationM: r2(Math.min(...ys)), maxElevationM: r2(Math.max(...ys)), maxGradePct: r2(gmax * 100) });
  }
  for (const spec of routeSpecs(net)) {
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
  const serial = roads.map((r) => ({ pts: r.pts.flat(), loop: r.loop, flat: r.flat, blend: r.blend, width: r.width, kind: r.kind, bridge: !!r.bridge }));
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
      parts.forEach((piece, i) => tile.roads.push({ id: `${r.id}-${i}`, kind: r.kind, name: r.name, width: r.width, surface: r.surface, flatten: [r.flat, r.flat + r.blend], pts: piece.flatMap((p) => [r2(p[0]), r2(p[1]), r2(p[2])]), ...(r.bridge ? { bridge: true } : {}) }));
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
  const sr = TOWNS.find((t) => t.id === 'la-plaine')!;
  const meta: WorldMeta = {
    formatVersion: 1,
    id: ISLAND.id,
    name: ISLAND.name,
    crs: 'EPSG:2154',
    // Repère fictif, en Méditerranée au sud-est de la Corse : ne recouvre aucune zone réelle ni les autres mondes Poly.
    originL93: { x: 1330000, y: 5900000 },
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
