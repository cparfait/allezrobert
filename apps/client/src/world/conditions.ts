import type { LoadedTile } from './types.ts';
import { splatAt } from './splat.ts';

const FOREST = 0;
const URBAN = 4;

/**
 * Revêtement OSM de la route la plus proche du point (x, z) dans la tuile, s'il en passe une à
 * moins d'une demi-largeur + 1,5 m ; sinon `fallback`. Les tronçons de l'itinéraire actif et les
 * routes voisines portent tous leur tag `surface` (enrobé par défaut côté pipeline).
 */
export function roadSurfaceAt(tile: LoadedTile | undefined | null, x: number, z: number, fallback = 'asphalt'): string {
  if (!tile) return fallback;
  let best = Infinity;
  let surface = fallback;
  for (const r of tile.features.roads) {
    const p = r.pts;
    const reach = r.width / 2 + 1.5;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i] as number;
      const az = p[i + 1] as number;
      const bx = p[i + 2] as number;
      const bz = p[i + 3] as number;
      // Rejet rapide par boîte englobante.
      if (x < Math.min(ax, bx) - reach || x > Math.max(ax, bx) + reach || z < Math.min(az, bz) - reach || z > Math.max(az, bz) + reach) continue;
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.min(Math.max(((x - ax) * dx + (z - az) * dz) / l2, 0), 1) : 0;
      const d = Math.hypot(ax + t * dx - x, az + t * dz - z) - r.width / 2;
      if (d < best && d < 1.5) {
        best = d;
        surface = r.surface || fallback;
      }
    }
  }
  return surface;
}

/**
 * Abri du vent (0–1) au point (x, z) : bâti et forêt de part et d'autre de la route, à 15 m.
 * Rue de village bordée de maisons ≈ 1, route de plaine ≈ 0, sous-bois ≈ 0,8.
 */
export function windShelterAt(tile: LoadedTile | undefined | null, x: number, z: number, dirX: number, dirZ: number): number {
  if (!tile?.splat) return 0;
  let urban = 0;
  let forest = 0;
  for (const side of [-1, 1]) {
    const px = x - dirZ * 15 * side;
    const pz = z + dirX * 15 * side;
    urban += splatAt(tile, URBAN, px, pz) / 2;
    forest += splatAt(tile, FOREST, px, pz) / 2;
  }
  return Math.min(1, Math.max(urban, 0.8 * forest));
}
