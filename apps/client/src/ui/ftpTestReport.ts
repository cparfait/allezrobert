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

function hms(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

const durLabel = (d: number, fr: boolean) => (d < 60 ? `${d} s` : `${d / 60} min`);
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
  const ramp = r.protocol !== 'ftp20';
  const res = r.result;
  const title = res ? (fr ? `Ta FTP : <em>${Math.round(res.newFtp)} W</em>` : `Your FTP: <em>${Math.round(res.newFtp)} W</em>`) : fr ? 'Test FTP : <em>pas de résultat</em>' : 'FTP test: <em>no result</em>';
  const subtitle = [r.name, hms(r.samples.length), res ? ftpResultView({ ...res, fr }).reason : fr ? 'Effort trop court pour estimer ta FTP.' : 'Effort too short to estimate your FTP.'].join(' · ');
  const decisionText = !res
    ? fr
      ? ramp
        ? `Il faut tenir au moins trois paliers. Ta FTP reste à ${Math.round(r.oldFtp)} W.`
        : `Il faut les 20 minutes complètes. Ta FTP reste à ${Math.round(r.oldFtp)} W.`
      : ramp
        ? `You need to hold at least three steps. Your FTP stays at ${Math.round(r.oldFtp)} W.`
        : `The full 20 minutes are needed. Your FTP stays at ${Math.round(r.oldFtp)} W.`
    : r.decision === 'new'
      ? fr
        ? `Nouvelle FTP enregistrée : tes zones et tes séances utilisent maintenant ${Math.round(res.newFtp)} W.`
        : `New FTP saved: your zones and workouts now use ${Math.round(res.newFtp)} W.`
      : r.decision === 'old'
        ? fr
          ? `Tu as gardé ton ancienne FTP (${Math.round(r.oldFtp)} W).`
          : `You kept your previous FTP (${Math.round(r.oldFtp)} W).`
        : fr
          ? 'Garde la nouvelle FTP pour régler tes zones et tes séances, ou garde l’ancienne.'
          : 'Keep the new FTP to set your zones and workouts, or keep the old one.';
  const wkg = res && r.massKg > 0 ? res.newFtp / r.massKg : null;
  const level = wkg === null ? null : { index: levelIndex(wkg), name: (LEVELS[levelIndex(wkg)] as [number, string, string])[fr ? 1 : 2], wkg };
  const next = r.now + RETEST_DAYS * 86_400_000;
  const nextTestText = fr ? `Prochain test conseillé : vers le ${dateLabel(next, fr)} (dans 6 semaines).` : `Next test suggested around ${dateLabel(next, fr)} (in 6 weeks).`;
  const prevTest = [...r.history].reverse().find((h) => h.source === 'ramp' || h.source === '20min') ?? r.history.at(-1);
  let sinceLastText: string | null = null;
  if (prevTest && res) {
    const weeks = Math.max(0, Math.round((r.now - prevTest.t) / (7 * 86_400_000)));
    const d = Math.round(res.newFtp - prevTest.ftp);
    const when = fr ? (weeks < 1 ? 'cette semaine' : `il y a ${weeks} semaine${weeks > 1 ? 's' : ''}`) : weeks < 1 ? 'this week' : `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    sinceLastText = fr
      ? `${d >= 0 ? '+' : '−'}${Math.abs(d)} W depuis ta FTP du ${dateLabel(prevTest.t, fr)} (${when}).`
      : `${d >= 0 ? '+' : '−'}${Math.abs(d)} W since your FTP of ${dateLabel(prevTest.t, fr)} (${when}).`;
  }
  const tiles: Array<[string, string, string?]> = [];
  if (ramp) tiles.push([fr ? 'Paliers tenus' : 'Steps held', r.stepsHeld === null ? '—' : String(r.stepsHeld)]);
  else tiles.push([fr ? 'Moyenne 20 min' : '20-min average', r.highlight ? `${Math.round(r.highlight.watts)} W` : '—']);
  tiles.push([fr ? 'Meilleure minute' : 'Best minute', r.bestMinute ? `${Math.round(r.bestMinute.watts)} W` : '—', r.bestMinute && r.massKg > 0 ? `${num(r.bestMinute.watts / r.massKg, 1, fr)} W/kg` : undefined]);
  tiles.push([fr ? 'Puissance max' : 'Max power', `${Math.round(r.maxW)} W`]);
  tiles.push([fr ? 'Cardio max' : 'Max HR', r.maxHr ? `${Math.round(r.maxHr)} bpm` : '—']);
  tiles.push([fr ? 'Cadence moy.' : 'Avg cadence', r.avgCadence ? `${Math.round(r.avgCadence)} tr/min` : '—']);
  const zonesFtp = res && r.decision !== 'old' ? res.newFtp : r.oldFtp;
  return { title, subtitle, zonesFtp, decisionText, level, nextTestText, sinceLastText, tiles };
}

const STYLE_ID = 'ftp-report-style';
const CSS = `
.ftprep{display:flex;flex-direction:column;gap:12px;border-top:3px solid #c084fc}
.ftprep-cmp{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px}
.ftprep-cmp div{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:14px;background:rgba(0,0,0,.25)}
.ftprep-cmp small{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#b9c4d3;font-weight:700}
.ftprep-cmp b{font-size:28px;font-weight:900;font-variant-numeric:tabular-nums}
.ftprep-cmp .new b{color:#ffd23f}
.ftprep-cmp i{font-style:normal;font-size:20px;color:#8d98a6}
.ftprep-delta{display:flex;flex-wrap:wrap;gap:8px 14px;font-weight:800;font-variant-numeric:tabular-nums}
.ftprep-delta .up{color:#86efac}.ftprep-delta .down{color:#fca5a5}.ftprep-delta .eq{color:#cbd5e1}
.ftprep small{color:#9aa6b5;font-size:12px}
.ftprep p{margin:0;color:#e2e8f0}
.ftprep-actions{display:flex;flex-wrap:wrap;gap:8px}
.ftprep-level{display:flex;flex-direction:column;gap:6px}
.ftprep-scale{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.ftprep-scale i{height:8px;border-radius:4px;background:rgba(255,255,255,.12)}
.ftprep-scale i.on{background:#c084fc}
.ftprep-scale i.me{background:#ffd23f;box-shadow:0 0 0 2px rgba(255,210,63,.35)}
.ftprep-zones{display:grid;gap:4px}
.ftprep-zone{display:grid;grid-template-columns:34px 1fr auto;gap:10px;align-items:center;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.04);border-left:4px solid var(--zc)}
.ftprep-zone b{font-variant-numeric:tabular-nums}
.ftprep-zone span{color:#cbd5e1}
.ftprep-hint{margin:8px 0 0;color:#b4bfcd;font-size:12.5px}
.ftprep-main{overflow-y:auto;padding-right:4px}
.ftprep-main>*{flex:none}
.ftprep-grid{flex:none}
.ftprep-chart svg{display:block;width:100%;height:auto;max-height:260px}
.ftprep-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 6px;color:#b4bfcd;font-size:12px}
.ftprep-legend i{display:inline-block;width:12px;height:8px;border-radius:2px;margin-right:5px;vertical-align:middle}
.ftprep-prof{display:grid;gap:6px}
.ftprep-prof div{display:grid;grid-template-columns:52px 1fr 64px 70px;gap:10px;align-items:center;font-variant-numeric:tabular-nums}
.ftprep-prof span{color:#cbd5e1}
.ftprep-prof i{height:10px;border-radius:5px;background:linear-gradient(90deg,#c084fc,#ffd23f)}
.ftprep-prof em{font-style:normal;color:#b4bfcd;text-align:right}
.ftprep-hist{display:grid;gap:4px}
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

/** Carte du résultat (en tête du bilan) : comparaison, écart, calcul, niveau, choix, prochain test. */
export function ftpResultCardHtml(r: FtpTestReport, fr: boolean): string {
  ensureStyle();
  const v = ftpReportView(r, fr);
  const res = r.result;
  if (!res)
    return `<section class="sum-card ftprep" id="ftprep"><h3>${fr ? 'Résultat du test' : 'Test result'}</h3><p>${v.decisionText}</p><small>${v.nextTestText}</small></section>`;
  const rv = ftpResultView({ ...res, fr });
  const trendCls = rv.trend > 0 ? 'up' : rv.trend < 0 ? 'down' : 'eq';
  const level = v.level
    ? `<div class="ftprep-level"><p>${fr ? 'Niveau' : 'Level'} : <b>${v.level.name}</b> (${num(v.level.wkg, 2, fr)} W/kg)</p>
        <div class="ftprep-scale" aria-hidden="true">${LEVELS.map((_, i) => `<i class="${i === v.level?.index ? 'me' : i < (v.level?.index ?? 0) ? 'on' : ''}"></i>`).join('')}</div>
        <small>${fr ? 'Repère indicatif, d’après les W/kg à la FTP.' : 'Rough guide based on W/kg at FTP.'}</small></div>`
    : '';
  return `<section class="sum-card ftprep" id="ftprep">
    <h3>${fr ? 'Résultat du test' : 'Test result'}</h3>
    <div class="ftprep-cmp"><div><small>${fr ? 'Ancienne' : 'Old'}</small><b>${rv.oldText}</b></div><i>→</i><div class="new"><small>${fr ? 'Nouvelle' : 'New'}</small><b>${rv.newText}</b></div></div>
    <div class="ftprep-delta"><span class="${trendCls}">${rv.deltaText}</span>${rv.wkgText ? `<span>${rv.wkgText}</span>` : ''}</div>
    ${rv.basisText ? `<small>${fr ? 'Calcul' : 'Method'} : ${rv.basisText}</small>` : ''}
    ${level}
    <p id="ftprep-decision">${v.decisionText}</p>
    ${
      r.decision === 'pending'
        ? `<div class="ftprep-actions"><button type="button" class="sum-btn accent" id="ftprep-new">${rv.keepNew}</button><button type="button" class="sum-btn" id="ftprep-old">${rv.keepOld}</button></div>`
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
  const hlName = r.protocol === 'ftp20' ? (fr ? 'Tes 20 minutes' : 'Your 20 minutes') : fr ? 'Ta meilleure minute' : 'Your best minute';
  return `<div class="ftprep-legend"><span><i style="background:#ffd23f"></i>${fr ? 'Ta puissance (5 s)' : 'Your power (5 s)'}</span><span><i style="background:rgba(192,132,252,.6)"></i>${fr ? 'Consigne' : 'Target'}</span>${hl ? `<span><i style="background:rgba(34,197,94,.6)"></i>${hlName} : ${Math.round(hl.watts)} W</span>` : ''}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${fr ? 'Puissance et consigne pendant le test' : 'Power and target during the test'}">${parts.join('')}</svg>`;
}

/** Profil de puissance (5 s, 1 min, 5 min, 20 min). */
export function ftpProfileHtml(r: FtpTestReport, fr: boolean): string {
  if (!r.profile.length) return '';
  const max = Math.max(...r.profile.map((p) => p.watts), 1);
  return `<section class="sum-card sum-chart"><h3>${fr ? 'Ton profil de puissance' : 'Your power profile'}</h3>
    <div class="ftprep-prof">${r.profile
      .map(
        (p) =>
          `<div><span>${durLabel(p.durationS, fr)}</span><i style="width:${Math.max(4, (p.watts / max) * 100).toFixed(0)}%"></i><b>${Math.round(p.watts)} W</b><em>${r.massKg > 0 ? `${num(p.watts / r.massKg, 1, fr)} W/kg` : ''}</em></div>`,
      )
      .join('')}</div>
    <p class="ftprep-hint">${
      r.protocol === 'ftp20'
        ? fr
          ? 'Meilleures valeurs pendant le test. Compare-les d’un test à l’autre pour suivre ta progression.'
          : 'Best values during the test. Compare them from one test to the next to track your progress.'
        : fr
          ? 'Meilleures valeurs pendant le test. Une rampe sollicite surtout la minute et les efforts courts : pour ta valeur sur 20 minutes, fais un test 20 min.'
          : 'Best values during the test. A ramp mostly stresses the one-minute and short efforts: for your 20-minute value, take a 20-min test.'
    }</p></section>`;
}

/** Zones de puissance avec la FTP retenue, et repères de séance. */
export function ftpZonesHtml(r: FtpTestReport, fr: boolean): string {
  const v = ftpReportView(r, fr);
  const f = v.zonesFtp;
  const band = (a: number, b: number) => `${Math.round(a * f)}–${Math.round(b * f)} W`;
  return `<section class="sum-card sum-chart" id="ftprep-zones"><h3>${fr ? `Tes zones de puissance (FTP ${Math.round(f)} W)` : `Your power zones (FTP ${Math.round(f)} W)`}</h3>
    <div class="ftprep-zones">${ftpZones(f, fr)
      .map((z) => `<div class="ftprep-zone" style="--zc:${z.color}"><b>${z.label}</b><span>${z.name}</span><b>${z.range}</b></div>`)
      .join('')}</div>
    <p class="ftprep-hint">${fr ? `Repères de séance : sweet spot ${band(0.88, 0.94)} · seuil ${band(0.95, 1.05)} · VO2max ${band(1.06, 1.2)}.` : `Workout guides: sweet spot ${band(0.88, 0.94)} · threshold ${band(0.95, 1.05)} · VO2max ${band(1.06, 1.2)}.`}</p></section>`;
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
  if (r.result) rows.push(`<div class="now"><span>${fr ? 'Aujourd’hui · ce test' : 'Today · this test'}</span><b>${Math.round(r.result.newFtp)} W</b></div>`);
  return `<section class="sum-card"><h3>${fr ? 'Ta progression' : 'Your progress'}</h3>
    ${rows.length ? `<div class="ftprep-hist">${rows.join('')}</div>` : ''}
    <p class="ftprep-hint">${v.sinceLastText ?? (fr ? 'Premier test enregistré : il servira de point de départ.' : 'First recorded test: it will be your starting point.')}</p></section>`;
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
