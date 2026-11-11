/**
 * Volumes v3 (correction visuelle `kind: "volumes"`, ZONES-BAT-3c) : chaque sous-emprise devient un prisme
 * avec son toit, sans Three.js. Deux pans : gableRoof() de la v2 sur la sous-emprise ; plat : dalle à `topM`
 * (flatRoof, emprises concaves comprises). Les murs de chaque volume montent jusqu'à son toit (`topAt`) ;
 * entre deux volumes de hauteurs différentes, le mur du plus haut dépasse du toit du plus bas, comme en vrai.
 * Un volume refusé par gableRoof() fait renoncer à toute la correction (`null`, toit historique).
 */
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

export function volumesGeometry(bldPts: readonly number[], c: VolumesVisualCorrection, overhang: number): VolumeGeometry[] | null {
  const ox = bldPts[0]!, oz = bldPts[1]!;
  const out: VolumeGeometry[] = [];
  for (const part of c.parts) {
    const pts = part.pts.map((v, i) => v + (i % 2 ? oz : ox));
    const r = part.roof;
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
