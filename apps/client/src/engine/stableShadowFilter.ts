import { Fn, add, reference, renderGroup, texture, vec2 } from 'three/tsl';
import type * as THREE from 'three/webgpu';

/**
 * Filtre d'ombre lisse, pour les préréglages sans TAA (low, medium).
 *
 * Le PCF de three.js (r186) fait tourner ses 5 échantillons d'un angle tiré par pixel (bruit IGN) : un grain prévu
 * pour être lissé par le TAA. Sans TAA, ce grain reste à l'écran sous forme de trame dans toute la pénombre, et
 * comme le motif est fixe à l'écran pendant que l'ombre défile dessous (caméra de poursuite), le bord des ombres
 * près du coureur grésille (constat du 19/11/2026, Bêta, Boulogne).
 * Les mêmes 5 échantillons à angle fixe ne vont pas non plus : avec une carte nette (4096), chacun dessine une
 * copie décalée de l'ombre, qui paraît dédoublée en peigne.
 * Ici, PCF « tente » : 4 lectures matérielles bilinéaires (chacune compare 2 × 2 texels) placées à ±½ texel, qui
 * se recouvrent exactement ; leur moyenne est un filtre en tente sur 3 × 3 texels, continu quand l'ombre se
 * déplace, sans grain ni copie. 4 lectures au lieu de 5.
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
  // Demi-texel (× rayon d'ombre, 1 par défaut).
  const h = vec2(0.5).div(mapSize).mul(radius);
  const tap = (sx: number, sy: number) => depthCompare(shadowCoord.xy.add(h.mul(vec2(sx, sy))));
  return add(tap(-1, -1), tap(1, -1), tap(-1, 1), tap(1, 1)).mul(0.25);
});
