/**
 * Lecture des fichiers .erg (watts) et .mrc (% FTP), format « Computrainer » :
 *
 *   [COURSE HEADER]
 *   VERSION = 2
 *   UNITS = ENGLISH
 *   DESCRIPTION = …
 *   FILE NAME = …
 *   FTP = 250                (facultatif, .erg)
 *   MINUTES WATTS            (ou MINUTES PERCENT pour .mrc)
 *   [END COURSE HEADER]
 *   [COURSE DATA]
 *   0.00   100
 *   5.00   100               (deux points de même temps = changement de palier)
 *   5.00   200
 *   …
 *   [END COURSE DATA]
 *   [COURSE TEXT]            (facultatif : secondes  message  durée)
 *   [END COURSE TEXT]
 *
 * La courbe est linéaire par morceaux : chaque intervalle [t_i, t_{i+1}] devient une étape
 * (palier si p_i = p_{i+1}, rampe sinon). Séparateurs : tabulations ou espaces.
 */
import type { Workout, WorkoutStep, WorkoutTextEvent } from './model.ts';

export interface ErgParseOptions {
  /** Force l'unité ; sinon déduite de l'en-tête (« PERCENT » ⇒ % FTP). */
  unit?: 'watts' | 'percent';
}

/** Analyse un .erg ou un .mrc. */
export function parseErgOrMrc(text: string, opts: ErgParseOptions = {}): Workout {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let section = '';
  let unit: 'watts' | 'percent' | undefined = opts.unit;
  let timeUnit: 'minutes' | 'seconds' = 'minutes';
  const workout: Workout = { name: 'Séance', steps: [] };
  const points: Array<[number, number]> = [];
  const texts: Array<{ t: number; message: string; d?: number }> = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      const tag = line.toUpperCase();
      section = tag.startsWith('[END') ? '' : tag.replace(/[[\]]/g, '').trim();
      continue;
    }
    if (section === 'COURSE HEADER') {
      const eq = line.indexOf('=');
      if (eq >= 0) {
        const key = line.slice(0, eq).trim().toUpperCase();
        const val = line.slice(eq + 1).trim();
        if (key === 'DESCRIPTION') workout.description = val;
        else if (key === 'FILE NAME') workout.name = val.replace(/\.(erg|mrc)$/i, '') || workout.name;
        else if (key === 'FTP') {
          const f = Number(val);
          if (Number.isFinite(f) && f > 0) workout.fileFtpWatts = f;
        }
      } else {
        const up = line.toUpperCase();
        if (unit === undefined && up.includes('PERCENT')) unit = 'percent';
        else if (unit === undefined && up.includes('WATTS')) unit = 'watts';
        if (up.includes('SECONDS')) timeUnit = 'seconds';
      }
    } else if (section === 'COURSE DATA') {
      const parts = line.split(/\s+/);
      const t = Number(parts[0]);
      const p = Number(parts[1]);
      if (Number.isFinite(t) && Number.isFinite(p)) points.push([timeUnit === 'minutes' ? t * 60 : t, p]);
    } else if (section === 'COURSE TEXT') {
      const parts = line.split('\t');
      const t = Number(parts[0]);
      if (Number.isFinite(t) && parts[1]) {
        const d = Number(parts[2]);
        texts.push(Number.isFinite(d) ? { t, message: parts[1].trim(), d } : { t, message: parts[1].trim() });
      }
    }
  }

  const u = unit ?? 'watts';
  const scale = u === 'percent' ? 0.01 : 1;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ta, pa] = points[i]!;
    const [tb, pb] = points[i + 1]!;
    const d = tb - ta;
    if (d <= 0) continue;
    const step: WorkoutStep = {
      kind: pa === pb ? 'steady' : 'ramp',
      mode: 'erg',
      durationS: d,
      powerStart: pa * scale,
      powerEnd: pb * scale,
      powerUnit: u === 'percent' ? 'ftp' : 'watts',
    };
    const evs: WorkoutTextEvent[] = [];
    for (const tx of texts) {
      if (tx.t >= ta && tx.t < tb) {
        const ev: WorkoutTextEvent = { offsetS: tx.t - ta, message: tx.message };
        if (tx.d !== undefined) ev.durationS = tx.d;
        evs.push(ev);
      }
    }
    if (evs.length) step.textEvents = evs;
    workout.steps.push(step);
  }
  return workout;
}
