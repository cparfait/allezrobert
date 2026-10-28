import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { splitWheelIslands } from '../src/world/traffic.ts';

/**
 * Le tracteur (un seul maillage « body », roues comprises) : ses roues doivent être retrouvées et extraites
 * pour pouvoir tourner. Lecture minimale du .glb réel (EXT_meshopt_compression, KHR_mesh_quantization).
 */
interface Gltf {
  nodes: Array<{ mesh?: number; translation?: number[]; scale?: number[] }>;
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; indices: number }> }>;
  accessors: Array<{ bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }>;
  bufferViews: Array<{ buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; extensions?: { EXT_meshopt_compression?: { buffer: number; byteOffset?: number; byteLength: number; byteStride: number; count: number; mode: string; filter?: string } } }>;
}

async function loadTractor(): Promise<THREE.Object3D> {
  const file = readFileSync(resolve(import.meta.dirname, '../public/models/vehicles/tractor.glb'));
  const jsonLen = file.readUInt32LE(12);
  const gltf = JSON.parse(file.subarray(20, 20 + jsonLen).toString()) as Gltf;
  const binStart = 20 + jsonLen + 8;
  const bin = new Uint8Array(file.buffer, file.byteOffset + binStart, file.byteLength - binStart);
  await MeshoptDecoder.ready;
  const views = gltf.bufferViews.map((v) => {
    const ext = v.extensions?.EXT_meshopt_compression;
    if (!ext) return { data: bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength), stride: v.byteStride };
    const out = new Uint8Array(ext.count * ext.byteStride);
    const src = bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
    MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, ext.filter ?? 'NONE');
    return { data: out, stride: ext.byteStride };
  });
  const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const accessor = (i: number): THREE.BufferAttribute => {
    const a = gltf.accessors[i] as Gltf['accessors'][number];
    const view = views[a.bufferView] as { data: Uint8Array; stride?: number };
    const n = SIZE[a.type] as number;
    const Ctor = ({ 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array } as const)[a.componentType as 5126];
    const elem = Ctor.BYTES_PER_ELEMENT;
    const stride = view.stride ?? n * elem;
    const out = new Ctor(a.count * n);
    const dv = new DataView(view.data.buffer, view.data.byteOffset + (a.byteOffset ?? 0));
    const read = { 1: (o: number) => dv.getInt8(o), 2: (o: number) => (a.componentType === 5122 ? dv.getInt16(o, true) : dv.getUint16(o, true)), 4: (o: number) => (a.componentType === 5126 ? dv.getFloat32(o, true) : dv.getUint32(o, true)) }[elem as 1 | 2 | 4];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = read(k * stride + c * elem);
    return new THREE.BufferAttribute(out, n, !!a.normalized);
  };
  const root = new THREE.Group();
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    const group = new THREE.Group();
    group.name = 'body';
    for (const p of (gltf.meshes[node.mesh] as Gltf['meshes'][number]).primitives) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', accessor(p.attributes.POSITION as number));
      g.setIndex(accessor(p.indices));
      group.add(new THREE.Mesh(g));
    }
    if (node.translation) group.position.fromArray(node.translation);
    if (node.scale) group.scale.fromArray(node.scale);
    root.add(group);
  }
  return root;
}

describe('roues du tracteur', () => {
  it('retrouve les quatre roues dans le maillage d\'un seul tenant, centrées sur leur axe', async () => {
    const root = await loadTractor();
    const n = splitWheelIslands(root);
    expect(n).toBe(4);
    const wheels: THREE.Object3D[] = [];
    root.traverse((o) => o.name.startsWith('wheel_') && wheels.push(o));
    root.updateMatrixWorld(true);
    const radii = wheels.map((w) => {
      const size = new THREE.Box3().setFromObject(w).getSize(new THREE.Vector3());
      // Ronde de profil : hauteur ≈ longueur ; pivot au centre de la roue.
      expect(Math.abs(size.y - size.z)).toBeLessThan(0.2 * size.y);
      const box = (w as THREE.Mesh).geometry.boundingBox as THREE.Box3;
      const c = box.getCenter(new THREE.Vector3());
      expect(Math.hypot(c.y, c.z)).toBeLessThan(0.05 * size.y / (w.parent?.scale.x ?? 1) + 0.02);
      return size.y / 2;
    });
    // Deux petites roues avant, deux grandes à l'arrière.
    radii.sort((a, b) => a - b);
    expect(radii[3]! / radii[0]!).toBeGreaterThan(1.3);
  });
});
