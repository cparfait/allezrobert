/**
 * Banque de phrases du directeur sportif (game/directeur.ts), enregistrées une fois pour toutes (Cartesia, même voix
 * que le coach et le speaker) dans public/voice/ds/<langue>/<clé>-<empreinte>.mp3, table ds.json (langue → clé →
 * fichier) :
 *   pnpm --filter @allezrobert/client exec tsx scripts/bake-ds-voice.ts
 * Le jeu ne synthétise plus rien pendant la course (la voix Piper de secours coûtait ≈ 8 % du processeur hors ligne,
 * mesuré le 26/11/2026) : il enchaîne des morceaux (« Attention, tu t’emballes, » « trois cent » « quarante » « watts.
 * Calme le jeu, » …). Les nombres et « watts » viennent de la banque du coach (coachLines.ts, même voix) ; ici : les
 * morceaux de phrases, « mille », les ordinaux (classement du chrono) et les prénoms et noms des coureurs IA.
 */
import { aiIdentity } from '@allezrobert/shared';
import { numberEn, numberFr, numberKeys } from './coachLines.ts';

export type Lang = 'fr' | 'en';

/** Morceaux de phrases : clé → [français, anglais]. */
const FIXED: Record<string, [string, string]> = {
  // Attaques (nom avant ou après le morceau)
  atk0: ['Attaque de', 'Attack from'],
  atk1: ['sort du groupe !', 'jumps out of the group!'],
  atk2: ['Ça bouge devant :', 'Move up front:'],
  atk2b: ['accélère.', 'goes.'],
  atk3m: ['tente sa chance !', 'tries his luck!'],
  atk3f: ['tente sa chance !', 'tries her luck!'],
  atkAnon: ['Attaque devant !', 'Attack up front!'],
  // Conseils après une attaque
  far0: ['Ne réponds pas à tout.', 'Don’t chase everything.'],
  far1m: ['Laisse-le partir, il reviendra.', 'Let him go, he’ll come back.'],
  far1f: ['Laisse-la partir, elle reviendra.', 'Let her go, she’ll come back.'],
  far2: ['Garde des forces pour la fin.', 'Save something for the end.'],
  near0: ['Pas de panique, ça va revenir.', 'Don’t panic, it’ll come back.'],
  near1: ['Reste dans les roues.', 'Stay on the wheels.'],
  near2m: ['Si tu as les jambes, prends sa roue.', 'If you have the legs, take his wheel.'],
  near2f: ['Si tu as les jambes, prends sa roue.', 'If you have the legs, take her wheel.'],
  // Défaillance
  crackM: ['a coincé, il est cramé.', 'has cracked, he’s cooked.'],
  crackF: ['a coincé, elle est cramée.', 'has cracked, she’s cooked.'],
  crackAnon: ['Un coureur a coincé devant, il est cramé.', 'A rider has cracked up front, he’s cooked.'],
  // Fin de course
  final200: ['200 mètres, à fond jusqu’à la ligne !', '200 metres, all out to the line!'],
  lastKm: ['Dernier kilomètre, vide tout ce qui reste !', 'Last kilometre, empty the tank!'],
  // Échappée, décroché
  away: ['Tu es parti !', 'You’re away!'],
  awayTail: ['d’avance. Ne te retourne pas, roule !', 'clear. Don’t look back, ride!'],
  youHave: ['Tu as', 'You have'],
  onGroup: ['sur le groupe.', 'on the group.'],
  dropped: ['Tu es décroché, accroche-toi, reviens dans les roues !', 'You’re dropped, hang on, get back on the wheels!'],
  // Allure
  overA: ['Attention, tu t’emballes,', 'Careful, you’re overdoing it,'],
  overB: ['watts. Calme le jeu,', 'watts. Ease off,'],
  overC: ['watts suffisent pour le moment.', 'watts is enough for now.'],
  underA: ['Tu peux en mettre plus, vise', 'You can push more, aim for'],
  wattsDot: ['watts.', 'watts.'],
  perfect: ['Parfait,', 'Perfect,'],
  onTarget: ['watts, reste fixé sur ta cible.', 'watts, stay on target.'],
  ttLow: ['Reste bien allongé, respire.', 'Stay low, breathe.'],
  // Contre-la-montre : intermédiaires et arrivée
  cpFirst: ['Premier temps de référence à l’intermédiaire.', 'First reference time at the checkpoint.'],
  cpFast: ['Tu es dans le meilleur temps,', 'You’re fastest,'],
  aheadOn: ['d’avance sur', 'up on'],
  aheadDot: ['d’avance.', 'up.'],
  keepGoing: ['Continue !', 'Keep going!'],
  behindOn: ['de retard sur', 'down on'],
  behindDot: ['de retard.', 'down.'],
  pushOn: ['Il faut appuyer !', 'Push on!'],
  win: ['Victoire ! Meilleur temps,', 'Win! Fastest time,'],
  youFinish: ['Tu termines', 'You finish'],
  at: ['à', 'at'],
  of: ['de', 'behind'],
  ofWinner: ['du vainqueur.', 'behind the winner.'],
  // Unités
  secondes: ['secondes', 'seconds'],
  seconde: ['seconde', 'second'],
  uneSeconde: ['une seconde', 'one second'],
  k1: ['mille', 'one thousand'],
};

/** Ordinal (2 à 99) en toutes lettres : « deuxième », « vingt et unième » ; « second », « twenty-first ». */
export function ordinalFr(n: number): string {
  if (n === 1) return 'premier';
  const w = numberFr(n);
  if (w.endsWith('quatre-vingts')) return `${w.slice(0, -1)}ième`;
  if (w.endsWith('cinq')) return `${w}uième`;
  if (w.endsWith('neuf')) return `${w.slice(0, -1)}vième`;
  if (w.endsWith('e')) return `${w.slice(0, -1)}ième`;
  return `${w}ième`;
}

export function ordinalEn(n: number): string {
  const special: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
  const w = numberEn(n);
  const parts = w.split('-');
  const last = parts.pop() as string;
  const ord = special[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...parts, ord].join('-');
}

/** Empreinte FNV-1a (clés des noms : identiques au jeu et au script d'enregistrement). */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** « GARCÍA » → « García », « DE VRIES » → « De Vries » (le nom en capitales serait épelé). */
function properCase(s: string): string {
  return s
    .toLocaleLowerCase('fr')
    .split(' ')
    .map((w) => w.charAt(0).toLocaleUpperCase('fr') + w.slice(1))
    .join(' ');
}

interface NameBank {
  firsts: Map<string, { female: boolean }>;
  lasts: Set<string>;
}
let names: NameBank | null = null;
/** Tous les prénoms et noms que peut porter un coureur IA (aiIdentity : tirage sans hasard à partir du rang). */
function nameBank(): NameBank {
  if (names) return names;
  const firsts = new Map<string, { female: boolean }>();
  const lasts = new Set<string>();
  // Rangs utilisés par le peloton : i + (tirage % 997), i < nombre de coureurs ; 4 096 couvre large (motif périodique).
  for (let k = 0; k < 4096; k++) {
    for (const female of [false, true]) {
      const { name } = aiIdentity(k, female);
      const i = name.indexOf(' ');
      firsts.set(name.slice(0, i), { female });
      lasts.add(name.slice(i + 1));
    }
  }
  return (names = { firsts, lasts });
}

/** Morceaux d'un nom de coureur IA (« Prénom NOM ») et son genre ; null pour un nom hors de la banque. */
export function nameKeys(name: string): { keys: string[]; female: boolean } | null {
  const i = name.indexOf(' ');
  if (i < 0) return null;
  const bank = nameBank();
  const first = bank.firsts.get(name.slice(0, i));
  const last = name.slice(i + 1);
  if (!first || !bank.lasts.has(last)) return null;
  return { keys: [`fn-${fnv(name.slice(0, i))}`, `ln-${fnv(last)}`], female: first.female };
}

/** Nombre entier (0 à 1 999) : morceaux de la banque du coach, « mille » de celle-ci. */
export function dsNumberKeys(value: number): string[] {
  const n = Math.max(0, Math.min(1999, Math.round(value)));
  if (n < 1000) return numberKeys(n);
  return n === 1000 ? ['k1'] : ['k1', ...numberKeys(n - 1000)];
}

/** « 12 secondes », « une seconde ». */
export function secondsKeys(value: number, lang: Lang): string[] {
  const n = Math.max(0, Math.round(value));
  if (n === 1) return ['uneSeconde'];
  if (n === 0 && lang === 'fr') return ['n0', 'seconde'];
  return [...dsNumberKeys(n), 'secondes'];
}

/** Ordinal d'un classement : `o2` à `o99` (au-delà : le nombre). */
export function ordinalKeys(rank: number): string[] {
  const n = Math.round(rank);
  return n >= 1 && n <= 99 ? [`o${n}`] : dsNumberKeys(n);
}

/** Toutes les phrases d'une langue : clé → texte prononcé. */
export function dsLines(lang: Lang): Record<string, string> {
  const i = lang === 'fr' ? 0 : 1;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(FIXED)) out[k] = v[i];
  for (let n = 1; n <= 99; n++) out[`o${n}`] = lang === 'fr' ? ordinalFr(n) : ordinalEn(n);
  const bank = nameBank();
  for (const f of bank.firsts.keys()) out[`fn-${fnv(f)}`] = f;
  for (const l of bank.lasts) out[`ln-${fnv(l)}`] = properCase(l);
  return out;
}
