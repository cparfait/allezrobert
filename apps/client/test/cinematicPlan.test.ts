/**
 * Film d'accueil : le groupe ne se chevauche jamais, Robert reste en tête, et formation, gestes et
 * pédaliers se retrouvent à l'identique au raccord de la boucle.
 */
import { describe, expect, it } from 'vitest';
import { LOOP_S, SLOTS, XFADE_S, formation, gesture } from '../src/ui/cinematicPlan.ts';

const TAU = Math.PI * 2;
const angleGap = (a: number, b: number) => {
  const d = (((a - b) % TAU) + TAU) % TAU;
  return Math.min(d, TAU - d);
};

describe('film d’accueil', () => {
  it('aucun coureur ne touche un autre (1,95 m en file, 0,7 m de côté)', () => {
    for (let t = -6; t <= LOOP_S + XFADE_S; t += 0.05) {
      const pos = SLOTS.map((_, i) => formation(i, t));
      for (let i = 0; i < pos.length; i++)
        for (let j = i + 1; j < pos.length; j++) {
          const a = pos[i] as { back: number; lat: number };
          const b = pos[j] as { back: number; lat: number };
          const ok = Math.abs(a.back - b.back) >= 1.95 || Math.abs(a.lat - b.lat) >= 0.7;
          if (!ok) throw new Error(`t=${t.toFixed(2)} : ${i} et ${j} se touchent (Δ ${Math.abs(a.back - b.back).toFixed(2)} m, côté ${Math.abs(a.lat - b.lat).toFixed(2)} m)`);
        }
    }
  });

  it('Robert reste devant', () => {
    for (let t = 0; t <= LOOP_S; t += 0.1) for (let i = 1; i < SLOTS.length; i++) expect(formation(i, t).back).toBeGreaterThan(0.3);
  });

  it('tout se retrouve au raccord de la boucle', () => {
    for (let t = -6; t <= XFADE_S; t += 0.1)
      for (let i = 0; i < SLOTS.length; i++) {
        const a = formation(i, t);
        const b = formation(i, t + LOOP_S);
        expect(Math.abs(a.back - b.back) + Math.abs(a.lat - b.lat)).toBeLessThan(1e-9);
        const g = gesture(i, t);
        const h = gesture(i, t + LOOP_S);
        expect(angleGap(g.crank, h.crank)).toBeLessThan(1e-6);
        expect([g.pose, g.hands]).toEqual([h.pose, h.hands]);
        // Pas de geste en cours autour du raccord : tout le monde assis, mains aux cocottes, regard devant.
        expect([g.pose, g.hands, Math.abs(g.yaw) < 1e-9]).toEqual(['seated', 'hoods', true]);
      }
  });

  it('pédalier continu (pas de saut d’une image à l’autre), arrêté à l’horizontale en roue libre', () => {
    const dt = 1 / 30;
    for (let i = 0; i < SLOTS.length; i++) {
      for (let t = -6; t <= LOOP_S + XFADE_S; t += dt) {
        const step = angleGap(gesture(i, t + dt).crank, gesture(i, t).crank);
        expect(step).toBeLessThan(((100 / 60) * TAU) * dt);
      }
      for (const c of SLOTS[i]?.acts ?? []) {
        if (c.kind !== 'coast') continue;
        const g = gesture(i, (c.a + c.b) / 2);
        expect(g.pose).toBe('coasting');
        expect(g.cadence).toBeLessThan(1e-9);
        expect(Math.abs(Math.cos(g.crank))).toBeLessThan(1e-6);
      }
    }
  });
});
