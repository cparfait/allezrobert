/**
 * Banque de phrases du coach vocal du test FTP, enregistrées une fois pour toutes (Cartesia, même voix que le
 * speaker) dans public/voice/coach/<langue>/<clé>-<empreinte>.mp3, table coach.json (langue → clé → fichier) :
 *   pnpm --filter @allezrobert/client exec tsx scripts/bake-coach-voice.ts
 * Le jeu n'appelle aucune API pendant le test : il enchaîne des morceaux (« Palier » « 4 » « 160 » « watts »).
 *
 * Contenu : phrases fixes, nombres de 0 à 99 et centaines (pour les watts), et les messages écrits des trois
 * protocoles de test (textEvents, en français seulement), retrouvés par `coachMessageKey(texte)`.
 */
import { ftpTestWorkout, FTP_TEST_PROTOCOLS, RAMP_CADENCE } from '@allezrobert/physics';

export type Lang = 'fr' | 'en';

/** Phrases fixes : clé → [français, anglais]. */
const FIXED: Record<string, [string, string]> = {
  // Morceaux
  palier: ['Palier', 'Step'],
  watts: ['watts', 'watts'],
  virgule: ['virgule', 'point'],
  wattsPerKilo: ['watts par kilo.', 'watts per kilo.'],
  that: ['soit', 'that is'],
  // Rampe
  warmupTen: ['Dix secondes, et le premier palier commence.', 'Ten seconds, then the first step starts.'],
  firstEstimate: ['Première estimation de ta FTP :', 'First estimate of your FTP:'],
  risesEachStep: ['Elle monte à chaque palier tenu.', 'It rises with every step you hold.'],
  estimatedFtp: ['FTP estimée :', 'Estimated FTP:'],
  belowTarget: ['Tu es sous la cible : relance ! Sinon, le test s’arrête dans dix secondes.', 'You are below the target: push again! Otherwise the test stops in ten seconds.'],
  fiveSeconds: ['Cinq secondes !', 'Five seconds!'],
  backOn: ['Bien, tu as raccroché !', 'Good, you are back on it!'],
  ten0: ['Dix secondes, accroche-toi.', 'Ten seconds, hang on.'],
  ten1: ['Encore dix secondes.', 'Ten more seconds.'],
  ten2: ['Tiens jusqu’au bout de la minute !', 'Hold it to the end of the minute!'],
  cadenceLow: [
    `Cadence basse : vise ${RAMP_CADENCE.low} à ${RAMP_CADENCE.high} tours par minute, ça soulage les jambes.`,
    `Low cadence: aim for ${RAMP_CADENCE.low} to ${RAMP_CADENCE.high} r p m, it saves your legs.`,
  ],
  // Test 20 min
  int0: ['Première accélération : trois fois vingt secondes, de plus en plus fort, pour réveiller les jambes.', 'First effort: three times twenty seconds, harder each time, to wake up the legs.'],
  int1: ['Deuxième accélération.', 'Second effort.'],
  int2: ['Troisième et dernière accélération.', 'Third and last effort.'],
  easy5: ['Cinq minutes faciles pour récupérer.', 'Five easy minutes to recover.'],
  ftp20Ten: ['Dix secondes avant les vingt minutes.', 'Ten seconds to the twenty minutes.'],
  avgExplain: ['Ta FTP, c’est 95 pour cent de ta moyenne sur les vingt minutes. Pour l’instant, ta moyenne :', 'Your FTP is 95 percent of your twenty-minute average. So far, your average:'],
  average: ['Moyenne :', 'Average:'],
  thusFtp: ['donc une FTP de', 'so an FTP of'],
  fadingTo: ['Tu baisses : reviens vers', 'You are fading: get back to'],
  strongStart: ['Tu pars fort : garde de la réserve pour la fin.', 'Strong start: keep something for the end.'],
  twentyDone: ['Les vingt minutes sont faites, bravo ! Moyenne :', 'The twenty minutes are done, well done! Average:'],
  easyTenResult: ['Pédale tranquillement dix minutes : le résultat s’affiche à la fin.', 'Ride easy for ten minutes: the result shows at the end.'],
  // Fin du test
  tooShortRamp: ['Fin du test. L’effort est trop court pour estimer ta FTP : il faut tenir au moins trois paliers.', 'End of the test. The effort is too short to estimate your FTP: you need to hold at least three steps.'],
  tooShort20: ['Fin du test. Il faut les vingt minutes complètes pour estimer ta FTP.', 'End of the test. The full twenty minutes are needed to estimate your FTP.'],
  endHeld: ['Fin du test : tu as tenu', 'End of the test: you held'],
  stepsDot: ['paliers.', 'steps.'],
  bestMinute: ['Ta meilleure minute :', 'Your best minute:'],
  testDone: ['Test terminé !', 'Test complete!'],
  sameFtp: ['C’est comme ton ancienne FTP.', 'Same as your previous FTP.'],
  moreWatts: ['watts de plus que ton ancienne FTP, bravo !', 'watts more than your previous FTP, well done!'],
  lessWatts: ['watts de moins que l’ancienne : un jour sans, ça arrive.', 'watts less than before: off days happen.'],
  chooseRamp: ['Choisis à l’écran si tu la gardes, et pédale tranquillement pour récupérer.', 'Choose on screen whether to keep it, and ride easy to recover.'],
  choose20: ['Choisis à l’écran si tu la gardes.', 'Choose on screen whether to keep it.'],
};

const ONES_FR = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const ONES_EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];

/** 0–99 en français (masculin, orthographe de 1990 non utilisée : « quatre-vingt-un », « soixante et onze »). */
export function numberFr(n: number): string {
  if (n < 20) return ONES_FR[n] as string;
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (t === 7 || t === 9) {
    const base = t === 7 ? 'soixante' : 'quatre-vingt';
    const rest = 10 + u;
    return t === 7 && u === 1 ? 'soixante et onze' : `${base}-${ONES_FR[rest]}`;
  }
  const tens = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', '', 'quatre-vingt'][t] as string;
  if (u === 0) return t === 8 ? 'quatre-vingts' : tens;
  if (u === 1 && t !== 8) return `${tens} et un`;
  return `${tens}-${ONES_FR[u]}`;
}

export function numberEn(n: number): string {
  if (n < 20) return ONES_EN[n] as string;
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'][Math.floor(n / 10)] as string;
  return n % 10 ? `${tens}-${ONES_EN[n % 10]}` : tens;
}

/** Centaines : `c2` « deux cent » (suivi d'un nombre), `cs2` « deux cents » (seul). */
function hundred(h: number, alone: boolean, lang: Lang): string {
  if (lang === 'en') return `${ONES_EN[h]} hundred`;
  if (h === 1) return 'cent';
  return `${ONES_FR[h]} ${alone ? 'cents' : 'cent'}`;
}

/** Clés d'un nombre entier de 0 à 999 (au-delà : borné). */
export function numberKeys(value: number): string[] {
  const n = Math.max(0, Math.min(999, Math.round(value)));
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (!h) return [`n${r}`];
  if (!r) return [h === 1 ? 'c1' : `cs${h}`];
  return [`c${h}`, `n${r}`];
}

/** « 245 watts ». */
export function wattsKeys(value: number): string[] {
  return [...numberKeys(value), 'watts'];
}

/** « 3,4 watts par kilo. » */
export function wkgKeys(value: number): string[] {
  const tenths = Math.round(Math.max(0, value) * 10);
  return [...numberKeys(Math.floor(tenths / 10)), 'virgule', `n${tenths % 10}`, 'wattsPerKilo'];
}

/** Clé d'un message écrit de séance (empreinte FNV-1a du texte, identique au jeu et au script de génération). */
export function coachMessageKey(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `msg-${h.toString(16).padStart(8, '0')}`;
}

/** Texte écrit d'une séance → texte à dire (unités en toutes lettres, intervalles, « home traineur »). */
export function ftpSpoken(text: string): string {
  return text
    .replace(/(\d+)\s*[–-]\s*(\d+)/g, '$1 à $2')
    .replace(/\+\s*(\d+)\s*W\b/g, 'plus $1 watts')
    .replace(/(\d+)\s*W\b/g, '$1 watts')
    .replace(/tr\/min/g, 'tours par minute')
    .replace(/\b1\s*min\b/g, '1 minute')
    .replace(/(\d+)\s*min\b/g, '$1 minutes')
    .replace(/(\d+)\s*s\b/g, '$1 secondes')
    .replace(/(\d+)\s*%/g, '$1 pour cent')
    .replace(/\bhome[- ]trainers\b/gi, 'home traineurs')
    .replace(/\bhome[- ]trainer\b/gi, 'home traineur');
}

/** Messages écrits des trois protocoles de test (français). */
export function ftpTestMessages(): string[] {
  const out = new Set<string>();
  for (const p of FTP_TEST_PROTOCOLS) for (const st of ftpTestWorkout(p).steps) for (const e of st.textEvents ?? []) out.add(e.message);
  return [...out];
}

/** Toutes les phrases d'une langue : clé → texte prononcé. */
export function coachLines(lang: Lang): Record<string, string> {
  const i = lang === 'fr' ? 0 : 1;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(FIXED)) out[k] = v[i];
  for (let n = 0; n < 100; n++) out[`n${n}`] = lang === 'fr' ? numberFr(n) : numberEn(n);
  for (let h = 1; h <= 9; h++) {
    out[`c${h}`] = hundred(h, false, lang);
    if (h > 1) out[`cs${h}`] = hundred(h, true, lang);
  }
  if (lang === 'fr') for (const m of ftpTestMessages()) out[coachMessageKey(m)] = ftpSpoken(m);
  return out;
}
