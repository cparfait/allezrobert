import type { LoadedTile } from '../world/types.ts';

/** Source sonore positionnée, dérivée des tags OSM d'une tuile. */
export interface SoundSource {
  kind: 'bells' | 'cows' | 'sheep' | 'horses' | 'water' | 'village' | 'surf';
  x: number;
  z: number;
  /** Portée audible (m). */
  range: number;
  /** Troupeau visible au bord de la route (style jeu vidéo) : premiers cris plus tôt, plus fréquents de près. */
  herd?: boolean;
}

function centroid(ring: number[]): [number, number] {
  let x = 0;
  let z = 0;
  const n = ring.length / 2;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i] as number;
    z += ring[i + 1] as number;
  }
  return [x / n, z / n];
}

/**
 * Ressac : bords de mer de la tuile (altitude au niveau de la mer à côté d'une terre émergée), un point tous les
 * 60 m environ, entendu à 260 m. Rien dans les tuiles sans mer (le relief ne descend pas à 0 m).
 */
export function surfSources(tile: Pick<LoadedTile, 'n' | 'heights' | 'x0' | 'z0' | 'size'>): SoundSource[] {
  const { n, heights: h } = tile;
  const out: SoundSource[] = [];
  if (!n || h.length < (n + 1) * (n + 1)) return out;
  const cell = tile.size / n;
  const step = Math.max(1, Math.round(60 / cell));
  const at = (i: number, j: number) => h[Math.min(n, Math.max(0, j)) * (n + 1) + Math.min(n, Math.max(0, i))] as number;
  for (let j = 0; j <= n; j += step)
    for (let i = 0; i <= n; i += step) {
      if (at(i, j) > 0.3) continue;
      const land = [[step, 0], [-step, 0], [0, step], [0, -step]].some(([di, dj]) => at(i + di!, j + dj!) > 1.2);
      if (land) out.push({ kind: 'surf', x: tile.x0 + i * cell, z: tile.z0 + j * cell, range: 260 });
    }
  return out;
}

/**
 * Sources sonores d'une tuile : églises → cloches, prés → vaches, étangs et rivières → eau,
 * villages → rumeur. Une source par entité, avec une portée adaptée.
 */
export function soundSourcesForTile(tile: LoadedTile): SoundSource[] {
  const out: SoundSource[] = [];
  const f = tile.features;
  for (const b of f.buildings) {
    if (b.kind !== 'church' && b.kind !== 'chapel') continue;
    const [x, z] = centroid(b.pts);
    out.push({ kind: 'bells', x, z, range: b.kind === 'church' ? 900 : 500 });
  }
  for (const m of f.fields) {
    if (m.kind !== 'meadow' && m.kind !== 'grass') continue;
    const ring = m.rings[0];
    // Seuls les grands prés accueillent un troupeau (≈ un sur trois).
    if (!ring || ring.length < 16 || (Math.abs((ring[0] as number) * 13 + (ring[1] as number) * 7) | 0) % 3 !== 0) continue;
    const [x, z] = centroid(ring);
    out.push({ kind: 'cows', x, z, range: 220 });
  }
  for (const w of f.water) {
    const ring = w.rings[0];
    if (!ring) continue;
    const [x, z] = centroid(ring);
    out.push({ kind: 'water', x, z, range: 120 });
  }
  for (const w of f.waterways) {
    if (w.tunnel || w.pts.length < 4) continue;
    const mid = Math.floor(w.pts.length / 4) * 2;
    out.push({ kind: 'water', x: w.pts[mid] as number, z: w.pts[mid + 1] as number, range: 70 });
  }
  for (const p of f.pois) if (p.kind === 'village' || p.kind === 'hamlet') out.push({ kind: 'village', x: p.x, z: p.z, range: 350 });
  out.push(...surfSources(tile));
  return out;
}
