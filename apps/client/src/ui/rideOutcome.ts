/**
 * Ce qu'une fin de sortie a réellement acquis, dit en clair : la façon dont la sortie s'est terminée (arrivée, arrêt
 * volontaire, abandon en course, test FTP sans résultat…), l'état de sa sauvegarde, la disponibilité du FIT et l'état
 * des envois vers les services tiers. Logique pure (aucun DOM) : le bilan (ui/summary.ts), la récupération
 * (ui/rideRecovery.ts) et l'historique s'en servent pour afficher les mêmes mots.
 */

/** Façon dont la sortie s'est terminée. */
export type RideEnd =
  | 'arrived'
  | 'stopped'
  | 'race_finished'
  | 'abandoned'
  | 'workout_done'
  | 'workout_stopped'
  | 'challenge_done'
  | 'ftp_done'
  | 'ftp_none';

export type Tone = 'ok' | 'info' | 'warn' | 'bad';

export interface RideEndInput {
  /** Test FTP, et son résultat (false : effort trop court, FTP inchangée). */
  ftpTest: boolean;
  ftpHasResult: boolean;
  /** Course en cours au moment de terminer : « Terminer » était un abandon. */
  racingAtEnd: boolean;
  /** Rang d'arrivée en course (0 : pas arrivé). */
  raceRank: number;
  challengeDone: boolean;
  /** Séance d'entraînement (hors test FTP) et si elle est allée au bout. */
  workout: boolean;
  workoutFinished: boolean;
  /** Ligne d'arrivée de l'itinéraire franchie (aller simple) ou tours prévus bouclés. */
  routeFinished: boolean;
}

/** La fin la plus précise d'abord : un test FTP ou une course priment sur l'arrivée de l'itinéraire. */
export function rideEndOf(i: RideEndInput): RideEnd {
  if (i.ftpTest) return i.ftpHasResult ? 'ftp_done' : 'ftp_none';
  if (i.racingAtEnd) return 'abandoned';
  if (i.raceRank > 0) return 'race_finished';
  if (i.challengeDone) return 'challenge_done';
  if (i.workout) return i.workoutFinished ? 'workout_done' : 'workout_stopped';
  return i.routeFinished ? 'arrived' : 'stopped';
}

export interface RideEndView {
  /** Titre du bilan (HTML : `<em>` pour le mot fort). */
  title: string;
  /** Bloc « Résultat » : un état en un mot, une ligne qui dit ce qui compte. */
  word: string;
  detail: string;
  tone: Tone;
}

const rankFr = (n: number) => (n === 1 ? '1re place' : `${n}e place`);
const rankEn = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'} place`;

/** Titre et bloc « Résultat » d'une fin de sortie. `canResume` : la sortie peut reprendre (solo). */
export function rideEndView(end: RideEnd, o: { fr: boolean; raceRank?: number; oldFtp?: number; canResume?: boolean }): RideEndView {
  const fr = o.fr;
  const rank = o.raceRank ?? 0;
  switch (end) {
    case 'arrived':
      return { title: fr ? 'Bravo, <em>arrivée franchie</em> !' : 'Well done, <em>you made it</em>!', word: fr ? 'Arrivée franchie' : 'Finish reached', detail: fr ? 'Parcours terminé : temps et segments comptés.' : 'Route completed: time and segments counted.', tone: 'ok' };
    case 'race_finished':
      return { title: fr ? `Course terminée : <em>${rankFr(rank)}</em>` : `Race finished: <em>${rankEn(rank)}</em>`, word: fr ? 'Classé' : 'Ranked', detail: fr ? `${rankFr(rank)} : résultat gardé au classement.` : `${rankEn(rank)}: result kept in the standings.`, tone: 'ok' };
    case 'abandoned':
      return { title: fr ? 'Course <em>abandonnée</em>' : 'Race <em>abandoned</em>', word: fr ? 'Abandon' : 'Did not finish', detail: fr ? 'Non classé. Les kilomètres roulés comptent quand même.' : 'Not ranked. The distance you rode still counts.', tone: 'warn' };
    case 'challenge_done':
      return { title: fr ? 'Défi <em>terminé</em>' : 'Challenge <em>done</em>', word: fr ? 'Défi terminé' : 'Challenge done', detail: fr ? 'Ton temps est comparé à ton record.' : 'Your time is compared with your best.', tone: 'ok' };
    case 'workout_done':
      return { title: fr ? 'Séance <em>terminée</em>' : 'Workout <em>complete</em>', word: fr ? 'Séance terminée' : 'Workout complete', detail: fr ? 'Toutes les étapes ont été faites.' : 'Every step was done.', tone: 'ok' };
    case 'workout_stopped':
      return { title: fr ? 'Séance <em>interrompue</em>' : 'Workout <em>cut short</em>', word: fr ? 'Séance interrompue' : 'Cut short', detail: o.canResume ? (fr ? 'Arrêtée avant la fin. « Reprendre » la poursuit.' : 'Stopped before the end. “Resume” continues it.') : fr ? 'Arrêtée avant la fin. Ce qui est fait compte.' : 'Stopped before the end. What you did counts.', tone: 'info' };
    case 'ftp_done':
      return { title: '', word: fr ? 'Test réussi' : 'Test complete', detail: fr ? 'Garde la nouvelle FTP ou l’ancienne, ci-dessous.' : 'Keep the new FTP or the old one, below.', tone: 'ok' };
    case 'ftp_none': {
      const w = o.oldFtp ? ` ${Math.round(o.oldFtp)} W` : '';
      return { title: '', word: fr ? 'Pas de résultat' : 'No result', detail: fr ? `Effort trop court : ta FTP reste à${w || ' sa valeur'}.` : `Effort too short: your FTP stays at${w || ' its value'}.`, tone: 'warn' };
    }
    default:
      return { title: fr ? 'Sortie <em>arrêtée</em>' : 'Ride <em>stopped</em>', word: fr ? 'Arrêt volontaire' : 'Stopped by you', detail: o.canResume ? (fr ? 'Arrêtée avant l’arrivée. « Reprendre » la poursuit.' : 'Stopped before the finish. “Resume” continues it.') : fr ? 'Arrêtée avant l’arrivée. Ce qui est roulé compte.' : 'Stopped before the finish. What you rode counts.', tone: 'info' };
  }
}

/** Sauvegarde de la sortie sur l'appareil (historique). */
export type SaveState = 'saving' | 'saved' | 'too_short' | 'failed' | 'guest';

export interface StateView {
  word: string;
  detail: string;
  tone: Tone;
}

export function saveView(state: SaveState, fr: boolean): StateView {
  switch (state) {
    case 'saved':
      return { word: fr ? 'Enregistrée' : 'Saved', detail: fr ? 'Dans ton historique, sur cet appareil.' : 'In your history, on this device.', tone: 'ok' };
    case 'too_short':
      return { word: fr ? 'Non enregistrée' : 'Not saved', detail: fr ? 'Moins d’une minute : rien n’est gardé.' : 'Under a minute: nothing is kept.', tone: 'warn' };
    case 'failed':
      return { word: fr ? 'Échec' : 'Failed', detail: fr ? 'Historique non écrit : télécharge le FIT.' : 'History not written: download the FIT.', tone: 'bad' };
    case 'guest':
      return { word: fr ? 'Non enregistrée' : 'Not saved', detail: fr ? 'Sortie en invité : ni historique, ni XP, ni FIT.' : 'Guest ride: no history, XP or FIT.', tone: 'warn' };
    default:
      return { word: fr ? 'Enregistrement…' : 'Saving…', detail: fr ? 'Écriture dans ton historique.' : 'Writing to your history.', tone: 'info' };
  }
}

/** Envoi du FIT sur le compte (et de là vers Strava / intervals.icu). */
export type AccountState = 'checking' | 'signed_out' | 'to_send' | 'sending' | 'sent' | 'failed';

export function accountView(state: AccountState, fr: boolean): StateView {
  switch (state) {
    case 'signed_out':
      return { word: fr ? 'Hors compte' : 'No account', detail: fr ? 'Le FIT n’existe que sur cet appareil : télécharge-le.' : 'The FIT only exists on this device: download it.', tone: 'warn' };
    case 'to_send':
      return { word: fr ? 'À envoyer' : 'Not sent yet', detail: fr ? 'Envoie-la avant de quitter : le FIT n’est pas gardé sinon.' : 'Send it before leaving: the FIT is not kept otherwise.', tone: 'warn' };
    case 'sending':
      return { word: fr ? 'Envoi…' : 'Sending…', detail: fr ? 'Le FIT part sur ton compte.' : 'The FIT is going to your account.', tone: 'info' };
    case 'sent':
      return { word: fr ? 'Sur ton compte' : 'On your account', detail: fr ? 'FIT gardé : retéléchargeable depuis l’historique.' : 'FIT kept: downloadable again from your history.', tone: 'ok' };
    case 'failed':
      return { word: fr ? 'Envoi échoué' : 'Send failed', detail: fr ? 'Réessaie, ou télécharge le FIT avant de quitter.' : 'Try again, or download the FIT before leaving.', tone: 'bad' };
    default:
      return { word: fr ? 'Vérification…' : 'Checking…', detail: fr ? 'Lecture de ton compte.' : 'Reading your account.', tone: 'info' };
  }
}

/** Envoi vers un service tiers, tel que le serveur le note (`strava_status`, `intervals_status`). */
export interface ExportView extends StateView {
  /** Un nouvel essai a un sens (échec, ou service relié après coup). */
  retry: boolean;
  retryLabel: string;
}

export function exportView(status: string | null | undefined, linked: boolean, fr: boolean): ExportView {
  const again = fr ? 'Réessayer' : 'Try again';
  const send = fr ? 'Envoyer' : 'Send';
  if (status === 'uploaded') return { word: fr ? 'Envoyée' : 'Sent', detail: '', tone: 'ok', retry: false, retryLabel: again };
  if (status === 'failed') return { word: fr ? 'Échec' : 'Failed', detail: linked ? '' : fr ? 'Service non relié.' : 'Service not linked.', tone: 'bad', retry: linked, retryLabel: again };
  if (!linked) return { word: fr ? 'Non relié' : 'Not linked', detail: '', tone: 'info', retry: false, retryLabel: send };
  if (status === 'skipped') return { word: fr ? 'Non envoyée' : 'Not sent', detail: fr ? 'Envoi désactivé (Garmin).' : 'Upload off (Garmin).', tone: 'info', retry: true, retryLabel: send };
  return { word: fr ? 'En attente' : 'Pending', detail: '', tone: 'info', retry: true, retryLabel: send };
}
