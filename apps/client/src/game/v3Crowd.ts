import { v3WithHeadgear, type GearKind } from './headgear.ts';
import type { AvatarLook } from '@allezrobert/shared';
import { V3_STYLE } from '../engine/style.ts';
import { GltfRiderAvatar, type RiderAvatarLike } from '../rider/gltfAvatar.ts';
import { V3Visual, type V3Equipment } from '../v3/visuals.ts';
import { CINEMATIC_V3 } from '../v3/cinematicRiders.ts';

/**
 * Style V3 (développement seulement) : coureurs IA et cyclistes croisés habillés comme le joueur, en vrais coureurs et
 * vélos V3. Ils reprennent les profils validés du film d'accueil (v3/cinematicRiders.ts : ni équipement, ni vélo, ni
 * roues portant un logo du catalogue), choisis selon le sexe du coureur ; sans style V3, rien n'est créé.
 */
const MALE = CINEMATIC_V3.filter((e) => e.sex !== 'female');
const FEMALE = CINEMATIC_V3.filter((e) => e.sex === 'female');

/** Maillot imposé à un coureur V3 (course : son équipe porte le même), pièce du catalogue et coupe des manches. */
export type V3TeamJersey = { piece: NonNullable<V3Equipment['kit']>[string]; zip?: number };

/** Maillots du Tour de France du catalogue V3 (jaune, vert, à pois, blanc) : réservés aux leaders du tour à étapes. */
const TDF_JERSEY_IDS = new Set([450, 451, 452, 453]);
/** Maillot V3 de leader du tour : jaune (général), vert (points), à pois (montagne). */
export const LEADER_V3_JERSEY = { gc: 453, points: 450, kom: 451 } as const;

/**
 * Maillot V3 d'une équipe adverse (course) : celui d'un coureur du film d'accueil, un par équipe, jamais celui du joueur.
 */
export function rivalV3Jersey(team: number, mineId?: number): V3TeamJersey | undefined {
  const pieces = [...new Map(CINEMATIC_V3.map((e) => e.kit?.CYCLING_JERSEY).filter((p): p is NonNullable<typeof p> => !!p && p.id !== mineId && !TDF_JERSEY_IDS.has(p.id)).map((p) => [p.id, p])).values()];
  const piece = pieces[((team % pieces.length) + pieces.length) % pieces.length];
  return piece ? { piece } : undefined;
}

export function crowdV3(avatar: RiderAvatarLike, look: AvatarLook, seed: number, female: boolean, jersey?: V3TeamJersey, gear?: { kind: GearKind; roll: number }): V3Visual | undefined {
  if (!V3_STYLE || !(avatar instanceof GltfRiderAvatar)) return undefined;
  const list = female && FEMALE.length ? FEMALE : MALE.length ? MALE : CINEMATIC_V3;
  const base = list[((seed % list.length) + list.length) % list.length];
  if (!base) return undefined;
  const dressed: V3Equipment = jersey ? { ...base, kit: { ...base.kit, CYCLING_JERSEY: jersey.piece }, ...(jersey.zip !== undefined ? { zip: jersey.zip } : {}) } : base;
  // Casque, casquette ou casque et vélo de chrono selon la sortie (game/headgear.ts).
  const equipment = gear ? v3WithHeadgear(dressed, gear.kind, gear.roll, { bikeIndex: seed }) : dressed;
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
