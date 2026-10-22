import * as THREE from 'three/webgpu';
import { texture, positionWorld, dot, vec3 } from 'three/tsl';

/** Texture photo d'asphalte CC0 (Poly Haven `asphalt_02`, 3 m), partagée par toutes les routes. */
const map = new THREE.TextureLoader().load('/assets/textures/asphalt_02/diffuse.jpg');
map.wrapS = map.wrapT = THREE.RepeatWrapping;
map.colorSpace = THREE.SRGBColorSpace;
map.anisotropy = 8;

/** Grain de l'enrobé (≈ 1 en moyenne) projeté en coordonnées monde, à multiplier à la couleur. */
export function asphaltGrain(): ReturnType<typeof vec3> {
  const c = texture(map, positionWorld.xz.div(3)).rgb;
  // Luminance relative à la moyenne de la photo (≈ 0,2 en linéaire) : seul le grain est gardé.
  const l = dot(c, vec3(0.299, 0.587, 0.114)).div(0.2);
  return vec3(l, l, l).clamp(0.6, 1.5) as unknown as ReturnType<typeof vec3>;
}
