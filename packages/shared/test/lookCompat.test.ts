/**
 * Compatibilité des sauvegardes de coureurs (audit n° 3, étape E0.2).
 *
 * Un coureur enregistré (tenue `AvatarLook` : visage, tenue, coiffure, accessoires, vélo) doit se
 * recharger et se réenregistrer à l'identique. Exemples SYNTHÉTIQUES seulement
 * (test/fixtures/look-compat/looks.json) : aucune sauvegarde réelle n'est lue ni écrite.
 *
 * Garde-fou principal : le code `AvatarLook.face` est une suite d'octets dans l'ordre de FACE_SLIDERS,
 * de longueur calculée sur le nombre de curseurs et contrôlée aussi par le serveur (FACE_CODE_RE dans
 * apps/server/src/http/api.ts). Ajouter, retirer ou déplacer un curseur rendrait illisibles tous les
 * visages enregistrés : les nouveaux curseurs devront aller dans un code à part, versionné.
 *
 * Ce fichier protège le format ACTUEL ; il ne définit aucun format futur.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_PROFILES,
  BIKES,
  COSMETICS,
  DEFAULT_LOOK,
  FACE_CODE_LENGTH,
  FACE_CODE_RE,
  FACE_SLIDERS,
  HAIR_STYLE_COUNT,
  LEGACY_WHEELS,
  PLAIN_BIKE_FAMILY,
  bikeById,
  bikeOfLook,
  decodeFace,
  encodeFace,
  glassesLookOf,
  helmetLookOf,
  jerseyLookOf,
  lookSex,
  migrateBikeId,
  migrateCosmeticId,
  profileLook,
  tuneItem,
  withSex,
  type AvatarLook,
} from '../src/index.ts';
import catalog from '../src/bikes.json';
import corpus from './fixtures/look-compat/looks.json';

/** Ordre des curseurs au moment de l'audit (position = octet du code visage). Ne jamais réordonner. */
const FROZEN_SLIDER_ORDER = [
  'jawWidth', 'jawHeight', 'jawAngle', 'chinProtrusion', 'chinHeight', 'chinWidth', 'chinCleft', 'cheekbones', 'cheekVolume',
  'cheekHeight', 'faceFat', 'headWidth', 'headLength', 'headDepth', 'foreheadSlope', 'earSize', 'earAngle', 'neckWidth',
  'browRidge', 'browHeight', 'browAngle', 'eyeSize', 'eyeSpacing', 'eyeHeight', 'eyeTilt', 'eyelidFold', 'noseLength',
  'noseWidth', 'noseBridge', 'noseTip', 'nostrilFlare', 'lipFullness', 'mouthWidth', 'mouthCorners', 'sex', 'age', 'weight',
  'muscle', 'shoulders', 'originAfrican', 'originAsian', 'originEuropean',
] as const;

/** Valeurs de DEFAULT_LOOK au moment de l'audit (tenue d'un nouveau joueur et base de la lecture serveur). */
const FROZEN_DEFAULT_LOOK = {
  skin: '#e0b48f',
  hair: '#3b2a1e',
  hairStyle: 0,
  jersey: '#1f6feb',
  jerseyAccent: '#ffd23f',
  helmet: '#f4f4f4',
  bike: '#c0392b',
  build: 0.4,
  shoes: '#f2f2f2',
  socks: '#f2f2f2',
};

const FACES = corpus.faceCodes;
const LOOKS = corpus.looks as unknown as Record<string, AvatarLook>;

/** Enregistrement puis rechargement, comme localStorage, le fichier de profil du bureau ou la colonne JSONB du serveur. */
const resave = (look: AvatarLook): AvatarLook => JSON.parse(JSON.stringify(look)) as AvatarLook;

/** Règle de fusion du serveur à la lecture du profil (apps/server/src/db/repos.ts, getProfile : `{ ...DEFAULT_LOOK, ...row.avatar }`). */
const serverRead = (saved: AvatarLook): AvatarLook => ({ ...DEFAULT_LOOK, ...saved });

/** Tous les exemples : DEFAULT_LOOK, corpus synthétique et profils de base de l'éditeur. */
const ALL_LOOKS: Array<[string, AvatarLook]> = [
  ['DEFAULT_LOOK', DEFAULT_LOOK],
  ...Object.entries(LOOKS),
  ...BASE_PROFILES.map((p): [string, AvatarLook] => [`profil ${p.id}`, profileLook(p)]),
];

describe('format historique du code visage (ne doit pas changer silencieusement)', () => {
  it('42 curseurs, dans leur ordre exact (position = octet du code)', () => {
    expect(FACE_SLIDERS).toHaveLength(42);
    expect(
      FACE_SLIDERS.map((s) => s.id),
      'FACE_SLIDERS a changé : les codes visage enregistrés seraient mal lus. Mettre les nouveaux curseurs dans un code séparé et versionné.',
    ).toEqual(FROZEN_SLIDER_ORDER);
  });

  it('code de 56 caractères base64url (alphabet A-Z a-z 0-9 - _), comme le contrôle du serveur', () => {
    expect(FACE_CODE_LENGTH, 'longueur du code visage modifiée : tous les visages enregistrés deviendraient invalides').toBe(56);
    expect(FACE_CODE_RE.source).toBe('^[A-Za-z0-9_-]{56}$');
    for (const f of Object.values(FACES)) expect(f.code).toMatch(FACE_CODE_RE);
  });

  it('codes historiques : décodés aux valeurs écrites en clair (à 1/127 près)', () => {
    for (const f of [FACES.male, FACES.female]) {
      const shape = decodeFace(f.code);
      expect(Object.keys(shape).sort()).toEqual(Object.keys(f.values).sort());
      for (const [k, v] of Object.entries(f.values)) expect(shape[k as keyof typeof shape], k).toBeCloseTo(v, 2);
    }
  });

  it('valeurs extrêmes : −1 et +1 exacts à chaque position', () => {
    const ext = decodeFace(FACES.extremes.code);
    FROZEN_SLIDER_ORDER.forEach((id, i) => expect(ext[id], id).toBe(i % 2 ? 1 : -1));
    const all: Record<string, number> = {};
    FROZEN_SLIDER_ORDER.forEach((id, i) => (all[id] = i % 2 ? 1 : -1));
    expect(encodeFace(all)).toBe(FACES.extremes.code);
  });

  it('valeurs par défaut : tête de base ↔ code neutre (octets à 127), décodage vide', () => {
    expect(encodeFace({})).toBe(FACES.neutral.code);
    expect(decodeFace(FACES.neutral.code)).toEqual({});
  });

  it('réencodage : un code réenregistré reste identique au caractère près', () => {
    for (const f of Object.values(FACES)) expect(encodeFace(decodeFace(f.code))).toBe(f.code);
    for (const [name, look] of ALL_LOOKS) if (look.face) expect(encodeFace(decodeFace(look.face)), name).toBe(look.face);
  });

  it('encodage : bornes ramenées à ±1, valeurs non finies à 0 (comportement actuel)', () => {
    expect(decodeFace(encodeFace({ eyeSize: 7, noseTip: -3, cheekbones: Number.NaN, age: Number.POSITIVE_INFINITY }))).toEqual({ eyeSize: 1, noseTip: -1 });
  });

  it('codes invalides : forme de base, sans erreur (comportement actuel)', () => {
    expect(decodeFace(undefined)).toEqual({});
    expect(decodeFace('')).toEqual({});
    expect(decodeFace(FACES.male.code.slice(0, 55))).toEqual({});
    expect(decodeFace(`${FACES.male.code}A`)).toEqual({});
    expect(decodeFace(`${FACES.male.code.slice(0, 55)}!`)).toEqual({});
    expect(decodeFace(`${FACES.male.code.slice(0, 55)}=`)).toEqual({});
  });

  it('octet 255 (jamais produit par encodeFace) : lu comme +1 (comportement actuel)', () => {
    const shape = decodeFace('_'.repeat(56));
    for (const id of FROZEN_SLIDER_ORDER) expect(shape[id], id).toBe(1);
  });
});

describe('valeurs par défaut de AvatarLook', () => {
  it('DEFAULT_LOOK inchangé', () => {
    expect(DEFAULT_LOOK).toEqual(FROZEN_DEFAULT_LOOK);
  });

  it('lecture serveur d\'une tenue ancienne : les champs obligatoires absents prennent DEFAULT_LOOK, les facultatifs restent absents', () => {
    const { shoes: _s, socks: _k, ...partial } = LOOKS.legacyMinimal as AvatarLook;
    const read = serverRead(partial as AvatarLook);
    expect(read.shoes).toBe(DEFAULT_LOOK.shoes);
    expect(read.socks).toBe(DEFAULT_LOOK.socks);
    expect(read.face).toBeUndefined();
    expect(read.bikeModel).toBeUndefined();
    expect(read.heightCm).toBeUndefined();
  });
});

describe.each(ALL_LOOKS)('coureur enregistré « %s » : rechargement puis réenregistrement', (_name, look) => {
  const once = resave(look);
  const twice = resave(once);

  it('tenue complète conservée (visage, tenue, coiffure, accessoires, vélo, taille)', () => {
    expect(once).toEqual(look);
    expect(twice).toEqual(once);
  });

  it('aucun champ inventé ni perdu (les champs absents restent absents)', () => {
    expect(Object.keys(once).sort()).toEqual(Object.keys(look).filter((k) => look[k as keyof AvatarLook] !== undefined).sort());
  });

  it('visage, sexe et coiffure identiques après rechargement', () => {
    expect(decodeFace(once.face)).toEqual(decodeFace(look.face));
    expect(lookSex(once)).toBe(lookSex(look));
    expect(once.hairStyle).toBe(look.hairStyle);
    expect(Number.isInteger(look.hairStyle) && look.hairStyle >= 0 && look.hairStyle < HAIR_STYLE_COUNT, 'coiffure hors des 12 existantes').toBe(true);
  });

  it('même vélo assemblé (famille, options, livrée, pièces de l\'atelier)', () => {
    expect(bikeOfLook(once)).toEqual(bikeOfLook(look));
  });

  it('lecture par le serveur (fusion avec DEFAULT_LOOK) : chaque valeur enregistrée est gardée', () => {
    const read = serverRead(once);
    for (const [k, v] of Object.entries(once)) expect(read[k as keyof AvatarLook], k).toEqual(v);
  });

  it('repasser au même sexe ne change rien', () => {
    expect(withSex(once, lookSex(once))).toEqual(once);
  });
});

describe('corpus synthétique : couverture et identifiants réels du projet', () => {
  it('hommes et femmes, plusieurs coiffures, tailles et types de vélo', () => {
    const looks = Object.values(LOOKS);
    expect(new Set(looks.map(lookSex))).toEqual(new Set(['male', 'female']));
    expect(new Set(looks.map((l) => l.hairStyle)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(looks.map((l) => l.heightCm).filter(Boolean)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(looks.map((l) => l.bikeType ?? 'road'))).toEqual(new Set(['road', 'gravel', 'mtb']));
    expect(looks.some((l) => l.moustache) && looks.some((l) => (l.beard ?? 0) > 0)).toBe(true);
  });

  it('vélos et pièces de l\'atelier du corpus : connus du catalogue (sauf l\'exemple « vélo inconnu »)', () => {
    for (const [name, l] of Object.entries(LOOKS)) {
      if (l.bikeModel && name !== 'unknownBike') expect(bikeById(l.bikeModel), `${name} : ${l.bikeModel}`).toBeDefined();
      for (const id of l.tune ?? []) expect(tuneItem(id), id).toBeDefined();
    }
  });

  it('codes visage du corpus : tous valides', () => {
    for (const [name, l] of Object.entries(LOOKS)) if (l.face) expect(l.face, name).toMatch(FACE_CODE_RE);
  });
});

describe('vélo enregistré', () => {
  it('identifiants historiques du garage (legacy de bikes.json) : même modèle, migration idempotente', () => {
    const legacy = (catalog as { legacy: Record<string, string> }).legacy;
    expect(legacy).toEqual({
      'bike-alu': 'myth-cannondale-caad9',
      'bike-carbone': 's26-22-ef-supersix-evo',
      'bike-acier-vintage': 'myth-peugeot-px10',
      'bike-grimpeur': 's26-08-rbb-sworks-aethos',
    });
    for (const [old, id] of Object.entries(legacy)) {
      expect(bikeById(id), id).toBeDefined();
      expect(migrateBikeId(old)).toBe(id);
      expect(migrateBikeId(migrateBikeId(old))).toBe(id);
      expect(bikeById(old)?.id).toBe(id);
    }
    expect(bikeOfLook(LOOKS.legacyBikeId as AvatarLook)).toEqual(bikeOfLook({ ...(LOOKS.legacyBikeId as AvatarLook), bikeModel: 'myth-cannondale-caad9' }));
  });

  it('identifiants à jour : inchangés par la migration ; 111 modèles, identifiants uniques', () => {
    expect(BIKES).toHaveLength(111);
    expect(new Set(BIKES.map((b) => b.id)).size).toBe(111);
    for (const b of BIKES) expect(migrateBikeId(b.id)).toBe(b.id);
  });

  it('vélo inconnu : vélo de base peint de la couleur enregistrée, sans erreur', () => {
    const look = LOOKS.unknownBike as AvatarLook;
    const build = bikeOfLook(look);
    expect(build.family).toBe(PLAIN_BIKE_FAMILY);
    expect(build.livery.colors).toEqual([look.bike]);
  });

  it('sans modèle : vélo de base (famille climb) de la couleur `bike`', () => {
    expect(PLAIN_BIKE_FAMILY).toBe('climb');
    const build = bikeOfLook(LOOKS.legacyMinimal as AvatarLook);
    expect(build.family).toBe('climb');
    expect(build.livery.colors).toEqual(['#00a0e0']);
  });

  it('Specialized Roubaix Sport 2020 : au catalogue, famille climb (livrée seule, pas de géométrie propre)', () => {
    const b = bikeById('div-specialized-roubaix-sport-2020');
    expect(b?.family).toBe('climb');
    expect(b?.year).toBe(2020);
    expect(bikeOfLook(LOOKS.fullMale as AvatarLook).family).toBe('climb');
  });
});

describe('équipements enregistrés (garage)', () => {
  it('identifiants de cosmétiques à jour : inchangés par la migration ; vélos historiques migrés', () => {
    for (const c of COSMETICS) expect(migrateCosmeticId(c.slot, c.id), c.id).toBe(c.id);
    expect(migrateCosmeticId('bike', 'bike-alu')).toBe('myth-cannondale-caad9');
    expect(migrateCosmeticId('jersey', 'bike-alu')).toBe('bike-alu');
  });

  it('anciennes roues du garage (LEGACY_WHEELS) : pièce de l\'atelier existante ou aucune', () => {
    for (const [old, id] of Object.entries(LEGACY_WHEELS)) {
      if (id === null) continue;
      expect(tuneItem(id)?.slot, `${old} → ${id}`).toBe('wheelset');
    }
    expect(LEGACY_WHEELS['wheels-alu']).toBeNull();
  });

  it('rééquiper le même casque, les mêmes lunettes ou le même maillot ne change pas la tenue', () => {
    for (const base of [LOOKS.fullMale, LOOKS.female, LOOKS.tt] as AvatarLook[]) {
      for (const item of COSMETICS) {
        if (item.slot === 'helmet') {
          const a = helmetLookOf(item, base);
          expect(helmetLookOf(item, resave(a)), item.id).toEqual(a);
        } else if (item.slot === 'glasses') {
          const a = glassesLookOf(item, base);
          expect(glassesLookOf(item, resave(a)), item.id).toEqual(a);
        } else if (item.slot === 'jersey') {
          const a = resave({ ...base, ...jerseyLookOf(item) });
          expect(resave({ ...a, ...jerseyLookOf(item) }), item.id).toEqual(a);
        }
      }
    }
  });

  it('équiper un accessoire ne touche ni au visage, ni à la coiffure, ni à la pilosité, ni au vélo, ni à la taille', () => {
    const base = LOOKS.fullMale as AvatarLook;
    for (const item of COSMETICS) {
      let out: AvatarLook | null = null;
      if (item.slot === 'helmet') out = helmetLookOf(item, base);
      else if (item.slot === 'glasses') out = glassesLookOf(item, base);
      else if (item.slot === 'jersey') out = { ...base, ...jerseyLookOf(item) };
      if (!out) continue;
      for (const k of ['face', 'hairStyle', 'hair', 'beard', 'moustache', 'bikeModel', 'bikeType', 'tune', 'heightCm', 'skin'] as const) expect(out[k], `${item.id} : ${k}`).toEqual(base[k]);
    }
  });
});
