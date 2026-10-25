import { BASE_PROFILES, FACE_SLIDERS, decodeFace, encodeFace, lookSex, profileLook, type AvatarLook, type FaceSlider } from '@allezrobert/shared';

/** Logique de l'éditeur de visage (sans DOM) : opérations sur la tenue, testées seules. */

const shapeValue = (id: FaceSlider, v: number): number => (id === 'sex' ? -v : v);

/** Forme avec un curseur modifié (valeur du curseur affiché : morphologie féminine positive). */
export function withSlider(look: AvatarLook, id: FaceSlider, v: number): AvatarLook {
  const shape = decodeFace(look.face);
  shape[id] = shapeValue(id, v);
  return { ...look, face: encodeFace(shape) };
}

/** Tenue d'un profil de base, en gardant maillot, casque et vélo. */
export function withProfile(look: AvatarLook, id: string): AvatarLook {
  const p = BASE_PROFILES.find((b) => b.id === id);
  if (!p) return look;
  const { jersey, jerseyAccent, helmet, bike, bikeModel, build } = look;
  const next = profileLook(p, look);
  return withoutFacialHairIfFemale({ ...next, jersey, jerseyAccent, helmet, bike, build, ...(bikeModel ? { bikeModel } : {}) });
}

/** Pas de barbe ni de moustache pour une femme (génération automatique, photo, profil de base). */
export function withoutFacialHairIfFemale(look: AvatarLook): AvatarLook {
  if (lookSex(look) === 'male' || (!look.beard && !look.moustache)) return look;
  return { ...look, beard: 0, moustache: false };
}

/** Aléatoire contrôlé : visage (pas le corps ni l'origine) déplacé d'au plus ± 0,35 par curseur. */
export function withRandomFace(look: AvatarLook, random: () => number = Math.random): AvatarLook {
  const shape = decodeFace(look.face);
  for (const s of FACE_SLIDERS) {
    if (s.group === 'body') continue;
    shape[s.id] = Math.max(-0.9, Math.min(0.9, (shape[s.id] ?? 0) + (random() - 0.5) * 0.7));
  }
  return withoutFacialHairIfFemale({ ...look, face: encodeFace(shape) });
}

/**
 * Résultat de la ressemblance photo appliqué : curseurs du visage (ceux du corps sont gardés),
 * teint, cheveux et barbe (si la photo a permis de la mesurer).
 */
export function withLikeness(look: AvatarLook, l: { skin: string; hair: string; face?: Record<string, number>; beard?: number }): AvatarLook {
  const shape = decodeFace(look.face);
  for (const s of FACE_SLIDERS) {
    if (s.group !== 'body' && l.face && s.id in l.face) shape[s.id] = l.face[s.id] as number;
  }
  return withoutFacialHairIfFemale({ ...look, skin: l.skin, hair: l.hair, face: encodeFace(shape), ...(l.beard === undefined ? {} : { beard: l.beard }) });
}

/** Tête de base : curseurs, barbe, rousseur et moustache retirés. */
export function withBaseHead(look: AvatarLook): AvatarLook {
  const { face: _f, beard: _b, freckles: _r, moustache: _m, ...rest } = look;
  return rest;
}
