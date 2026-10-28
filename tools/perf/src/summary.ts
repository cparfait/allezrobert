/** Bilan d'une mesure de fluidité (voir measure.ts) et budget à tenir avant une version. */

export interface Probe {
  /** Images affichées pendant la mesure. */
  frames: number;
  /** Intervalles entre deux images de plus de 40 ms : instant (ms depuis le début) et durée. */
  gaps: Array<{ t: number; d: number }>;
  /** Appels WebGPU comptés : nombre, total et pire durée côté JavaScript (ms). */
  gpu: Record<string, { c: number; ms: number; max: number }>;
  /** Shaders créés pendant la mesure (codes WGSL distincts). */
  shadersDuring: number;
  /** Shaders créés avant la mesure (chargement, départ, premiers kilomètres). */
  shadersBefore?: number;
}

export interface Summary {
  seconds: number;
  fps: number;
  /** Saccades : images de plus de 100 ms, de plus de 250 ms, et la pire. */
  stutters100: number;
  stutters250: number;
  worstMs: number;
  /** Pipelines créés en direct (compilation bloquante) et à l'avance pendant la mesure. */
  pipelinesSync: number;
  pipelinesAsync: number;
  shaders: number;
}

export interface Budget {
  /** Shaders neufs tolérés en roulant (petits shaders de mipmaps compris). */
  shaders: number;
  /** Saccades de plus de 250 ms tolérées par minute. */
  stutters250PerMin: number;
}

export const DEFAULT_BUDGET: Budget = { shaders: 10, stutters250PerMin: 3 };

export function summarize(p: Probe, seconds: number): Summary {
  return {
    seconds,
    fps: Math.round(p.frames / seconds),
    stutters100: p.gaps.filter((g) => g.d > 100).length,
    stutters250: p.gaps.filter((g) => g.d > 250).length,
    worstMs: p.gaps.reduce((m, g) => Math.max(m, g.d), 0),
    pipelinesSync: p.gpu.createRenderPipeline?.c ?? 0,
    pipelinesAsync: p.gpu.createRenderPipelineAsync?.c ?? 0,
    shaders: p.shadersDuring,
  };
}

/** Dépassements du budget (liste vide : mesure conforme). */
export function overBudget(s: Summary, b: Budget = DEFAULT_BUDGET): string[] {
  const out: string[] = [];
  if (s.shaders > b.shaders) out.push(`${s.shaders} shaders compilés en roulant (budget ${b.shaders})`);
  const per = (s.stutters250 * 60) / s.seconds;
  if (per > b.stutters250PerMin) out.push(`${per.toFixed(1)} saccades > 250 ms par minute (budget ${b.stutters250PerMin})`);
  return out;
}

/** Détail du chargement jusqu'au départ de la sortie. */
export interface Startup {
  /** Repères « ar:… » posés par le jeu : nom et instant (ms depuis l'ouverture de la page). */
  marks: Array<{ name: string; t: number }>;
  /** Fichiers de monde reçus pendant le chargement, et leur taille décodée (Mo). */
  worldFiles: number;
  worldMB: number;
}

export function formatStartup(s: Startup): string {
  const sec = (ms: number, width: number) => (ms / 1000).toFixed(1).padStart(width);
  const lines = s.marks.map((m, i) => `  ${sec(m.t, 6)} s  +${sec(m.t - (s.marks[i - 1]?.t ?? 0), 5)} s  ${m.name}`);
  return ["chargement (instant depuis l'ouverture, écart avec le repère précédent) :", ...lines, `  fichiers de monde reçus : ${s.worldFiles} (${s.worldMB} Mo)`].join('\n');
}

export function formatSummary(s: Summary): string {
  return [
    `${s.fps} fps en moyenne sur ${s.seconds} s`,
    `saccades : ${s.stutters100} > 100 ms, ${s.stutters250} > 250 ms, pire ${s.worstMs} ms`,
    `shaders compilés en roulant : ${s.shaders} · pipelines en direct ${s.pipelinesSync}, à l'avance ${s.pipelinesAsync}`,
  ].join('\n');
}
