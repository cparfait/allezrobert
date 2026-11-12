/**
 * Géométries réelles de cadres de route, par modèle et par taille, telles que publiées par les fabricants.
 *
 * Ce sont des DONNÉES de fabricant, indépendantes du coureur et du moteur graphique : aucune cible du
 * cycliste (mains, selle, bassin), aucun réglage, aucune mise à l'échelle. En particulier, le stack et le
 * reach décrivent le CADRE (haut de la douille de direction), pas les points de contact du cycliste (cocottes,
 * selle), qui dépendent en plus de la potence, des entretoises, du cintre et de la tige de selle.
 *
 * Unités : millimètres (champs en `…Mm`) et degrés (champs en `…Deg`), comme sur les fiches des fabricants ;
 * le repère du jeu (BIKE_REFERENCE, bikeReference.ts) est en mètres, aucune conversion n'est faite ici.
 *
 * Audit n° 3, étape E2.1 : aucun module du moteur n'utilise encore ces valeurs.
 * Étape E2.2 : points de référence du cadre calculés à partir de ces cotes (voir plus bas), toujours sans consommateur.
 */

/**
 * Cotes du cadre (et de la fourche de série) d'une taille, en millimètres et en degrés, selon les définitions
 * des fiches de géométrie du fabricant.
 */
export interface FrameGeometry {
  /** Hauteur verticale du centre du boîtier de pédalier au centre du haut de la douille de direction (mm). */
  readonly stackMm: number;
  /** Distance horizontale du centre du boîtier de pédalier au centre du haut de la douille de direction (mm). */
  readonly reachMm: number;
  /** Distance horizontale entre les axes des roues (mm). */
  readonly wheelbaseMm: number;
  /** Bases : distance du centre du boîtier de pédalier à l'axe de la roue arrière (mm). */
  readonly chainstayMm: number;
  /** Angle de la douille de direction avec l'horizontale (degrés). */
  readonly headTubeAngleDeg: number;
  /** Angle du tube de selle avec l'horizontale (degrés). */
  readonly seatTubeAngleDeg: number;
  /** Chute du pédalier : hauteur des axes des roues au-dessus du centre du boîtier (mm). */
  readonly bbDropMm: number;
  /** Hauteur du centre du boîtier de pédalier au-dessus du sol, pneus de série montés (mm). */
  readonly bbHeightMm: number;
  /** Longueur de la douille de direction (mm). */
  readonly headTubeLengthMm: number;
  /** Longueur du tube de selle, mesure du fabricant (mm). */
  readonly seatTubeLengthMm: number;
  /** Longueur horizontale (effective) du tube supérieur (mm). */
  readonly topTubeHorizontalMm: number;
  /** Déport de la fourche : distance de l'axe avant à l'axe de direction, perpendiculairement à celui-ci (mm). */
  readonly forkOffsetMm: number;
  /** Longueur de la fourche, de l'axe de la roue avant à la couronne (mm). */
  readonly forkLengthMm: number;
  /** Distance du centre du boîtier de pédalier à l'axe de la roue avant (mm). */
  readonly frontCenterMm: number;
}

/** Pièces de série qui changent avec la taille (mm). */
export interface StockFitParts {
  /** Longueur de manivelle, de l'axe du boîtier à l'axe de la pédale (mm). */
  readonly crankLengthMm: number;
  /** Largeur du cintre, mesure du fabricant (mm). */
  readonly handlebarWidthMm: number;
  /** Longueur de la potence (mm). */
  readonly stemLengthMm: number;
}

/** Une taille de cadre d'un modèle : libellé du fabricant, cotes du cadre, pièces de série. */
export interface BikeSizeGeometry {
  /** Libellé de taille du fabricant (p. ex. « 54 »). */
  readonly size: string;
  readonly frame: FrameGeometry;
  readonly parts: StockFitParts;
}

/** Géométrie d'un modèle du catalogue : identifiant (bikes.json), année, sources et tailles enregistrées. */
export interface BikeGeometryModel {
  /** Identifiant du modèle dans le catalogue (BIKES, bikes.json). */
  readonly modelId: string;
  /** Nom du modèle chez le fabricant, année comprise. */
  readonly name: string;
  /** Millésime des cotes (les géométries changent d'une année à l'autre). */
  readonly year: number;
  /** Sources des cotes (fiche du fabricant, documentation de gamme). */
  readonly sources: readonly string[];
  /** Tailles enregistrées (pas forcément toute la gamme du fabricant). */
  readonly sizes: readonly BikeSizeGeometry[];
}

/**
 * Specialized Roubaix Sport 2020 : taille 54 seulement à ce jour. Cotes relevées le 08/11/2026 sur la fiche du
 * fabricant (tableau « Géométries ») et vérifiées dans la documentation de gamme 2020 (page « Roubaix Sport »).
 */
const ROUBAIX_SPORT_2020: BikeGeometryModel = Object.freeze({
  modelId: 'div-specialized-roubaix-sport-2020',
  name: 'Specialized Roubaix Sport 2020',
  year: 2020,
  sources: Object.freeze([
    'https://www.specialized.com/fr/fr/roubaix-sport/p/170245',
    'https://www.matosvelo.fr/public/Actu/Specialized/2019/Roubaix_Disc_2020/Gamme/Specialize-Roubaix-gamme-specs.pdf',
  ]),
  sizes: Object.freeze([
    Object.freeze({
      size: '54',
      frame: Object.freeze({
        stackMm: 585,
        reachMm: 376,
        wheelbaseMm: 988,
        chainstayMm: 415,
        headTubeAngleDeg: 72.75,
        seatTubeAngleDeg: 74,
        bbDropMm: 76,
        bbHeightMm: 266,
        headTubeLengthMm: 125,
        seatTubeLengthMm: 465,
        topTubeHorizontalMm: 545,
        forkOffsetMm: 44,
        forkLengthMm: 370,
        frontCenterMm: 585,
      }),
      parts: Object.freeze({
        crankLengthMm: 172.5,
        handlebarWidthMm: 420,
        stemLengthMm: 100,
      }),
    }),
  ]),
});

/** Géométries réelles enregistrées (une entrée par modèle du catalogue). */
export const BIKE_GEOMETRIES: readonly BikeGeometryModel[] = Object.freeze([ROUBAIX_SPORT_2020]);

// ---------------------------------------------------------------------------------------------
// Points de référence du cadre (E2.2)
// ---------------------------------------------------------------------------------------------
//
// Repère du cadre : origine au CENTRE DU BOÎTIER DE PÉDALIER, +x vers la gauche du coureur, +y vers le haut,
// +z vers l'avant ; distances en millimètres. Mêmes axes que le repère du jeu (BIKE_REFERENCE, en mètres), dont
// l'origine est au sol à l'aplomb du boîtier : pour comparer, convertir (framePointMmToM) puis ajouter la hauteur
// du boîtier du vélo considéré. Les points du cadre sont dans le plan médian (x = 0).
//
// Ces fonctions ne calculent que ce que les cotes du fabricant déterminent. Les vrais points de contact du
// cycliste demandent des données qui ne sont pas enregistrées (voir SaddleContactInputs et HoodContactInputs) :
// aucune valeur par défaut n'est supposée ici.

/** Point (x, y, z) du repère du cadre, en millimètres. */
export type FramePointMm = readonly [x: number, y: number, z: number];
/** Point (x, y, z) du repère du cadre, en mètres (après conversion explicite). */
export type FramePointM = readonly [x: number, y: number, z: number];
/** Direction unitaire (sans unité) dans le repère du cadre. */
export type FrameDirection = readonly [x: number, y: number, z: number];

const DEG = Math.PI / 180;
/** Point figé ; « + 0 » ramène −0 à 0 (comparaisons exactes). */
const point = (x: number, y: number, z: number): FramePointMm => Object.freeze([x + 0, y + 0, z + 0] as const);

function requireNumber(name: string, v: number, min?: number, max?: number): void {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`${name} : nombre fini attendu (${String(v)})`);
  if (min !== undefined && v < min) throw new RangeError(`${name} : ${v} < ${min}`);
  if (max !== undefined && v > max) throw new RangeError(`${name} : ${v} > ${max}`);
}

/**
 * Axe de direction, sens montant : du bas vers le haut de la douille (vers le haut et vers l'arrière),
 * incliné de headTubeAngleDeg sur l'horizontale.
 */
export function steeringAxisUp(frame: FrameGeometry): FrameDirection {
  const a = frame.headTubeAngleDeg * DEG;
  return Object.freeze([0, Math.sin(a), -Math.cos(a)] as const);
}

/**
 * Centre du haut de la douille de direction (mm) : (0, stack, reach). C'est le point de mesure du stack et du reach
 * du CADRE, sous le jeu de direction : ni le haut du pivot, ni la potence, ni le cintre, ni les mains.
 */
export function headTubeTopMm(frame: FrameGeometry): FramePointMm {
  return point(0, frame.stackMm, frame.reachMm);
}

/** Centre du bas de la douille de direction (mm) : haut de douille moins headTubeLengthMm le long de l'axe de direction. */
export function headTubeBottomMm(frame: FrameGeometry): FramePointMm {
  const [, uy, uz] = steeringAxisUp(frame);
  return point(0, frame.stackMm - frame.headTubeLengthMm * uy, frame.reachMm - frame.headTubeLengthMm * uz);
}

/** Axe de la roue avant (mm) : à la hauteur de la chute, à la distance frontCenterMm du boîtier. */
export function frontAxleMm(frame: FrameGeometry): FramePointMm {
  return point(0, frame.bbDropMm, Math.sqrt(frame.frontCenterMm ** 2 - frame.bbDropMm ** 2));
}

/** Axe de la roue arrière (mm) : à la hauteur de la chute, à la distance chainstayMm (bases) du boîtier. */
export function rearAxleMm(frame: FrameGeometry): FramePointMm {
  return point(0, frame.bbDropMm, -Math.sqrt(frame.chainstayMm ** 2 - frame.bbDropMm ** 2));
}

/** Hauteur du sol dans le repère du cadre (mm) : −bbHeightMm (pneus de série). */
export function groundYMm(frame: FrameGeometry): number {
  return -frame.bbHeightMm;
}

/**
 * Axe du tube de selle, sens montant : du boîtier vers le haut, donc vers l'ARRIÈRE (z décroît quand y croît),
 * incliné de seatTubeAngleDeg sur l'horizontale.
 */
export function seatTubeAxisUp(frame: FrameGeometry): FrameDirection {
  const a = frame.seatTubeAngleDeg * DEG;
  return Object.freeze([0, Math.sin(a), -Math.cos(a)] as const);
}

/**
 * Point de l'axe du tube de selle (mm) à la distance `alongAxisMm` du centre du boîtier, mesurée LE LONG de l'axe.
 * Ce n'est pas le dessus de la selle : celui-ci dépend en plus du recul de la tige, de la position du chariot sur
 * les rails, de la hauteur de la coque et du réglage du cycliste (SaddleContactInputs).
 */
export function seatTubePointAlongAxisMm(frame: FrameGeometry, alongAxisMm: number): FramePointMm {
  requireNumber('alongAxisMm', alongAxisMm, 0);
  const [, uy, uz] = seatTubeAxisUp(frame);
  return point(0, alongAxisMm * uy, alongAxisMm * uz);
}

/** Point de l'axe du tube de selle (mm) à la hauteur VERTICALE `heightAboveBbMm` au-dessus du centre du boîtier. */
export function seatTubePointAtHeightMm(frame: FrameGeometry, heightAboveBbMm: number): FramePointMm {
  requireNumber('heightAboveBbMm', heightAboveBbMm, 0);
  const [, uy] = seatTubeAxisUp(frame);
  return seatTubePointAlongAxisMm(frame, heightAboveBbMm / uy);
}

/**
 * Point de l'axe de direction (pivot) à `aboveHeadTubeTopMm` au-dessus du haut de la douille, le long de l'axe (mm).
 * La distance (cuvette haute du jeu de direction, entretoises, demi-hauteur du collier de potence…) doit être fournie.
 */
export function steererPointMm(frame: FrameGeometry, aboveHeadTubeTopMm: number): FramePointMm {
  requireNumber('aboveHeadTubeTopMm', aboveHeadTubeTopMm, 0);
  const [, uy, uz] = steeringAxisUp(frame);
  return point(0, frame.stackMm + aboveHeadTubeTopMm * uy, frame.reachMm + aboveHeadTubeTopMm * uz);
}

/** Montage de potence : toutes les valeurs sont obligatoires (aucune valeur par défaut). */
export interface StemSetup {
  /** Distance le long du pivot, du haut de la douille au centre du collier de la potence (mm) : jeu de direction + entretoises + demi-collier. */
  readonly steererOffsetMm: number;
  /** Longueur de la potence, du centre du collier de pivot au centre du collier de cintre (mm). */
  readonly stemLengthMm: number;
  /** Angle de la potence par rapport à la perpendiculaire au pivot (degrés, positif vers le haut, p. ex. +7 pour « 7-degree rise »). */
  readonly stemRiseDeg: number;
}

/**
 * Centre du collier de cintre (mm) : point du pivot `steererOffsetMm`, puis `stemLengthMm` dans la direction de la potence
 * (perpendiculaire au pivot vers l'avant, tournée de `stemRiseDeg` vers le haut). Ce n'est pas encore la position des
 * mains : il manque la géométrie du cintre et l'implantation des cocottes (HoodContactInputs).
 */
export function handlebarClampCenterMm(frame: FrameGeometry, stem: StemSetup): FramePointMm {
  if (!stem || typeof stem !== 'object') throw new RangeError('stem : montage de potence attendu');
  requireNumber('stem.steererOffsetMm', stem.steererOffsetMm, 0);
  requireNumber('stem.stemLengthMm', stem.stemLengthMm, 1);
  requireNumber('stem.stemRiseDeg', stem.stemRiseDeg, -45, 45);
  const a = frame.headTubeAngleDeg * DEG;
  const r = stem.stemRiseDeg * DEG;
  const [, uy, uz] = steeringAxisUp(frame);
  // Perpendiculaire au pivot, vers l'avant (et légèrement vers le haut) ; la montée ajoute la composante du pivot.
  const py = Math.cos(a), pz = Math.sin(a);
  const dy = py * Math.cos(r) + uy * Math.sin(r);
  const dz = pz * Math.cos(r) + uz * Math.sin(r);
  const s = steererPointMm(frame, stem.steererOffsetMm);
  return point(0, s[1] + stem.stemLengthMm * dy, s[2] + stem.stemLengthMm * dz);
}

/**
 * Paire de points symétriques par rapport au plan médian (mm) : gauche à +x, droite à −x (convention du jeu),
 * à `halfSpacingMm` de part et d'autre d'un point du plan médian. L'écartement doit être fourni.
 */
export function mirroredPairMm(center: FramePointMm, halfSpacingMm: number): { readonly L: FramePointMm; readonly R: FramePointMm } {
  requireNumber('halfSpacingMm', halfSpacingMm, 0);
  return Object.freeze({ L: point(center[0] + halfSpacingMm, center[1], center[2]), R: point(center[0] - halfSpacingMm, center[1], center[2]) });
}

/** Conversion explicite millimètres → mètres (le repère reste celui du cadre : origine au boîtier). */
export function framePointMmToM(p: FramePointMm): FramePointM {
  return Object.freeze([p[0] / 1000, p[1] / 1000, p[2] / 1000] as const);
}

/**
 * Données nécessaires au futur point de contact de la selle (non enregistrées : à relever sur le vélo ou à fournir
 * par le réglage du cycliste). Documentation seulement, aucune valeur ni consommateur.
 */
export interface SaddleContactInputs {
  /** Hauteur de selle (mm) et sa convention : du centre du boîtier au dessus de la selle, le long de l'axe du tube de selle. */
  readonly saddleHeightMm: number;
  /** Recul de la tige (mm) : décalage du centre du chariot derrière l'axe du tube de selle (S-Works Pavé : à relever). */
  readonly seatpostSetbackMm: number;
  /** Position du chariot sur les rails (mm, positif vers l'avant), réglage du cycliste. */
  readonly railClampOffsetMm: number;
  /** Hauteur de la coque au-dessus de l'axe des rails, au point d'appui des ischions (mm). */
  readonly saddleStackMm: number;
  /** Position du point d'appui des ischions, depuis le bec de la selle (mm). */
  readonly sitBoneFromNoseMm: number;
}

/**
 * Données nécessaires au futur point d'appui des paumes sur les cocottes (non enregistrées). La longueur de potence
 * (100 mm) et la largeur de cintre (420 mm) d'E2.1 ne suffisent pas : il faut aussi tout ce qui suit.
 */
export interface HoodContactInputs {
  /** Hauteur du jeu de direction au-dessus de la douille (cuvette haute, capot) (mm). */
  readonly headsetUpperStackMm: number;
  /** Entretoises sous la potence (mm). */
  readonly spacerStackMm: number;
  /** Hauteur du collier de pivot de la potence (mm) : son centre est à mi-hauteur. */
  readonly stemClampHeightMm: number;
  /** Montée de la potence (degrés) ; « 7-degree rise » sur la fiche, sens de montage à préciser (vers le haut ou retournée). */
  readonly stemRiseDeg: number;
  /** Reach du cintre (mm) : avancée du crochet devant l'axe du cintre (fiche 2020 : 70 ou 75 mm selon la source). */
  readonly handlebarReachMm: number;
  /** Drop du cintre (mm) (fiche 2020 : 103 ou 125 mm selon la source). */
  readonly handlebarDropMm: number;
  /** Convention de mesure de la largeur du cintre (centre à centre au crochet, extérieur…). */
  readonly handlebarWidthConvention: 'center-to-center' | 'outside-to-outside';
  /** Évasement du bas du cintre (degrés). */
  readonly handlebarFlareDeg: number;
  /** Implantation de la cocotte sur le cintre : distance le long du crochet depuis l'axe du cintre (mm). */
  readonly hoodPositionOnBarMm: number;
  /** Inclinaison de la cocotte (degrés, rotation du cintre comprise). */
  readonly hoodAngleDeg: number;
  /** Point d'appui de la paume sur la cocotte, depuis l'arrière du corps de cocotte (mm). */
  readonly palmOnHoodMm: number;
}
