import { describe, expect, it } from 'vitest';
import { TeammateUTurn, type UTurnOutput } from '../src/index.ts';

/**
 * Scénario : le groupe (référence) roule à `groupSpeed` ; l'équipier est parti `lead0` m
 * devant et roule à 10 m/s. On vérifie le déclenchement, le demi-tour à gauche, le retour à
 * contresens et le second demi-tour juste devant le groupe.
 */
function scenario(groupSpeed = 9, lead0 = 150) {
  const ctl = new TeammateUTurn({ halfRoadM: 2.6 });
  let group = 1000;
  let dist = group + lead0;
  let speed = 10;
  let lateral = 1;
  const trace: Array<UTurnOutput & { t: number; group: number }> = [];
  const dt = 0.1;
  for (let i = 0; i < 1200; i++) {
    group += groupSpeed * dt;
    const out = ctl.update({ leadM: dist - group, groupSpeedMs: groupSpeed, distM: dist, speedMs: speed, lateralM: lateral }, dt);
    if (out.active) {
      dist = out.distM;
      speed = out.speedMs;
      lateral = out.lateralM;
    } else {
      // IA « normale » : 10 m/s avant le demi-tour, puis dans le groupe.
      speed = ctl.count > 0 ? groupSpeed : 10;
      dist += speed * dt;
    }
    trace.push({ ...out, t: i * dt, group });
    if (ctl.count > 0 && !ctl.active) break;
  }
  return { ctl, trace };
}

describe('TeammateUTurn — demi-tour des équipiers', () => {
  it("ne se déclenche pas tant que l'avance reste raisonnable", () => {
    const ctl = new TeammateUTurn();
    for (let i = 0; i < 300; i++) {
      const out = ctl.update({ leadM: 80, groupSpeedMs: 9, distM: 500, speedMs: 9, lateralM: 1 }, 0.1);
      expect(out.active).toBe(false);
    }
    expect(ctl.count).toBe(0);
  });

  it("attend que l'avance persiste, et pas si le groupe revient déjà", () => {
    const ctl = new TeammateUTurn();
    // Avance de 130 m qui fond de 3 m/s : le groupe revient, pas de demi-tour.
    let lead = 130;
    for (let i = 0; i < 60; i++) {
      lead -= 0.3;
      expect(ctl.update({ leadM: lead, groupSpeedMs: 9, distM: 0, speedMs: 6, lateralM: 1 }, 0.1).active).toBe(false);
    }
    // Avance stable : déclenchement après ~4 s.
    let t = 0;
    while (!ctl.update({ leadM: 130, groupSpeedMs: 9, distM: 0, speedMs: 9, lateralM: 1 }, 0.1).active) t += 0.1;
    expect(t).toBeGreaterThan(3.5);
    expect(t).toBeLessThan(4.6);
  });

  it('fait demi-tour par la gauche, revient à contresens et se replace devant le groupe', () => {
    const { ctl, trace } = scenario();
    expect(ctl.count).toBe(1);
    const phases = [...new Set(trace.map((t) => t.phase))];
    expect(phases).toEqual(['pack', 'brake', 'turn', 'back', 'brakeBack', 'turnBack']);
    const back = trace.filter((t) => t.phase === 'back');
    // À contresens : cap π, vitesse le long de la route négative, sur la voie de gauche.
    expect(back.every((t) => Math.abs(t.headingRad - Math.PI) < 1e-9 && t.alongMs < 0)).toBe(true);
    expect(back.at(-1)!.lateralM).toBeLessThan(-0.8);
    expect(Math.max(...back.map((t) => t.speedMs))).toBeLessThanOrEqual(8 + 1e-9);
    // Le virage reste sur la chaussée et passe par la perpendiculaire.
    const turn = trace.filter((t) => t.phase === 'turn');
    expect(turn.some((t) => Math.abs(t.headingRad - Math.PI / 2) < 0.3)).toBe(true);
    expect(trace.every((t) => Math.abs(t.lateralM) <= 2.6 + 1e-9)).toBe(true);
    // Fin de manœuvre : face à la route, juste devant (ou au niveau) du groupe.
    const last = trace.at(-1)!;
    expect(last.headingRad).toBe(0);
    const lead = last.distM - last.group;
    expect(lead).toBeGreaterThan(-6);
    expect(lead).toBeLessThan(15);
    // Plus aucun demi-tour pendant le délai de grâce, même si l'avance revient.
    for (let i = 0; i < 100; i++) expect(ctl.update({ leadM: 300, groupSpeedMs: 9, distM: 0, speedMs: 9, lateralM: 1 }, 0.1).active).toBe(false);
  });

  it("groupe arrêté : l'équipier redescend jusqu'au groupe sans le dépasser", () => {
    const { trace } = scenario(0, 140);
    const last = trace.at(-1)!;
    expect(last.distM - last.group).toBeGreaterThan(-3);
    expect(last.distM - last.group).toBeLessThan(12);
  });

  it('bloqué (segment disputé) : jamais de demi-tour', () => {
    const ctl = new TeammateUTurn();
    for (let i = 0; i < 200; i++) expect(ctl.update({ leadM: 400, groupSpeedMs: 9, distM: 0, speedMs: 9, lateralM: 1, blocked: true }, 0.1).active).toBe(false);
  });
});
