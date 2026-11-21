/**
 * Fond de carte Plan IGN (Géoplateforme, WMS-R) demandé directement en Lambert-93 : commun au jeu
 * (mini-carte, cartes du menu) et à l'appli compagnon (carte locale).
 */
const WMS = 'https://data.geopf.fr/wms-r';
const LAYER = 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2';

export const BASEMAP_ATTRIBUTION = '© IGN — Plan IGN';

/** Adresse de l'image du Plan IGN couvrant l'emprise Lambert-93 `l93` (m), `px` de large. */
export function basemapUrl(l93: { minE: number; minN: number; maxE: number; maxN: number }, px: number): string {
  const W = Math.round(px);
  const H = Math.max(1, Math.round((W * (l93.maxN - l93.minN)) / Math.max(1, l93.maxE - l93.minE)));
  const bbox = [l93.minE, l93.minN, l93.maxE, l93.maxN].map((n) => Math.round(n)).join(',');
  return `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${LAYER}&STYLES=&CRS=EPSG:2154&BBOX=${bbox}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/jpeg`;
}
