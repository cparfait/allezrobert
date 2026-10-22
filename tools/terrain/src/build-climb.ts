/**
 * Construction d'un monde « montée célèbre » (aucune donnée Garmin) :
 *   pnpm --filter @allezrobert/terrain build:world -- --world alpe-dhuez [--no-ortho] [--offline] [--routes-only]
 *
 * 1. OSM (Overpass, cache) sur le corridor, avec éboulis, glaciers, panneaux des lacets.
 * 2. Itinéraire imposé : plus court chemin par les points de passage, routes `preferRefs` favorisées.
 * 3. MNT IGN : LiDAR HD (repli RGE ALTI) 1 m près de la route, 8 m sur le corridor, 100 m pour l'horizon.
 * 4. Géométrie fidèle aux lacets, profil de la plate-forme de chaussée, lacets détectés et numérotés.
 * 5. Tuiles creusées (uniquement à moins de loMarginM de la route), horizon, world.json, bilan
 *    comparé aux valeurs publiées.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RouteData, RouteHairpin, RouteSegment, WorldHorizon, WorldMeta } from '@allezrobert/shared';
import { ATTRIBUTION, ATTRIBUTION_ORTHO, CACHE_DIR, CORRIDOR_TILES, LOD_HI, LOD_LO, ORIGIN_L93, OUT_DIR, ROUTE_STEP_M, TILE_SIZE_M, WORLD, type ClimbWorld, type LonLat } from './config.ts';
import { circumradius, detectHairpins, hairpinShortName, interpolateMaskedOpen, nearestEdgeOf, pathPolyline, platformHeight, projectArc, relaxTightCorners, routeViaEdges, slicePolyline, smoothOpenPath, unwrappedHeading } from './climb.ts';
import { corridorWgs84, OSM_CHUNK } from './corridor.ts';
import { Dem, DemStack } from './dem.ts';
import { distPointRect, tileId, tileRect, wgs84ToWorld, worldToL93, type Rect } from './frame.ts';
import { cumulative, type Pt } from './geom.ts';
import { RoadGraph, type Edge } from './graph.ts';
import { setOffline } from './net.ts';
import { buildOsmWorld, parseNumber } from './osm.ts';
import { fetchOsm, mountainClauses, type OsmNode } from './overpass.ts';
import { elevationGain, smoothRoadProfile } from './profile.ts';
import { encodeGrid, tileStepM, type TileResult } from './tiles.ts';
import { writeWorldTiles } from './world-tiles.ts';
import { ATTRIBUTION_BDTOPO } from './bdtopo.ts';
import { prepareEnrichment } from './enrich.ts';
import { ATTRIBUTION_LIDAR } from './lidar.ts';

if (WORLD.kind !== 'climb') throw new Error('build-climb : monde de type « climb » attendu');
const W: ClimbWorld = WORLD;
const C = W.climb;

const args = new Set(process.argv.slice(2));
const WITH_ORTHO = !args.has('--no-ortho');
const ROUTES_ONLY = args.has('--routes-only');
if (args.has('--offline')) setOffline(true);

/** Lissage en plan (σ, m) : efface le crénelage des nœuds OSM, rogne les épingles de < 0,3 m. */
const PLAN_SIGMA_M = 1.5;
/** Profil en long : σ du lissage gaussien et variation de pente tolérée par 20 m (montagne). */
const PROFILE_SIGMA_M = 8;
const PROFILE_MAX_GRADE_CHANGE = 0.06;

function log(s: string): void {
  console.log(s);
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

function corridorRect(): Rect {
  return {
    minX: CORRIDOR_TILES.txMin * TILE_SIZE_M,
    minZ: CORRIDOR_TILES.tzMin * TILE_SIZE_M,
    maxX: (CORRIDOR_TILES.txMax + 1) * TILE_SIZE_M,
    maxZ: (CORRIDOR_TILES.tzMax + 1) * TILE_SIZE_M,
  };
}

async function ensureRect(dem: Dem, r: Rect): Promise<void> {
  const a = worldToL93(r.minX, r.maxZ);
  const b = worldToL93(r.maxX, r.minZ);
  await dem.ensure(a.e, a.n, b.e - 1e-6, b.n - 1e-6);
}

function toWorld(p: LonLat): Pt {
  const w = wgs84ToWorld(p.lon, p.lat);
  return [w.x, w.z];
}

/** Tuiles du corridor dont la distance à la polyligne est ≤ margin. */
function tilesWithin(pts: Pt[], margin: number): Array<[number, number]> {
  const c = CORRIDOR_TILES;
  const out: Array<[number, number]> = [];
  for (let tx = c.txMin; tx <= c.txMax; tx++)
    for (let tz = c.tzMin; tz <= c.tzMax; tz++) {
      const r = tileRect(tx, tz);
      for (let i = 0; i < pts.length; i += 5) {
        if (distPointRect(pts[i]![0], pts[i]![1], r) <= margin) {
          out.push([tx, tz]);
          break;
        }
      }
    }
  return out;
}

/** Pentes maximales (%) sur des fenêtres glissantes de `winM` mètres. */
function maxGrade(hs: number[], step: number, winM: number, i0 = 0, i1 = hs.length - 1): number {
  const w = Math.max(1, Math.round(winM / step));
  let m = -Infinity;
  for (let i = i0; i + w <= i1; i++) m = Math.max(m, ((hs[i + w]! - hs[i]!) / (w * step)) * 100);
  return m;
}

interface HairpinSign {
  id: number;
  name: string;
  ref?: number;
  ele?: number;
  inscription?: string;
  altName?: string;
  x: number;
  z: number;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  fs.mkdirSync(path.join(OUT_DIR, 'routes'), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, 'tiles'), { recursive: true });
  // monde privé : rien de son dossier n'entre dans le dépôt (pas même world.json ni l'itinéraire)
  if (W.private) fs.writeFileSync(path.join(OUT_DIR, '.gitignore'), '# Monde privé (data/private/worlds) : jamais versionné\n*\n');
  const analysisDir = path.join(CACHE_DIR, 'analysis');
  fs.mkdirSync(analysisDir, { recursive: true });
  const corridor = corridorRect();

  // 1. OSM
  log(`1. OpenStreetMap (Overpass, cache) — ${W.name}`);
  const els = await fetchOsm(corridorWgs84(), OSM_CHUNK.lon, OSM_CHUNK.lat, mountainClauses);
  const osm = buildOsmWorld(els);
  log(`   ${els.length} éléments → ${osm.roads.length} voies, ${osm.buildings.length} bâtiments, ${osm.areas.length} surfaces, ${osm.lines.length} lignes, ${osm.pois.length} lieux`);
  const g = new RoadGraph(osm.roads, (r) => !['steps', 'elevator', 'corridor', 'bus_guideway'].includes(r.kind));
  log(`   graphe : ${g.edges.length} arêtes, ${g.adj.size} nœuds`);
  const signs: HairpinSign[] = [];
  for (const el of els) {
    if (el.type !== 'node') continue;
    const t = (el as OsmNode).tags ?? {};
    if (t.tourism !== 'information' || !/^Virage\b/i.test(t.name ?? '')) continue;
    const p = wgs84ToWorld(el.lon, el.lat);
    const ref = parseNumber(t.ref);
    const ele = parseNumber(t.ele);
    signs.push({ id: el.id, name: t.name!, x: p.x, z: p.z, ...(ref !== null ? { ref } : {}), ...(ele !== null ? { ele } : {}), ...(t.inscription ? { inscription: t.inscription } : {}), ...(t.alt_name ? { altName: t.alt_name } : {}) });
  }
  log(`   ${signs.length} panneaux de virage OSM`);

  // 2. itinéraire imposé
  log('2. Itinéraire');
  const prefer = new Set(C.preferRefs);
  const usable = (e: Edge) => e.road.paved && !/^(motorway|trunk)(_link)?$/.test(e.road.kind) && /^(primary|secondary|tertiary|unclassified|residential|living_street|service)(_link)?$/.test(e.road.kind);
  const cost = (e: Edge) => {
    if (!usable(e)) return Infinity;
    if (prefer.has(e.road.ref)) return e.len;
    if (/^(primary|secondary|tertiary)/.test(e.road.kind)) return e.len * 2.5;
    return e.len * (e.road.kind === 'service' ? 8 : 5);
  };
  // le pied et l'arrivée sont aussi des points de passage (pas de raccourci par une rue voisine)
  const wps = [C.start, C.climbStart, ...(C.via ?? []), C.finish, C.end].map(toWorld);
  const must = wps.map((p, i) => {
    let e = nearestEdgeOf(g, p[0], p[1], 60, (e) => usable(e) && prefer.has(e.road.ref));
    if (e < 0) e = nearestEdgeOf(g, p[0], p[1], 60, usable);
    if (e < 0) throw new Error(`point de passage ${i} : aucune route à moins de 60 m`);
    return e;
  });
  const via = routeViaEdges(g, must, cost);
  const edges = via.edges;
  if (C.roadWidthM) for (const e of edges) g.edges[e]!.road.width = C.roadWidthM;
  const poly = pathPolyline(g, via.start, edges);
  const polyCum = cumulative(poly.pts);
  const polyLen = polyCum[polyCum.length - 1]!;
  // rognage au plus près des points de départ et de fin
  const s0 = projectArc(poly.pts, wps[0]!, 0, 2000).s;
  const s1 = projectArc(poly.pts, wps[wps.length - 1]!, polyLen - 2000).s;
  const raw = slicePolyline(poly.pts, poly.edgeOf, s0, s1);
  log(`   ${edges.length} arêtes, ${(cumulative(raw.pts).at(-1)! / 1000).toFixed(2)} km (avant lissage)`);

  // 3. MNT
  log('3. MNT IGN');
  const lo = new Dem('lo', LOD_LO.resM, 8000);
  await ensureRect(lo, corridor);
  const hi = new Dem('hi', 1, 1000);
  const loTiles = tilesWithin(raw.pts, W.loMarginM);
  const hiSet = new Set(tilesWithin(raw.pts, W.hiMarginM).map(([tx, tz]) => tileId(tx, tz)));
  for (const t of hiSet) {
    const [tx, tz] = t.split('_').map(Number) as [number, number];
    await ensureRect(hi, tileRect(tx, tz));
  }
  const dem = new DemStack([hi, lo]);
  log(`   lo : ${JSON.stringify(lo.stats)} ; hi : ${JSON.stringify(hi.stats)}`);

  // 4. géométrie et profil
  log('4. Géométrie, profil, lacets');
  const fin = smoothOpenPath(raw.pts, raw.edgeOf, PLAN_SIGMA_M, ROUTE_STEP_M);
  // angles de carrefour plus serrés que la chaussée (pas les lacets) : arrondis localement
  const widths0 = fin.edgeOf.map((e) => g.edges[e]!.road.width).sort((a, b) => a - b);
  const halfW = widths0[widths0.length >> 1]! / 2;
  const relax = relaxTightCorners(fin.pts, halfW + 1, ROUTE_STEP_M);
  if (relax.relaxed) {
    log(`   angles serrés (rayon < ${(halfW + 1).toFixed(1)} m) arrondis en ${relax.relaxed} passe(s)`);
    const total = cumulative(relax.pts).at(-1)!;
    fin.step = total / (relax.pts.length - 1);
    fin.edgeOf = relax.pts.map((_, i) => fin.edgeOf[Math.min(fin.edgeOf.length - 1, Math.round((i / (relax.pts.length - 1)) * (fin.edgeOf.length - 1)))]!);
    fin.pts = relax.pts;
  }
  const pts = fin.pts;
  const step = fin.step;
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const edgeOf = fin.edgeOf;
  const sampleW = (x: number, z: number) => {
    const l = worldToL93(x, z);
    return dem.sample(l.e, l.n);
  };
  const plat = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 2)]!;
    const b = pts[Math.min(n - 1, i + 2)]!;
    return platformHeight(sampleW, p, [b[0] - a[0], b[1] - a[1]]);
  });
  const isStructure = edgeOf.map((eid) => g.edges[eid]!.road.bridge || g.edges[eid]!.road.tunnel);
  const rawH = interpolateMaskedOpen(
    plat.map((q) => q.h),
    isStructure,
  );
  const centreH = interpolateMaskedOpen(
    pts.map((p) => sampleW(p[0], p[1])),
    isStructure,
  );
  const prof = smoothRoadProfile(rawH, step, false, PROFILE_SIGMA_M, PROFILE_MAX_GRADE_CHANGE);
  const hs = prof.h;
  // écart planimétrique lissage ↔ OSM (dans les lacets surtout)
  let maxPlanDev = 0;
  for (let i = 0; i < n; i += 1) maxPlanDev = Math.max(maxPlanDev, projectArc(raw.pts, pts[i]!, i * step - 60, i * step + 60).d);
  const offs = plat.map((q) => Math.abs(q.offset)).sort((a, b) => a - b);
  const resid = rawH.map((v, i) => Math.abs(v - hs[i]!)).sort((a, b) => a - b);
  const centreDiff = centreH.map((v, i) => v - rawH[i]!).sort((a, b) => a - b);
  log(
    `   ${n} points, pas ${step.toFixed(3)} m ; écart max au tracé OSM ${maxPlanDev.toFixed(2)} m ; plate-forme : décalage médian ${offs[n >> 1]!.toFixed(1)} m (90e c. ${offs[Math.floor(n * 0.9)]!.toFixed(1)} m), ` +
      `axe OSM − plate-forme médiane ${centreDiff[n >> 1]!.toFixed(2)} m ; résidu profil médian ${(resid[n >> 1]! * 100).toFixed(0)} cm, 99e c. ${(resid[Math.floor(n * 0.99)]! * 100).toFixed(0)} cm ; Δpente max ${(prof.maxGradeChangePer20m * 100).toFixed(1)} %/20 m`,
  );

  // lacets
  const roundabout = (i: number) => {
    for (let k = Math.max(0, i - 10); k <= Math.min(n - 1, i + 10); k++) if (g.edges[edgeOf[k]!]!.road.roundabout) return true;
    return false;
  };
  const found = detectHairpins(xs, zs, step, { minTurnDeg: 150, maxSpanM: 120, chordM: 4, skip: roundabout });
  let minRadius = Infinity;
  for (const h of found) minRadius = Math.min(minRadius, h.radiusM);
  log(`   ${found.length} lacets détectés (≥ 150° sur ≤ 120 m), rayon minimal de l'axe ${minRadius.toFixed(1)} m`);
  const T = unwrappedHeading(xs, zs);
  const kChord = Math.max(1, Math.round(4 / step));
  const turnAround = (i: number, halfM: number) => {
    const w = Math.round(halfM / step);
    return (Math.abs(T[Math.min(n - 1, i + w)]! - T[Math.max(0, i - w)]!) * 180) / Math.PI;
  };
  /** Sommet d'un virage : courbure maximale à ±`win` m d'un point. */
  const apexNear = (i0: number, win: number) => {
    const w = Math.round(win / step);
    let apex = i0;
    let minR = Infinity;
    for (let i = Math.max(0, i0 - w); i <= Math.min(n - 1, i0 + w); i++) {
      const r = circumradius(xs, zs, i, kChord);
      if (r < minR) {
        minR = r;
        apex = i;
      }
    }
    return { apex, radius: minR };
  };
  let hairpins: RouteHairpin[];
  if (C.numberedHairpins && signs.length) {
    // lacets numérotés : les panneaux OSM font foi (un panneau par épingle, au sommet du virage)
    const placed = signs
      .map((s) => {
        let bi = -1;
        let bd = 60;
        for (let i = 0; i < n; i++) {
          const d = Math.hypot(xs[i]! - s.x, zs[i]! - s.z);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        }
        return { s, i: bi, dist: bd };
      })
      .filter((o) => o.i >= 0)
      .sort((a, b) => a.i - b.i);
    // numéro manquant (ex. « Virage des Goutards » sans `ref`) : déduit des voisins
    const nums = placed.map((o) => o.s.ref);
    for (let k = 0; k < placed.length; k++) {
      if (nums[k] !== undefined) continue;
      const prevN = nums[k - 1];
      const nextN = nums[k + 1];
      const step1 = C.numberedHairpins.descending ? -1 : 1;
      if (prevN !== undefined) nums[k] = prevN + step1;
      else if (nextN !== undefined) nums[k] = nextN - step1;
    }
    hairpins = placed.map((o, k) => {
      const { apex, radius } = apexNear(o.i, 45);
      const h: RouteHairpin = { d: r2(apex * step), turnDeg: Math.round(turnAround(apex, 40)), radiusM: r1(radius), altitudeM: r1(hs[apex]!), name: o.s.name };
      if (nums[k] !== undefined) h.number = nums[k]!;
      if (o.s.ele !== undefined) h.signAltitudeM = o.s.ele;
      if (o.s.inscription) h.inscription = o.s.inscription;
      return h;
    });
    const expected = Array.from({ length: C.numberedHairpins.count }, (_, k) => (C.numberedHairpins!.descending ? C.numberedHairpins!.count - k : k + 1));
    const got = hairpins.map((h) => h.number);
    if (JSON.stringify(got) !== JSON.stringify(expected)) log(`   ! numéros des lacets dans l'ordre du parcours : ${got.join(', ')} (attendu ${expected.join(', ')})`);
    const missed = hairpins.filter((h) => !found.some((f) => Math.abs(f.apexIdx * step - h.d) < 60));
    log(`   ${hairpins.length} lacets numérotés d'après les panneaux OSM ; ${hairpins.length - missed.length} retrouvés aussi par la géométrie seule${missed.length ? ` (pas les n° ${missed.map((h) => `${h.number} : ${h.turnDeg}°`).join(', ')})` : ''}`);
  } else {
    hairpins = found.map((f) => ({ d: r2(f.apexIdx * step), turnDeg: Math.round(f.turnDeg), radiusM: r1(f.radiusM), altitudeM: r1(hs[f.apexIdx]!) }));
  }
  const hairpinMinR = hairpins.reduce((m, h) => Math.min(m, h.radiusM), Infinity);
  for (const h of hairpins)
    log(
      `   ${h.number !== undefined ? `n° ${String(h.number).padStart(2)}` : '     '} km ${(h.d / 1000).toFixed(2).padStart(5)} ${String(h.turnDeg).padStart(3)}° R ${h.radiusM.toFixed(1).padStart(4)} m alt. ${h.altitudeM.toFixed(0)} m` +
        `${h.signAltitudeM !== undefined ? ` (panneau ${h.signAltitudeM} m, écart ${(h.altitudeM - h.signAltitudeM).toFixed(0)} m)` : ''}${h.name ? ` — ${h.name}` : ''}`,
    );

  // segments
  const arcOf = (p: LonLat) => projectArc(pts, toWorld(p)).s;
  const kS = Math.round(arcOf(C.climbStart) / step);
  const kE = Math.round(arcOf(C.finish) / step);
  const komLen = (kE - kS) * step;
  const komGain = hs[kE]! - hs[kS]!;
  const segments: RouteSegment[] = [{ id: C.komId, kind: 'kom', name: C.komName, startM: r2(kS * step), endM: r2(kE * step), avgGrade: r2((komGain / komLen) * 100) }];

  // repères : lacets numérotés, villages et hameaux traversés, repères de la configuration
  const landmarks: Array<{ name: string; d: number }> = [];
  for (const h of hairpins) {
    if (h.number === undefined) continue;
    landmarks.push({ name: h.name ? `Virage ${h.number} · ${hairpinShortName(h.name)}` : `Virage ${h.number}`, d: h.d });
  }
  for (const p of osm.pois) {
    if (!/^(village|town|hamlet)$/.test(p.kind) || !p.name) continue;
    let bi = -1;
    let bd = /^(village|town)$/.test(p.kind) ? 400 : 200;
    for (let i = 0; i < n; i += 2) {
      const d = Math.hypot(xs[i]! - p.x, zs[i]! - p.z);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    // un repère par lieu, pas collé à un panneau de virage
    if (bi >= 0 && !landmarks.some((l) => Math.abs(l.d - bi * step) < 60)) landmarks.push({ name: p.name, d: r2(bi * step) });
  }
  for (const l of C.landmarks ?? []) landmarks.push({ name: l.name, d: r2(arcOf(l.at)) });
  landmarks.sort((a, b) => a.d - b.d);

  // largeur de chaussée
  const widthAt = edgeOf.map((eid) => g.edges[eid]!.road.width);
  const komW = widthAt.slice(kS, kE).sort((a, b) => a - b);
  const roadWidthM = komW[Math.floor(komW.length / 2)] ?? 6;
  const roadWidths: Array<{ startM: number; endM: number; widthM: number }> = [];
  for (let i = 0; i < n - 1; i++) {
    const w = widthAt[i]!;
    const last = roadWidths[roadWidths.length - 1];
    if (last && last.widthM === w) last.endM = r2((i + 1) * step);
    else roadWidths.push({ startM: r2(i * step), endM: r2((i + 1) * step), widthM: w });
  }
  const data: RouteData = {
    id: C.routeId,
    name: C.routeName,
    nameEn: C.routeNameEn,
    loop: false,
    lengthM: r2((n - 1) * step),
    elevationGainM: r2(elevationGain(hs, false)),
    points: pts.map((p, i) => ({ x: r2(p[0]), y: r2(hs[i]!), z: r2(p[1]), d: r2(i * step) })),
    segments,
    roadWidthM,
    attribution: [...ATTRIBUTION],
    roadWidths,
    landmarks,
    stepM: Math.round(step * 1000) / 1000,
    minElevationM: r2(Math.min(...hs)),
    maxElevationM: r2(Math.max(...hs)),
    maxGradePct: r2(maxGrade(hs, step, 10)),
    hairpins,
    ...(C.markings ? { markings: C.markings } : {}),
  };
  const routesDir = path.join(OUT_DIR, 'routes');
  for (const f of fs.readdirSync(routesDir)) if (f.endsWith('.json')) fs.unlinkSync(path.join(routesDir, f));
  fs.writeFileSync(path.join(routesDir, `${data.id}.json`), JSON.stringify(data));

  // bilan comparé aux références
  const ref = C.reference;
  const komDplus = elevationGain(hs.slice(kS, kE + 1), false);
  const report = {
    world: W.id,
    route: { lengthM: data.lengthM, gainM: data.elevationGainM, minM: data.minElevationM, maxM: data.maxElevationM },
    kom: {
      lengthM: r2(komLen),
      startEleM: r1(hs[kS]!),
      finishEleM: r1(hs[kE]!),
      netGainM: r1(komGain),
      dPlusM: r1(komDplus),
      avgGradePct: r2((komGain / komLen) * 100),
      maxGrade10mPct: r1(maxGrade(hs, step, 10, kS, kE)),
      maxGrade100mPct: r1(maxGrade(hs, step, 100, kS, kE)),
      maxGrade1kmPct: r1(maxGrade(hs, step, 1000, kS, kE)),
    },
    reference: ref,
    hairpins: { count: hairpins.length, numbered: hairpins.filter((h) => h.number !== undefined).length, minRadiusM: r1(hairpinMinR), geometricDetections: found.length, minRadiusAnyBendM: r1(minRadius) },
    planimetry: { maxDeviationFromOsmM: r2(maxPlanDev), platformOffsetMedianM: r2(offs[n >> 1]!), platformOffsetP90M: r2(offs[Math.floor(n * 0.9)]!) },
  };
  fs.writeFileSync(path.join(analysisDir, `${W.id}-report.json`), JSON.stringify(report, null, 1));
  log(`   ${data.name} : ${(data.lengthM / 1000).toFixed(2)} km, D+ ${data.elevationGainM.toFixed(0)} m, ${data.minElevationM} → ${data.maxElevationM} m, chaussée ${roadWidthM} m`);
  log(
    `   KOM « ${C.komName} » (km ${(kS * step / 1000).toFixed(2)} → ${(kE * step / 1000).toFixed(2)}) : ${(komLen / 1000).toFixed(2)} km (réf. ${(ref.lengthM / 1000).toFixed(1)}), ${hs[kS]!.toFixed(0)} → ${hs[kE]!.toFixed(0)} m ` +
      `(réf. ${ref.startEleM ?? '?'} → ${ref.finishEleM ?? '?'}), dénivelé ${komGain.toFixed(0)} m / D+ ${komDplus.toFixed(0)} m (réf. ${ref.gainM}), moyenne ${((komGain / komLen) * 100).toFixed(2)} % (réf. ${ref.avgGradePct}), ` +
      `max ${report.kom.maxGrade10mPct} % / 10 m, ${report.kom.maxGrade100mPct} % / 100 m, ${report.kom.maxGrade1kmPct} % / km (réf. ${ref.maxGradePct ?? '?'})`,
  );
  log(`   repères : ${landmarks.map((l) => `${l.name} (${(l.d / 1000).toFixed(1)})`).join(', ')}`);

  // 5. tuiles
  const worldFile = path.join(OUT_DIR, 'world.json');
  const prev: WorldMeta | null = ROUTES_ONLY && fs.existsSync(worldFile) ? (JSON.parse(fs.readFileSync(worldFile, 'utf8')) as WorldMeta) : null;
  let tileResults: TileResult[] = [];
  let horizon: WorldHorizon | undefined = prev?.horizon;
  const outside = loTiles.filter(([tx, tz]) => tx === CORRIDOR_TILES.txMin || tx === CORRIDOR_TILES.txMax || tz === CORRIDOR_TILES.tzMin || tz === CORRIDOR_TILES.tzMax);
  if (outside.length) log(`   ! ${outside.length} tuiles au bord du corridor : élargir corridorTiles pour garder ${W.loMarginM} m de marge partout`);
  if (!ROUTES_ONLY) {
    log(`5. Tuiles (${loTiles.length}, dont ${hiSet.size} en haute résolution)`);
    const enrichment = W.enrich
      ? await prepareEnrichment({
          enrich: W.enrich,
          tiles: loTiles.filter(([tx, tz]) => hiSet.has(tileId(tx, tz))),
          routePts: pts,
          roads: osm.roads,
          dem,
          log,
        })
      : undefined;
    tileResults = await writeWorldTiles({
      ...(enrichment ? { enrichment } : {}),
      g,
      dem,
      dems: { lo, hi },
      osm,
      routes: [{ route: data, edgeOf, priority: 2 }],
      tiles: loTiles,
      hiTiles: hiSet,
      outDir: OUT_DIR,
      withOrtho: WITH_ORTHO,
      carveMode: 'passes',
      log,
    });
    horizon = await writeHorizon();
  }

  const meta: WorldMeta = {
    formatVersion: 1,
    id: W.id,
    name: W.name,
    crs: 'EPSG:2154',
    originL93: { x: ORIGIN_L93.x, y: ORIGIN_L93.y },
    bounds: corridor,
    tileSizeM: TILE_SIZE_M,
    heightResolutionM: LOD_HI.resM,
    heightEncoding: { type: 'uint16le', stepM: 0.01, rowOrder: 'north-to-south', colOrder: 'west-to-east' },
    lods: [
      { id: 'lo', resolutionM: LOD_LO.resM, n: LOD_LO.n, suffix: '.lo.u16' },
      { id: 'hi', resolutionM: LOD_HI.resM, n: LOD_HI.n, suffix: '.hi.u16' },
    ],
    tiles: prev
      ? prev.tiles
      : tileResults.map((t) => ({ id: t.id, tx: t.tx, tz: t.tz, baseM: t.baseM, minM: t.minM, maxM: t.maxM, lods: t.lods as Array<'lo' | 'hi' | 'ortho'>, bytes: t.bytes, ...(t.stepM !== 0.01 ? { stepM: t.stepM } : {}) })),
    routes: [{ id: data.id, file: `routes/${data.id}.json`, name: data.name, lengthM: data.lengthM, elevationGainM: data.elevationGainM, loop: false, main: true }],
    mainRoute: data.id,
    attribution: [
      ...ATTRIBUTION,
      ...(WITH_ORTHO || prev?.attribution.includes(ATTRIBUTION_ORTHO) ? [ATTRIBUTION_ORTHO] : []),
      ...(W.enrich?.lidarVegetation || W.enrich?.bdtopoBuildings ? [ATTRIBUTION_LIDAR] : []),
      ...(W.enrich?.bdtopoBuildings ? [ATTRIBUTION_BDTOPO] : []),
    ],
    ...(horizon ? { horizon } : {}),
  };
  fs.writeFileSync(worldFile, JSON.stringify(meta, null, 1));

  // bilan
  const sizes: Record<string, number> = {};
  const tilesDir = path.join(OUT_DIR, 'tiles');
  for (const f of fs.readdirSync(tilesDir)) {
    const ext = f.replace(/^[^.]+/, '');
    sizes[ext] = (sizes[ext] ?? 0) + fs.statSync(path.join(tilesDir, f)).size;
  }
  log('Bilan');
  log(`   ${meta.tiles.length} tuiles (${meta.tiles.filter((t) => t.lods.includes('hi')).length} hi, ${meta.tiles.filter((t) => t.stepM).length} à pas > 1 cm) : ${Object.entries(sizes).map(([e, s]) => `*${e} ${(s / 1e6).toFixed(1)} Mo`).join(', ')} — total ${(Object.values(sizes).reduce((a, b) => a + b, 0) / 1e6).toFixed(1)} Mo`);
  log(`   durée ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

/**
 * Relief lointain : grille unique de `horizon.resM` m sur ±`horizon.halfSizeM` autour de
 * l'origine (sommets visibles à l'horizon, au-delà des tuiles). Pas de 10 cm (dénivelé > 655 m).
 */
async function writeHorizon(): Promise<WorldHorizon> {
  const H = W.horizon.halfSizeM;
  const res = W.horizon.resM;
  const far = new Dem(`far`, res, 10000, 64);
  await ensureRect(far, { minX: -H, minZ: -H, maxX: H, maxZ: H });
  const nn = Math.round((2 * H) / res);
  const N = nn + 1;
  const h = new Float32Array(N * N);
  let minM = Infinity;
  let maxM = -Infinity;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const l = worldToL93(-H + i * res, -H + j * res);
      let v = far.sample(l.e, l.n);
      if (!Number.isFinite(v)) v = 0;
      h[j * N + i] = v;
      minM = Math.min(minM, v);
      maxM = Math.max(maxM, v);
    }
  const baseM = Math.floor(minM) - 1;
  const stepM = Math.max(0.1, tileStepM(maxM - baseM));
  const buf = encodeGrid({ n: nn, res, x0: -H, z0: -H, h }, baseM, stepM);
  const file = 'tiles/horizon.u16';
  fs.writeFileSync(path.join(OUT_DIR, file), buf);
  log(`   horizon : ${N}×${N} à ${res} m (±${H / 1000} km), ${minM.toFixed(0)}–${maxM.toFixed(0)} m, ${(buf.length / 1e6).toFixed(2)} Mo`);
  return { file, x0: -H, z0: -H, n: nn, resolutionM: res, baseM, stepM, minM: r2(minM), maxM: r2(maxM) };
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
