/**
 * Couleur des trains de banlieue selon la ligne qu'ils desservent (RER A à E, Transilien). Les voies OSM ne
 * portent que le nom de l'infrastructure (« Ligne de Paris-Montparnasse à Brest ») : la ligne voyageurs la plus
 * fréquente sur cette infrastructure en Île-de-France est retrouvée par mots-clés. Couleurs officielles
 * d'Île-de-France Mobilités (`colourweb_hexa`, jeu « referentiel-des-lignes », relevé le 18/11/2026).
 */

export type RailService = 'A' | 'B' | 'C' | 'D' | 'E' | 'H' | 'J' | 'K' | 'L' | 'N' | 'P' | 'R' | 'U';

export const SERVICE_COLORS: Record<RailService, number> = {
  A: 0xeb2132,
  B: 0x5091cb,
  C: 0xffcc30,
  D: 0x008b5b,
  E: 0xb94e9a,
  H: 0x84653d,
  J: 0xcec73d,
  K: 0x9b9842,
  L: 0xc4a4cc,
  N: 0x00b297,
  P: 0xf58f53,
  R: 0xf49fb3,
  U: 0xb6134c,
};

/** Ligne inconnue (sans nom, LGV, ligne hors Île-de-France) : bleu sombre neutre. */
export const DEFAULT_RAIL_COLOR = 0x1f3a80;

/** Mots-clés (nom en minuscules, sans accents), dans l'ordre : le premier qui correspond l'emporte. */
const RULES: Array<[RegExp, RailService]> = [
  [/\beole\b/, 'E'],
  [/sceaux|plaine a hirson|paris-est a charles-de-gaulle/, 'B'],
  [/invalides|austerlitz|choisy-le-roi a massy|grande ceinture|champ-de-mars|bretigny a la membrolle/, 'C'],
  [/paris-nord a paris-gare-de-lyon|paris-lyon a marseille|villeneuve-saint-georges a montargis|corbeil-essonnes a montereau|paris[- ]nord a lille/, 'D'],
  [/paris-est a mulhouse|paris-est a strasbourg et mulhouse/, 'E'],
  [/plaine a ermont/, 'H'],
  [/saint-lazare a mantes|saint-lazare au havre|saint-lazare a ermont|mantes-la-jolie a cherbourg|paris - cherbourg|st denis a dieppe/, 'J'],
  [/saint-lazare a versailles|saint-lazare a saint-germain|saint-cloud a saint-nom/, 'L'],
  [/paris a saint-germain-en-laye/, 'A'],
  [/montparnasse a brest|ouest-ceinture a chartres|saint-cyr a surdon|argentan a paris/, 'N'],
  [/noisy-le-sec a strasbourg|longueville a esternay|gretz-armainvilliers a sezanne|trilport a bazoches|flamboin-gouaix a montereau/, 'P'],
  [/moret-veneux-les-sablons a lyon/, 'R'],
];

function normalize(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Ligne voyageurs d'une voie OSM d'après son nom, ou null (LGV, voie de service, nom inconnu). */
export function railService(name: string | undefined): RailService | null {
  if (!name) return null;
  const n = normalize(name);
  if (/\(lgv\)|\blgv\b/.test(n)) return null;
  // Nom qui cite la ligne : « RER A », « RER B (B6) », « ligne B du RER », « RER B - Ligne de Sceaux;RER D - … ».
  // « ligne B du RER à Massy » d'abord : sinon « RER à » (sans accent) se lirait « RER A ».
  const rer = /\bligne\s*([a-e])\s*du\s*rer\b/.exec(n) ?? /\brer\s*([a-e])(?=\s*$|\s*[-(;])/.exec(n);
  if (rer) return (rer[1] as string).toUpperCase() as RailService;
  for (const [re, s] of RULES) if (re.test(n)) return s;
  return null;
}

/** Couleur (0xRRGGBB) des trains d'une voie OSM. */
export function railColor(name: string | undefined): number {
  const s = railService(name);
  return s ? SERVICE_COLORS[s] : DEFAULT_RAIL_COLOR;
}
