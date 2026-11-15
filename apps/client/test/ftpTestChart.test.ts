import { describe, expect, it } from 'vitest';
import { ftpTestChartHtml, ftpTestProfile } from '../src/ui/ftpTestChart.ts';

describe('graphique des protocoles du test FTP', () => {
  it('rampe, FTP 250 W : fin probable au palier de 340 W, vers 18 min', () => {
    const p = ftpTestProfile('ramp', 250);
    expect(p.probableStepW).toBe(340);
    expect(p.probableEndS).toBe(300 + 13 * 60);
    expect(p.shownS).toBe(300 + 13 * 60 + 300);
    expect(p.segs[0]).toMatchObject({ t0: 0, d: 300, a: 100, b: 100, free: false });
  });

  it('rampe douce, FTP 200 W : fin probable au palier de 270 W', () => {
    // 200 / 0,75 = 266,7 → premier palier au-dessus : 50 + 10·22 = 270 W, fin à 480 + 23·60 s.
    const p = ftpTestProfile('rampLite', 200);
    expect(p.probableStepW).toBe(270);
    expect(p.probableEndS).toBe(480 + 23 * 60);
  });

  it('FTP trop haute pour les paliers : pas de fin probable, tout le protocole dessiné', () => {
    const p = ftpTestProfile('rampLite', 450);
    expect(p.probableEndS).toBeNull();
    expect(p.shownS).toBe(p.totalS);
    expect(ftpTestChartHtml('rampLite', 450, true)).toContain('dépasse les paliers');
  });

  it('test 20 min : effort libre hachuré, durée totale, pas de fin probable', () => {
    const p = ftpTestProfile('ftp20', 250);
    expect(p.probableEndS).toBeNull();
    expect(p.segs.filter((s) => s.free)).toHaveLength(1);
    expect(p.totalS).toBe(1200 + 180 + 300 + 300 + 600 + 1200 + 600);
    const html = ftpTestChartHtml('ftp20', 250, true);
    expect(html).toContain('url(#ftpc-hatch)');
    expect(html).toContain('20 min libres');
    expect(html).toContain('1 h 13');
  });

  it('HTML de la rampe : ligne de FTP, repère de fin et légende expliquée', () => {
    const html = ftpTestChartHtml('ramp', 250, true);
    expect(html).toContain('FTP 250 W');
    expect(html).toContain('fin probable');
    expect(html).toContain('au palier de 340 W');
    expect(html).not.toContain('NaN');
    expect(ftpTestChartHtml('ramp', 250, false)).toContain('likely end');
  });
});
