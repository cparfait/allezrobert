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
  const visual = new V3Visual(hiddenV3Mount(avatar), () => {}, (error) => console.warn('[V3] coureur IA', error));
  visual.set(look, equipment);
  return visual;
}

/**
 * Support V3 d'un avatar, coureur et vélo du jeu (mode Réel) masqués dès maintenant : sans cela, ils restaient
 * visibles jusqu'à la première mise à jour V3 (au départ, de loin, tant que le V3 se charge).
 */
export function hiddenV3Mount(avatar: GltfRiderAvatar): ReturnType<GltfRiderAvatar['v3Mount']> {
  const mount = avatar.v3Mount();
  mount.replace(true, true);
  return mount;
}

/**
 * Départ en Bêta : attend (au plus `timeoutMs`) que les coureurs V3 soient chargés, puis les affiche une fois, pour
 * que la compilation du départ (compileScene) prépare leurs matériaux. Sinon ils arrivaient après le départ et leur
 * première image compilait leurs shaders d'un coup : image figée de plusieurs secondes.
 */
export async function settleV3(visuals: ReadonlyArray<V3Visual | undefined>, timeoutMs = 20_000): Promise<void> {
  const list = visuals.filter((v): v is V3Visual => !!v);
  const until = performance.now() + timeoutMs;
  while (list.some((v) => !v.settled) && performance.now() < until) await new Promise((r) => setTimeout(r, 100));
  for (const v of list) if (v.settled) v.update(0, 0, 0, 'seated');
}
