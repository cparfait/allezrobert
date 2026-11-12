/** Prismes solides en mètres, dans le même repère que RouteTrack. */
export interface BuildingObstacle {
  id: string;
  tile: string;
  polygon: readonly number[];
  baseM: number;
  topM: number;
  solid: boolean;
}

export interface BuildingObstacleData {
  formatVersion: 1;
  worldId: string;
  routeId: string;
  source: {
    worldSha256: string;
    routeSha256: string;
    tiles: Readonly<Record<string, string>>;
    attribution: readonly string[];
  };
  obstacles: readonly BuildingObstacle[];
}

export type BuildingObstacleLoad =
  | { status: 'ready'; index: BuildingObstacleIndex }
  | { status: 'unavailable' | 'incompatible' | 'invalid' };

/** Refuse un chargement partiel. L'appelant peut afficher le motif ou refuser une salle. */
export function loadBuildingObstacleIndex(
  data: BuildingObstacleData | null,
  expected: { worldId: string; routeId: string; worldSha256: string; routeSha256: string },
): BuildingObstacleLoad {
  if (!data) return { status: 'unavailable' };
  if (data.formatVersion !== 1 || data.worldId !== expected.worldId || data.routeId !== expected.routeId ||
      data.source?.worldSha256 !== expected.worldSha256 || data.source.routeSha256 !== expected.routeSha256) {
    return { status: 'incompatible' };
  }
  try {
    const tiles = data.source.tiles;
    const digests = Object.values(tiles);
    if (!digests.length || !digests.every((hash) => /^[0-9a-f]{64}$/.test(hash)) ||
        !data.obstacles.every((obstacle) => Object.hasOwn(tiles, obstacle.tile))) return { status: 'invalid' };
    return { status: 'ready', index: new BuildingObstacleIndex(data.obstacles) };
  } catch {
    return { status: 'invalid' };
  }
}

export interface ObstaclePoint {
  x: number;
  y: number;
  z: number;
}

export interface ObstacleContact {
  fraction: number;
  nx: number;
  nz: number;
}

interface IndexedObstacle extends BuildingObstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  stamp: number;
}

const CELL_M = 16;
const EPS = 1e-8;

function cellKey(x: number, z: number): number {
  return x * 0x4000000 + z;
}

export function insideObstaclePolygon(polygon: readonly number[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
    const xi = polygon[i]!, zi = polygon[i + 1]!, xj = polygon[j]!, zj = polygon[j + 1]!;
    if ((zi > z) !== (zj > z) && x < xi + (xj - xi) * (z - zi) / (zj - zi)) inside = !inside;
  }
  return inside;
}

/** Un jeu incomplet ou de version différente doit être traité avant d'instancier l'index. */
export class BuildingObstacleIndex {
  private readonly cells = new Map<number, IndexedObstacle[]>();
  private query = 0;

  constructor(obstacles: readonly BuildingObstacle[]) {
    const ids = new Set<string>();
    for (const obstacle of obstacles) {
      const { id, polygon, baseM, topM } = obstacle;
      if (!id || ids.has(id) || typeof obstacle.solid !== 'boolean' || polygon.length < 6 || polygon.length % 2 ||
          !polygon.every(Number.isFinite) || !Number.isFinite(baseM) || !Number.isFinite(topM) || topM <= baseM) {
        throw new Error(`Emprise de collision invalide (${id})`);
      }
      ids.add(id);
      if (!obstacle.solid) continue;
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      let twiceArea = 0;
      for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
        const x = polygon[i]!, z = polygon[i + 1]!;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
        twiceArea += polygon[j]! * z - x * polygon[j + 1]!;
      }
      if (Math.abs(twiceArea) < EPS) throw new Error(`Emprise de collision dégénérée (${id})`);
      const indexed = { ...obstacle, minX, minZ, maxX, maxZ, stamp: 0 };
      for (let x = Math.floor(minX / CELL_M); x <= Math.floor(maxX / CELL_M); x++) {
        for (let z = Math.floor(minZ / CELL_M); z <= Math.floor(maxZ / CELL_M); z++) {
          const key = cellKey(x, z);
          const cell = this.cells.get(key);
          if (cell) cell.push(indexed);
          else this.cells.set(key, [indexed]);
        }
      }
    }
  }

  /** Balaye un cylindre vertical. Le résultat est écrit dans `hit` s'il y a contact. */
  sweep(a: ObstaclePoint, b: ObstaclePoint, radius: number, height: number, hit: ObstacleContact, rejectInitialOverlap = false): boolean {
    hit.fraction = Infinity;
    const stamp = ++this.query;
    const minX = Math.min(a.x, b.x) - radius, maxX = Math.max(a.x, b.x) + radius;
    const minZ = Math.min(a.z, b.z) - radius, maxZ = Math.max(a.z, b.z) + radius;
    for (let x = Math.floor(minX / CELL_M); x <= Math.floor(maxX / CELL_M); x++) {
      for (let z = Math.floor(minZ / CELL_M); z <= Math.floor(maxZ / CELL_M); z++) {
        const cell = this.cells.get(cellKey(x, z));
        if (!cell) continue;
        for (const obstacle of cell) {
          if (obstacle.stamp === stamp) continue;
          obstacle.stamp = stamp;
          if (minX > obstacle.maxX || maxX < obstacle.minX || minZ > obstacle.maxZ || maxZ < obstacle.minZ) continue;
          sweepPrism(a, b, radius, height, obstacle, hit, rejectInitialOverlap);
        }
      }
    }
    return hit.fraction <= 1;
  }
}

function sweepPrism(a: ObstaclePoint, b: ObstaclePoint, r: number, height: number, obstacle: BuildingObstacle, hit: ObstacleContact, rejectInitialOverlap: boolean): void {
  const dy = b.y - a.y;
  let lo = 0, hi = 1;
  if (Math.abs(dy) < EPS) {
    if (a.y >= obstacle.topM || a.y + height <= obstacle.baseM) return;
  } else {
    const bottom = (obstacle.baseM - height - a.y) / dy, top = (obstacle.topM - a.y) / dy;
    lo = Math.max(0, Math.min(bottom, top));
    hi = Math.min(1, Math.max(bottom, top));
    if (lo > hi || lo >= hit.fraction) return;
  }
  const dx = b.x - a.x, dz = b.z - a.z;
  const speed2 = dx * dx + dz * dz;
  const sx = a.x + dx * lo, sz = a.z + dz * lo;
  const p = obstacle.polygon;
  if (insideObstaclePolygon(p, sx, sz)) {
    // Pose déjà dans un solide, ou entrée par le haut / le bas. Aucune tangente sûre.
    record(hit, lo, 0, 0);
    return;
  }
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const x = p[j]!, z = p[j + 1]!;
    const ex = p[i]! - x, ez = p[i + 1]! - z;
    const length = Math.hypot(ex, ez);
    if (length < EPS) continue;
    const ux = ex / length, uz = ez / length;
    const px = sx - x, pz = sz - z;
    const along = Math.max(0, Math.min(length, px * ux + pz * uz));
    const rx = px - along * ux, rz = pz - along * uz;
    const radial = Math.hypot(rx, rz);
    if (radial <= r + EPS) {
      if (rejectInitialOverlap || lo > 0 || radial < EPS || rx * dx + rz * dz < -EPS) {
        record(hit, lo, radial > EPS ? rx / radial : 0, radial > EPS ? rz / radial : 0);
      }
      // La capsule d'un côté est convexe. Un mouvement sortant ou tangent ne la pénètre pas.
      continue;
    }

    // Partie rectiligne de la capsule. Seule la face vers laquelle on avance compte.
    const nx = -uz, nz = ux;
    const normalMotion = dx * nx + dz * nz;
    if (Math.abs(normalMotion) > EPS) {
      const side = -Math.sign(normalMotion);
      const t = (side * r - (px * nx + pz * nz)) / normalMotion;
      const at = (px + dx * t) * ux + (pz + dz * t) * uz;
      if (t >= 0 && lo + t <= hi && at >= 0 && at <= length) record(hit, lo + t, nx * side, nz * side);
    }
    // Une extrémité par côté suffit pour le polygone fermé.
    const dot = px * dx + pz * dz;
    const discriminant = dot * dot - speed2 * (px * px + pz * pz - r * r);
    if (speed2 > EPS * EPS && dot < 0 && discriminant > 0) {
      const t = (-dot - Math.sqrt(discriminant)) / speed2;
      if (t >= 0 && lo + t <= hi) record(hit, lo + t, (px + dx * t) / r, (pz + dz * t) / r);
    }
  }
}

function record(hit: ObstacleContact, fraction: number, nx: number, nz: number): void {
  if (fraction >= hit.fraction) return;
  hit.fraction = fraction;
  hit.nx = nx;
  hit.nz = nz;
}
