import { describe, expect, it } from 'vitest';
import { classifyAdapter, DynamicResolution } from '../src/engine/autoQuality.ts';
import { renderPixelRatio, viewportSize } from '../src/engine/display.ts';

describe('classifyAdapter', () => {
  it('classe les cartes courantes', () => {
    expect(classifyAdapter({ vendor: 'nvidia', architecture: 'ada', description: 'NVIDIA GeForce RTX 4090' })).toBe('high');
    expect(classifyAdapter({ vendor: 'nvidia', architecture: 'ampere', description: 'NVIDIA GeForce RTX 3050' })).toBe('medium');
    expect(classifyAdapter({ vendor: 'nvidia', architecture: 'pascal', description: 'GeForce GTX 1050 Ti' })).toBe('medium');
    expect(classifyAdapter({ vendor: 'intel', architecture: 'gen-12lp', description: 'Intel(R) UHD Graphics 770' })).toBe('low');
    expect(classifyAdapter({ vendor: 'intel', architecture: 'xe-hpg', description: 'Intel(R) Arc(TM) A770' })).toBe('medium');
    expect(classifyAdapter({ vendor: 'amd', architecture: 'rdna-3', description: 'AMD Radeon RX 7800 XT' })).toBe('high');
    expect(classifyAdapter({ vendor: 'amd', architecture: 'gcn-5', description: 'AMD Radeon(TM) Vega 8 Graphics' })).toBe('low');
  });
  it('carte logicielle ou machine modeste : on descend', () => {
    expect(classifyAdapter({ isFallbackAdapter: true })).toBe('low');
    expect(classifyAdapter({ vendor: 'nvidia', architecture: 'ada', description: 'RTX 4090' }, { cores: 4 })).toBe('medium');
    expect(classifyAdapter({ vendor: 'intel', description: 'UHD' }, { cores: 2 })).toBe('low');
  });
  it('ne dépasse jamais high', () => {
    expect(classifyAdapter({ vendor: 'nvidia', architecture: 'blackwell', description: 'RTX 5090' })).toBe('high');
  });
});

describe('format et pixels', () => {
  it('format maximal : fenêtre bornée et centrée', () => {
    expect(viewportSize(5120, 1440, 'full')).toEqual({ w: 5120, h: 1440 });
    expect(viewportSize(5120, 1440, '16:9')).toEqual({ w: 2560, h: 1440 });
    expect(viewportSize(1920, 1080, '21:9')).toEqual({ w: 1920, h: 1080 });
  });
  it('zone sûre de l’interface : bornée au format, jamais plus large que la fenêtre', () => {
    expect(viewportSize(5120, 1440, '21:9').w).toBe(3413);
    expect(viewportSize(2560, 1440, '21:9').w).toBe(2560);
    expect(viewportSize(3413, 1440, '16:9').w).toBe(2560);
  });
  it('plafond de pixels sur 32:9', () => {
    const base = { cssW: 5120, cssH: 1440, devicePixelRatio: 1, presetRatio: 1, userMaxPixels: Infinity };
    const r = renderPixelRatio({ ...base, presetMaxPixels: 2560 * 1440 });
    expect(5120 * 1440 * r * r).toBeCloseTo(2560 * 1440, -3);
    expect(renderPixelRatio({ ...base, cssW: 1920, cssH: 1080, presetMaxPixels: 2560 * 1440 })).toBe(1);
    expect(renderPixelRatio({ ...base, presetMaxPixels: Infinity, userMaxPixels: 1920 * 1080 })).toBeLessThan(0.55);
  });
  it('le plafond du joueur et l’échelle dynamique se cumulent, avec un plancher', () => {
    const i = { cssW: 1920, cssH: 1080, devicePixelRatio: 2, presetRatio: 1, presetMaxPixels: Infinity, userMaxPixels: Infinity };
    expect(renderPixelRatio(i)).toBe(2);
    expect(renderPixelRatio({ ...i, scale: 0.5 })).toBe(1);
    expect(renderPixelRatio({ ...i, presetRatio: 0.1 })).toBe(0.35);
  });
});

/** Simule des images dont le coût est proportionnel à la surface rendue (limite GPU) plus un coût fixe. */
function run(dyn: DynamicResolution, costMs: (scale: number) => number, seconds: number, start = 0): number {
  let now = start;
  while (now - start < seconds * 1000) {
    const ms = costMs(dyn.scale);
    now += ms;
    dyn.update(ms, now);
  }
  return now;
}

describe('DynamicResolution', () => {
  it('baisse la résolution quand le GPU est limitant, puis se stabilise sous la cible', () => {
    const dyn = new DynamicResolution(1000 / 60);
    run(dyn, (s) => 30 * s * s, 30);
    expect(dyn.scale).toBeLessThan(1);
    expect(30 * dyn.scale * dyn.scale).toBeLessThan(1000 / 60 * 1.25);
  });
  it('ne dégrade pas la résolution quand le processeur est le goulot', () => {
    const dyn = new DynamicResolution(1000 / 60);
    run(dyn, () => 30, 120);
    expect(dyn.scale).toBe(1);
  });
  it('remonte quand la machine a de la marge', () => {
    const dyn = new DynamicResolution(1000 / 60);
    const t = run(dyn, (s) => 30 * s * s, 20);
    expect(dyn.scale).toBeLessThan(1);
    run(dyn, () => 5, 60, t);
    expect(dyn.scale).toBe(1);
  });
  it('saccades de chargement sur un goulot processeur : la résolution revient à 100 %', () => {
    // Temps d'image irrégulier (30 à 120 ms) sans lien avec la résolution, comme dans le jeu mesuré.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      let r = seed * 7919;
      const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const dyn = new DynamicResolution(1000 / 60);
      run(dyn, () => 30 + rnd() * rnd() * 90, 100);
      expect(dyn.scale, `graine ${seed}`).toBe(1);
    }
  });
  it('ignore les images hors cadence (menu, onglet masqué)', () => {
    const dyn = new DynamicResolution(1000 / 60);
    for (let i = 0; i < 100; i++) dyn.update(900, i * 1000);
    expect(dyn.scale).toBe(1);
  });
});
