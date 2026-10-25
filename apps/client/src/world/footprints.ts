/**
 * Emprises des bâtiments (polygone + base + sommet) rangées dans une grille, pour savoir en quelques
 * microsecondes si un segment (tête du coureur → caméra) traverse un bâtiment. Remplace le lancer de
 * rayon sur les maillages fusionnés des tuiles, qui testait chaque triangle (près de la moitié du
 * temps processeur de l'image en village).
 */
export interface Footprint {
  /** Polygone [x0, z0, x1, z1, …] (ouvert ou fermé). */
  pts: ArrayLike<number>;
  base: number;
  top: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** Dernière requête qui l'a testé (évite de tester deux fois un bâtiment à cheval sur deux cases). */
  stamp: number;
}

const CELL = 16;

export class FootprintIndex {
  private readonly cells = new Map<number, Footprint[]>();
  private readonly byTile = new Map<string, Array<[number, Footprint]>>();
  private query = 0;

  /** Clé numérique d'une case (sans chaîne : pas d'allocation dans la boucle). */
  private static key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  get size(): number {
    let n = 0;
    for (const l of this.byTile.values()) n += l.length;
    return n;
  }

  add(tileId: string, pts: ArrayLike<number>, base: number, top: number): void {
    if (pts.length < 6) return;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const x = pts[i] as number;
      const z = pts[i + 1] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const f: Footprint = { pts, base, top, minX, minZ, maxX, maxZ, stamp: 0 };
    let list = this.byTile.get(tileId);
    if (!list) this.byTile.set(tileId, (list = []));
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = FootprintIndex.key(cx, cz);
        let cell = this.cells.get(k);
        if (!cell) this.cells.set(k, (cell = []));
        cell.push(f);
        list.push([k, f]);
      }
  }

  removeTile(tileId: string): void {
    const list = this.byTile.get(tileId);
    if (!list) return;
    for (const [k, f] of list) {
      const cell = this.cells.get(k);
      if (!cell) continue;
      const i = cell.indexOf(f);
      if (i >= 0) cell.splice(i, 1);
      if (!cell.length) this.cells.delete(k);
    }
    this.byTile.delete(tileId);
  }

  clear(): void {
    this.cells.clear();
    this.byTile.clear();
  }

  /**
   * Premier bâtiment traversé par le segment a → b : fraction (0–1) du segment au point d'entrée,
   * ou null s'il est dégagé. Bâtiment approché par un prisme (emprise × base–sommet, toit compris).
   */
  firstHit(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number | null {
    const stamp = ++this.query;
    let best = Infinity;
    const x0 = Math.floor(Math.min(ax, bx) / CELL);
    const x1 = Math.floor(Math.max(ax, bx) / CELL);
    const z0 = Math.floor(Math.min(az, bz) / CELL);
    const z1 = Math.floor(Math.max(az, bz) / CELL);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const cell = this.cells.get(FootprintIndex.key(cx, cz));
        if (!cell) continue;
        for (const f of cell) {
          if (f.stamp === stamp) continue;
          f.stamp = stamp;
          if (Math.max(ax, bx) < f.minX || Math.min(ax, bx) > f.maxX || Math.max(az, bz) < f.minZ || Math.min(az, bz) > f.maxZ) continue;
          const t = segmentPrism(f, ax, ay, az, bx, by, bz, best);
          if (t !== null && t < best) best = t;
        }
      }
    return Number.isFinite(best) ? best : null;
  }
}

/** Point (x, z) dans le polygone (règle pair-impair). */
export function insidePolygon(pts: ArrayLike<number>, x: number, z: number): boolean {
  let inside = false;
  const n = pts.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2] as number;
    const zi = pts[i * 2 + 1] as number;
    const xj = pts[j * 2] as number;
    const zj = pts[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Plus petite fraction t ∈ [0, limit) où le segment est dans le prisme, ou null. */
function segmentPrism(f: Footprint, ax: number, ay: number, az: number, bx: number, by: number, bz: number, limit: number): number | null {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  let best: number | null = null;
  const consider = (t: number, onBoundary: boolean) => {
    if (t < 0 || t > 1 || (best !== null && t >= best) || t >= limit) return;
    const y = ay + dy * t;
    if (y < f.base - 1e-6 || y > f.top + 1e-6) return;
    if (!onBoundary && !insidePolygon(f.pts, ax + dx * t, az + dz * t)) return;
    best = t;
  };
  // Départ dans le bâtiment.
  consider(0, false);
  // Traversée d'un mur.
  const n = f.pts.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const px = f.pts[j * 2] as number;
    const pz = f.pts[j * 2 + 1] as number;
    const ex = (f.pts[i * 2] as number) - px;
    const ez = (f.pts[i * 2 + 1] as number) - pz;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((px - ax) * ez - (pz - az) * ex) / den;
    const u = ((px - ax) * dz - (pz - az) * dx) / den;
    if (u >= 0 && u <= 1) consider(t, true);
  }
  // Entrée par le toit ou par le bas.
  if (Math.abs(dy) > 1e-9) {
    consider((f.top - ay) / dy, false);
    consider((f.base - ay) / dy, false);
  }
  return best;
}
