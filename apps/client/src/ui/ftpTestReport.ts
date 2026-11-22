/**
 * Bilan de fin d'un test FTP, à la place du bilan de sortie habituel (distance, vitesse…). Plus complet que
 * l'écran « New FTP set! » de Zwift et que la FTP de fin de sortie de MyWhoosh :
 *  - résultat : ancienne et nouvelle FTP, écart, W/kg, mode de calcul, niveau indicatif, choix du coureur ;
 *  - le test : paliers tenus ou moyenne des 20 minutes, meilleure minute, puissance et cardio max, cadence ;
 *  - courbe du test : puissance, consigne, meilleure minute (rampe) ou 20 minutes (test 20 min) en surbrillance ;
 *  - profil de puissance (5 s, 1 min, 5 min, 20 min, en W et W/kg), comme le « Power Passport » de MyWhoosh ;
 *  - zones de puissance avec la FTP retenue et repères de séance (sweet spot, seuil, VO2max) ;
 *  - progression de la FTP (historique) et date conseillée du prochain test (6 semaines).
 * Ici, des calculs, des textes et du HTML sans état (écran : summary.ts).
 */
import type { FtpTestProtocol } from '@allezrobert/physics';
import { POWER_ZONES } from '../game/stats.ts';
import { ftpResultView, type FtpResultInput } from './ftpResult.ts';
import './blocks.css';

export type FtpDecision = 'pending' | 'new' | 'old';

/** Ce que le jeu sait à la fin du test. */
export interface FtpReportInput {
  protocol: FtpTestProtocol;
  /** Nom de la séance (« Test rampe »…). */
  name: string;
  /** Résultat ; null : effort trop court pour estimer une FTP. */
  result: Omit<FtpResultInput, 'fr'> | null;
  decision: FtpDecision;
  /** FTP au départ du test (W). */
  oldFtp: number;
  massKg: number;
  /** Puissance mesurée, une valeur par seconde depuis le départ du test. */
  samples: readonly number[];
  /** Consigne de chaque étape (W au début et à la fin), null pour l'effort libre. */
  steps: Array<{ startS: number; durationS: number; target: [number, number] | null }>;
  /** Début des paliers (rampe) ou de l'effort libre (20 min), s. */
  effortStartS: number;
  /** Rampe : paliers complètement tenus. */
  stepsHeld: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  /** FTP enregistrées avant ce test (plus ancienne d'abord). */
  history: Array<{ t: number; ftp: number; source: string }>;
  /** Date du test (ms). */
  now: number;
}

export interface BestWindow {
  startS: number;
  durationS: number;
  watts: number;
}

export interface FtpTestReport extends FtpReportInput {
  /** Meilleure minute (rampe) ou meilleures 20 minutes (20 min), pour la surbrillance. */
  highlight: BestWindow | null;
  bestMinute: BestWindow | null;
  /** Profil de puissance : meilleures valeurs sur 5 s, 1, 5 et 20 min (celles que la durée permet). */
  profile: Array<{ durationS: number; watts: number }>;
  maxW: number;
}

/** Meilleure moyenne sur `dur` secondes (fenêtre glissante), à partir de `from`. */
export function bestWindow(samples: readonly number[], dur: number, from = 0): BestWindow | null {
  if (samples.length - from < dur || dur <= 0) return null;
  let sum = 0;
  for (let i = from; i < from + dur; i++) sum += samples[i] as number;
  let best = sum;
  let at = from;
  for (let i = from + dur; i < samples.length; i++) {
    sum += (samples[i] as number) - (samples[i - dur] as number);
    if (sum > best) {
      best = sum;
      at = i - dur + 1;
    }
  }
  return { startS: at, durationS: dur, watts: best / dur };
}

export const PROFILE_DURATIONS = [5, 60, 300, 1200] as const;

export function buildFtpReport(i: FtpReportInput): FtpTestReport {
  const bestMinute = bestWindow(i.samples, 60, Math.min(i.effortStartS, i.samples.length));
  const highlight = i.protocol === 'ftp20' ? bestWindow(i.samples, 1200, Math.min(i.effortStartS, i.samples.length)) : bestMinute;
  const profile: Array<{ durationS: number; watts: number }> = [];
  for (const d of PROFILE_DURATIONS) {
    const b = bestWindow(i.samples, d);
    if (b) profile.push({ durationS: d, watts: b.watts });
  }
  const maxW = i.samples.reduce((m, w) => Math.max(m, w), 0);
  return { ...i, highlight, bestMinute, profile, maxW };
}

/** Niveau indicatif selon les W/kg à la FTP (repères usuels des tableaux de profil de puissance). */
export const LEVELS: Array<[number, string, string]> = [
  [0, 'Débutant', 'Beginner'],
  [2, 'Loisir', 'Recreational'],
  [2.8, 'Sportif', 'Fit'],
  [3.4, 'Bon niveau', 'Strong'],
  [4, 'Très bon niveau', 'Very strong'],
  [4.6, 'Excellent', 'Excellent'],
  [5.3, 'Élite', 'Elite'],
];

export function levelIndex(wkg: number): number {
  let k = 0;
  LEVELS.forEach(([min], i) => {
    if (wkg >= min) k = i;
  });
  return k;
}

/** Repère de prochain test : 6 semaines (MyWhoosh conseille 6 à 8). */
export const RETEST_DAYS = 42;

const ZONE_HEX = ['#9aa5b1', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'];
const ZONE_NAMES: Array<[string, string]> = [
  ['Récupération', 'Recovery'],
  ['Endurance', 'Endurance'],
  ['Tempo', 'Tempo'],
  ['Seuil', 'Threshold'],
  ['VO2max', 'VO2max'],
  ['Anaérobie', 'Anaerobic'],
  ['Sprint', 'Sprint'],
];

export interface ZoneRow {
  label: string;
  name: string;
  color: string;
  range: string;
}

/** Zones de puissance (Z1–Z7) en watts pour une FTP. */
export function ftpZones(ftp: number, fr: boolean): ZoneRow[] {
  const cuts = POWER_ZONES.map((f) => Math.round(f * ftp));
  return ZONE_NAMES.map(([f, e], i) => {
    const lo = i === 0 ? null : (cuts[i - 1] as number);
    const hi = i < cuts.length ? (cuts[i] as number) : null;
    const range = lo === null ? `< ${hi} W` : hi === null ? `> ${lo} W` : `${lo}–${hi} W`;
    return { label: `Z${i + 1}`, name: fr ? f : e, color: ZONE_HEX[i] as string, range };
  });
}

const num = (v: number, d: number, fr: boolean) => v.toFixed(d).replace('.', fr ? ',' : '.');

/**
 * Textes du bilan. La langue est un paramètre des fonctions (`fr`), pas la langue du jeu : le bilan et ses
 * tests la choisissent eux-mêmes ; d'où ce dictionnaire à deux colonnes plutôt que `strings()`.
 * Gabarits : `{w}` watts, `{date}`, `{when}`, `{n}`, `{d}` écart signé, `{basis}`, `{ss}`/`{th}`/`{vo}` plages.
 */
const FR = {
  titleFtp: 'Ta FTP : <em>{w} W</em>',
  titleNone: 'Test FTP : <em>pas de résultat</em>',
  tooShort: 'Effort trop court pour estimer ta FTP.',
  noResultRamp: 'Il faut tenir au moins trois paliers. Ta FTP reste à {w} W.',
  noResult20: 'Il faut les 20 minutes complètes. Ta FTP reste à {w} W.',
  savedNew: 'Nouvelle FTP enregistrée : tes zones et tes séances utilisent maintenant {w} W.',
  keptOld: 'Tu as gardé ton ancienne FTP ({w} W).',
  choose: 'Garde la nouvelle FTP pour régler tes zones et tes séances, ou garde l’ancienne.',
  nextTest: 'Prochain test conseillé : vers le {date} (dans 6 semaines).',
  thisWeek: 'cette semaine',
  weekAgo: 'il y a 1 semaine',
  weeksAgo: 'il y a {n} semaines',
  sinceLast: '{d} W depuis ta FTP du {date} ({when}).',
  stepsHeld: 'Paliers tenus',
  avg20: 'Moyenne 20 min',
  bestMinute: 'Meilleure minute',
  maxPower: 'Puissance max',
  maxHr: 'Cardio max',
  avgCadence: 'Cadence moy.',
  rpm: 'tr/min',
  testResult: 'Résultat du test',
  level: 'Niveau',
  levelHint: 'Repère indicatif, d’après les W/kg à la FTP.',
  old: 'Ancienne',
  oldDetail: 'Avant le test',
  new: 'Nouvelle',
  newDetail: 'Estimée par ce test',
  up: 'En hausse',
  down: 'En baisse',
  same: 'Inchangée',
  method: 'Calcul : {basis}',
  hl20: 'Tes 20 minutes',
  hlMinute: 'Ta meilleure minute',
  yourPower: 'Ta puissance (5 s)',
  target: 'Consigne',
  chartLabel: 'Puissance et consigne pendant le test',
  profileTitle: 'Ton profil de puissance',
  profileHint20: 'Meilleures valeurs pendant le test. Compare-les d’un test à l’autre pour suivre ta progression.',
  profileHintRamp: 'Meilleures valeurs pendant le test. Une rampe sollicite surtout la minute et les efforts courts : pour ta valeur sur 20 minutes, fais un test 20 min.',
  zonesTitle: 'Tes zones de puissance (FTP {w} W)',
  zonesHint: 'Repères de séance : sweet spot {ss} · seuil {th} · VO2max {vo}.',
  today: 'Aujourd’hui · ce test',
  progressTitle: 'Ta progression',
  firstTest: 'Premier test enregistré : il servira de point de départ.',
} as const;
type Dict = { readonly [K in keyof typeof FR]: string };
const EN: Dict = {
  titleFtp: 'Your FTP: <em>{w} W</em>',
  titleNone: 'FTP test: <em>no result</em>',
  tooShort: 'Effort too short to estimate your FTP.',
  noResultRamp: 'You need to hold at least three steps. Your FTP stays at {w} W.',
  noResult20: 'The full 20 minutes are needed. Your FTP stays at {w} W.',
  savedNew: 'New FTP saved: your zones and workouts now use {w} W.',
  keptOld: 'You kept your previous FTP ({w} W).',
  choose: 'Keep the new FTP to set your zones and workouts, or keep the old one.',
  nextTest: 'Next test suggested around {date} (in 6 weeks).',
  thisWeek: 'this week',
  weekAgo: '1 week ago',
  weeksAgo: '{n} weeks ago',
  sinceLast: '{d} W since your FTP of {date} ({when}).',
  stepsHeld: 'Steps held',
  avg20: '20-min average',
  bestMinute: 'Best minute',
  maxPower: 'Max power',
  maxHr: 'Max HR',
  avgCadence: 'Avg cadence',
  rpm: 'rpm',
  testResult: 'Test result',
  level: 'Level',
  levelHint: 'Rough guide based on W/kg at FTP.',
  old: 'Old',
  oldDetail: 'Before the test',
  new: 'New',
  newDetail: 'Estimated by this test',
  up: 'Up',
  down: 'Down',
  same: 'Unchanged',
  method: 'Method: {basis}',
  hl20: 'Your 20 minutes',
  hlMinute: 'Your best minute',
  yourPower: 'Your power (5 s)',
  target: 'Target',
  chartLabel: 'Power and target during the test',
  profileTitle: 'Your power profile',
  profileHint20: 'Best values during the test. Compare them from one test to the next to track your progress.',
  profileHintRamp: 'Best values during the test. A ramp mostly stresses the one-minute and short efforts: for your 20-minute value, take a 20-min test.',
  zonesTitle: 'Your power zones (FTP {w} W)',
  zonesHint: 'Workout guides: sweet spot {ss} · threshold {th} · VO2max {vo}.',
  today: 'Today · this test',
  progressTitle: 'Your progress',
  firstTest: 'First recorded test: it will be your starting point.',
};
const tx = (fr: boolean): Dict => (fr ? FR : EN);
/** Remplit les `{clé}` d'un gabarit. */
const fill = (tpl: string, v: Record<string, string | number>): string => tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

function hms(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

const durLabel = (d: number) => (d < 60 ? `${d} s` : `${d / 60} min`);
const dateLabel = (t: number, fr: boolean) => new Date(t).toLocaleDateString(fr ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export interface FtpReportView {
  title: string;
  subtitle: string;
  /** FTP retenue pour les zones : la nouvelle si gardée (ou en attente), sinon l'ancienne. */
  zonesFtp: number;
  decisionText: string;
  /** Niveau indicatif (null sans résultat ni poids). */
  level: { index: number; name: string; wkg: number } | null;
  nextTestText: string;
  /** Écart depuis le test précédent (texte), null sans historique. */
  sinceLastText: string | null;
  tiles: Array<[string, string, string?]>;
}

/** Textes du bilan (sans DOM, pour les tests). */
export function ftpReportView(r: FtpTestReport, fr: boolean): FtpReportView {
  const D = tx(fr);
  const ramp = r.protocol !== 'ftp20';
  const res = r.result;
  const oldW = Math.round(r.oldFtp);
  const title = res ? fill(D.titleFtp, { w: Math.round(res.newFtp) }) : D.titleNone;
  const subtitle = [r.name, hms(r.samples.length), res ? ftpResultView({ ...res, fr }).reason : D.tooShort].join(' · ');
  const decisionText = !res
    ? fill(ramp ? D.noResultRamp : D.noResult20, { w: oldW })
    : r.decision === 'new'
      ? fill(D.savedNew, { w: Math.round(res.newFtp) })
      : r.decision === 'old'
        ? fill(D.keptOld, { w: oldW })
        : D.choose;
  const wkg = res && r.massKg > 0 ? res.newFtp / r.massKg : null;
  const level = wkg === null ? null : { index: levelIndex(wkg), name: (LEVELS[levelIndex(wkg)] as [number, string, string])[fr ? 1 : 2], wkg };
  const next = r.now + RETEST_DAYS * 86_400_000;
  const nextTestText = fill(D.nextTest, { date: dateLabel(next, fr) });
  const prevTest = [...r.history].reverse().find((h) => h.source === 'ramp' || h.source === '20min') ?? r.history.at(-1);
  let sinceLastText: string | null = null;
  if (prevTest && res) {
    const weeks = Math.max(0, Math.round((r.now - prevTest.t) / (7 * 86_400_000)));
    const d = Math.round(res.newFtp - prevTest.ftp);
    const when = weeks < 1 ? D.thisWeek : weeks === 1 ? D.weekAgo : fill(D.weeksAgo, { n: weeks });
    sinceLastText = fill(D.sinceLast, { d: `${d >= 0 ? '+' : '−'}${Math.abs(d)}`, date: dateLabel(prevTest.t, fr), when });
  }
  const tiles: Array<[string, string, string?]> = [];
  if (ramp) tiles.push([D.stepsHeld, r.stepsHeld === null ? '—' : String(r.stepsHeld)]);
  else tiles.push([D.avg20, r.highlight ? `${Math.round(r.highlight.watts)} W` : '—']);
  tiles.push([D.bestMinute, r.bestMinute ? `${Math.round(r.bestMinute.watts)} W` : '—', r.bestMinute && r.massKg > 0 ? `${num(r.bestMinute.watts / r.massKg, 1, fr)} W/kg` : undefined]);
  tiles.push([D.maxPower, `${Math.round(r.maxW)} W`]);
  tiles.push([D.maxHr, r.maxHr ? `${Math.round(r.maxHr)} bpm` : '—']);
  tiles.push([D.avgCadence, r.avgCadence ? `${Math.round(r.avgCadence)} ${D.rpm}` : '—']);
  const zonesFtp = res && r.decision !== 'old' ? res.newFtp : r.oldFtp;
  return { title, subtitle, zonesFtp, decisionText, level, nextTestText, sinceLastText, tiles };
}

const STYLE_ID = 'ftp-report-style';
// Textes d'au moins 14 px (12 px pour les mentions) ; titres, blocs et boutons viennent de blocks.css.
const CSS = `
.ftprep{display:flex;flex-direction:column;gap:12px}
.ftprep .ab-tile{grid-template-columns:1fr;grid-template-areas:'name' 'detail' 'val' 'state';padding:14px 16px 12px}
.ftprep small{color:#9aa6b5;font-size:12px}
.ftprep p{margin:0;color:#e2e8f0;font-size:15px}
.ftprep p.ftprep-method{font-size:14px;color:#c3cddb}
.ftprep-actions{display:flex;flex-wrap:wrap;gap:10px}
.ftprep-actions .ftprep-keep{box-shadow:inset 0 0 0 2px var(--ar-accent,#ffd23f)}
.ftprep-level{display:flex;flex-direction:column;gap:6px}
.ftprep-scale{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.ftprep-scale i{height:8px;border-radius:4px;background:rgba(255,255,255,.12)}
.ftprep-scale i.on{background:#c084fc}
.ftprep-scale i.me{background:#ffd23f;box-shadow:0 0 0 2px rgba(255,210,63,.35)}
.ftprep-zones{display:grid;gap:4px}
.ftprep-zone{display:grid;grid-template-columns:34px 1fr auto;gap:10px;align-items:center;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.04);border-left:4px solid var(--zc);font-size:14px}
.ftprep-zone b{font-variant-numeric:tabular-nums}
.ftprep-zone span{color:#cbd5e1}
.ftprep-hint{margin:8px 0 0;color:#b4bfcd;font-size:14px}
.ftprep-main{overflow-y:auto;padding-right:4px}
.ftprep-main>*{flex:none}
.ftprep-grid{flex:none}
.ftprep-chart svg{display:block;width:100%;height:auto;max-height:260px}
.ftprep-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 6px;color:#b4bfcd;font-size:14px}
.ftprep-legend i{display:inline-block;width:12px;height:8px;border-radius:2px;margin-right:5px;vertical-align:middle}
.ftprep-prof{display:grid;gap:6px;font-size:14px}
.ftprep-prof div{display:grid;grid-template-columns:52px 1fr 64px 76px;gap:10px;align-items:center;font-variant-numeric:tabular-nums}
.ftprep-prof span{color:#cbd5e1}
.ftprep-prof i{height:10px;border-radius:5px;background:linear-gradient(90deg,#c084fc,#ffd23f)}
.ftprep-prof em{font-style:normal;color:#b4bfcd;text-align:right}
.ftprep-hist{display:grid;gap:4px;font-size:14px}
.ftprep-hist div{display:flex;justify-content:space-between;gap:10px;padding:5px 8px;border-radius:8px;background:rgba(255,255,255,.04);font-variant-numeric:tabular-nums}
.ftprep-hist div.now{background:rgba(255,210,63,.12);color:#ffd23f;font-weight:800}
.ftprep-hist span{color:#cbd5e1}
`;

function ensureStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.appendChild(st);
}

/**
 * Carte du résultat (en tête du bilan) : ancienne et nouvelle FTP en deux blocs, écart (état en toutes
 * lettres), calcul, niveau, choix, prochain test. Le choix n'est pas l'action jaune de l'écran (« Nouvelle
 * sortie », dans summary.ts) : « Garder la nouvelle FTP » est seulement souligné d'un contour jaune.
 */
export function ftpResultCardHtml(r: FtpTestReport, fr: boolean): string {
  ensureStyle();
  const D = tx(fr);
  const v = ftpReportView(r, fr);
  const res = r.result;
  if (!res)
    return `<section class="sum-card ftprep" id="ftprep"><h3 class="ab-section">${D.testResult}</h3><p>${v.decisionText}</p><small>${v.nextTestText}</small></section>`;
  const rv = ftpResultView({ ...res, fr });
  const tone = rv.trend > 0 ? 'is-ok' : rv.trend < 0 ? 'is-bad' : 'is-info';
  const trendWord = rv.trend > 0 ? D.up : rv.trend < 0 ? D.down : D.same;
  const level = v.level
    ? `<div class="ftprep-level"><p>${D.level} : <b>${v.level.name}</b> (${num(v.level.wkg, 2, fr)} W/kg)</p>
        <div class="ftprep-scale" aria-hidden="true">${LEVELS.map((_, i) => `<i class="${i === v.level?.index ? 'me' : i < (v.level?.index ?? 0) ? 'on' : ''}"></i>`).join('')}</div>
        <small>${D.levelHint}</small></div>`
    : '';
  return `<section class="sum-card ftprep" id="ftprep">
    <h3 class="ab-section">${D.testResult}</h3>
    <div class="ab-grid ab-grid-2">
      <div class="ab-tile"><span class="ab-name">${D.old}</span><span class="ab-detail">${D.oldDetail}</span><span class="ab-val"><b>${Math.round(res.oldFtp)}</b><small>W</small></span></div>
      <div class="ab-tile ${tone}"><span class="ab-name">${D.new}</span><span class="ab-detail">${rv.wkgText || D.newDetail}</span><span class="ab-val"><b>${Math.round(res.newFtp)}</b><small>W</small></span><span class="ab-state"><i></i>${trendWord} · ${rv.deltaText}</span></div>
    </div>
    ${rv.basisText ? `<p class="ftprep-method">${fill(D.method, { basis: rv.basisText })}</p>` : ''}
    ${level}
    <p id="ftprep-decision">${v.decisionText}</p>
    ${
      r.decision === 'pending'
        ? `<div class="ftprep-actions"><button type="button" class="sum-btn ab-btn ftprep-keep" id="ftprep-new">${rv.keepNew}</button><button type="button" class="sum-btn ab-btn" id="ftprep-old">${rv.keepOld}</button></div>`
        : ''
    }
    <small>${v.nextTestText}</small>
  </section>`;
}

/** Courbe du test : consigne (aire), puissance lissée sur 5 s, meilleure fenêtre en surbrillance, ligne de la FTP. */
export function ftpTestChartSvg(r: FtpTestReport, fr: boolean): string {
  const W = 640;
  const H = 220;
  const P = { l: 40, r: 10, t: 12, b: 22 };
  const n = r.samples.length;
  const T = Math.max(60, n);
  // Consigne des étapes atteintes seulement (la rampe prévoit des paliers jusqu'à 30 et plus).
  const maxTarget = Math.max(0, ...r.steps.filter((s) => s.startS < T).flatMap((s) => s.target ?? [0]));
  const top = Math.max(150, r.maxW, maxTarget, r.result?.newFtp ?? 0) * 1.08;
  const X = (t: number) => P.l + (t / T) * (W - P.l - P.r);
  const Y = (w: number) => H - P.b - (Math.max(0, w) / top) * (H - P.t - P.b);
  const parts: string[] = [];
  // Grille et axe des watts
  const stepW = top > 700 ? 200 : top > 350 ? 100 : 50;
  for (let w = stepW; w < top; w += stepW)
    parts.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${Y(w).toFixed(1)}" y2="${Y(w).toFixed(1)}" stroke="rgba(255,255,255,.12)"/><text x="${P.l - 6}" y="${(Y(w) + 4).toFixed(1)}" fill="#b4bfcd" font-size="11" text-anchor="end">${w}</text>`);
  // Axe du temps (toutes les 5 ou 10 minutes)
  const tick = T > 2400 ? 600 : 300;
  for (let t = 0; t <= T; t += tick) parts.push(`<text x="${X(t).toFixed(1)}" y="${H - 6}" fill="#b4bfcd" font-size="11" text-anchor="middle">${Math.round(t / 60)}′</text>`);
  // Consigne : aire sous les étapes (rampe linéaire dans une étape)
  for (const s of r.steps) {
    if (!s.target || s.startS >= T) continue;
    const t1 = Math.min(T, s.startS + s.durationS);
    const [a, b] = s.target;
    const bEnd = a + ((b - a) * (t1 - s.startS)) / s.durationS;
    parts.push(
      `<polygon points="${X(s.startS).toFixed(1)},${Y(0).toFixed(1)} ${X(s.startS).toFixed(1)},${Y(a).toFixed(1)} ${X(t1).toFixed(1)},${Y(bEnd).toFixed(1)} ${X(t1).toFixed(1)},${Y(0).toFixed(1)}" fill="rgba(192,132,252,.28)"/>`,
    );
  }
  // Meilleure fenêtre
  const hl = r.highlight;
  if (hl)
    parts.push(
      `<rect x="${X(hl.startS).toFixed(1)}" y="${P.t}" width="${Math.max(2, X(hl.startS + hl.durationS) - X(hl.startS)).toFixed(1)}" height="${H - P.t - P.b}" fill="rgba(34,197,94,.18)" stroke="rgba(34,197,94,.7)" stroke-dasharray="3 3"/>`,
    );
  // Puissance lissée sur 5 s
  if (n > 1) {
    const pts: string[] = [];
    const stride = Math.max(1, Math.floor(n / 600));
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += r.samples[i] as number;
      if (i >= 5) sum -= r.samples[i - 5] as number;
      if (i % stride === 0 || i === n - 1) pts.push(`${X(i).toFixed(1)},${Y(sum / Math.min(5, i + 1)).toFixed(1)}`);
    }
    parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="#ffd23f" stroke-width="1.6" stroke-linejoin="round"/>`);
  }
  // Ligne de la nouvelle FTP
  if (r.result) {
    const y = Y(r.result.newFtp).toFixed(1);
    parts.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="#f5f7fa" stroke-dasharray="6 4" stroke-width="1"/><text x="${W - P.r - 4}" y="${(Number(y) - 5).toFixed(1)}" fill="#f5f7fa" font-size="11" text-anchor="end">FTP ${Math.round(r.result.newFtp)} W</text>`);
  }
  const D = tx(fr);
  const hlName = r.protocol === 'ftp20' ? D.hl20 : D.hlMinute;
  return `<div class="ftprep-legend"><span><i style="background:#ffd23f"></i>${D.yourPower}</span><span><i style="background:rgba(192,132,252,.6)"></i>${D.target}</span>${hl ? `<span><i style="background:rgba(34,197,94,.6)"></i>${hlName} : ${Math.round(hl.watts)} W</span>` : ''}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${D.chartLabel}">${parts.join('')}</svg>`;
}

/** Profil de puissance (5 s, 1 min, 5 min, 20 min). */
export function ftpProfileHtml(r: FtpTestReport, fr: boolean): string {
  if (!r.profile.length) return '';
  const D = tx(fr);
  const max = Math.max(...r.profile.map((p) => p.watts), 1);
  return `<section class="sum-card sum-chart"><h3 class="ab-section">${D.profileTitle}</h3>
    <div class="ftprep-prof">${r.profile
      .map(
        (p) =>
          `<div><span>${durLabel(p.durationS)}</span><i style="width:${Math.max(4, (p.watts / max) * 100).toFixed(0)}%"></i><b>${Math.round(p.watts)} W</b><em>${r.massKg > 0 ? `${num(p.watts / r.massKg, 1, fr)} W/kg` : ''}</em></div>`,
      )
      .join('')}</div>
    <p class="ftprep-hint">${r.protocol === 'ftp20' ? D.profileHint20 : D.profileHintRamp}</p></section>`;
}

/** Zones de puissance avec la FTP retenue, et repères de séance. */
export function ftpZonesHtml(r: FtpTestReport, fr: boolean): string {
  const D = tx(fr);
  const v = ftpReportView(r, fr);
  const f = v.zonesFtp;
  const band = (a: number, b: number) => `${Math.round(a * f)}–${Math.round(b * f)} W`;
  return `<section class="sum-card sum-chart" id="ftprep-zones"><h3 class="ab-section">${fill(D.zonesTitle, { w: Math.round(f) })}</h3>
    <div class="ftprep-zones">${ftpZones(f, fr)
      .map((z) => `<div class="ftprep-zone" style="--zc:${z.color}"><b>${z.label}</b><span>${z.name}</span><b>${z.range}</b></div>`)
      .join('')}</div>
    <p class="ftprep-hint">${fill(D.zonesHint, { ss: band(0.88, 0.94), th: band(0.95, 1.05), vo: band(1.06, 1.2) })}</p></section>`;
}

const SOURCE: Record<string, [string, string]> = {
  ramp: ['test rampe', 'ramp test'],
  '20min': ['test 20 min', '20-min test'],
  manual: ['saisie', 'entered'],
  estimate: ['estimation', 'estimate'],
  import: ['import', 'import'],
};

/** Progression : FTP enregistrées (5 dernières) et ce test. */
export function ftpHistoryHtml(r: FtpTestReport, fr: boolean): string {
  const v = ftpReportView(r, fr);
  const past = r.history.slice(-5);
  const rows = past.map((h) => `<div><span>${dateLabel(h.t, fr)} · ${(SOURCE[h.source] ?? [h.source, h.source])[fr ? 0 : 1]}</span><b>${Math.round(h.ftp)} W</b></div>`);
  const D = tx(fr);
  if (r.result) rows.push(`<div class="now"><span>${D.today}</span><b>${Math.round(r.result.newFtp)} W</b></div>`);
  return `<section class="sum-card"><h3 class="ab-section">${D.progressTitle}</h3>
    ${rows.length ? `<div class="ftprep-hist">${rows.join('')}</div>` : ''}
    <p class="ftprep-hint">${v.sinceLastText ?? D.firstTest}</p></section>`;
}

/**
 * Branche les boutons de choix : met à jour la carte et les zones en place, puis prévient le jeu.
 * `r.decision` est modifié (le bilan reflète le choix).
 */
export function bindFtpReport(root: HTMLElement, r: FtpTestReport, fr: boolean, onDecision: (keepNew: boolean) => void): void {
  const bind = () => {
    root.querySelector<HTMLButtonElement>('#ftprep-new')?.addEventListener('click', () => decide(true));
    root.querySelector<HTMLButtonElement>('#ftprep-old')?.addEventListener('click', () => decide(false));
  };
  const decide = (keepNew: boolean) => {
    if (r.decision !== 'pending') return;
    r.decision = keepNew ? 'new' : 'old';
    onDecision(keepNew);
    const card = root.querySelector('#ftprep');
    if (card) card.outerHTML = ftpResultCardHtml(r, fr);
    const zones = root.querySelector('#ftprep-zones');
    if (zones) zones.outerHTML = ftpZonesHtml(r, fr);
    bind();
  };
  bind();
}
