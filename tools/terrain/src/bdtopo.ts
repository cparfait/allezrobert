/**
 * Bâtiments IGN BD TOPO® (Licence Ouverte Etalab 2.0) via le WFS de la Géoplateforme
 * (`BDTOPO_V3:batiment`, GeoJSON en Lambert-93), par tuile de 1 km, en cache.
 *
 * Champs utilisés : `nature`, `usage_1`, `hauteur`, `nombre_d_etages`, `nombre_de_logements`,
 * `altitude_minimale_sol`, `materiaux_des_murs` / `materiaux_de_la_toiture` (codes des fichiers
 * fonciers : un chiffre par matériau, le premier non nul domine).
 */
import { cachePath, fetchCached } from './net.ts';

export const ATTRIBUTION_BDTOPO = '© IGN — BD TOPO® (Licence Ouverte Etalab 2.0)';

const WFS = 'https://data.geopf.fr/wfs/ows';
const PAGE = 1000;

export interface BdTopoBuilding {
  id: string;
  nature: string;
  usage: string;
  /** Hauteur (m) : du sol au point le plus haut du toit, si connue. */
  height: number | null;
  levels: number | null;
  dwellings: number | null;
  groundAltM: number | null;
  wallCode: string;
  roofCode: string;
  /** Anneaux Lambert-93 [e, n] du premier polygone (extérieur puis trous). */
  rings: Array<Array<[number, number]>>;
}

interface GeoJsonFeature {
  id?: string;
  properties: Record<string, unknown>;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] } | null;
}

/** Bâtiments dont l'emprise touche le rectangle Lambert-93 (toutes les pages WFS). */
export async function fetchBdTopoBuildings(eMin: number, nMin: number, eMax: number, nMax: number): Promise<BdTopoBuilding[]> {
  const out: BdTopoBuilding[] = [];
  for (let start = 0; ; start += PAGE) {
    const url =
      `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment&SRSNAME=EPSG:2154` +
      `&BBOX=${eMin},${nMin},${eMax},${nMax},EPSG:2154&COUNT=${PAGE}&STARTINDEX=${start}&SORTBY=cleabs&OUTPUTFORMAT=application/json`;
    const buf = await fetchCached(url, cachePath('bdtopo-batiment', `${eMin}_${nMin}_${eMax}_${nMax}_${start}`, '.json'), {
      timeoutMs: 120000,
      retries: 4,
      validate: (b) => (b[0] === 0x7b ? null : `pas du JSON : ${b.subarray(0, 120).toString()}`),
    });
    const fc = JSON.parse(buf.toString('utf8')) as { features: GeoJsonFeature[] };
    for (const f of fc.features) {
      const g = f.geometry;
      if (!g) continue;
      const poly = (g.type === 'MultiPolygon' ? (g.coordinates as number[][][][])[0] : (g.coordinates as number[][][])) ?? [];
      const rings = poly.map((ring) => {
        const r = ring.map((c) => [c[0]!, c[1]!] as [number, number]);
        // anneau GeoJSON fermé : dernier point = premier
        if (r.length > 1 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1]) r.pop();
        return r;
      });
      if (!rings[0] || rings[0].length < 3) continue;
      const p = f.properties;
      const num = (k: string) => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? (p[k] as number) : null);
      out.push({
        id: String(p.cleabs ?? f.id ?? ''),
        nature: String(p.nature ?? ''),
        usage: String(p.usage_1 ?? ''),
        height: num('hauteur'),
        levels: num('nombre_d_etages'),
        dwellings: num('nombre_de_logements'),
        groundAltM: num('altitude_minimale_sol'),
        wallCode: String(p.materiaux_des_murs ?? ''),
        roofCode: String(p.materiaux_de_la_toiture ?? ''),
        rings,
      });
    }
    if (fc.features.length < PAGE) break;
  }
  return out;
}

export interface BdTopoRoad {
  /** « Route à 1 chaussée », « Route empierrée », « Chemin », « Sentier »… */
  nature: string;
  /** Largeur de chaussée (m), si renseignée. */
  width: number | null;
  /** Polyligne Lambert-93 [e, n]. */
  pts: Array<[number, number]>;
}

/** Tronçons de route BD TOPO (`BDTOPO_V3:troncon_de_route`) touchant le rectangle Lambert-93. */
export async function fetchBdTopoRoads(eMin: number, nMin: number, eMax: number, nMax: number): Promise<BdTopoRoad[]> {
  const out: BdTopoRoad[] = [];
  for (let start = 0; ; start += PAGE) {
    const url =
      `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:troncon_de_route&SRSNAME=EPSG:2154` +
      `&BBOX=${eMin},${nMin},${eMax},${nMax},EPSG:2154&COUNT=${PAGE}&STARTINDEX=${start}&SORTBY=cleabs&OUTPUTFORMAT=application/json`;
    const buf = await fetchCached(url, cachePath('bdtopo-route', `${eMin}_${nMin}_${eMax}_${nMax}_${start}`, '.json'), {
      timeoutMs: 120000,
      retries: 4,
      validate: (b) => (b[0] === 0x7b ? null : `pas du JSON : ${b.subarray(0, 120).toString()}`),
    });
    const fc = JSON.parse(buf.toString('utf8')) as { features: Array<{ properties: Record<string, unknown>; geometry: { type: string; coordinates: number[][] | number[][][] } | null }> };
    for (const f of fc.features) {
      const g = f.geometry;
      if (!g) continue;
      const line = (g.type === 'MultiLineString' ? (g.coordinates as number[][][])[0] : (g.coordinates as number[][])) ?? [];
      if (line.length < 2) continue;
      const w = f.properties.largeur_de_chaussee;
      out.push({ nature: String(f.properties.nature ?? ''), width: typeof w === 'number' && w > 0 ? w : null, pts: line.map((c) => [c[0]!, c[1]!] as [number, number]) });
    }
    if (fc.features.length < PAGE) break;
  }
  return out;
}

/** Premier matériau non nul d'un code des fichiers fonciers (« 10 » → 1, « 03 » → 3), 0 si inconnu. */
export function dominantMaterial(code: string): number {
  for (const ch of code) if (ch >= '1' && ch <= '9') return Number(ch);
  return 0;
}

/** Murs : 1 pierre, 2 meulière (moellons), 3 béton, 4 brique, 5 aggloméré, 6 bois, 9 autres. */
export function wallMaterial(code: string): 'stone' | 'brick' | 'render' | 'wood' | 'concrete' | null {
  switch (dominantMaterial(code)) {
    case 1:
    case 2:
      return 'stone';
    case 3:
      return 'concrete';
    case 4:
      return 'brick';
    case 5:
    case 9:
      return 'render';
    case 6:
      return 'wood';
    default:
      return null;
  }
}

/** Toits : 1 tuiles, 2 ardoises, 3 zinc / aluminium, 4 béton, 9 autres. */
export function roofMaterial(code: string): 'tiles' | 'slate' | 'metal' | 'concrete' | null {
  switch (dominantMaterial(code)) {
    case 1:
    case 9:
      return 'tiles';
    case 2:
      return 'slate';
    case 3:
      return 'metal';
    case 4:
      return 'concrete';
    default:
      return null;
  }
}

/** Type de bâtiment du jeu (mêmes valeurs que les bâtiments OSM des tuiles). */
export function buildingKind(b: BdTopoBuilding, areaM2: number): string {
  const n = b.nature;
  if (/glise/.test(n)) return 'church';
  if (/Chapelle/.test(n)) return 'chapel';
  if (/Château/.test(n)) return 'castle';
  if (/Tour|donjon|Moulin/.test(n)) return 'tower';
  if (/Serre/.test(n)) return 'greenhouse';
  if (/Silo|Industriel/.test(n)) return b.usage === 'Résidentiel' ? 'farm' : areaM2 > 120 ? 'barn' : 'shed';
  switch (b.usage) {
    case 'Résidentiel':
      return (b.dwellings ?? 1) > 2 && (b.levels ?? 1) >= 3 ? 'apartments' : 'house';
    case 'Annexe':
      return areaM2 > 60 ? 'garage' : 'shed';
    case 'Agricole':
      return 'barn';
    case 'Industriel':
      return 'industrial';
    case 'Commercial et services':
      return 'commercial';
    case 'Religieux':
      return 'church';
    case 'Sportif':
      return 'public';
    default:
      // « Indifférencié » : petites emprises = annexes, sinon maison
      return areaM2 < 35 ? 'shed' : areaM2 > 400 ? 'barn' : 'house';
  }
}
