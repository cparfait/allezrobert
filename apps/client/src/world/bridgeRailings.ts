import * as THREE from 'three/webgpu';
import type { TileRoad } from './types.ts';

/**
 * Garde-corps des ponts (styles réaliste et V3 ; le style low poly a ses parapets, voir roadsideLife.ts) : main
 * courante, lisse intermédiaire et potelets en métal le long de chaque bord des tronçons « pont » de la tuile, à la
 * hauteur du tablier (pts3, corrigé par le chantier des ponts). Un seul maillage par tuile (un appel de dessin).
 * Demande du 18/11/2026 : à Boulogne, les ponts sur la Seine n'avaient aucun bord.
 */
const OFFSET_M = 0.35;
const TOP_M = 1.05;
const MID_M = 0.55;
const RAIL_W = 0.07;
const POST_W = 0.07;
const POST_EVERY_M = 2.5;
const MIN_BRIDGE_M = 6;

export function createRailingMaterial(): THREE.MeshStandardNodeMaterial {
  return new THREE.MeshStandardNodeMaterial({ color: '#676d72', metalness: 0.55, roughness: 0.45 });
}

class Boxes {
  readonly pos: number[] = [];
  readonly idx: number[] = [];

  /** Pavé de `a` à `b` (centres de la face basse), largeur `w` le long de `side`, hauteur `h`. */
  add(ax: number, ay: number, az: number, bx: number, by: number, bz: number, sx: number, sz: number, w: number, h: number): void {
    const base = this.pos.length / 3;
    const hw = w / 2;
    for (const [px, py, pz] of [[ax, ay, az], [bx, by, bz]] as const) {
      for (const [k, dy] of [[-1, 0], [1, 0], [1, h], [-1, h]] as const) this.pos.push(px + sx * hw * k, py + dy, pz + sz * hw * k);
    }
    // 0-3 : section en a ; 4-7 : section en b (bas gauche, bas droit, haut droit, haut gauche).
    const quads = [
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7],
      [0, 3, 2, 1],
      [4, 5, 6, 7],
    ];
    for (const [q0, q1, q2, q3] of quads) this.idx.push(base + q0!, base + q1!, base + q2!, base + q0!, base + q2!, base + q3!);
  }
}

/** Polyligne décalée de `off` (m) à gauche (sd = -1) ou à droite (sd = 1), normales horizontales lissées. */
function offsetLine(p: number[], off: number, sd: number): number[] {
  const n = p.length / 3;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    const dx = (p[i1 * 3] as number) - (p[i0 * 3] as number);
    const dz = (p[i1 * 3 + 2] as number) - (p[i0 * 3 + 2] as number);
    const l = Math.hypot(dx, dz) || 1;
    // Normale à droite du sens de la polyligne : (-dz, dx).
    out.push((p[i * 3] as number) + (-dz / l) * off * sd, p[i * 3 + 1] as number, (p[i * 3 + 2] as number) + (dx / l) * off * sd);
  }
  return out;
}

function length2D(p: number[]): number {
  let L = 0;
  for (let i = 3; i < p.length; i += 3) L += Math.hypot((p[i] as number) - (p[i - 3] as number), (p[i + 2] as number) - (p[i - 1] as number));
  return L;
}

/** Garde-corps de tous les tronçons « pont » d'une tuile (copies d'un même tronçon par itinéraire : une fois). */
export function buildBridgeRailings(roads: readonly TileRoad[]): THREE.BufferGeometry | null {
  const boxes = new Boxes();
  const seen = new Set<string>();
  for (const r of roads) {
    if (!r.bridge || r.tunnel || !r.pts3 || r.pts3.length < 6) continue;
    const id = r.id ?? '';
    const key = `${id.slice(id.lastIndexOf(':') + 1)}|${r.pts3[0]}|${r.pts3[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (length2D(r.pts3) < MIN_BRIDGE_M) continue;
    const half = Math.max(r.width, 2.5) / 2;
    for (const sd of [-1, 1]) {
      const line = offsetLine(r.pts3, half + OFFSET_M, sd);
      let sincePost = POST_EVERY_M;
      for (let i = 3; i < line.length; i += 3) {
        const ax = line[i - 3] as number, ay = line[i - 2] as number, az = line[i - 1] as number;
        const bx = line[i] as number, by = line[i + 1] as number, bz = line[i + 2] as number;
        const segL = Math.hypot(bx - ax, bz - az);
        if (segL < 1e-3) continue;
        // Côté du pavé : perpendiculaire horizontale au segment.
        const sx = -(bz - az) / segL;
        const sz = (bx - ax) / segL;
        boxes.add(ax, ay + TOP_M, az, bx, by + TOP_M, bz, sx, sz, RAIL_W, RAIL_W);
        boxes.add(ax, ay + MID_M, az, bx, by + MID_M, bz, sx, sz, RAIL_W * 0.7, RAIL_W * 0.7);
        // Potelets tous les POST_EVERY_M le long du segment.
        let t = POST_EVERY_M - sincePost;
        while (t <= segL) {
          const k = t / segL;
          const px = ax + (bx - ax) * k, py = ay + (by - ay) * k, pz = az + (bz - az) * k;
          const ux = ((bx - ax) / segL) * (POST_W / 2), uz = ((bz - az) / segL) * (POST_W / 2);
          boxes.add(px - ux, py, pz - uz, px + ux, py, pz + uz, sx, sz, POST_W, TOP_M);
          t += POST_EVERY_M;
        }
        sincePost = (sincePost + segL) % POST_EVERY_M;
      }
    }
  }
  if (!boxes.idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(boxes.pos, 3));
  g.setIndex(boxes.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(boxes.idx, 1) : new THREE.Uint16BufferAttribute(boxes.idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
