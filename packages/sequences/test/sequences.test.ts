import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assembleComposition,
  elevationGain,
  normalizedPower,
  safeZoneViolations,
  SEQUENCE_NAMES,
  SEQUENCES,
  serializeVariables,
  STRINGS,
  summaryVariablesFromRide,
  type RideRecordLike,
} from '../src/node.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function declaredVariables(file: string): Array<{ id: string; type: string; default: unknown }> {
  const html = read(`compositions/${file}/index.html`);
  const m = html.match(/data-composition-variables='([^']*)'/);
  if (!m) throw new Error(`pas de variables déclarées dans ${file}`);
  return JSON.parse(m[1]!);
}

describe('catalogue', () => {
  it('chaque séquence correspond à sa composition (id, durée)', () => {
    for (const name of SEQUENCE_NAMES) {
      const meta = SEQUENCES[name];
      const html = read(`compositions/${meta.file}/index.html`);
      expect(html).toContain(`data-composition-id="${meta.compositionId}"`);
      expect(html).toContain(`data-duration="${meta.duration}"`);
      expect(html).toContain(`window.__timelines['${meta.compositionId}']`);
    }
  });

  it('aucun overlay ne recouvre les zones vitales du HUD', () => {
    for (const name of SEQUENCE_NAMES) expect(safeZoneViolations(name)).toEqual([]);
  });

  it('intro : le compte à rebours ne recouvre pas la carte du parcours', () => {
    const [card, countdown] = SEQUENCES.intro.occupies;
    expect(card && countdown).toBeTruthy();
    const sep = countdown!.y >= card!.y + card!.h || card!.y >= countdown!.y + countdown!.h || countdown!.x >= card!.x + card!.w || card!.x >= countdown!.x + countdown!.w;
    expect(sep).toBe(true);
    const html = read('compositions/intro/index.html');
    expect(html).toMatch(/#intro-card \{\s*position: absolute;\s*left: 440px;\s*top: 262px;\s*width: 1040px;\s*height: 430px;/);
    expect(html).toMatch(/#countdown \{\s*position: absolute;\s*left: 660px;\s*top: 712px;\s*width: 600px;\s*height: 230px;/);
  });

  it('sérialise tableaux et objets en JSON, applique les préréglages', () => {
    const v = serializeVariables('sprint', { segment_name: 'S', time_s: 21.8, rank: 1, pr: false, kind: 'kom' }, 'en');
    expect(v).toMatchObject({ kind: 'sprint', lang: 'en', time_s: 21.8, pr: false });
    const p = serializeVariables('intro', { route_name: 'R', distance_km: 1, elevation_m: 2, profile: [1, 2, 3] });
    expect(p.profile).toBe('[1,2,3]');
  });

  it('les fichiers d’exemple ne contiennent que des variables déclarées', () => {
    const map: Record<string, string> = { intro: 'intro', kom: 'segment', sprint: 'segment', podium: 'podium', tv: 'tv' };
    for (const f of readdirSync(join(ROOT, 'samples'))) {
      const key = f.split('.')[0]!;
      const file = map[key];
      if (!file) continue;
      const ids = new Set(declaredVariables(file).map((d) => d.id));
      for (const k of Object.keys(JSON.parse(read(`samples/${f}`)))) expect(ids.has(k), `${f} : ${k}`).toBe(true);
    }
  });

  it('les textes FR et EN ont les mêmes clés', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.fr).sort());
  });
});

describe('assemblage srcdoc', () => {
  const shared = {
    tokensCss: read('tokens.css'),
    arSeqCss: read('lib/ar-seq.css'),
    arSeqJs: read('lib/ar-seq.js'),
    gsapJs: 'window.gsap = {}; /* </script> */',
    strings: STRINGS,
    runtimeJs: 'window.__hyperframes = {};',
    fontUrls: {
      'inter-latin-wght-normal.woff2': 'http://h/inter.woff2',
      'jetbrains-mono-latin-wght-normal.woff2': 'http://h/mono.woff2',
    },
  };

  it('inline toutes les ressources relatives et injecte variables + runtime', () => {
    for (const file of ['intro', 'segment', 'podium', 'tv', 'summary']) {
      const doc = assembleComposition(read(`compositions/${file}/index.html`), shared, {
        variables: { lang: 'en', route_name: '</script><b>' },
        lang: 'en',
      });
      expect(doc).not.toMatch(/<(?:link|script)\b[^>]*(?:href|src)="assets\//);
      expect(doc).toContain('hyperframe.runtime.iife.js (inline)');
      expect(doc).toContain('http://h/inter.woff2');
      expect(doc).toContain('window.__hfVariables = {"lang":"en","route_name":"\\u003c/script>\\u003cb>"}');
      expect(doc).toMatch(/<html\s+lang="en"/);
      expect(doc).not.toContain('/* </script> */');
    }
  });
});

describe('données du résumé', () => {
  // 20 min à 1 Hz : 10 min à 150 W puis 10 min à 300 W, montée de 100 m.
  const t0 = Date.UTC(2026, 9, 18, 7, 30);
  const records: RideRecordLike[] = Array.from({ length: 1200 }, (_, i) => ({
    t: t0 + i * 1000,
    distanceM: i * 8,
    altitudeM: 100 + (i < 600 ? i / 6 : 100),
    lat: 48.7 + i * 1e-5,
    lon: 2.04 + i * 1e-5,
    watts: i < 600 ? 150 : 300,
  }));

  it('calcule NP, dénivelé, durée, distance, calories', () => {
    const v = summaryVariablesFromRide({ title: 'T', routeName: 'R', date: t0, records });
    expect(v.duration_s).toBe(1199);
    expect(v.distance_km).toBeCloseTo(9.6, 1);
    expect(v.avg_power_w).toBe(225);
    expect(v.np_w).toBeGreaterThan(v.avg_power_w);
    expect(v.elevation_m).toBeGreaterThanOrEqual(99);
    expect(v.calories_kcal).toBeGreaterThan(250);
    expect(Array.isArray(v.trace) && v.trace.length).toBeLessThanOrEqual(400);
    expect(v.date_label).toBe('Dimanche 18 octobre 2026');
    expect(v.season).toBe('automne');
  });

  it('NP d’une puissance constante = cette puissance ; hystérésis du dénivelé', () => {
    const flat = records.map((r) => ({ ...r, watts: 200 }));
    expect(normalizedPower(flat)).toBeCloseTo(200, 5);
    expect(elevationGain([100, 100.4, 100.2, 100.6, 101.5, 101, 103])).toBeCloseTo(3, 5);
  });
});
