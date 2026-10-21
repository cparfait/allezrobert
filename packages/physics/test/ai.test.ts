import { describe, expect, it } from 'vitest';
import {
  AiRider,
  createRiderState,
  DraftCalculator,
  paramsFromBike,
  SeededRng,
  stepRider,
  type AiOutput,
  type AiProfileName,
  type DraftRider,
} from '../src/index.ts';

describe('RNG', () => {
  it('déterministe et uniforme', () => {
    const a = new SeededRng('robert');
    const b = new SeededRng('robert');
    const xs = Array.from({ length: 1000 }, () => a.next());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b.next()));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new SeededRng(1).next()).not.toBe(new SeededRng(2).next());
  });
});

interface Sim {
  ai: AiRider;
  state: ReturnType<typeof createRiderState>;
  lateral: number;
  out: AiOutput | null;
}

/** Mini-serveur : groupe d'IA sur un profil plat puis une côte de 2 km à 7 %. */
function runGroup(seed: number, seconds = 900, dt = 0.1) {
  const profiles: AiProfileName[] = ['diesel', 'puncheur', 'sprinter', 'rouleur', 'rouleur', 'puncheur'];
  const sims: Sim[] = profiles.map((p, i) => {
    const params = paramsFromBike(65 + i * 3);
    return {
      ai: new AiRider({ id: `ai${i}`, profile: p, ftpWatts: 240 + 10 * i, params, seed: seed * 100 + i }),
      state: createRiderState({ distM: 100 - i * 2.3, speedMs: 10 }),
      lateral: 0,
      out: null,
    };
  });
  const draft = new DraftCalculator();
  const view: DraftRider[] = sims.map((s) => ({ distM: s.state.distM, lateralM: s.lateral, speedMs: s.state.speedMs }));
  const trace: number[] = [];
  const states = new Set<string>();
  for (let t = 0; t < seconds; t += dt) {
    sims.forEach((s, i) => {
      view[i]!.distM = s.state.distM;
      view[i]!.lateralM = s.lateral;
      view[i]!.speedMs = s.state.speedMs;
    });
    const red = draft.compute(view);
    const order = sims.map((_, i) => i).sort((a, b) => sims[b]!.state.distM - sims[a]!.state.distM);
    const leader = sims[order[0]!]!;
    order.forEach((idx, rank) => {
      const s = sims[idx]!;
      const grade = s.state.distM > 5000 && s.state.distM < 7000 ? 7 : 0;
      const ahead = rank > 0 ? sims[order[rank - 1]!]! : undefined;
      const attacker = leader !== s && leader.ai.state === 'attack' ? leader : undefined;
      const out = s.ai.update(
        {
          gradePercent: grade,
          speedMs: s.state.speedMs,
          groupPaceWkg: 2.8,
          gapAheadM: ahead ? ahead.state.distM - s.state.distM - 1.75 : Infinity,
          speedAheadMs: ahead ? ahead.state.speedMs : 0,
          lateralAheadM: ahead ? ahead.lateral - s.lateral : 0,
          positionInGroup: rank,
          groupSize: sims.length,
          cdaFactor: 1 - red[idx]!,
          segment: { kind: 'kom', distToStartM: 5000 - s.state.distM, distToEndM: 7000 - s.state.distM },
          ...(attacker ? { attack: { riderId: attacker.ai.id, gapM: attacker.state.distM - s.state.distM, speedMs: attacker.state.speedMs } } : {}),
        },
        dt,
      );
      states.add(out.state);
      s.lateral += (out.lateralTargetM - s.lateral) * Math.min(1, dt);
      stepRider(s.state, { watts: out.watts, gradePercent: grade, params: s.ai.params, cdaFactor: 1 - red[idx]! }, dt);
      trace.push(out.watts);
    });
  }
  return { trace, sims, states };
}

describe('coureurs IA', () => {
  it('même graine ⇒ mêmes sorties, autre graine ⇒ sorties différentes', () => {
    const a = runGroup(7, 300);
    const b = runGroup(7, 300);
    const c = runGroup(8, 300);
    expect(a.trace).toEqual(b.trace);
    expect(a.trace).not.toEqual(c.trace);
  });
  it('roule en groupe, prend des relais, attaque en côte et reste dans des puissances plausibles', () => {
    const { trace, sims, states } = runGroup(42, 1200);
    expect(states.has('pull')).toBe(true);
    expect(states.has('follow')).toBe(true);
    expect(states.has('attack')).toBe(true);
    expect(Math.max(...trace)).toBeLessThan(260 + 50 + 3.2 * 300);
    expect(trace.every((w) => w >= 0 && Number.isFinite(w))).toBe(true);
    // Tout le monde a avancé à une allure de groupe raisonnable.
    for (const s of sims) {
      expect(s.state.distM).toBeGreaterThan(5000);
      expect(s.ai.wPrime.balance).toBeLessThanOrEqual(s.ai.wPrime.wPrime);
    }
  });
  it('W′ épuisé ⇒ puissance plafonnée sous la FTP', () => {
    const ai = new AiRider({ id: 'x', profile: 'puncheur', ftpWatts: 250, params: paramsFromBike(70), seed: 1 });
    ai.wPrime.balance = -100;
    let out: AiOutput | null = null;
    for (let i = 0; i < 100; i++) {
      out = ai.update({ gradePercent: 8, speedMs: 4, groupPaceWkg: 5, gapAheadM: Infinity, speedAheadMs: 0, positionInGroup: 0, groupSize: 1 }, 0.1);
    }
    expect(out!.watts).toBeLessThanOrEqual(250);
  });
});
