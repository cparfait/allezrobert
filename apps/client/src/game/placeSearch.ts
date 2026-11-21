/**
 * Recherche de destination demandée par l'appli compagnon en parcours libre : lieux habités de la
 * zone (`places.json`) puis routes nommées du graphe. Insensible à la casse et aux accents ; les noms
 * qui commencent par la requête passent devant, puis ceux dont un mot commence par elle, puis les
 * autres ; à pertinence égale, les lieux avant les routes, puis le plus proche du coureur.
 *
 * L'index (noms normalisés, arêtes regroupées par nom de route) est construit une fois par sortie.
 */
import { PAIR_PLACE_MAX_ITEMS, PAIR_PLACE_NAME_MAX, type PairPlaceItem, type RoadGraphData, type WorldPlace } from '@allezrobert/shared';

interface IndexedPlace {
  name: string;
  key: string;
  kind: string;
  x: number;
  z: number;
}

interface IndexedRoad {
  name: string;
  key: string;
  /** Indices des arêtes du graphe qui portent ce nom. */
  edges: number[];
}

export interface PlaceIndex {
  places: IndexedPlace[];
  roads: IndexedRoad[];
  graph: RoadGraphData | undefined;
}

const KIND_LABEL: Record<'fr' | 'en', Record<string, string>> = {
  fr: { city: 'ville', town: 'ville', suburb: 'quartier', village: 'village', hamlet: 'hameau', locality: 'lieu-dit', isolated_dwelling: 'lieu-dit', road: 'route' },
  en: { city: 'city', town: 'town', suburb: 'district', village: 'village', hamlet: 'hamlet', locality: 'locality', isolated_dwelling: 'locality', road: 'road' },
};

/** Texte ramené à des mots en minuscules sans accents, séparés par une espace. */
export function normalizePlaceText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Index de recherche d'une zone : à construire une fois (le graphe d'une grande ville dépasse 100 000 arêtes). */
export function buildPlaceIndex(places: readonly WorldPlace[] | undefined, graph: RoadGraphData | undefined): PlaceIndex {
  const idxPlaces: IndexedPlace[] = [];
  for (const p of places ?? []) {
    const key = normalizePlaceText(p.name);
    if (key && Number.isFinite(p.x) && Number.isFinite(p.z)) idxPlaces.push({ name: p.name, key, kind: p.kind, x: p.x, z: p.z });
  }
  const byName = new Map<string, IndexedRoad>();
  graph?.edges.forEach((e, i) => {
    const name = (e.name || e.ref || '').trim();
    if (!name || e.pts.length < 3) return;
    const key = normalizePlaceText(name);
    if (!key) return;
    const road = byName.get(key);
    if (road) road.edges.push(i);
    else byName.set(key, { name, key, edges: [i] });
  });
  return { places: idxPlaces, roads: [...byName.values()], graph };
}

/** 0 : le nom commence par la requête ; 1 : un de ses mots commence par elle ; 2 : il la contient ; −1 : sans rapport. */
function rank(key: string, q: string): number {
  if (!q) return 0;
  if (key.startsWith(q)) return 0;
  const at = key.indexOf(q);
  if (at < 0) return -1;
  return key.includes(` ${q}`) ? 1 : 2;
}

/** Point d'une route (toutes ses arêtes) le plus proche du coureur. */
function nearestOnRoad(graph: RoadGraphData, road: IndexedRoad, x: number, z: number): { x: number; z: number; d: number } {
  let best = { x: 0, z: 0, d: Infinity };
  for (const i of road.edges) {
    const p = (graph.edges[i] as RoadGraphData['edges'][number]).pts;
    for (let k = 0; k + 2 < p.length; k += 3) {
      const d = Math.hypot((p[k] as number) - x, (p[k + 2] as number) - z);
      if (d < best.d) best = { x: p[k] as number, z: p[k + 2] as number, d };
    }
  }
  return best;
}

function distanceLabel(m: number, lang: 'fr' | 'en'): string {
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = (m / 1000).toFixed(1);
  return `${lang === 'fr' ? km.replace('.', ',') : km} km`;
}

/**
 * Résultats pour `query` vus de la position `me` (repère du monde, m). Requête vide : les lieux les plus
 * proches. Au plus `PAIR_PLACE_MAX_ITEMS` éléments.
 */
export function searchPlaces(index: PlaceIndex, query: string, me: { x: number; z: number }, lang: 'fr' | 'en', limit = PAIR_PLACE_MAX_ITEMS): PairPlaceItem[] {
  const q = normalizePlaceText(query);
  const found: Array<{ name: string; kind: string; x: number; z: number; d: number; rank: number; road: boolean }> = [];
  for (const p of index.places) {
    const r = rank(p.key, q);
    if (r >= 0) found.push({ name: p.name, kind: p.kind, x: p.x, z: p.z, d: Math.hypot(p.x - me.x, p.z - me.z), rank: r, road: false });
  }
  // Les routes ne viennent que sur une vraie requête (au moins deux caractères) : sinon la liste serait sans fin.
  if (q.length >= 2 && index.graph) {
    for (const road of index.roads) {
      const r = rank(road.key, q);
      if (r < 0) continue;
      const n = nearestOnRoad(index.graph, road, me.x, me.z);
      if (Number.isFinite(n.d)) found.push({ name: road.name, kind: 'road', x: n.x, z: n.z, d: n.d, rank: r, road: true });
    }
  }
  found.sort((a, b) => a.rank - b.rank || Number(a.road) - Number(b.road) || a.d - b.d || a.name.localeCompare(b.name));
  const labels = KIND_LABEL[lang];
  return found.slice(0, Math.max(0, Math.min(limit, PAIR_PLACE_MAX_ITEMS))).map((f) => ({
    name: f.name.slice(0, PAIR_PLACE_NAME_MAX),
    sub: `${labels[f.kind] ?? labels.locality} · ${distanceLabel(f.d, lang)}`,
    x: Math.round(f.x * 10) / 10,
    z: Math.round(f.z * 10) / 10,
  }));
}
