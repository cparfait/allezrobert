import type * as THREE from 'three/webgpu';

/** Types minimaux de la copie d'EZ-Tree (voir README.md). */
export class Tree extends THREE.Group {
  options: {
    seed: number;
    leaves: { count: number; size: number; sizeVariance: number; tint: number; alphaTest: number };
    [k: string]: unknown;
  };
  branchesMesh: THREE.Mesh;
  leavesMesh: THREE.Mesh;
  loadPreset(name: string): void;
  generate(): void;
}
