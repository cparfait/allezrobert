/**
 * Point d'entrée sans dépendance navigateur ni bundler (serveur, scripts Node, tests) :
 * catalogue, textes, assemblage, données du résumé.
 */
export * from './catalog.ts';
export { assembleComposition } from './assemble.ts';
export type { AssembleOptions, SharedAssets } from './assemble.ts';
export { summaryVariablesFromRide, normalizedPower, elevationGain, seasonOf, downsample } from './summary-data.ts';
export type { RideSummaryInput, RideRecordLike } from './summary-data.ts';
export { STRINGS, LANGS, t } from './strings.ts';
export type { Lang, StringKey } from './strings.ts';
