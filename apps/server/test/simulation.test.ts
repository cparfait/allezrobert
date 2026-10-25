import { describe, expect, it } from 'vitest';
import { decodeSnapshot, encodeSnapshot, type RideEventMsg, type RosterEntry, type TelemetryMsg } from '@allezrobert/shared';
import { RideSimulation, resolveRideOptions, type SimRider } from '../src/ride/simulation.ts';
import { proceduralLoop } from '../src/ride/routes.ts';

const T0 = Date.UTC(2026, 9, 25, 9, 0, 0);
const route = proceduralLoop();

function sim(opts: Parameters<typeof resolveRideOptions>[0] = {}, seed = 'test'): RideSimulation {
  return new RideSimulation(route, resolveRideOptions(opts, route.id), T0, { seed });
}

function telem(watts: number, seq: number, extra: Partial<TelemetryMsg> = {}): TelemetryMsg {
  return { seq, t: 0, watts, cadence: 90, gear: 12, steer: 0, ...extra };
}

/** Fait rouler la simulation `seconds` secondes ; `power(r)` = puissance de chaque humain. */
function ride(s: RideSimulation, seconds: number, now0: number, power: (r: SimRider) => number | null, onEvents?: (ev: RideEventMsg[]) => void): number {
  let now = now0;
  const steps = Math.round(seconds * 10);
  for (let i = 0; i < steps; i++) {
    now += 100;
    for (const r of s.riders) {
      if (r.kind === 'ai') continue;
      const w = power(r);
      if (w !== null) s.setTelemetry(r.id, telem(w, s.tick, r.kind === 'guest' ? {} : {}), now);
    }
    const res = s.step(now, 0.1);
    onEvents?.(res.events);
  }
  return now;
}

describe('RideSimulation — physique et aspiration', () => {
  it("abrite le coureur qui suit dans la roue et le fait rouler moins cher", () => {
    const s = sim({ mode: 'group' });
    const leader = s.addRider({ id: 'lead', name: 'Tête', kind: 'human', userId: 'u1', riderMassKg: 75 }, T0)!;
    const follower = s.addRider({ id: 'wheel', name: 'Roue', kind: 'human', userId: 'u2', riderMassKg: 75 }, T0)!;
    // Placement : le suiveur 2,5 m derrière (0,75 m roue-à-roue), même trajectoire.
    leader.state.distM = 100;
    follower.state.distM = 97.5;
    leader.state.speedMs = follower.state.speedMs = 10;
    leader.lateralM = leader.lateralTarget = follower.lateralM = follower.lateralTarget = 0;
    let now = T0;
    for (let i = 0; i < 600; i++) {
      now += 100;
      s.setTelemetry('lead', telem(250, i), now);
      // Le suiveur pousse 20 % de moins mais garde la roue grâce à l'aspiration.
      s.setTelemetry('wheel', telem(200, i), now);
      s.step(now, 0.1);
    }
    expect(follower.draft).toBeGreaterThan(0.2);
    expect(leader.state.distM - follower.state.distM).toBeLessThan(6);
    // Sans aspiration, 200 W contre 250 W lâche nettement en 60 s.
    const solo = sim({ mode: 'group', draftingStrength: 0 });
    const a = solo.addRider({ id: 'a', name: 'A', kind: 'human', userId: 'u1' }, T0)!;
    const b = solo.addRider({ id: 'b', name: 'B', kind: 'human', userId: 'u2' }, T0)!;
    a.state.distM = 100;
    b.state.distM = 97.5;
    a.state.speedMs = b.state.speedMs = 10;
    a.lateralM = a.lateralTarget = b.lateralM = b.lateralTarget = 0;
    now = T0;
    for (let i = 0; i < 600; i++) {
      now += 100;
      solo.setTelemetry('a', telem(250, i), now);
      solo.setTelemetry('b', telem(200, i), now);
      solo.step(now, 0.1);
    }
    expect(a.state.distM - b.state.distM).toBeGreaterThan(25);
  });

  it("calcule l'aspiration sur les distances dépliées à la ligne de tour", () => {
    const s = sim({ mode: 'group' });
    const L = s.length;
    const lead = s.addRider({ id: 'lead', name: 'Tête', kind: 'human', userId: 'u1' }, T0)!;
    const wheel = s.addRider({ id: 'wheel', name: 'Roue', kind: 'human', userId: 'u2' }, T0)!;
    lead.state.distM = L + 1; // tour 1, 1 m après la ligne
    wheel.state.distM = L - 1.5; // tour 0, juste avant
    lead.state.speedMs = wheel.state.speedMs = 10;
    lead.lateralM = lead.lateralTarget = wheel.lateralM = wheel.lateralTarget = 0;
    s.setTelemetry('lead', telem(250, 1), T0 + 100);
    s.setTelemetry('wheel', telem(250, 1), T0 + 100);
    const res = s.step(T0 + 100, 0.1);
    expect(wheel.draft).toBeGreaterThan(0.25);
    expect(res.events.some((e) => e.kind === 'lap' && e.riderId === 'wheel')).toBe(false);
    const rows = s.rows();
    const wRow = rows.find((r) => r.n === wheel.n)!;
    expect(wRow.lap).toBe(0);
    expect(rows.find((r) => r.n === lead.n)!.lap).toBe(1);
  });

  it('coureurs IA : allure réaliste, restent groupés avec un humain à 2,8 W/kg (sortie de groupe)', () => {
    const s = sim({ mode: 'group', aiRiders: 6 }, 'ai-seed');
    const human = s.addRider({ id: 'h', name: 'Humain', kind: 'human', userId: 'u1', riderMassKg: 75, ftpWatts: 260 }, T0)!;
    s.addAiRiders(6, T0, 260);
    expect(s.riders.filter((r) => r.kind === 'ai')).toHaveLength(6);
    const powers: number[] = [];
    ride(s, 600, T0, () => 210, () => {
      for (const r of s.riders) if (r.kind === 'ai') powers.push(r.watts);
    });
    const ais = s.riders.filter((r) => r.kind === 'ai');
    const avg = powers.reduce((a, b) => a + b, 0) / powers.length;
    expect(avg).toBeGreaterThan(80);
    expect(avg).toBeLessThan(400);
    expect(Math.max(...powers)).toBeLessThan(260 * 3.3);
    // Sortie de groupe : les IA restent autour de l'humain (regroupement), après 10 min.
    const near = ais.filter((a) => Math.abs(a.state.distM - human.state.distM) < 100).length;
    expect(near).toBeGreaterThanOrEqual(5);
    // Déterminisme : même graine ⇒ mêmes positions.
    const s2 = sim({ mode: 'group', aiRiders: 6 }, 'ai-seed');
    s2.addRider({ id: 'h', name: 'Humain', kind: 'human', userId: 'u1', riderMassKg: 75, ftpWatts: 260 }, T0);
    s2.addAiRiders(6, T0, 260);
    ride(s2, 600, T0, () => 210);
    expect(s2.riders.map((r) => Math.round(r.state.distM))).toEqual(s.riders.map((r) => Math.round(r.state.distM)));
  });

  it('vitesse moyenne visée : les IA se rapprochent de la cible, qui se règle en route', () => {
    const mean = (kmh: number | null, seconds: number) => {
      const s = sim({ mode: 'group', aiRiders: 4, ...(kmh ? { targetKmh: kmh } : {}) }, 'target-seed');
      // Seules les IA roulent : avec un humain, le groupe se cale sur lui (regroupement).
      s.addAiRiders(4, T0, 260);
      ride(s, seconds, T0, () => null);
      const ais = s.riders.filter((r) => r.kind === 'ai');
      return (ais.reduce((a, r) => a + r.state.distM / r.state.timeS, 0) / ais.length) * 3.6;
    };
    const slow = mean(24, 900);
    const fast = mean(34, 900);
    expect(fast - slow).toBeGreaterThan(8);
    expect(Math.abs(slow - 24)).toBeLessThan(5);
    expect(Math.abs(fast - 34)).toBeLessThan(6);
    // Hôte : la cible se modifie, et se libère.
    const s = sim({ mode: 'group', targetKmh: 28 });
    expect(s.updateHostOptions({ targetKmh: 31.4 }).targetKmh).toBe(31.5);
    expect(s.updateHostOptions({ targetKmh: null }).targetKmh).toBeNull();
  });

  it('groupe soudé : le plus faible reste dans le groupe', () => {
    for (const sticky of [true, false]) {
      const s = sim({ mode: 'group', stickyGroup: sticky });
      const strong = s.addRider({ id: 'f', name: 'Fort', kind: 'human', userId: 'u1' }, T0)!;
      const weak = s.addRider({ id: 'w', name: 'Faible', kind: 'human', userId: 'u2' }, T0)!;
      ride(s, 600, T0, (r) => (r.id === 'f' ? 300 : 150));
      const gap = strong.state.distM - weak.state.distM;
      if (sticky) expect(gap).toBeLessThanOrEqual(30.5);
      else expect(gap).toBeGreaterThan(300);
    }
  });
});

describe('RideSimulation — invités', () => {
  it('pilote automatique : accroché au groupe sans matériel', () => {
    const s = sim({ mode: 'group' });
    const a = s.addRider({ id: 'a', name: 'A', kind: 'human', userId: 'u1' }, T0)!;
    s.addRider({ id: 'b', name: 'B', kind: 'human', userId: 'u2' }, T0);
    const guest = s.addRider({ id: 'g', name: 'Invité', kind: 'guest', riderMassKg: 70 }, T0)!;
    let maxGap = 0;
    ride(
      s,
      300,
      T0,
      (r) => (r.kind === 'guest' ? null : 260),
      () => {
        maxGap = Math.max(maxGap, Math.abs(a.state.distM - guest.state.distM));
      },
    );
    expect(maxGap).toBeLessThan(25);
    expect(guest.watts).toBeGreaterThan(0);
    expect(guest.watts).toBeLessThanOrEqual(6 * 70);
  });

  it('accélérateur virtuel borné à 3,5 W/kg, puissance mesurée ignorée', () => {
    const s = sim({ mode: 'group' });
    s.addRider({ id: 'a', name: 'A', kind: 'human', userId: 'u1' }, T0);
    const guest = s.addRider({ id: 'g', name: 'Invité', kind: 'guest', riderMassKg: 70 }, T0)!;
    s.setTelemetry('g', telem(1500, 1, { guestThrottle: 5 }), T0 + 100);
    s.step(T0 + 100, 0.1);
    expect(guest.watts).toBeCloseTo(3.5 * 70, 5);
    s.setTelemetry('g', telem(1500, 2, { guestThrottle: 0.5 }), T0 + 200);
    s.step(T0 + 200, 0.1);
    expect(guest.watts).toBeCloseTo(0.5 * 3.5 * 70, 5);
  });
});

describe('RideSimulation — segments, tours et course', () => {
  it('chronomètre la côte (KOM) : départ, arrivée, rang, record personnel', () => {
    const s = sim({ mode: 'group' });
    const r = s.addRider({ id: 'h', name: 'Humain', kind: 'human', userId: 'u1' }, T0)!;
    r.state.distM = 2900;
    r.state.speedMs = 6;
    s.setPersonalBests('u1', [['dev-kom', 10 * 60_000]]);
    const events: RideEventMsg[] = [];
    let efforts = 0;
    let now = T0;
    for (let i = 0; i < 6000 && !events.some((e) => e.kind === 'segmentEnd'); i++) {
      now += 100;
      s.setTelemetry('h', telem(300, i), now);
      const res = s.step(now, 0.1);
      events.push(...res.events);
      efforts += res.efforts.length;
    }
    const start = events.find((e) => e.kind === 'segmentStart');
    const end = events.find((e) => e.kind === 'segmentEnd');
    expect(start).toMatchObject({ riderId: 'h', segmentId: 'dev-kom' });
    expect(end).toMatchObject({ riderId: 'h', segmentId: 'dev-kom', rank: 1, pr: true });
    // 1,2 km à 5 % à 300 W : entre 2 et 6 min.
    const ms = (end as { timeMs: number }).timeMs;
    expect(ms).toBeGreaterThan(120_000);
    expect(ms).toBeLessThan(360_000);
    expect(efforts).toBe(1);
  });

  it("course : compte à rebours, arrivée, classement sans les invités", () => {
    const s = sim({ mode: 'race', laps: 1 });
    expect(s.phase).toBe('lobby');
    s.addRider({ id: 'fast', name: 'Rapide', kind: 'human', userId: 'u1' }, T0);
    s.addRider({ id: 'slow', name: 'Lent', kind: 'human', userId: 'u2' }, T0);
    s.addRider({ id: 'guest', name: 'Invité', kind: 'guest' }, T0);
    // En salon, personne n'avance.
    let now = ride(s, 2, T0, () => 300);
    expect(Math.max(...s.riders.map((r) => r.state.distM))).toBeLessThanOrEqual(0);
    const cd = s.startCountdown(now, 3);
    expect(cd).toMatchObject({ kind: 'countdown' });
    const events: RideEventMsg[] = [];
    now = ride(s, 2000, now, (r) => (r.id === 'fast' ? 320 : r.id === 'slow' ? 200 : null), (ev) => events.push(...ev));
    expect(events.find((e) => e.kind === 'phase' && e.phase === 'running')).toBeTruthy();
    const finishes = events.filter((e) => e.kind === 'finish') as Array<{ riderId: string; rank: number; timeMs: number }>;
    expect(finishes.find((f) => f.riderId === 'fast')?.rank).toBe(1);
    expect(finishes.find((f) => f.riderId === 'slow')?.rank).toBe(2);
    const guestFinish = finishes.find((f) => f.riderId === 'guest');
    if (guestFinish) expect(guestFinish.rank).toBe(0);
    expect(s.phase).toBe('finished');
    const results = events.find((e) => e.kind === 'results') as { results: Array<{ riderId: string; rank: number }> };
    expect(results.results[0]).toMatchObject({ riderId: 'fast', rank: 1 });
    expect(results.results.find((r) => r.riderId === 'guest')?.rank).toBe(0);
    // Aucun effort de segment enregistré pour l'invité.
    expect(events.some((e) => e.kind === 'segmentEnd' && e.riderId === 'guest')).toBe(false);
  });

  it("instantané compact : aller-retour d'encodage", () => {
    const s = sim({ mode: 'group' });
    const r = s.addRider({ id: 'h', name: 'Humain', kind: 'human', userId: 'u1', shareHr: true }, T0)!;
    s.addRider({ id: 'x', name: 'Sans FC', kind: 'human', userId: 'u2' }, T0);
    s.setTelemetry('h', telem(234, 1, { hr: 151 }), T0 + 100);
    s.setTelemetry('x', telem(180, 1, { hr: 140 }), T0 + 100);
    s.step(T0 + 100, 0.1);
    const msg = encodeSnapshot(s.tick, T0 + 100, s.rows());
    const roster = new Map<number, RosterEntry>(s.roster('h').map((e) => [e.n, e]));
    const snap = decodeSnapshot(msg, roster);
    expect(snap.riders).toHaveLength(2);
    const h = snap.riders.find((x) => x.id === 'h')!;
    expect(h.watts).toBe(234);
    expect(h.hr).toBe(151);
    expect(h.distM).toBeCloseTo(r.row.distM, 2);
    // FC non diffusée sans consentement.
    expect(snap.riders.find((x) => x.id === 'x')!.hr).toBeUndefined();
  });
});

describe('RideSimulation — course contre les IA', () => {
  it('tactiques variées : des attaques, reproductibles avec la même graine', () => {
    const run = () => {
      const s = sim({ mode: 'race', aiRiders: 7 }, 'course-ia');
      s.addRider({ id: 'h', name: 'Humain', kind: 'human', userId: 'u1', riderMassKg: 72, ftpWatts: 250 }, T0);
      s.addAiRiders(7, T0, 250);
      const states = new Set<string>();
      ride(s, 1200, T0, () => 230, () => {
        for (const r of s.riders) if (r.ai) states.add(r.ai.state);
      });
      return { states, dist: s.riders.map((r) => Math.round(r.state.distM)) };
    };
    const a = run();
    expect(a.states.has('attack')).toBe(true);
    expect(run().dist).toEqual(a.dist);
  });
});
