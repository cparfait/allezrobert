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
      say({ fr: `Attaque de ${n} ! ${far ? 'Ne réponds pas à tout.' : 'Pas de panique, ça va revenir.'}`, en: `${n} attacks! ${far ? 'Don’t chase everything.' : 'Don’t panic, it’ll come back.'}`, urgent: true });
    }
    for (const n of s.cracks) {
      if ((this.cool.get('crack') ?? -Infinity) > 0) break;
      this.cool.set('crack', 30);
      say({ fr: `${n} a coincé, il est cramé.`, en: `${n} has cracked, he’s cooked.`, urgent: true });
    }
    if (s.remainingM !== null && s.remainingM < 220 && s.remainingM > 0 && !this.finalSaid) {
      this.finalSaid = true;
      say({ fr: '200 mètres, à fond jusqu’à la ligne !', en: '200 metres, all out to the line!', urgent: true });
    }
    if (s.remainingM !== null && s.remainingM < 1000 && s.remainingM > 900 && !this.lastKmSaid) {
      this.lastKmSaid = true;
      say({ fr: 'Dernier kilomètre, vide tout ce qui reste !', en: 'Last kilometre, empty the tank!', urgent: true });
    }
    // Échappée / décroché : changement d'état seulement.
    const away = s.gapAheadM === null && s.gapBehindM !== null && s.gapBehindM > 25;
    const dropped = s.gapAheadM !== null && s.gapAheadM > 30 && !s.timeTrial;
    if (away && !this.wasAway && this.ready('away', 40)) {
      const t = secs(s.gapBehindM ?? 0, s.speedMs);
      say({ fr: `Tu es parti ! ${t} secondes d’avance. Ne te retourne pas, roule !`, en: `You’re away! ${t} seconds clear. Don’t look back, ride!` });
    } else if (away && this.ready('awayGap', 60)) {
      const t = secs(s.gapBehindM ?? 0, s.speedMs);
      say({ fr: `Tu as ${t} secondes sur le groupe.`, en: `You have ${t} seconds on the group.` });
    }
    if (dropped && !this.wasDropped && this.ready('dropped', 40)) say({ fr: 'Tu es décroché, accroche-toi, reviens dans les roues !', en: 'You’re dropped, hang on, get back on the wheels!' });
    this.wasAway = away;
    this.wasDropped = dropped;
    // Allure : au-dessus de la cible plus de 6 s, puis retour sur la cible ; en dessous (contre-la-montre seulement).
    const target = dsTarget(s.ftpWatts, s.gradePercent, s.timeTrial, s.ttWatts);
    const hot = s.watts3s > target * 1.15 && !away && (s.remainingM === null || s.remainingM > 1000);
    this.over = hot ? this.over + dt : 0;
    this.under = s.timeTrial && s.watts3s < target * 0.85 && s.watts3s > 30 ? this.under + dt : 0;
    if (this.over > 6 && this.ready('over', 25)) {
      this.alerted = true;
      say({ fr: `Attention, tu t’emballes, ${r10(s.watts3s)} watts. Calme le jeu, ${target} watts suffisent pour le moment.`, en: `Careful, you’re overdoing it, ${r10(s.watts3s)} watts. Ease off, ${target} watts is enough for now.` });
    } else if (this.under > 10 && this.ready('under', 30)) {
      this.alerted = true;
      say({ fr: `Tu peux en mettre plus, vise ${target} watts.`, en: `You can push more, aim for ${target} watts.` });
    } else if (this.alerted && Math.abs(s.watts3s - target) < target * 0.06 && this.ready('onTarget', 30)) {
      this.alerted = false;
      say({ fr: `Parfait, ${r10(s.watts3s)} watts, reste fixé sur ta cible.${s.timeTrial ? ' Reste bien allongé, respire.' : ''}`, en: `Perfect, ${r10(s.watts3s)} watts, stay on target.${s.timeTrial ? ' Stay low, breathe.' : ''}` });
    }
    return out;
  }

  /** Temps à un intermédiaire du contre-la-montre : écart au meilleur temps (s, négatif = plus rapide). */
  static checkpoint(deltaS: number | null, rivalName: string | null): DsLine {
    if (deltaS === null) return { fr: 'Premier temps de référence à l’intermédiaire.', en: 'First reference time at the checkpoint.' };
    const d = Math.abs(Math.round(deltaS));
    if (deltaS <= 0) return { fr: `Tu es dans le meilleur temps, ${d} secondes d’avance${rivalName ? ` sur ${rivalName}` : ''}. Continue !`, en: `You’re fastest, ${d} seconds up${rivalName ? ` on ${rivalName}` : ''}. Keep going!` };
    return { fr: `${d} secondes de retard${rivalName ? ` sur ${rivalName}` : ''}. Il faut appuyer !`, en: `${d} seconds down${rivalName ? ` on ${rivalName}` : ''}. Push on!` };
  }
}
