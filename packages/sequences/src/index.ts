/**
 * @allezrobert/sequences — séquences animées HyperFrames du jeu (intro et compte à rebours,
 * KOM / sprint, arrivée et podium, habillage TV, vidéo résumé).
 *
 * Point d'entrée navigateur (Vite) : `SequencePlayer` monte <hyperframes-player> au-dessus du
 * canvas. Les modules purs (catalogue, assemblage, données du résumé, textes) sont aussi
 * exportés seuls via `@allezrobert/sequences/catalog` pour le serveur et les scripts Node.
 *
 * @example
 * const seq = new SequencePlayer(document.getElementById('app')!, { lang: 'fr' });
 * await seq.preload(['intro', 'kom', 'sprint']);
 * await seq.play('intro', { route_name: 'Boucle de la Madeleine', distance_km: 42.3,
 *   elevation_m: 612, profile: altitudes }, { onCue: (c) => c === 'go' && startRace() });
 */
export { SequencePlayer } from './player.ts';
export type { Insets, PlayOptions, PlayResult, SequencePlayerOptions } from './player.ts';
export * from './catalog.ts';
export { assembleComposition } from './assemble.ts';
export type { AssembleOptions, SharedAssets } from './assemble.ts';
export { summaryVariablesFromRide, normalizedPower, elevationGain, seasonOf } from './summary-data.ts';
export type { RideSummaryInput, RideRecordLike } from './summary-data.ts';
export { STRINGS, LANGS, t } from './strings.ts';
export type { Lang, StringKey } from './strings.ts';
