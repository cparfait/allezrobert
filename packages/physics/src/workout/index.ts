export * from './xml.ts';
export * from './model.ts';
export * from './zwo.ts';
export * from './erg.ts';
import { parseErgOrMrc } from './erg.ts';
import { parseZwo } from './zwo.ts';
import type { Workout } from './model.ts';

/** Analyse un fichier de séance selon son extension (.zwo, .erg, .mrc). */
export function parseWorkoutFile(fileName: string, content: string): Workout {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'zwo') return parseZwo(content);
  if (ext === 'erg') return parseErgOrMrc(content, { unit: 'watts' });
  if (ext === 'mrc') return parseErgOrMrc(content, { unit: 'percent' });
  throw new Error(`Format de séance non pris en charge : ${fileName}`);
}
export * from './library.ts';
