/**
 * Modes groupe et course (simulation pure) : contrôle de puissance, primes KOM / sprint,
 * abandon, mise hors course, heure limite et hors délai, places des IA au salon, allure
 * annoncée, groupe scindé et regroupement.
 */
import { describe, expect, it } from 'vitest';
import type { RideEventMsg, TelemetryMsg } from '@allezrobert/shared';
import { PowerGuard, POWER_LIMITS } from '../src/ride/power-guard.ts';
import { RideSimulation, resolveRideOptions, type SimRider } from '../src/ride/simulation.ts';
import { proceduralLoop } from '../src/ride/routes.ts';

const T0 = Date.UTC(2026, 9, 25, 9, 0, 0);
const route = proceduralLoop();

function sim(opts: Parameters<typeof resolveRideOptions>[0] = {}, seed = 'race'): RideSimulation {
  return new RideSimulation(route, resolveRideOptions(opts, route.id), T0, { seed });
}

function telem(watts: number, seq: number): TelemetryMsg {
  return { seq, t: 0, watts, cadence: 90, gear: 12, steer: 0 };
}

/** Fait rouler `seconds` s ; `power(r)` = puissance de chaque humain (null = rien envoyé). */
function ride(s: RideSimulation, seconds: number, now0: number, power: (r: SimRider) => number | null, events?: RideEventMsg[], until?: () => boolean): number {
  let now = now0;
  const steps = Math.round(seconds * 10);
  for (let i = 0; i < steps; i++) {
    now += 100;
    for (const r of s.riders) {
      if (r.kind === 'ai') continue;
      const w = power(r);
      if (w !== null) s.setTelemetry(r.id, telem(w, s.tick), now);
    }
    const res = s.step(now, 0.1);
    events?.push(...res.events);
    if (until?.()) break;
  }
  return now;
}

describe('PowerGuard — règles anti-triche simples', () => {
  it('laisse passer un effort humain plausible', () => {
    const g = new PowerGuard(75);
    // 20 min à 5 W/kg avec des relances à 900 W : rien n'est plafonné.
    for (let i = 0; i < 12_000; i++) {
      const w = i % 600 < 80 ? 900 : 375;
      expect(g.filter(w, 0.1).capped).toBe(false);
    }
    expect(g.violationS).toBe(0);
  });

  it('ignore un pic isolé de capteur, mais pas une vraie accélération', () => {
    const g = new PowerGuard(75);
    for (let i = 0; i < 50; i++) g.filter(200, 0.1);
    expect(g.filter(1800, 0.1).watts).toBe(200);
    expect(g.filter(210, 0.1).watts).toBe(210);
    expect(g.spikes).toBe(1);
    // Sprint réel : retardé d'un paquet seulement.
    expect(g.filter(1100, 0.1).watts).toBe(210);
    expect(g.filter(1150, 0.1).watts).toBe(1150);
  });

  it("plafonne l'invraisemblable et cumule le temps en infraction", () => {
    const g = new PowerGuard(70);
    let sum = 0;
    const n = 1200; // 2 min
    for (let i = 0; i < n; i++) {
      const r = g.filter(1200, 0.1); // 17 W/kg tenus : impossible sur 1 min
      sum += r.watts;
      expect(r.watts).toBeLessThanOrEqual(30 * 70);
    }
    const oneMin = POWER_LIMITS.find((l) => l.windowS === 60)!.maxWkg * 70;
    expect(sum / n).toBeLessThanOrEqual(oneMin + 1);
    expect(g.violationS).toBeGreaterThan(30);
  });
});

describe('Course', () => {
  /** Course d'un tour : salon, 3 s de compte à rebours, départ. */
  function race(opts: Parameters<typeof resolveRideOptions>[0] = {}) {
    const s = sim({ mode: 'race', laps: 1, ...opts });
    const now = ride(s, 0.5, T0, () => 0);
    s.startCountdown(now, 3);
    return { s, now: ride(s, 3.2, now, () => 0) };
  }

  it('primes KOM : ordre de passage au sommet, points 5 / 3 / 1, report au classement', () => {
    const { s, now: t } = race();
    s.addRider({ id: 'a', name: 'A', kind: 'human', userId: 'u1' }, t);
    s.addRider({ id: 'b', name: 'B', kind: 'human', userId: 'u2' }, t);
    s.addRider({ id: 'c', name: 'C', kind: 'human', userId: 'u3' }, t);
    s.addRider({ id: 'd', name: 'D', kind: 'human', userId: 'u4' }, t);
    expect(s.riders.every((r) => r.lateJoin)).toBe(true);
    // Les coureurs arrivés après le départ ne sont pas classés : on relance une course propre.
    const s2 = sim({ mode: 'race', laps: 1 });
    for (const id of ['a', 'b', 'c', 'd']) s2.addRider({ id, name: id.toUpperCase(), kind: 'human', userId: `u-${id}` }, T0);
    let now = ride(s2, 0.5, T0, () => 0);
    s2.startCountdown(now, 3);
    const events: RideEventMsg[] = [];
    const watts: Record<string, number> = { a: 330, b: 300, c: 270, d: 240 };
    now = ride(s2, 2400, now, (r) => watts[r.id] ?? 0, events, () => s2.phase === 'finished');
    const primes = events.filter((e) => e.kind === 'prime') as Array<Extract<RideEventMsg, { kind: 'prime' }>>;
    const kom = primes.filter((p) => p.segmentKind === 'kom');
    expect(kom.map((p) => [p.riderId, p.place, p.points])).toEqual([
      ['a', 1, 5],
      ['b', 2, 3],
      ['c', 3, 1],
    ]);
    const res = (events.find((e) => e.kind === 'results') as Extract<RideEventMsg, { kind: 'results' }>).results;
    expect(res.map((r) => r.riderId)).toEqual(['a', 'b', 'c', 'd']);
    expect(res[0]).toMatchObject({ status: 'finished', rank: 1, gapMs: 0 });
    expect(res[1]!.gapMs).toBeGreaterThan(0);
    expect(res.find((r) => r.riderId === 'a')!.komPts).toBeGreaterThanOrEqual(5);
    expect(res.find((r) => r.riderId === 'd')!.komPts).toBe(0);
    // Heure limite annoncée à la première arrivée.
    const dl = events.find((e) => e.kind === 'deadline') as Extract<RideEventMsg, { kind: 'deadline' }>;
    expect(dl.at).toBeGreaterThan(now - 15 * 60_000);
  });

  it('abandon : un coureur qui part est classé DNF, les autres continuent', () => {
    const s = sim({ mode: 'race', laps: 1 });
    s.addRider({ id: 'a', name: 'A', kind: 'human', userId: 'u1' }, T0);
    s.addRider({ id: 'b', name: 'Bob', kind: 'human', userId: 'u2' }, T0);
    let now = ride(s, 0.5, T0, () => 0);
    s.startCountdown(now, 3);
    const events: RideEventMsg[] = [];
    now = ride(s, 60, now, () => 250, events);
    s.removeRider('b');
    now = ride(s, 2400, now, () => 260, events, () => s.phase === 'finished');
    expect(events).toContainEqual({ kind: 'abandon', riderId: 'b', name: 'Bob' });
    const res = (events.find((e) => e.kind === 'results') as Extract<RideEventMsg, { kind: 'results' }>).results;
    expect(res[0]).toMatchObject({ riderId: 'a', rank: 1, status: 'finished' });
    expect(res.find((r) => r.riderId === 'b')).toMatchObject({ status: 'dnf', rank: 0 });
    expect(res.find((r) => r.riderId === 'b')!.distM).toBeGreaterThan(300);
  });

  it('puissance invraisemblable : avertissement, puis mise hors course ; le classement continue', () => {
    const s = sim({ mode: 'race', laps: 1 });
    s.addRider({ id: 'cheat', name: 'Tricheur', kind: 'human', userId: 'u1', riderMassKg: 70 }, T0);
    s.addRider({ id: 'ok', name: 'Honnête', kind: 'human', userId: 'u2' }, T0);
    let now = ride(s, 0.5, T0, () => 0);
    s.startCountdown(now, 3);
    const events: RideEventMsg[] = [];
    now = ride(s, 2400, now, (r) => (r.id === 'cheat' ? 1400 : 260), events, () => s.phase === 'finished');
    const flags = events.filter((e) => e.kind === 'flag') as Array<Extract<RideEventMsg, { kind: 'flag' }>>;
    expect(flags.map((f) => [f.riderId, f.action])).toEqual([
      ['cheat', 'warn'],
      ['cheat', 'dq'],
    ]);
    const res = (events.find((e) => e.kind === 'results') as Extract<RideEventMsg, { kind: 'results' }>).results;
    expect(res[0]).toMatchObject({ riderId: 'ok', rank: 1, status: 'finished' });
    expect(res.find((r) => r.riderId === 'cheat')).toMatchObject({ rank: 0, status: 'dq' });
    expect(s.phase).toBe('finished');
  });

  it("hors délai : la course se termine à l'heure limite, le retardataire est « otl »", () => {
    const s = sim({ mode: 'race', laps: 1 });
    s.addRider({ id: 'fast', name: 'Rapide', kind: 'human', userId: 'u1' }, T0);
    s.addRider({ id: 'slow', name: 'Escargot', kind: 'human', userId: 'u2' }, T0);
    let now = ride(s, 0.5, T0, () => 0);
    s.startCountdown(now, 3);
    const events: RideEventMsg[] = [];
    now = ride(s, 4000, now, (r) => (r.id === 'fast' ? 320 : 40), events, () => s.phase === 'finished');
    expect(s.phase).toBe('finished');
    const res = (events.find((e) => e.kind === 'results') as Extract<RideEventMsg, { kind: 'results' }>).results;
    expect(res[0]).toMatchObject({ riderId: 'fast', status: 'finished' });
    expect(res[1]).toMatchObject({ riderId: 'slow', status: 'otl', rank: 0 });
    // Accueil d'un coureur qui (re)joint : classement et heure limite fournis.
    expect(s.liveResults()?.length).toBe(2);
    expect(s.deadline).toBeDefined();
  });

  it("IA au salon : chaque humain qui arrive prend la place d'une IA", () => {
    const s = sim({ mode: 'race', aiRiders: 3 });
    s.addRider({ id: 'h1', name: 'H1', kind: 'human', userId: 'u1' }, T0);
    s.addAiRiders(3, T0, 250);
    expect(s.riders).toHaveLength(4);
    expect(s.yieldAiSlot()).toBeNull();
    s.addRider({ id: 'h2', name: 'H2', kind: 'human', userId: 'u2' }, T0);
    expect(s.yieldAiSlot()?.kind).toBe('ai');
    expect(s.riders).toHaveLength(4);
    expect(s.riders.filter((r) => r.kind === 'ai')).toHaveLength(2);
    // Une fois la course lancée, plus de remplacement.
    s.startCountdown(T0, 3);
    s.step(T0 + 4000, 0.1);
    s.addRider({ id: 'h3', name: 'H3', kind: 'human', userId: 'u3' }, T0 + 4000);
    expect(s.yieldAiSlot()).toBeNull();
  });
});

describe('Sortie de groupe', () => {
  it('allure annoncée : bornée, diffusée, et les IA la tiennent', () => {
    const paceAfter = (pace: number | null): number => {
      const s = sim({ mode: 'group', aiRiders: 4 }, 'pace');
      s.addRider({ id: 'h', name: 'H', kind: 'human', userId: 'u1', riderMassKg: 75 }, T0);
      s.addAiRiders(4, T0, 250);
      s.updateHostOptions({ paceWkg: pace });
      ride(s, 90, T0, () => 100);
      return s.groupPace;
    };
    const s = sim({ mode: 'group' });
    expect(s.updateHostOptions({ paceWkg: 9 }).paceWkg).toBe(6);
    expect(s.updateHostOptions({ paceWkg: null }).paceWkg).toBeNull();
    expect(resolveRideOptions({ paceWkg: 2.8 }, route.id).paceWkg).toBe(2.8);
    // Sans annonce, les IA suivent l'allure des humains (100 W / 75 kg) ; avec, l'allure annoncée.
    expect(paceAfter(null)).toBeCloseTo(100 / 75, 1);
    expect(paceAfter(3.5)).toBeCloseTo(3.5, 1);
  });

  it('meneur : seul un humain présent peut être désigné', () => {
    const s = sim({ mode: 'group' });
    s.addRider({ id: 'h', name: 'H', kind: 'human', userId: 'u1' }, T0);
    s.addAiRiders(1, T0);
    expect(s.updateHostOptions({ leaderId: 'ai-1' }).leaderId).toBe('');
    expect(s.updateHostOptions({ leaderId: 'h' }).leaderId).toBe('h');
  });

  it('groupe scindé : alerte, puis regroupement doux jusqu’à moins de 20 m', () => {
    const s = sim({ mode: 'group' });
    s.addRider({ id: 'fort', name: 'Fort', kind: 'human', userId: 'u1' }, T0);
    s.addRider({ id: 'faible', name: 'Faible', kind: 'human', userId: 'u2' }, T0);
    const events: RideEventMsg[] = [];
    let now = ride(s, 900, T0, (r) => (r.id === 'fort' ? 300 : 150), events, () => events.some((e) => e.kind === 'split'));
    const split = events.find((e) => e.kind === 'split') as Extract<RideEventMsg, { kind: 'split' }>;
    expect(split.gapM).toBeGreaterThanOrEqual(150);
    // Une seule alerte tant que l'écart ne se résorbe pas.
    now = ride(s, 30, now, (r) => (r.id === 'fort' ? 300 : 150), events);
    expect(events.filter((e) => e.kind === 'split')).toHaveLength(1);
    expect(s.setRegroup(true, now)).toMatchObject({ kind: 'regroup', active: true });
    expect(s.setRegroup(true, now)).toBeNull();
    const before = events.length;
    // Chacun garde son allure : c'est l'élastique qui ramène le groupe (sans téléportation).
    let maxJump = 0;
    const prev = new Map(s.riders.map((r) => [r.id, r.state.distM]));
    now = ride(s, 180, now, (r) => (r.id === 'fort' ? 230 : 190), events, () => {
      for (const r of s.riders) {
        maxJump = Math.max(maxJump, Math.abs(r.state.distM - prev.get(r.id)! - r.state.speedMs * 0.1));
        prev.set(r.id, r.state.distM);
      }
      return events.slice(before).some((e) => e.kind === 'regroup');
    });
    const end = events.slice(before).find((e) => e.kind === 'regroup') as Extract<RideEventMsg, { kind: 'regroup' }>;
    expect(end).toMatchObject({ active: false });
    expect(end.spreadM).toBeLessThanOrEqual(20);
    expect(maxJump).toBeLessThan(0.5);
    expect(s.regrouping).toBe(false);
  });
});
