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
const FEMININE: FaceShape = {
  browRidge: -0.5, browHeight: 0.2, jawWidth: -0.45, jawAngle: -0.35, chinWidth: -0.35, chinProtrusion: -0.15, noseLength: -0.25, noseWidth: -0.2, noseBridge: -0.15,
  lipFullness: 0.5, eyeSize: 0.3, eyelidFold: 0.1, cheekbones: 0.25, cheekVolume: 0.1, foreheadSlope: 0.1, headWidth: -0.1, neckWidth: -0.5, earSize: -0.25,
};

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
    id: 'chloe', name: 'Chloé', ageYears: 26,
    desc: { fr: '26 ans, brune, cheveux longs', en: '26, dark-haired, long hair' },
    shape: { sex: -1, originEuropean: 0.7, weight: -0.3, eyeSize: 0.15, lipFullness: 0.2, chinWidth: -0.15 },
    look: { skin: '#ecc2a2', hair: '#2b1a10', hairStyle: 9, beard: 0, freckles: 0, jersey: '#2a9d8f', jerseyAccent: '#e9c46a' },
  }),
  P({
    id: 'mathieu', name: 'Mathieu', ageYears: 38,
    desc: { fr: '38 ans, brun, moustache', en: '38, dark-haired, moustache' },
    shape: { originEuropean: 0.7, muscle: 0.3, jawWidth: 0.2, noseLength: 0.2, browRidge: 0.2 },
    look: { skin: '#e2b08c', hair: '#3b2414', hairStyle: 0, moustache: true, beard: 0, freckles: 0, jersey: '#1d3557', jerseyAccent: '#a8dadc' },
  }),
  P({
    id: 'clement', name: 'Clément', ageYears: 31,
    desc: { fr: '31 ans, brun, cheveux longs et barbe', en: '31, dark-haired, long hair and beard' },
    shape: { originEuropean: 0.6, weight: -0.3, cheekVolume: -0.3, jawAngle: 0.2, noseBridge: 0.2 },
    look: { skin: '#e6b896', hair: '#4a2c17', hairStyle: 9, beard: 0.9, freckles: 0, jersey: '#ffd23f', jerseyAccent: '#111111' },
  }),
  P({
    id: 'roger', name: 'Roger', ageYears: 63,
    desc: { fr: '63 ans, costaud, cheveux gris courts', en: '63, sturdy, short grey hair' },
    shape: { originEuropean: 0.8, weight: 0.3, muscle: 0.2, jawWidth: 0.3, browRidge: 0.3, earSize: 0.3 },
    look: { skin: '#dcae8c', hair: '#9a9a94', hairStyle: 0, beard: 0.3, freckles: 0, jersey: '#f4a261', jerseyAccent: '#264653' },
  }),
  P({
    id: 'christine', name: 'Christine', ageYears: 47,
    desc: { fr: '47 ans, rousse, taches de rousseur', en: '47, red-haired, freckles' },
    shape: { sex: -1, originEuropean: 0.8, weight: -0.1, cheekbones: 0.2, noseWidth: -0.2 },
    look: { skin: '#f3d0b5', hair: '#a5431c', hairStyle: 6, beard: 0, freckles: 0.6, jersey: '#7b2cbf', jerseyAccent: '#ffd23f' },
  }),
  P({
    id: 'laetitia', name: 'Laetitia', ageYears: 34,
    desc: { fr: '34 ans, châtain, queue de cheval', en: '34, light-brown hair, ponytail' },
    shape: { sex: -1, originEuropean: 0.7, muscle: 0.5, weight: 0.1, cheekbones: 0.3, jawWidth: 0.1 },
    look: { skin: '#e8bf9c', hair: '#6b4226', hairStyle: 1, beard: 0, freckles: 0, jersey: '#e63946', jerseyAccent: '#1d3557' },
  }),
  P({
    id: 'cheick', name: 'Cheick', ageYears: 29,
    desc: { fr: '29 ans, rouleur athlétique, rasé de près', en: '29, athletic rouleur, clean-shaven' },
    shape: { originAfrican: 0.9, muscle: 0.6, noseWidth: 0.5, lipFullness: 0.5, jawWidth: 0.3, nostrilFlare: 0.3 },
    look: { skin: '#4a2e1f', hair: '#101010', hairStyle: 4, beard: 0, freckles: 0, jersey: '#06d6a0', jerseyAccent: '#073b4c' },
  }),
  P({
    id: 'nathalie', name: 'Nathalie', ageYears: 42,
    desc: { fr: '42 ans, fine et nerveuse, carré', en: '42, slim and punchy, bob' },
    shape: { sex: -1, originAsian: 0.9, weight: -0.3, eyelidFold: 1, noseBridge: -0.4, eyeTilt: 1, eyeSize: -0.35, eyeHeight: -0.1, faceFat: -0.2 },
    look: { skin: '#e8c4a0', hair: '#141414', hairStyle: 6, beard: 0, freckles: 0, jersey: '#ffffff', jerseyAccent: '#e63946' },
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
  } else if ([1, 2, 10, 11].includes(look.hairStyle)) out.hairStyle = 0;
  return out;
}
