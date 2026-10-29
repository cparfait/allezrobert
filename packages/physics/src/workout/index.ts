export * from './xml.ts';
export * from './model.ts';
export * from './zwo.ts';
export * from './erg.ts';
import { parseErgOrMrc } from './erg.ts';
import { parseZwo } from './zwo.ts';
import type { Workout } from './model.ts';

/** Analyse un fichier de séance selon son extension (.zwo, .erg, .mrc, ou .json au format `Workout`). */
export function parseWorkoutFile(fileName: string, content: string): Workout {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'json') return parseWorkoutJson(content);
  if (ext === 'zwo') return parseZwo(content);
  if (ext === 'erg') return parseErgOrMrc(content, { unit: 'watts' });
  if (ext === 'mrc') return parseErgOrMrc(content, { unit: 'percent' });
  throw new Error(`Format de séance non pris en charge : ${fileName}`);
}
export * from './library.ts';
export * from './cyclotron.ts';

const STEP_KINDS = new Set(['warmup', 'cooldown', 'steady', 'ramp', 'intervalOn', 'intervalOff', 'freeRide', 'maxEffort']);

/** Séance au format du jeu (`Workout` en JSON : séances perso gardées dans l'historique). */
export function parseWorkoutJson(content: string): Workout {
  const w = JSON.parse(content) as Partial<Workout>;
  if (!w || typeof w.name !== 'string' || !Array.isArray(w.steps) || w.steps.length === 0) throw new Error('Séance JSON invalide');
  for (const st of w.steps) {
    if (!st || !STEP_KINDS.has(st.kind) || !(st.durationS > 0) || !['erg', 'free', 'max'].includes(st.mode) || !['ftp', 'watts'].includes(st.powerUnit)) throw new Error('Étape de séance invalide');
  }
  return { name: w.name, ...(w.description ? { description: w.description } : {}), ...(w.tags ? { tags: w.tags } : {}), steps: w.steps };
}
