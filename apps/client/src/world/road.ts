import * as THREE from 'three/webgpu';
import { uv, mix, smoothstep, step, fract, vec3, float, uniform, mx_noise_float, positionWorld, clamp, abs, max } from 'three/tsl';
import type { RouteData, RoutePoint } from '@allezrobert/shared';

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
    const asphalt = vec3(0.235, 0.24, 0.255).mul(n.mul(0.18).add(0.86)).mul(n2.mul(0.2).add(0.9));
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

const SHOULDER = 1.2;

function buildRibbon(points: RoutePoint[], width: number, loop: boolean): THREE.BufferGeometry {
  const n = points.length;
  const cols = 4; // gravier gauche | chaussée gauche | chaussée droite | gravier droit
  const offsets = [-(width / 2 + SHOULDER), -width / 2, width / 2, width / 2 + SHOULDER];
  const lift = [0.02, 0.06, 0.06, 0.02];
  const count = loop ? n + 1 : n;
  const pos = new Float32Array(count * cols * 3);
  const uvs = new Float32Array(count * cols * 2);
  const total = width + 2 * SHOULDER;
  for (let k = 0; k < count; k++) {
    const i = k % n;
    const p = points[i] as RoutePoint;
    const prev = points[(i - 1 + n) % n] as RoutePoint;
    const next = points[(i + 1) % n] as RoutePoint;
    let dx = next.x - prev.x;
    let dz = next.z - prev.z;
    if (!loop && i === 0) {
      dx = next.x - p.x;
      dz = next.z - p.z;
    }
    if (!loop && i === n - 1) {
      dx = p.x - prev.x;
      dz = p.z - prev.z;
    }
    const len = Math.hypot(dx, dz) || 1;
    // Normale droite (−dirZ, dirX), cohérente avec RouteTrack.positionAt.
    const rx = -dz / len;
    const rz = dx / len;
    const d = k === n ? (points[n - 1] as RoutePoint).d + Math.hypot(p.x - (points[n - 1] as RoutePoint).x, p.z - (points[n - 1] as RoutePoint).z) : p.d;
    for (let c = 0; c < cols; c++) {
      const o = (k * cols + c) * 3;
      const off = offsets[c] as number;
      pos[o] = p.x + rx * off;
      pos[o + 1] = p.y + (lift[c] as number);
      pos[o + 2] = p.z + rz * off;
      uvs[(k * cols + c) * 2] = (off + total / 2) / total;
      uvs[(k * cols + c) * 2 + 1] = d;
    }
  }
  const index: number[] = [];
  for (let k = 0; k < count - 1; k++)
    for (let c = 0; c < cols - 1; c++) {
      const a = k * cols + c;
      const b = a + 1;
      const a2 = a + cols;
      const b2 = b + cols;
      index.push(a, b, a2, b, b2, a2);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
