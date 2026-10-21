import type { RouteData, RoutePoint } from '@allezrobert/shared';
import { fbm, rng, valueNoise } from '../engine/noise.ts';
import type { LoadedTile, TileFeatures, WorldSource } from './types.ts';
import { SPLAT_CHANNELS } from './types.ts';

/**
 * Monde procédural de secours : une vallée boisée façon Chevreuse avec une boucle d'environ 10 km.
 * Sert au développement quand les tuiles IGN/OSM n'ont pas été générées (elles ne sont pas versionnées).
 */
const TILE = 1000;
const N = 200; // 5 m par échantillon
const SPLAT_RES = 256;

function baseHeight(x: number, z: number): number {
  // Plateau ondulé + vallée orientée ouest-est qui traverse la boucle.
  const plateau = 150 + 22 * fbm(x / 2200, z / 2200, 5);
  const valleyCenter = 350 * Math.sin(x / 1900);
  const dv = (z - valleyCenter) / 520;
  const valley = -62 * Math.exp(-dv * dv);
  const side = 10 * fbm(x / 400 + 9, z / 400 - 3, 4);
  return plateau + valley + side;
}

function buildLoop(): RouteData {
  const raw: Array<{ x: number; z: number }> = [];
  const steps = 5000;
  for (let i = 0; i < steps; i++) {
    const th = (i / steps) * Math.PI * 2;
    const r = 1550 + 260 * Math.sin(3 * th + 1) + 130 * Math.sin(5 * th + 0.4) + 60 * Math.sin(9 * th);
    raw.push({ x: Math.cos(th) * r, z: Math.sin(th) * r * 0.85 });
  }
  // Rééchantillonnage tous les 2 m.
  const pts: RoutePoint[] = [];
  let d = 0;
  let acc = 0;
  pts.push({ x: raw[0]!.x, y: 0, z: raw[0]!.z, d: 0 });
  for (let i = 1; i <= raw.length; i++) {
    const a = raw[i - 1]!;
    const b = raw[i % raw.length]!;
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    let t = 0;
    while (acc + seg * (1 - t) >= 2) {
      const need = 2 - acc;
      t += need / seg;
      acc = 0;
      d += 2;
      pts.push({ x: a.x + (b.x - a.x) * t, y: 0, z: a.z + (b.z - a.z) * t, d });
    }
    acc += seg * (1 - t);
  }
  const total = d + acc;
  pts.pop();
  // Profil de route : relief lissé sur ±80 m (une route ne suit pas chaque bosse).
  const h = pts.map((p) => baseHeight(p.x, p.z));
  const win = 40;
  for (let i = 0; i < pts.length; i++) {
    let s = 0;
    let wsum = 0;
    for (let k = -win; k <= win; k++) {
      const w = 1 - Math.abs(k) / (win + 1);
      s += (h[(i + k + h.length) % h.length] as number) * w;
      wsum += w;
    }
    pts[i]!.y = s / wsum;
  }
  let gain = 0;
  for (let i = 1; i < pts.length; i++) gain += Math.max(0, pts[i]!.y - pts[i - 1]!.y);
  // Repérage de la plus forte montée pour le KOM et d'une section plate pour le sprint.
  let bestStart = 0;
  let bestGain = -1;
  const climbLen = 900;
  const stepPts = climbLen / 2;
  for (let i = 0; i < pts.length; i += 10) {
    const j = (i + stepPts) % pts.length;
    const g = pts[j]!.y - pts[i]!.y;
    if (g > bestGain) {
      bestGain = g;
      bestStart = i;
    }
  }
  const komStart = pts[bestStart]!.d;
  const sprintStart = (komStart + total * 0.5) % total;
  return {
    id: 'dev-loop',
    name: 'Boucle de développement',
    nameEn: 'Development loop',
    loop: true,
    lengthM: total,
    elevationGainM: gain,
    points: pts,
    segments: [
      { id: 'kom-dev', kind: 'kom', name: 'Côte de la Vallée', startM: komStart, endM: komStart + climbLen, avgGrade: (bestGain / climbLen) * 100 },
      { id: 'sprint-dev', kind: 'sprint', name: 'Sprint du Village', startM: sprintStart, endM: sprintStart + 400, avgGrade: 0 },
    ],
    roadWidthM: 6,
    attribution: ['Monde procédural de développement'],
  };
}

/** Index spatial des points de route pour la distance à la route. */
class RouteIndex {
  private cells = new Map<string, number[]>();
  private readonly pts: RoutePoint[];
  private readonly cell: number;
  constructor(pts: RoutePoint[], cell = 25) {
    this.pts = pts;
    this.cell = cell;
    pts.forEach((p, i) => {
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
      let arr = this.cells.get(k);
      if (!arr) this.cells.set(k, (arr = []));
      arr.push(i);
    });
  }
  nearest(x: number, z: number, maxR = 75): { dist: number; y: number } {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const r = Math.ceil(maxR / this.cell);
    let best = Infinity;
    let y = 0;
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++) {
        const arr = this.cells.get(`${cx + i},${cz + j}`);
        if (!arr) continue;
        for (const idx of arr) {
          const p = this.pts[idx] as RoutePoint;
          const dd = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (dd < best) {
            best = dd;
            y = p.y;
          }
        }
      }
    return { dist: Math.sqrt(best), y };
  }
}

export function createProceduralWorld(): WorldSource {
  const route = buildLoop();
  const index = new RouteIndex(route.points);
  const half = 3;
  const villages = [route.points[Math.floor(route.points.length * 0.12)]!, route.points[Math.floor(route.points.length * 0.55)]!, route.points[Math.floor(route.points.length * 0.8)]!];

  const heightAt = (x: number, z: number): number => {
    const h = baseHeight(x, z);
    const { dist, y } = index.nearest(x, z);
    if (dist > 70) return h;
    // Route creusée dans le relief : plate sur la chaussée, talus doux au-delà.
    const t = Math.min(Math.max((dist - 5) / 55, 0), 1);
    const s = t * t * (3 - 2 * t);
    return y - 0.08 + (h - y) * s;
  };

  return {
    id: 'dev',
    name: 'Vallée procédurale',
    tileSize: TILE,
    bounds: { minX: -half * TILE, minZ: -half * TILE, maxX: half * TILE, maxZ: half * TILE },
    routes: [route],
    attribution: route.attribution,
    hasTile: (tx, tz) => Math.abs(tx) <= half && Math.abs(tz) <= half,
    async loadTile(tx, tz) {
      if (Math.abs(tx) > half || Math.abs(tz) > half) return null;
      const x0 = tx * TILE;
      const z0 = tz * TILE;
      const heights = new Float32Array((N + 1) * (N + 1));
      for (let j = 0; j <= N; j++)
        for (let i = 0; i <= N; i++) heights[j * (N + 1) + i] = heightAt(x0 + (i / N) * TILE, z0 + (j / N) * TILE);

      // Occupation du sol : forêts sur les pentes de la vallée, champs sur le plateau.
      const splat = new Uint8Array(SPLAT_RES * SPLAT_RES * SPLAT_CHANNELS.length);
      for (let j = 0; j < SPLAT_RES; j++)
        for (let i = 0; i < SPLAT_RES; i++) {
          const x = x0 + ((i + 0.5) / SPLAT_RES) * TILE;
          const z = z0 + ((j + 0.5) / SPLAT_RES) * TILE;
          const o = (j * SPLAT_RES + i) * SPLAT_CHANNELS.length;
          const { dist } = index.nearest(x, z, 30);
          const h = baseHeight(x, z);
          const forestN = fbm(x / 700, z / 700, 4) + (h < 125 ? 0.35 : -0.15);
          const villageNear = villages.some((v) => Math.hypot(v.x - x, v.z - z) < 260);
          if (dist < 3.6) splat[o + 5] = 255;
          else if (villageNear) splat[o + 4] = 200;
          else if (forestN > 0.08) splat[o] = 255;
          else if (valueNoise(x / 300, z / 300) > 0.1) splat[o + 1] = 255;
          else splat[o + 2] = 255;
        }

      const features: TileFeatures = { roads: [], buildings: [], forests: [], water: [], fields: [], waterways: [] };
      const r = rng(1000 + tx * 31 + tz * 977);
      for (const v of villages) {
        if (v.x < x0 || v.x >= x0 + TILE || v.z < z0 || v.z >= z0 + TILE) continue;
        for (let k = 0; k < 40; k++) {
          const a = r() * Math.PI * 2;
          const dd = 30 + r() * 210;
          const cx = v.x + Math.cos(a) * dd;
          const cz = v.z + Math.sin(a) * dd;
          if (index.nearest(cx, cz, 30).dist < 14) continue;
          const w = 8 + r() * 6;
          const l = 10 + r() * 9;
          const rot = r() * Math.PI;
          const c = Math.cos(rot);
          const s = Math.sin(rot);
          const corners = [
            [-w / 2, -l / 2],
            [w / 2, -l / 2],
            [w / 2, l / 2],
            [-w / 2, l / 2],
          ].flatMap(([u, vv]) => [cx + (u as number) * c - (vv as number) * s, cz + (u as number) * s + (vv as number) * c]);
          features.buildings.push({ pts: corners, height: 5 + r() * 4, kind: k === 0 ? 'church' : 'house', roof: 'hipped' });
        }
      }
      return { id: `${tx}_${tz}`, tx, tz, x0, z0, size: TILE, n: N, heights, features, splat: { res: SPLAT_RES, data: splat } };
    },
  };
}
