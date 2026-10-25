/**
 * Paramètres des mondes construits par l'outil. Le monde est choisi à l'exécution :
 * `--world <id>` (ou `TERRAIN_WORLD=<id>`), « chevreuse » par défaut.
 *
 * - « chevreuse » (corridor Saclay → Chevreuse → Rambouillet) : boucles tirées des sorties
 *   Garmin de l'auteur. Aucune coordonnée liée au domicile ici : les points sensibles sont lus
 *   à l'exécution depuis data/garmin (non versionné).
 * - montées célèbres (« alpe-dhuez », « mont-ventoux ») : un itinéraire point à point construit
 *   sur OSM entre deux points publics ; aucune donnée Garmin n'est lue.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');
export const CACHE_DIR = path.join(REPO_ROOT, 'data', 'cache', 'terrain');
export const GARMIN_DIR = path.join(REPO_ROOT, 'data', 'garmin');

/** Point WGS84 (degrés). */
export interface LonLat {
  lon: number;
  lat: number;
}

/** Valeurs publiées d'une montée, pour la validation (rapport de construction). */
export interface ClimbReference {
  lengthM: number;
  gainM: number;
  avgGradePct: number;
  startEleM?: number;
  finishEleM?: number;
  maxGradePct?: number;
  sources: string[];
}

/** Repère nommé le long d'une montée (village, chalet, stèle…), recalé sur le point le plus proche. */
export interface ClimbLandmark {
  name: string;
  at: LonLat;
}

export interface ClimbSpec {
  routeId: string;
  routeName: string;
  routeNameEn: string;
  /** Début de l'itinéraire (courte approche avant le pied de la montée). */
  start: LonLat;
  /** Pied de la montée : début du segment KOM. */
  climbStart: LonLat;
  /** Ligne d'arrivée : fin du segment KOM. */
  finish: LonLat;
  /** Fin de l'itinéraire (quelques dizaines de mètres après la ligne, pour décélérer). */
  end: LonLat;
  /** Points de passage imposés (dans l'ordre) entre le départ et la fin. */
  via?: LonLat[];
  /** Numéros de route privilégiés par le calcul d'itinéraire (tag `ref` OSM). */
  preferRefs: string[];
  komId: string;
  komName: string;
  /** Lacets numérotés (Alpe d'Huez : 21 → 1). Absent : lacets seulement détectés et comptés. */
  numberedHairpins?: { count: number; descending: boolean };
  landmarks?: ClimbLandmark[];
  reference: ClimbReference;
  /** Marquage de la chaussée de l'itinéraire (défaut : rives et axe). */
  markings?: 'full' | 'axis' | 'none';
  /** Largeur de chaussée imposée (m), mesurée sur l'orthophoto, quand OSM n'a que le défaut par type. */
  roadWidthM?: number;
}

/**
 * Données IGN fines autour de l'itinéraire (tranche témoin) : arbres et haies détectés dans le
 * modèle de hauteur LiDAR HD, bâtiments BD TOPO (hauteurs, matériaux) avec toits mesurés au LiDAR.
 */
export interface WorldEnrich {
  /** Distance maximale à l'itinéraire (m) des tuiles enrichies (tuiles haute résolution seulement). */
  radiusM: number;
  lidarVegetation: boolean;
  bdtopoBuildings: boolean;
}

interface WorldBase {
  id: string;
  name: string;
  /** Origine du repère monde en Lambert-93 (multiples de 1 km). */
  originL93: { x: number; y: number };
  /** Emprise maximale en indices de tuiles (bornes incluses). */
  corridorTiles: { txMin: number; txMax: number; tzMin: number; tzMax: number };
  /** Données fines IGN ; défaut QUALITY.enrich, `false` pour s'en passer. */
  enrich?: WorldEnrich | false;
  /** Région affichée dans le menu (bloc « Zones »). */
  region?: string;
  /** Monde privé (data/private/worlds) : sortie ignorée par git. */
  private?: boolean;
  /** Bord de mer : l'absence de relief IGN (LiDAR et RGE ALTI) est la mer, pas un trou à boucher. */
  sea?: boolean;
}

/**
 * Côte célèbre ajoutée à un monde Garmin (défi KOM) : itinéraire montée puis redescente par la même
 * route, départ lancé `start` quelques centaines de mètres avant le pied, une seule montée nommée.
 */
export interface FamousClimb {
  routeId: string;
  routeName: string;
  routeNameEn: string;
  /** Nom de la montée chronométrée. */
  climbName: string;
  start: LonLat;
  foot: LonLat;
  via?: LonLat[];
  summit: LonLat;
  /** Sources des chiffres de référence. */
  reference?: string;
}

/**
 * Monde ouvert construit autour des itinéraires existants d'un monde `garmin` ou `climb` : toute
 * l'emprise en haute résolution, toutes les routes creusées, `graph.json` et `places.json`
 * (build-open). Les itinéraires déjà publiés (`routes/*.json`) sont gardés tels quels et creusés en
 * priorité ; les refaire : `build:world -- --world <id> --routes-only`, puis `build:world`.
 */
export interface OpenOverlay {
  /** Départ par défaut du roulage libre. */
  start: LonLat;
}

export interface GarminWorld extends WorldBase {
  kind: 'garmin';
  /** Côtes célèbres hors des sorties Garmin, ajoutées comme itinéraires (défi KOM). */
  climbs?: FamousClimb[];
  open?: OpenOverlay;
}

export interface ClimbWorld extends WorldBase {
  kind: 'climb';
  climb: ClimbSpec;
  /** Tuiles haute résolution (2 m) : à moins de cette distance de l'itinéraire. */
  hiMarginM: number;
  /** Tuiles basse résolution (8 m) : à moins de cette distance de l'itinéraire (au-delà : pas de tuile). */
  loMarginM: number;
  /** Relief lointain (ligne d'horizon) : grille unique, demi-côté et pas en mètres. */
  horizon: { halfSizeM: number; resM: number };
  /** Côté des orthophotos (px par tuile de 1 km) : tuiles 2 m et tuiles 8 m. Défaut QUALITY.orthoPx. */
  orthoPx?: { hi: number; lo: number };
  open?: OpenOverlay;
}

/** Tour proposé dans un monde ouvert : boucle par des points de passage publics (villages). */
export interface OpenTour {
  routeId: string;
  routeName: string;
  routeNameEn: string;
  /** Départ et arrivée (même point : boucle), puis points de passage dans l'ordre ; un nom désigne le lieu OSM (place=*). */
  start: LonLat | string;
  via: Array<LonLat | string>;
  /** Montées chronométrées : pied et sommet. */
  koms?: Array<{ id: string; name: string; from: LonLat; to: LonLat }>;
  /** Noms des côtes détectées, dans l'ordre du parcours (sinon : lieu le plus proche du sommet). */
  climbNames?: string[];
  /** Chemins (« track ») permis au tour, pénalisés : accès aux secteurs pavés par des pistes. */
  allowTracks?: boolean;
}

/**
 * Monde ouvert : emprise rectangulaire entièrement en haute résolution (LiDAR HD), toutes les
 * routes creusées et roulables, graphe routier exporté (`graph.json`) pour choisir sa route aux
 * carrefours. Aucune donnée Garmin.
 */
export interface OpenWorld extends WorldBase {
  kind: 'open';
  /** Point de départ par défaut (centre du village). */
  start: LonLat;
  /** Côté des orthophotos par tuile de 1 km (px) : 1024 ≈ 1 m/px. */
  orthoPx: number;
  horizon: { halfSizeM: number; resM: number };
  tours: OpenTour[];
}

export type WorldConfig = GarminWorld | ClimbWorld | OpenWorld;

/**
 * Qualité standard de tous les mondes (22/10/2026), sauf réglage contraire dans le monde :
 * - relief en 2 m (LiDAR HD) à moins de 800 m des itinéraires (vue depuis les lacets, drone, TV) ;
 * - orthophotos IGN à 1 024 px par tuile de 1 km (≈ 1 m/px), partout : à 512 px au-delà des tuiles
 *   en 2 m, le sol changeait visiblement de netteté d'une tuile à l'autre (25/10/2026) ;
 * - enrichissement à moins de 600 m des itinéraires : arbres et haies du MNH LiDAR HD, bâtiments
 *   BD TOPO aux toits mesurés dans le MNS, nature et largeur des voies BD TOPO.
 */
export const QUALITY = {
  hiMarginM: 800,
  orthoPx: { hi: 1024, lo: 1024 },
  enrich: { radiusM: 600, lidarVegetation: true, bdtopoBuildings: true } as WorldEnrich,
};

export const WORLDS: Record<string, WorldConfig> = {
  chevreuse: {
    kind: 'garmin',
    id: 'chevreuse',
    name: 'Vallée de Chevreuse',
    region: 'Yvelines · Essonne',
    // près de Chevreuse
    originL93: { x: 629000, y: 6846000 },
    // ≈ lon 1,78–2,20, lat 48,62–48,75
    corridorTiles: { txMin: -20, txMax: 12, tzMin: -6, tzMax: 10 },
    // monde ouvert autour des sorties : roulage libre depuis le centre de Chevreuse
    open: { start: { lon: 2.03885, lat: 48.70675 } },
    // pieds et sommets relevés sur les routes OSM et le relief IGN, chiffres recoupés (climbfinder.com)
    climbs: [
      {
        routeId: 'cote-de-la-madeleine',
        routeName: 'La côte de la Madeleine',
        routeNameEn: 'The Madeleine climb',
        climbName: 'Côte de la Madeleine',
        start: { lon: 2.04569, lat: 48.70664 },
        foot: { lon: 2.04888, lat: 48.70744 },
        summit: { lon: 2.04299, lat: 48.71154 },
        reference: 'chemin de la Butte des Vignes, 0,7 km à 10 %, sommet 158 m (climbfinder)',
      },
      {
        routeId: 'cote-de-chateaufort',
        routeName: 'La côte de Châteaufort',
        routeNameEn: 'The Châteaufort climb',
        climbName: 'Côte de Châteaufort',
        start: { lon: 2.09429, lat: 48.73266 },
        foot: { lon: 2.09263, lat: 48.73026 },
        summit: { lon: 2.09331, lat: 48.7245 },
        reference: 'route de Versailles (D938), 0,9 km à 5,3 %, sommet 157 m (climbfinder)',
      },
      {
        routeId: 'cote-des-vaux-de-cernay',
        routeName: 'La côte des Vaux de Cernay',
        routeNameEn: 'The Vaux de Cernay climb',
        climbName: 'Côte des Vaux de Cernay',
        start: { lon: 1.966, lat: 48.67897 },
        foot: { lon: 1.96241, lat: 48.67526 },
        via: [{ lon: 1.96025, lat: 48.67197 }],
        summit: { lon: 1.95661, lat: 48.66948 },
        reference: 'D91 des cascades des Vaux de Cernay vers Rambouillet, 122 → 170 m (relief IGN)',
      },
      {
        routeId: 'cote-de-meridon',
        routeName: 'La côte de Méridon',
        routeNameEn: 'The Méridon climb',
        climbName: 'Côte de Méridon',
        start: { lon: 2.03723, lat: 48.70727 },
        foot: { lon: 2.03613, lat: 48.70341 },
        via: [{ lon: 2.03182, lat: 48.69806 }],
        summit: { lon: 2.03672, lat: 48.69421 },
        reference: 'route de Choisel puis route de Boullay-les-Troux, 1,4 km à 5 %, sommet 158 m (climbfinder)',
      },
    ],
  },
  'alpe-dhuez': {
    kind: 'climb',
    id: 'alpe-dhuez',
    name: "Alpe d'Huez",
    region: 'Isère · Oisans',
    // entre La Garde et Huez (milieu de la montée)
    originL93: { x: 940000, y: 6447000 },
    // itinéraire ≈ E 938,8–942,3 km, N 6 444,4–6 449,0 km, + 5 km de montagnes autour
    corridorTiles: { txMin: -8, txMax: 7, tzMin: -8, tzMax: 8 },
    // monde ouvert autour de la montée : roulage libre depuis le pied (D1091)
    open: { start: { lon: 6.03455, lat: 45.06135 } },
    // qualité standard (QUALITY) : bande de 2 m, vue aérienne ≈ 1 m/px, LiDAR HD et BD TOPO
    hiMarginM: QUALITY.hiMarginM,
    loMarginM: 5000,
    horizon: { halfSizeM: 30000, resM: 100 },
    climb: {
      routeId: 'alpe-dhuez',
      routeName: "Montée de l'Alpe d'Huez",
      routeNameEn: "Alpe d'Huez climb",
      // D1091, 300 m avant le carrefour (venant du Bourg-d'Oisans)
      start: { lon: 6.03455, lat: 45.06135 },
      // sortie du giratoire D1091 / D211 (fin de la double chaussée de la D211)
      climbStart: { lon: 6.03777, lat: 45.05985 },
      // arrivée : sommet de la D211 (≈ 1 850 m, carrefour route du Signal / avenue du Rif Nel)
      finish: { lon: 6.07003, lat: 45.09582 },
      // fin de l'itinéraire : avenue du Rif Nel, au mur des vainqueurs d'étape
      end: { lon: 6.07147, lat: 45.09412 },
      via: [
        // route d'Huez (village d'Huez), puis le haut de la route du Signal
        { lon: 6.0566, lat: 45.09135 },
        { lon: 6.0703, lat: 45.0958 },
      ],
      preferRefs: ['D 211', 'D 211F', 'D 1091'],
      komId: 'kom-alpe-dhuez',
      komName: "Montée de l'Alpe d'Huez",
      numberedHairpins: { count: 21, descending: true },
      reference: {
        lengthM: 13800,
        gainM: 1071,
        avgGradePct: 8.1,
        startEleM: 719,
        finishEleM: 1850,
        maxGradePct: 13,
        sources: [
          "fr.wikipedia.org/wiki/Alpe_d'Huez : 13,8 km, 1 090 m, 7,9 %",
          "en.wikipedia.org/wiki/Alpe_d'Huez : 13,8 km, 1 120 m, 8,1 %, max 13 %",
          'alpedhuez.com (21 virages) : 13,8 km / 14,454 km, 1 121 m, 7,9 %, max 14 % ; virage 21 à 806 m, 1 à 1 713 m',
          'climbfinder.com : 14 km, 1 122 m, 8 %, arrivée 1 841 m',
        ],
      },
    },
  },
  'mont-ventoux': {
    kind: 'climb',
    id: 'mont-ventoux',
    name: 'Mont Ventoux',
    region: 'Vaucluse',
    // entre Saint-Estève et le Chalet Reynard
    originL93: { x: 880000, y: 6342000 },
    // itinéraire ≈ E 874,3–885,5 km, N 6 338,3–6 345,0 km, + 5 km autour
    corridorTiles: { txMin: -12, txMax: 11, tzMin: -9, tzMax: 10 },
    // monde ouvert autour de la montée : roulage libre depuis le début de l’itinéraire (D974, Bédoin) ;
    // le départ de la montée tombe à 58 m, dans les ruelles du vieux village
    open: { start: { lon: 5.17955, lat: 44.12267 } },
    // qualité standard (QUALITY) : bande de 2 m, vue aérienne ≈ 1 m/px, LiDAR HD et BD TOPO
    hiMarginM: QUALITY.hiMarginM,
    loMarginM: 5000,
    horizon: { halfSizeM: 35000, resM: 100 },
    climb: {
      routeId: 'mont-ventoux-bedoin',
      routeName: 'Mont Ventoux par Bédoin',
      routeNameEn: 'Mont Ventoux from Bédoin',
      // D974 (avenue Barral des Baux), 300 m avant le giratoire de Bédoin
      start: { lon: 5.17905, lat: 44.12305 },
      // sortie du giratoire de Bédoin vers la route du Mont-Ventoux (début de l'itinéraire cyclable
      // OSM « Ascension du Mont-Ventoux depuis Bédoin »)
      climbStart: { lon: 5.18085, lat: 44.12517 },
      // sommet (fin de l'itinéraire OSM, au pied de l'observatoire)
      finish: { lon: 5.27840, lat: 44.17350 },
      // un peu après le sommet, au début de la descente vers Malaucène
      end: { lon: 5.27971, lat: 44.1744 },
      via: [
        // Saint-Estève (entrée dans la forêt), Chalet Reynard
        { lon: 5.23620, lat: 44.11780 },
        { lon: 5.31880, lat: 44.15210 },
      ],
      preferRefs: ['D 974'],
      komId: 'kom-mont-ventoux',
      komName: 'Mont Ventoux (Bédoin)',
      landmarks: [
        { name: 'Chalet Reynard', at: { lon: 5.31899, lat: 44.15234 } },
        { name: 'Stèle Tom Simpson', at: { lon: 5.28618, lat: 44.16971 } },
        { name: 'Sommet du Ventoux', at: { lon: 5.27826, lat: 44.17347 } },
      ],
      reference: {
        lengthM: 21500,
        gainM: 1610,
        avgGradePct: 7.5,
        startEleM: 300,
        finishEleM: 1909,
        maxGradePct: 13.3,
        sources: [
          'en.wikipedia.org/wiki/Mont_Ventoux : 21,8 km, 1 617 m, 7,43 %, sommet 1 910 m ; Saint-Estève à 5,8 km',
          'fr.wikipedia.org/wiki/Mont_Ventoux : 21,6 km (D974) ; sommet 1 910 m (1 897 m mesuré en 2016)',
          'climbfinder.com : 20,8 km, 1 594 m, 7,7 %, 100 m les plus raides 13,3 %, sommet 1 909 m',
          'OSM, itinéraire « Ascension du Mont-Ventoux depuis Bédoin » (relation 12252348) : distance=21 km',
        ],
      },
    },
  },
  longchamp: {
    kind: 'open',
    id: 'longchamp',
    name: 'Paris — Longchamp',
    region: 'Paris · Bois de Boulogne',
    // anneau cyclable de Longchamp (relation OSM 163270), l'entraînement des cyclistes parisiens
    originL93: { x: 644000, y: 6862000 },
    // 6 × 6 km autour de l'hippodrome
    corridorTiles: { txMin: -3, txMax: 2, tzMin: -3, tzMax: 2 },
    start: { lon: 2.23242, lat: 48.86356 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 20000, resM: 100 },
    tours: [
      {
        routeId: 'anneau-de-longchamp',
        routeName: "L'anneau de Longchamp",
        routeNameEn: 'The Longchamp loop',
        // points relevés sur l'anneau autour de l'hippodrome (vue aérienne), sens horaire
        start: { lon: 2.23242, lat: 48.86356 },
        via: [{ lon: 2.23763, lat: 48.86144 }, { lon: 2.23742, lat: 48.85676 }, { lon: 2.23709, lat: 48.85172 }, { lon: 2.23231, lat: 48.85223 }, { lon: 2.22883, lat: 48.85706 }],
      },
    ],
  },
  vincennes: {
    kind: 'open',
    id: 'vincennes',
    name: 'Paris — Vincennes',
    region: 'Paris · Bois de Vincennes',
    // tour de l'hippodrome de Vincennes, dans le bois (routes de la Pyramide, de la Ferme…)
    originL93: { x: 660000, y: 6858000 },
    // 6 × 6 km autour de l'hippodrome
    corridorTiles: { txMin: -3, txMax: 2, tzMin: -3, tzMax: 2 },
    start: { lon: 2.44902, lat: 48.8275 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 20000, resM: 100 },
    tours: [
      {
        routeId: 'tour-hippodrome-vincennes',
        routeName: "Le tour de l'hippodrome de Vincennes",
        routeNameEn: 'Vincennes racecourse loop',
        // points relevés sur l'anneau autour de l'hippodrome (vue aérienne), sens horaire
        start: { lon: 2.44902, lat: 48.8275 },
        via: [{ lon: 2.45639, lat: 48.82529 }, { lon: 2.45533, lat: 48.82244 }, { lon: 2.44718, lat: 48.82043 }, { lon: 2.44446, lat: 48.82074 }, { lon: 2.44346, lat: 48.82487 }],
      },
    ],
  },
  meudon: {
    kind: 'open',
    id: 'meudon',
    name: 'Meudon — Clamart',
    region: 'Hauts-de-Seine · Forêt de Meudon',
    // forêts de Meudon et de Clamart, côte des Gardes (D181), Vélizy, Châtillon
    originL93: { x: 644000, y: 6856000 },
    // 10 × 7 km : E 639–649 km, N 6 852–6 859 km (Sèvres, Chaville, Meudon-la-Forêt, Clamart, Châtillon)
    corridorTiles: { txMin: -5, txMax: 4, tzMin: -3, tzMax: 3 },
    start: { lon: 2.23253, lat: 48.79566 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 20000, resM: 100 },
    tours: [
      {
        routeId: 'boucle-foret-de-meudon',
        routeName: 'La forêt de Meudon par la côte des Gardes',
        routeNameEn: 'Meudon forest loop via the Côte des Gardes',
        climbNames: ['Côte des Gardes'],
        // départ avenue de Trivaux (étang de Trivaux), descente sur Meudon, côte des Gardes (D181)
        // de Bas-Meudon au pavé des Gardes, retour par la forêt, Meudon-la-Forêt et le pavé Blanc ;
        // points relevés sur le tracé routé, chacun sur la chaussée empruntée (pas de raquette)
        start: { lon: 2.23253, lat: 48.79566 },
        via: [{ lon: 2.2336, lat: 48.79989 }, { lon: 2.24719, lat: 48.816 }, { lon: 2.24602, lat: 48.81849 }, { lon: 2.22711, lat: 48.81663 }, { lon: 2.21736, lat: 48.81526 }, { lon: 2.21453, lat: 48.81399 }, { lon: 2.21794, lat: 48.80889 }, { lon: 2.22317, lat: 48.80823 }, { lon: 2.21981, lat: 48.80403 }, { lon: 2.2176, lat: 48.79877 }, { lon: 2.22082, lat: 48.79052 }, { lon: 2.2285, lat: 48.78666 }, { lon: 2.23489, lat: 48.78269 }, { lon: 2.23678, lat: 48.78881 }, { lon: 2.23222, lat: 48.79133 }],
      },
    ],
  },
  etretat: {
    kind: 'open',
    id: 'etretat',
    name: "Étretat — Côte d'Albâtre",
    region: 'Seine-Maritime · Pays de Caux',
    // falaises d'Étretat (porte d'Aval, Manneporte), valleuses et plateau du pays de Caux
    originL93: { x: 501000, y: 6959000 },
    // 11 × 11 km : E 495–506 km, N 6 953–6 964 km (la mer à l'ouest et au nord)
    corridorTiles: { txMin: -6, txMax: 4, tzMin: -5, tzMax: 5 },
    start: { lon: 0.2032, lat: 49.7075 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 30000, resM: 100 },
    sea: true,
    tours: [
      {
        routeId: 'falaises-d-etretat',
        routeName: "Les falaises d'Étretat par Bénouville et Le Tilleul",
        routeNameEn: 'Étretat cliffs via Bénouville and Le Tilleul',
        // points relevés sur le tracé, chacun sur la route traversante (un nom de village mène à son
        // centre, d'où des allers-retours à Vattetot, Bordeaux-Saint-Clair et Pierrefiques)
        start: 'Étretat',
        via: [{ lon: 0.24984, lat: 49.71681 }, { lon: 0.2757, lat: 49.71888 }, { lon: 0.28378, lat: 49.71601 }, { lon: 0.28252, lat: 49.69923 }, { lon: 0.26125, lat: 49.70086 }, { lon: 0.25045, lat: 49.68596 }, { lon: 0.24524, lat: 49.67664 }, { lon: 0.23391, lat: 49.68063 }, { lon: 0.21957, lat: 49.67958 }, { lon: 0.20487, lat: 49.68802 }],
      },
      {
        routeId: 'etretat-fecamp',
        routeName: "D'Étretat vers Fécamp",
        routeNameEn: "From Étretat towards Fécamp",
        // parcours public Garmin Connect (#511947562) : points de passage tous les ~2,5 km, route reconstruite sur OSM
        start: { lon: 0.20561, lat: 49.70704 },
        via: [{ lon: 0.23535, lat: 49.71251 }, { lon: 0.2667, lat: 49.71865 }, { lon: 0.28593, lat: 49.72985 }, { lon: 0.29938, lat: 49.73579 }, { lon: 0.30994, lat: 49.73529 }],
      },
    ],
  },
  esterel: {
    kind: 'open',
    id: 'esterel',
    name: "Corniche de l'Estérel",
    region: 'Var · Estérel',
    // corniche d'Or (D559) entre Saint-Raphaël et Agay, roches rouges de l'Estérel, retour par Valescure (D100)
    originL93: { x: 1010000, y: 6267000 },
    // 13 × 9 km : E 1 003–1 016 km, N 6 262–6 271 km (la mer au sud)
    corridorTiles: { txMin: -7, txMax: 5, tzMin: -4, tzMax: 4 },
    start: { lon: 6.7656, lat: 43.4241 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 30000, resM: 100 },
    sea: true,
    tours: [
      {
        routeId: 'corniche-de-l-esterel',
        routeName: "La corniche de l'Estérel par Agay et Valescure",
        routeNameEn: 'Estérel corniche via Agay and Valescure',
        climbNames: ['Côte des Golfs', "Côte de l'Aspé"],
        // port de Saint-Raphaël, route de la Corniche (D559) par Boulouris et le Dramont, Agay,
        // avenue du Gratadis et avenue des Golfs (D100), Valescure, boulevard du Cerceron
        start: { lon: 6.7656, lat: 43.4241 },
        via: [{ lon: 6.7958, lat: 43.4141 }, { lon: 6.8254, lat: 43.4179 }, { lon: 6.8523, lat: 43.4192 }, { lon: 6.8607, lat: 43.4341 }, { lon: 6.8529, lat: 43.4341 }, { lon: 6.8362, lat: 43.451 }, { lon: 6.8137, lat: 43.4477 }, { lon: 6.7893, lat: 43.4366 }],
      },
    ],
  },
  opale: {
    kind: 'open',
    id: 'opale',
    name: "Côte d'Opale — Les deux caps",
    region: "Pas-de-Calais · Côte d'Opale",
    // caps Blanc-Nez et Gris-Nez, baie de Wissant, bocage du Boulonnais
    originL93: { x: 606000, y: 7089000 },
    // 13 × 12 km : E 599–612 km, N 7 083–7 095 km (la Manche à l'ouest et au nord)
    corridorTiles: { txMin: -7, txMax: 5, tzMin: -6, tzMax: 5 },
    start: { lon: 1.6629, lat: 50.8854 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 30000, resM: 100 },
    sea: true,
    tours: [
      {
        routeId: 'les-deux-caps',
        routeName: 'Les caps Blanc-Nez et Gris-Nez par Wissant',
        routeNameEn: 'Cap Blanc-Nez and Cap Gris-Nez via Wissant',
        // Escalles par la route traversante (le centre faisait un aller-retour) ; le cap Gris-Nez,
        // route sans issue, se fait en aller-retour
        start: 'Wissant',
        via: [{ lon: 1.71192, lat: 50.91814 }, 'Hervelinghen', 'Audembert', 'Audinghen', 'Le Gris-Nez', 'Tardinghen'],
      },
      {
        routeId: 'terre-des-2-caps',
        routeName: "La terre des deux caps",
        routeNameEn: "Land of the two capes",
        // parcours public Garmin Connect (#522486107) : points de passage tous les ~2,5 km, route reconstruite sur OSM
        start: { lon: 1.66187, lat: 50.88545 },
        via: [{ lon: 1.69361, lat: 50.88931 }, { lon: 1.72442, lat: 50.88121 }, { lon: 1.73495, lat: 50.89614 }, { lon: 1.7288, lat: 50.91457 }, { lon: 1.75105, lat: 50.91313 }],
      },
      {
        routeId: 'wissant-les-2-caps',
        routeName: "Wissant et les deux caps",
        routeNameEn: "Wissant and the two capes",
        // parcours public Garmin Connect (#522485964) : points de passage tous les ~2,5 km, route reconstruite sur OSM
        start: { lon: 1.6635, lat: 50.88669 },
        via: [{ lon: 1.66987, lat: 50.86696 }, { lon: 1.63996, lat: 50.86129 }, { lon: 1.61933, lat: 50.85201 }, { lon: 1.59386, lat: 50.86367 }, { lon: 1.59037, lat: 50.86451 }, { lon: 1.60614, lat: 50.8469 }, { lon: 1.59488, lat: 50.83565 }],
      },
    ],
  },
  re: {
    kind: 'open',
    id: 're',
    name: 'Île de Ré',
    region: 'Charente-Maritime · Île de Ré',
    // pointe ouest de l'île : Ars-en-Ré, phare des Baleines, Les Portes, marais salants et pistes cyclables
    originL93: { x: 353000, y: 6579000 },
    // 14 × 11 km : E 346–360 km, N 6 573–6 584 km
    corridorTiles: { txMin: -7, txMax: 6, tzMin: -5, tzMax: 5 },
    start: { lon: -1.5158, lat: 46.2081 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 30000, resM: 100 },
    sea: true,
    tours: [
      {
        routeId: 'phare-des-baleines',
        routeName: 'Le phare des Baleines par Ars-en-Ré et Les Portes',
        routeNameEn: 'Phare des Baleines via Ars-en-Ré and Les Portes',
        // Saint-Clément et Le Gillieux par la route traversante ; Les Portes, au bout de l'île, en
        // aller-retour (La Couarde, plus au sud, faisait 3 km d'aller-retour sur la même route)
        start: 'Ars-en-Ré',
        via: [{ lon: -1.54193, lat: 46.22857 }, { lon: -1.55119, lat: 46.23762 }, 'Les Portes-en-Ré'],
      },
      {
        routeId: 'tour-d-ars-en-re',
        routeName: "Le tour d'Ars-en-Ré",
        routeNameEn: "Ars-en-Ré loop",
        // parcours public Garmin Connect (#510402984) : points de passage tous les ~2,5 km, route reconstruite sur OSM
        start: { lon: -1.52937, lat: 46.21108 },
        via: [{ lon: -1.50665, lat: 46.20702 }, { lon: -1.47853, lat: 46.20388 }, { lon: -1.45441, lat: 46.20975 }, { lon: -1.43918, lat: 46.21507 }, { lon: -1.45655, lat: 46.2199 }, { lon: -1.47161, lat: 46.20575 }, { lon: -1.49807, lat: 46.20397 }, { lon: -1.52081, lat: 46.21068 }],
      },
      {
        routeId: 'ile-de-re-grande-boucle',
        routeName: "La grande boucle de l'île de Ré",
        routeNameEn: "Île de Ré grand loop",
        // parcours public Garmin Connect (#523954254) : points de passage tous les ~2,5 km, route reconstruite sur OSM
        start: { lon: -1.43998, lat: 46.22103 },
        via: [{ lon: -1.41807, lat: 46.22635 }, { lon: -1.43722, lat: 46.21704 }, { lon: -1.43209, lat: 46.20493 }, { lon: -1.43982, lat: 46.19609 }, { lon: -1.46687, lat: 46.20394 }, { lon: -1.4926, lat: 46.19799 }, { lon: -1.51674, lat: 46.20492 }, { lon: -1.53161, lat: 46.22171 }, { lon: -1.54983, lat: 46.23158 }, { lon: -1.54877, lat: 46.24243 }, { lon: -1.51867, lat: 46.24708 }, { lon: -1.49182, lat: 46.25286 }, { lon: -1.49925, lat: 46.2456 }, { lon: -1.51839, lat: 46.23298 }, { lon: -1.52469, lat: 46.22273 }, { lon: -1.50547, lat: 46.20645 }, { lon: -1.47707, lat: 46.2043 }, { lon: -1.4608, lat: 46.21541 }],
      },
      {
        routeId: 'autour-du-bois-plage-en-re',
        routeName: "Autour du Bois-Plage-en-Ré",
        routeNameEn: "Around Le Bois-Plage-en-Ré",
        // parcours public Garmin Connect (#510710761) : points de passage tous les ~2,5 km, route reconstruite sur OSM
        start: { lon: -1.41093, lat: 46.18946 },
        via: [{ lon: -1.43488, lat: 46.20282 }, { lon: -1.46455, lat: 46.21068 }, { lon: -1.48828, lat: 46.2011 }, { lon: -1.51493, lat: 46.20921 }, { lon: -1.51828, lat: 46.21609 }, { lon: -1.5339, lat: 46.23081 }, { lon: -1.55154, lat: 46.24286 }, { lon: -1.53583, lat: 46.24313 }, { lon: -1.50513, lat: 46.24764 }, { lon: -1.48455, lat: 46.23897 }, { lon: -1.48646, lat: 46.24635 }, { lon: -1.51787, lat: 46.24733 }, { lon: -1.54413, lat: 46.23899 }, { lon: -1.53052, lat: 46.22586 }, { lon: -1.51165, lat: 46.20943 }, { lon: -1.4841, lat: 46.20212 }, { lon: -1.46019, lat: 46.2112 }, { lon: -1.43924, lat: 46.21325 }, { lon: -1.44086, lat: 46.21901 }, { lon: -1.44035, lat: 46.205 }, { lon: -1.41706, lat: 46.19403 }, { lon: -1.41121, lat: 46.19399 }],
      },
    ],
  },
  roubaix: {
    kind: 'open',
    id: 'roubaix',
    name: "Paris–Roubaix — Trouée d'Arenberg",
    region: 'Nord · Pévèle',
    // secteurs pavés de Paris–Roubaix dans l'ordre de la course : Haveluy, Arenberg, Hélesmes, Wandignies, Brillon, Sars, Orchies
    originL93: { x: 727000, y: 7034000 },
    corridorTiles: { txMin: -7, txMax: 5, tzMin: -7, tzMax: 7 },
    start: { lon: 3.3926, lat: 50.3747 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 20000, resM: 100 },
    tours: [
      {
        routeId: 'secteurs-paves',
        routeName: "Les secteurs pavés d'Arenberg à Orchies",
        routeNameEn: 'The cobbled sectors from Arenberg to Orchies',
        // la Trouée d'Arenberg se rejoint par des pistes forestières
        allowTracks: true,
        // bouts de chaque secteur dans le sens de la course (pavés : surface=sett, la Trouée est une piste)
        start: { lon: 3.3926, lat: 50.3747 },
        via: [{ lon: 3.35826, lat: 50.35711 }, { lon: 3.37274, lat: 50.35509 }, { lon: 3.42386, lat: 50.38842 }, { lon: 3.40621, lat: 50.40541 }, { lon: 3.39573, lat: 50.35316 }, { lon: 3.37498, lat: 50.3547 }, { lon: 3.31675, lat: 50.36883 }, { lon: 3.31681, lat: 50.38769 }, { lon: 3.31564, lat: 50.39356 }, { lon: 3.32054, lat: 50.42112 }, { lon: 3.32505, lat: 50.42956 }, { lon: 3.33538, lat: 50.43885 }, { lon: 3.33858, lat: 50.43509 }, { lon: 3.3521, lat: 50.4347 }, { lon: 3.35962, lat: 50.43811 }, { lon: 3.3169, lat: 50.4335 }, { lon: 3.31675, lat: 50.44521 }, { lon: 3.3214, lat: 50.44634 }],
      },
    ],
  },
  montmartre: {
    kind: 'open',
    id: 'montmartre',
    name: 'Paris — Montmartre',
    region: 'Paris · Butte Montmartre',
    // la butte de la course olympique 2024 : rue Lepic, rue Norvins, rue Caulaincourt
    originL93: { x: 652000, y: 6866000 },
    corridorTiles: { txMin: -3, txMax: 1, tzMin: -2, tzMax: 2 },
    start: { lon: 2.3324, lat: 48.8838 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 20000, resM: 100 },
    tours: [
      {
        routeId: 'butte-montmartre',
        routeName: 'La butte Montmartre par la rue Lepic',
        routeNameEn: 'Montmartre hill via rue Lepic',
        climbNames: ['Rue Lepic'],
        start: { lon: 2.3324, lat: 48.8838 },
        via: [{ lon: 2.336, lat: 48.887 }, { lon: 2.3405, lat: 48.8865 }, { lon: 2.3427, lat: 48.8895 }, { lon: 2.337, lat: 48.8895 }, { lon: 2.3275, lat: 48.8834 }],
      },
    ],
  },
  tourmalet: {
    kind: 'open',
    id: 'tourmalet',
    name: 'Col du Tourmalet',
    region: 'Hautes-Pyrénées · Bigorre',
    // les deux versants : Luz-Saint-Sauveur et Barèges à l'ouest, La Mongie et Sainte-Marie-de-Campan à l'est
    originL93: { x: 464000, y: 6208000 },
    corridorTiles: { txMin: -12, txMax: 10, tzMin: -8, tzMax: 8 },
    start: { lon: -0.0035, lat: 42.8726 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 45000, resM: 100 },
    tours: [
      {
        routeId: 'tourmalet-luz',
        routeName: 'Le Tourmalet par Luz-Saint-Sauveur',
        routeNameEn: 'Tourmalet from Luz-Saint-Sauveur',
        // montée et descente par la même route (col sans autre issue vers l'ouest)
        climbNames: ['Col du Tourmalet'],
        start: 'Luz-Saint-Sauveur',
        via: [{ lon: 0.14533, lat: 42.90886 }],
      },
      {
        routeId: 'tourmalet-sainte-marie',
        routeName: 'Le Tourmalet par Sainte-Marie-de-Campan',
        routeNameEn: 'Tourmalet from Sainte-Marie-de-Campan',
        climbNames: ['Col du Tourmalet'],
        start: { lon: 0.2256, lat: 42.9838 },
        via: [{ lon: 0.14533, lat: 42.90886 }],
      },
    ],
  },
  basque: {
    kind: 'open',
    id: 'basque',
    name: 'Pays basque — Corniche',
    region: 'Pyrénées-Atlantiques · Côte basque',
    // corniche d'Urrugne (D912) de Ciboure vers Hendaye, Ascain et la Rhune ; emprise à l'est de la Bidassoa (pas de relief IGN en Espagne)
    originL93: { x: 322000, y: 6266000 },
    corridorTiles: { txMin: -8, txMax: 7, tzMin: -5, tzMax: 5 },
    start: { lon: -1.6634, lat: 43.3887 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 30000, resM: 100 },
    sea: true,
    tours: [
      {
        routeId: 'corniche-basque',
        routeName: 'La corniche basque par Ciboure, Urrugne et Ascain',
        routeNameEn: 'Basque corniche via Ciboure, Urrugne and Ascain',
        start: 'Saint-Jean-de-Luz',
        via: ['Ciboure', { lon: -1.705, lat: 43.385 }, { lon: -1.735, lat: 43.378 }, 'Urrugne', { lon: -1.6206, lat: 43.3467 }],
      },
    ],
  },
  annecy: {
    kind: 'open',
    id: 'annecy',
    name: "Lac d'Annecy",
    region: 'Haute-Savoie · Bornes-Aravis',
    // tour du lac par Sevrier, Duingt, Doussard, Talloires, Menthon-Saint-Bernard et Veyrier-du-Lac
    originL93: { x: 948000, y: 6532000 },
    corridorTiles: { txMin: -8, txMax: 6, tzMin: -9, tzMax: 8 },
    start: { lon: 6.1294, lat: 45.8992 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 45000, resM: 100 },
    tours: [
      {
        routeId: 'tour-du-lac-annecy',
        routeName: "Le tour du lac d'Annecy",
        routeNameEn: 'Lake Annecy loop',
        start: { lon: 6.1294, lat: 45.8992 },
        via: ['Sevrier', 'Duingt', 'Doussard', 'Talloires', 'Menthon-Saint-Bernard', 'Veyrier-du-Lac'],
      },
    ],
  },
  fontainebleau: {
    kind: 'open',
    id: 'fontainebleau',
    name: 'Forêt de Fontainebleau',
    region: 'Seine-et-Marne · Gâtinais',
    // routes forestières, Barbizon et Arbonne-la-Forêt, la Seine à Samois
    originL93: { x: 675000, y: 6813000 },
    corridorTiles: { txMin: -9, txMax: 7, tzMin: -6, tzMax: 6 },
    start: { lon: 2.7003, lat: 48.4044 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 20000, resM: 100 },
    tours: [
      {
        routeId: 'foret-de-fontainebleau',
        routeName: 'La forêt de Fontainebleau par Barbizon et Arbonne',
        routeNameEn: 'Fontainebleau forest via Barbizon and Arbonne',
        start: 'Fontainebleau',
        via: ['Barbizon', 'Arbonne-la-Forêt', 'Samois-sur-Seine'],
      },
    ],
  },
  'saint-cloud': {
    kind: 'open',
    id: 'saint-cloud',
    name: 'Saint-Cloud — Marly',
    region: 'Hauts-de-Seine · Yvelines',
    // parc de Saint-Cloud, Vaucresson, forêt de Marly, Bougival et la côte de la Jonchère ; voisine de Longchamp et de Meudon
    originL93: { x: 638000, y: 6862000 },
    corridorTiles: { txMin: -6, txMax: 5, tzMin: -4, tzMax: 3 },
    start: { lon: 2.2194, lat: 48.8443 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 20000, resM: 100 },
    tours: [
      {
        routeId: 'saint-cloud-marly',
        routeName: 'De Saint-Cloud à Marly par la côte de la Jonchère',
        routeNameEn: 'Saint-Cloud to Marly via the Jonchère climb',
        start: 'Saint-Cloud',
        via: ['Garches', 'Vaucresson', 'Marly-le-Roi', 'Louveciennes', 'Bougival', 'Rueil-Malmaison'],
      },
    ],
  },
  'cote-de-nuits': {
    kind: 'open',
    id: 'cote-de-nuits',
    name: 'Côte de Nuits — Grands crus',
    region: "Côte-d'Or · Bourgogne",
    // route des Grands Crus (Gevrey-Chambertin, Vougeot, Vosne-Romanée, Nuits-Saint-Georges), retour par les Hautes-Côtes
    originL93: { x: 848000, y: 6678000 },
    corridorTiles: { txMin: -6, txMax: 5, tzMin: -7, tzMax: 7 },
    start: { lon: 4.9681, lat: 47.2264 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 30000, resM: 100 },
    tours: [
      {
        routeId: 'route-des-grands-crus',
        routeName: 'La route des Grands Crus et les Hautes-Côtes',
        routeNameEn: 'The Grands Crus road and the Hautes-Côtes',
        start: 'Gevrey-Chambertin',
        via: ['Morey-Saint-Denis', 'Chambolle-Musigny', 'Vougeot', 'Vosne-Romanée', 'Nuits-Saint-Georges', 'Villars-Fontaine', 'Reulle-Vergy', 'Curley', 'Chambœuf'],
      },
    ],
  },
  alsace: {
    kind: 'open',
    id: 'alsace',
    name: "Route des vins d'Alsace",
    region: 'Haut-Rhin · Vignoble',
    // villages du vignoble entre Ribeauvillé et Kaysersberg (Riquewihr, Hunawihr, Zellenberg, Sigolsheim)
    originL93: { x: 1020000, y: 6794000 },
    corridorTiles: { txMin: -6, txMax: 4, tzMin: -5, tzMax: 5 },
    start: { lon: 7.2981, lat: 48.1665 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 45000, resM: 100 },
    tours: [
      {
        routeId: 'route-des-vins',
        routeName: 'La route des vins de Riquewihr à Kaysersberg',
        routeNameEn: 'The wine road from Riquewihr to Kaysersberg',
        start: 'Riquewihr',
        via: ['Hunawihr', 'Ribeauvillé', 'Zellenberg', 'Beblenheim', 'Mittelwihr', 'Bennwihr', 'Sigolsheim', 'Kientzheim', 'Kaysersberg'],
      },
    ],
  },
  puys: {
    kind: 'open',
    id: 'puys',
    name: 'Chaîne des Puys',
    region: 'Puy-de-Dôme · Volcans',
    // circuit vélo « La boucle des Dômes » du Département (relation OSM 9298890, 83 km) : Orcines, Mazaye, Saint-Ours
    originL93: { x: 694000, y: 6525000 },
    // 20 × 20 km : E 684–704 km, N 6 515–6 535 km
    corridorTiles: { txMin: -10, txMax: 9, tzMin: -10, tzMax: 9 },
    start: { lon: 2.81743, lat: 45.86641 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 45000, resM: 100 },
    tours: [
      {
        // points relevés sur le circuit balisé (tous les ≈ 7 km, dans l'ordre)
        routeId: 'boucle-des-domes',
        routeName: 'La boucle des Dômes par Orcines et Saint-Ours',
        routeNameEn: 'The Dômes loop via Orcines and Saint-Ours',
        start: { lon: 2.81743, lat: 45.86641 },
        via: [{ lon: 2.83706, lat: 45.89544 }, { lon: 2.89221, lat: 45.86969 }, { lon: 2.89025, lat: 45.82844 }, { lon: 2.88216, lat: 45.7862 }, { lon: 2.94478, lat: 45.81045 }, { lon: 3.00957, lat: 45.80739 }, { lon: 3.0096, lat: 45.77327 }, { lon: 2.93365, lat: 45.76392 }, { lon: 2.86577, lat: 45.74867 }, { lon: 2.84285, lat: 45.78763 }, { lon: 2.8543, lat: 45.8434 }],
      },
    ],
  },
  issoire: {
    kind: 'open',
    id: 'issoire',
    name: "Val d'Allier — Issoire",
    region: "Puy-de-Dôme · Val d'Allier",
    // circuit vélo « Châteaux et villages au pays de la reine Margot » (relation OSM 9288365, 62 km) : Usson, Sauxillanges
    originL93: { x: 731000, y: 6491000 },
    // 18 × 10 km : E 722–740 km, N 6 486–6 496 km
    corridorTiles: { txMin: -9, txMax: 8, tzMin: -5, tzMax: 4 },
    start: { lon: 3.29166, lat: 45.52324 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 45000, resM: 100 },
    tours: [
      {
        // points relevés sur le circuit balisé (tous les ≈ 7 km, dans l'ordre)
        routeId: 'pays-de-la-reine-margot',
        routeName: 'Usson et Sauxillanges, au pays de la reine Margot',
        routeNameEn: 'Usson and Sauxillanges, Queen Margot country',
        start: { lon: 3.29166, lat: 45.52324 },
        via: [{ lon: 3.33952, lat: 45.52297 }, { lon: 3.38277, lat: 45.55248 }, { lon: 3.44739, lat: 45.55565 }, { lon: 3.49606, lat: 45.54257 }, { lon: 3.46706, lat: 45.50026 }, { lon: 3.43041, lat: 45.49956 }, { lon: 3.3852, lat: 45.50619 }, { lon: 3.33723, lat: 45.48716 }],
      },
    ],
  },
  sancy: {
    kind: 'open',
    id: 'sancy',
    name: 'Massif du Sancy',
    region: 'Puy-de-Dôme · Monts Dore',
    // circuits vélo « Tour du Sancy » (relation OSM 9256766, 78 km) et « La vallée de Chaudefour » (relation OSM 20370189, 38 km)
    originL93: { x: 686000, y: 6491000 },
    // 22 × 15 km : E 675–697 km, N 6 484–6 499 km
    corridorTiles: { txMin: -11, txMax: 10, tzMin: -8, tzMax: 6 },
    start: { lon: 2.79246, lat: 45.57967 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 45000, resM: 100 },
    tours: [
      {
        // points relevés sur le circuit balisé (tous les ≈ 7 km, dans l'ordre)
        routeId: 'tour-du-sancy',
        routeName: "Le tour du Sancy par La Tour-d'Auvergne et Besse",
        routeNameEn: "Sancy loop via La Tour-d'Auvergne and Besse",
        start: { lon: 2.79246, lat: 45.57967 },
        via: [{ lon: 2.75025, lat: 45.55761 }, { lon: 2.69341, lat: 45.53459 }, { lon: 2.72165, lat: 45.4905 }, { lon: 2.77884, lat: 45.46129 }, { lon: 2.85583, lat: 45.47633 }, { lon: 2.90037, lat: 45.48681 }, { lon: 2.92847, lat: 45.51512 }, { lon: 2.90017, lat: 45.54658 }, { lon: 2.87332, lat: 45.55967 }, { lon: 2.82011, lat: 45.57062 }],
      },
      {
        // points relevés sur le circuit balisé
        routeId: 'vallee-de-chaudefour',
        routeName: 'La vallée de Chaudefour par Murol',
        routeNameEn: 'Chaudefour valley via Murol',
        start: { lon: 2.92806, lat: 45.57444 },
        via: [{ lon: 2.8701, lat: 45.55575 }, { lon: 2.91587, lat: 45.5404 }],
      },
      {
        routeId: 'autour-du-mont-dore',
        routeName: "Autour du Mont-Dore",
        routeNameEn: "Around Le Mont-Dore",
        // parcours public Garmin Connect (#524424271) : points de passage tous les ~2,5 km, route reconstruite sur OSM
        start: { lon: 2.80926, lat: 45.57279 },
        via: [{ lon: 2.81218, lat: 45.58 }, { lon: 2.82176, lat: 45.56912 }, { lon: 2.84473, lat: 45.55856 }, { lon: 2.86376, lat: 45.56077 }, { lon: 2.86685, lat: 45.55155 }, { lon: 2.86591, lat: 45.54256 }, { lon: 2.89299, lat: 45.54771 }, { lon: 2.91688, lat: 45.53945 }, { lon: 2.93064, lat: 45.52836 }, { lon: 2.92996, lat: 45.51378 }, { lon: 2.94225, lat: 45.52129 }, { lon: 2.94494, lat: 45.54054 }, { lon: 2.94275, lat: 45.55262 }, { lon: 2.94597, lat: 45.56989 }, { lon: 2.92138, lat: 45.57326 }, { lon: 2.89874, lat: 45.57185 }, { lon: 2.88372, lat: 45.57721 }, { lon: 2.88924, lat: 45.5866 }, { lon: 2.86559, lat: 45.59043 }],
      },
      {
        routeId: 'autour-de-chambon-sur-lac',
        routeName: "Autour de Chambon-sur-Lac",
        routeNameEn: "Around Chambon-sur-Lac",
        // parcours public Garmin Connect (#525243050) : points de passage tous les ~2,5 km, route reconstruite sur OSM
        start: { lon: 2.82694, lat: 45.59035 },
        via: [{ lon: 2.80513, lat: 45.58688 }, { lon: 2.81322, lat: 45.56788 }, { lon: 2.81745, lat: 45.57563 }, { lon: 2.82731, lat: 45.56452 }, { lon: 2.85067, lat: 45.5581 }, { lon: 2.8672, lat: 45.56236 }, { lon: 2.88894, lat: 45.56835 }, { lon: 2.8945, lat: 45.57401 }, { lon: 2.92137, lat: 45.57327 }, { lon: 2.92465, lat: 45.57365 }],
      },
    ],
  },
  limagne: {
    kind: 'open',
    id: 'limagne',
    name: 'Limagne — Neuville',
    region: 'Puy-de-Dôme · Limagne',
    // Neuville (63160), en bordure de la plaine de la Limagne, au pied du Livradois
    originL93: { x: 733000, y: 6516000 },
    // 7 × 7 km : E 729–736 km, N 6 512–6 519 km (Glaine-Montaigut, Neuville, Bongheat, Égliseneuve-près-Billom)
    corridorTiles: { txMin: -4, txMax: 2, tzMin: -3, tzMax: 3 },
    start: { lon: 3.4364, lat: 45.7453 },
    orthoPx: 1024,
    // toute l'emprise : arbres et haies LiDAR HD, bâtiments (hauteurs, toits) et voies BD TOPO
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    // Chaîne des Puys (Puy de Dôme à 31 km à l'ouest), Livradois et Forez à l'est
    horizon: { halfSizeM: 45000, resM: 100 },
    tours: [
      {
        routeId: 'tour-de-neuville',
        routeName: 'Tour de Neuville',
        routeNameEn: 'Neuville loop',
        start: 'Neuville',
        via: ['Glaine', 'Égliseneuve-près-Billom', 'Bongheat'],
      },
    ],
  },
  billom: {
    kind: 'open',
    id: 'billom',
    name: 'Limagne — Billom',
    region: 'Puy-de-Dôme · Limagne',
    // Billom (63160), cité médiévale au bord de la Limagne, et les liaisons balisées de la « Boucle
    // billomoise » vers l'Allier (Pont-du-Château, Cournon, Mur-sur-Allier, Pérignat)
    originL93: { x: 722000, y: 6515000 },
    // 15 × 15 km : E 714–729 km, N 6 508–6 523 km
    corridorTiles: { txMin: -8, txMax: 6, tzMin: -8, tzMax: 6 },
    start: { lon: 3.3287, lat: 45.7272 },
    orthoPx: 1024,
    // toute l'emprise : arbres et haies LiDAR HD, bâtiments (hauteurs, toits) et voies BD TOPO
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    // Chaîne des Puys à l'ouest, Livradois et Forez à l'est
    horizon: { halfSizeM: 45000, resM: 100 },
    tours: [
      {
        routeId: 'tour-de-billom',
        routeName: 'Boucle de Billom par Saint-Julien-de-Coppel et Montmorin',
        routeNameEn: 'Billom loop via Saint-Julien-de-Coppel and Montmorin',
        start: 'Billom',
        via: ['Saint-Julien-de-Coppel', 'Montmorin', 'Reignat'],
      },
      {
        // « Boucle billomoise » n° 1 (balisée, Pont-du-Château – Billom, 15.7 km) : aller par le tracé balisé, retour au plus court
        routeId: 'boucle-billomoise-1',
        routeName: 'Billom – Pont-du-Château par Vertaizon',
        routeNameEn: 'Billom – Pont-du-Château via Vertaizon',
        start: { lon: 3.33002, lat: 45.72318 },
        via: [{ lon: 3.33478, lat: 45.72595 }, { lon: 3.32371, lat: 45.75799 }, { lon: 3.29349, lat: 45.78383 }, { lon: 3.25829, lat: 45.79483 }],
      },
      {
        // « Boucle billomoise » n° 2 (balisée, Cournon – Billom, 14.5 km) : aller par le tracé balisé, retour au plus court
        routeId: 'boucle-billomoise-2',
        routeName: 'Billom – Le Cendre par Pérignat-sur-Allier',
        routeNameEn: 'Billom – Le Cendre via Pérignat-sur-Allier',
        start: { lon: 3.33002, lat: 45.72318 },
        via: [{ lon: 3.28788, lat: 45.7246 }, { lon: 3.24669, lat: 45.72918 }, { lon: 3.22602, lat: 45.72967 }, { lon: 3.18922, lat: 45.724 }],
      },
      {
        // « Boucle billomoise » n° 6 (balisée, Cournon – Billom, 11.7 km) : aller par le tracé balisé, retour au plus court
        routeId: 'boucle-billomoise-6',
        routeName: 'Billom – Pérignat-sur-Allier',
        routeNameEn: 'Billom – Pérignat-sur-Allier',
        start: { lon: 3.32418, lat: 45.71948 },
        via: [{ lon: 3.29285, lat: 45.73309 }, { lon: 3.25665, lat: 45.73244 }, { lon: 3.21379, lat: 45.72943 }],
      },
      {
        // « Boucle billomoise » n° 7 (balisée, Mur-sur-Allier – Billom, 12.6 km) : aller par le tracé balisé, retour au plus court
        routeId: 'boucle-billomoise-7',
        routeName: 'Billom – Mur-sur-Allier',
        routeNameEn: 'Billom – Mur-sur-Allier',
        start: { lon: 3.33478, lat: 45.72595 },
        via: [{ lon: 3.31404, lat: 45.74585 }, { lon: 3.26987, lat: 45.74168 }, { lon: 3.24054, lat: 45.74894 }],
      },
      {
        // « Boucle billomoise » n° 5 (balisée, Pérignat-sur-Allier – Chignat, 5.7 km) : aller par le tracé balisé, retour au plus court
        routeId: 'boucle-billomoise-5',
        routeName: 'Chauriat – Pérignat par Saint-Bonnet-lès-Allier',
        routeNameEn: 'Chauriat – Pérignat via Saint-Bonnet-lès-Allier',
        start: { lon: 3.27971, lat: 45.7519 },
        via: [{ lon: 3.25594, lat: 45.74144 }, { lon: 3.23069, lat: 45.72951 }],
      },
      {
        routeId: 'perignat-neuville-billom',
        routeName: "Pérignat, Neuville et Billom",
        routeNameEn: "Pérignat, Neuville and Billom",
        // parcours public Garmin Connect (#526086046) : points de passage tous les ~2,5 km, route reconstruite sur OSM
        start: { lon: 3.37272, lat: 45.73047 },
        via: [{ lon: 3.34849, lat: 45.72344 }, { lon: 3.31933, lat: 45.72751 }, { lon: 3.30122, lat: 45.74147 }, { lon: 3.28254, lat: 45.74985 }, { lon: 3.27185, lat: 45.73545 }, { lon: 3.27077, lat: 45.72193 }, { lon: 3.24291, lat: 45.72785 }, { lon: 3.23207, lat: 45.72886 }],
      },
    ],
  },  comte: {
    kind: 'open',
    id: 'comte',
    name: 'Comté — Villages et châteaux perchés',
    region: 'Puy-de-Dôme · Comté',
    // circuit vélo n° 8 du Département (« Planète Puy-de-Dôme », relation OSM 9263590, 63 km) :
    // Vic-le-Comte, Busséol, Mirefleurs, Saint-Babel… ; emprise du circuit + 0,5 à 1,5 km
    originL93: { x: 720000, y: 6507000 },
    // 16 × 15 km : E 712–728 km, N 6 499–6 514 km
    corridorTiles: { txMin: -8, txMax: 7, tzMin: -7, tzMax: 7 },
    start: { lon: 3.27196, lat: 45.71128 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 45000, resM: 100 },
    tours: [
      {
        routeId: 'circuit-de-la-comte',
        routeName: 'Les châteaux perchés de la Comté',
        routeNameEn: 'The hilltop castles of the Comté',
        // départ et points de passage relevés sur le circuit balisé (tous les ≈ 7 km, dans l'ordre)
        start: { lon: 3.27196, lat: 45.71128 },
        via: [{ lon: 3.25918, lat: 45.66884 }, { lon: 3.19488, lat: 45.6558 }, { lon: 3.19436, lat: 45.62422 }, { lon: 3.24665, lat: 45.61453 }, { lon: 3.30297, lat: 45.60013 }, { lon: 3.29532, lat: 45.63989 }, { lon: 3.32841, lat: 45.65006 }, { lon: 3.32715, lat: 45.68532 }],
      },
    ],
  },
  livradois: {
    kind: 'open',
    id: 'livradois',
    name: 'Livradois — Les châteaux du Livradois',
    region: 'Puy-de-Dôme · Livradois',
    // circuit vélo n° 4 du Département (« Planète Puy-de-Dôme », relation OSM 9266032, 78 km)
    originL93: { x: 733000, y: 6519000 },
    // 14 × 23 km : E 726–740 km, N 6 508–6 531 km
    corridorTiles: { txMin: -7, txMax: 6, tzMin: -12, tzMax: 10 },
    start: { lon: 3.41119, lat: 45.77036 },
    orthoPx: 1024,
    enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
    horizon: { halfSizeM: 45000, resM: 100 },
    tours: [
      {
        routeId: 'circuit-du-livradois',
        routeName: 'Les châteaux du Livradois',
        routeNameEn: 'The castles of the Livradois',
        start: { lon: 3.41119, lat: 45.77036 },
        via: [{ lon: 3.39563, lat: 45.75725 }, { lon: 3.36052, lat: 45.72274 }, { lon: 3.37545, lat: 45.68595 }, { lon: 3.42426, lat: 45.67975 }, { lon: 3.46726, lat: 45.71882 }, { lon: 3.49657, lat: 45.76373 }, { lon: 3.47029, lat: 45.79497 }, { lon: 3.49392, lat: 45.84224 }, { lon: 3.45267, lat: 45.85719 }, { lon: 3.38947, lat: 45.84581 }, { lon: 3.41216, lat: 45.80447 }],
      },
      {
        // « Boucle billomoise » n° 4 (balisée, Saint-Dier-d\'Auvergne – Billom, 18.1 km) : aller par le tracé balisé, retour au plus court
        routeId: 'boucle-billomoise-4',
        routeName: "Billom – Saint-Dier-d'Auvergne par Fayet-le-Château",
        routeNameEn: "Billom – Saint-Dier-d'Auvergne via Fayet-le-Château",
        start: { lon: 3.33922, lat: 45.72924 },
        via: [{ lon: 3.37622, lat: 45.71625 }, { lon: 3.40266, lat: 45.70458 }, { lon: 3.42639, lat: 45.69158 }, { lon: 3.44326, lat: 45.67787 }, { lon: 3.48125, lat: 45.67599 }],
      },
      {
        // « Boucle billomoise » n° 8 (balisée, Lezoux – Billom, 11.6 km) : aller par le tracé balisé, retour au plus court
        routeId: 'boucle-billomoise-8',
        routeName: 'Billom – Lezoux',
        routeNameEn: 'Billom – Lezoux',
        start: { lon: 3.34424, lat: 45.73393 },
        via: [{ lon: 3.35565, lat: 45.76497 }, { lon: 3.36659, lat: 45.79767 }, { lon: 3.37945, lat: 45.82821 }],
      },
    ],
  },
};

/**
 * Mondes privés (lieux personnels) : un fichier `data/private/worlds/<id>.json` par monde, même
 * forme que `WORLDS`, jamais versionné (dépôt public).
 */
export const PRIVATE_WORLDS_DIR = path.join(REPO_ROOT, 'data', 'private', 'worlds');

function privateWorlds(): Record<string, WorldConfig> {
  if (!fs.existsSync(PRIVATE_WORLDS_DIR)) return {};
  const out: Record<string, WorldConfig> = {};
  for (const f of fs.readdirSync(PRIVATE_WORLDS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const w = JSON.parse(fs.readFileSync(path.join(PRIVATE_WORLDS_DIR, f), 'utf8')) as WorldConfig;
    out[w.id] = { ...w, private: true };
  }
  return out;
}

/**
 * Zones décrites en JSON (même forme que `WORLDS`) dans `tools/terrain/zones/<id>.json`, versionnées :
 * écrites par l'outil graphique (`pnpm zone-builder`, voir docs/CONSTRUIRE_UNE_ZONE.md). Un fichier
 * de même identifiant qu'une entrée de `WORLDS` la remplace.
 */
export const ZONES_DIR = path.join(REPO_ROOT, 'tools', 'terrain', 'zones');

function fileWorlds(): Record<string, WorldConfig> {
  if (!fs.existsSync(ZONES_DIR)) return {};
  const out: Record<string, WorldConfig> = {};
  for (const f of fs.readdirSync(ZONES_DIR).sort()) {
    if (!f.endsWith('.json')) continue;
    const w = JSON.parse(fs.readFileSync(path.join(ZONES_DIR, f), 'utf8')) as WorldConfig;
    out[w.id] = w;
  }
  return out;
}

/** Tous les mondes connus : `WORLDS`, puis zones JSON (remplacent), puis mondes privés. */
export function allWorlds(): Record<string, WorldConfig> {
  return { ...WORLDS, ...fileWorlds(), ...privateWorlds() };
}

function selectWorld(): WorldConfig {
  // zone temporaire (aperçu des tours de l'outil graphique) : TERRAIN_WORLD_JSON=<fichier>
  if (process.env.TERRAIN_WORLD_JSON) return JSON.parse(fs.readFileSync(process.env.TERRAIN_WORLD_JSON, 'utf8')) as WorldConfig;
  const argv = process.argv.slice(2);
  let id = process.env.TERRAIN_WORLD ?? 'chevreuse';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--world' && argv[i + 1]) id = argv[i + 1]!;
    else if (a.startsWith('--world=')) id = a.slice('--world='.length);
  }
  const all = allWorlds();
  const w = all[id];
  if (!w) throw new Error(`Monde inconnu « ${id} » (connus : ${Object.keys(all).join(', ')})`);
  return w;
}

/** Données fines IGN du monde : les siennes, sinon la qualité standard (null si désactivées). */
export function worldEnrich(w: WorldConfig): WorldEnrich | null {
  return w.enrich === false ? null : (w.enrich ?? QUALITY.enrich);
}

/** Monde en cours de construction. */
export const WORLD: WorldConfig = selectWorld();

/** Dossier du monde ; `TERRAIN_OUT_DIR` permet de construire à côté puis de basculer d'un coup. */
export const OUT_DIR = process.env.TERRAIN_OUT_DIR ? path.resolve(process.env.TERRAIN_OUT_DIR) : path.join(REPO_ROOT, 'apps', 'client', 'public', 'worlds', WORLD.id);

export const WORLD_ID = WORLD.id;
export const WORLD_NAME = WORLD.name;

/** Origine du repère monde en Lambert-93 (multiples de 1 km). */
export const ORIGIN_L93 = WORLD.originL93;

export const TILE_SIZE_M = 1000;

/** Résolutions des grilles d'altitude par niveau de détail. */
export const LOD_HI = { id: 'hi', resM: 2, n: 500 } as const;
export const LOD_LO = { id: 'lo', resM: 8, n: 125 } as const;

/** Corridor complet en indices de tuiles. */
export const CORRIDOR_TILES = WORLD.corridorTiles;

/*
 * Monde « chevreuse » (sorties Garmin) — paramètres propres à ce monde.
 */

/**
 * Zone de recherche de la boucle du jalon 1 (Chevreuse, Saint-Rémy, Dampierre, Milon, Saint-Lambert),
 * en WGS84.
 */
export const LOOP_AREA_WGS84 = { west: 1.965, south: 48.68, east: 2.095, north: 48.745 } as const;

/** Longueur visée pour la boucle du jalon 1 (m). */
export const LOOP_LENGTH = { min: 9000, max: 12000, target: 10500 } as const;

/** Tuiles haute résolution : toutes les tuiles à moins de cette distance de la boucle principale. */
export const HI_RES_MARGIN_M = 2000;
/** … et à moins de cette distance des itinéraires secondaires (qualité standard). */
export const HI_RES_MARGIN_SECONDARY_M = QUALITY.hiMarginM;

/** Rayon d'exclusion autour des départs/arrivées des sorties Garmin (vie privée). */
export const PRIVACY_RADIUS_M = 2000;

/**
 * Itinéraires tirés des sorties Garmin : on garde le plus long morceau contigu de la partie
 * publique de chaque sortie situé à plus de RIDE_RUN_MARGIN_M du bord du monde (au moins
 * RIDE_ROUTE_MIN_M), recalé sur des voies entièrement à plus de WORLD_EDGE_MARGIN_M du bord.
 */
export const RIDE_ROUTE_MIN_M = 10000;
export const RIDE_RUN_MARGIN_M = 300;
export const WORLD_EDGE_MARGIN_M = 100;

/** Pas d'échantillonnage des itinéraires (m). */
export const ROUTE_STEP_M = 2;

export const ATTRIBUTION = [
  '© IGN — RGE ALTI® / LiDAR HD (Licence Ouverte Etalab 2.0)',
  '© les contributeurs OpenStreetMap (ODbL)',
];
export const ATTRIBUTION_ORTHO = '© IGN — BD ORTHO® (Licence Ouverte Etalab 2.0)';

export const USER_AGENT = 'AllezRobert-terrain/0.1 (jeu privé, outil hors ligne ; github.com/cparfait/allezrobert)';
