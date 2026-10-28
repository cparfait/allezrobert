import { describe, expect, it } from 'vitest';
import { BIKE_LENGTH_M, BIKE_WIDTH_M, Overtaker, PASS_CLEAR_M, PASS_GAP_M, separateRiders, type Body, type LaneBody } from '../src/index.ts';

const HALF = 2.2;

describe('collisions : qui s’écarte', () => {
  it('le coureur mené par un humain n’est jamais déporté par une IA qui arrive de derrière', () => {
    const me: Body = { distM: 10, lateral: 1.2, speedMs: 8, priority: true };
    const ai: Body = { distM: 8.6, lateral: 1.2, speedMs: 11 };
    for (let i = 0; i < 90; i++) {
      ai.distM += ai.speedMs / 60;
      me.distM += me.speedMs / 60;
      separateRiders([me, ai], HALF, 1 / 60);
      expect(me.lateral).toBe(1.2);
      expect(me.speedMs).toBe(8);
      // L'IA ne traverse pas : écartée de côté ou retenue derrière.
      expect(Math.abs(me.lateral - ai.lateral) >= BIKE_WIDTH_M - 0.06 || me.distM - ai.distM >= BIKE_LENGTH_M - 0.01).toBe(true);
    }
    // Retenue dans la roue du joueur, sans l'avoir touché ni déporté.
    expect(me.distM - ai.distM).toBeGreaterThanOrEqual(BIKE_LENGTH_M - 0.01);
  });

  it('l’IA qui arrive de derrière double par la gauche à égalité de ligne', () => {
    const front: Body = { distM: 5, lateral: 1, speedMs: 8 };
    const rear: Body = { distM: 4.5, lateral: 1, speedMs: 11 };
    for (let i = 0; i < 40; i++) separateRiders([front, rear], HALF, 1 / 60);
    expect(rear.lateral).toBeLessThan(front.lateral);
    expect(front.lateral).toBe(1);
  });

  it('un humain rattrape une IA : c’est l’IA qui lui laisse la place', () => {
    const ai: Body = { distM: 20, lateral: 1, speedMs: 7 };
    const me: Body = { distM: 19, lateral: 1, speedMs: 10, priority: true };
    for (let i = 0; i < 60; i++) separateRiders([ai, me], HALF, 1 / 60);
    expect(me.lateral).toBe(1);
    expect(Math.abs(ai.lateral - me.lateral)).toBeGreaterThanOrEqual(BIKE_WIDTH_M - 0.06);
  });

  it('ne déplace pas un coureur imposé, et un humain ne traverse pas un coureur imposé', () => {
    const fixed: Body = { distM: 5, lateral: 1, speedMs: 8, fixed: true };
    const me: Body = { distM: 4.6, lateral: 1, speedMs: 12, priority: true };
    for (let i = 0; i < 60; i++) separateRiders([fixed, me], HALF, 1 / 60);
    expect(fixed.lateral).toBe(1);
    expect(fixed.distM).toBe(5);
    expect(me.distM).toBeLessThanOrEqual(fixed.distM - BIKE_LENGTH_M + 1e-9);
  });

  it('chaussée pleine : l’IA de derrière est retenue à une longueur de vélo', () => {
    const front: Body = { distM: 10, lateral: 0, speedMs: 6 };
    const rear: Body = { distM: 9, lateral: 0, speedMs: 12 };
    // Chaussée de 0,5 m de demi-largeur : pas de place pour passer à côté.
    separateRiders([front, rear], 0.2, 1 / 60);
    expect(front.distM - rear.distM).toBeGreaterThanOrEqual(BIKE_LENGTH_M - 1e-9);
    expect(rear.speedMs).toBeLessThanOrEqual(6);
  });
});

/** Fait avancer deux coureurs, le second plus rapide, avec le planificateur de dépassement. */
function run(opts: { slow?: Partial<LaneBody>; fastSpeed?: number; half?: number; leftFree?: boolean; seconds?: number; gap?: number }) {
  const half = opts.half ?? HALF;
  const slow: LaneBody = { id: 'slow', distM: opts.gap ?? 30, lateralM: 1.1, speedMs: 7, ...opts.slow };
  const fast: LaneBody = { id: 'fast', distM: 0, lateralM: 1.1, speedMs: opts.fastSpeed ?? 10 };
  const o = new Overtaker();
  const dt = 1 / 30;
  const trace: Array<{ t: number; gap: number; lat: number; passing: boolean; sep: number }> = [];
  const start = fast.lateralM;
  let minSepWhileAlongside = Infinity;
  for (let i = 0; i < (opts.seconds ?? 30) * 30; i++) {
    const plan = o.update(fast, [slow], half, opts.leftFree ?? true);
    // Déboîte à 1,5 m/s au plus ; derrière un coureur qu'il ne double pas, il suit sa roue (à sa vitesse, à 1,2 m).
    const targetLat = plan.lateralM ?? start;
    fast.lateralM += Math.max(-1.5 * dt, Math.min(1.5 * dt, targetLat - fast.lateralM));
    const onWheel = plan.blocker && !plan.passing && slow.distM - fast.distM < BIKE_LENGTH_M + 1.2;
    fast.speedMs = onWheel ? Math.min(opts.fastSpeed ?? 10, slow.speedMs) : (opts.fastSpeed ?? 10);
    fast.distM += fast.speedMs * dt;
    slow.distM += slow.speedMs * dt;
    const gap = slow.distM - fast.distM;
    const sep = Math.abs(slow.lateralM - fast.lateralM);
    if (Math.abs(gap) < BIKE_LENGTH_M) minSepWhileAlongside = Math.min(minSepWhileAlongside, sep);
    trace.push({ t: i * dt, gap, lat: fast.lateralM, passing: plan.passing, sep });
  }
  return { trace, minSepWhileAlongside, fast, slow };
}

describe('Overtaker : dépassement propre', () => {
  it('déboîte par la gauche, double sans toucher et se rabat devant', () => {
    const r = run({});
    // Ne frôle jamais le doublé : au moins la largeur d’un vélo quand ils sont l’un à côté de l’autre.
    expect(r.minSepWhileAlongside).toBeGreaterThanOrEqual(BIKE_WIDTH_M + 0.2);
    // Passé devant, et revenu dans sa voie de droite.
    expect(r.fast.distM).toBeGreaterThan(r.slow.distM + PASS_CLEAR_M);
    expect(r.fast.lateralM).toBeCloseTo(1.1, 1);
    // A bien pris le côté gauche (latéral plus petit) pendant la manœuvre.
    expect(Math.min(...r.trace.map((x) => x.lat))).toBeLessThan(1.1 - PASS_GAP_M + 0.15);
  });

  it('commence à déboîter avant d’arriver sur l’autre, pas au contact', () => {
    const r = run({});
    const first = r.trace.find((x) => x.passing);
    expect(first).toBeDefined();
    expect(first!.gap).toBeGreaterThan(8);
  });

  it('ne double pas quelqu’un qui roule aussi vite que lui', () => {
    const r = run({ slow: { speedMs: 10 }, fastSpeed: 10, seconds: 20 });
    expect(r.trace.some((x) => x.passing)).toBe(false);
    expect(r.fast.lateralM).toBeCloseTo(1.1, 3);
  });

  it('voie de gauche occupée : double par la droite si la route le permet', () => {
    const r = run({ slow: { lateralM: 0.3 }, leftFree: false, half: 2.2 });
    expect(r.minSepWhileAlongside).toBeGreaterThanOrEqual(BIKE_WIDTH_M + 0.2);
    expect(Math.max(...r.trace.map((x) => x.lat))).toBeGreaterThan(1.1);
  });

  it('pas de place pour passer : reste dans la roue à la vitesse du plus lent, sans le toucher', () => {
    // Route étroite (demi-largeur 1 m), voie de gauche occupée, doublé au bord droit.
    const r = run({ slow: { lateralM: 1.0 }, leftFree: false, half: 1.0, seconds: 25 });
    expect(r.trace.every((x) => !x.passing)).toBe(true);
    const closest = Math.min(...r.trace.map((x) => x.gap));
    expect(closest).toBeGreaterThan(0);
    expect(r.fast.distM).toBeLessThan(r.slow.distM);
  });

  it('abandonne si le coureur à doubler accélère et file', () => {
    const slow: LaneBody = { id: 's', distM: 20, lateralM: 1, speedMs: 7 };
    const fast: LaneBody = { id: 'f', distM: 8, lateralM: 1, speedMs: 10 };
    const o = new Overtaker();
    expect(o.update(fast, [slow], HALF).passing).toBe(true);
    slow.distM = 90;
    expect(o.update(fast, [slow], HALF).passing).toBe(false);
    expect(o.passing).toBe(false);
  });
});
