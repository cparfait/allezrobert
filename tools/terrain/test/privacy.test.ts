/**
 * Garde-fou vie privée : aucune sortie publique (itinéraires, tuiles, emprise du monde) à moins
 * de 2 km d'un départ ou d'une arrivée de sortie Garmin. Ignoré si data/garmin ou le monde
 * construit sont absents (dépôt public cloné sans données personnelles).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GARMIN_DIR, OUT_DIR, PRIVACY_RADIUS_M } from '../src/config.ts';
import { distPointRect, tileRect } from '../src/frame.ts';
import { loadRides, sensitivePoints } from '../src/gpx.ts';
import { auditWorldDir, minDistanceToPoints } from '../src/privacy.ts';

const hasGarmin = fs.existsSync(GARMIN_DIR) && fs.readdirSync(GARMIN_DIR).some((f) => f.endsWith('.gpx'));
const hasWorld = fs.existsSync(path.join(OUT_DIR, 'world.json'));

describe.skipIf(!hasGarmin || !hasWorld)('vie privée des sorties', () => {
  const rides = hasGarmin ? loadRides(GARMIN_DIR) : [];
  const sensitive = sensitivePoints(rides);

  it('a bien des points sensibles à contrôler', () => {
    expect(sensitive.length).toBeGreaterThan(0);
  });

  it("aucun point d'itinéraire à moins de 2 km d'un départ/arrivée", () => {
    const dir = path.join(OUT_DIR, 'routes');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { points: Array<{ x: number; z: number }> };
      let worst = Infinity;
      for (const p of r.points) worst = Math.min(worst, minDistanceToPoints(p.x, p.z, sensitive));
      expect(worst).toBeGreaterThanOrEqual(PRIVACY_RADIUS_M);
    }
  });

  it('aucune tuile ni emprise du monde à moins de 2 km', () => {
    const w = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'world.json'), 'utf8')) as {
      bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
      tiles: Array<{ tx: number; tz: number }>;
    };
    for (const s of sensitive) {
      expect(distPointRect(s.x, s.z, w.bounds)).toBeGreaterThanOrEqual(PRIVACY_RADIUS_M);
      for (const t of w.tiles) expect(distPointRect(s.x, s.z, tileRect(t.tx, t.tz))).toBeGreaterThanOrEqual(PRIVACY_RADIUS_M);
    }
  });

  it('aucune entité de tuile à moins de 2 km', () => {
    const dir = path.join(OUT_DIR, 'tiles');
    if (!fs.existsSync(dir)) return;
    let worst = Infinity;
    let checked = 0;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'pack.json')) {
      const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { roads: Array<{ pts: number[] }>; buildings: Array<{ pts: number[] }> };
      for (const r of t.roads)
        for (let i = 0; i < r.pts.length; i += 3) {
          worst = Math.min(worst, minDistanceToPoints(r.pts[i]!, r.pts[i + 2]!, sensitive));
          checked++;
        }
      for (const b of t.buildings)
        for (let i = 0; i < b.pts.length; i += 2) {
          worst = Math.min(worst, minDistanceToPoints(b.pts[i]!, b.pts[i + 1]!, sensitive));
          checked++;
        }
    }
    if (checked) expect(worst).toBeGreaterThanOrEqual(PRIVACY_RADIUS_M);
  });

  it('audit global du dossier du monde', () => {
    expect(auditWorldDir(OUT_DIR, sensitive, PRIVACY_RADIUS_M)).toEqual([]);
  });

  it('aucun fichier versionné ne contient de coordonnées GPS brutes', () => {
    const versioned = [path.join(OUT_DIR, 'world.json'), ...fs.readdirSync(path.join(OUT_DIR, 'routes')).map((f) => path.join(OUT_DIR, 'routes', f))];
    const needles = new Set<string>();
    for (const r of rides) for (let i = 0; i < r.points.length; i += 50) needles.add(r.points[i]!.lat.toFixed(5));
    for (const f of versioned) {
      const s = fs.readFileSync(f, 'utf8');
      for (const n of needles) expect(s.includes(n)).toBe(false);
    }
  });
});
