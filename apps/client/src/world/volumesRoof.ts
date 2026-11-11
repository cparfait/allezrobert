/**
 * Volumes v3 (correction visuelle `kind: "volumes"`, ZONES-BAT-3c et 4b) : chaque sous-emprise devient un
 * prisme avec son toit. Deux pans : gableRoof() de la v2 sur la sous-emprise ; monopente : plan mesuré sur la
 * sous-emprise élargie du débord ; plat : dalle à `topM` (flatRoof, emprises concaves comprises). Seule la
 * triangulation vient de Three.js (ShapeUtils). Les murs de chaque volume montent jusqu'à son toit (`topAt`) ;
 * entre deux volumes de hauteurs différentes, le mur du plus haut dépasse du toit du plus bas, comme en vrai.
 * Un volume refusé par gableRoof() fait renoncer à toute la correction (`null`, toit historique).
 */
import * as THREE from 'three';
import type { GableVisualCorrection, VolumesVisualCorrection } from '@allezrobert/shared/building-visual';
import { gableRoof } from './gableRoof.ts';
import { flatRoof, type RoofMesh } from './roofs.ts';

export interface VolumeGeometry {
  /** Sous-emprise absolue, dans le repère de l'emprise du bâtiment (translatée avec lui). */
  pts: number[];
  roof: RoofMesh;
  /** Triangles de pignon au-dessus des murs droits (vides pour un toit plat). */
  gables: RoofMesh;
  /** Altitude absolue du toit au droit d'un point de la sous-emprise. */
  topAt: (x: number, z: number) => number;
  /** Égout le plus bas au droit des angles (absolu). */
  eaveMin: number;
  /** Point le plus haut du volume (faîtage ou dalle). */
  top: number;
  /** Direction du faîtage (unitaire), pour les murs gouttereaux ; absente pour un toit plat. */
  ridgeDir?: [number, number];
}

/** Réunit les toits (ou les pignons) de plusieurs volumes en un seul maillage de triangles. */
export function concatMeshes(list: readonly RoofMesh[]): RoofMesh {
  return { pos: list.flatMap((m) => m.pos), uv: list.flatMap((m) => m.uv) };
}

/** Monopente : sous-emprise élargie du débord (onglets), triangulée, hauteurs sur le plan mesuré. */
function shedRoof(pts: number[], at: (x: number, z: number) => number, down: readonly [number, number], overhang: number): RoofMesh {
  const n = pts.length / 2;
  let a = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += pts[i * 2]! * pts[j * 2 + 1]! - pts[j * 2]! * pts[i * 2 + 1]!; }
  const sgn = a > 0 ? 1 : -1;
  const lines = Array.from({ length: n }, (_, i) => {
    const j = (i + 1) % n;
    const ax = pts[i * 2]!, az = pts[i * 2 + 1]!, dx = pts[j * 2]! - ax, dz = pts[j * 2 + 1]! - az, l = Math.hypot(dx, dz);
    return [ax + (sgn * dz / l) * overhang, az + (-sgn * dx / l) * overhang, dx, dz];
  });
  const ring = lines.map((q, i) => {
    const p = lines[(i + n - 1) % n]!;
    const den = p[2]! * q[3]! - p[3]! * q[2]!;
    if (Math.abs(den) < 1e-9) return new THREE.Vector2(q[0]!, q[1]!);
    const t = ((q[0]! - p[0]!) * q[3]! - (q[1]! - p[1]!) * q[2]!) / den;
    return new THREE.Vector2(p[0]! + p[2]! * t, p[1]! + p[3]! * t);
  });
  const pos: number[] = [], uv: number[] = [];
  const cos = Math.cos(Math.atan(Math.abs(at(0, 0) - at(down[0], down[1]))));
  for (const tri of THREE.ShapeUtils.triangulateShape(ring, [])) {
    const [p, q, r] = tri.map((k) => ring[k!]!) as [THREE.Vector2, THREE.Vector2, THREE.Vector2];
    const ny = (q.y - p.y) * (r.x - p.x) - (q.x - p.x) * (r.y - p.y);
    for (const v of ny < 0 ? [p, r, q] : [p, q, r]) {
      pos.push(v.x, at(v.x, v.y), v.y);
      uv.push(v.x * down[1] - v.y * down[0], (v.x * down[0] + v.y * down[1]) / cos);
    }
  }
  return { pos, uv };
}

export function volumesGeometry(bldPts: readonly number[], c: VolumesVisualCorrection, overhang: number): VolumeGeometry[] | null {
  const ox = bldPts[0]!, oz = bldPts[1]!;
  const out: VolumeGeometry[] = [];
  for (const part of c.parts) {
    const pts = part.pts.map((v, i) => v + (i % 2 ? oz : ox));
    const r = part.roof;
    if (r.type === 'shed') {
      const tx = r.through[0] + ox, tz = r.through[1] + oz, tan = Math.tan((r.pitchDeg * Math.PI) / 180);
      const at = (x: number, z: number) => r.topM - tan * ((x - tx) * r.down[0] + (z - tz) * r.down[1]);
      let eaveMin = Infinity, top = -Infinity;
      for (let i = 0; i < pts.length; i += 2) { const y = at(pts[i]!, pts[i + 1]!); eaveMin = Math.min(eaveMin, y); top = Math.max(top, y); }
      out.push({ pts, roof: shedRoof(pts, at, r.down, overhang), gables: { pos: [], uv: [] }, topAt: at, eaveMin, top });
      continue;
    }
    if (r.type === 'flat') {
      const top = r.topM;
      out.push({ pts, roof: flatRoof(pts, top), gables: { pos: [], uv: [] }, topAt: () => top, eaveMin: top, top });
      continue;
    }
    // Faîtage du volume ramené au premier sommet de la sous-emprise (convention de gableRoof).
    const ridge: [number, number, number, number] = [r.ridge[0] + ox - pts[0]!, r.ridge[1] + oz - pts[1]!, r.ridge[2] + ox - pts[0]!, r.ridge[3] + oz - pts[1]!];
    const gable: GableVisualCorrection = {
      buildingId: c.buildingId, kind: 'gable', ridgeM: r.ridgeM, ridge, pitchLeftDeg: r.pitchLeftDeg, pitchRightDeg: r.pitchRightDeg,
      confidence: c.confidence, provenance: c.provenance,
    };
    const g = gableRoof(pts, gable, overhang);
    if (!g) return null;
    const l = Math.hypot(ridge[2] - ridge[0], ridge[3] - ridge[1]);
    out.push({ pts, roof: g.roof, gables: g.gables, topAt: g.at, eaveMin: g.eaveMin, top: g.ridgeM, ridgeDir: [(ridge[2] - ridge[0]) / l, (ridge[3] - ridge[1]) / l] });
  }
  return out;
}
