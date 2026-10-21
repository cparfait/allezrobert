/**
 * Lecture des traces GPX Garmin (données personnelles : jamais copiées dans les sorties).
 */
import fs from 'node:fs';
import path from 'node:path';
import { wgs84ToWorld } from './frame.ts';

export interface GpxPoint {
  lat: number;
  lon: number;
  ele: number;
  t: number; // ms epoch (NaN si absent)
  x: number;
  z: number;
}

export interface Ride {
  file: string;
  name: string;
  points: GpxPoint[];
}

export function parseGpx(xml: string, file = ''): Ride {
  const name = /<trk>\s*<name>([^<]*)<\/name>/.exec(xml)?.[1] ?? path.basename(file);
  const points: GpxPoint[] = [];
  const re = /<trkpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"\s*>([\s\S]*?)<\/trkpt>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const lat = parseFloat(m[1]!);
    const lon = parseFloat(m[2]!);
    const body = m[3] ?? '';
    const ele = parseFloat(/<ele>([^<]+)<\/ele>/.exec(body)?.[1] ?? 'NaN');
    const t = Date.parse(/<time>([^<]+)<\/time>/.exec(body)?.[1] ?? '');
    const p = wgs84ToWorld(lon, lat);
    points.push({ lat, lon, ele, t, x: p.x, z: p.z });
  }
  // attributs dans l'ordre inverse (lon puis lat)
  if (points.length === 0) {
    const re2 = /<trkpt\s+lon="([-\d.]+)"\s+lat="([-\d.]+)"\s*>([\s\S]*?)<\/trkpt>/g;
    while ((m = re2.exec(xml))) {
      const lon = parseFloat(m[1]!);
      const lat = parseFloat(m[2]!);
      const body = m[3] ?? '';
      const ele = parseFloat(/<ele>([^<]+)<\/ele>/.exec(body)?.[1] ?? 'NaN');
      const t = Date.parse(/<time>([^<]+)<\/time>/.exec(body)?.[1] ?? '');
      const p = wgs84ToWorld(lon, lat);
      points.push({ lat, lon, ele, t, x: p.x, z: p.z });
    }
  }
  return { file, name, points };
}

export function loadRides(dir: string): Ride[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.gpx'))
    .sort()
    .map((f) => parseGpx(fs.readFileSync(path.join(dir, f), 'utf8'), f))
    .filter((r) => r.points.length > 10);
}

/** Points sensibles (départ et arrivée de chaque sortie) en coordonnées monde. */
export function sensitivePoints(rides: Ride[]): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (const r of rides) {
    const a = r.points[0]!;
    const b = r.points[r.points.length - 1]!;
    out.push({ x: a.x, z: a.z }, { x: b.x, z: b.z });
  }
  return out;
}

/** Longueur cumulée d'une trace (m). */
export function rideCumulative(points: GpxPoint[]): number[] {
  const d = [0];
  for (let i = 1; i < points.length; i++) d.push(d[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z));
  return d;
}

/**
 * Ne conserve que la partie « publique » d'une sortie : sans les 2 premiers et 2 derniers
 * kilomètres, ni aucun point à moins de `radius` d'un point sensible.
 */
export function trimPrivate(points: GpxPoint[], sensitive: Array<{ x: number; z: number }>, radius: number, trimM = 2000): GpxPoint[] {
  const cum = rideCumulative(points);
  const total = cum[cum.length - 1] ?? 0;
  return points.filter((p, i) => {
    const d = cum[i] ?? 0;
    if (d < trimM || d > total - trimM) return false;
    return sensitive.every((s) => Math.hypot(p.x - s.x, p.z - s.z) >= radius);
  });
}
