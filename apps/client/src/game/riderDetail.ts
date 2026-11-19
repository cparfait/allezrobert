import type * as THREE from 'three/webgpu';
import type { AvatarLook } from '@allezrobert/shared';
import { LowPolyRider } from '../rider/lowPolyRider.ts';
import type { LightColor } from './riderLight.ts';
import type { RiderAvatarLike } from '../rider/gltfAvatar.ts';
import type { V3Visual } from '../v3/visuals.ts';

/**
 * Rendu détaillé d'un coureur, celui que la version légère (riderLight.ts) remplace au loin : le groupe V3 en style
 * Bêta ; sinon la branche unique sous la racine (inclinaison du vélo, `lean`) des coureurs réalistes (gltfAvatar.ts)
 * et poly (lowPolyRider.ts). Optimisations Bêta du 17-18/11/2026 portées aux deux autres styles le 19/11/2026.
 */
export function detailGroup(avatar: RiderAvatarLike, v3?: V3Visual): THREE.Object3D | null {
  if (v3) return (v3 as unknown as { group: THREE.Object3D }).group;
  for (const c of avatar.root.children) if (c.name !== 'rider-light') return c;
  return null;
}

/**
 * Le coureur projette-t-il une ombre quand le budget d'ombres le lui permet ? Coureur réaliste : jamais
 * (RIDER_CAST_SHADOWS de gltfAvatar.ts) ; poly : oui. Sa version légère suit la même règle.
 */
export function castsShadow(avatar: RiderAvatarLike): boolean {
  return avatar instanceof LowPolyRider;
}

/** Teintes de remplacement (matériaux à base blanche teintés par nœuds) : peau et cadre d'après la tenue ; filets des jantes ignorés. */
const RIM = '#1e2024';
const hints = new WeakMap<RiderAvatarLike, LightColor>();

/**
 * Couleurs de la version légère d'un coureur réaliste ou poly : la peau (matériau SSS), le cadre (livrée) et les
 * chaussures sont teintés par nœuds sur une base blanche, la version légère les prendrait pour du blanc. V3 : rien.
 */
export function lightColorOf(avatar: RiderAvatarLike, v3?: V3Visual): LightColor | undefined {
  if (v3) return undefined;
  let hint = hints.get(avatar);
  if (!hint) {
    hint = (_mesh, material) => {
      // Réaliste : `look` ; poly : `lookKey` (tenue en JSON). Lu seulement à la construction de la version légère.
      const a = avatar as unknown as { look?: AvatarLook; lookKey?: string };
      const look = a.look ?? (a.lookKey ? (JSON.parse(a.lookKey) as AvatarLook) : undefined);
      switch (material.name) {
        case 'skin':
          return look?.skin;
        case 'frame':
          return look?.bike;
        case 'shoe':
          return look?.shoes;
        case 'rim_decal':
          return RIM;
        default:
          return null;
      }
    };
    hints.set(avatar, hint);
  }
  return hint;
}
