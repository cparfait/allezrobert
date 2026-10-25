import { describe, expect, it } from 'vitest';
import { BUSES, DEFAULT_MIX, busGains, loadMix, saveMix } from '../src/audio/mix.ts';

function memory(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe('mixage', () => {
  it('valeurs par défaut sans stockage', () => {
    expect(loadMix(null)).toEqual(DEFAULT_MIX);
    expect(loadMix(memory())).toEqual(DEFAULT_MIX);
  });

  it('aller-retour, bornes et réglages corrompus', () => {
    const st = memory();
    saveMix({ ...DEFAULT_MIX, crowd: 0.2, breathOn: false }, st);
    expect(loadMix(st).crowd).toBe(0.2);
    expect(loadMix(st).breathOn).toBe(false);
    expect(loadMix(memory({ 'ar.sound': '{"bike":7,"traffic":-1,"crowd":"x"}' }))).toMatchObject({ bike: 1, traffic: 0, crowd: DEFAULT_MIX.crowd });
    expect(loadMix(memory({ 'ar.sound': '{oups' }))).toEqual(DEFAULT_MIX);
  });

  it('reprend l’ancien volume unique comme volume général', () => {
    expect(loadMix(memory({ 'ar.volume': '0.3' })).master).toBe(0.3);
  });

  it('pause : seule l’ambiance reste (atténuée) ; M coupe tout', () => {
    const run = busGains(DEFAULT_MIX, { paused: false, muted: false });
    const pause = busGains(DEFAULT_MIX, { paused: true, muted: false });
    for (const b of BUSES) expect(run[b]).toBe(DEFAULT_MIX[b]);
    expect(pause.bike + pause.breath + pause.crowd + pause.traffic).toBe(0);
    expect(pause.ambience).toBeCloseTo(DEFAULT_MIX.ambience / 2, 6);
    expect(busGains(DEFAULT_MIX, { paused: false, muted: true }).master).toBe(0);
  });

  it('souffle désactivable', () => {
    expect(busGains({ ...DEFAULT_MIX, breathOn: false }, { paused: false, muted: false }).breath).toBe(0);
  });
});
