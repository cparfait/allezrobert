/**
 * Séances adaptées de Cyclotron (wizzlerr/cyclotron, `packages/core/src/workout/builtin.ts`,
 * AGPL-3.0, © ses auteurs) : 47 séances de récupération à anaérobie, en % de FTP. Mêmes paliers,
 * convertis vers le modèle commun (échauffement, intervalles numérotés, retour au calme) ;
 * noms et descriptions traduits. Les identifiants (`cy.…`) sont gardés avec les sorties : ne
 * jamais en renommer un.
 */
import type { WorkoutStep } from './model.ts';
import type { LibraryWorkout, WorkoutType } from './library.ts';

/** Étape au format Cyclotron : palier, rampe ou répétition (imbriquable). */
type CyStep =
  | { k: 's'; d: number; p: number; c?: number }
  | { k: 'r'; d: number; from: number; to: number }
  | { k: 'x'; n: number; steps: CyStep[] };

const min = (m: number): number => m * 60;
const s = (d: number, p: number, c?: number): CyStep => (c ? { k: 's', d, p, c } : { k: 's', d, p });
const ramp = (d: number, from: number, to: number): CyStep => ({ k: 'r', d, from, to });
const rep = (n: number, ...steps: CyStep[]): CyStep => ({ k: 'x', n, steps });
const warmup = (m = 10, to = 0.7): CyStep => ramp(min(m), 0.45, to);
const cooldown = (m = 5): CyStep => ramp(min(m), 0.6, 0.4);

/** Messages des étapes, selon la langue de la séance construite. */
const MSG = {
  fr: { warmup: 'Échauffement progressif', cooldown: 'Retour au calme', effort: 'Effort', cadence: 'Cadence' },
  en: { warmup: 'Progressive warm-up', cooldown: 'Cool-down', effort: 'Effort', cadence: 'Cadence' },
} as const;

/**
 * Aplatit les étapes Cyclotron. Dans une répétition, l'étape la plus dure est l'effort
 * (`intervalOn`, numérotée), les autres la récupération ; une rampe montante en tête est
 * l'échauffement, une rampe descendante en fin le retour au calme.
 */
export function convertCyclotronSteps(steps: readonly CyStep[], lang: 'fr' | 'en' = 'fr'): WorkoutStep[] {
  const m = MSG[lang];
  const out: WorkoutStep[] = [];
  const walk = (list: readonly CyStep[], rpt?: { index: number; count: number; hardest: number }): void => {
    for (const st of list) {
      if (st.k === 'x') {
        const hardest = Math.max(...st.steps.map((x) => (x.k === 's' ? x.p : x.k === 'r' ? Math.max(x.from, x.to) : 0)));
        for (let i = 0; i < st.n; i++) walk(st.steps, { index: i, count: st.n, hardest });
        continue;
      }
      if (st.k === 'r') {
        out.push({ kind: 'ramp', mode: 'erg', durationS: st.d, powerStart: st.from, powerEnd: st.to, powerUnit: 'ftp' });
        continue;
      }
      const isOn = rpt && st.p >= rpt.hardest && st.p > 0.6;
      const step: WorkoutStep = {
        kind: rpt ? (isOn ? 'intervalOn' : 'intervalOff') : 'steady',
        mode: 'erg',
        durationS: st.d,
        powerStart: st.p,
        powerEnd: st.p,
        powerUnit: 'ftp',
      };
      if (st.c) step.cadence = st.c;
      if (rpt) {
        step.repeatIndex = rpt.index;
        step.repeatCount = rpt.count;
      }
      const text = [isOn && rpt && rpt.count > 1 ? `${m.effort} ${rpt.index + 1}/${rpt.count}` : '', st.c ? `${m.cadence} ${st.c} tr/min` : ''].filter(Boolean).join(' · ');
      if (text) step.textEvents = [{ offsetS: 0, message: text }];
      out.push(step);
    }
  };
  walk(steps);
  const first = out[0];
  if (first?.kind === 'ramp' && first.powerEnd > first.powerStart) {
    first.kind = 'warmup';
    first.textEvents = [{ offsetS: 0, message: m.warmup }];
  }
  const last = out.at(-1);
  if (last && last !== first && last.kind === 'ramp' && last.powerEnd < last.powerStart) {
    last.kind = 'cooldown';
    last.textEvents = [{ offsetS: 0, message: m.cooldown }];
  }
  return out;
}

type Def = [id: string, type: WorkoutType, name: { fr: string; en: string }, description: { fr: string; en: string }, steps: CyStep[]];

const DEFS: Def[] = [
  // Récupération
  ['recovery.20', 'recovery', { fr: 'Facile 20', en: 'Easy 20' }, { fr: 'Vingt minutes de pédalage tout en douceur.', en: 'Twenty minutes of gentle spinning.' }, [ramp(min(3), 0.4, 0.5), s(min(14), 0.5, 90), ramp(min(3), 0.5, 0.4)]],
  ['recovery.30', 'recovery', { fr: 'Décrassage', en: 'Recovery Spin' }, { fr: 'Trente minutes faciles pour délier les jambes.', en: 'Thirty easy minutes to loosen the legs.' }, [ramp(min(5), 0.4, 0.5), s(min(20), 0.5, 90), ramp(min(5), 0.5, 0.4)]],
  ['recovery.45', 'recovery', { fr: 'Récupération et vélocité', en: 'Recovery Spin-ups' }, { fr: 'Allure facile avec une minute en vélocité toutes les six minutes. La puissance reste basse.', en: 'Easy riding with a fast-cadence minute every few minutes. Keep the power low.' }, [ramp(min(5), 0.4, 0.5), rep(5, s(min(6), 0.5, 90), s(min(1), 0.5, 110)), ramp(min(5), 0.5, 0.4)]],
  ['recovery.60', 'recovery', { fr: 'Heure facile', en: 'Easy Hour' }, { fr: 'Une heure entière, tout en facilité.', en: 'A full hour, all of it easy.' }, [ramp(min(5), 0.4, 0.52), s(min(50), 0.52, 90), ramp(min(5), 0.52, 0.4)]],

  // Endurance
  ['endurance.45', 'endurance', { fr: 'Endurance 45', en: 'Endurance 45' }, { fr: 'Une courte sortie en zone 2.', en: 'A short zone 2 ride.' }, [warmup(8, 0.65), s(min(32), 0.68), cooldown(5)]],
  ['endurance.60', 'endurance', { fr: 'Heure d’endurance', en: 'Endurance Hour' }, { fr: 'Zone 2 régulière avec de courtes relances de cadence pour rester vif.', en: 'Steady zone 2 with short cadence lifts to stay sharp.' }, [warmup(10, 0.65), rep(4, s(min(10), 0.68), s(min(1), 0.72, 105)), s(min(6), 0.65), cooldown(5)]],
  ['endurance.cadence', 'endurance', { fr: 'Travail de cadence', en: 'Cadence Builder' }, { fr: 'Zone 2 avec des paliers de cadence de 85 à 115 tr/min. Même puissance, jambes plus rapides.', en: 'Zone 2 with cadence steps from 85 up to 115 rpm. Same power, faster legs.' }, [warmup(10, 0.65), rep(6, s(min(5), 0.65, 85), s(min(2), 0.65, 105), s(min(1), 0.65, 115)), s(min(7), 0.65), cooldown(5)]],
  ['endurance.75', 'endurance', { fr: 'Endurance et tempo', en: 'Endurance with Tempo' }, { fr: 'Zone 2 avec trois passages de 5 minutes au tempo.', en: 'Zone 2 with three 5-minute tempo touches.' }, [warmup(10, 0.65), rep(3, s(min(15), 0.68), s(min(5), 0.8)), cooldown(5)]],
  ['endurance.bursts', 'endurance', { fr: 'Endurance et accélérations', en: 'Endurance with Bursts' }, { fr: 'Une heure en zone 2 avec une accélération de 10 secondes toutes les dix minutes.', en: 'An hour of zone 2 with a 10-second burst every ten minutes.' }, [warmup(10, 0.65), rep(6, s(570, 0.68), s(10, 1.5, 100), s(20, 0.55)), cooldown(5)]],
  ['endurance.90', 'endurance', { fr: 'Endurance 1 h 30', en: 'Endurance 90' }, { fr: 'Quatre-vingt-dix minutes de zone 2 régulière.', en: 'Ninety minutes of steady zone 2.' }, [warmup(10, 0.65), rep(3, s(min(20), 0.66), s(min(5), 0.72)), cooldown(5)]],
  ['endurance.120', 'endurance', { fr: 'Longue endurance', en: 'Long Endurance' }, { fr: 'Deux heures en zone 2 avec quelques courtes relances.', en: 'Two hours in zone 2 with a few short lifts.' }, [warmup(10, 0.65), rep(4, s(min(22), 0.68), s(min(3), 0.75, 100)), cooldown(10)]],
  ['endurance.180', 'endurance', { fr: 'Endurance 3 h', en: 'Endurance 3h' }, { fr: 'La grosse sortie. Mange et bois en route.', en: 'The long one. Eat and drink as you go.' }, [warmup(10, 0.65), rep(5, s(min(30), 0.66), s(min(3), 0.72)), cooldown(5)]],

  // Tempo
  ['tempo.3x10', 'tempo', { fr: 'Tempo 3 × 10', en: 'Tempo 3×10' }, { fr: 'Trois blocs de 10 minutes à allure soutenue et régulière.', en: 'Three 10-minute blocks at a firm, steady pace.' }, [warmup(), rep(3, s(min(10), 0.83), s(min(5), 0.6)), cooldown()]],
  ['tempo.2x20', 'tempo', { fr: 'Tempo 2 × 20', en: 'Tempo 2×20' }, { fr: 'Deux blocs de 20 minutes au tempo.', en: 'Two 20-minute tempo blocks.' }, [warmup(), s(min(20), 0.82), s(min(5), 0.6), s(min(20), 0.82), cooldown()]],
  ['tempo.45', 'tempo', { fr: 'Tempo 45', en: 'Tempo 45' }, { fr: 'Un bloc de 45 minutes au tempo, sans coupure.', en: 'One unbroken 45-minute tempo block.' }, [warmup(), s(min(45), 0.8, 90), cooldown()]],
  ['tempo.cadence', 'tempo', { fr: 'Pyramide de cadence au tempo', en: 'Tempo Cadence Pyramid' }, { fr: 'Deux blocs de 25 minutes au tempo, cadence de 80 → 100 → 80 tr/min.', en: 'Two 25-minute tempo blocks, cadence stepping 80 → 100 → 80 rpm.' }, [warmup(), rep(2, s(min(5), 0.82, 80), s(min(5), 0.82, 90), s(min(5), 0.82, 100), s(min(5), 0.82, 90), s(min(5), 0.82, 80), s(min(5), 0.6)), cooldown()]],
  ['tempo.3x20', 'tempo', { fr: 'Tempo 3 × 20', en: 'Tempo 3×20' }, { fr: 'Trois blocs de 20 minutes au tempo : une grosse journée aérobie.', en: 'Three 20-minute tempo blocks: a big aerobic day.' }, [warmup(), rep(3, s(min(20), 0.8), s(min(5), 0.6)), cooldown()]],

  // Sweet spot
  ['sweetspot.4x8', 'sweetspot', { fr: 'Sweet spot express', en: 'Sweet Spot Express' }, { fr: 'Quatre efforts de 8 minutes en sweet spot, en moins d’une heure.', en: 'Four 8-minute sweet spot efforts in under an hour.' }, [warmup(8), rep(4, s(min(8), 0.9), s(min(3), 0.55)), cooldown(4)]],
  ['sweetspot.2x15', 'sweetspot', { fr: 'Sweet spot 2 × 15', en: 'Sweet Spot 2×15' }, { fr: 'Deux efforts de 15 minutes en sweet spot.', en: 'Two 15-minute sweet spot efforts.' }, [warmup(), rep(2, s(min(15), 0.9), s(min(5), 0.55)), cooldown()]],
  ['sweetspot.3x12', 'sweetspot', { fr: 'Sweet spot 3 × 12', en: 'Sweet Spot 3×12' }, { fr: 'Trois blocs de 12 minutes juste sous le seuil.', en: 'Three 12-minute blocks just under threshold.' }, [warmup(), rep(3, s(min(12), 0.9, 90), s(min(5), 0.55)), cooldown()]],
  ['sweetspot.4x10', 'sweetspot', { fr: 'Sweet spot 4 × 10', en: 'Sweet Spot 4×10' }, { fr: 'Quatre efforts de 10 minutes en sweet spot.', en: 'Four 10-minute sweet spot efforts.' }, [warmup(), rep(4, s(min(10), 0.9), s(min(4), 0.55)), cooldown()]],
  ['sweetspot.surges', 'sweetspot', { fr: 'Sweet spot avec relances', en: 'Sweet Spot Surges' }, { fr: 'Blocs en sweet spot avec 30 secondes au seuil toutes les trois minutes.', en: 'Sweet spot blocks with a 30-second lift to FTP every three minutes.' }, [warmup(), rep(3, rep(4, s(150, 0.88), s(30, 1.0)), s(min(5), 0.55)), cooldown()]],
  ['sweetspot.2x20', 'sweetspot', { fr: 'Sweet spot 2 × 20', en: 'Sweet Spot 2×20' }, { fr: 'Deux efforts de 20 minutes en sweet spot.', en: 'Two 20-minute sweet spot efforts.' }, [warmup(), s(min(20), 0.9), s(min(5), 0.55), s(min(20), 0.9), cooldown()]],
  ['sweetspot.3x15', 'sweetspot', { fr: 'Sweet spot 3 × 15', en: 'Sweet Spot 3×15' }, { fr: 'Trois efforts de 15 minutes en sweet spot.', en: 'Three 15-minute sweet spot efforts.' }, [warmup(), rep(3, s(min(15), 0.91), s(min(5), 0.55)), cooldown()]],
  ['sweetspot.45', 'sweetspot', { fr: 'Sweet spot 45', en: 'Sweet Spot 45' }, { fr: 'Un bloc de 45 minutes en sweet spot.', en: 'One 45-minute sweet spot block.' }, [warmup(), s(min(45), 0.89), cooldown(10)]],
  ['sweetspot.3x20', 'sweetspot', { fr: 'Sweet spot 3 × 20', en: 'Sweet Spot 3×20' }, { fr: 'Trois efforts de 20 minutes en haut du sweet spot.', en: 'Three 20-minute efforts at the top of sweet spot.' }, [warmup(), rep(3, s(min(20), 0.92), s(min(5), 0.55)), cooldown()]],

  // Seuil
  ['threshold.3x10', 'threshold', { fr: 'Seuil 3 × 10', en: 'Threshold 3×10' }, { fr: 'Trois efforts de 10 minutes au seuil.', en: 'Three 10-minute efforts at FTP.' }, [warmup(10, 0.75), rep(3, s(min(10), 0.98), s(min(5), 0.55)), cooldown()]],
  ['threshold.overunders', 'threshold', { fr: 'Over-unders', en: 'Over-Unders' }, { fr: 'Trois blocs de 9 minutes qui alternent juste sous et juste au-dessus du seuil.', en: 'Three 9-minute blocks switching between just under and just over FTP.' }, [warmup(10, 0.75), rep(3, rep(3, s(min(2), 0.95), s(min(1), 1.05)), s(min(5), 0.55)), cooldown()]],
  ['threshold.5x6', 'threshold', { fr: 'Seuil 5 × 6', en: 'Threshold 5×6' }, { fr: 'Cinq efforts de 6 minutes légèrement au-dessus du seuil.', en: 'Five 6-minute efforts slightly over FTP.' }, [warmup(10, 0.75), rep(5, s(min(6), 1.02), s(min(3), 0.55)), cooldown()]],
  ['threshold.2x15', 'threshold', { fr: 'Seuil 2 × 15', en: 'Threshold 2×15' }, { fr: 'Deux efforts de 15 minutes au seuil.', en: 'Two 15-minute efforts at FTP.' }, [warmup(10, 0.75), rep(2, s(min(15), 0.97), s(min(6), 0.55)), cooldown()]],
  ['threshold.4x8', 'threshold', { fr: 'Seuil 4 × 8', en: 'Threshold 4×8' }, { fr: 'Quatre efforts de 8 minutes pile au seuil.', en: 'Four 8-minute efforts right at FTP.' }, [warmup(10, 0.75), rep(4, s(min(8), 1.0), s(min(4), 0.55)), cooldown()]],
  ['threshold.2x20', 'threshold', { fr: 'Seuil 2 × 20 (classique)', en: 'Threshold 2×20' }, { fr: 'Le classique : deux efforts de 20 minutes au seuil.', en: 'The classic: two 20-minute efforts at FTP.' }, [warmup(10, 0.75), s(min(3), 0.55), s(min(20), 0.97), s(min(8), 0.55), s(min(20), 0.97), ramp(min(8), 0.6, 0.4)]],
  ['threshold.3x15', 'threshold', { fr: 'Seuil 3 × 15', en: 'Threshold 3×15' }, { fr: 'Trois efforts de 15 minutes au seuil.', en: 'Three 15-minute efforts at FTP.' }, [warmup(10, 0.75), rep(3, s(min(15), 0.97), s(min(6), 0.55)), cooldown()]],
  ['threshold.40', 'threshold', { fr: 'Seuil 40', en: 'Threshold 40' }, { fr: 'Quarante minutes d’affilée au seuil.', en: 'Forty unbroken minutes at FTP.' }, [warmup(12, 0.75), s(min(40), 0.96), cooldown(8)]],

  // VO2max
  ['vo2max.40-20', 'vo2max', { fr: '40/20', en: '40/20s' }, { fr: 'Deux séries de huit efforts de 40 secondes, 20 secondes faciles entre chaque.', en: 'Two sets of eight 40-second efforts with 20 seconds easy.' }, [warmup(10, 0.75), rep(2, rep(8, s(40, 1.2, 100), s(20, 0.5)), s(min(6), 0.5)), cooldown()]],
  ['vo2max.30-30', 'vo2max', { fr: '30/30', en: '30/30s' }, { fr: 'Deux séries de dix efforts de 30 secondes, 30 secondes faciles entre chaque.', en: 'Two sets of ten 30-second efforts with 30 seconds easy.' }, [warmup(10, 0.75), rep(2, rep(10, s(30, 1.2, 100), s(30, 0.5)), s(min(5), 0.5)), cooldown()]],
  ['vo2max.4x4', 'vo2max', { fr: 'VO2max 4 × 4', en: 'VO2max 4×4' }, { fr: 'Quatre efforts de 4 minutes, récupération égale.', en: 'Four 4-minute efforts with equal recovery.' }, [warmup(10, 0.75), s(30, 1.1), s(min(4.5), 0.5), rep(4, s(min(4), 1.12, 100), s(min(4), 0.5)), cooldown()]],
  ['vo2max.8x2', 'vo2max', { fr: 'VO2max 8 × 2', en: 'VO2max 8×2' }, { fr: 'Huit efforts de 2 minutes, récupération égale.', en: 'Eight 2-minute efforts with equal recovery.' }, [warmup(10, 0.75), rep(8, s(min(2), 1.18, 100), s(min(2), 0.5)), cooldown(6)]],
  ['vo2max.3x6', 'vo2max', { fr: 'VO2 long 3 × 6', en: 'Long VO2 3×6' }, { fr: 'Trois longs efforts de 6 minutes juste au-dessus du seuil.', en: 'Three long 6-minute efforts just above FTP.' }, [warmup(12, 0.75), rep(3, s(min(6), 1.08), s(min(5), 0.5)), cooldown(8)]],
  ['vo2max.5x3', 'vo2max', { fr: 'VO2max 5 × 3', en: 'VO2max 5×3' }, { fr: 'Cinq efforts durs de 3 minutes, récupération égale.', en: 'Five hard 3-minute efforts with equal recovery.' }, [warmup(10, 0.75), s(30, 1.1), s(min(4.5), 0.5), rep(5, s(min(3), 1.15, 100), s(min(3), 0.5)), ramp(min(8), 0.6, 0.4)]],
  ['vo2max.6x3', 'vo2max', { fr: 'VO2max 6 × 3', en: 'VO2max 6×3' }, { fr: 'Six efforts durs de 3 minutes, récupération égale.', en: 'Six hard 3-minute efforts with equal recovery.' }, [warmup(10, 0.75), rep(6, s(min(3), 1.15, 100), s(min(3), 0.5)), cooldown(8)]],
  ['vo2max.5x4', 'vo2max', { fr: 'VO2max 5 × 4', en: 'VO2max 5×4' }, { fr: 'Cinq efforts de 4 minutes, récupération égale.', en: 'Five 4-minute efforts with equal recovery.' }, [warmup(10, 0.75), rep(5, s(min(4), 1.13, 100), s(min(4), 0.5)), cooldown(6)]],

  // Anaérobie
  ['anaerobic.sprints', 'anaerobic', { fr: 'Séance de sprints', en: 'Sprint Session' }, { fr: 'Huit sprints de 20 secondes avec de longues récupérations. Tout donner à chaque fois.', en: 'Eight 20-second sprints with long recoveries. Go all in on each one.' }, [warmup(15, 0.75), rep(8, s(20, 1.75, 110), s(280, 0.55)), cooldown()]],
  ['anaerobic.tabata', 'anaerobic', { fr: 'Séries Tabata', en: 'Tabata Sets' }, { fr: 'Deux séries de huit efforts de 20 secondes, 10 secondes de repos entre chaque.', en: 'Two sets of eight 20-second efforts with 10 seconds rest.' }, [warmup(12, 0.75), rep(2, rep(8, s(20, 1.7, 105), s(10, 0.4)), s(min(6), 0.5)), cooldown(6)]],
  ['anaerobic.10x30', 'anaerobic', { fr: 'Explosions de 30 secondes', en: '30-Second Blasts' }, { fr: 'Dix efforts de 30 secondes bien au-dessus de la VO2max.', en: 'Ten 30-second efforts well above VO2max.' }, [warmup(12, 0.75), rep(10, s(30, 1.5, 105), s(150, 0.5)), cooldown(6)]],
  ['anaerobic.5x90', 'anaerobic', { fr: 'Anaérobie 5 × 90 s', en: 'Anaerobic 5×90 s' }, { fr: 'Cinq efforts de 90 secondes. Les 30 dernières secondes de chacun piquent.', en: 'Five 90-second efforts. The last 30 seconds of each will hurt.' }, [warmup(12, 0.75), rep(5, s(90, 1.25), s(270, 0.5)), cooldown(6)]],
  ['anaerobic.8x1', 'anaerobic', { fr: 'Anaérobie 8 × 1', en: 'Anaerobic 8×1' }, { fr: 'Huit efforts d’une minute à 130 %.', en: 'Eight 1-minute efforts at 130 %.' }, [warmup(12, 0.75), rep(8, s(min(1), 1.3, 100), s(min(3), 0.5)), cooldown(6)]],
];

/** Les 47 séances de Cyclotron, au format de la bibliothèque. */
export const CYCLOTRON_WORKOUTS: LibraryWorkout[] = DEFS.map(([id, type, name, description, steps]) => ({
  id: `cy.${id}`,
  type,
  source: 'cyclotron',
  name,
  description,
  build: (lang: 'fr' | 'en' = 'fr') => ({ name: name[lang], author: 'Cyclotron', description: description[lang], tags: [type], steps: convertCyclotronSteps(steps, lang) }),
}));
