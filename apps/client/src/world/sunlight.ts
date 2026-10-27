import * as THREE from 'three/webgpu';
import { cameraPosition, dot, max, output, positionWorld, pow, smoothstep, uniform, vec4 } from 'three/tsl';
import { colorUniform, type Vec3Node } from '../engine/tsl.ts';

/** Soleil du moment pour les effets de matériau (mis à jour par Environment). */
export const sunlight = {
  /** Direction vers le soleil (unitaire). */
  dir: uniform(new THREE.Vector3(0, 1, 0)),
  color: colorUniform('#fff4e0'),
  /** Force du contre-jour : 0 la nuit et sous un ciel couvert. */
  backlight: uniform(0),
};

/** ?backlit=0 : sans contre-jour du feuillage (comparaison). */
const BACKLIT = typeof location === 'undefined' || new URLSearchParams(location.search).get('backlit') !== '0';

/**
 * Sortie d'un feuillage avec la lumière qui le traverse en contre-jour : quand on regarde vers le soleil à
 * travers un houppier, les feuilles s'illuminent de leur propre teinte (heure dorée). Ajoutée après la
 * brume, donc limitée aux arbres proches (< 400 m) où elle reste faible ; pas en émissif, sinon le bloom
 * ferait briller tout le feuillage. `leaf` : 1 sur les feuilles, 0 sur le bois.
 */
export function backlitOutput(albedo: Vec3Node, leaf: THREE.Node<'float'>): THREE.Node | null {
  if (!BACKLIT) return null;
  const toFrag = positionWorld.sub(cameraPosition);
  const dist = toFrag.length();
  const toward = pow(max(dot(toFrag.div(dist), sunlight.dir), 0), 6);
  const near = smoothstep(400, 60, dist);
  const glow = albedo.mul(sunlight.color.node).mul(toward.mul(near).mul(leaf).mul(sunlight.backlight));
  return vec4(output.rgb.add(glow), output.a) as unknown as THREE.Node;
}
