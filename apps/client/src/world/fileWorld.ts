import { decodeRoute } from '@allezrobert/shared';
import type { RoadGraphData, RouteData, WorldMeta, WorldPlace } from '@allezrobert/shared';
import { LOW_POLY } from '../engine/style.ts';
import type { HorizonGrid, LoadedTile, WorldSource } from './types.ts';
import { deferOpenGraph, emptyGraph, graphFetch, worldFetch } from './packs.ts';
import { decodeTileBytes } from './tileDecoder.ts';
import { createRouteStore } from './routeStore.ts';
import { buildingVisualLoader } from './buildingVisual.ts';
import { apurVegetationCredit, loadApurVegetation } from './apurVegetation.ts';

/**
 * Monde généré par tools/terrain (IGN + OpenStreetMap), servi depuis public/worlds/<id>/ :
 * world.json (index), routes/*.json, tiles/<tx>_<tz>.json (entités) + .hi.u16 / .lo.u16
 * (altitudes Uint16 petit-boutiste, h = baseM + q × stepM, ligne 0 = nord) + .ortho.jpg.
 */
export async function createFileWorld(id: string, meta: WorldMeta): Promise<WorldSource> {
  const base = `/worlds/${id}`;
  // Itinéraires à la demande (routeStore.ts) : le principal d'abord dans l'index (jalon 1), aucun fichier lu ici.
  const refs = [...meta.routes].sort((a, b) => (a.id === meta.mainRoute ? -1 : b.id === meta.mainRoute ? 1 : 0));
  const routes = createRouteStore(
    refs.map((r) => ({ id: r.id, name: r.name, lengthM: r.lengthM, elevationGainM: r.elevationGainM, loop: r.loop, ...(r.bike ? { bike: r.bike } : {}) })),
    async (routeId) => {
      const ref = refs.find((r) => r.id === routeId);
      const res = ref ? await fetch(`${base}/${ref.file}`) : null;
      if (!res?.ok) throw new Error(`Itinéraire ${routeId} introuvable`);
      // Ancien format (points en objets) ou compact (pointsFlat) : routeCodec.ts.
      return decodeRoute<RouteData>(await res.json());
    },
  );
  // Monde ouvert : noms des lieux habités pour la carte d'itinéraire du menu (facultatifs). Le graphe routier (15 à 35 Mo de JSON par zone) est chargé à la demande (`openGraphReady`,
  // packs.ts) : monde ouvert, planificateur, mini-carte locale. D'ici là `open.graph` est un graphe vide.
  let open: WorldSource['open'];
  if (meta.open) {
    const graphPath = `${base}/${meta.open.graph}`;
    const pl = meta.open.places ? await fetch(`${base}/${meta.open.places}`).catch(() => null) : null;
    const places = pl?.ok ? ((await pl.json().catch(() => null)) as WorldPlace[] | null) : null;
    const pending: NonNullable<WorldSource['open']> = { graph: emptyGraph(), fullGraph: emptyGraph(), start: meta.open.start, ...(places ? { places } : {}), ...(meta.open.map ? { map: `${base}/${meta.open.map}` } : {}) };
    deferOpenGraph(pending, async () => {
      const res = await graphFetch(graphPath);
      if (!res.ok) return false;
      // arêtes au bord du monde : seulement pour raccorder les zones voisines (pas de cul-de-sac au bord)
      const full = (await res.json()) as RoadGraphData;
      pending.graph = full.edges.some((e) => e.border) ? { ...full, edges: full.edges.filter((e) => !e.border) } : full;
      pending.fullGraph = full;
      return true;
    });
    open = pending;
  }
  const index = new Map(meta.tiles.map((t) => [t.id, t]));
  const T = meta.tileSizeM;
  const b = meta.bounds;
  const inBounds = (tx: number, tz: number) => tx * T >= b.minX && (tx + 1) * T <= b.maxX && tz * T >= b.minZ && (tz + 1) * T <= b.maxZ;
  const missing = new Set<string>();
  const loadBuildingVisual = meta.id === id ? buildingVisualLoader(id) : undefined;

  return {
    id,
    name: meta.name,
    tileSize: T,
    bounds: b,
    routes,
    attribution: [...meta.attribution, ...apurVegetationCredit(meta.originL93, b)],
    originL93: meta.originL93,
    ...(open ? { open } : {}),
    ...(meta.sea ? { sea: meta.sea } : {}),
    hasTile(tx, tz) {
      const key = `${tx}_${tz}`;
      if (missing.has(key)) return false;
      // Index vide : génération en cours, on tente toutes les tuiles de l'emprise.
      return index.size ? index.has(key) : inBounds(tx, tz);
    },
    async loadHorizon(): Promise<HorizonGrid | null> {
      const h = meta.horizon;
      if (!h) return null;
      const res = await worldFetch(`${base}/${h.file}`);
      if (!res.ok) return null;
      const raw = new Uint16Array(await res.arrayBuffer());
      if (raw.length < (h.n + 1) * (h.n + 1)) return null;
      const heights = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i++) heights[i] = h.baseM + (raw[i] as number) * h.stepM;
      const orthoBlob = h.ortho ? await orthoSource(`${base}/${h.ortho}`) : null;
      return { x0: h.x0, z0: h.z0, n: h.n, resolutionM: h.resolutionM, heights, ...(orthoBlob ? { orthoBlob } : {}) };
    },
    async loadTile(tx, tz) {
      const key = `${tx}_${tz}`;
      const idx = index.get(key);
      // Grille d'altitudes demandée en même temps que le JSON (la plus fine annoncée par l'index) ;
      // si la tuile en annonce une autre, le décodeur la redemande.
      const gridFile = idx ? `${key}.${idx.lods.includes('hi') ? 'hi' : 'lo'}.u16` : null;
      const loadGrid = async (file: string) => {
        const r = await worldFetch(`${base}/tiles/${file}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      };
      const binReady = gridFile ? loadGrid(gridFile).catch(() => null) : Promise.resolve(null);
      // Style jeu vidéo : aplats de couleur, l'orthophoto n'est pas téléchargée.
      const hasOrtho = !LOW_POLY && (idx ? idx.lods.includes('ortho') : true);
      const orthoReady = hasOrtho ? orthoSource(`${base}/tiles/${key}.ortho.jpg`) : Promise.resolve(null);
      const vegetationReady = loadApurVegetation(meta.originL93.x + tx * T, meta.originL93.y - tz * T, T);
      const res = await worldFetch(`${base}/tiles/${key}.json`);
      // 404 : tuile hors du monde, on n'y revient plus ; autre erreur (génération en cours) : on réessaiera.
      if (res.status === 404 || (res.ok && !(res.headers.get('content-type') ?? '').includes('json'))) {
        missing.add(key);
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.arrayBuffer();
      const bin = await binReady;
      // Lecture du JSON, altitudes et entités : dans un Web Worker (tileDecoder.ts).
      const tile = await decodeTileBytes(json, bin, bin ? gridFile : null, loadGrid);
      const buildingSource = { worldId: id, tileId: key };
      const buildingVisualCorrections = loadBuildingVisual && tile.sourceId === key
        ? await loadBuildingVisual(buildingSource, json, tile.features.buildings)
        : undefined;
      const orthoBlob = await orthoReady;
      const apurVegetation = await vegetationReady;
      return {
        id: key,
        tx,
        tz,
        x0: tile.x0,
        z0: tile.z0,
        size: T,
        n: tile.n,
        heights: tile.heights,
        features: tile.features,
        buildingSource,
        ...(buildingVisualCorrections ? { buildingVisualCorrections } : {}),
        ...(orthoBlob ? { orthoBlob } : {}),
        ...(apurVegetation ? { apurVegetation } : {}),
      } satisfies LoadedTile;
    },
  };
}

/**
 * Orthophoto : depuis le pack installé, sinon depuis le serveur des tuiles. Gardée compressée (≈ 120 Ko)
 * dans le cache des tuiles ; le terrain la décode au moment de l'afficher.
 */
async function orthoSource(path: string): Promise<Blob | null> {
  try {
    const r = await worldFetch(path);
    return r.ok ? await r.blob() : null;
  } catch {
    return null;
  }
}
