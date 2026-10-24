/**
 * Profils de base des avatars (docs/AVATARS.md § 9) : point de départ de l'éditeur et visages des
 * coureurs IA. Chaque profil est un simple jeu de curseurs (face.ts) et de réglages de tenue ;
 * l'« air d'origine » est un mélange de trois poids, jamais une catégorie imposée.
 */
import { decodeFace, encodeFace, type FaceShape } from './face.ts';
import { DEFAULT_LOOK, type AvatarLook } from './net.ts';

export interface BaseProfile {
  id: string;
  name: string;
  ageYears: number;
  desc: { fr: string; en: string };
  shape: FaceShape;
  look: Partial<AvatarLook>;
}

/** Âge en années → curseur `age` (base 25 ans ; −1 ≈ 19 ans, +1 ≈ 77 ans). */
export function ageSlider(years: number): number {
  return years >= 25 ? Math.min(1, (years - 25) / 52) : Math.max(-1, (years - 25) / 6);
}

/**
 * Traits féminins ajoutés quand `sex` < 0 (le curseur `sex` change surtout la silhouette) :
 * arcades, mâchoire, menton et cou plus fins, lèvres et yeux un peu plus marqués. Les valeurs du
 * profil s'y ajoutent.
 */
const FEMININE: FaceShape = { browRidge: -0.45, jawWidth: -0.4, jawAngle: -0.3, chinWidth: -0.3, noseLength: -0.2, noseWidth: -0.15, lipFullness: 0.3, eyeSize: 0.2, cheekbones: 0.2, neckWidth: -0.45, earSize: -0.2 };

const P = (p: Omit<BaseProfile, 'shape'> & { shape: Omit<FaceShape, 'age'> }): BaseProfile => {
  const shape: FaceShape = { age: ageSlider(p.ageYears) };
  const add = (s: FaceShape, k: number): void => {
    for (const [n, v] of Object.entries(s) as Array<[keyof FaceShape, number]>) shape[n] = Math.max(-1, Math.min(1, (shape[n] ?? 0) + v * k));
  };
  if ((p.shape.sex ?? 0) < 0) add(FEMININE, -(p.shape.sex ?? 0));
  add(p.shape, 1);
  return { ...p, shape };
};

export const BASE_PROFILES: readonly BaseProfile[] = [
  P({
    id: 'robert', name: 'Robert', ageYears: 72,
    desc: { fr: '72 ans, sec et endurant, moustache grise', en: '72, wiry and enduring, grey moustache' },
    shape: { originEuropean: 0.8, weight: -0.4, muscle: 0.1, cheekVolume: -0.35, noseLength: 0.35, earSize: 0.35, browHeight: -0.2, jawAngle: 0.2 },
    look: { skin: '#e3b796', hair: '#c9c9c4', hairStyle: 0, moustache: true, beard: 0.2, freckles: 0, jersey: '#d62828', jerseyAccent: '#f6f6f6' },
  }),
  P({
    id: 'lea', name: 'Léa', ageYears: 27,
    desc: { fr: '27 ans, grimpeuse fine, taches de rousseur', en: '27, slender climber, freckles' },
    shape: { sex: -1, originEuropean: 0.8, weight: -0.5, noseWidth: -0.3, eyeSize: 0.2, lipFullness: 0.15, chinWidth: -0.2 },
    look: { skin: '#f2cdb2', hair: '#8a4320', hairStyle: 1, freckles: 0.85, beard: 0, jersey: '#2a9d8f', jerseyAccent: '#e9c46a' },
  }),
  P({
    id: 'moussa', name: 'Moussa', ageYears: 34,
    desc: { fr: '34 ans, rouleur athlétique, barbe courte', en: '34, athletic rouleur, short beard' },
    shape: { originAfrican: 0.9, muscle: 0.6, noseWidth: 0.5, lipFullness: 0.5, jawWidth: 0.3, nostrilFlare: 0.3 },
    look: { skin: '#5b3a28', hair: '#121212', hairStyle: 0, beard: 0.9, freckles: 0, jersey: '#f4a261', jerseyAccent: '#264653' },
  }),
  P({
    id: 'aiko', name: 'Aiko', ageYears: 41,
    desc: { fr: '41 ans, fine et nerveuse, cheveux courts', en: '41, slim and punchy, short hair' },
    shape: { sex: -1, originAsian: 0.9, weight: -0.4, eyelidFold: 0.6, noseBridge: -0.4, eyeTilt: 0.3, faceFat: -0.2 },
    look: { skin: '#e6c09a', hair: '#141414', hairStyle: 0, beard: 0, freckles: 0, jersey: '#ffffff', jerseyAccent: '#e63946' },
  }),
  P({
    id: 'karim', name: 'Karim', ageYears: 46,
    desc: { fr: '46 ans, costaud, mâchoire carrée, barbe naissante', en: '46, sturdy, square jaw, stubble' },
    shape: { originEuropean: 0.5, originAfrican: 0.25, weight: 0.4, muscle: 0.4, jawWidth: 0.6, jawAngle: 0.6, noseBridge: 0.5, browRidge: 0.3 },
    look: { skin: '#b9845c', hair: '#1d1410', hairStyle: 0, beard: 0.5, freckles: 0, jersey: '#1d3557', jerseyAccent: '#a8dadc' },
  }),
  P({
    id: 'ines', name: 'Inès', ageYears: 55,
    desc: { fr: '55 ans, cheveux courts gris', en: '55, short grey hair' },
    shape: { sex: -1, originAfrican: 0.5, originEuropean: 0.3, weight: 0.1, lipFullness: 0.4, noseWidth: 0.3, cheekbones: 0.3 },
    look: { skin: '#8d5b3d', hair: '#bdbdb8', hairStyle: 0, beard: 0, freckles: 0, jersey: '#7b2cbf', jerseyAccent: '#ffd23f' },
  }),
  P({
    id: 'tom', name: 'Tom', ageYears: 21,
    desc: { fr: '21 ans, très fin, joues creuses, imberbe', en: '21, very lean, hollow cheeks, clean-shaven' },
    shape: { originEuropean: 0.7, weight: -0.8, cheekVolume: -0.8, faceFat: -0.5, chinHeight: 0.2, neckWidth: -0.3 },
    look: { skin: '#f0c7a6', hair: '#c9a25b', hairStyle: 0, beard: 0, freckles: 0.15, jersey: '#ffd23f', jerseyAccent: '#111111' },
  }),
  P({
    id: 'marta', name: 'Marta', ageYears: 36,
    desc: { fr: '36 ans, sprinteuse puissante, tresse sous le casque', en: '36, powerful sprinter, braid under the helmet' },
    shape: { sex: -1, originEuropean: 0.4, originAfrican: 0.15, originAsian: 0.2, muscle: 0.7, weight: 0.1, cheekbones: 0.4, jawWidth: 0.2, noseWidth: 0.2 },
    look: { skin: '#c48c64', hair: '#2a1a10', hairStyle: 2, beard: 0, freckles: 0, jersey: '#e63946', jerseyAccent: '#1d3557' },
  }),
];

/** Tenue complète d'un profil (couleurs non précisées : celles de `base`). */
export function profileLook(p: BaseProfile, base: AvatarLook = DEFAULT_LOOK): AvatarLook {
  return { ...base, ...p.look, face: encodeFace(p.shape) };
}

/** Homme ou femme d'après la tenue (curseur `sex` du visage). */
export function lookSex(look: AvatarLook): 'male' | 'female' {
  return (decodeFace(look.face).sex ?? 0) < -0.5 ? 'female' : 'male';
}

/**
 * Passe l'avatar en homme ou en femme : curseur `sex` et traits féminins (retirés ou ajoutés sans
 * toucher aux autres réglages du visage), barbe et moustache, coiffure par défaut.
 */
export function withSex(look: AvatarLook, sex: 'male' | 'female'): AvatarLook {
  if (lookSex(look) === sex) return look;
  const shape = decodeFace(look.face);
  const delta = (sex === 'female' ? 1 : 0) - Math.max(0, -(shape.sex ?? 0));
  for (const [n, v] of Object.entries(FEMININE) as Array<[keyof FaceShape, number]>) shape[n] = Math.max(-1, Math.min(1, (shape[n] ?? 0) + v * delta));
  shape.sex = sex === 'female' ? -1 : 0;
  const out: AvatarLook = { ...look, face: encodeFace(shape) };
  if (sex === 'female') {
    out.beard = 0;
    out.moustache = false;
    if (look.hairStyle === 0) out.hairStyle = 1;
  } else if (look.hairStyle === 1 || look.hairStyle === 2) out.hairStyle = 0;
  return out;
}
