import { dsNumberKeys, nameKeys, ordinalKeys, secondsKeys } from '../audio/dsLines.ts';

/**
 * Directeur sportif (idée NCT Ride) : il parle dans l'oreillette pendant une course ou une sortie de groupe. Puissance
 * cible tirée de la FTP déclarée (« Attention, tu t'emballes, 334 W. Calme le jeu, 274 W suffisent »), attaques et
 * défaillances des IA, échappée, décroché, temps aux intermédiaires du contre-la-montre, derniers mètres.
 *
 * Module pur : il décide quoi dire et quand (phrases FR / EN), le jeu les fait dire (audio/directorVoice.ts) et les
 * affiche. Une phrase au plus toutes les `GAP_S` secondes, sauf les urgentes ; chaque sujet a son propre délai.
 */

export interface DsLine {
  fr: string;
  en: string;
  /** Passe devant les autres (attaque, derniers mètres). */
  urgent?: boolean;
  /** Morceaux enregistrés à enchaîner par langue (audio/dsLines.ts) : rien n'est synthétisé pendant la course. */
  keys?: { fr: string[]; en: string[] };
}

export interface DsInput {
  /** Puissance sur 3 s (W) et FTP déclarée (W). */
  watts3s: number;
  ftpWatts: number;
  gradePercent: number;
  /** Course contre la montre : cible plus haute, conseils d'allure constants. */
  timeTrial: boolean;
  /** Contre-la-montre : puissance tenable sur la durée prévue du chrono (peloton.ttPowerW) ; absente : 95 % de la FTP. */
  ttWatts?: number;
  /** Écart (m) au premier coureur devant (IA) ; null si personne. Écart (m) au premier derrière ; null si personne. */
  gapAheadM: number | null;
  gapBehindM: number | null;
  /** Vitesse (m/s), pour convertir les écarts en secondes. */
  speedMs: number;
  /** Distance restante (m) d'un parcours avec arrivée, null pour une boucle sans fin. */
  remainingM: number | null;
  /** Événements de cette image : IA qui viennent d'attaquer, IA qui viennent de craquer (noms). */
  attacks: readonly string[];
  cracks: readonly string[];
}

/**
 * Puissance cible (W). Contre-la-montre : ce qu'on tient sur la durée du chrono (`ttWatts`, de 95 % de la FTP pour une
 * heure à 125 % pour 5 min), 5 % de plus en côte. En peloton ≈ 80 % de la FTP (90 % en côte).
 */
export function dsTarget(ftpWatts: number, gradePercent: number, timeTrial: boolean, ttWatts?: number): number {
  const climb = gradePercent >= 4;
  const w = timeTrial ? (ttWatts ?? ftpWatts * 0.95) * (climb ? 1.05 : 1) : ftpWatts * (climb ? 0.9 : 0.8);
  return Math.round(w / 5) * 5;
}

const GAP_S = 8;
/** Mêmes morceaux dans les deux langues. */
const both = (k: string[]): { fr: string[]; en: string[] } => ({ fr: k, en: k });
/** Secondes par langue (« une seconde », « zéro seconde »). */
const secK = (n: number) => ({ fr: secondsKeys(n, 'fr'), en: secondsKeys(n, 'en') });
const join = (...parts: Array<{ fr: string[]; en: string[] }>) => ({ fr: parts.flatMap((p) => p.fr), en: parts.flatMap((p) => p.en) });
const r10 = (w: number) => Math.round(w / 10) * 10;
const secs = (m: number, v: number) => Math.round(m / Math.max(v, 3));

export class DirecteurSportif {
  private since = GAP_S;
  private readonly cool = new Map<string, number>();
  private over = 0;
  private under = 0;
  private alerted = false;
  private finalSaid = false;
  private lastKmSaid = false;
  private wasAway = false;
  private wasDropped = false;

  private ready(topic: string, coolS: number): boolean {
    return (this.cool.get(topic) ?? -Infinity) <= 0 && this.since >= GAP_S && (this.cool.set(topic, coolS), true);
  }

  /** Phrases à dire maintenant (souvent aucune). */
  update(dt: number, s: DsInput): DsLine[] {
    this.since += dt;
    for (const [k, v] of this.cool) this.cool.set(k, v - dt);
    const out: DsLine[] = [];
    const say = (l: DsLine) => {
      out.push(l);
      this.since = 0;
    };
    // Urgent : attaques et défaillances, derniers mètres (sans attendre le délai commun).
    for (const n of s.attacks) {
      if ((this.cool.get('attack') ?? -Infinity) > 0) break;
      this.cool.set('attack', 20);
      const far = s.gapAheadM === null;
      const k = Math.floor(Math.random() * 4);
      const who = nameKeys(n);
      const fem = !!who?.female;
      const fr = [`Attaque de ${n} !`, `${n} sort du groupe !`, `Ça bouge devant : ${n} accélère.`, `${n} tente sa chance !`][k];
      const en = [`Attack from ${n}!`, `${n} jumps out of the group!`, `Move up front: ${n} goes.`, `${n} tries ${fem ? 'her' : 'his'} luck!`][k];
      const fr2 = far ? ['Ne réponds pas à tout.', fem ? 'Laisse-la partir, elle reviendra.' : 'Laisse-le partir, il reviendra.', 'Garde des forces pour la fin.'] : ['Pas de panique, ça va revenir.', 'Reste dans les roues.', 'Si tu as les jambes, prends sa roue.'];
      const en2 = far ? ['Don’t chase everything.', fem ? 'Let her go, she’ll come back.' : 'Let him go, he’ll come back.', 'Save something for the end.'] : ['Don’t panic, it’ll come back.', 'Stay on the wheels.', `If you have the legs, take ${fem ? 'her' : 'his'} wheel.`];
      const j = Math.floor(Math.random() * 3);
      // Morceaux : nom hors de la banque (joueur, ami) : attaque dite sans le nom.
      const g = fem ? 'f' : 'm';
      const nk = who?.keys ?? [];
      const head = !who ? ['atkAnon'] : ([['atk0', ...nk], [...nk, 'atk1'], ['atk2', ...nk, 'atk2b'], [...nk, `atk3${g}`]][k] as string[]);
      const tail = (far ? ['far0', `far1${g}`, 'far2'] : ['near0', 'near1', `near2${g}`])[j] as string;
      say({ fr: `${fr} ${fr2[j]}`, en: `${en} ${en2[j]}`, urgent: true, keys: both([...head, tail]) });
    }
    for (const n of s.cracks) {
      if ((this.cool.get('crack') ?? -Infinity) > 0) break;
      this.cool.set('crack', 30);
      const who = nameKeys(n);
      const fem = !!who?.female;
      say({
        fr: `${n} a coincé, ${fem ? 'elle est cramée' : 'il est cramé'}.`,
        en: `${n} has cracked, ${fem ? 'she’s' : 'he’s'} cooked.`,
        urgent: true,
        keys: both(who ? [...who.keys, fem ? 'crackF' : 'crackM'] : ['crackAnon']),
      });
    }
    if (s.remainingM !== null && s.remainingM < 220 && s.remainingM > 0 && !this.finalSaid) {
      this.finalSaid = true;
      say({ fr: '200 mètres, à fond jusqu’à la ligne !', en: '200 metres, all out to the line!', urgent: true, keys: both(['final200']) });
    }
    if (s.remainingM !== null && s.remainingM < 1000 && s.remainingM > 900 && !this.lastKmSaid) {
      this.lastKmSaid = true;
      say({ fr: 'Dernier kilomètre, vide tout ce qui reste !', en: 'Last kilometre, empty the tank!', urgent: true, keys: both(['lastKm']) });
    }
    // Échappée / décroché : changement d'état seulement.
    const away = s.gapAheadM === null && s.gapBehindM !== null && s.gapBehindM > 25;
    const dropped = s.gapAheadM !== null && s.gapAheadM > 30 && !s.timeTrial;
    if (away && !this.wasAway && this.ready('away', 40)) {
      const t = secs(s.gapBehindM ?? 0, s.speedMs);
      say({ fr: `Tu es parti ! ${t} secondes d’avance. Ne te retourne pas, roule !`, en: `You’re away! ${t} seconds clear. Don’t look back, ride!`, keys: join(both(['away']), secK(t), both(['awayTail'])) });
    } else if (away && this.ready('awayGap', 60)) {
      const t = secs(s.gapBehindM ?? 0, s.speedMs);
      say({ fr: `Tu as ${t} secondes sur le groupe.`, en: `You have ${t} seconds on the group.`, keys: join(both(['youHave']), secK(t), both(['onGroup'])) });
    }
    if (dropped && !this.wasDropped && this.ready('dropped', 40)) say({ fr: 'Tu es décroché, accroche-toi, reviens dans les roues !', en: 'You’re dropped, hang on, get back on the wheels!', keys: both(['dropped']) });
    this.wasAway = away;
    this.wasDropped = dropped;
    // Allure : au-dessus de la cible plus de 6 s, puis retour sur la cible ; en dessous (contre-la-montre seulement).
    const target = dsTarget(s.ftpWatts, s.gradePercent, s.timeTrial, s.ttWatts);
    const hot = s.watts3s > target * 1.15 && !away && (s.remainingM === null || s.remainingM > 1000);
    this.over = hot ? this.over + dt : 0;
    this.under = s.timeTrial && s.watts3s < target * 0.85 && s.watts3s > 30 ? this.under + dt : 0;
    if (this.over > 6 && this.ready('over', 25)) {
      this.alerted = true;
      say({
        fr: `Attention, tu t’emballes, ${r10(s.watts3s)} watts. Calme le jeu, ${target} watts suffisent pour le moment.`,
        en: `Careful, you’re overdoing it, ${r10(s.watts3s)} watts. Ease off, ${target} watts is enough for now.`,
        keys: both(['overA', ...dsNumberKeys(r10(s.watts3s)), 'overB', ...dsNumberKeys(target), 'overC']),
      });
    } else if (this.under > 10 && this.ready('under', 30)) {
      this.alerted = true;
      say({ fr: `Tu peux en mettre plus, vise ${target} watts.`, en: `You can push more, aim for ${target} watts.`, keys: both(['underA', ...dsNumberKeys(target), 'wattsDot']) });
    } else if (this.alerted && Math.abs(s.watts3s - target) < target * 0.06 && this.ready('onTarget', 30)) {
      this.alerted = false;
      say({
        fr: `Parfait, ${r10(s.watts3s)} watts, reste fixé sur ta cible.${s.timeTrial ? ' Reste bien allongé, respire.' : ''}`,
        en: `Perfect, ${r10(s.watts3s)} watts, stay on target.${s.timeTrial ? ' Stay low, breathe.' : ''}`,
        keys: both(['perfect', ...dsNumberKeys(r10(s.watts3s)), 'onTarget', ...(s.timeTrial ? ['ttLow'] : [])]),
      });
    }
    return out;
  }

  /** Temps à un intermédiaire du contre-la-montre : écart au meilleur temps (s, négatif = plus rapide). */
  static checkpoint(deltaS: number | null, rivalName: string | null): DsLine {
    if (deltaS === null) return { fr: 'Premier temps de référence à l’intermédiaire.', en: 'First reference time at the checkpoint.', keys: both(['cpFirst']) };
    const d = Math.abs(Math.round(deltaS));
    // Rival hors de la banque des noms : dit sans son nom.
    const rival = rivalName ? nameKeys(rivalName) : null;
    if (deltaS <= 0)
      return {
        fr: `Tu es dans le meilleur temps, ${d} secondes d’avance${rivalName ? ` sur ${rivalName}` : ''}. Continue !`,
        en: `You’re fastest, ${d} seconds up${rivalName ? ` on ${rivalName}` : ''}. Keep going!`,
        keys: join(both(['cpFast']), secK(d), both(rival ? ['aheadOn', ...rival.keys] : ['aheadDot']), both(['keepGoing'])),
      };
    return {
      fr: `${d} secondes de retard${rivalName ? ` sur ${rivalName}` : ''}. Il faut appuyer !`,
      en: `${d} seconds down${rivalName ? ` on ${rivalName}` : ''}. Push on!`,
      keys: join(secK(d), both(rival ? ['behindOn', ...rival.keys] : ['behindDot']), both(['pushOn'])),
    };
  }

  /** Arrivée du contre-la-montre : place, écart au vainqueur (s), ou avance sur le deuxième (s) quand on gagne. */
  static ttFinish(rank: number, gapS: number, leadS: number, winnerName: string | undefined): DsLine {
    if (rank === 1) return { fr: `Victoire ! Meilleur temps, ${leadS} secondes d’avance.`, en: `Win! Fastest time, ${leadS} seconds up.`, urgent: true, keys: join(both(['win']), secK(leadS), both(['aheadDot'])) };
    const winner = winnerName ? nameKeys(winnerName) : null;
    return {
      fr: `Tu termines ${rank}e, à ${gapS} secondes de ${winnerName ?? 'la tête'}.`,
      en: `You finish ${rank}th, ${gapS} seconds behind ${winnerName ?? 'the winner'}.`,
      urgent: true,
      keys: join(both(['youFinish', ...ordinalKeys(rank), 'at']), secK(gapS), both(winner ? ['of', ...winner.keys] : ['ofWinner'])),
    };
  }
}
