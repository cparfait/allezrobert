import { describe, expect, it } from 'vitest';
import { MotoSchedule, gapsLine, raceGroups, slateSeconds, slateText } from '../src/world/raceMoto.ts';
import { CHRONO_W, chronoText, drawChrono } from '../src/world/motoChrono.ts';

describe('moto de l’ardoisier : groupes de course', () => {
  it('un seul groupe : rien à montrer', () => {
    expect(raceGroups([{ distM: 100, me: true }, { distM: 98 }, { distM: 95 }])).toBeNull();
  });
  it('échappée devant : écart avec la queue du groupe de tête', () => {
    const g = raceGroups([{ distM: 200 }, { distM: 196 }, { distM: 100, me: true }, { distM: 97 }]);
    expect(g).toEqual({ myFrontM: 100, myBackM: 97, aheadGapM: 96, behindGapM: null });
    expect(slateText(g!, 10)).toEqual({ top: 'TÊTE', gap: '+0:10' });
  });
  it('je suis dans l’échappée : avance sur le groupe de derrière', () => {
    const g = raceGroups([{ distM: 300, me: true }, { distM: 298 }, { distM: 50 }]);
    expect(g?.aheadGapM).toBeNull();
    expect(slateText(g!, 10)).toEqual({ top: 'PELOTON', gap: '−0:25' });
  });
});

describe('moto de l’ardoisier : de temps en temps, écarts discrets', () => {
  it('passe après la cassure, repart, revient plus tard', () => {
    const m = new MotoSchedule(15, 40, 150);
    const seen: number[] = [];
    for (let t = 0; t < 600; t++) if (m.update(1, true)) seen.push(t);
    expect(seen[0]).toBe(14);
    expect(seen.length).toBeGreaterThanOrEqual(80);
    expect(seen.length).toBeLessThan(200);
  });
  it('pas de passage quand la course est groupée', () => {
    const m = new MotoSchedule();
    for (let t = 0; t < 300; t++) expect(m.update(1, false)).toBe(false);
  });
  it('ligne d’écarts', () => {
    expect(gapsLine({ myFrontM: 0, myBackM: 0, aheadGapM: 120, behindGapM: 250 }, 10, true)).toBe('Devant +0:12 · Derrière −0:25');
    expect(gapsLine(null, 10, true)).toBeNull();
  });
});

describe('moto chrono : panneau LED', () => {
  it('écart signé tiré des groupes de la course', () => {
    expect(slateSeconds({ myFrontM: 0, myBackM: 0, aheadGapM: 420, behindGapM: null }, 10)).toBe(42);
    expect(slateSeconds({ myFrontM: 0, myBackM: 0, aheadGapM: null, behindGapM: 250 }, 10)).toBe(-25);
  });
  it('texte : signe conservé, pas de plafond à 9:59', () => {
    expect(chronoText(42)).toBe('+0:42');
    expect(chronoText(-25)).toBe('−0:25');
    expect(chronoText(725)).toBe('+12:05');
    expect(chronoText(-3600)).toBe('−60:00');
  });
  const draw = (s: number) => {
    const rects: { x: number; y: number; w: number; h: number; c: string }[] = [];
    const ctx = { fillStyle: '' as unknown, fillRect(x: number, y: number, w: number, h: number) { rects.push({ x, y, w, h, c: String(this.fillStyle) }); } };
    const text = drawChrono(ctx as unknown as CanvasRenderingContext2D, s);
    return { text, rects };
  };
  it('dessin du prototype pour +0:42, barre verticale absente pour −0:25', () => {
    const plus = draw(42);
    expect(plus.text).toBe('+0:42');
    expect(plus.rects).toContainEqual({ x: 75, y: 183, w: 54, h: 14, c: '#ffb33e' });
    expect(plus.rects).toContainEqual({ x: 95, y: 163, w: 14, h: 54, c: '#ffb33e' });
    const minus = draw(-25);
    expect(minus.text).toBe('−0:25');
    expect(minus.rects).not.toContainEqual({ x: 95, y: 163, w: 14, h: 54, c: '#ffb33e' });
  });
  it('au-delà de 9:59, tout tient dans le panneau', () => {
    for (const s of [725, -3600, 999 * 60]) {
      for (const r of draw(s).rects) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(CHRONO_W);
      }
    }
  });
});
