/**
 * Tuiles enrichies (tranche témoin, `enrich` dans la configuration du monde) : sur les tuiles haute
 * résolution proches de l'itinéraire, les bâtiments OSM sont remplacés par ceux de la BD TOPO
 * (hauteurs, matériaux, toits mesurés dans le MNS LiDAR) et la végétation est celle du LiDAR
 * (un arbre par sommet du MNH, haies et buissons), au lieu d'un semis aléatoire côté client.
 *
 * Les voies OSM hors itinéraire prennent la nature (« Route empierrée », « Chemin ») et la
 * largeur de chaussée du tronçon BD TOPO apparié.
 *
 * Champs ajoutés au JSON de la tuile : `trees` [x, z, hauteur, rayon du houppier, …],
 * `shrubs` [x, z, hauteur, …], `enriched` { vegetation, buildings }.
 */
import type { WorldEnrich } from './config.ts';
import { ORIGIN_L93, TILE_SIZE_M } from './config.ts';
import { buildingKind, fetchBdTopoBuildings, fetchBdTopoRoads, roofMaterial, wallMaterial, type BdTopoBuilding } from './bdtopo.ts';
import type { DemStack } from './dem.ts';
import { distPointRect, tileId, tileRect } from './frame.ts';
import type { Pt } from './geom.ts';
import { detectVegetation, fetchRaster, LAYER_MNH, LAYER_MNS, measureRoof, orientedRect, type Raster } from './lidar.ts';
import type { RoadWay } from './osm.ts';

export interface TileEnrichment {
  buildings: Array<Record<string, unknown>> | null;
  trees: number[] | null;
  shrubs: number[] | null;
  /** Tronçons BD TOPO en coordonnées monde [x, z, …] (appariement des voies OSM). */
  roads: Array<{ nature: string; width: number | null; pts: number[] }>;
  stats: Record<string, number>;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Masque binaire à 50 cm sur un rectangle Lambert-93 (ligne 0 = nord). */
class Mask {
  readonly w: number;
  readonly h: number;
  readonly bits: Uint8Array;
  constructor(
    readonly e0: number,
    readonly n0: number,
    size: number,
    readonly res = 0.5,
  ) {
    this.w = Math.round(size / res);
    this.h = this.w;
    this.bits = new Uint8Array(this.w * this.h);
  }
  get(e: number, n: number): boolean {
    const i = Math.floor((e - this.e0) / this.res);
    const j = Math.floor((this.n0 - n) / this.res);
    return i >= 0 && j >= 0 && i < this.w && j < this.h && this.bits[j * this.w + i] === 1;
  }
  /** Polygone rempli puis dilaté de `grow` m (lignes de balayage, puis disque). */
  fillPolygon(ring: Array<[number, number]>, grow: number): void {
    let nMin = Infinity;
    let nMax = -Infinity;
    for (const p of ring) {
      nMin = Math.min(nMin, p[1]);
      nMax = Math.max(nMax, p[1]);
    }
    const rows: Array<[number, number, number]> = [];
    for (let j = Math.max(0, Math.floor((this.n0 - nMax) / this.res)); j <= Math.min(this.h - 1, Math.floor((this.n0 - nMin) / this.res)); j++) {
      const n = this.n0 - (j + 0.5) * this.res;
      const xs: number[] = [];
      for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) {
        const a = ring[k]!;
        const b = ring[l]!;
        if (a[1] > n !== b[1] > n) xs.push(a[0] + ((n - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      xs.sort((x, y) => x - y);
      for (let k = 0; k + 1 < xs.length; k += 2) rows.push([j, xs[k]!, xs[k + 1]!]);
    }
    const g = Math.ceil(grow / this.res);
    for (const [j, a, b] of rows)
      for (let dj = -g; dj <= g; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= this.h) continue;
        const ext = Math.sqrt(Math.max(0, g * g - dj * dj)) * this.res;
        const i0 = Math.max(0, Math.floor((a - ext - this.e0) / this.res));
        const i1 = Math.min(this.w - 1, Math.floor((b + ext - this.e0) / this.res));
        for (let i = i0; i <= i1; i++) this.bits[jj * this.w + i] = 1;
      }
  }
  /** Bande de demi-largeur `hw` le long d'une polyligne. */
  stroke(pts: Array<[number, number]>, hw: number): void {
    const step = this.res / 2;
    const rp = Math.ceil(hw / this.res);
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t <= len; t += step) {
        const e = a[0] + ((b[0] - a[0]) * t) / (len || 1);
        const n = a[1] + ((b[1] - a[1]) * t) / (len || 1);
        const ci = Math.floor((e - this.e0) / this.res);
        const cj = Math.floor((this.n0 - n) / this.res);
        for (let dj = -rp; dj <= rp; dj++)
          for (let di = -rp; di <= rp; di++) {
            if (di * di + dj * dj > rp * rp) continue;
            const i = ci + di;
            const j = cj + dj;
            if (i >= 0 && j >= 0 && i < this.w && j < this.h) this.bits[j * this.w + i] = 1;
          }
      }
    }
  }
}

function ringArea(r: Array<[number, number]>): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j]![0] - r[i]![0]) * (r[j]![1] + r[i]![1]);
  return Math.abs(s) / 2;
}

function centroid(r: Array<[number, number]>): [number, number] {
  let e = 0;
  let n = 0;
  for (const p of r) {
    e += p[0];
    n += p[1];
  }
  return [e / r.length, n / r.length];
}

const toWorld = (p: [number, number]): [number, number] => [r2(p[0] - ORIGIN_L93.x), r2(-(p[1] - ORIGIN_L93.y))];

/** Bâtiment BD TOPO → entrée `buildings[]` de la tuile (sans `y`, posé par `decorateTile`). */
function toTileBuilding(b: BdTopoBuilding, mns: Raster | null, dem: DemStack): { o: Record<string, unknown>; measured: boolean } {
  const outer = b.rings[0]!;
  const area = ringArea(outer);
  const kind = buildingKind(b, area);
  let ground = Infinity;
  for (const p of outer) ground = Math.min(ground, dem.sample(p[0], p[1]));
  if (!Number.isFinite(ground)) ground = b.groundAltM ?? 0;
  const wall = wallMaterial(b.wallCode);
  const roofMat = roofMaterial(b.roofCode) ?? (/barn|industrial|commercial/.test(kind) ? 'metal' : 'tiles');
  const m = mns ? measureRoof(mns, outer, ground) : null;
  // un arbre qui surplombe le toit gonfle le faîtage : borné par la hauteur BD TOPO quand elle existe
  const capH = b.height !== null ? b.height + 1.5 : Infinity;
  let height: number;
  let roof: Record<string, unknown>;
  if (m && m.ridgeH <= capH && m.ridgeH < 40) {
    height = m.ridgeH;
    const rh = m.shape === 'flat' ? 0 : Math.max(0.4, m.ridgeH - m.eaveH);
    roof = { shape: m.shape, height: r2(rh), material: roofMat, ...(m.ridgeAlongLong ? {} : { ridge: 'short' }) };
  } else {
    const ob = orientedRect(outer);
    height = b.height ?? (b.levels ?? 1) * 2.9 + 2;
    // défaut régional (Limagne, Livradois) : tuile à faible pente, croupes sur les maisons
    const rh = roofMat === 'metal' ? Math.tan((12 * Math.PI) / 180) * ob.hw : Math.tan((24 * Math.PI) / 180) * ob.hw;
    roof = { shape: kind === 'house' ? 'hipped' : 'gabled', height: r2(Math.min(rh, height * 0.5)), material: roofMat };
  }
  const o: Record<string, unknown> = {
    id: `bdtopo:${b.id}`,
    kind,
    height: r2(Math.max(2.2, height)),
    levels: b.levels ?? Math.max(1, Math.round((height - 1.5) / 2.9)),
    roof,
    pts: outer.flatMap((p) => toWorld(p)),
    source: 'bdtopo',
    _ground: ground,
  };
  if (wall) o.material = wall;
  if (b.rings.length > 1) o.holes = b.rings.slice(1).map((r) => r.flatMap((p) => toWorld(p)));
  return { o, measured: m !== null };
}

/**
 * Prépare les données fines des tuiles à moins de `enrich.radiusM` de l'itinéraire (réseau,
 * en cache). Clé = identifiant de tuile.
 */
export async function prepareEnrichment(o: {
  enrich: WorldEnrich;
  tiles: Array<[number, number]>;
  routePts: Pt[];
  roads: RoadWay[];
  dem: DemStack;
  log: (s: string) => void;
}): Promise<Map<string, TileEnrichment>> {
  const out = new Map<string, TileEnrichment>();
  const near = o.tiles.filter(([tx, tz]) => {
    const rect = tileRect(tx, tz);
    for (let i = 0; i < o.routePts.length; i += 5) if (distPointRect(o.routePts[i]![0], o.routePts[i]![1], rect) <= o.enrich.radiusM) return true;
    return false;
  });
  o.log(`   données fines (LiDAR HD, BD TOPO) sur ${near.length} tuiles : ${near.map(([a, b]) => tileId(a, b)).join(', ')}`);
  for (const [tx, tz] of near) {
    const id = tileId(tx, tz);
    const t0 = Date.now();
    const eMin = ORIGIN_L93.x + tx * TILE_SIZE_M;
    const nMax = ORIGIN_L93.y - tz * TILE_SIZE_M;
    const eMax = eMin + TILE_SIZE_M;
    const nMin = nMax - TILE_SIZE_M;
    const M = 25; // marge : sommets et toits au bord de la tuile
    const res: TileEnrichment = { buildings: null, trees: null, shrubs: null, roads: [], stats: {} };
    for (const r of await fetchBdTopoRoads(eMin - 50, nMin - 50, eMax + 50, nMax + 50)) res.roads.push({ nature: r.nature, width: r.width, pts: r.pts.flatMap((p) => toWorld(p)) });
    const mns = o.enrich.bdtopoBuildings ? await fetchRaster(LAYER_MNS, eMin - M, nMin - M, eMax + M, nMax + M) : null;
    const bd = await fetchBdTopoBuildings(eMin - 60, nMin - 60, eMax + 60, nMax + 60);
    // masque des bâtiments (dilaté de 1 m : murs et gouttières) et des chaussées
    const build = new Mask(eMin - M, nMax + M, TILE_SIZE_M + 2 * M);
    for (const b of bd) build.fillPolygon(b.rings[0]!, 1);
    const roadMask = new Mask(eMin - M, nMax + M, TILE_SIZE_M + 2 * M);
    // cœur des chaussées : un « sommet » au milieu d'une route est une voûte d'arbres, pas un tronc
    const roadCore = new Mask(eMin - M, nMax + M, TILE_SIZE_M + 2 * M);
    for (const r of o.roads) {
      if (/^(footway|path|steps|bridleway|track)$/.test(r.kind) && !r.paved) continue;
      const line = r.pts.map((p) => [p[0] + ORIGIN_L93.x, ORIGIN_L93.y - p[1]] as [number, number]);
      roadMask.stroke(line, r.width / 2 + 0.3);
      roadCore.stroke(line, Math.max(0.8, r.width / 2 - 0.5));
    }
    if (o.enrich.bdtopoBuildings) {
      const list: Array<Record<string, unknown>> = [];
      let measured = 0;
      for (const b of bd) {
        const c = centroid(b.rings[0]!);
        if (c[0] < eMin || c[0] >= eMax || c[1] < nMin || c[1] >= nMax) continue;
        const t = toTileBuilding(b, mns, o.dem);
        list.push(t.o);
        if (t.measured) measured++;
      }
      res.buildings = list;
      res.stats.buildings = list.length;
      res.stats.roofsMeasured = measured;
    }
    if (o.enrich.lidarVegetation) {
      const mnh = await fetchRaster(LAYER_MNH, eMin - M, nMin - M, eMax + M, nMax + M);
      const veg = detectVegetation(mnh, { eMin, nMin, eMax, nMax }, (e, n) => build.get(e, n) || roadCore.get(e, n));
      const trees: number[] = [];
      for (const t of veg.trees) trees.push(...toWorld([t.e, t.n]), r1(t.h), r1(t.r));
      const shrubs: number[] = [];
      for (const s of veg.shrubs) if (!roadMask.get(s.e, s.n)) shrubs.push(...toWorld([s.e, s.n]), r1(s.h));
      res.trees = trees;
      res.shrubs = shrubs;
      res.stats.trees = veg.trees.length;
      res.stats.shrubs = shrubs.length / 3;
    }
    out.set(id, res);
    o.log(`   ${id} : ${Object.entries(res.stats).map(([k, v]) => `${v} ${k}`).join(', ')} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  return out;
}

/** Applique les données fines au JSON d'une tuile ; `groundAt` = terrain creusé de la tuile. */
export function decorateTile(json: Record<string, unknown>, e: TileEnrichment, groundAt: (x: number, z: number) => number): void {
  const flags: Record<string, boolean> = {};
  if (e.buildings) {
    json.buildings = e.buildings.map((b) => {
      const { _ground, ...rest } = b;
      const pts = rest.pts as number[];
      let y = Infinity;
      for (let i = 0; i < pts.length; i += 2) y = Math.min(y, groundAt(pts[i]!, pts[i + 1]!));
      return { ...rest, y: r2(Number.isFinite(y) ? y : (_ground as number)) };
    });
    flags.buildings = true;
  }
  if (e.roads.length && Array.isArray(json.roads)) {
    let n = 0;
    for (const r of json.roads as Array<Record<string, unknown>>) {
      if (r.route) continue;
      const a = bdTopoRoadAttrs(r.pts as number[], e.roads);
      if (!a) continue;
      if (a.surface) r.surface = a.surface;
      if (a.width !== undefined) r.width = a.width;
      n++;
    }
    flags.roads = n > 0;
  }
  if (e.trees) {
    json.trees = e.trees;
    json.shrubs = e.shrubs ?? [];
    flags.vegetation = true;
  }
  json.enriched = flags;
}

/**
 * Revêtement et largeur d'une voie (points [x, y, z, …]) d'après le tronçon BD TOPO apparié : la
 * BD TOPO distingue les chemins empierrés et de terre, qu'OSM laisse souvent sans `surface`.
 */
export function bdTopoRoadAttrs(pts3: number[], roads: TileEnrichment['roads']): { surface?: string; width?: number } | null {
  const m = matchRoad(pts3, roads);
  if (!m) return null;
  const out: { surface?: string; width?: number } = {};
  if (m.nature === 'Route empierrée') out.surface = 'gravel';
  else if (m.nature === 'Chemin' || m.nature === 'Sentier') out.surface = 'ground';
  const w = m.width ?? (m.nature === 'Route empierrée' ? 3 : m.nature === 'Chemin' ? 2.5 : m.nature === 'Sentier' ? 1.2 : null);
  if (w !== null) out.width = w;
  return out;
}

/** Distance d'un point à une polyligne plate [x, z, …]. */
function distToLine(x: number, z: number, line: number[]): number {
  let best = Infinity;
  for (let i = 0; i + 3 < line.length; i += 2) {
    const ax = line[i]!;
    const az = line[i + 1]!;
    const dx = line[i + 2]! - ax;
    const dz = line[i + 3]! - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

/**
 * Tronçon BD TOPO correspondant à une voie de la tuile (points [x, y, z, …]) : distance médiane
 * des points de la voie au tronçon ≤ 4 m (les deux bases sont relevées sur les mêmes photos).
 */
function matchRoad(pts3: number[], roads: TileEnrichment['roads']): TileEnrichment['roads'][number] | null {
  let best: TileEnrichment['roads'][number] | null = null;
  let bestD = 4;
  for (const r of roads) {
    const ds: number[] = [];
    for (let i = 0; i < pts3.length; i += 3) ds.push(distToLine(pts3[i]!, pts3[i + 2]!, r.pts));
    ds.sort((a, b) => a - b);
    const med = ds[ds.length >> 1]!;
    if (med < bestD) {
      bestD = med;
      best = r;
    }
  }
  return best;
}
