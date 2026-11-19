import { Fn, add, float, int, reference, renderGroup, texture, vec2, vogelDiskSample } from 'three/tsl';
import type * as THREE from 'three/webgpu';

/**
 * Filtre d'ombre sans grain, pour les préréglages sans TAA (low, medium).
 *
 * Le PCF de three.js (r186) fait tourner ses 5 échantillons d'un angle tiré par pixel (bruit IGN) : un grain prévu
 * pour être lissé par le TAA. Sans TAA, ce grain reste à l'écran sous forme de trame dans toute la pénombre, et
 * comme le motif est fixe à l'écran pendant que l'ombre défile dessous (caméra de poursuite), le bord des ombres
 * près du coureur grésille. En medium la pénombre est large (une seule cascade sur 250 m : texels de ~25 cm), donc
 * la trame couvre toute l'ombre portée (constat du 19/11/2026, Bêta, Boulogne, approche de l'arrivée).
 * Ici les 5 mêmes échantillons, même rayon, mais à angle fixe : chacun reste un PCF matériel bilinéaire, donc
 * l'ombre varie continûment quand elle se déplace, sans trame. Même coût (5 lectures).
 * `?shadowdither=1` : retour au filtre de three.js (comparaison).
 */
export const SHADOW_DITHER = typeof location !== 'undefined' && new URLSearchParams(location.search).get('shadowdither') === '1';

type FilterInputs = { depthTexture: THREE.DepthTexture; shadowCoord: THREE.Node<'vec3'>; shadow: THREE.LightShadow; depthLayer: THREE.Node<'int'> };
type Grouped<T extends string> = { setGroup(group: unknown): THREE.Node<T> };

export const stableShadowFilter = Fn(({ depthTexture, shadowCoord, shadow, depthLayer }: FilterInputs) => {
  const depthCompare = (uv: THREE.Node<'vec2'>) => {
    let depth = texture(depthTexture, uv);
    if ((depthTexture as unknown as { isArrayTexture?: boolean }).isArrayTexture) depth = depth.depth(depthLayer);
    return depth.compare(shadowCoord.z);
  };
  const mapSize = (reference('mapSize', 'vec2', shadow) as unknown as Grouped<'vec2'>).setGroup(renderGroup);
  const radius = (reference('radius', 'float', shadow) as unknown as Grouped<'float'>).setGroup(renderGroup);
  const radiusScaled = radius.mul(vec2(1).div(mapSize).x);
  const phi = float(0);
  const tap = (i: number) => depthCompare(shadowCoord.xy.add(vogelDiskSample(int(i), int(5), phi).mul(radiusScaled)));
  return add(tap(0), tap(1), tap(2), tap(3), tap(4)).mul(1 / 5);
});
