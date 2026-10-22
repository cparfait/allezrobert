import * as THREE from 'three/webgpu';
import { uv, mix, smoothstep, step, fract, vec3, float, uniform, mx_noise_float, positionWorld, clamp, abs, max } from 'three/tsl';
import type { RouteData, RoutePoint } from '@allezrobert/shared';
import { asphaltGrain } from './asphalt.ts';
import { ribbonEdges, ribbonIndex, roundCorners } from './ribbon.ts';

/**
 * Ruban de chaussée de l'itinéraire, posé sur le terrain déjà creusé, avec marquages
 * à la française (lignes de rive continues, axe discontinu 3 m / 10 m), accotements
 * gravillonnés, et aspect mouillé piloté par la météo.
 */
export class RoadMesh {
  readonly mesh: THREE.Mesh;
  readonly wetness = uniform(0);

  constructor(route: RouteData) {
    const geo = buildRibbon(route.points, route.roadWidthM, route.loop);
    const m = new THREE.MeshStandardNodeMaterial();
    const u = uv().x; // 0 → 1 en travers (accotements compris)
    const v = uv().y; // mètres le long de la route
    const total = route.roadWidthM + 2 * SHOULDER;
    const across = u.mul(total).sub(total / 2); // mètres depuis l'axe
    const half = route.roadWidthM / 2;
    const ax = abs(across);

    const n = mx_noise_float(positionWorld.xz.mul(1.7)).mul(0.5).add(0.5);
    const n2 = mx_noise_float(positionWorld.xz.mul(0.08)).mul(0.5).add(0.5);
    const asphalt = vec3(0.235, 0.24, 0.255).mul(asphaltGrain()).mul(n2.mul(0.2).add(0.9));
    // Traces de roulement plus claires et plus lisses.
    const wheelTrack = smoothstep(0.5, 0.0, abs(ax.sub(half * 0.5))).mul(0.06);
    const gravel = vec3(0.42, 0.39, 0.33).mul(n.mul(0.35).add(0.7));

    const edgeLine = smoothstep(half - 0.35, half - 0.3, ax).mul(smoothstep(half - 0.1, half - 0.15, ax));
    const dash = step(fract(v.div(13)), float(3 / 13));
    const centerLine = smoothstep(0.08, 0.06, ax).mul(dash);
    const paint = max(edgeLine, centerLine).mul(n2.mul(0.25).add(0.75));

    const onRoad = smoothstep(half + 0.05, half - 0.05, ax);
    let col = mix(gravel, asphalt.add(wheelTrack), onRoad);
    col = mix(col, vec3(0.9, 0.9, 0.86), paint);
    const wet = this.wetness;
    col = col.mul(float(1).sub(wet.mul(0.4).mul(onRoad)));
    m.colorNode = col;
    m.roughnessNode = clamp(mix(float(0.95), float(0.78).sub(wheelTrack), onRoad).sub(wet.mul(0.6).mul(onRoad)), 0.06, 1);
    m.metalnessNode = float(0);
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    this.mesh = new THREE.Mesh(geo, m);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'road';
  }
}

/** Accotement gravillonné de part et d'autre de la chaussée (m). */
export const SHOULDER = 1.2;

function buildRibbon(route: RoutePoint[], width: number, loop: boolean): THREE.BufferGeometry {
  // Virages vifs démultipliés (bord extérieur arrondi), voir roundCorners.
  const { pts: points, normals } = TMP_NOFIX ? { pts: route, normals: new Float64Array(0) } : roundCorners(route, loop);
  const n = points.length;
  const cols = 4; // gravier gauche | chaussée gauche | chaussée droite | gravier droit
  const offsets = [-(width / 2 + SHOULDER), -width / 2, width / 2, width / 2 + SHOULDER];
  const lift = [0.02, 0.06, 0.06, 0.02];
  // Bords sans repli : dans les virages plus serrés que le décalage (demi-tours, angles de
  // carrefour, épingles), le bord intérieur se resserre en éventail au lieu de déborder en pointe.
  const edges = TMP_NOFIX ? tmpOld(route, offsets, loop) : ribbonEdges(points, offsets, loop, normals);
  const count = loop ? n + 1 : n;
  const pos = new Float32Array(count * cols * 3);
  const uvs = new Float32Array(count * cols * 2);
  const total = width + 2 * SHOULDER;
  const last = points[n - 1] as RoutePoint;
  for (let k = 0; k < count; k++) {
    const i = k % n;
    const p = points[i] as RoutePoint;
    const d = k === n ? last.d + Math.hypot(p.x - last.x, p.z - last.z) : p.d;
    for (let c = 0; c < cols; c++) {
      const o = (k * cols + c) * 3;
      const e = edges[c] as Float64Array;
      pos[o] = e[i * 2] as number;
      pos[o + 1] = p.y + (lift[c] as number);
      pos[o + 2] = e[i * 2 + 1] as number;
      uvs[(k * cols + c) * 2] = ((offsets[c] as number) + total / 2) / total;
      uvs[(k * cols + c) * 2 + 1] = d;
    }
  }
  // (quadrilatère encore vrillé, demi-tour de deux points dans le tracé : triangles retournés écartés)
  const index = TMP_NOFIX ? tmpIdx(cols, count) : ribbonIndex(pos, 3, cols, count, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// TMP_ROADFIX_BEGIN
export const TMP_NOFIX = typeof location !== 'undefined' && new URLSearchParams(location.search).has('noroadfix');
function tmpOld(pts: RoutePoint[], offsets: number[], loop: boolean): Float64Array[] {
  const n = pts.length;
  return offsets.map((off) => {
    const e = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const p = pts[i] as RoutePoint;
      const prev = pts[loop ? (i - 1 + n) % n : Math.max(i - 1, 0)] as RoutePoint;
      const next = pts[loop ? (i + 1) % n : Math.min(i + 1, n - 1)] as RoutePoint;
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const l = Math.hypot(dx, dz) || 1;
      e[i * 2] = p.x - (dz / l) * off;
      e[i * 2 + 1] = p.z + (dx / l) * off;
    }
    return e;
  });
}
function tmpIdx(cols: number, count: number): number[] {
  const index: number[] = [];
  for (let k = 0; k < count - 1; k++)
    for (let c = 0; c < cols - 1; c++) {
      const a = k * cols + c;
      index.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
    }
  return index;
}
// TMP_ROADFIX_END
