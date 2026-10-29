/**
 * Banque de phrases de la voix de course (générées une fois par Cartesia, `pnpm --filter @allezrobert/client
 * voice`, fichiers dans public/voice/announcer) : le jeu enchaîne des morceaux pour annoncer temps et
 * records (« Temps : » « 5 » « minutes » « 11 » « secondes »), le speaker de départ et d'arrivée, et les cris
 * du public (filtrés et superposés à la lecture, voir announcer.ts).
 *
 * Clé → texte par langue. Les nombres « n0 » à « n59 » servent aux minutes et aux secondes.
 */
export type Lang = 'fr' | 'en';

const NUMBERS_FR = ['zéro', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf', 'vingt'];

function numberFr(n: number): string {
  if (n <= 20) return NUMBERS_FR[n] as string;
  const tens = ['', '', 'vingt', 'trente', 'quarante', 'cinquante'][Math.floor(n / 10)] as string;
  const u = n % 10;
  if (u === 0) return tens;
  if (u === 1) return `${tens} et une`;
  return `${tens}-${NUMBERS_FR[u]}`;
}

function numberEn(n: number): string {
  const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  if (n < 20) return ones[n] as string;
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty'][Math.floor(n / 10)] as string;
  return n % 10 ? `${tens}-${ones[n % 10]}` : tens;
}

/** Phrases fixes : clé → [français, anglais]. */
const FIXED: Record<string, [string, string]> = {
  // Unités et liaisons des temps
  minute: ['minute', 'minute'],
  minutes: ['minutes', 'minutes'],
  seconde: ['seconde', 'second'],
  secondes: ['secondes', 'seconds'],
  et: ['et', 'and'],
  virgule: ['virgule', 'point'],
  // Segments
  komStart: ['C’est parti pour la montée, chrono lancé !', 'Here comes the climb, the clock is running!'],
  komStart2: ['Début de la côte, à toi de jouer !', 'The climb starts now, over to you!'],
  sprintStart: ['Sprint lancé, à fond !', 'Sprint is on, full gas!'],
  sprintStart2: ['C’est le sprint, tout ce que tu as !', 'Sprint time, give it everything!'],
  summit: ['Sommet !', 'Summit!'],
  sprintLine: ['Ligne !', 'Line!'],
  time: ['Ton temps :', 'Your time:'],
  newRecord: ['Nouveau record ! Bravo !', 'New record! Well done!'],
  firstTime: ['Premier passage : ton temps devient ton fantôme.', 'First attempt: your time becomes your ghost.'],
  recordBy: ['Record battu de', 'Record beaten by'],
  missedBy: ['À', 'Just'],
  missedTail: ['du record.', 'off the record.'],
  ahead: ['En avance sur ton record de', 'Ahead of your record by'],
  behind: ['En retard sur ton record de', 'Behind your record by'],
  halfway: ['Mi-parcours !', 'Halfway there!'],
  lastKm: ['Dernier kilomètre !', 'Final kilometre!'],
  // Speaker de départ et d'arrivée (voix de sono)
  welcome: ['Mesdames et messieurs, bienvenue au départ !', 'Ladies and gentlemen, welcome to the start!'],
  onTheLine: ['Les coureurs sont sur la ligne.', 'The riders are on the line.'],
  three: ['Trois !', 'Three!'],
  two: ['Deux !', 'Two!'],
  one: ['Un !', 'One!'],
  go: ['Partez !', 'Go!'],
  finish: ['Et c’est l’arrivée ! Bravo, quelle course !', 'And that’s the finish! What a ride!'],
  lap: ['Nouveau tour, on ne lâche rien !', 'New lap, keep it going!'],
  // Page de bilan (commentaire lu à l'ouverture des statistiques)
  sumGreat: ['Bravo, belle sortie !', 'Well done, great ride!'],
  sumDistance: ['Tu as parcouru', 'You covered'],
  kilometres: ['kilomètres', 'kilometres'],
  sumSpeed: ['à une moyenne de', 'at an average of'],
  kmh: ['kilomètres heure.', 'kilometres per hour.'],
  sumRecords: ['Et tu as battu des records de puissance !', 'And you set new power records!'],
  sumLevelUp: ['Niveau supérieur, félicitations !', 'Level up, congratulations!'],
  sumTrophy: ['Nouveau trophée débloqué !', 'New trophy unlocked!'],
  sumFirstTime: ['Première fois sur ce parcours.', 'First time on this route.'],
  sumFaster: ['Plus rapide que la dernière fois, tu progresses !', 'Faster than last time, you are improving!'],
  sumSlower: ['Un peu moins vite que la dernière fois, ce n’est que partie remise.', 'A bit slower than last time, you’ll get it next time.'],
  sumKom: ['Belle montée, chrono enregistré.', 'Nice climb, time saved.'],
  sumRest: ['Pense à bien récupérer. À la prochaine !', 'Remember to recover well. See you next time!'],
  // Cris du public (superposés et filtrés à la lecture)
  allez: ['Allez !', 'Come on!'],
  allezRobert: ['Allez Robert !', 'Go Robert!'],
  vasy: ['Vas-y !', 'Go go go!'],
  courage: ['Courage !', 'Keep going!'],
  allez3: ['Allez, allez, allez !', 'Go, go, go!'],
  bravo: ['Bravo !', 'Bravo!'],
  plusVite: ['Plus vite !', 'Faster!'],
  danseuse: ['En danseuse !', 'Out of the saddle!'],
};

/** Toutes les phrases d'une langue : clé → texte prononcé. */
export function announcerLines(lang: Lang): Record<string, string> {
  const i = lang === 'fr' ? 0 : 1;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(FIXED)) out[k] = v[i];
  for (let n = 0; n < 60; n++) out[`n${n}`] = lang === 'fr' ? numberFr(n) : numberEn(n);
  return out;
}

/** Cris du public tirés au hasard. */
export const CROWD_SHOUTS = ['allez', 'allezRobert', 'vasy', 'courage', 'allez3', 'bravo', 'plusVite', 'danseuse'];

/**
 * Clés d'une durée : « 56 virgule 6 secondes » sous la minute (au dixième, sans arrondir à la seconde),
 * « 5 minutes 11 » au-delà (secondes tronquées, comme un chrono).
 */
export function durationKeys(totalS: number): string[] {
  const t = Math.max(0, totalS);
  if (t < 60) {
    const tenthsTotal = Math.floor(t * 10 + 1e-6);
    const sec = Math.floor(tenthsTotal / 10);
    const tenth = tenthsTotal % 10;
    return tenth ? [`n${sec}`, 'virgule', `n${tenth}`, 'secondes'] : [`n${sec}`, sec <= 1 ? 'seconde' : 'secondes'];
  }
  const s = Math.floor(t);
  const m = Math.min(59, Math.floor(s / 60));
  const r = s % 60;
  const keys = [`n${m}`, m === 1 ? 'minute' : 'minutes'];
  if (r > 0) keys.push(`n${r}`);
  return keys;
}
