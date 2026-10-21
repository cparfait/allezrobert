/**
 * Garde-fous vie privée : aucune sortie (itinéraire, tuile, entité) à moins de 2 km d'un
 * départ ou d'une arrivée de sortie Garmin. Les points sensibles ne sont jamais écrits.
 */
import fs from 'node:fs';
import path from 'node:path';
import { distPointRect, tileRect, type Rect } from './frame.ts';

export interface PrivacyViolation {
  what: string;
  distanceM: number;
}

export function minDistanceToPoints(x: number, z: number, pts: Array<{ x: number; z: number }>): number {
  let d = Infinity;
  for (const p of pts) d = Math.min(d, Math.hypot(x - p.x, z - p.z));
  return d;
}

/** Vérifie que le corridor entier reste à distance des points sensibles (pas de « trou » révélateur). */
export function assertCorridorSafe(r: Rect, sensitive: Array<{ x: number; z: number }>, radius: number): void {
  for (const p of sensitive) {
    const d = distPointRect(p.x, p.z, r);
    if (d < radius) throw new Error(`Vie privée : un départ/arrivée Garmin est à ${Math.round(d)} m du corridor (minimum ${radius} m). Réduisez CORRIDOR_TILES.`);
  }
}

/** Contrôle a posteriori de tout le dossier de sortie du monde. */
export function auditWorldDir(dir: string, sensitive: Array<{ x: number; z: number }>, radius: number): PrivacyViolation[] {
  const out: PrivacyViolation[] = [];
  const check = (what: string, x: number, z: number) => {
    const d = minDistanceToPoints(x, z, sensitive);
    if (d < radius) out.push({ what, distanceM: Math.round(d) });
  };
  const routesDir = path.join(dir, 'routes');
  if (fs.existsSync(routesDir)) {
    for (const f of fs.readdirSync(routesDir).filter((f) => f.endsWith('.json'))) {
      const r = JSON.parse(fs.readFileSync(path.join(routesDir, f), 'utf8')) as { points: Array<{ x: number; z: number }> };
      let worst = Infinity;
      for (const p of r.points) worst = Math.min(worst, minDistanceToPoints(p.x, p.z, sensitive));
      if (worst < radius) out.push({ what: `routes/${f}`, distanceM: Math.round(worst) });
    }
  }
  const worldFile = path.join(dir, 'world.json');
  if (fs.existsSync(worldFile)) {
    const w = JSON.parse(fs.readFileSync(worldFile, 'utf8')) as { tiles: Array<{ id: string; tx: number; tz: number }>; bounds: Rect };
    for (const t of w.tiles) {
      const r = tileRect(t.tx, t.tz);
      for (const p of sensitive) {
        const d = distPointRect(p.x, p.z, r);
        if (d < radius) out.push({ what: `tuile ${t.id}`, distanceM: Math.round(d) });
      }
    }
    for (const p of sensitive) {
      const d = distPointRect(p.x, p.z, w.bounds);
      if (d < radius) out.push({ what: 'emprise du monde', distanceM: Math.round(d) });
    }
  }
  return out;
}
