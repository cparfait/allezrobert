import { describe, expect, it } from 'vitest';
import { FOLLOW_GAP_M, HARD_GAP_M, LANE_CLEAR_M, followSpeed, keepApart, keepClearOfRiders, leaderOf, oncomingInLane, type Spaced } from '../src/world/trafficSpacing.ts';

const lane = (sens: 1 | -1) => sens * 1.45;
const car = (d: number, sens: 1 | -1, speed: number, length = 4.5): Spaced & { cruise: number } => ({ d, sens, length, speed, cruise: speed, lateral: lane(sens) });

/** Pas de la circulation réduit à l'espacement (mêmes règles que Traffic.update). */
function step(all: Array<Spaced & { cruise: number }>, dt: number): void {
  for (const v of all) {
    let target = v.cruise;
    let brake = 4;
    const lead = leaderOf(v, all);
    if (lead) {
      const safe = followSpeed(lead.gap, lead.leader.speed);
      if (safe < target) target = safe;
      if (safe < v.speed) brake = 8;
    }
    v.speed = Math.max(0, v.speed + Math.max(-brake * dt, Math.min(2 * dt, target - v.speed)));
    v.d += v.sens * v.speed * dt;
  }
  keepApart(all, lane);
}

/** Plus petit écart de pare-chocs à pare-chocs entre véhicules de même sens. */
function minGap(all: Spaced[]): number {
  let m = Infinity;
  for (const v of all) {
    const l = leaderOf(v, all);
    if (l) m = Math.min(m, l.gap);
  }
  return m;
}

describe('espacement de la circulation', () => {
  it('vitesse de suivi : arrêt à FOLLOW_GAP_M derrière un véhicule arrêté, sa vitesse à cet écart', () => {
    expect(followSpeed(FOLLOW_GAP_M, 0)).toBe(0);
    expect(followSpeed(FOLLOW_GAP_M, 12)).toBeCloseTo(12, 9);
    expect(followSpeed(FOLLOW_GAP_M + 50, 0)).toBeCloseTo(20, 9);
  });

  it('le véhicule de devant dépend du sens de marche', () => {
    const a = car(100, -1, 15);
    const b = car(150, -1, 15);
    const c = car(120, 1, 15);
    expect(leaderOf(b, [a, b, c])?.leader).toBe(a);
    expect(leaderOf(a, [a, b, c])).toBeNull();
    expect(leaderOf(c, [a, b, c])).toBeNull();
  });

  it('une voiture lancée à 20 m/s s’arrête derrière une voiture arrêtée sans la toucher', () => {
    const stopped = car(100, 1, 0);
    stopped.cruise = 0;
    const fast = car(80, 1, 20);
    const all = [stopped, fast];
    for (let t = 0; t < 20; t += 1 / 60) {
      step(all, 1 / 60);
      expect(minGap(all)).toBeGreaterThanOrEqual(HARD_GAP_M - 1e-9);
    }
    expect(fast.speed).toBeLessThan(0.01);
  });

  it('une file derrière un tracteur prend sa vitesse, sans chevauchement, dans les deux sens', () => {
    for (const sens of [1, -1] as const) {
      const tractor = car(sens * 300, sens, 7, 4.3);
      const all = [tractor, car(sens * 260, sens, 20), car(sens * 240, sens, 22), car(sens * 225, sens, 18)];
      for (let t = 0; t < 60; t += 1 / 60) {
        step(all, 1 / 60);
        expect(minGap(all)).toBeGreaterThanOrEqual(HARD_GAP_M - 1e-9);
      }
      for (const v of all) expect(v.speed).toBeCloseTo(7, 1);
    }
  });

  it('une voiture réapparue sur une autre est reculée derrière elle et ne la double pas', () => {
    const front = car(100, 1, 10);
    const back = car(98, 1, 25);
    keepApart([back, front], lane);
    expect(front.d - back.d).toBeCloseTo(4.5 + HARD_GAP_M, 9);
    expect(back.speed).toBe(10);
  });

  it('un dépassement surpris par une voiture en face est ramené dans sa voie avant de la toucher', () => {
    const overtaking = car(100, 1, 20);
    overtaking.lateral = -1.75; // déboîté dans la voie d'en face
    const oncoming = car(103, -1, 20);
    expect(oncomingInLane(overtaking, [overtaking, oncoming], 120)).toBe(true);
    keepApart([overtaking, oncoming], lane);
    expect(overtaking.lateral).toBe(lane(1));
    expect(oncoming.lateral).toBe(lane(-1));
    expect(Math.abs(overtaking.lateral - oncoming.lateral)).toBeGreaterThanOrEqual(LANE_CLEAR_M);
  });

  it('deux voitures qui se croisent chacune dans sa voie ne se gênent pas', () => {
    const a = car(100, 1, 20);
    const b = car(101, -1, 20);
    expect(oncomingInLane(a, [a, b], 120)).toBe(false);
    keepApart([a, b], lane);
    expect(a.lateral).toBe(lane(1));
    expect(b.lateral).toBe(lane(-1));
  });
});

describe('keepClearOfRiders', () => {
  const car = (d: number, lateral: number, sens: 1 | -1 = 1, speed = 20) => ({ d, sens, length: 4.4, speed, lateral });

  it('une voiture qui rattrape un coureur sans s\'être écartée reste derrière lui, à sa vitesse', () => {
    const v = car(98, 1.6);
    const n = keepClearOfRiders([v], [{ distM: 100, lateral: 1.4, speedMs: 8 }]);
    expect(n).toBe(1);
    expect(v.d + v.length / 2).toBeLessThanOrEqual(100 - 1.8 - 0.5 + 1e-9);
    expect(v.speed).toBe(8);
  });

  it('déboîtée (assez d\'écart latéral), elle passe sans correction', () => {
    const v = car(99, -0.4);
    expect(keepClearOfRiders([v], [{ distM: 100, lateral: 1.4, speedMs: 8 }])).toBe(0);
    expect(v.d).toBe(99);
  });

  it('en face dans la voie du coureur : arrêtée devant lui', () => {
    const v = car(101, 1.2, -1);
    keepClearOfRiders([v], [{ distM: 100, lateral: 1.4, speedMs: 8 }]);
    expect(v.d - v.length / 2).toBeGreaterThanOrEqual(100.3 - 1e-9);
    expect(v.speed).toBe(0);
  });

  it('déjà passée devant : poussée devant, pas ramenée derrière', () => {
    const v = car(101.5, 1.2);
    keepClearOfRiders([v], [{ distM: 100, lateral: 1.4, speedMs: 8 }]);
    expect(v.d - v.length / 2).toBeGreaterThanOrEqual(100.3 - 1e-9);
  });
});
