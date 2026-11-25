/**
 * Montées façon ClimbPro (Garmin Edge) : suivi de la montée en cours, page qui prend la place du compteur à partir de
 * 500 m du pied, bilan au sommet. Sur les autres pages, le bandeau de chiffres passe en montée (voir shell.ts).
 */
import { climbAhead, climbElevation, gradeColor, type Climb } from '@allezrobert/shared';
import { $, esc, numHtml, setHtml, setNum, setText, showToast } from './dom.ts';
import { fmtDist, fmtTime, nf, zoneOf } from './format.ts';
import { icon } from './icons.ts';
import { drawClimb } from './map.ts';
import { curTab, haptic, inRide, S, t, type Metrics } from './state.ts';

/** La page de la montée s'ouvre 500 m avant le pied. */
const CLIMB_APPROACH_M = 500;

/** Sommet de la montée suivie (m sur la route), départ du chrono au pied. */
let climbEnd: number | null = null;
let climbT0: { elapsedS: number; elev: number } | null = null;
let lastRouteM: number | null = null;

/** Montée en cours ou proche, d'après le dernier état : vibration à l'approche, bilan au sommet. */
export function trackClimb(): void {
  const m = inRide() ? S.st!.metrics : undefined;
  if (m && lastRouteM !== null) {
    // Sens de marche, d'après l'évolution de la position (les sauts de tour de boucle sont ignorés).
    const dm = m.routeM - lastRouteM;
    if (dm < -1 && dm > -500) S.backwards = true;
    else if (dm > 1 && dm < 500) S.backwards = false;
  }
  lastRouteM = m ? m.routeM : null;
  const a = m && S.geo && !S.backwards ? climbAhead(S.climbs, m.routeM, { loop: S.geo.route.loop, lengthM: S.geo.route.lengthM }) : null;
  S.climb = a && a.pos >= -CLIMB_APPROACH_M ? a : null;
  const start = S.climb && m ? m.routeM - S.climb.pos : null;
  // Changement de montée (ou plus de montée) : la précédente a-t-elle été gravie ?
  if (climbEnd !== null && (start === null || start > climbEnd - 1)) {
    if (m && m.routeM >= climbEnd - 30 && climbT0) {
      const dt = m.elapsedS - climbT0.elapsedS;
      const gain = Math.max(0, m.altitudeM - climbT0.elev);
      const vam = dt > 0 ? Math.round((gain * 3600) / dt) : 0;
      haptic([40, 30, 40, 30, 160]);
      showToast(`${t.climbSummit} ${fmtTime(dt)} · +${nf(gain)} m · VAM ${nf(vam)} m/h`);
    }
    S.climbHidden = false;
    climbT0 = null;
  }
  if (start !== null && (climbEnd === null || start > climbEnd - 1)) haptic([60, 40, 60, 40, 60]);
  if (S.climb && m && S.climb.pos >= 0 && !climbT0) climbT0 = { elapsedS: m.elapsedS, elev: m.altitudeM };
  climbEnd = start !== null ? start + S.climb!.climb.lengthM : null;
}

/** Page de la montée affichée à la place du compteur ? */
export function climbPageWanted(): boolean {
  return !!S.climb && !S.climbHidden && curTab() === 'dash' && inRide();
}

/** Ce qui reste de la montée : distance et dénivelé, « ≥ » quand la route envoyée ne va pas jusqu'au sommet. */
export function climbLeft(): { leftM: number; gain: number; ge: string; on: boolean; inM: number; k: number } | null {
  const a = S.climb;
  if (!a) return null;
  const c = a.climb;
  const p = Math.min(Math.max(a.pos, 0), c.lengthM);
  return { leftM: c.lengthM - p, gain: Math.max(0, c.topM - climbElevation(c, p)), ge: c.openEnd ? '≥' : '', on: a.pos >= 0, inM: Math.max(0, -a.pos), k: p / c.lengthM };
}

/** Barre des tronçons colorés selon la pente ; le repère (`<b>`) est déplacé ensuite. */
export function climbBarHtml(c: Climb): string {
  return `<i class="cbar">${c.segments.map((s) => `<i style="flex:${s.to - s.from};background:${gradeColor(s.grade)}"></i>`).join('')}<b></b></i>`;
}

export function moveClimbMark(root: Element | null, k: number, on: boolean): void {
  const mark = root?.querySelector<HTMLElement>('.cbar > b');
  if (!mark) return;
  mark.hidden = !on;
  mark.style.left = `${(k * 100).toFixed(1)}%`;
}

/** Résumé d'une montée : « 3,2 km · 6,4 % · +205 m ». */
export function climbSummary(c: Climb): string {
  const ge = c.openEnd ? '≥ ' : '';
  return `${ge}${nf(c.lengthM / 1000, 1)} km · ${nf(c.avgGrade, 1)} % · ${ge}+${nf(c.gainM)} m`;
}

export function climbPageHtml(): string {
  return `<section class="cp">
    <header class="cp-head">${icon('mountain')}<b id="cp-title"></b><span id="cp-status"></span></header>
    <div class="cp-nums">${numHtml('', 'id="cp-left"')}${numHtml('', 'id="cp-gain"')}${numHtml('tint', 'id="cp-power"')}${numHtml('tint', 'id="cp-grade"')}</div>
    <div class="cp-prof"><canvas id="cp-canvas"></canvas></div>
    <div class="cp-foot"><div class="cp-seg" id="cp-seg"></div><button class="btn" data-act="climb-close">${icon('gauge')}${esc(t.tabs.dash)}</button></div>
  </section>`;
}

export function updateClimbPage(m: Metrics): void {
  const a = S.climb;
  const l = climbLeft();
  if (!a || !l) return;
  const c = a.climb;
  setText($('cp-title'), t.climbOf(a.index + 1, S.geo?.route.open ? 1 : S.climbs.length));
  setText($('cp-status'), l.on ? `${Math.round(l.k * 100)} %` : t.climbIn(fmtDist(l.inM)));
  const [lv, lu] = fmtDist(l.leftM, 1).split(' ');
  setNum($('cp-left'), t.climbLeft, l.ge + lv!, lu!);
  setNum($('cp-gain'), t.climbGainLeft, l.ge + nf(l.gain), 'm');
  setNum($('cp-grade'), t.fields.grade, nf(m.gradePercent, 1), '%', gradeColor(m.gradePercent));
  const z = zoneOf(m.watts3s, m.ftp);
  setNum($('cp-power'), t.fields.power3s, nf(m.watts3s), `W · Z${z.n}`, z.color);
  // Tronçon en cours : pente et distance jusqu'au suivant.
  const p = l.k * c.lengthM;
  const seg = c.segments.find((s) => p < s.to) ?? c.segments[c.segments.length - 1]!;
  setHtml($('cp-seg'), `<i style="background:${gradeColor(seg.grade)}"></i><b>${nf(seg.grade, 1)} %</b><span>${esc(t.climbSegFor)} ${esc(fmtDist(seg.to - p))}</span>`);
  const canvas = $('cp-canvas') as HTMLCanvasElement | null;
  if (canvas) drawClimb(canvas, c, a.pos, nf);
}
