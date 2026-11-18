import type { Node } from 'three/webgpu';
import { hash, mix, step, vec3 } from 'three/tsl';

/** Ambre, blanc chaud et blanc froid, selon une graine entière propre à la baie. */
export function windowLamp(seed: Node<'float'>): Node<'vec3'> {
  const t = hash(seed);
  const warm = mix(vec3(1.0, 0.46, 0.17), vec3(1.0, 0.77, 0.46), t.mul(1.75).min(1));
  const cool = mix(vec3(0.46, 0.65, 1.0), vec3(0.76, 0.86, 1.0), t.sub(0.66).mul(3).max(0));
  return mix(warm, cool, step(0.66, t));
}
