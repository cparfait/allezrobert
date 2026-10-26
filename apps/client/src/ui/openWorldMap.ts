/**
 * Carte du monde ouvert : tracé de l'itinéraire (polyligne du serveur, un point tous les ~25 m) sur le
 * Plan IGN quand l'emprise est connue, et coureurs en ligne placés par leur distance sur le parcours.
 * Repère : x est, z sud (nord en haut) ; Plan IGN : E = origine.x + x, N = origine.y − z.
 */
import type { PublicDot } from '@allezrobert/shared';
import { basemapImage } from './basemap.ts';

export interface Bounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface MapInput {
  /** x, z, y (m) à plat, répartis régulièrement le long de l'itinéraire. */
  polyline: number[];
  lengthM: number;
  loop: boolean;
  /** Origine Lambert-93 du monde ; sans elle, pas de fond de carte. */
  origin?: { x: number; y: number } | undefined;
}

/** Emprise du tracé, élargie de `padM` (m) et ramenée à un rectangle d'au moins `minSideM`. */
export function routeBounds(polyline: number[], padM = 150, minSideM = 600): Bounds {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 2 < polyline.length; i += 3) {
    const x = polyline[i] as number;
    const z = polyline[i + 1] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return { minX: -minSideM / 2, minZ: -minSideM / 2, maxX: minSideM / 2, maxZ: minSideM / 2 };
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const hw = Math.max((maxX - minX) / 2 + padM, minSideM / 2);
  const hh = Math.max((maxZ - minZ) / 2 + padM, minSideM / 2);
  return { minX: cx - hw, maxX: cx + hw, minZ: cz - hh, maxZ: cz + hh };
}

/** Point du tracé à la distance `d` (m) ; boucle : la distance est repliée, sinon bornée. */
export function pointAtDistance(polyline: number[], d: number, lengthM: number, loop: boolean): { x: number; z: number } {
  const n = Math.floor(polyline.length / 3);
  if (n === 0) return { x: 0, z: 0 };
  if (n === 1 || lengthM <= 0) return { x: polyline[0] as number, z: polyline[1] as number };
  let t = loop ? ((d % lengthM) + lengthM) % lengthM : Math.min(Math.max(d, 0), lengthM);
  t = (t / lengthM) * (n - 1);
  const i = Math.min(Math.floor(t), n - 2);
  const k = t - i;
  const ax = polyline[i * 3] as number;
  const az = polyline[i * 3 + 1] as number;
  const bx = polyline[(i + 1) * 3] as number;
  const bz = polyline[(i + 1) * 3 + 1] as number;
  return { x: ax + (bx - ax) * k, z: az + (bz - az) * k };
}

/** Tracé SVG de la polyligne (fermé pour une boucle). */
export function trackPath(polyline: number[], loop: boolean): string {
  const pts: string[] = [];
  for (let i = 0; i + 2 < polyline.length; i += 3) pts.push(`${(polyline[i] as number).toFixed(1)} ${(polyline[i + 1] as number).toFixed(1)}`);
  return pts.length ? `M${pts.join('L')}${loop ? 'Z' : ''}` : '';
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Rayon d'un point (m) pour que les coureurs restent lisibles quelle que soit l'emprise de la zone. */
export function dotRadius(b: Bounds): number {
  return Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 90;
}

/** Calque des coureurs : inconnus en vert, amis en or avec leur nom ; `dir` −1 = à contresens de l'itinéraire. */
export function dotsSvg(input: MapInput, dots: PublicDot[], b: Bounds, fr = true): string {
  const r = dotRadius(b);
  // Les amis sont dessinés en dernier : jamais cachés par un inconnu.
  const ordered = [...dots].sort((a, c) => Number(!!a.friend) - Number(!!c.friend));
  return ordered
    .map((dot) => {
      const p = pointAtDistance(input.polyline, dot.d, input.lengthM, input.loop);
      const way = dot.dir === -1 ? (fr ? 'à contresens' : 'riding backwards') : fr ? 'dans le sens du parcours' : 'riding forwards';
      if (dot.friend) {
        const label = dot.name ? `<text x="${(p.x + r * 1.8).toFixed(1)}" y="${(p.z + r * 0.5).toFixed(1)}" class="ow-label" font-size="${(r * 2.4).toFixed(1)}">${esc(dot.name)}</text>` : '';
        return `<g class="ow-dot friend"><circle cx="${p.x.toFixed(1)}" cy="${p.z.toFixed(1)}" r="${(r * 1.5).toFixed(1)}"><title>${esc(dot.name ?? '')} · ${way}</title></circle>${label}</g>`;
      }
      return `<circle class="ow-dot" cx="${p.x.toFixed(1)}" cy="${p.z.toFixed(1)}" r="${r.toFixed(1)}"><title>${way}</title></circle>`;
    })
    .join('');
}

/** Carte complète : fond IGN (si l'origine est connue), tracé, ligne de départ, calque des coureurs (`#ow-dots`). */
export function mapSvg(input: MapInput, dots: PublicDot[], fr = true): { svg: string; bounds: Bounds } {
  const b = routeBounds(input.polyline);
  const w = b.maxX - b.minX;
  const h = b.maxZ - b.minZ;
  const o = input.origin;
  const base = o ? basemapImage({ minE: o.x + b.minX, minN: o.y - b.maxZ, maxE: o.x + b.maxX, maxN: o.y - b.minZ }, { x: b.minX, y: b.minZ, w, h }, 900) : '';
  const start = pointAtDistance(input.polyline, 0, input.lengthM, input.loop);
  const r = dotRadius(b);
  const svg = `<svg class="ow-svg" viewBox="${b.minX.toFixed(1)} ${b.minZ.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" role="img" aria-label="${fr ? 'Carte du parcours et des coureurs en ligne' : 'Map of the route and riders online'}" preserveAspectRatio="xMidYMid meet">
    ${base}
    <path class="ow-track-halo" d="${trackPath(input.polyline, input.loop)}" fill="none" vector-effect="non-scaling-stroke" />
    <path class="ow-track" d="${trackPath(input.polyline, input.loop)}" fill="none" vector-effect="non-scaling-stroke" />
    <rect class="ow-start" x="${(start.x - r * 0.9).toFixed(1)}" y="${(start.z - r * 0.9).toFixed(1)}" width="${(r * 1.8).toFixed(1)}" height="${(r * 1.8).toFixed(1)}"><title>${fr ? 'Départ' : 'Start'}</title></rect>
    <g id="ow-dots">${dotsSvg(input, dots, b, fr)}</g>
  </svg>`;
  return { svg, bounds: b };
}
