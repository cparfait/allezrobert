/**
 * Fond de carte Plan IGN (Géoplateforme, WMS-R) demandé directement en Lambert-93 : calé sans
 * reprojection sur les cartes du menu (carte de France zoomée, carte d'itinéraire). Assombri en
 * CSS (`.map-base`) ; hors ligne, l'image ne se charge pas et la carte reste comme avant.
 */
import './basemap.css';

import { BASEMAP_ATTRIBUTION, basemapUrl } from '@allezrobert/shared';

// Adresse du fond et mention : communes avec l'appli compagnon (packages/shared/src/basemap.ts).
export { BASEMAP_ATTRIBUTION, basemapUrl };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/**
 * `<image>` SVG du Plan IGN couvrant l'emprise Lambert-93 `l93` (m), placée sur le rectangle
 * `at` du repère SVG ; `px` : largeur de l'image demandée.
 */
export function basemapImage(l93: { minE: number; minN: number; maxE: number; maxN: number }, at: { x: number; y: number; w: number; h: number }, px: number, cls = ''): string {
  const url = basemapUrl(l93, px);
  return `<image class="map-base${cls ? ` ${cls}` : ''}" href="${esc(url)}" x="${at.x.toFixed(2)}" y="${at.y.toFixed(2)}" width="${at.w.toFixed(2)}" height="${at.h.toFixed(2)}" preserveAspectRatio="none"/>`;
}
