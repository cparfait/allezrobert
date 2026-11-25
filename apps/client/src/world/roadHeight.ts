import type { LoadedTile, TileRoad } from './types.ts';

/**
 * Hauteur de la chaussée dessinée par le réseau des tuiles (network.ts) en un point du plan.
 *
 * Monde ouvert : le ruban de l'itinéraire est masqué, la chaussée visible est celle du réseau, posée sur les
 * polylignes `pts3` des tuiles (coudes arrondis, roadCorners.ts) à LIFT au-dessus. Le coureur, lui, suit le profil
 * d'altitude de l'itinéraire : dans les virages arrondis, les épingles et en pente les deux s'écartent de ±10 cm
 * (jusqu'à 28 cm dans l'épingle à −15 % du Tour de Neuville, Limagne) et le vélo s'enfonçait dans la route. Le jeu
 * pose donc les roues sur cette surface-ci (main.ts).
 */

/** Levée du ruban du réseau au-dessus de sa polyligne (network.ts : sideRoadStrips(…, 0.05, …)). */
export const NETWORK_ROAD_LIFT = 0.05;
/** Même filtre que RoadNetwork.addTile en monde ouvert (chemins, escaliers… non dessinés). */
const SKIP = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'pedestrian', 'corridor', 'platform']);
const CELL = 16;
/** Écart vertical toléré avec l'altitude de référence (pont au-dessus, route en contrebas : ignorés). */
const MAX_DY = 1.5;
/** Routes à égalité de distance (m). */
const TIE = 0.15;

/** Segment d'une polyligne ; `open0` / `open1` : extrémité libre de la route (la chaussée s'y arrête, pas de prolongement). */
type Seg = { ax: number; ay: number; az: number; bx: number; by: number; bz: number; reach: number; open0: boolean; open1: boolean };

const drawn = (r: TileRoad): boolean =>
  !!r.pts3 && r.pts3.length >= 6 && !r.tunnel && (!SKIP.has(r.kind) || r.kind === 'cycleway' || (!!r.route && r.kind !== 'steps'));

export class RoadHeightField {
  private readonly tiles = new Map<string, Map<number, Seg[]>>();

  addTile(tile: LoadedTile): void {
    const grid = new Map<number, Seg[]>();
    for (const r of tile.features.roads) {
      if (!drawn(r)) continue;
      const p = r.pts3 as number[];
      // chaussée + 0,6 m de bas-côté (largeur du ruban du réseau)
      const reach = Math.max(r.width, 2.5) / 2 + 0.6;
      for (let i = 0; i + 5 < p.length; i += 3) {
        const s: Seg = { ax: p[i] as number, ay: p[i + 1] as number, az: p[i + 2] as number, bx: p[i + 3] as number, by: p[i + 4] as number, bz: p[i + 5] as number, reach, open0: i === 0, open1: i + 6 >= p.length };
        const x0 = Math.floor((Math.min(s.ax, s.bx) - reach) / CELL);
        const x1 = Math.floor((Math.max(s.ax, s.bx) + reach) / CELL);
        const z0 = Math.floor((Math.min(s.az, s.bz) - reach) / CELL);
        const z1 = Math.floor((Math.max(s.az, s.bz) + reach) / CELL);
        for (let x = x0; x <= x1; x++)
          for (let z = z0; z <= z1; z++) {
            const k = key(x, z);
            const cell = grid.get(k);
            if (cell) cell.push(s);
            else grid.set(k, [s]);
          }
      }
    }
    this.tiles.set(tile.id, grid);
  }

  removeTile(tile: LoadedTile): void {
    this.tiles.delete(tile.id);
  }

  /**
   * Dessus de la chaussée en (x, z) : la plus haute des routes dessinées qui couvrent ce point à moins de MAX_DY de
   * `nearY` (altitude attendue). NaN hors de toute route dessinée.
   */
  surfaceAt(x: number, z: number, nearY: number): number {
    // La route la plus proche dans le plan (épingle : l'autre branche, plus haute ou plus basse, est souvent à portée) ;
    // à égalité (TIE m près : carrefour, tronçons qui se chevauchent), la plus haute, pour que rien ne dépasse du pneu.
    const minD = this.scan(x, z, nearY, Infinity);
    return Number.isFinite(minD) ? this.scan(x, z, nearY, minD + TIE) : Number.NaN;
  }

  /** Point le plus proche de (x, z) sur l'axe d'une route dessinée, à moins de `maxD` m ; faux s'il n'y en a pas. */
  axisAt(x: number, z: number, nearY: number, maxD: number, out: { x: number; y: number; z: number }): boolean {
    const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
    let best = maxD;
    let found = false;
    for (const grid of this.tiles.values()) {
      const cell = grid.get(k);
      if (!cell) continue;
      for (const s of cell) {
        const dx = s.bx - s.ax;
        const dz = s.bz - s.az;
        const l2 = dx * dx + dz * dz;
        const t = l2 > 1e-9 ? Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / l2)) : 0;
        const d = Math.hypot(s.ax + t * dx - x, s.az + t * dz - z);
        const y = s.ay + t * (s.by - s.ay) + NETWORK_ROAD_LIFT;
        if (d >= best || Math.abs(y - nearY) > MAX_DY) continue;
        best = d;
        found = true;
        out.x = s.ax + t * dx;
        out.y = y;
        out.z = s.az + t * dz;
      }
    }
    return found;
  }

  /** maxD infini : plus petite distance au plan d'une route candidate ; sinon, plus haute candidate à maxD au plus. */
  private scan(x: number, z: number, nearY: number, maxD: number): number {
    const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
    const nearest = maxD === Infinity;
    let out = nearest ? Infinity : Number.NaN;
    for (const grid of this.tiles.values()) {
      const cell = grid.get(k);
      if (!cell) continue;
      for (const s of cell) {
        const dx = s.bx - s.ax;
        const dz = s.bz - s.az;
        const l2 = dx * dx + dz * dz;
        const u = l2 > 1e-9 ? ((x - s.ax) * dx + (z - s.az) * dz) / l2 : 0;
        // au-delà du bout de la route : pas de chaussée (le ruban du réseau s'arrête au dernier point)
        if ((u < 0 && s.open0) || (u > 1 && s.open1)) continue;
        const t = Math.min(1, Math.max(0, u));
        const d = Math.hypot(s.ax + t * dx - x, s.az + t * dz - z);
        if (d > s.reach || d > maxD) continue;
        const y = s.ay + t * (s.by - s.ay) + NETWORK_ROAD_LIFT;
        if (Math.abs(y - nearY) > MAX_DY) continue;
        if (nearest) out = Math.min(out, d);
        else if (!(y <= out)) out = y;
      }
    }
    return out;
  }

}

const key = (x: number, z: number): number => x * 1_000_003 + z;

/**
 * Surface de la chaussée du monde en cours (World la tient à jour ; null hors monde ouvert ou avec ?roadsnap=0).
 * Les coureurs du peloton, en ligne et fantômes, les cyclistes croisés et les voitures s'y posent comme le coureur.
 */
let current: RoadHeightField | null = null;
export function setCurrentRoadHeight(f: RoadHeightField | null): void {
  current = f;
}

export const currentRoadHeight = (): RoadHeightField | null => current;

/** Pose sur la chaussée : y de l'origine (au sol) et tangage (rad, > 0 : avant plus haut). */
export interface RoadPose {
  y: number;
  pitch: number;
}

/**
 * Pose un véhicule sur la chaussée dessinée, d'après ses points de contact à `front` m devant et `rear` m derrière
 * l'origine (x, z), le long de (fwdX, fwdZ) (sens de marche, unitaire). `nearY` et `pitch0` : altitude et tangage
 * du profil de l'itinéraire, gardés là où il n'y a pas de route dessinée. Renvoie false sans surface.
 */
export function roadPose(x: number, z: number, fwdX: number, fwdZ: number, nearY: number, pitch0: number, front: number, rear: number, out: RoadPose, field: RoadHeightField | null = current): boolean {
  out.y = nearY;
  out.pitch = pitch0;
  if (!field) return false;
  const slope = Math.tan(pitch0);
  const yF = field.surfaceAt(x + fwdX * front, z + fwdZ * front, nearY + slope * front);
  const yR = field.surfaceAt(x - fwdX * rear, z - fwdZ * rear, nearY - slope * rear);
  if (Number.isFinite(yF) && Number.isFinite(yR)) {
    out.y = yR + ((yF - yR) * rear) / (front + rear);
    out.pitch = Math.atan((yF - yR) / (front + rear));
  } else if (Number.isFinite(yF)) out.y = yF - slope * front;
  else if (Number.isFinite(yR)) out.y = yR + slope * rear;
  else return false;
  return true;
}

/** Points de contact des roues d'un vélo de route devant / derrière l'origine du coureur (m). */
export const BIKE_FRONT_M = 0.6;
export const BIKE_REAR_M = 0.417;
/** Voiture : demi-empattement moyen (m). */
export const CAR_AXLE_M = 1.3;
