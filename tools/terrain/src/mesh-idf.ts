/**
 * Maillage de l'Île-de-France en zones ouvertes (voir docs/MAILLAGE_ILE_DE_FRANCE.md).
 *
 *   npx tsx src/mesh-idf.ts            # écrit mesh/ile-de-france.json et mesh/zones/<id>.json (sans tours)
 *
 * Les zones sont des carrés de 16 km (256 tuiles) alignés sur le quadrillage kilométrique Lambert-93,
 * sans recouvrement entre elles (bord commun : `neighbourZones` les raccorde). Le décalage du quadrillage
 * est celui qui couvre toute la région avec le moins de zones. Contour de la région : Etalab / IGN
 * (mesh/ile-de-france.geojson). Noms : commune la plus peuplée dont le centre est dans la zone
 * (geo.api.gouv.fr, mis en cache dans data/cache/mesh/communes.json).
 *
 * Les zones écrites ici n'ont pas de tours : `mesh-tours.ts` les calcule (20, 30, 40, 50 km) puis
 * déplace chaque zone terminée dans `tools/terrain/zones/`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromL93, toL93 } from './lambert93.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const MESH_DIR = path.join(REPO_ROOT, 'tools', 'terrain', 'mesh');
export const MESH_ZONES_DIR = path.join(MESH_DIR, 'zones');
const CACHE = path.join(REPO_ROOT, 'data', 'cache', 'mesh', 'communes.json');
const TILE = 1000;
/** Côté d'une zone (km) : un tour de 50 km y tient avec une marge ; 256 tuiles ≈ 50 min de construction. */
export const CELL_KM = 16;
const MIN_SHARE = 0.12;
const DROP_SHARE = 0.1;

type Ring = Array<[number, number]>;

function regionRings(): Ring[][] {
  const g = JSON.parse(fs.readFileSync(path.join(MESH_DIR, 'ile-de-france.geojson'), 'utf8'));
  const geom = g.geometry ?? g.features[0].geometry;
  const polys: number[][][][] = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.map((p) => p.map((r) => r.map(([lo, la]) => { const m = toL93(lo!, la!); return [m.x, m.y] as [number, number]; })));
}

function inside(rings: Ring[][], x: number, y: number): boolean {
  let c = false;
  for (const poly of rings) {
    let k = false;
    for (const r of poly) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i]!;
        const [xj, yj] = r[j]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) k = !k;
      }
    }
    if (k) c = !c;
  }
  return c;
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface Commune { nom: string; population: number; codeDepartement: string; x: number; y: number; lon: number; lat: number }

async function communes(): Promise<Commune[]> {
  if (!fs.existsSync(CACHE)) {
    const r = await fetch('https://geo.api.gouv.fr/communes?codeRegion=11&fields=nom,population,centre,codeDepartement&format=json&geometry=centre');
    if (!r.ok) throw new Error(`geo.api.gouv.fr : ${r.status}`);
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, await r.text());
  }
  const raw = JSON.parse(fs.readFileSync(CACHE, 'utf8')) as Array<{ nom: string; population?: number; codeDepartement: string; centre: { coordinates: [number, number] } }>;
  return raw.map((c) => {
    const [lon, lat] = c.centre.coordinates;
    const m = toL93(lon, lat);
    return { nom: c.nom, population: c.population ?? 0, codeDepartement: c.codeDepartement, x: m.x, y: m.y, lon, lat };
  });
}

const DEPT: Record<string, string> = { '75': 'Paris', '77': 'Seine-et-Marne', '78': 'Yvelines', '91': 'Essonne', '92': 'Hauts-de-Seine', '93': 'Seine-Saint-Denis', '94': 'Val-de-Marne', '95': "Val-d'Oise" };

async function main(): Promise<void> {
  const rings = regionRings();
  let minE = Infinity, minN = Infinity, maxE = 0, maxN = 0;
  for (const p of rings) for (const r of p) for (const [x, y] of r) { minE = Math.min(minE, x); maxE = Math.max(maxE, x); minN = Math.min(minN, y); maxN = Math.max(maxN, y); }
  const E0 = Math.floor(minE / TILE) * TILE;
  const N0 = Math.floor(minN / TILE) * TILE;
  const W = Math.ceil((maxE - E0) / TILE);
  const H = Math.ceil((maxN - N0) / TILE);
  const tiles = new Uint8Array(W * H);
  let regionTiles = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (inside(rings, E0 + i * TILE + TILE / 2, N0 + j * TILE + TILE / 2)) { tiles[j * W + i] = 1; regionTiles++; }

  // décalage du quadrillage : le moins de zones, puis le moins de zones presque vides
  const S = CELL_KM;
  let best: { sc: number; oi: number; oj: number; cells: Map<string, number> } | null = null;
  for (let oi = 0; oi < S; oi++) for (let oj = 0; oj < S; oj++) {
    const cells = new Map<string, number>();
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (tiles[j * W + i]) {
      const k = `${Math.floor((i + oi) / S)},${Math.floor((j + oj) / S)}`;
      cells.set(k, (cells.get(k) ?? 0) + 1);
    }
    const sparse = [...cells.values()].filter((v) => v < S * S * MIN_SHARE).length;
    const sc = cells.size * 1000 + sparse;
    if (!best || sc < best.sc) best = { sc, oi, oj, cells };
  }
  const { oi, oj } = best!;
  // zones presque vides (< 10 % de la région) abandonnées : quelques km² de bord restent hors maillage
  const cells = new Map([...best!.cells].filter(([, v]) => v >= S * S * DROP_SHARE));
  const uncovered = regionTiles - [...cells.values()].reduce((a, b) => a + b, 0);

  const all = await communes();
  const idx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'apps', 'client', 'public', 'worlds', 'index.json'), 'utf8')) as { zones: Array<{ id: string; l93?: { minE: number; minN: number; maxE: number; maxN: number } }> };

  const used = new Set(idx.zones.map((z) => z.id));
  const out: Array<Record<string, unknown>> = [];
  fs.rmSync(MESH_ZONES_DIR, { recursive: true, force: true });
  fs.mkdirSync(MESH_ZONES_DIR, { recursive: true });
  const keys = [...cells.keys()].sort((a, b) => {
    const [ai, aj] = a.split(',').map(Number) as [number, number];
    const [bi, bj] = b.split(',').map(Number) as [number, number];
    return bj - aj || ai - bi; // du nord au sud, d'ouest en est
  });
  for (const k of keys) {
    const [ci, cj] = k.split(',').map(Number) as [number, number];
    // emprise : on retire le décalage ; (ci, cj) → coin sud-ouest
    const minEc = E0 + (ci * S - oi) * TILE;
    const minNc = N0 + (cj * S - oj) * TILE;
    const rect = { minE: minEc, minN: minNc, maxE: minEc + S * TILE, maxN: minNc + S * TILE };
    const inCell = all.filter((c) => c.x >= rect.minE && c.x < rect.maxE && c.y >= rect.minN && c.y < rect.maxN && inside(rings, c.x, c.y));
    const main = inCell.sort((a, b) => b.population - a.population)[0]
      ?? all.map((c) => ({ c, d: Math.hypot(c.x - (rect.minE + rect.maxE) / 2, c.y - (rect.minN + rect.maxN) / 2) })).sort((a, b) => a.d - b.d)[0]!.c;
    let id = `idf-${slug(main.nom)}`;
    if (used.has(id)) id = `${id}-${main.codeDepartement}`;
    used.add(id);
    const ox = rect.minE + (S / 2) * TILE;
    const oy = rect.minN + (S / 2) * TILE;
    const half = S / 2;
    const overlaps = idx.zones.filter((z) => z.l93 && Math.min(z.l93.maxE, rect.maxE) > Math.max(z.l93.minE, rect.minE) && Math.min(z.l93.maxN, rect.maxN) > Math.max(z.l93.minN, rect.minN)).map((z) => z.id);
    const regionShare = cells.get(k)! / (S * S);
    const zone = {
      kind: 'open',
      id,
      name: `Île-de-France — ${main.nom}`,
      region: `${DEPT[main.codeDepartement] ?? main.codeDepartement} · Île-de-France`,
      originL93: { x: ox, y: oy },
      corridorTiles: { txMin: -half, txMax: half - 1, tzMin: -half, tzMax: half - 1 },
      start: { lon: Math.round(main.lon * 1e5) / 1e5, lat: Math.round(main.lat * 1e5) / 1e5 },
      orthoPx: 1024,
      // bâti : qualité standard (QUALITY.enrich, 600 m) — bâtiments BD TOPO aux toits mesurés partout où il y a des routes
      horizon: { halfSizeM: 30000, resM: 100 },
      tours: [],
    };
    fs.writeFileSync(path.join(MESH_ZONES_DIR, `${id}.json`), JSON.stringify(zone, null, 2) + '\n');
    out.push({ id, name: zone.name, col: ci, row: cj, rect, tiles: S * S, regionTiles: cells.get(k), regionShare: Math.round(regionShare * 100) / 100, main: main.nom, population: main.population, overlaps });
  }
  const plan = {
    formatVersion: 1,
    cellKm: S,
    gridOffsetKm: { e: oi, n: oj },
    region: { tiles: regionTiles, km2: regionTiles, uncoveredKm2: uncovered, bboxL93: { minE: E0, minN: N0, maxE: E0 + W * TILE, maxN: N0 + H * TILE } },
    zones: out,
    totals: { zones: out.length, tiles: out.length * S * S, hoursBuildEstimate: Math.round((out.length * S * S * 12) / 3600), cacheGoEstimate: Math.round((out.length * S * S * 35) / 1024) },
  };
  fs.writeFileSync(path.join(MESH_DIR, 'ile-de-france.json'), JSON.stringify(plan, null, 2) + '\n');
  console.log(`${out.length} zones de ${S} km (décalage ${oi},${oj}), ${plan.totals.tiles} tuiles, ≈ ${plan.totals.hoursBuildEstimate} h de construction, ≈ ${plan.totals.cacheGoEstimate} Go de cache, ${uncovered} km² de la région hors maillage`);
  for (const z of out) console.log(`${String(z.id).padEnd(34)} (${z.col},${z.row}) ${Math.round((z.regionShare as number) * 100)}% région  ${(z.overlaps as string[]).join(',')}`);
  void fromL93;
}

await main();
