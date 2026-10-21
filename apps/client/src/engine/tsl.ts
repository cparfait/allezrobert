import * as THREE from 'three/webgpu';
import { uniform, vec3, vec4 } from 'three/tsl';

/** Types de nœuds TSL usuels (le typage distingue « color » et « vec3 », pas le GPU). */
export type Vec3Node = ReturnType<typeof vec3>;
export type Vec4Node = ReturnType<typeof vec4>;

export interface ColorUniform {
  node: Vec3Node;
  set(c: THREE.ColorRepresentation): void;
  value: THREE.Color;
}

/** Uniforme de couleur utilisable directement dans les expressions vec3. */
export function colorUniform(c: THREE.ColorRepresentation = 0xffffff): ColorUniform {
  const u = uniform(new THREE.Color(c));
  const value = u.value as THREE.Color;
  return { node: u as unknown as Vec3Node, set: (x) => void value.set(x), value };
}
