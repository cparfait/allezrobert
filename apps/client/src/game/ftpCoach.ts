import type { FtpTestProtocol, WorkoutPosition } from '@allezrobert/physics';
import { RAMP_FAIL_RATIO, RAMP_FAIL_S, type FtpTestEnd, type LiveFtpEstimate } from './workout.ts';
import { coachMessageKey, numberKeys, wattsKeys, wkgKeys } from '../audio/coachLines.ts';

/**
 * Coach vocal du test FTP : décide quoi dire et quand, sous forme de suites de clés de la banque enregistrée
 * (audio/coachLines.ts) ; aucun son ici (voir audio/coachVoice.ts), aucun appel réseau.
 *
 * Rampe : annonce de chaque palier, première estimation de la FTP puis tous les 3 paliers, « dix secondes »
 * sur les paliers durs, alerte quand la puissance passe sous la cible (le test s'arrête après 15 s), conseil
 * de cadence. Test 20 min : accélérations, compte à rebours, moyenne et FTP estimée toutes les 5 minutes,
 * conseils d'allure (tu baisses, tu pars fort), bilan à la fin de l'effort. À la fin : FTP, W/kg et écart
 * avec l'ancienne. Les messages écrits de la séance (textEvents, en français) sont lus aussi.
 */

export interface CoachLine {
  /** Morceaux enchaînés (clés de coachLines). */
  keys: string[];
  /** Prioritaire : passe devant et coupe la phrase en cours (alerte avant l'arrêt du test). */
  urgent?: boolean;
  /** Abandonnée si elle n'a pas pu être dite dans ce délai (s) : une annonce périmée ne sert à rien. */
  ttlS?: number;
}

export interface CoachFrame {
  elapsedS: number;
  position: WorkoutPosition;
  /** Puissance mesurée (W). */
  watts: number;
  /** Cadence mesurée (tr/min), 0 sans capteur. */
  cadence: number;
  /** Estimation en direct (appelée seulement quand le coach en a besoin). */
  live: () => LiveFtpEstimate | null;
  /** Test déjà terminé : plus rien à annoncer. */
  ended: boolean;
}

export interface CoachResult {
  ftp: number | null;
  end: FtpTestEnd;
  oldFtp: number;
  massKg: number;
  live: LiveFtpEstimate | null;
}

/** Alertes préchargées au départ (dites sans délai). */
export const COACH_PRELOAD = ['belowTarget', 'fiveSeconds', 'backOn', 'palier', 'watts', 'ten0', 'ten1', 'ten2'];

/** Rampe : secondes sous la cible avant la première alerte, puis avant « cinq secondes ». */
export const COACH_WARN_S = 5;
const COACH_LAST_WARN_S = RAMP_FAIL_S - 5;
/** Rampe : palier (0 = premier) à partir duquel le coach dit « dix secondes » en fin de minute. */
const HARD_STEP = 6;
/** Test 20 min : instants (s d'effort) des points d'étape avec moyenne et FTP estimée. */
const AVG_CHECKS_S = [150, 450, 750, 1050];
/** Pause minimale entre deux conseils du même genre (s). */
const TIP_COOLDOWN_S = 120;

const mean = (a: number[]) => a.reduce((s, w) => s + w, 0) / a.length;

export class FtpCoach {
  private readonly ramp: boolean;
  private lastStep = -1;
  /** Phrases déjà dites pour l'étape en cours, remises à zéro à chaque étape. */
  private stepSaid = new Set<string>();
  /** Messages écrits déjà lus (un message réaffiché n'est pas relu). */
  private readonly readMessages = new Set<string>();
  /** Rampe : début du passage sous la cible, niveau d'alerte (0 aucune, 1 première, 2 « cinq secondes »). */
  private belowSince: number | null = null;
  private warned = 0;
  /** Paliers de la rampe complètement tenus. */
  private stepsHeld = 0;
  private cadenceLowSince: number | null = null;
  private lastCadenceTip = -Infinity;
  /** Test 20 min : puissance de l'effort libre, un échantillon par seconde. */
  private readonly effort: number[] = [];
  private lastPaceTip = -Infinity;
  private effortSummaryDone = false;

  constructor(
    readonly kind: FtpTestProtocol,
    readonly lang: 'fr' | 'en',
  ) {
    this.ramp = kind === 'ramp' || kind === 'rampLite';
  }

  /** Messages écrits de la séance (joints par « · ») : lus en français seulement (ils sont écrits en français). */
  message(raw: string): CoachLine[] {
    if (this.lang !== 'fr') return [];
    const out: CoachLine[] = [];
    for (const m of raw.split(' · ')) {
      const k = m.trim();
      if (!k || this.readMessages.has(k)) continue;
      this.readMessages.add(k);
      out.push({ keys: [coachMessageKey(k)], ttlS: 15 });
    }
    return out;
  }

  /** À chaque image pendant le test : phrases à dire maintenant (souvent aucune). */
  update(f: CoachFrame): CoachLine[] {
    if (f.ended) return [];
    const out: CoachLine[] = [];
    const p = f.position;
    if (p.stepIndex !== this.lastStep) {
      this.lastStep = p.stepIndex;
      this.stepSaid = new Set();
      this.onStepStart(p, f, out);
    }
    if (this.ramp) this.rampFrame(f, out);
    else this.ftp20Frame(f, out);
    return out;
  }

  private onStepStart(p: WorkoutPosition, f: CoachFrame, out: CoachLine[]): void {
    const step = p.step;
    if (!step) return;
    if (this.ramp) {
      const i = step.repeatIndex;
      if (i === undefined) return;
      this.stepsHeld = i;
      // Le premier palier est annoncé par son message écrit.
      if (i === 0) return;
      const keys = ['palier', ...numberKeys(i + 1), ...wattsKeys(p.targetWatts ?? 0)];
      if (i >= 3 && i % 3 === 0) {
        const live = f.live();
        if (live && live.ftp > 0) keys.push(...(i === 3 ? ['firstEstimate', ...wattsKeys(live.ftp), 'risesEachStep'] : ['estimatedFtp', ...wattsKeys(live.ftp)]));
      }
      out.push({ keys, ttlS: 8 });
      return;
    }
    // Test 20 min.
    if (step.kind === 'intervalOn' && step.repeatIndex !== undefined && step.powerStart <= 0.8 + 1e-6) {
      out.push({ keys: [`int${Math.min(2, step.repeatIndex)}`], ttlS: 6 });
    } else if (step.kind === 'steady' && step.durationS === 300 && Math.abs(step.powerStart - 0.5) < 1e-6) {
      out.push({ keys: ['easy5'], ttlS: 8 });
    } else if (step.kind === 'cooldown' && this.effort.length > 0 && !this.effortSummaryDone) {
      this.effortSummaryDone = true;
      const avg = mean(this.effort);
      out.push({ keys: ['twentyDone', ...wattsKeys(avg), 'thusFtp', ...wattsKeys(0.95 * avg), 'easyTenResult'], ttlS: 20 });
    }
  }

  private once(key: string, out: CoachLine[], line: CoachLine): void {
    if (this.stepSaid.has(key)) return;
    this.stepSaid.add(key);
    out.push(line);
  }

  private rampFrame(f: CoachFrame, out: CoachLine[]): void {
    const p = f.position;
    const step = p.step;
    if (!step) return;
    const i = step.repeatIndex;
    if (i === undefined) {
      // Échauffement : compte à rebours avant le premier palier.
      if (p.stepRemainingS <= 10 && p.stepRemainingS > 2) this.once('countdown', out, { keys: ['warmupTen'], ttlS: 5 });
      return;
    }
    const target = p.targetWatts;
    // Alerte : sous la cible, le test s'arrête au bout de RAMP_FAIL_S secondes.
    if (target && f.watts < RAMP_FAIL_RATIO * target) {
      this.belowSince ??= f.elapsedS;
      const below = f.elapsedS - this.belowSince;
      if (below >= COACH_WARN_S && this.warned === 0) {
        this.warned = 1;
        out.push({ keys: ['belowTarget'], urgent: true, ttlS: 3 });
      } else if (below >= COACH_LAST_WARN_S && this.warned === 1) {
        this.warned = 2;
        out.push({ keys: ['fiveSeconds'], urgent: true, ttlS: 2 });
      }
    } else {
      if (this.warned > 0) out.push({ keys: ['backOn'], ttlS: 4 });
      this.warned = 0;
      this.belowSince = null;
    }
    // Fin de minute sur les paliers durs (pas pendant une alerte).
    if (i >= HARD_STEP && this.warned === 0 && p.stepRemainingS <= 10 && p.stepRemainingS > 3) this.once('ten', out, { keys: [`ten${i % 3}`], ttlS: 4 });
    // Cadence trop basse (capteur présent) : jambes plus vite usées.
    const lo = step.cadenceLow;
    if (lo && f.cadence > 0 && f.cadence < lo) {
      this.cadenceLowSince ??= f.elapsedS;
      if (f.elapsedS - this.cadenceLowSince >= 12 && f.elapsedS - this.lastCadenceTip >= TIP_COOLDOWN_S && this.warned === 0) {
        this.lastCadenceTip = f.elapsedS;
        out.push({ keys: ['cadenceLow'], ttlS: 8 });
      }
    } else this.cadenceLowSince = null;
  }

  private ftp20Frame(f: CoachFrame, out: CoachLine[]): void {
    const p = f.position;
    const step = p.step;
    if (!step) return;
    if (step.kind !== 'freeRide') {
      // Juste avant l'effort libre (après la récupération de 10 minutes, seule étape de 600 s avant lui).
      if (step.kind === 'steady' && step.durationS === 600 && this.effort.length === 0 && p.stepRemainingS <= 10 && p.stepRemainingS > 2)
        this.once('countdown', out, { keys: ['ftp20Ten'], ttlS: 5 });
      return;
    }
    const s = Math.floor(p.stepElapsedS);
    if (s > this.effort.length - 1) this.effort.push(f.watts);
    const n = this.effort.length;
    if (n < 60) return;
    const avg = mean(this.effort);
    const checkIdx = AVG_CHECKS_S.findIndex((c) => s >= c && s < c + 5);
    if (checkIdx >= 0) {
      if (avg > 0)
        this.once(`avg${checkIdx}`, out, {
          keys: [...(checkIdx === 0 ? ['avgExplain'] : ['average']), ...wattsKeys(avg), 'thusFtp', ...wattsKeys(0.95 * avg)],
          ttlS: 10,
        });
      return;
    }
    // Conseils d'allure, après deux minutes d'effort.
    if (n < 120 || f.elapsedS - this.lastPaceTip < TIP_COOLDOWN_S) return;
    const recent = mean(this.effort.slice(-30));
    if (recent < 0.88 * avg) {
      this.lastPaceTip = f.elapsedS;
      out.push({ keys: ['fadingTo', ...wattsKeys(avg)], ttlS: 8 });
    } else if (recent > 1.15 * avg && s < 600) {
      this.lastPaceTip = f.elapsedS;
      out.push({ keys: ['strongStart'], ttlS: 8 });
    }
  }

  /** Fin du test : bilan dit à voix haute (rien si la sortie a été quittée : l'écran de résultat suffit). */
  finished(r: CoachResult): CoachLine[] {
    this.warned = 0;
    if (r.end === 'quit') return [];
    if (!r.ftp) return [{ keys: [this.ramp ? 'tooShortRamp' : 'tooShort20'], urgent: true, ttlS: 10 }];
    const keys =
      this.ramp && r.end === 'failed'
        ? ['endHeld', ...numberKeys(this.stepsHeld), 'stepsDot', ...(r.live ? ['bestMinute', ...wattsKeys(r.live.basisWatts)] : []), 'estimatedFtp', ...wattsKeys(r.ftp)]
        : ['testDone', 'estimatedFtp', ...wattsKeys(r.ftp)];
    if (r.massKg > 0) keys.push('that', ...wkgKeys(r.ftp / r.massKg));
    const diff = r.ftp - Math.round(r.oldFtp);
    if (Math.abs(diff) < 3) keys.push('sameFtp');
    else keys.push(...numberKeys(Math.abs(diff)), diff > 0 ? 'moreWatts' : 'lessWatts');
    keys.push(this.ramp ? 'chooseRamp' : 'choose20');
    return [{ keys, urgent: true, ttlS: 20 }];
  }
}
