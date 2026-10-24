import type { QualityLevel } from './quality.ts';

/** Ce que WebGPU dit de la carte graphique (`GPUAdapter.info`) ; les champs peuvent être vides. */
export interface AdapterInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  isFallbackAdapter?: boolean;
}

export interface HostInfo {
  cores?: number;
  memoryGb?: number;
}

const LEVELS: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

function lower(l: QualityLevel): QualityLevel {
  return LEVELS[Math.max(LEVELS.indexOf(l) - 1, 0)] as QualityLevel;
}

/**
 * Préréglage de départ selon la carte graphique, jamais au-dessus de « high » (ultra reste un choix).
 * Heuristique volontairement prudente : la résolution dynamique rattrape une erreur d'estimation.
 */
export function classifyAdapter(info: AdapterInfo, host: HostInfo = {}): QualityLevel {
  if (info.isFallbackAdapter) return 'low';
  const vendor = (info.vendor ?? '').toLowerCase();
  const arch = (info.architecture ?? '').toLowerCase();
  const text = `${info.description ?? ''} ${info.device ?? ''} ${arch}`.toLowerCase();
  let level: QualityLevel = 'medium';

  if (vendor.includes('nvidia') || /geforce|rtx|gtx/.test(text)) {
    const model = /\b(?:rtx|gtx)?\s?(\d{4})\b/.exec(text);
    const num = model ? Number(model[1]) : 0;
    const tail = num % 100;
    if (/\bmx\s?\d/.test(text)) level = 'low';
    else if (/gtx/.test(text) || /pascal|maxwell/.test(arch)) level = num >= 1070 && num < 1600 ? 'high' : 'medium';
    else if (num >= 2000) level = tail >= 60 && ![2050, 3050, 4050, 5050].includes(num) ? 'high' : 'medium';
    else level = /turing|ampere|ada|blackwell/.test(arch) ? 'high' : 'medium';
  } else if (vendor.includes('intel')) {
    level = /\barc\b/.test(text) || /xe-hpg/.test(arch) ? 'medium' : 'low';
  } else if (vendor.includes('amd') || vendor.includes('ati') || /radeon/.test(text)) {
    const rx = /\brx\s?(\d{3,4})/.exec(text);
    if (rx) {
      level = Number(rx[1]) >= 6600 ? 'high' : 'medium';
    } else if (/radeon graphics|vega|\b\d{3}m\b|gcn/.test(text)) level = 'low';
  } else if (vendor.includes('apple')) {
    level = 'medium';
  }

  if ((host.cores !== undefined && host.cores <= 4) || (host.memoryGb !== undefined && host.memoryGb <= 4)) level = lower(level);
  return level;
}

/** Interroge WebGPU ; sans WebGPU le moteur retombe sur WebGL2, nettement plus lent : départ en « low ». */
export async function detectHardwareQuality(): Promise<QualityLevel> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: object): Promise<{ info?: AdapterInfo; requestAdapterInfo?: () => Promise<AdapterInfo>; isFallbackAdapter?: boolean } | null> } }).gpu;
    if (!gpu) return 'low';
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return 'low';
    const info = adapter.info ?? (await adapter.requestAdapterInfo?.()) ?? {};
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    return classifyAdapter({ ...info, isFallbackAdapter: info.isFallbackAdapter ?? adapter.isFallbackAdapter }, { cores: navigator.hardwareConcurrency, ...(mem !== undefined ? { memoryGb: mem } : {}) });
  } catch {
    return 'medium';
  }
}

/** Marches de la résolution dynamique, du plus net au plus flou. */
const STEPS = [1, 0.85, 0.72, 0.6, 0.5];
/** Images gardées pour comparer avant / après une baisse : la médiane résiste aux saccades (chargement, ramasse-miettes). */
const WINDOW = 120;
/** Images et durée minimales pour juger l'effet d'une baisse. */
const SETTLE_FRAMES = 90;
const SETTLE_MS = 3000;
/** Une baisse doit réduire le temps d'image médian d'au moins 10 % pour être gardée. */
const MIN_GAIN = 0.9;

function median(a: readonly number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/**
 * Résolution dynamique : ajuste l'échelle de rendu pour tenir la cadence visée. Alimentée par le temps
 * entre deux images ; ne touche à rien d'autre que le nombre de pixels. Garde-fous :
 * - une baisse est mise à l'épreuve : si le temps d'image médian ne baisse pas d'au moins 10 % après
 *   quelques secondes, le goulot n'est pas le nombre de pixels (processeur, chargement) : retour en arrière
 *   et pas de nouvel essai avant 2 minutes ;
 * - après une remontée aussitôt contredite, on attend longtemps avant de réessayer (pas de va-et-vient).
 */
export class DynamicResolution {
  private step = 0;
  private ema = 0;
  private lastChange = -Infinity;
  private lastUp = -Infinity;
  private blockUpUntil = 0;
  private blockDownUntil = 0;
  private upSince = -1;
  private recent: number[] = [];
  private pending: { before: number; prevStep: number; at: number; frames: number[] } | null = null;

  constructor(
    private readonly targetMs = 1000 / 60,
    private readonly minStep = STEPS.length - 1,
  ) {}

  get scale(): number {
    return STEPS[this.step] as number;
  }

  /** Force une échelle (réglage manuel) et réinitialise la mesure. */
  reset(step = 0): void {
    this.step = Math.min(Math.max(step, 0), this.minStep);
    this.ema = 0;
    this.recent = [];
    this.pending = null;
    this.upSince = -1;
  }

  /** @returns la nouvelle échelle si elle vient de changer, sinon null. */
  update(frameMs: number, nowMs: number): number | null {
    // Image hors cadence normale (onglet masqué, menu, chargement) : on ignore la mesure.
    if (!(frameMs > 0) || frameMs > 250) {
      this.ema = 0;
      this.upSince = -1;
      return null;
    }
    this.recent.push(frameMs);
    if (this.recent.length > WINDOW) this.recent.shift();
    this.pending?.frames.push(frameMs);
    this.ema = this.ema === 0 ? frameMs : this.ema * 0.92 + frameMs * 0.08;

    if (this.pending) {
      const p = this.pending;
      if (nowMs - p.at < SETTLE_MS || p.frames.length < SETTLE_FRAMES) return null;
      this.pending = null;
      if (median(p.frames) > p.before * MIN_GAIN) {
        // La baisse de résolution n'a rien apporté : le goulot n'est pas le nombre de pixels.
        this.step = p.prevStep;
        this.blockDownUntil = nowMs + 120000;
        this.lastChange = nowMs;
        this.recent = [];
        return this.scale;
      }
    }
    if (nowMs - this.lastChange < 1500 || this.recent.length < 45) return null;

    if (this.ema > this.targetMs * 1.2 && this.step < this.minStep && nowMs >= this.blockDownUntil) {
      if (nowMs - this.lastUp < 10000) this.blockUpUntil = nowMs + 30000;
      this.pending = { before: median(this.recent), prevStep: this.step, at: nowMs, frames: [] };
      this.step++;
      this.lastChange = nowMs;
      this.upSince = -1;
      return this.scale;
    }

    if (this.step > 0 && nowMs >= this.blockUpUntil && this.ema < this.targetMs * 0.7) {
      if (this.upSince < 0) this.upSince = nowMs;
      if (nowMs - this.upSince > 5000) {
        this.step--;
        this.lastChange = nowMs;
        this.lastUp = nowMs;
        this.upSince = -1;
        this.ema = 0;
        this.recent = [];
        return this.scale;
      }
    } else this.upSince = -1;
    return null;
  }
}
