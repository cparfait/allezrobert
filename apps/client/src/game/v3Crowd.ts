import type { AvatarLook } from '@allezrobert/shared';
import { V3_STYLE } from '../engine/style.ts';
import { GltfRiderAvatar, type RiderAvatarLike } from '../rider/gltfAvatar.ts';
import { V3Visual } from '../v3/visuals.ts';
import { CINEMATIC_V3 } from '../v3/cinematicRiders.ts';

/**
 * Style V3 (développement seulement) : coureurs IA et cyclistes croisés habillés comme le joueur, en vrais coureurs et
 * vélos V3. Ils reprennent les profils validés du film d'accueil (v3/cinematicRiders.ts : ni équipement, ni vélo, ni
 * roues marqués Zwift), choisis selon le sexe du coureur ; sans style V3, rien n'est créé.
 */
const MALE = CINEMATIC_V3.filter((e) => e.sex !== 'female');
const FEMALE = CINEMATIC_V3.filter((e) => e.sex === 'female');

export function crowdV3(avatar: RiderAvatarLike, look: AvatarLook, seed: number, female: boolean): V3Visual | undefined {
  if (!V3_STYLE || !(avatar instanceof GltfRiderAvatar)) return undefined;
  const list = female && FEMALE.length ? FEMALE : MALE.length ? MALE : CINEMATIC_V3;
  const equipment = list[((seed % list.length) + list.length) % list.length];
  if (!equipment) return undefined;
  const visual = new V3Visual(avatar.v3Mount(), () => {}, (error) => console.warn('[V3] coureur IA', error));
  visual.set(look, equipment);
  return visual;
}
