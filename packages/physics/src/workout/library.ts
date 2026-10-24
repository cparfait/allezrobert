/**
 * Séances intégrées (en % de FTP) : endurance, seuil, sweet spot, pyramide, sprints, VO2max, récupération
 * active. Construites à la demande, mêmes étapes que les séances importées (.zwo, .erg, .mrc).
 */
import type { Workout, WorkoutStep } from './model.ts';

export interface LibraryWorkout {
  id: string;
  name: { fr: string; en: string };
  description: { fr: string; en: string };
  build(): Workout;
}

const step = (kind: WorkoutStep['kind'], durationS: number, from: number, to = from, extra: Partial<WorkoutStep> = {}): WorkoutStep => ({
  kind,
  mode: 'erg',
  durationS,
  powerStart: from,
  powerEnd: to,
  powerUnit: 'ftp',
  ...extra,
});

const warmup = (min = 10): WorkoutStep => step('warmup', min * 60, 0.5, 0.75, { textEvents: [{ offsetS: 0, message: 'Échauffement progressif' }] });
const cooldown = (min = 10): WorkoutStep => step('cooldown', min * 60, 0.6, 0.4, { textEvents: [{ offsetS: 0, message: 'Retour au calme' }] });

/** Répétitions effort / récupération numérotées. */
function repeats(count: number, onS: number, onFtp: number, offS: number, offFtp: number, message?: string, cadence?: number): WorkoutStep[] {
  const out: WorkoutStep[] = [];
  for (let i = 0; i < count; i++) {
    out.push(
      step('intervalOn', onS, onFtp, onFtp, {
        repeatIndex: i,
        repeatCount: count,
        ...(cadence ? { cadence } : {}),
        ...(message ? { textEvents: [{ offsetS: 0, message: `${message} ${i + 1}/${count}` }] } : {}),
      }),
    );
    if (offS > 0) out.push(step('intervalOff', offS, offFtp, offFtp, { repeatIndex: i, repeatCount: count }));
  }
  return out;
}

export const WORKOUT_LIBRARY: LibraryWorkout[] = [
  {
    id: 'endurance',
    name: { fr: 'Endurance fondamentale', en: 'Endurance' },
    description: { fr: '1 h en zone 2 (65 % de FTP), cadence souple : la base de tout.', en: '1 h in zone 2 (65% FTP), easy cadence: the foundation.' },
    build: () => ({
      name: 'Endurance fondamentale',
      tags: ['endurance'],
      steps: [warmup(8), step('steady', 2700, 0.65, 0.65, { cadence: 90, textEvents: [{ offsetS: 0, message: 'Zone 2 : régulier, en aisance respiratoire' }] }), cooldown(7)],
    }),
  },
  {
    id: 'seuil-3x10',
    name: { fr: 'Seuil 3 × 10 min', en: 'Threshold 3 × 10 min' },
    description: { fr: '3 × 10 min à 98 % de FTP, 5 min de récupération. 1 h.', en: '3 × 10 min at 98% FTP, 5 min recovery. 1 h.' },
    build: () => ({ name: 'Seuil 3 × 10 min', tags: ['seuil'], steps: [warmup(), ...repeats(3, 600, 0.98, 300, 0.55, 'Seuil'), cooldown(5)] }),
  },
  {
    id: 'seuil-2x20',
    name: { fr: 'Seuil 2 × 20 min', en: 'Threshold 2 × 20 min' },
    description: { fr: '2 × 20 min à 95 % de FTP, 5 min de récupération. 1 h 10.', en: '2 × 20 min at 95% FTP, 5 min recovery. 1 h 10.' },
    build: () => ({ name: 'Seuil 2 × 20 min', tags: ['seuil'], steps: [warmup(), ...repeats(2, 1200, 0.95, 300, 0.55, 'Seuil'), cooldown(5)] }),
  },
  {
    id: 'sweet-spot-3x12',
    name: { fr: 'Sweet spot 3 × 12 min', en: 'Sweet spot 3 × 12 min' },
    description: { fr: '3 × 12 min à 90 % de FTP, 4 min de récupération. 1 h 05.', en: '3 × 12 min at 90% FTP, 4 min recovery. 1 h 05.' },
    build: () => ({ name: 'Sweet spot 3 × 12 min', tags: ['sweet spot'], steps: [warmup(), ...repeats(3, 720, 0.9, 240, 0.55, 'Sweet spot'), cooldown(7)] }),
  },
  {
    id: 'pyramide',
    name: { fr: 'Pyramide 1-2-3-4-3-2-1', en: 'Pyramid 1-2-3-4-3-2-1' },
    description: { fr: 'Paliers de 1 à 4 min à 105 % puis retour, récupération égale à l’effort. 50 min.', en: '1 to 4 min steps at 105% and back down, equal recovery. 50 min.' },
    build: () => {
      const mins = [1, 2, 3, 4, 3, 2, 1];
      const steps: WorkoutStep[] = [warmup()];
      mins.forEach((m, i) => {
        steps.push(step('intervalOn', m * 60, 1.05, 1.05, { repeatIndex: i, repeatCount: mins.length, textEvents: [{ offsetS: 0, message: `${m} min à 105 %` }] }));
        steps.push(step('intervalOff', m * 60, 0.55, 0.55, { repeatIndex: i, repeatCount: mins.length }));
      });
      steps.push(cooldown(8));
      return { name: 'Pyramide', tags: ['pyramide'], steps };
    },
  },
  {
    id: 'sprints-8x15',
    name: { fr: 'Sprints 8 × 15 s', en: 'Sprints 8 × 15 s' },
    description: { fr: '8 sprints de 15 s à fond (pédalage libre), 2 min 45 de récupération. 45 min.', en: '8 all-out 15 s sprints (free riding), 2:45 recovery. 45 min.' },
    build: () => {
      const steps: WorkoutStep[] = [warmup(12)];
      for (let i = 0; i < 8; i++) {
        steps.push({ kind: 'maxEffort', mode: 'max', durationS: 15, powerStart: 0, powerEnd: 0, powerUnit: 'ftp', cadence: 110, repeatIndex: i, repeatCount: 8, textEvents: [{ offsetS: 0, message: `Sprint ${i + 1}/8 : à fond !`, durationS: 15 }] });
        steps.push(step('intervalOff', 165, 0.5, 0.5, { repeatIndex: i, repeatCount: 8 }));
      }
      steps.push(cooldown(10));
      return { name: 'Sprints 8 × 15 s', tags: ['sprint'], steps };
    },
  },
  {
    id: 'vo2-5x3',
    name: { fr: 'VO2max 5 × 3 min', en: 'VO2max 5 × 3 min' },
    description: { fr: '5 × 3 min à 115 % de FTP, 3 min de récupération. 55 min.', en: '5 × 3 min at 115% FTP, 3 min recovery. 55 min.' },
    build: () => ({ name: 'VO2max 5 × 3 min', tags: ['vo2max'], steps: [warmup(12), ...repeats(5, 180, 1.15, 180, 0.5, 'VO2max', 95), cooldown(13)] }),
  },
  {
    id: 'recuperation',
    name: { fr: 'Récupération active', en: 'Active recovery' },
    description: { fr: '45 min entre 50 et 60 % de FTP, cadence souple.', en: '45 min at 50–60% FTP, easy cadence.' },
    build: () => ({
      name: 'Récupération active',
      tags: ['récupération'],
      steps: [step('warmup', 300, 0.45, 0.55), step('steady', 1800, 0.58, 0.58, { cadence: 90, textEvents: [{ offsetS: 0, message: 'Tout en souplesse' }] }), step('cooldown', 600, 0.55, 0.45)],
    }),
  },
];
