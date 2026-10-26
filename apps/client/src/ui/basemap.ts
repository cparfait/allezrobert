/**
 * Fond de carte Plan IGN (Géoplateforme, WMS-R) demandé directement en Lambert-93 : calé sans
 * reprojection sur les cartes du menu (carte de France zoomée, carte d'itinéraire). Assombri en
 * CSS (`.map-base`) ; hors ligne, l'image ne se charge pas et la carte reste comme avant.
 */
import './basemap.css';

const WMS = 'https://data.geopf.fr/wms-r';
const LAYER = 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2';

export const BASEMAP_ATTRIBUTION = '© IGN — Plan IGN';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Adresse de l'image du Plan IGN couvrant l'emprise Lambert-93 `l93` (m), `px` de large. */
export function basemapUrl(l93: { minE: number; minN: number; maxE: number; maxN: number }, px: number): string {
  const W = Math.round(px);
  const H = Math.max(1, Math.round((W * (l93.maxN - l93.minN)) / Math.max(1, l93.maxE - l93.minE)));
  const bbox = [l93.minE, l93.minN, l93.maxE, l93.maxN].map((n) => Math.round(n)).join(',');
  return `${WMS}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${LAYER}&STYLES=&CRS=EPSG:2154&BBOX=${bbox}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/jpeg`;
}

/**
 * `<image>` SVG du Plan IGN couvrant l'emprise Lambert-93 `l93` (m), placée sur le rectangle
 * `at` du repère SVG ; `px` : largeur de l'image demandée.
 */
export function basemapImage(l93: { minE: number; minN: number; maxE: number; maxN: number }, at: { x: number; y: number; w: number; h: number }, px: number, cls = ''): string {
  const url = basemapUrl(l93, px);
  return `<image class="map-base${cls ? ` ${cls}` : ''}" href="${esc(url)}" x="${at.x.toFixed(2)}" y="${at.y.toFixed(2)}" width="${at.w.toFixed(2)}" height="${at.h.toFixed(2)}" preserveAspectRatio="none"/>`;
}
