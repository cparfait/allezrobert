import { describe, expect, it } from 'vitest';
import { overBudget, summarize, type Probe } from '../src/summary.ts';

const probe: Probe = {
  frames: 3600,
  gaps: [
    { t: 1000, d: 50 },
    { t: 2000, d: 120 },
    { t: 3000, d: 300 },
  ],
  gpu: { createRenderPipeline: { c: 2, ms: 0.2, max: 0.1 }, createRenderPipelineAsync: { c: 5, ms: 0.1, max: 0.1 } },
  shadersDuring: 4,
};

describe('mesure de fluidité : bilan', () => {
  it('compte les saccades, les pipelines et la cadence', () => {
    expect(summarize(probe, 60)).toEqual({ seconds: 60, fps: 60, stutters100: 2, stutters250: 1, worstMs: 300, pipelinesSync: 2, pipelinesAsync: 5, shaders: 4 });
  });

  it('budget : conforme, puis dépassé par les shaders et les saccades', () => {
    expect(overBudget(summarize(probe, 60))).toEqual([]);
    const bad = summarize({ ...probe, shadersDuring: 40, gaps: Array.from({ length: 8 }, (_, i) => ({ t: i * 1000, d: 400 })) }, 60);
    expect(overBudget(bad)).toHaveLength(2);
  });
});
