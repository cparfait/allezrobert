import * as THREE from 'three/webgpu';
import { uv, mix, smoothstep, step, fract, vec2, vec3, float, floor, hash, uniform, mx_noise_float, positionWorld, clamp, abs, max } from 'three/tsl';
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

    const wp = positionWorld.xz;
    const n = mx_noise_float(wp.mul(1.7)).mul(0.5).add(0.5);
    const n2 = mx_noise_float(wp.mul(0.08)).mul(0.5).add(0.5);
    // Enrobé vieilli : gris clair, délavé par plaques ; traces de roulement plus claires et lisses.
    const age = mx_noise_float(wp.mul(0.03).add(17)).mul(0.5).add(0.5);
    const asphalt = mix(vec3(0.235, 0.24, 0.255), vec3(0.31, 0.31, 0.3), age).mul(asphaltGrain()).mul(n2.mul(0.2).add(0.9));
    const wheelTrack = smoothstep(0.5, 0.0, abs(ax.sub(half * 0.5))).mul(0.06);

    // ── Usure ──
    // Rapiéçages : enrobé plus récent (plus sombre) en rectangles, sur une voie ou toute la largeur.
    const cell = floor(v.div(11));
    const hp = hash(cell);
    const vs = cell.mul(11).add(hash(cell.add(1)).mul(4));
    const ve = vs.add(hash(cell.add(2)).mul(7).add(2.5));
    const full = step(0.8, hash(cell.add(4)));
    const right = step(0.5, hash(cell.add(3)));
    const u0 = mix(mix(float(-half + 0.15), float(0.1), right), float(-half + 0.1), full);
    const u1 = mix(mix(float(-0.1), float(half - 0.15), right), float(half - 0.1), full);
    const inPatch = step(0.68, hp).mul(step(vs, v)).mul(step(v, ve)).mul(step(u0, across)).mul(step(across, u1));
    const patchCol = vec3(0.17, 0.175, 0.18).mul(asphaltGrain());
    // Joints colmatés au bitume : joint longitudinal d'axe (ondulant, interrompu) et quelques
    // fissures transversales, fins et sombres, plus brillants que l'enrobé.
    const wob = mx_noise_float(vec2(v.mul(0.06), 2)).mul(0.18);
    const seam = smoothstep(0.035, 0.012, abs(across.add(wob))).mul(step(0.55, mx_noise_float(vec2(v.mul(0.04), 11)).mul(0.5).add(0.5)));
    const tcell = floor(v.div(23));
    const tpos = tcell.mul(23).add(hash(tcell.add(7)).mul(18));
    const transverse = smoothstep(0.03, 0.01, abs(v.sub(tpos).add(mx_noise_float(vec2(across.mul(0.8), tcell)).mul(0.35)))).mul(step(0.6, hash(tcell.add(9))));
    const tar = max(seam, transverse).mul(0.85);
    // Faïençage discret près des rives : réseau fin, faible contraste, par plaques.
    const crackA = smoothstep(0.02, 0.0, abs(mx_noise_float(wp.mul(2.2))));
    const crackB = smoothstep(0.018, 0.0, abs(mx_noise_float(wp.mul(4.7).add(9))));
    const crackZone = smoothstep(half - 1.0, half - 0.35, ax).mul(smoothstep(0.55, 0.75, age));
    const cracks = max(crackA, crackB).mul(crackZone).mul(0.6);

    // ── Rive déchiquetée et bas-côté ──
    // Le bord de l'enrobé ondule et s'effrite ; au-delà, une bande de terre et de gravillons
    // d'épaisseur variable, puis le ruban s'arrête (alpha) : le terrain et l'herbe prennent le relais.
    const e1 = mx_noise_float(vec2(v.mul(0.31), 3.1)).mul(0.5).add(0.5);
    const e2 = mx_noise_float(vec2(v.mul(2.3), 7.3)).mul(0.5).add(0.5);
    const edge = float(half).add(e1.mul(0.2)).add(e2.mul(0.08)).sub(0.16);
    const onRoad = smoothstep(edge.add(0.03), edge.sub(0.03), ax);
    const ravel = smoothstep(edge.sub(0.45), edge, ax).mul(step(0.45, n));
    const vergeOuter = edge.add(0.08).add(e2.mul(0.18)).add(e1.mul(0.25));
    const dirt = mix(vec3(0.22, 0.19, 0.14), vec3(0.32, 0.29, 0.23), n).mul(n2.mul(0.2).add(0.85));
    const verge = mix(dirt, vec3(0.16, 0.2, 0.09), smoothstep(edge.add(0.05), vergeOuter, ax).mul(0.8));

    const mk = route.markings ?? 'full';
    const edgeLine = smoothstep(half - 0.35, half - 0.3, ax).mul(smoothstep(half - 0.1, half - 0.15, ax)).mul(mk === 'full' ? 1 : 0);
    const dash = step(fract(v.div(13)), float(3 / 13));
    const centerLine = smoothstep(0.08, 0.06, ax).mul(dash).mul(mk === 'none' ? 0 : 1);
    // Peinture usée : écaillée par plaques, effacée dans les traces de roues.
    const paint = max(edgeLine, centerLine).mul(n2.mul(0.25).add(0.75)).mul(smoothstep(0.25, 0.55, mx_noise_float(wp.mul(0.9)).mul(0.5).add(0.5)).mul(0.6).add(0.4));

    let road = asphalt.add(wheelTrack);
    road = mix(road, road.mul(vec3(1.25, 1.22, 1.15)), ravel.mul(0.6));
    road = mix(road, patchCol, inPatch);
    road = mix(road, road.mul(0.6), cracks);
    road = mix(road, vec3(0.1, 0.1, 0.105), tar);
    let col = mix(verge, road, onRoad);
    col = mix(col, vec3(0.9, 0.9, 0.86), paint.mul(onRoad));
    const wet = this.wetness;
    col = col.mul(float(1).sub(wet.mul(0.4).mul(onRoad)));
    m.colorNode = col;
    const rough = mix(float(0.84).sub(wheelTrack), float(0.45), tar);
    m.roughnessNode = clamp(mix(float(0.97), rough, onRoad).sub(wet.mul(0.6).mul(onRoad)), 0.06, 1);
    m.metalnessNode = float(0);
    m.opacityNode = step(ax, vergeOuter);
    m.alphaTest = 0.5;
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
  const { pts: points, normals } = roundCorners(route, loop);
  const n = points.length;
  const cols = 4; // gravier gauche | chaussée gauche | chaussée droite | gravier droit
  const offsets = [-(width / 2 + SHOULDER), -width / 2, width / 2, width / 2 + SHOULDER];
  const lift = [0.02, 0.06, 0.06, 0.02];
  // Bords sans repli : dans les virages plus serrés que le décalage (demi-tours, angles de
  // carrefour, épingles), le bord intérieur se resserre en éventail au lieu de déborder en pointe.
  const edges = ribbonEdges(points, offsets, loop, normals);
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
  const index = ribbonIndex(pos, 3, cols, count, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

