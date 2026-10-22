/**
 * Textes des séquences, en français (langue par défaut) et en anglais.
 *
 * Source unique : ce module. `scripts/sync-assets.ts` le sérialise en
 * `compositions/<nom>/assets/strings.js` (window.__AR_STRINGS) pour la CLI HyperFrames, et
 * l'assembleur navigateur (src/assemble.ts) l'injecte directement dans le document du lecteur.
 * Côté composition, `AR.t('cle')` lit la langue de la variable `lang`.
 */
export const STRINGS = {
  fr: {
    // Saisons
    'season.printemps': 'Printemps',
    'season.ete': 'Été',
    'season.automne': 'Automne',
    'season.hiver': 'Hiver',
    // Types de sortie
    'ride.free': 'Sortie libre',
    'ride.group': 'Sortie de groupe',
    'ride.race': 'Course',
    'ride.workout': 'Entraînement',
    'ride.ftpTest': 'Test FTP',
    'ride.open': 'Monde ouvert',
    // Intro
    'intro.distance': 'Distance',
    'intro.elevation': 'Dénivelé +',
    'intro.riders': 'Coureurs',
    'intro.start': 'Départ',
    'intro.finish': 'Arrivée',
    'intro.go': 'Allez !',
    'intro.ready': 'Prêts ?',
    // Segments
    'seg.kom': 'Grimpeur · KOM',
    'seg.sprint': 'Sprint',
    'seg.time': 'Temps',
    'seg.rank': 'Rang',
    'seg.pr': 'Record perso',
    'seg.of': 'sur',
    'seg.best': 'Meilleur temps',
    'seg.behind': 'du meilleur temps',
    'seg.provisional': 'Classement provisoire',
    // Arrivée / podium
    'podium.finish': 'Arrivée',
    'podium.winner': 'Vainqueur',
    'podium.title': 'Podium',
    // Habillage TV
    'tv.live': 'En direct',
    'tv.gaps': 'Écarts',
    'tv.position': 'Position',
    'tv.breakaway': 'Échappée',
    'tv.peloton': 'Peloton',
    'tv.chasers': 'Poursuivants',
    'tv.gruppetto': 'Gruppetto',
    'tv.leader': 'Tête de course',
    'tv.riders': 'coureurs',
    'tv.rider': 'coureur',
    // Résumé
    'sum.kicker': 'Résumé de la sortie',
    'sum.route': 'Le parcours',
    'sum.profile': 'Profil',
    'sum.stats': 'Les chiffres',
    'sum.distance': 'Distance',
    'sum.time': 'Temps',
    'sum.avgPower': 'Puissance moy.',
    'sum.np': 'Puiss. normalisée',
    'sum.elevation': 'Dénivelé +',
    'sum.calories': 'Calories',
    'sum.avgSpeed': 'Vitesse moy.',
    'sum.leaderboard': 'Classement',
    'sum.highlights': 'Meilleurs moments',
    'sum.outro': 'À la prochaine !',
    'sum.you': 'toi',
  },
  en: {
    'season.printemps': 'Spring',
    'season.ete': 'Summer',
    'season.automne': 'Autumn',
    'season.hiver': 'Winter',
    'ride.free': 'Free ride',
    'ride.group': 'Group ride',
    'ride.race': 'Race',
    'ride.workout': 'Workout',
    'ride.ftpTest': 'FTP test',
    'ride.open': 'Open world',
    'intro.distance': 'Distance',
    'intro.elevation': 'Elevation gain',
    'intro.riders': 'Riders',
    'intro.start': 'Start',
    'intro.finish': 'Finish',
    'intro.go': 'Go!',
    'intro.ready': 'Ready?',
    'seg.kom': 'KOM · Climb',
    'seg.sprint': 'Sprint',
    'seg.time': 'Time',
    'seg.rank': 'Rank',
    'seg.pr': 'Personal record',
    'seg.of': 'of',
    'seg.best': 'Fastest time',
    'seg.behind': 'behind fastest',
    'seg.provisional': 'Provisional ranking',
    'podium.finish': 'Finish',
    'podium.winner': 'Winner',
    'podium.title': 'Podium',
    'tv.live': 'Live',
    'tv.gaps': 'Gaps',
    'tv.position': 'Position',
    'tv.breakaway': 'Breakaway',
    'tv.peloton': 'Peloton',
    'tv.chasers': 'Chasers',
    'tv.gruppetto': 'Gruppetto',
    'tv.leader': 'Race leaders',
    'tv.riders': 'riders',
    'tv.rider': 'rider',
    'sum.kicker': 'Ride summary',
    'sum.route': 'The route',
    'sum.profile': 'Profile',
    'sum.stats': 'The numbers',
    'sum.distance': 'Distance',
    'sum.time': 'Time',
    'sum.avgPower': 'Avg power',
    'sum.np': 'Normalized power',
    'sum.elevation': 'Elevation gain',
    'sum.calories': 'Calories',
    'sum.avgSpeed': 'Avg speed',
    'sum.leaderboard': 'Leaderboard',
    'sum.highlights': 'Highlights',
    'sum.outro': 'See you next ride!',
    'sum.you': 'you',
  },
} as const;

export type Lang = keyof typeof STRINGS;
export type StringKey = keyof (typeof STRINGS)['fr'];
export const LANGS: readonly Lang[] = ['fr', 'en'];

/** Traduction côté TypeScript (mêmes clés que `AR.t` dans les compositions). */
export function t(lang: Lang, key: StringKey): string {
  return STRINGS[lang][key] ?? STRINGS.fr[key];
}
