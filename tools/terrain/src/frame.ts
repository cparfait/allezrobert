/**
 * Repère monde : x = E(L93) − originX, z = −(N(L93) − originY), y = altitude (m).
 * Convention Three.js : y vers le haut, x vers l'est, z vers le sud.
 */
import { ORIGIN_L93, TILE_SIZE_M } from './config.ts';
import { fromL93, toL93 } from './lambert93.ts';

export interface XZ {
  x: number;
  z: number;
}

export function l93ToWorld(e: number, n: number): XZ {
  return { x: e - ORIGIN_L93.x, z: -(n - ORIGIN_L93.y) };
}

export function worldToL93(x: number, z: number): { e: number; n: number } {
  return { e: x + ORIGIN_L93.x, n: ORIGIN_L93.y - z };
}

export function wgs84ToWorld(lon: number, lat: number): XZ {
  const p = toL93(lon, lat);
  return l93ToWorld(p.x, p.y);
}

export function worldToWgs84(x: number, z: number): { lon: number; lat: number } {
  const p = worldToL93(x, z);
  return fromL93(p.e, p.n);
}

export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function tileRect(tx: number, tz: number): Rect {
  return { minX: tx * TILE_SIZE_M, minZ: tz * TILE_SIZE_M, maxX: (tx + 1) * TILE_SIZE_M, maxZ: (tz + 1) * TILE_SIZE_M };
}

export function tileId(tx: number, tz: number): string {
  return `${tx}_${tz}`;
}

/** Emprise WGS84 (avec marge en degrés) d'un rectangle monde. */
export function rectToWgs84(r: Rect, marginDeg = 0): { west: number; south: number; east: number; north: number } {
  const corners = [
    worldToWgs84(r.minX, r.minZ),
    worldToWgs84(r.maxX, r.minZ),
    worldToWgs84(r.minX, r.maxZ),
    worldToWgs84(r.maxX, r.maxZ),
  ];
  return {
    west: Math.min(...corners.map((c) => c.lon)) - marginDeg,
    east: Math.max(...corners.map((c) => c.lon)) + marginDeg,
    south: Math.min(...corners.map((c) => c.lat)) - marginDeg,
    north: Math.max(...corners.map((c) => c.lat)) + marginDeg,
  };
}

/** Rectangle monde englobant une emprise WGS84. */
export function wgs84BoxToRect(b: { west: number; south: number; east: number; north: number }): Rect {
  const pts = [
    wgs84ToWorld(b.west, b.south),
    wgs84ToWorld(b.east, b.south),
    wgs84ToWorld(b.west, b.north),
    wgs84ToWorld(b.east, b.north),
  ];
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minZ: Math.min(...pts.map((p) => p.z)),
    maxZ: Math.max(...pts.map((p) => p.z)),
  };
}

/** Distance d'un point à un rectangle (0 si dedans). */
export function distPointRect(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}
